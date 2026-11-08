#!/usr/bin/env node
// A resident path-tracing render server: one worker (tools/pt-worker.mjs: a headless Chrome) per GPU, kept
// between jobs; video jobs' frames dealt out to whichever worker is free, stills to one; an HTTP API on
// 127.0.0.1 (a bearer token: ~/.cache/pianist-pt-server.token, mode 600). Client: tools/pt-client.mjs.
//
//   node tools/pt-server.mjs [--port 8790] [--devs "0 1 2"] [--no-pin] [--idle-soft 30] [--idle-hard 300]
//        [--url http://localhost:5184/] [--out-dir dir]
//
// --devs: the /dev/nvidiaN numbers, one worker each (a number twice: two workers on it); default every
// /dev/nvidiaN. Each worker is pinned to its GPU (Chrome's EGL takes no CUDA_VISIBLE_DEVICES: an unprivileged
// user namespace, the other /dev/nvidiaN bound to an empty file); --no-pin: not (one GPU, or no unshare).
// --idle-soft / --idle-hard: a worker idle that long closes its page (the scene, its textures and buffers: the
// GPU's memory back) / its browser (0: never). --url: a dev server; else one of its own (vite on a free port).
//
// Jobs:
//   video  { type: 'video', script, from, to, fps, size, pt, denoise, ss, sub, bits, dither, filter, hq, wm,
//            query, crf, audio: true, out, framesDir }   frames in increasing order to the free workers (a warm
//            worker steps its timeline on: no reload; the timeline is the same from any frame: src/main.js),
//            encoded as they come in order (H.264, or HEVC 10-bit), the sound muxed on after (a small raster
//            pass); framesDir: also each frame as PNG there
//   still  { type: 'still', state (a scene state object, src/scenestate.js), size, spp, denoise, out }
// API: POST /jobs (a job) -> { id }; GET /jobs; GET /jobs/:id; DELETE /jobs/:id (cancel); GET /status;
// POST /shutdown.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const argv = process.argv.slice( 2 ), opt = { port: 8790, devs: null, pin: true, soft: 30, hard: 300, url: null, outDir: path.join( os.homedir(), 'pt-renders' ) };
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], val = () => argv[ ++ i ];
	if ( a === '--port' ) opt.port = Number( val() );
	else if ( a === '--devs' ) opt.devs = val().trim().split( /[\s,]+/ ).map( Number );
	else if ( a === '--no-pin' ) opt.pin = false;
	else if ( a === '--idle-soft' ) opt.soft = Number( val() );
	else if ( a === '--idle-hard' ) opt.hard = Number( val() );
	else if ( a === '--url' ) opt.url = val();
	else if ( a === '--out-dir' ) opt.outDir = path.resolve( val() );
	else if ( a === '-h' || a === '--help' ) { console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 28 ).join( '\n' ) ); process.exit( 0 ); }
	else throw new Error( `unknown argument ${ a }` );

}
const nodes = fs.readdirSync( '/dev' ).filter( f => /^nvidia\d+$/.test( f ) ).map( f => Number( f.slice( 6 ) ) ).sort( ( a, b ) => a - b );
opt.devs ??= nodes.length ? nodes : [ 0 ];
if ( opt.pin && nodes.length < 2 ) opt.pin = false;		// (one GPU: nothing to pin)
fs.mkdirSync( opt.outDir, { recursive: true } );
const say = s => console.log( `[${ new Date().toISOString().slice( 11, 19 ) }] ${ s }` );

// ---- the token ----
const tokenFile = path.join( os.homedir(), '.cache', 'pianist-pt-server.token' );
fs.mkdirSync( path.dirname( tokenFile ), { recursive: true } );
const token = crypto.randomBytes( 24 ).toString( 'hex' );
fs.writeFileSync( tokenFile, JSON.stringify( { port: opt.port, token } ), { mode: 0o600 } );
fs.chmodSync( tokenFile, 0o600 );

// ---- the dev server ----
let vite = null;
const freePort = from => new Promise( ok => { const s = net.createServer().once( 'error', () => ok( freePort( from + 1 ) ) ).listen( from, '127.0.0.1', () => s.close( () => ok( from ) ) ); } );
const reachable = async u => { try { return ( await fetch( u ) ).ok; } catch { return false; } };
if ( ! opt.url ) {

	spawnSync( process.execPath, [ path.join( root, 'tools', 'copy-fluid.mjs' ) ], { cwd: root, stdio: 'ignore' } );		// (public/fluid: npm's predev)
	const port = await freePort( 5184 );
	opt.url = `http://localhost:${ port }/`;
	vite = spawn( 'npx', [ 'vite', '--port', String( port ), '--strictPort' ], { cwd: root, stdio: 'ignore', detached: true } );
	for ( let i = 0; ! await reachable( opt.url ); ++ i ) { if ( i > 240 ) throw new Error( 'vite did not start' ); await new Promise( r => setTimeout( r, 500 ) ); }
	say( `vite on :${ port }` );

}

// ---- workers ----
const empty = path.join( os.tmpdir(), `pt-server-${ process.pid }.empty` );
fs.writeFileSync( empty, '' );
const workers = opt.devs.map( ( dev, i ) => ( { i, dev, proc: null, state: 'starting', busy: null, done: 0, ms: 0, restarts: 0, logTail: [] } ) );
let taskId = 0;
const pending = new Map();		// task id -> { worker, job, frame, resolve }

function startWorker( w ) {

	const script = path.join( root, 'tools', 'pt-worker.mjs' );
	let proc;
	if ( opt.pin ) {

		const binds = nodes.filter( n => n !== w.dev ).map( n => `mount --bind '${ empty }' /dev/nvidia${ n };` ).join( ' ' );
		proc = spawn( 'unshare', [ '-Urm', 'sh', '-c', `${ binds } exec '${ process.execPath }' '${ script }'` ], { cwd: root, stdio: [ 'pipe', 'pipe', 'pipe' ] } );

	} else proc = spawn( process.execPath, [ script ], { cwd: root, stdio: [ 'pipe', 'pipe', 'pipe' ] } );
	w.proc = proc; w.state = 'down';
	proc.stdin.write( JSON.stringify( { type: 'idle', soft: opt.soft, hard: opt.hard } ) + '\n' );
	readline.createInterface( { input: proc.stdout } ).on( 'line', line => {

		let m; try { m = JSON.parse( line ); } catch { return; }
		if ( m.id === undefined && m.state ) { w.state = m.state; return; }
		if ( m.log ) { w.logTail.push( m.log ); if ( w.logTail.length > 20 ) w.logTail.shift(); say( `gpu${ w.dev }#${ w.i }: ${ m.log }` ); return; }
		if ( m.id !== undefined ) { const t = pending.get( m.id ); if ( t ) { pending.delete( m.id ); t.resolve( m ); } }

	} );
	proc.stderr.on( 'data', d => { const s = String( d ).trim(); if ( s ) say( `gpu${ w.dev }#${ w.i } stderr: ${ s.slice( 0, 300 ) }` ); } );
	proc.on( 'exit', code => {

		say( `gpu${ w.dev }#${ w.i }: worker exited (${ code })` );
		w.proc = null; w.state = 'dead';
		// its task back to its job
		for ( const [ id, t ] of pending ) if ( t.worker === w ) { pending.delete( id ); t.resolve( { id, ok: false, error: 'worker exited' } ); }
		w.busy = null;
		if ( ! shuttingDown && w.restarts++ < 5 ) setTimeout( () => { startWorker( w ); schedule(); }, 2000 );

	} );

}

function runTask( w, task ) {

	const id = ++ taskId;
	return new Promise( resolve => {

		pending.set( id, { worker: w, resolve } );
		w.proc.stdin.write( JSON.stringify( { id, url: opt.url, ...task } ) + '\n' );

	} );

}

// ---- jobs ----
const jobs = new Map();
let jobNo = 0, shuttingDown = false;
const ENC = bits => bits === 10
	? [ '-c:v', 'libx265', '-preset', 'slow', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709' ]
	: [ '-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p' ];

function newJob( spec ) {

	const id = String( ++ jobNo ), t0 = Date.now();
	if ( spec.type === 'still' ) {

		if ( ! spec.state || typeof spec.state !== 'object' ) throw new Error( 'still: a scene state object (state) is needed' );
		const out = path.resolve( opt.outDir, spec.out ?? `still-${ id }.png` );
		const job = { id, type: 'still', spec, out, status: 'queued', t0, todo: [ 0 ], inflight: new Set(), retries: new Map(), doneN: 0, total: 1, msSum: 0 };
		jobs.set( id, job );
		return job;

	}
	if ( spec.type !== 'video' ) throw new Error( `job type ${ spec.type }: video or still` );
	for ( const k of [ 'script', 'from', 'to' ] ) if ( spec[ k ] === undefined ) throw new Error( `video: ${ k } missing` );
	const fps = spec.fps ?? 25, size = spec.size ?? '640x360', [ W, H ] = size.split( 'x' ).map( Number );
	if ( ! ( W > 0 && H > 0 ) || W % 2 || H % 2 ) throw new Error( `size ${ size }: even WxH` );
	const f0 = Math.round( spec.from * fps ), f1 = Math.round( spec.to * fps );
	if ( ! ( f1 > f0 ) ) throw new Error( 'to must be after from' );
	const out = path.resolve( opt.outDir, spec.out ?? `${ path.basename( spec.script ).replace( /\.ya?ml$/i, '' ) }-${ id }.mp4` );
	const tmp = out + '.frames';
	fs.mkdirSync( tmp, { recursive: true } );
	if ( spec.framesDir ) fs.mkdirSync( spec.framesDir, { recursive: true } );
	const bits = spec.bits === 10 ? 10 : 8, job = {
		id, type: 'video', spec: { ...spec, fps, size, bits }, out, tmp, W, H, bits, status: 'queued', t0,
		todo: Array.from( { length: f1 - f0 }, ( _, k ) => f0 + k ), inflight: new Set(), retries: new Map(), done: new Set(), f0, f1,
		next: f0, doneN: 0, total: f1 - f0, msSum: 0,
	};
	// the encoder: fed the frames in order as they come (raw rgb24 / rgb48le, sRGB full range in, BT.709 tv out, tagged)
	const video = spec.audio === false ? out : out + '.video.mp4';
	job.video = video;
	job.ffmpeg = spawn( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', bits === 10 ? 'rgb48le' : 'rgb24', '-s', size, '-framerate', String( fps ), '-i', '-',
		'-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int', ...ENC( bits ), '-crf', String( spec.crf ?? ( bits === 10 ? 20 : 18 ) ),
		'-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', video ], { stdio: [ 'pipe', 'ignore', 'pipe' ] } );
	job.ffErr = '';
	job.ffmpeg.stderr.on( 'data', d => job.ffErr += d );
	job.encoded = new Promise( ok => job.ffmpeg.on( 'close', code => ok( code ) ) );
	jobs.set( id, job );
	return job;

}

/** The in-order frames that are in: to the encoder (and as PNGs), their raw files removed. */
async function feed( job ) {

	while ( job.done.has( job.next ) ) {

		const file = path.join( job.tmp, `${ job.next }.raw` ), px = fs.readFileSync( file );
		if ( job.spec.framesDir ) spawnSync( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', job.bits === 10 ? 'rgb48le' : 'rgb24', '-s', job.spec.size, '-i', '-', '-frames:v', '1',
			'-pix_fmt', job.bits === 10 ? 'rgb48be' : 'rgb24', path.join( job.spec.framesDir, `${ String( job.next ).padStart( 5, '0' ) }.png` ) ], { input: px } );
		if ( ! job.ffmpeg.stdin.write( px ) ) await new Promise( r => job.ffmpeg.stdin.once( 'drain', r ) );
		fs.rmSync( file );
		job.next ++;

	}

}

async function finishVideo( job ) {

	job.status = 'encoding';
	job.ffmpeg.stdin.end();
	const code = await job.encoded;
	if ( code !== 0 ) throw new Error( `ffmpeg ${ code }: ${ job.ffErr.slice( -300 ) }` );
	if ( job.spec.audio !== false ) {

		// the sound: a small raster pass of the range (the timeline's, not the picture's)
		job.status = 'sound';
		const sound = job.out + '.sound.mp4';
		const r = spawnSync( process.execPath, [ path.join( root, 'tools', 'render-video.mjs' ), job.spec.script, '--from', String( job.f0 / job.spec.fps ), '--to', String( job.f1 / job.spec.fps ),
			'--fps', String( job.spec.fps ), '--size', '320x180', '--ss', '1', '--out', sound, '--url', opt.url, ...( job.spec.query ? [ '--query', job.spec.query ] : [] ) ], { cwd: root, encoding: 'utf8' } );
		if ( r.status !== 0 ) throw new Error( `the sound pass: ${ ( r.stderr || r.stdout ).slice( -300 ) }` );
		const m = spawnSync( 'ffmpeg', [ '-y', '-loglevel', 'error', '-i', job.video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', job.out ], { encoding: 'utf8' } );
		if ( m.status !== 0 ) throw new Error( `mux: ${ m.stderr.slice( -300 ) }` );
		fs.rmSync( sound, { force: true } ); fs.rmSync( job.video, { force: true } );

	}
	fs.rmSync( job.tmp, { recursive: true, force: true } );

}

function fail( job, error ) {

	if ( [ 'done', 'failed', 'cancelled' ].includes( job.status ) ) return;
	job.status = 'failed'; job.error = error; job.t1 = Date.now();
	job.todo.length = 0;
	if ( job.ffmpeg ) { job.ffmpeg.stdin.destroy(); job.ffmpeg.kill( 'SIGKILL' ); }
	say( `job ${ job.id } failed: ${ error }` );

}

/** Deal out work: each free worker the oldest job's next frame. */
function schedule() {

	for ( const w of workers ) {

		if ( w.busy || ! w.proc ) continue;
		const job = [ ...jobs.values() ].find( j => [ 'queued', 'running' ].includes( j.status ) && j.todo.length );
		if ( ! job ) return;
		const frame = job.todo.shift();
		job.inflight.add( frame );
		job.status = 'running';
		w.busy = { job: job.id, frame };
		const task = job.type === 'still'
			? { type: 'still', state: job.spec.state, size: job.spec.size, spp: job.spec.spp, denoise: job.spec.denoise, file: job.out }
			: { type: 'frame', job: job.spec, frame, file: path.join( job.tmp, `${ frame }.raw` ) };
		const t0 = Date.now();
		runTask( w, task ).then( async r => {

			w.busy = null;
			job.inflight.delete( frame );
			if ( [ 'failed', 'cancelled' ].includes( job.status ) ) { schedule(); return; }
			if ( r.ok ) {

				w.done ++; w.ms += Date.now() - t0;
				job.doneN ++; job.msSum += Date.now() - t0;
				if ( job.type === 'still' ) { job.status = 'done'; job.t1 = Date.now(); say( `job ${ job.id } (still) done: ${ job.out }` ); }
				else {

					job.done.add( frame );
					try {

						await feed( job );
						if ( job.doneN === job.total ) { await finishVideo( job ); job.status = 'done'; job.t1 = Date.now(); say( `job ${ job.id } done in ${ ( ( job.t1 - job.t0 ) / 1000 ).toFixed( 0 ) } s: ${ job.out }` ); }

					} catch ( e ) { fail( job, e.message ); }

				}

			} else {

				// once more, on whichever worker comes next; twice: the job fails
				const n = ( job.retries?.get( frame ) ?? 0 ) + 1;
				job.retries?.set( frame, n );
				say( `job ${ job.id } frame ${ frame } on gpu${ w.dev }#${ w.i }: ${ r.error }` );
				if ( n >= 2 ) fail( job, `frame ${ frame }: ${ r.error }` ); else job.todo.unshift( frame );

			}
			schedule();

		} );

	}

}

const jobView = j => {

	const el = ( ( j.t1 ?? Date.now() ) - j.t0 ) / 1000, busyN = workers.filter( w => w.busy?.job === j.id ).length || 1;
	const per = j.doneN ? j.msSum / j.doneN / 1000 : null;
	const left = j.total - j.doneN, eta = per && left ? Math.round( left * per / Math.max( busyN, Math.min( workers.length, left ) ) ) : null;
	return { id: j.id, type: j.type, status: j.status, error: j.error, out: j.out, done: j.doneN, total: j.total, inflight: [ ...j.inflight ], elapsed: Math.round( el ), sPerFrame: per && +per.toFixed( 1 ), eta,
		spec: { ...j.spec, state: j.spec.state ? '(state)' : undefined } };

};

// ---- HTTP ----
const body = req => new Promise( ( ok, bad ) => { let s = ''; req.on( 'data', d => { s += d; if ( s.length > 64e6 ) bad( new Error( 'too large' ) ); } ); req.on( 'end', () => { try { ok( s ? JSON.parse( s ) : {} ); } catch ( e ) { bad( e ); } } ); } );
const server = http.createServer( async ( req, res ) => {

	const reply = ( code, o ) => { res.writeHead( code, { 'content-type': 'application/json' } ); res.end( JSON.stringify( o ) ); };
	if ( req.headers.authorization !== `Bearer ${ token }` ) return reply( 401, { error: 'token' } );
	const u = new URL( req.url, 'http://x' ), m = u.pathname.match( /^\/jobs\/(\w+)$/ );
	try {

		if ( req.method === 'POST' && u.pathname === '/jobs' ) { const j = newJob( await body( req ) ); say( `job ${ j.id } (${ j.type }) queued: ${ j.total } frame(s)` ); schedule(); return reply( 200, { id: j.id } ); }
		if ( req.method === 'GET' && u.pathname === '/jobs' ) return reply( 200, [ ...jobs.values() ].map( jobView ) );
		if ( m && req.method === 'GET' ) { const j = jobs.get( m[ 1 ] ); return j ? reply( 200, jobView( j ) ) : reply( 404, { error: 'no such job' } ); }
		if ( m && req.method === 'DELETE' ) { const j = jobs.get( m[ 1 ] ); if ( ! j ) return reply( 404, { error: 'no such job' } ); if ( ! [ 'done', 'failed' ].includes( j.status ) ) { fail( j, 'cancelled' ); j.status = 'cancelled'; } return reply( 200, jobView( j ) ); }
		if ( req.method === 'GET' && u.pathname === '/status' ) return reply( 200, { url: opt.url, pin: opt.pin, idle: { soft: opt.soft, hard: opt.hard }, outDir: opt.outDir,
			workers: workers.map( w => ( { gpu: w.dev, worker: w.i, state: w.state, busy: w.busy, frames: w.done, sPerFrame: w.done ? +( w.ms / w.done / 1000 ).toFixed( 1 ) : null, log: w.logTail.slice( -3 ) } ) ),
			jobs: [ ...jobs.values() ].filter( j => ! [ 'done', 'failed', 'cancelled' ].includes( j.status ) ).map( jobView ) } );
		if ( req.method === 'POST' && u.pathname === '/shutdown' ) { reply( 200, { ok: true } ); shutdown(); return; }
		reply( 404, { error: 'not found' } );

	} catch ( e ) { reply( 400, { error: e.message } ); }

} );

async function shutdown() {

	if ( shuttingDown ) return;
	shuttingDown = true;
	say( 'shutting down' );
	for ( const w of workers ) w.proc?.stdin.write( JSON.stringify( { type: 'exit' } ) + '\n' );
	await new Promise( r => setTimeout( r, 3000 ) );
	for ( const w of workers ) w.proc?.kill( 'SIGKILL' );
	for ( const j of jobs.values() ) if ( j.ffmpeg && ! [ 'done' ].includes( j.status ) ) j.ffmpeg.kill( 'SIGKILL' );
	if ( vite ) try { process.kill( - vite.pid ); } catch { /* gone */ }
	fs.rmSync( empty, { force: true } );
	server.close();
	process.exit( 0 );

}
process.on( 'SIGINT', shutdown );
process.on( 'SIGTERM', shutdown );

for ( const w of workers ) startWorker( w );
server.listen( opt.port, '127.0.0.1', () => say( `pt-server on 127.0.0.1:${ opt.port }: ${ workers.length } worker(s) on /dev/nvidia{${ opt.devs.join( ',' ) }}${ opt.pin ? ' (pinned)' : '' }, idle ${ opt.soft } / ${ opt.hard } s, out ${ opt.outDir }; token in ${ tokenFile }` ) );

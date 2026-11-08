#!/usr/bin/env node
// A resident path-tracing render server: it renders frames, and only that (the GPU's part). One worker
// (tools/pt-worker.mjs: a headless Chrome) per GPU, kept between jobs; a job's frames dealt out one at a time,
// lowest first, to whichever worker is free; each frame held in memory until its client has taken it (an HTTP
// GET, then a DELETE: a dropped connection gets it again), then gone. Nothing is written to disk; encoding and
// the sound are the client's (tools/pt-client.mjs). HTTP on 127.0.0.1 only, a bearer token
// (~/.cache/pianist-pt-server.token, mode 600; a client elsewhere: an ssh tunnel, pt-client.mjs --ssh).
//
//   node tools/pt-server.mjs [--port 8790] [--devs "0 1 2"] [--no-pin] [--idle-soft 30] [--idle-hard 300]
//        [--url http://localhost:5184/] [--buffer-mb 512] [--ttl 600]
//
// --devs: the /dev/nvidiaN numbers, one worker each (a number twice: two workers on it); default every
// /dev/nvidiaN. Each worker is pinned to its GPU (Chrome's EGL takes no CUDA_VISIBLE_DEVICES: an unprivileged
// user namespace, the other /dev/nvidiaN bound to an empty file); --no-pin: not (one GPU, or no unshare).
// --idle-soft / --idle-hard: a worker idle that long closes its page (the scene, its textures and buffers: the
// GPU's memory back) / its browser (0: never). --url: a dev server; else one of its own (vite, a free port).
// --buffer-mb: frames rendered but not yet taken, at most (then no more are dealt out until they are).
// --ttl: a job nobody has asked about for that long is dropped (s).
//
// API (JSON unless said):
//   POST   /jobs                 { type: 'frames', script, from, to, fps, size, pt, denoise, ss, sub, bits,
//                                  dither, filter, hq, wm, query } -> { id, f0, f1, bytes }
//                                 { type: 'still', state (a scene state, src/scenestate.js), size, spp, denoise } -> { id }
//   GET    /jobs/:id/frames/:n   the frame (waits up to 25 s; 204 if not yet): raw rgb24 / rgb48le (gzip), or a
//                                PNG (a still: n 0); headers x-ms (render time), x-worker
//   DELETE /jobs/:id/frames/:n   taken: freed
//   GET    /jobs, /jobs/:id, /status;  DELETE /jobs/:id (cancel);  POST /shutdown

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const argv = process.argv.slice( 2 ), opt = { port: 8790, devs: null, pin: true, soft: 30, hard: 300, url: null, bufferMB: 512, ttl: 600 };
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], val = () => argv[ ++ i ];
	if ( a === '--port' ) opt.port = Number( val() );
	else if ( a === '--devs' ) opt.devs = val().trim().split( /[\s,]+/ ).map( Number );
	else if ( a === '--no-pin' ) opt.pin = false;
	else if ( a === '--idle-soft' ) opt.soft = Number( val() );
	else if ( a === '--idle-hard' ) opt.hard = Number( val() );
	else if ( a === '--url' ) opt.url = val();
	else if ( a === '--buffer-mb' ) opt.bufferMB = Number( val() );
	else if ( a === '--ttl' ) opt.ttl = Number( val() );
	else if ( a === '-h' || a === '--help' ) { console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 31 ).join( '\n' ) ); process.exit( 0 ); }
	else throw new Error( `unknown argument ${ a }` );

}
const nodes = fs.readdirSync( '/dev' ).filter( f => /^nvidia\d+$/.test( f ) ).map( f => Number( f.slice( 6 ) ) ).sort( ( a, b ) => a - b );
opt.devs ??= nodes.length ? nodes : [ 0 ];
if ( opt.pin && nodes.length < 2 ) opt.pin = false;		// (one GPU: nothing to pin)
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
let taskId = 0, shuttingDown = false;
const pending = new Map();		// task id -> { worker, resolve }

function startWorker( w ) {

	const script = path.join( root, 'tools', 'pt-worker.mjs' );
	let proc;
	if ( opt.pin ) {

		const binds = nodes.filter( n => n !== w.dev ).map( n => `mount --bind '${ empty }' /dev/nvidia${ n };` ).join( ' ' );
		proc = spawn( 'unshare', [ '-Urm', 'sh', '-c', `${ binds } exec '${ process.execPath }' '${ script }'` ], { cwd: root, stdio: [ 'pipe', 'pipe', 'pipe' ] } );

	} else proc = spawn( process.execPath, [ script ], { cwd: root, stdio: [ 'pipe', 'pipe', 'pipe' ] } );
	w.proc = proc; w.state = 'down';
	proc.stdin.write( JSON.stringify( { type: 'idle', soft: opt.soft, hard: opt.hard } ) + '\n' );
	readline.createInterface( { input: proc.stdout, crlfDelay: Infinity } ).on( 'line', line => {

		let m; try { m = JSON.parse( line ); } catch { return; }
		if ( m.id === undefined && m.state ) { w.state = m.state; return; }
		if ( m.log ) { w.logTail.push( m.log ); if ( w.logTail.length > 20 ) w.logTail.shift(); say( `gpu${ w.dev }#${ w.i }: ${ m.log }` ); return; }
		if ( m.id !== undefined ) { const t = pending.get( m.id ); if ( t ) { pending.delete( m.id ); t.resolve( m ); } }

	} );
	proc.stderr.on( 'data', d => { const s = String( d ).trim(); if ( s ) say( `gpu${ w.dev }#${ w.i } stderr: ${ s.slice( 0, 300 ) }` ); } );
	proc.on( 'exit', code => {

		say( `gpu${ w.dev }#${ w.i }: worker exited (${ code })` );
		w.proc = null; w.state = 'dead';
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
let jobNo = 0;
const ended = j => [ 'done', 'failed', 'cancelled' ].includes( j.status );
const heldBytes = () => { let b = 0; for ( const j of jobs.values() ) for ( const f of j.ready.values() ) b += f.data.length; return b; };

function newJob( spec ) {

	const id = crypto.randomBytes( 4 ).toString( 'hex' ) + ( ++ jobNo ), now = Date.now();
	const base = { id, spec, status: 'queued', t0: now, seen: now, todo: [], inflight: new Set(), ready: new Map(), taken: new Set(), retries: new Map(), waiters: new Map(), doneN: 0, msSum: 0 };
	if ( spec.type === 'still' ) {

		if ( ! spec.state || typeof spec.state !== 'object' ) throw new Error( 'still: a scene state object (state) is needed' );
		const job = { ...base, type: 'still', f0: 0, f1: 1, todo: [ 0 ], bytes: 0 };
		jobs.set( id, job );
		return job;

	}
	if ( spec.type !== 'frames' ) throw new Error( `job type ${ spec.type }: frames or still` );
	for ( const k of [ 'script', 'from', 'to' ] ) if ( spec[ k ] === undefined ) throw new Error( `frames: ${ k } missing` );
	const fps = spec.fps ?? 25, size = spec.size ?? '640x360', [ W, H ] = size.split( 'x' ).map( Number );
	if ( ! ( W > 0 && H > 0 ) ) throw new Error( `size ${ size }: WxH` );
	const f0 = Math.round( spec.from * fps ), f1 = Math.round( spec.to * fps );
	if ( ! ( f1 > f0 ) ) throw new Error( 'to must be after from' );
	const bits = spec.bits === 10 ? 10 : 8;
	const job = { ...base, type: 'frames', spec: { ...spec, fps, size, bits }, f0, f1, todo: Array.from( { length: f1 - f0 }, ( _, k ) => f0 + k ), bytes: W * H * 3 * ( bits === 10 ? 2 : 1 ) };
	jobs.set( id, job );
	return job;

}

function wake( job, n ) {

	for ( const r of job.waiters.get( n ) ?? [] ) r();
	job.waiters.delete( n );

}

function end( job, status, error ) {

	if ( ended( job ) ) return;
	job.status = status; job.error = error; job.t1 = Date.now();
	job.todo.length = 0; job.ready.clear();
	for ( const n of [ ...job.waiters.keys() ] ) wake( job, n );
	if ( status !== 'done' ) say( `job ${ job.id } ${ status }${ error ? ': ' + error : '' }` );

}

/** Deal out work: each free worker the oldest job's next frame (while the frames held are under the cap). */
function schedule() {

	for ( const w of workers ) {

		if ( w.busy || ! w.proc ) continue;
		let held = heldBytes();
		for ( const j of jobs.values() ) held += j.inflight.size * j.bytes;
		const job = [ ...jobs.values() ].find( j => ! ended( j ) && j.todo.length && ( j.type === 'still' || held + j.bytes <= opt.bufferMB * 2 ** 20 ) );
		if ( ! job ) return;
		const frame = job.todo.shift();
		job.inflight.add( frame );
		job.status = 'running';
		w.busy = { job: job.id, frame };
		const task = job.type === 'still'
			? { type: 'still', state: job.spec.state, size: job.spec.size, spp: job.spec.spp, denoise: job.spec.denoise }
			: { type: 'frame', job: job.spec, frame };
		const t0 = Date.now();
		runTask( w, task ).then( r => {

			w.busy = null;
			job.inflight.delete( frame );
			if ( ended( job ) ) { schedule(); return; }
			if ( r.ok ) {

				const ms = Date.now() - t0;
				w.done ++; w.ms += ms; job.doneN ++; job.msSum += ms;
				const raw = Buffer.from( r.data, 'base64' );
				// (raw pixels gzip a little: cheap at level 1; a PNG as it is)
				job.ready.set( frame, { data: job.type === 'still' ? raw : zlib.gzipSync( raw, { level: 1 } ), gzip: job.type !== 'still', ms: r.ms, worker: `gpu${ w.dev }#${ w.i }` } );
				wake( job, frame );

			} else {

				const n = ( job.retries.get( frame ) ?? 0 ) + 1;
				job.retries.set( frame, n );
				say( `job ${ job.id } frame ${ frame } on gpu${ w.dev }#${ w.i }: ${ r.error }` );
				if ( n >= 2 ) end( job, 'failed', `frame ${ frame }: ${ r.error }` ); else job.todo.unshift( frame );

			}
			schedule();

		} );

	}

}

const jobView = j => {

	const per = j.doneN ? j.msSum / j.doneN / 1000 : null, total = j.f1 - j.f0;
	return { id: j.id, type: j.type, status: j.status, error: j.error, rendered: j.doneN, taken: j.taken.size, total, inflight: [ ...j.inflight ], held: j.ready.size,
		elapsed: Math.round( ( ( j.t1 ?? Date.now() ) - j.t0 ) / 1000 ), sPerFrame: per && +per.toFixed( 1 ), spec: { ...j.spec, state: j.spec.state ? '(state)' : undefined } };

};

// jobs nobody asks about: dropped after the ttl; ended ones forgotten after an hour
setInterval( () => {

	const now = Date.now();
	for ( const j of jobs.values() ) {

		if ( ! ended( j ) && now - j.seen > opt.ttl * 1000 ) { end( j, 'cancelled', `nobody asked for ${ opt.ttl } s` ); schedule(); }
		if ( ended( j ) && now - ( j.t1 ?? now ) > 3600e3 ) jobs.delete( j.id );

	}

}, 10000 ).unref();

// ---- HTTP ----
const body = req => new Promise( ( ok, bad ) => { let s = ''; req.on( 'data', d => { s += d; if ( s.length > 64e6 ) bad( new Error( 'too large' ) ); } ); req.on( 'end', () => { try { ok( s ? JSON.parse( s ) : {} ); } catch ( e ) { bad( e ); } } ); } );
const server = http.createServer( async ( req, res ) => {

	const reply = ( code, o ) => { res.writeHead( code, { 'content-type': 'application/json' } ); res.end( JSON.stringify( o ) ); };
	if ( req.headers.authorization !== `Bearer ${ token }` ) return reply( 401, { error: 'token' } );
	const u = new URL( req.url, 'http://x' );
	const mj = u.pathname.match( /^\/jobs\/(\w+)$/ ), mf = u.pathname.match( /^\/jobs\/(\w+)\/frames\/(\d+)$/ );
	try {

		if ( mf ) {

			const job = jobs.get( mf[ 1 ] ), n = Number( mf[ 2 ] );
			if ( ! job ) return reply( 404, { error: 'no such job' } );
			job.seen = Date.now();
			if ( n < job.f0 || n >= job.f1 ) return reply( 404, { error: `frame ${ n } outside ${ job.f0 }-${ job.f1 - 1 }` } );
			if ( req.method === 'DELETE' ) {

				job.ready.delete( n );
				job.taken.add( n );
				if ( ! ended( job ) && job.taken.size === job.f1 - job.f0 ) { end( job, 'done' ); say( `job ${ job.id } done: ${ job.taken.size } frame(s) in ${ ( ( job.t1 - job.t0 ) / 1000 ).toFixed( 0 ) } s` ); }
				schedule();
				return reply( 200, { ok: true } );

			}
			const send = () => {

				const f = job.ready.get( n );
				if ( ! f ) return false;
				res.writeHead( 200, { 'content-type': job.type === 'still' ? 'image/png' : 'application/octet-stream', ...( f.gzip ? { 'content-encoding': 'gzip' } : {} ),
					'content-length': f.data.length, 'x-ms': String( f.ms ), 'x-worker': f.worker } );
				res.end( f.data );
				return true;

			};
			if ( send() ) return;
			if ( ended( job ) ) return reply( 410, { error: job.error ?? job.status } );
			if ( job.taken.has( n ) ) return reply( 410, { error: `frame ${ n } taken already` } );
			// wait for it, up to 25 s
			let timer;
			const done = new Promise( ok => { timer = setTimeout( ok, 25000 ); const ws = job.waiters.get( n ) ?? []; ws.push( ok ); job.waiters.set( n, ws ); } );
			req.on( 'close', () => clearTimeout( timer ) );
			await done; clearTimeout( timer );
			if ( res.writableEnded || res.destroyed ) return;
			if ( send() ) return;
			if ( ended( job ) ) return reply( 410, { error: job.error ?? job.status } );
			res.writeHead( 204 ); res.end();
			return;

		}
		if ( req.method === 'POST' && u.pathname === '/jobs' ) {

			const j = newJob( await body( req ) );
			say( `job ${ j.id } (${ j.type }) queued: ${ j.f1 - j.f0 } frame(s)` );
			schedule();
			return reply( 200, { id: j.id, f0: j.f0, f1: j.f1, bytes: j.bytes } );

		}
		if ( req.method === 'GET' && u.pathname === '/jobs' ) return reply( 200, [ ...jobs.values() ].map( jobView ) );
		if ( mj && req.method === 'GET' ) { const j = jobs.get( mj[ 1 ] ); if ( ! j ) return reply( 404, { error: 'no such job' } ); j.seen = Date.now(); return reply( 200, jobView( j ) ); }
		if ( mj && req.method === 'DELETE' ) { const j = jobs.get( mj[ 1 ] ); if ( ! j ) return reply( 404, { error: 'no such job' } ); end( j, 'cancelled', 'cancelled' ); schedule(); return reply( 200, jobView( j ) ); }
		if ( req.method === 'GET' && u.pathname === '/status' ) return reply( 200, { url: opt.url, pin: opt.pin, idle: { soft: opt.soft, hard: opt.hard }, heldMB: +( heldBytes() / 2 ** 20 ).toFixed( 1 ), bufferMB: opt.bufferMB,
			workers: workers.map( w => ( { gpu: w.dev, worker: w.i, state: w.state, busy: w.busy, frames: w.done, sPerFrame: w.done ? +( w.ms / w.done / 1000 ).toFixed( 1 ) : null, log: w.logTail.slice( -3 ) } ) ),
			jobs: [ ...jobs.values() ].filter( j => ! ended( j ) ).map( jobView ) } );
		if ( req.method === 'POST' && u.pathname === '/shutdown' ) { reply( 200, { ok: true } ); shutdown(); return; }
		reply( 404, { error: 'not found' } );

	} catch ( e ) { if ( ! res.headersSent ) reply( 400, { error: e.message } ); }

} );
server.keepAliveTimeout = 65000;

async function shutdown() {

	if ( shuttingDown ) return;
	shuttingDown = true;
	say( 'shutting down' );
	for ( const j of jobs.values() ) end( j, 'cancelled', 'server shut down' );
	for ( const w of workers ) w.proc?.stdin.write( JSON.stringify( { type: 'exit' } ) + '\n' );
	await new Promise( r => setTimeout( r, 3000 ) );
	for ( const w of workers ) w.proc?.kill( 'SIGKILL' );
	if ( vite ) try { process.kill( - vite.pid ); } catch { /* gone */ }
	fs.rmSync( empty, { force: true } );
	server.close();
	process.exit( 0 );

}
process.on( 'SIGINT', shutdown );
process.on( 'SIGTERM', shutdown );

for ( const w of workers ) startWorker( w );
server.listen( opt.port, '127.0.0.1', () => say( `pt-server on 127.0.0.1:${ opt.port }: ${ workers.length } worker(s) on /dev/nvidia{${ opt.devs.join( ',' ) }}${ opt.pin ? ' (pinned)' : '' }, idle ${ opt.soft } / ${ opt.hard } s, buffer ${ opt.bufferMB } MB; token in ${ tokenFile }` ) );

#!/usr/bin/env node
// A client of tools/pt-server.mjs: the server renders the frames (and keeps nothing); here they are fetched,
// encoded, and given their sound (a raster pass of the range here: tools/render-video.mjs).
//
//   node tools/pt-client.mjs [--ssh host] video <script.yaml> --from A --to B [--fps 25] [--size 640x360]
//        [--pt 1024] [--pt-shutter 0.5] [--denoise] [--bits 8|10] [--crf 18] [--wm off] [--query "style=..."] [--no-audio]
//        [--frames dir] [--ahead K] [--temporal R] [--out file.mp4]
//   node tools/pt-client.mjs [--ssh host] still <state.json> [--spp 4096] [--size WxH] [--denoise] [--out file.png]
//   node tools/pt-client.mjs [--ssh host] status | jobs | cancel <id> | shutdown
//
// --ssh host: the server on that host (its port and token read there over ssh, an ssh tunnel to its port);
// else this machine's (~/.cache/pianist-pt-server.token). --ahead: frames asked for at once (default: twice
// the server's workers). --frames dir: also each frame as PNG there. --temporal R: the frames through a
// motion-compensated temporal denoiser (tools/temporal-denoise.py, R frames each side; numpy + OpenCV, here)
// before the encoder. An odd width or height is padded by one
// row / column for the encoder (yuv420p).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const args = process.argv.slice( 2 ), flags = {}, pos = [];
for ( let i = 0; i < args.length; ++ i ) {

	const a = args[ i ];
	if ( [ '--denoise', '--no-audio' ].includes( a ) ) flags[ a.slice( 2 ) ] = true;
	else if ( a.startsWith( '--' ) ) flags[ a.slice( 2 ) ] = args[ ++ i ];
	else pos.push( a );

}
const [ cmd, ...rest ] = pos;
const sleep = ms => new Promise( r => setTimeout( r, ms ) );

// ---- the connection: local, or an ssh tunnel ----
let base, token, tunnel = null;
const freePort = () => new Promise( ok => { const s = net.createServer().listen( 0, '127.0.0.1', () => { const p = s.address().port; s.close( () => ok( p ) ); } ); } );
if ( flags.ssh ) {

	const r = spawnSync( 'ssh', [ '-o', 'BatchMode=yes', flags.ssh, 'cat ~/.cache/pianist-pt-server.token' ], { encoding: 'utf8' } );
	if ( r.status !== 0 ) throw new Error( `ssh ${ flags.ssh }: no server token (${ r.stderr.trim() })` );
	const t = JSON.parse( r.stdout ), lp = await freePort();
	token = t.token;
	tunnel = spawn( 'ssh', [ '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ServerAliveInterval=15',
		'-N', '-L', `127.0.0.1:${ lp }:127.0.0.1:${ t.port }`, flags.ssh ], { stdio: 'ignore' } );
	base = `http://127.0.0.1:${ lp }`;
	process.on( 'exit', () => tunnel?.kill() );
	for ( let i = 0; ; ++ i ) { try { if ( ( await fetch( base + '/status', { headers: { authorization: `Bearer ${ token }` } } ) ).ok ) break; } catch { /* not yet */ } if ( i > 60 ) throw new Error( 'the ssh tunnel did not come up' ); await sleep( 500 ); }

} else {

	const t = JSON.parse( fs.readFileSync( path.join( os.homedir(), '.cache', 'pianist-pt-server.token' ), 'utf8' ) );
	token = t.token; base = `http://127.0.0.1:${ t.port }`;

}
const hdr = { authorization: `Bearer ${ token }` };
const api = async ( method, p, body ) => {

	const r = await fetch( base + p, { method, headers: { ...hdr, 'content-type': 'application/json' }, body: body ? JSON.stringify( body ) : undefined } );
	const j = await r.json();
	if ( ! r.ok ) throw new Error( j.error ?? r.status );
	return j;

};
const done = code => { tunnel?.kill(); process.exit( code ); };
process.on( 'SIGINT', () => done( 130 ) );

/** Frame `n` of job `id` (waits, retries a dropped connection); then taken (the server frees it). */
async function fetchFrame( id, n ) {

	for ( let tries = 0; ; ) {

		try {

			const r = await fetch( `${ base }/jobs/${ id }/frames/${ n }`, { headers: hdr } );
			if ( r.status === 204 ) continue;		// (not yet: ask again)
			if ( r.status === 200 ) {

				const data = Buffer.from( await r.arrayBuffer() ), ms = Number( r.headers.get( 'x-ms' ) ), worker = r.headers.get( 'x-worker' );
				await fetch( `${ base }/jobs/${ id }/frames/${ n }`, { method: 'DELETE', headers: hdr } ).catch( () => {} );
				return { data, ms, worker };

			}
			const e = await r.json().catch( () => ( {} ) );
			throw Object.assign( new Error( e.error ?? `HTTP ${ r.status }` ), { fatal: true } );

		} catch ( e ) {

			if ( e.fatal || ++ tries > 20 ) throw e;
			await sleep( Math.min( 10000, 500 * tries ) );		// (a dropped connection: again)

		}

	}

}

if ( cmd === 'video' ) {

	const script = rest[ 0 ], fps = Number( flags.fps ?? 25 ), size = flags.size ?? '640x360', [ W, H ] = size.split( 'x' ).map( Number ), bits = flags.bits === '10' ? 10 : 8;
	const out = path.resolve( flags.out ?? `${ path.basename( script ).replace( /\.ya?ml$/i, '' ) }-pt.mp4` );
	fs.mkdirSync( path.dirname( out ), { recursive: true } );
	if ( flags.frames ) fs.mkdirSync( flags.frames, { recursive: true } );
	const st = await api( 'GET', '/status' ), K = Number( flags.ahead ?? 2 * st.workers.length );
	const job = await api( 'POST', '/jobs', { type: 'frames', script, from: Number( flags.from ), to: Number( flags.to ), fps, size, pt: flags.pt ? Number( flags.pt ) : 0, denoise: !! flags.denoise, bits,
		wm: flags.wm, query: flags.query, ptShutter: flags[ 'pt-shutter' ] ? Number( flags[ 'pt-shutter' ] ) : undefined } );
	console.log( `job ${ job.id }: frames ${ job.f0 }-${ job.f1 - 1 } (${ job.f1 - job.f0 }) on ${ st.workers.length } worker(s), ${ K } at once` );
	// the encoder here: raw sRGB in, BT.709 tv out, tagged; an odd size padded by one (yuv420p)
	const tmp = fs.mkdtempSync( path.join( os.tmpdir(), 'pt-client-' ) ), video = flags[ 'no-audio' ] ? out : path.join( tmp, 'video.mp4' );
	const pad = W % 2 || H % 2 ? `,pad=${ W + W % 2 }:${ H + H % 2 }:0:0:black` : '';
	const enc = bits === 10 ? [ '-c:v', 'libx265', '-preset', 'slow', '-crf', String( flags.crf ?? 20 ), '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709' ]
		: [ '-c:v', 'libx264', '-preset', 'slow', '-crf', String( flags.crf ?? 18 ), '-pix_fmt', 'yuv420p' ];
	const ff = spawn( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', bits === 10 ? 'rgb48le' : 'rgb24', '-s', size, '-framerate', String( fps ), '-i', '-',
		'-vf', `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int${ pad }`, ...enc,
		'-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', video ], { stdio: [ 'pipe', 'ignore', 'inherit' ] } );
	const encoded = new Promise( ( ok, bad ) => ff.on( 'close', c => c === 0 ? ok() : bad( new Error( `ffmpeg ${ c }` ) ) ) );
	// --temporal: frames -> the temporal denoiser -> the encoder
	const td = flags.temporal ? spawn( process.env.PT_PYTHON ?? 'python3', [ path.join( root, 'tools', 'temporal-denoise.py' ), '--raw', size, '--raw-out', '--radius', String( Number( flags.temporal ) || 2 ) ], { stdio: [ 'pipe', 'pipe', 'inherit' ] } ) : null;
	if ( td ) { if ( bits !== 8 ) throw new Error( '--temporal: 8 bits only' ); td.stdout.pipe( ff.stdin ); }
	const sink = td ? td.stdin : ff.stdin;
	// K frames asked for at once, written in order
	const inflight = new Map(), t0 = Date.now(), workersSeen = new Map();
	let next = job.f0, got = 0;
	const ask = n => inflight.set( n, fetchFrame( job.id, n ) );
	for ( let n = job.f0; n < Math.min( job.f1, job.f0 + K ); ++ n ) ask( n );
	try {

		while ( next < job.f1 ) {

			const f = await inflight.get( next );
			inflight.delete( next );
			if ( next + K < job.f1 ) ask( next + K );
			if ( f.data.length !== job.bytes ) throw new Error( `frame ${ next }: ${ f.data.length } bytes, expected ${ job.bytes }` );
			if ( flags.frames ) spawnSync( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', bits === 10 ? 'rgb48le' : 'rgb24', '-s', size, '-i', '-', '-frames:v', '1',
				'-pix_fmt', bits === 10 ? 'rgb48be' : 'rgb24', path.join( flags.frames, `${ String( next ).padStart( 5, '0' ) }.png` ) ], { input: f.data } );
			if ( ! sink.write( f.data ) ) await new Promise( r => sink.once( 'drain', r ) );
			workersSeen.set( f.worker, ( workersSeen.get( f.worker ) ?? 0 ) + 1 );
			++ next; ++ got;
			const el = ( Date.now() - t0 ) / 1000, left = Math.round( el / got * ( job.f1 - next ) );
			process.stdout.write( `\r${ got }/${ job.f1 - job.f0 } frames, ${ ( el / got ).toFixed( 1 ) } s/frame overall (last ${ ( f.ms / 1000 ).toFixed( 0 ) } s on ${ f.worker }), ~${ left } s left    ` );

		}

	} catch ( e ) {

		console.error( `\n${ e.message }` );
		await api( 'DELETE', `/jobs/${ job.id }` ).catch( () => {} );
		td?.kill(); ff.stdin.destroy(); ff.kill(); fs.rmSync( tmp, { recursive: true, force: true } );
		done( 1 );

	}
	sink.end();
	await encoded;
	const el = ( Date.now() - t0 ) / 1000;
	console.log( `\n${ got } frames in ${ el.toFixed( 0 ) } s (${ ( el / got ).toFixed( 1 ) } s/frame overall); by worker: ${ [ ...workersSeen ].map( ( [ w, n ] ) => `${ w } ${ n }` ).join( ', ' ) }` );
	if ( ! flags[ 'no-audio' ] ) {

		// the sound: a raster pass of the range here (the timeline's sound, not the picture's)
		console.log( 'the sound: a raster pass here' );
		const sound = path.join( tmp, 'sound.mp4' );
		const r = spawnSync( process.execPath, [ path.join( root, 'tools', 'render-video.mjs' ), script, '--from', String( job.f0 / fps ), '--to', String( job.f1 / fps ), '--fps', String( fps ),
			'--size', '320x180', '--ss', '1', '--out', sound, ...( flags.query ? [ '--query', flags.query ] : [] ) ], { cwd: root, encoding: 'utf8' } );
		if ( r.status !== 0 ) { console.error( `the sound pass failed: ${ ( r.stderr || r.stdout ).slice( -400 ) }` ); fs.copyFileSync( video, out ); }
		else {

			const m = spawnSync( 'ffmpeg', [ '-y', '-loglevel', 'error', '-i', video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', out ], { encoding: 'utf8' } );
			if ( m.status !== 0 ) throw new Error( `mux: ${ m.stderr }` );

		}

	}
	fs.rmSync( tmp, { recursive: true, force: true } );
	console.log( `wrote ${ out }` );
	done( 0 );

} else if ( cmd === 'still' ) {

	const state = JSON.parse( fs.readFileSync( rest[ 0 ], 'utf8' ) );
	const out = path.resolve( flags.out ?? path.basename( rest[ 0 ] ).replace( /\.json$/i, '' ) + `-pt${ flags.spp ? '-' + flags.spp + 'spp' : '' }.png` );
	const job = await api( 'POST', '/jobs', { type: 'still', state, spp: flags.spp ? Number( flags.spp ) : undefined, size: flags.size, denoise: flags.denoise ? true : undefined } );
	console.log( `job ${ job.id } (still)` );
	const f = await fetchFrame( job.id, 0 );
	fs.mkdirSync( path.dirname( out ), { recursive: true } );
	fs.writeFileSync( out, f.data );
	console.log( `wrote ${ out } (${ ( f.ms / 1000 ).toFixed( 0 ) } s on ${ f.worker })` );
	done( 0 );

} else if ( cmd === 'status' ) { console.log( JSON.stringify( await api( 'GET', '/status' ), null, 1 ) ); done( 0 ); }
else if ( cmd === 'jobs' ) { for ( const j of await api( 'GET', '/jobs' ) ) console.log( `${ j.id }\t${ j.type }\t${ j.status }\trendered ${ j.rendered }/${ j.total }, taken ${ j.taken }\t${ j.elapsed } s${ j.error ? '\t' + j.error : '' }` ); done( 0 ); }
else if ( cmd === 'cancel' ) { console.log( ( await api( 'DELETE', `/jobs/${ rest[ 0 ] }` ) ).status ); done( 0 ); }
else if ( cmd === 'shutdown' ) { console.log( ( await api( 'POST', '/shutdown' ) ).ok ? 'shutting down' : '?' ); done( 0 ); }
else { console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 15 ).join( '\n' ) ); done( cmd ? 1 : 0 ); }

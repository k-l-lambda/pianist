#!/usr/bin/env node
// Offline sound track of a scene script, as its own pass (tools/render-video.mjs renders the
// frames; this does not touch them): opens the page in render mode (src/rendermode.js) like
// render-video.mjs, steps the same simulated clock frame by frame without capturing, and logs the
// phone camera every frame. Then:
//   --room off      the live sound track (src/renderaudio.js renderAudio: what render-video.mjs muxes);
//   --room living | bare   the dry stems (piano without FluidSynth's reverb and chorus, speech) and
//                   the pose log go to tools/spatialise.py (shoebox room of the scene, the image
//                   following the phone; --stereo ab: two omnis 14 cm apart along the phone, or
//                   mono), and its mix comes back through the live output stage (master gain ->
//                   compressor).
// --mux: put the sound track on a rendered video (its frames copied as they are).
//
//   node tools/render-audio.mjs <script.yaml> [--fps 25] [--from 0] [--to <s>] [--out track.wav]
//        [--room living|bare|off] [--stereo ab|mono] [--absorption 1] [--keep]
//        [--mux video.mp4 --video-out out.mp4] [--size 640x360] [--url http://localhost:5184/]
//
// --fps / --from / --to as given to render-video.mjs for the video (same timeline). --keep: keep
// the intermediate files next to --out (<out>.piano.wav, .speech.wav: dry stems; .pose.json;
// .room.wav: the room mix before the output; .room.json: RT60 / DRR report; .room.piano.wav,
// .room.speech.wav). --absorption: times the room's absorption (1.5: living RT60 ~0.4 s).
// Python with pyroomacoustics 0.10.1: ROOM_PYTHON (default ../.venv-audio/bin/python). GPU and
// browser: as render-video.mjs (PLAYWRIGHT_CORE, CHROME, __EGL_VENDOR_LIBRARY_FILENAMES).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- arguments ----
const argv = process.argv.slice( 2 );
const opt = { fps: 25, from: 0, to: null, out: null, size: '640x360', url: null, room: 'living', stereo: 'ab', absorption: 1, keep: false, mux: null, videoOut: null };
let script = null;
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ];
	const val = () => {

		if ( i + 1 >= argv.length ) throw new Error( `${ a }: missing value` );
		return argv[ ++ i ];

	};
	if ( a === '--fps' ) opt.fps = Number( val() );
	else if ( a === '--from' ) opt.from = Number( val() );
	else if ( a === '--to' ) opt.to = Number( val() );
	else if ( a === '--out' ) opt.out = val();
	else if ( a === '--size' ) opt.size = val();
	else if ( a === '--url' ) opt.url = val();
	else if ( a === '--room' ) opt.room = val();
	else if ( a === '--stereo' ) opt.stereo = val();
	else if ( a === '--absorption' ) opt.absorption = Number( val() );
	else if ( a === '--keep' ) opt.keep = true;
	else if ( a === '--mux' ) opt.mux = val();
	else if ( a === '--video-out' ) opt.videoOut = val();
	else if ( a === '-h' || a === '--help' ) {

		console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 26 ).join( '\n' ) );
		process.exit( 0 );

	} else if ( ! a.startsWith( '--' ) && ! script ) script = a;
	else throw new Error( `unknown argument ${ a }` );

}

if ( ! script ) throw new Error( 'usage: node tools/render-audio.mjs <script.yaml> [--fps 25] [--from 0] [--to s] [--out track.wav] [--room living|bare|off] [--stereo ab|mono]' );
const [ W, H ] = opt.size.split( 'x' ).map( Number );
if ( ! ( W > 0 && H > 0 ) ) throw new Error( `--size ${ opt.size }: give WxH` );
if ( ! ( opt.fps > 0 ) || ! ( opt.from >= 0 ) || ( opt.to !== null && ! ( opt.to > opt.from ) ) ) throw new Error( 'bad --fps / --from / --to' );
if ( ! [ 'off', 'living', 'bare' ].includes( opt.room ) ) throw new Error( `--room ${ opt.room }: off, living or bare` );
if ( opt.stereo === 'hrtf' ) throw new Error( '--stereo hrtf: not implemented (ab or mono)' );
if ( ! [ 'ab', 'mono' ].includes( opt.stereo ) ) throw new Error( `--stereo ${ opt.stereo }: ab or mono` );
if ( ! ( opt.absorption > 0 ) ) throw new Error( 'bad --absorption' );
if ( opt.mux && ! opt.videoOut ) throw new Error( '--mux: give --video-out' );
const roomPython = process.env.ROOM_PYTHON ?? path.resolve( root, '../.venv-audio/bin/python' );
if ( opt.room !== 'off' && ! fs.existsSync( roomPython ) ) throw new Error( `--room ${ opt.room }: no Python at ${ roomPython } (set ROOM_PYTHON; needs pyroomacoustics)` );
opt.out ??= path.basename( script ).replace( /\.ya?ml$/i, '' ) + ( opt.room === 'off' ? '.dry' : `.room-${ opt.room }-${ opt.stereo }` ) + '.wav';
fs.mkdirSync( path.dirname( path.resolve( opt.out ) ), { recursive: true } );

// ---- dev server (as render-video.mjs) ----
let vite = null;
async function reachable( url ) {

	try {

		return ( await fetch( url ) ).ok;

	} catch {

		return false;

	}

}

if ( ! opt.url ) {

	opt.url = 'http://localhost:5184/';
	if ( ! await reachable( opt.url ) ) {

		console.log( 'starting vite on :5184' );
		vite = spawn( 'npx', [ 'vite', '--port', '5184', '--strictPort' ], { cwd: root, stdio: 'ignore', detached: true } );
		for ( let i = 0; ! await reachable( opt.url ); ++ i ) {

			if ( i > 120 ) throw new Error( 'vite did not start' );
			await new Promise( r => setTimeout( r, 500 ) );

		}

	}

}

const stopVite = () => {

	if ( vite ) try { process.kill( - vite.pid ); } catch { /* gone */ }
	vite = null;

};
process.on( 'exit', stopVite );
process.on( 'SIGINT', () => process.exit( 130 ) );

// ---- in the page ----
// `n` frames; for each the camera as drawn (operator, drift, shake: the phone) and the user's mouth
// on the person's card (person.js: the card's origin at the phone, mirrored, facing -z): 0.10 m
// below the eyes, 5 cm in front of the card
function stepFrames( n ) {

	const P = window.__pianist, out = [];
	for ( let k = 0; k < n; ++ k ) {

		const s = window.__render.step(), c = P.camera;
		const pose = { t: s.time, frame: s.frame, state: s.state, p: c.position.toArray(), q: c.quaternion.toArray(), mouth: null };
		const h = P.handheld, info = h?.person?.info;
		if ( h?.enabled && h.showPerson && info ) {

			const m = h.person.root.matrixWorld.elements;
			const x = - ( info.eyes[ 0 ] - info.phone[ 0 ] ), y = info.eyes[ 1 ] - info.phone[ 1 ] - 0.10, z = - 0.05;
			pose.mouth = [ 0, 1, 2 ].map( i => m[ i ] * x + m[ 4 + i ] * y + m[ 8 + i ] * z + m[ 12 + i ] );

		}

		out.push( pose );

	}

	return out;

}

// the room's walls and the piano's sources: two points on the soundboard, bass (left) and treble
// (right), from the case's bounds: an upright's stands behind the strings near the back, a grand's
// lies flat under the strings
function sceneSources() {

	const P = window.__pianist, g = P.piano.group, lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	g.updateMatrixWorld( true );
	g.traverse( o => {

		const b = o.isMesh && o.visible && o.geometry && ( o.geometry.boundingBox ?? ( o.geometry.computeBoundingBox(), o.geometry.boundingBox ) );
		if ( ! b || b.isEmpty() ) return;
		for ( let i = 0; i < 8; ++ i ) {

			const v = new b.min.constructor( i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z ).applyMatrix4( o.matrixWorld );
			v.toArray().forEach( ( a, k ) => ( lo[ k ] = Math.min( lo[ k ], a ), hi[ k ] = Math.max( hi[ k ], a ) ) );

		}

	} );
	const at = ( fx, fy, fz ) => [ lo[ 0 ] + fx * ( hi[ 0 ] - lo[ 0 ] ), lo[ 1 ] + fy * ( hi[ 1 ] - lo[ 1 ] ), lo[ 2 ] + fz * ( hi[ 2 ] - lo[ 2 ] ) ];
	const grand = P.settings.style.startsWith( 'grand' );
	const piano = grand ? { bass: at( 0.3, 0.7, 0.35 ), treble: at( 0.7, 0.7, 0.65 ) } : { bass: at( 0.25, 0.65, 0.2 ), treble: at( 0.75, 0.65, 0.2 ) };
	const r = P.room;
	return {
		room: { minX: - r.params.width / 2, maxX: r.params.width / 2, minZ: r.backWallZ, maxZ: r.backWallZ + r.params.depth, height: r.params.height },
		sources: { piano: { ...piano, style: P.settings.style, bounds: [ lo, hi ] } },
	};

}

const run = ( cmd, args ) => new Promise( ( ok, fail ) => spawn( cmd, args, { stdio: 'inherit' } )
	.on( 'close', code => code === 0 ? ok() : fail( new Error( `${ path.basename( cmd ) } exited ${ code }` ) ) ) );

// ---- browser ----
const require = createRequire( import.meta.url );
const { chromium } = require( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );
const browser = await chromium.launch( {
	executablePath: process.env.CHROME ?? path.join( os.homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ),
	headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json' },
	args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required' ],
} );
const tmp = fs.mkdtempSync( path.join( os.tmpdir(), 'pianist-audio-' ) );
const base = path.resolve( opt.out ).replace( /\.wav$/i, '' );
const side = name => opt.keep ? `${ base }.${ name }` : path.join( tmp, name );
try {

	const page = await browser.newPage( { viewport: { width: W, height: H }, deviceScaleFactor: 1 } );
	// no hot reload: a source edit during the pass must not reload the page
	await page.addInitScript( () => {

		const WS = window.WebSocket;
		window.WebSocket = function ( url, protocols ) {

			if ( [ protocols ].flat().some( p => p === 'vite-hmr' || p === 'vite-ping' ) ) return Object.assign( new EventTarget(), { readyState: 0, send() {}, close() {} } );
			return new WS( url, protocols );

		};
		Object.assign( window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } );

	} );
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	page.on( 'console', m => m.type() === 'error' && ! /^fluidsynth: /.test( m.text() ) ? console.error( 'page error:', m.text() ) : null );
	// the timeline only: the scene is drawn small (frames are not captured); ss 1
	const hash = new URLSearchParams( { render: script, fps: opt.fps, from: opt.from, ss: 1 } );
	if ( opt.to !== null ) hash.set( 'to', opt.to );
	await page.goto( new URL( '#?' + hash, opt.url ).href, { waitUntil: 'commit' } );
	await page.waitForFunction( () => window.__render, null, { timeout: 120000 } );
	await page.evaluate( () => window.__render.ready );

	// step the clock as render-video.mjs does (frame k at k / fps), in batches
	const t0 = Date.now();
	const first = Math.round( opt.from * opt.fps );
	const last = opt.to !== null ? Math.round( opt.to * opt.fps ) - 1 : Infinity;
	const poses = [];
	let endAt = null;
	for ( let f = first; f <= last; ) {

		const n = Math.min( opt.fps, last - f + 1 );
		const batch = await page.evaluate( stepFrames, n );
		for ( const p of batch ) {

			if ( p.frame !== f ) throw new Error( `frame ${ p.frame }, expected ${ f }` );
			poses.push( { t: p.t, p: p.p, q: p.q, mouth: p.mouth } );
			++ f;
			// no --to: stop 2 s after the script finished (as render-video.mjs)
			if ( opt.to === null && ! p.state ) endAt ??= p.frame + 2 * opt.fps;

		}

		if ( endAt !== null && f > endAt ) break;
		process.stdout.write( `\r${ ( f / opt.fps ).toFixed( 1 ) } s` );

	}

	const frames = poses.length, to = ( first + frames ) / opt.fps;
	console.log( `\n${ frames } frames stepped (${ opt.from }-${ to } s) in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s` );
	const sum = await page.evaluate( () => window.__render.audioSummary() );
	console.log( `sound: ${ sum.events } piano events, recordings: ${ sum.clips.map( c => `${ c.name }@${ c.t.toFixed( 2 ) }s` ).join( ', ' ) || 'none' }` );

	const fetchChunks = async ( fn, from, length ) => {

		const parts = [];
		for ( let i = from, size = 4 << 20; i < from + length; i += size ) parts.push( await page.evaluate( ( [ fn, i, n ] ) => window.__render[ fn ]( i, n ), [ fn, i, Math.min( size, from + length - i ) ] ) );
		return Buffer.from( parts.join( '' ), 'base64' );

	};
	const ta = Date.now();
	let res;
	if ( opt.room === 'off' ) {

		// the live sound track, as render-video.mjs muxes it
		res = await page.evaluate( t => window.__render.audio( t ), to );
		fs.writeFileSync( opt.out, await fetchChunks( 'wavChunk', 0, res.length ) );
		if ( opt.keep ) {		// and its dry stems (FluidSynth's reverb and chorus as live), to compare

			const st = await page.evaluate( t => window.__render.stems( t, true ), to );
			fs.writeFileSync( side( 'piano.wav' ), await fetchChunks( 'roomChunk', 0, st.piano ) );
			fs.writeFileSync( side( 'speech.wav' ), await fetchChunks( 'roomChunk', st.piano, st.speech ) );

		}

	} else {

		const st = await page.evaluate( t => window.__render.stems( t, false ), to );
		const stems = { piano: side( 'piano.wav' ), speech: side( 'speech.wav' ) };
		fs.writeFileSync( stems.piano, await fetchChunks( 'roomChunk', 0, st.piano ) );
		fs.writeFileSync( stems.speech, await fetchChunks( 'roomChunk', st.piano, st.speech ) );
		// voices elsewhere than the phone holder's mouth (script audio: position / facing)
		const voices = [];
		let at = st.piano + st.speech;
		for ( const [ k, v ] of st.voices.entries() ) {

			const file = side( `voice${ k }.wav` );
			fs.writeFileSync( file, await fetchChunks( 'roomChunk', at, v.length ) );
			at += v.length;
			voices.push( { file, position: v.position, facing: v.facing } );

		}

		if ( voices.length ) fs.writeFileSync( side( 'voices.json' ), JSON.stringify( voices, null, 1 ) );
		const pose = side( 'pose.json' ), mix = side( 'room.wav' );
		fs.writeFileSync( pose, JSON.stringify( { fps: opt.fps, ...await page.evaluate( sceneSources ), frames: poses } ) );
		const args = [ path.join( root, 'tools/spatialise.py' ), '--piano', stems.piano, '--speech', stems.speech, '--pose', pose, '--out', mix,
			'--room', opt.room, '--stereo', opt.stereo, '--absorption', String( opt.absorption ), '--report', side( 'room.json' ) ];
		if ( voices.length ) args.push( '--voices', side( 'voices.json' ) );
		if ( opt.keep ) args.push( '--stems', side( 'room' ) );
		await run( roomPython, args );
		// back through the live output stage
		const b64 = fs.readFileSync( mix ).toString( 'base64' );
		await page.evaluate( () => window.__render.mixBegin() );
		for ( let i = 0, size = 4 << 20; i < b64.length; i += size ) await page.evaluate( c => window.__render.mixChunk( c ), b64.slice( i, i + size ) );
		res = await page.evaluate( () => window.__render.mixMaster() );
		fs.writeFileSync( opt.out, await fetchChunks( 'roomChunk', 0, res.length ) );

	}

	console.log( `sound track: room ${ opt.room }${ opt.room !== 'off' ? `, ${ opt.stereo }` : '' }, peak ${ res.peak.toFixed( 3 ) }${ res.peak > 1 ? ', clipped' : '' }, ${ ( ( Date.now() - ta ) / 1000 ).toFixed( 1 ) } s` );
	console.log( `wrote ${ path.resolve( opt.out ) }` );

	if ( opt.mux ) {

		// the video's frames as they are, this sound track for its length
		const probe = await new Promise( ( ok, fail ) => {

			const p = spawn( 'ffprobe', [ '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', opt.mux ] );
			let s = '';
			p.stdout.on( 'data', d => s += d );
			p.on( 'close', code => code === 0 ? ok( Number( s ) ) : fail( new Error( `ffprobe exited ${ code }` ) ) );

		} );
		await run( 'ffmpeg', [ '-y', '-loglevel', 'error', '-i', opt.mux, '-i', opt.out, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-af', 'apad', '-t', String( probe ), '-movflags', '+faststart', opt.videoOut ] );
		console.log( `wrote ${ path.resolve( opt.videoOut ) }` );

	}

} finally {

	await browser.close();
	fs.rmSync( tmp, { recursive: true, force: true } );
	stopVite();

}

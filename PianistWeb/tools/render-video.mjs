#!/usr/bin/env node
// Offline video render of a scene script (src/rendermode.js): opens the page in headless Chrome
// on the GPU with #?render=<script>, steps it frame by frame on the simulated clock, captures every
// frame, renders the sound track offline in the page (src/renderaudio.js) and encodes with ffmpeg.
//
//   node tools/render-video.mjs <script.yaml> [--fps 25] [--from 0] [--to <s>] [--out out.mp4]
//        [--size 1280x720] [--ss 2] [--url http://localhost:5184/] [--no-audio] [--crf 18]
//        [--watermark "opacity=0.06,right=60,bottom=60,height=96" | off]
//
// --watermark: the klstudio.png mark drawn into every frame; defaults as on the page (src/main.js
// WATERMARK: bottom right, 60 px in, opacity 0.06); keys opacity, right, bottom, height (px at
// 1080 lines, scaled) or x (its centre at that fraction of the width), e.g. the premiere's
// "opacity=0.12,x=0.75,bottom=64"; `off` for none.
//
// <script>: a name in public/scripts/, a path from the site root, or a URL. --to defaults to the
// end of the script. --ss: render scale (pixel ratio; the frame is drawn at size x ss and the
// capture downsamples it). --url: a running dev server (`npx vite --port 5184 --strictPort`);
// without one the driver starts vite on 5184 itself and stops it at the end.
//
// GPU (headless Chrome otherwise falls back to SwiftShader): needs playwright-core and the
// Playwright chromium build, plus an EGL vendor file for the NVIDIA driver:
//   PLAYWRIGHT_CORE   playwright-core module dir   (default: /tmp/pianist-tools/node_modules/playwright-core)
//   CHROME            chrome binary                (default: ~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome)
//   __EGL_VENDOR_LIBRARY_FILENAMES  EGL vendor json (default: /tmp/pianist-tools/nvidia_egl.json, i.e.
//                     {"file_format_version":"1.0.0","ICD":{"library_path":"libEGL_nvidia.so.0"}})

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- arguments ----
const argv = process.argv.slice( 2 );
const opt = { fps: 25, from: 0, to: null, out: null, size: '1280x720', ss: 2, url: null, audio: true, crf: 18 };
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
	else if ( a === '--ss' ) opt.ss = Number( val() );
	else if ( a === '--url' ) opt.url = val();
	else if ( a === '--crf' ) opt.crf = Number( val() );
	else if ( a === '--no-audio' ) opt.audio = false;
	else if ( a === '--watermark' ) opt.watermark = val();
	else if ( a === '-h' || a === '--help' ) {

		console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 26 ).join( '\n' ) );
		process.exit( 0 );

	} else if ( ! a.startsWith( '--' ) && ! script ) script = a;
	else throw new Error( `unknown argument ${ a }` );

}

if ( ! script ) throw new Error( 'usage: node tools/render-video.mjs <script.yaml> [--fps 25] [--from 0] [--to s] [--out out.mp4] [--size WxH]' );
const [ W, H ] = opt.size.split( 'x' ).map( Number );
if ( ! ( W > 0 && H > 0 ) || W % 2 || H % 2 ) throw new Error( `--size ${ opt.size }: give even WxH` );
if ( ! ( opt.fps > 0 ) || ! ( opt.from >= 0 ) || ( opt.to !== null && ! ( opt.to > opt.from ) ) ) throw new Error( 'bad --fps / --from / --to' );
opt.out ??= path.basename( script ).replace( /\.ya?ml$/i, '' ) + '.mp4';
fs.mkdirSync( path.dirname( path.resolve( opt.out ) ), { recursive: true } );

// ---- dev server ----
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

// ---- browser ----
const require = createRequire( import.meta.url );
const { chromium } = require( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );
const browser = await chromium.launch( {
	executablePath: process.env.CHROME ?? path.join( os.homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ),
	headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json' },
	args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required' ],
} );
const tmp = fs.mkdtempSync( path.join( os.tmpdir(), 'pianist-render-' ) );
let ffmpeg = null;
try {

	const page = await browser.newPage( { viewport: { width: W, height: H }, deviceScaleFactor: 1 } );
	// no hot reload: a source edit during the render must not reload the page (it did, once)
	await page.addInitScript( () => {

		const WS = window.WebSocket;
		window.WebSocket = function ( url, protocols ) {

			if ( [ protocols ].flat().some( p => p === 'vite-hmr' || p === 'vite-ping' ) ) return Object.assign( new EventTarget(), { readyState: 0, send() {}, close() {} } );
			return new WS( url, protocols );

		};
		Object.assign( window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } );

	} );
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	// (the offline FluidSynth logs harmless stub / preset notes while loading the soundfont)
	page.on( 'console', m => ( m.type() === 'error' || m.type() === 'warning' ) && ! /^fluidsynth: /.test( m.text() ) ? console.error( `page ${ m.type() }:`, m.text() ) : null );
	const hash = new URLSearchParams( { render: script, fps: opt.fps, from: opt.from, ss: opt.ss } );
	if ( opt.to !== null ) hash.set( 'to', opt.to );
	if ( opt.watermark ) hash.set( 'wm', opt.watermark );
	await page.goto( new URL( '#?' + hash, opt.url ).href, { waitUntil: 'commit' } );
	await page.waitForFunction( () => window.__render, null, { timeout: 120000 } );
	const info = await page.evaluate( () => window.__render.ready );
	const gl = await page.evaluate( () => {

		const r = window.__pianist.renderer.getContext(), ext = r.getExtension( 'WEBGL_debug_renderer_info' );
		return ext ? r.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : '?';

	} );
	console.log( `page ready: drawing ${ info.width }x${ info.height }, captured ${ W }x${ H }, ${ opt.fps } fps, GPU: ${ gl }` );
	if ( /swiftshader|llvmpipe/i.test( gl ) ) console.warn( 'warning: software GL (check __EGL_VENDOR_LIBRARY_FILENAMES)' );

	// end: --to, else when the script has finished (and its sound has rung out a little)
	const first = Math.round( opt.from * opt.fps );
	const last = opt.to !== null ? Math.round( opt.to * opt.fps ) - 1 : Infinity;

	// frames: PNG screenshots piped to ffmpeg (video only; the sound is muxed afterwards)
	const video = opt.audio ? path.join( tmp, 'video.mp4' ) : opt.out;
	ffmpeg = spawn( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String( opt.fps ), '-c:v', 'png', '-i', '-',
		'-c:v', 'libx264', '-preset', 'slow', '-crf', String( opt.crf ), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video ], { stdio: [ 'pipe', 'inherit', 'inherit' ] } );
	const encoded = new Promise( ( ok, fail ) => ffmpeg.on( 'close', code => code === 0 ? ok() : fail( new Error( `ffmpeg exited ${ code }` ) ) ) );
	const t0 = Date.now();
	let frames = 0, stepMs = 0, shotMs = 0, endAt = null;
	for ( let f = first; f <= last; ++ f ) {

		const s = await page.evaluate( () => window.__render.step() );
		if ( s.frame !== f ) throw new Error( `frame ${ s.frame }, expected ${ f }` );
		stepMs += s.ms;
		const ts = Date.now();
		// the canvas itself (__render.frame), not a compositor screenshot (Page.captureScreenshot:
		// now and then a frame came before the canvas was composited, the page background instead)
		const png = Buffer.from( await page.evaluate( ( [ w, h ] ) => window.__render.frame( w, h ), [ W, H ] ), 'base64' );
		shotMs += Date.now() - ts;
		if ( ! ffmpeg.stdin.write( png ) ) await new Promise( r => ffmpeg.stdin.once( 'drain', r ) );
		++ frames;
		if ( frames % opt.fps === 0 ) {

			const el = ( Date.now() - t0 ) / 1000;
			process.stdout.write( `\r${ s.time.toFixed( 2 ) } s, ${ frames } frames, ${ ( 1000 * el / frames ).toFixed( 0 ) } ms/frame  ` );

		}

		// no --to: stop 2 s after the script finished
		if ( opt.to === null && ! s.state ) {

			endAt ??= f + 2 * opt.fps;
			if ( f >= endAt ) break;

		}

	}

	ffmpeg.stdin.end();
	await encoded;
	ffmpeg = null;
	const el = ( Date.now() - t0 ) / 1000;
	const to = ( first + frames ) / opt.fps;
	console.log( `\n${ frames } frames (${ opt.from }-${ to } s) in ${ el.toFixed( 1 ) } s: ${ ( 1000 * el / frames ).toFixed( 0 ) } ms/frame (draw ${ ( stepMs / frames ).toFixed( 0 ) }, capture ${ ( shotMs / frames ).toFixed( 0 ) })` );

	if ( opt.audio ) {

		const sum = await page.evaluate( () => window.__render.audioSummary() );
		console.log( `sound: ${ sum.events } piano events, recordings: ${ sum.clips.map( c => `${ c.name }@${ c.t.toFixed( 2 ) }s` ).join( ', ' ) || 'none' }` );
		const { length, peak } = await page.evaluate( t => window.__render.audio( t ), to );
		const parts = [];
		for ( let i = 0, size = 4 << 20; i < length; i += size ) parts.push( await page.evaluate( ( [ i, size ] ) => window.__render.wavChunk( i, size ), [ i, size ] ) );
		const wav = path.join( tmp, 'audio.wav' );
		fs.writeFileSync( wav, Buffer.from( parts.join( '' ), 'base64' ) );
		console.log( `sound track rendered (peak ${ peak.toFixed( 3 ) }${ peak > 1 ? ', clipped' : '' })` );
		await new Promise( ( ok, fail ) => spawn( 'ffmpeg', [ '-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-af', 'apad', '-t', String( frames / opt.fps ), '-movflags', '+faststart', opt.out ], { stdio: 'inherit' } )
			.on( 'close', code => code === 0 ? ok() : fail( new Error( `ffmpeg mux exited ${ code }` ) ) ) );

	}

	console.log( `wrote ${ path.resolve( opt.out ) }` );

} finally {

	ffmpeg?.stdin.end();
	await browser.close();
	fs.rmSync( tmp, { recursive: true, force: true } );
	stopVite();

}

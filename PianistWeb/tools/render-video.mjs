#!/usr/bin/env node
// Offline video render of a scene script (src/rendermode.js): opens the page in headless Chrome
// on the GPU with #?render=<script>, steps it frame by frame on the simulated clock, captures every
// frame, renders the sound track offline in the page (src/renderaudio.js) and encodes with ffmpeg.
//
//   node tools/render-video.mjs <script.yaml> [--fps 25] [--from 0] [--to <s>] [--out out.mp4]
//        [--size 1280x720] [--ss 2] [--url http://localhost:5184/] [--no-audio] [--crf 18]
//        [--watermark "opacity=0.06,right=60,bottom=60,height=96" | off]
//        [--subframes 1] [--shutter 0.5] [--bits 8|10] [--no-dither] [--filter 1.25] [--hq] [--legacy]
//        [--query "style=grand-white&preset=Night"] [--frames dir] [--pt 1024]
//
// The frame (src/offline.js): drawn at size x ss in linear light, resolved to the size there (a
// Blackman-Harris window, --filter its radius in output px), tone mapped, then quantised with dither
// and sent raw to ffmpeg, encoded BT.709 (tagged). --bits 10: 10-bit HEVC (x265 main10, hvc1), else
// 8-bit H.264. --subframes N: N renders a frame across the shutter (--shutter: the part of the frame
// it is open, 0.5 = 180°), the camera jittered by sub-pixels between them, added in linear light:
// motion blur and finer anti-aliasing, N times the drawing time. --hq: the offline quality profile
// (the mirrors at the frame's size, a 512 px probe, 32 AO samples). --legacy: the old capture (tone
// mapped on the canvas, scaled by drawImage, PNG, untagged BT.601), for comparison. --query: page
// parameters (style, preset, ...). --frames dir: also each frame as PNG there (from the raw pixels).
// --pt N: path traced, N samples per pixel a frame (src/main.js stepPT: the raster's state, the path
// tracer's image; its samples are the anti-aliasing: --ss 1 and one sub-frame unless given).
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

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- arguments ----
const argv = process.argv.slice( 2 );
const opt = { fps: 25, from: 0, to: null, out: null, size: '1280x720', ss: 2, url: null, audio: true, crf: null, subframes: 1, shutter: 0.5, bits: 8, dither: true, filter: 1.25, hq: false, legacy: false, query: '', frames: null };
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
	else if ( a === '--subframes' ) opt.subframes = Number( val() );
	else if ( a === '--shutter' ) opt.shutter = Number( val() );
	else if ( a === '--bits' ) opt.bits = Number( val() );
	else if ( a === '--no-dither' ) opt.dither = false;
	else if ( a === '--filter' ) opt.filter = Number( val() );
	else if ( a === '--hq' ) opt.hq = true;
	else if ( a === '--legacy' ) opt.legacy = true;
	else if ( a === '--query' ) opt.query = val();
	else if ( a === '--frames' ) opt.frames = val();
	else if ( a === '--pt' ) opt.pt = Number( val() );
	else if ( a === '--no-audio' ) opt.audio = false;
	else if ( a === '--watermark' ) opt.watermark = val();
	else if ( a === '-h' || a === '--help' ) {

		console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 40 ).join( '\n' ) );
		process.exit( 0 );

	} else if ( ! a.startsWith( '--' ) && ! script ) script = a;
	else throw new Error( `unknown argument ${ a }` );

}

if ( ! script ) throw new Error( 'usage: node tools/render-video.mjs <script.yaml> [--fps 25] [--from 0] [--to s] [--out out.mp4] [--size WxH]' );
const [ W, H ] = opt.size.split( 'x' ).map( Number );
if ( opt.pt ) { if ( ! argv.includes( '--ss' ) ) opt.ss = 1; if ( ! argv.includes( '--subframes' ) ) opt.subframes = 1; }
if ( ! [ 8, 10 ].includes( opt.bits ) ) throw new Error( `--bits ${ opt.bits }: 8 or 10` );
if ( opt.legacy && opt.bits !== 8 ) throw new Error( '--legacy: 8 bits only' );
opt.crf ??= opt.bits === 10 ? 20 : 18;		// (x265's scale sits a little above x264's for the same quality)
if ( opt.frames ) fs.mkdirSync( opt.frames, { recursive: true } );
if ( ! ( W > 0 && H > 0 ) || W % 2 || H % 2 ) throw new Error( `--size ${ opt.size }: give even WxH` );
if ( ! ( opt.fps > 0 ) || ! ( opt.from >= 0 ) || ( opt.to !== null && ! ( opt.to > opt.from ) ) ) throw new Error( 'bad --fps / --from / --to' );
opt.out ??= path.basename( script ).replace( /\.ya?ml$/i, '' ) + '.mp4';
fs.mkdirSync( path.dirname( path.resolve( opt.out ) ), { recursive: true } );

/** A raw frame (rgb24 / rgb48le, or a PNG already: --legacy) as a PNG file (--frames). */
function savePNG( file, px ) {

	if ( opt.legacy ) { fs.writeFileSync( file, px ); return; }
	const r = spawnSync( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', opt.bits === 10 ? 'rgb48le' : 'rgb24', '-s', `${ W }x${ H }`, '-i', '-', '-frames:v', '1', '-pix_fmt', opt.bits === 10 ? 'rgb48be' : 'rgb24', file ], { input: px } );
	if ( r.status !== 0 ) throw new Error( `PNG ${ file }: ${ r.stderr }` );

}

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
	const hash = new URLSearchParams( { render: script, fps: opt.fps, from: opt.from, ss: opt.ss, sub: opt.subframes, shutter: opt.shutter, bits: opt.bits, dither: opt.dither ? 1 : 0, filter: opt.filter, hq: opt.hq ? 1 : 0, legacy: opt.legacy ? 1 : 0 } );
	if ( opt.to !== null ) hash.set( 'to', opt.to );
	if ( opt.watermark ) hash.set( 'wm', opt.watermark );
	if ( opt.pt ) hash.set( 'pt', opt.pt );
	const base = new URL( opt.url );
	if ( opt.query ) base.search = opt.query;
	await page.goto( new URL( '#?' + hash, base ).href, { waitUntil: 'commit' } );
	await page.waitForFunction( () => window.__render, null, { timeout: 120000 } );
	const info = await page.evaluate( () => window.__render.ready );
	const gl = await page.evaluate( () => {

		const r = window.__pianist.renderer.getContext(), ext = r.getExtension( 'WEBGL_debug_renderer_info' );
		return ext ? r.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : '?';

	} );
	console.log( `page ready: drawing ${ info.width }x${ info.height }, captured ${ W }x${ H }, ${ opt.fps } fps, ${ opt.subframes } sub-frame(s), ${ opt.legacy ? 'legacy PNG capture' : `${ opt.bits }-bit${ opt.dither ? ' dithered' : '' }` }${ opt.hq ? ', hq' : '' }${ opt.pt ? `, path traced ${ opt.pt } spp` : '' }, GPU: ${ gl }` );
	if ( /swiftshader|llvmpipe/i.test( gl ) ) console.warn( 'warning: software GL (check __EGL_VENDOR_LIBRARY_FILENAMES)' );

	// end: --to, else when the script has finished (and its sound has rung out a little)
	const first = Math.round( opt.from * opt.fps );
	const last = opt.to !== null ? Math.round( opt.to * opt.fps ) - 1 : Infinity;

	// frames: raw pixels piped to ffmpeg (video only; the sound is muxed afterwards): sRGB, full range
	// in, BT.709 limited out, tagged so players read it so. --legacy: PNGs, as before (no matrix given:
	// BT.601, untagged)
	const video = opt.audio ? path.join( tmp, 'video.mp4' ) : opt.out;
	const input = opt.legacy ? [ '-f', 'image2pipe', '-framerate', String( opt.fps ), '-c:v', 'png', '-i', '-' ]
		: [ '-f', 'rawvideo', '-pix_fmt', opt.bits === 10 ? 'rgb48le' : 'rgb24', '-s', `${ W }x${ H }`, '-framerate', String( opt.fps ), '-i', '-' ];
	const tags = [ '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv' ];
	const encode = opt.legacy ? [ '-c:v', 'libx264', '-preset', 'slow', '-crf', String( opt.crf ), '-pix_fmt', 'yuv420p' ]
		: [ '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int', ...( opt.bits === 10
			? [ '-c:v', 'libx265', '-preset', 'slow', '-crf', String( opt.crf ), '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709' ]
			: [ '-c:v', 'libx264', '-preset', 'slow', '-crf', String( opt.crf ), '-pix_fmt', 'yuv420p' ] ), ...tags ];
	ffmpeg = spawn( 'ffmpeg', [ '-y', '-loglevel', 'error', ...input, ...encode, '-movflags', '+faststart', video ], { stdio: [ 'pipe', 'inherit', 'inherit' ] } );
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
		const px = Buffer.from( await page.evaluate( ( [ w, h ] ) => window.__render.frame( w, h ), [ W, H ] ), 'base64' );
		shotMs += Date.now() - ts;
		if ( ! opt.legacy && px.length !== W * H * 3 * ( opt.bits === 10 ? 2 : 1 ) ) throw new Error( `frame ${ f }: ${ px.length } bytes, expected ${ W * H * 3 * ( opt.bits === 10 ? 2 : 1 ) }` );
		if ( opt.frames ) savePNG( path.join( opt.frames, `${ String( f ).padStart( 5, '0' ) }.png` ), px );
		if ( ! ffmpeg.stdin.write( px ) ) await new Promise( r => ffmpeg.stdin.once( 'drain', r ) );
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
		await new Promise( ( ok, fail ) => spawn( 'ffmpeg', [ '-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...( opt.bits === 10 ? [ '-tag:v', 'hvc1' ] : [] ), '-c:a', 'aac', '-b:a', '256k', '-af', 'apad', '-t', String( frames / opt.fps ), '-movflags', '+faststart', opt.out ], { stdio: 'inherit' } )
			.on( 'close', code => code === 0 ? ok() : fail( new Error( `ffmpeg mux exited ${ code }` ) ) ) );

	}

	console.log( `wrote ${ path.resolve( opt.out ) }` );

} finally {

	ffmpeg?.stdin.end();
	await browser.close();
	fs.rmSync( tmp, { recursive: true, force: true } );
	stopVite();

}

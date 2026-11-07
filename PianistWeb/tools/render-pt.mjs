#!/usr/bin/env node
// Offline path-traced render of a saved scene state (the GUI's "Path tracing / Download scene state",
// src/scenestate.js): opens the page in headless Chrome on the GPU, sets the scene from the state, path
// traces its view (src/ptsnapshot.js, exclusive: the page draws no frames of its own meanwhile) and
// writes the image as PNG.
//
//   node tools/render-pt.mjs <state.json> [--spp 1024] [--out out.png] [--size 1920x1080]
//        [--marks 64,256] [--bounces 8] [--url http://localhost:5184/]
//
// --spp: samples per pixel (default: the state's). --size: the image (default: the view's size when the
// state was saved; another aspect widens or narrows the view). --marks: also the image at these spp
// (<out>-<n>spp.png). --url: a running dev server; without one the driver starts vite on 5184 itself.
// GPU: as tools/render-video.mjs (PLAYWRIGHT_CORE, CHROME, __EGL_VENDOR_LIBRARY_FILENAMES).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const argv = process.argv.slice( 2 ), opt = { spp: null, out: null, size: null, marks: [], bounces: null, url: null };
let file = null;
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], val = () => { if ( i + 1 >= argv.length ) throw new Error( `${ a }: missing value` ); return argv[ ++ i ]; };
	if ( a === '--spp' ) opt.spp = Number( val() );
	else if ( a === '--out' ) opt.out = val();
	else if ( a === '--size' ) opt.size = val();
	else if ( a === '--marks' ) opt.marks = val().split( ',' ).map( Number ).filter( n => n > 0 );
	else if ( a === '--bounces' ) opt.bounces = Number( val() );
	else if ( a === '--url' ) opt.url = val();
	else if ( a === '-h' || a === '--help' ) { console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 14 ).join( '\n' ) ); process.exit( 0 ); }
	else if ( ! a.startsWith( '--' ) && ! file ) file = a;
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! file ) throw new Error( 'usage: node tools/render-pt.mjs <state.json> [--spp N] [--out file.png] [--size WxH]' );
const state = JSON.parse( fs.readFileSync( file, 'utf8' ) );
const spp = opt.spp ?? state.render?.ptSamples ?? 1024;
const [ W, H ] = ( opt.size ?? `${ state.camera?.width ?? 1280 }x${ state.camera?.height ?? 720 }` ).split( 'x' ).map( Number );
if ( ! ( W > 0 && H > 0 ) || ! ( spp > 0 ) ) throw new Error( 'bad --size / --spp' );
if ( opt.bounces ) state.render = { ...state.render, ptBounces: opt.bounces };
opt.out ??= path.basename( file ).replace( /\.json$/i, '' ) + `-${ spp }spp.png`;
fs.mkdirSync( path.dirname( path.resolve( opt.out ) ), { recursive: true } );

// ---- dev server ----
let vite = null;
const reachable = async url => { try { return ( await fetch( url ) ).ok; } catch { return false; } };
if ( ! opt.url ) {

	opt.url = 'http://localhost:5184/';
	if ( ! await reachable( opt.url ) ) {

		console.log( 'starting vite on :5184' );
		vite = spawn( 'npx', [ 'vite', '--port', '5184', '--strictPort' ], { cwd: root, stdio: 'ignore', detached: true } );
		for ( let i = 0; ! await reachable( opt.url ); ++ i ) { if ( i > 120 ) throw new Error( 'vite did not start' ); await new Promise( r => setTimeout( r, 500 ) ); }

	}

}
const stopVite = () => { if ( vite ) try { process.kill( - vite.pid ); } catch { /* gone */ } vite = null; };
process.on( 'exit', stopVite );
process.on( 'SIGINT', () => process.exit( 130 ) );

// ---- browser ----
const require = createRequire( import.meta.url );
const { chromium } = require( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );
const browser = await chromium.launch( {
	executablePath: process.env.CHROME ?? path.join( os.homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ),
	headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json' },
	args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist' ],
} );
try {

	const page = await browser.newPage( { viewport: { width: W, height: H }, deviceScaleFactor: 1 } );
	// no hot reload: a source edit during the render must not reload the page
	await page.addInitScript( () => {

		const WS = window.WebSocket;
		window.WebSocket = function ( url, protocols ) { if ( [ protocols ].flat().some( p => p === 'vite-hmr' || p === 'vite-ping' ) ) return Object.assign( new EventTarget(), { readyState: 0, send() {}, close() {} } ); return new WS( url, protocols ); };
		Object.assign( window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } );

	} );
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	page.on( 'console', m => m.type() === 'error' && console.error( 'page error:', m.text() ) );
	const t0 = Date.now(), secs = () => ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 );
	await page.goto( new URL( `#${ state.piano?.style ?? '' }${ state.render?.gi ? '&gi' : '' }`, opt.url ).href );
	await page.waitForFunction( () => window.__pianist?.piano && window.__pianist.applyState, null, { timeout: 180000 } );
	await page.evaluate( st => window.__pianist.applyState( st ), state );
	await page.waitForTimeout( 2500 );		// (a few frames: the probe, the shadows, the shaders)
	const gl = await page.evaluate( () => { const r = window.__pianist.renderer.getContext(), e = r.getExtension( 'WEBGL_debug_renderer_info' ); return e ? r.getParameter( e.UNMASKED_RENDERER_WEBGL ) : '?'; } );
	console.log( `scene set (${ secs() } s): ${ state.piano?.style } in ${ state.venue?.name } (${ state.venue?.preset }), ${ W }x${ H }, ${ spp } spp, GPU: ${ gl }` );
	if ( /swiftshader|llvmpipe/i.test( gl ) ) console.warn( 'warning: software GL (check __EGL_VENDOR_LIBRARY_FILENAMES)' );
	// the camera as saved (its orientation too: a handheld roll), its aspect the image's
	// the camera as saved, its orientation too (a handheld roll: the page's controls would level it), its
	// aspect the image's; the snapshot copies it, traced with no frames of the page's meanwhile
	const ts = Date.now();
	await page.evaluate( ( [ st, spp, W, H ] ) => {

		const P = window.__pianist, c = P.camera.clone(), C = st.camera;
		if ( C ) { c.position.fromArray( C.position ); c.quaternion.fromArray( C.quaternion ); c.fov = C.fov; c.zoom = C.zoom ?? 1; }
		c.aspect = W / H;
		c.updateProjectionMatrix(); c.updateMatrixWorld();
		return P.ptSnapshot.start( { camera: c, samples: spp, exclusive: true } );

	}, [ state, spp, W, H ] );
	if ( ! await page.evaluate( () => window.__pianist.ptSnapshot.running ) ) throw new Error( 'the snapshot did not start' );
	console.log( `path tracer's scene built in ${ ( ( Date.now() - ts ) / 1000 ).toFixed( 1 ) } s` );
	const tp = Date.now();
	for ( const n of [ ...opt.marks.filter( n => n < spp ).sort( ( a, b ) => a - b ), spp ] ) {

		await page.waitForFunction( n => window.__pianist.ptSnapshot.samples >= n, n, { timeout: 24 * 3600 * 1000, polling: 2000 } );
		const t = ( Date.now() - tp ) / 1000, name = n === spp ? opt.out : opt.out.replace( /\.png$/i, '' ) + `-${ n }spp.png`;
		fs.writeFileSync( name, Buffer.from( await page.evaluate( () => window.__pianist.ptSnapshot.pngBase64() ), 'base64' ) );
		console.log( `${ n } spp at ${ t.toFixed( 0 ) } s (${ ( t / n ).toFixed( 2 ) } s/spp): ${ path.resolve( name ) }` );

	}

} finally {

	await browser.close();
	stopVite();

}

#!/usr/bin/env node
// A render worker of tools/pt-server.mjs: one headless Chrome on one GPU (the server pins it: a user namespace
// with the other /dev/nvidiaN hidden), kept between tasks. Commands on stdin, one JSON object a line; events on
// stdout, alike.
//
//   in   { id, type: 'frame', url, job: { script, fps, size, pt, denoise, ss, sub, bits, dither, filter, hq, wm, query },
//          frame }                 the video frame `frame` (time frame / fps) of `script`: raw rgb24 / rgb48le
//        { id, type: 'still', url, state, size, spp, denoise }              a path-traced still (PNG) of a scene state
//        { type: 'idle', soft, hard }                                       the idle timeouts (s; set by the server)
//        { type: 'exit' }
//   out  { id, ok: true, ms, data (base64), ... } | { id, ok: false, error }   { log }   { state: 'cold' | 'warm' | 'browser' | 'down' }
//
// Nothing is written to disk: the image goes back in the reply (the server holds it until its client has it).
//
// The page stays between frames of one job (the same script and settings): a later frame only steps the timeline
// on (frames undrawn: milliseconds each), so the server deals out frames in increasing order and a worker never
// reloads for the next. An earlier frame or another job: a new page (`from` at that frame).
//
// Idle (no task): after `soft` s the page is closed (its scene, textures, the path tracer's buffers: the GPU's
// memory back, the browser kept), after `hard` s the browser too (its GPU process gone).

import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const require = createRequire( import.meta.url );
const { chromium } = require( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );
const CHROME = process.env.CHROME ?? path.join( os.homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' );
const EGL = process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json';

const send = o => process.stdout.write( JSON.stringify( o ) + '\n' );
const log = s => send( { log: s } );

let browser = null, page = null, session = null, pos = -1;		// session: the page's job key; pos: its next frame
let idle = { soft: 30, hard: 300 }, softT = null, hardT = null, busy = false;
const tellState = () => send( { state: ! browser ? 'down' : ! page ? 'browser' : session ? 'warm' : 'cold' } );

async function launch() {

	if ( browser?.isConnected() ) return;
	browser = await chromium.launch( {
		executablePath: CHROME, headless: true, env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: EGL },
		args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required' ],
	} );
	browser.on( 'disconnected', () => { browser = page = session = null; pos = -1; tellState(); } );
	log( 'browser up' );

}

async function closePage() {

	if ( ! page ) return;
	const p = page; page = session = null; pos = -1;
	await p.close().catch( () => {} );

}

async function closeBrowser() {

	await closePage();
	if ( ! browser ) return;
	const b = browser; browser = null;
	await b.close().catch( () => {} );

}

/** A new page of `width` × `height` at `href`, hot reload off, errors to the log. */
async function openPage( href, width, height ) {

	await closePage();
	await launch();
	page = await browser.newPage( { viewport: { width, height }, deviceScaleFactor: 1 } );
	// no hot reload: an edit of the sources during a render must not reload the page
	await page.addInitScript( () => {

		const WS = window.WebSocket;
		window.WebSocket = function ( url, protocols ) {

			if ( [ protocols ].flat().some( p => p === 'vite-hmr' || p === 'vite-ping' ) ) return Object.assign( new EventTarget(), { readyState: 0, send() {}, close() {} } );
			return new WS( url, protocols );

		};
		Object.assign( window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } );

	} );
	page.on( 'pageerror', e => log( `page error: ${ e.message }` ) );
	page.on( 'console', m => m.type() === 'error' && ! /^fluidsynth: /.test( m.text() ) && log( `page: ${ m.text().slice( 0, 300 ) }` ) );
	await page.goto( href, { waitUntil: 'commit' } );

}

const jobKey = j => JSON.stringify( [ j.script, j.fps, j.size, j.pt, !! j.denoise, j.ss, j.sub, j.bits, j.dither, j.filter, !! j.hq, j.wm ?? null, j.query ?? '' ] );

async function frameTask( { url, job, frame } ) {

	const [ W, H ] = job.size.split( 'x' ).map( Number ), key = jobKey( job );
	if ( session !== key || ! page || frame < pos ) {

		// a page from this frame: render mode, `from` its time
		const hash = new URLSearchParams( { render: job.script, fps: job.fps, from: frame / job.fps, ss: job.ss ?? ( job.pt ? 1 : 2 ), sub: job.sub ?? 1,
			shutter: job.shutter ?? 0.5, bits: job.bits ?? 8, dither: job.dither === false ? 0 : 1, filter: job.filter ?? 1.25, hq: job.hq ? 1 : 0, legacy: 0 } );
		if ( job.wm ) hash.set( 'wm', job.wm );
		if ( job.pt ) hash.set( 'pt', job.pt );
		if ( job.denoise ) hash.set( 'dn', 1 );
		const base = new URL( url );
		if ( job.query ) base.search = job.query;
		const t0 = Date.now();
		await openPage( new URL( '#?' + hash, base ).href, W, H );
		await page.waitForFunction( () => window.__render, null, { timeout: 180000 } );
		await page.evaluate( () => window.__render.ready );
		session = key; pos = frame;
		log( `page for ${ job.script } from frame ${ frame } in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s` );
		tellState();

	}
	// on to the frame without drawing (the timeline only), then draw it
	for ( ; pos < frame; ++ pos ) await page.evaluate( () => window.__render.step( { draw: false } ) );
	const t0 = Date.now();
	const s = await page.evaluate( () => window.__render.step() );
	if ( s.frame !== frame ) throw new Error( `drew frame ${ s.frame }, expected ${ frame }` );
	++ pos;
	const data = await page.evaluate( ( [ w, h ] ) => window.__render.frame( w, h ), [ W, H ] );
	const bytes = Buffer.byteLength( data, 'base64' ), expect = W * H * 3 * ( job.bits === 10 ? 2 : 1 );
	if ( bytes !== expect ) throw new Error( `frame ${ frame }: ${ bytes } bytes, expected ${ expect }` );
	return { ms: Date.now() - t0, time: s.time, playing: s.state, data };

}

async function stillTask( { url, state, size, spp, denoise } ) {

	const [ W, H ] = ( size ?? `${ state.camera?.width ?? 1280 }x${ state.camera?.height ?? 720 }` ).split( 'x' ).map( Number );
	// the app (not render mode): a page of its own, its scene from the state
	if ( session !== 'still' || ! page || page.viewportSize()?.width !== W || page.viewportSize()?.height !== H ) {

		await openPage( new URL( `#${ state.piano?.style ?? '' }`, url ).href, W, H );
		await page.waitForFunction( () => window.__pianist?.piano && window.__pianist.applyState, null, { timeout: 180000 } );
		session = 'still'; pos = -1;
		tellState();

	}
	const st = { ...state, render: { ...state.render, ...( spp ? { ptSamples: spp } : {} ), ...( denoise !== undefined ? { ptDenoise: !! denoise } : {} ) } };
	await page.evaluate( s => window.__pianist.applyState( s ), st );
	await page.waitForTimeout( 2500 );
	const n = spp ?? st.render?.ptSamples ?? 1024, t0 = Date.now();
	await page.evaluate( ( [ st, n, W, H ] ) => {

		const P = window.__pianist, c = P.camera.clone(), C = st.camera;
		if ( C ) { c.position.fromArray( C.position ); c.quaternion.fromArray( C.quaternion ); c.fov = C.fov; c.zoom = C.zoom ?? 1; }
		c.aspect = W / H; c.updateProjectionMatrix(); c.updateMatrixWorld();
		return P.ptSnapshot.start( { camera: c, samples: n, exclusive: true } );

	}, [ st, n, W, H ] );
	await page.waitForFunction( n => window.__pianist.ptSnapshot.samples >= n, n, { timeout: 24 * 3600 * 1000, polling: 2000 } );
	const data = await page.evaluate( () => window.__pianist.ptSnapshot.pngBase64() );
	return { ms: Date.now() - t0, spp: n, data };

}

function armIdle() {

	clearTimeout( softT ); clearTimeout( hardT );
	if ( idle.soft > 0 ) softT = setTimeout( async () => { if ( busy || ! page ) return; await closePage(); log( `idle ${ idle.soft } s: page closed` ); tellState(); }, idle.soft * 1000 );
	if ( idle.hard > 0 ) hardT = setTimeout( async () => { if ( busy || ! browser ) return; await closeBrowser(); log( `idle ${ idle.hard } s: browser closed` ); tellState(); }, idle.hard * 1000 );

}

const rl = readline.createInterface( { input: process.stdin } );
let chain = Promise.resolve();
rl.on( 'line', line => {

	let m;
	try { m = JSON.parse( line ); } catch { return; }
	if ( m.type === 'idle' ) { idle = { soft: Number( m.soft ), hard: Number( m.hard ) }; return; }
	if ( m.type === 'exit' ) { chain = chain.then( async () => { await closeBrowser(); process.exit( 0 ); } ); return; }
	// tasks one at a time, in order
	chain = chain.then( async () => {

		busy = true; clearTimeout( softT ); clearTimeout( hardT );
		try {

			const r = m.type === 'frame' ? await frameTask( m ) : m.type === 'still' ? await stillTask( m ) : ( () => { throw new Error( `unknown task ${ m.type }` ); } )();
			send( { id: m.id, ok: true, ...r } );

		} catch ( e ) {

			// a page in doubt after an error: a new one next time
			await closePage();
			send( { id: m.id, ok: false, error: String( e?.message ?? e ).split( '\n' )[ 0 ] } );

		} finally {

			busy = false; armIdle(); tellState();

		}

	} );

} );
rl.on( 'close', async () => { await closeBrowser(); process.exit( 0 ); } );
tellState();

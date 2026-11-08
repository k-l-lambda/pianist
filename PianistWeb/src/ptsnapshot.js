// A path-traced snapshot of the view (the GUI's "Path tracing snapshot"): the scene and the camera as
// they are at the click, path traced into a small window in the corner while the page goes on in real
// time; clicking the window opens the full image (a blob URL) in a new tab.
//
// At the click: the camera copied (frozen), the venues in their path-tracing state for a moment (their
// area lights, emitting skies, transmissive glass, the roll hidden: main.js's enterPT / leavePT), the
// path tracer's scene built from that (it keeps its own copy of the geometry, materials, lights and
// environment), then the venues back to real time. Each frame after: one tile of a sample, until the
// samples asked for; the window refreshed about once a second.

import * as THREE from 'three';
import { buildScene } from './pathtracer.js';
import { PTPost, ptLens } from './ptpost.js';
import { PTDenoiser } from './ptdenoise.js';

const nextFrame = () => new Promise( r => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

export class PTSnapshot {

	/**
	 * `pathTracer`: src/pathtracer.js's (its `pt`, a WebGLPathTracer: shared with the live path tracing).
	 * `hooks`: { enterPT(), leavePT(), isLive(): the page path traces itself, samples(), bounces(), changed(): the live path tracer must rebuild,
 *   post(): PTPost's params (the venue's saturation and bloom, the dither), lens( camera ): { fStop, focus } (fStop 0: a pinhole),
 *   denoise(): the path tracer's buffers and the spatial denoiser on (ptdenoise.js) }.
	 */
	constructor( renderer, pathTracer, scene, camera, hooks ) {

		Object.assign( this, { renderer, pathTracer, scene, camera, hooks } );
		this.running = false;
		this.run = 0;
		this.post = new PTPost();
		this.denoiser = new PTDenoiser();		// (the raster composer's finish: saturation, bloom, tone mapping, dither: ptpost.js)
		this.target = new THREE.WebGLRenderTarget( 1, 1, { depthBuffer: false } );
		this.full = document.createElement( 'canvas' );		// (the full image, at the path tracer's size)
		this._buildUI();

	}

	_buildUI() {

		const panel = this.panel = document.createElement( 'div' );
		panel.id = 'ptshot';
		panel.hidden = true;
		panel.innerHTML = `
			<button type="button" class="view" aria-label="Open the full path-traced image in a new tab" title="Open the full image in a new tab"><canvas width="320" height="180"></canvas></button>
			<div class="bar"><span class="status" aria-live="polite"></span><span class="spp" aria-hidden="true"></span><button type="button" class="close" aria-label="Close the path-traced snapshot" title="Close">×</button></div>`;
		document.body.appendChild( panel );
		this.thumb = panel.querySelector( 'canvas' );
		this.statusEl = panel.querySelector( '.status' );
		this.sppEl = panel.querySelector( '.spp' );
		panel.querySelector( '.view' ).addEventListener( 'click', () => this.openFull() );
		panel.querySelector( '.close' ).addEventListener( 'click', () => this.close() );

	}

	_status( text, spp = '' ) {

		if ( this.statusEl.textContent !== text ) this.statusEl.textContent = text;		// (the live region: on a change of phase only)
		this.sppEl.textContent = spp;

	}

	/**
	 * Start (or restart) a snapshot of the view as it is now. `camera`: this one instead of the page's
	 * (copied); `samples`: instead of the GUI's; `exclusive`: the page draws no frames of its own
	 * meanwhile, every tile a frame is the path tracer's (offline: tools/render-pt.mjs). Resolves when
	 * the scene is built; `this.done` when the samples are in.
	 */
	async start( { camera = null, samples = null, exclusive = false } = {} ) {

		this.stop();
		const run = ++ this.run;
		this.panel.hidden = false;
		const pt = this.pathTracer.pt;
		if ( this.hooks.isLive() ) {

			// the page path traces already: its own image, as it converges
			this.live = true;
			this.running = true;
			this.t0 = performance.now();
			this._status( 'Path traced (live)' );
			this._refresh();
			return;

		}
		this.live = false;
		this._status( 'Preparing the scene…', '' );
		await nextFrame(); await nextFrame();		// (the panel drawn before the scene's build, which blocks a few seconds)
		if ( run !== this.run ) return;

		// the camera copied (frozen), as the path tracer's lens: a PhysicalCamera, its aperture and focus the GUI's
		const src = ( camera ?? this.camera ).clone();
		src.updateMatrixWorld();
		const cam = this.frozen = ptLens( src, this.hooks.lens?.( src ) ?? {} );
		// its size: the view's, in CSS pixels (not the device's: path tracing at 2x would take 4 times as long)
		const buf = this.renderer.getDrawingBufferSize( new THREE.Vector2() ), dpr = this.renderer.getPixelRatio();
		const w = Math.max( 16, Math.round( buf.x / dpr ) ), h = Math.max( 16, Math.round( buf.y / dpr ) );
		this.saved = { renderToCanvas: pt.renderToCanvas, dynamicLowRes: pt.dynamicLowRes, tiles: pt.tiles.clone(), sync: pt.synchronizeRenderSize, minSamples: pt.minSamples, fade: pt.fadeDuration, delay: pt.renderDelay, bounces: pt.bounces, pause: pt.pausePathTracing };
		Object.assign( pt, { renderToCanvas: false, dynamicLowRes: false, synchronizeRenderSize: false, minSamples: 1, fadeDuration: 0, renderDelay: 0, pausePathTracing: false, bounces: this.hooks.bounces() } );
		// tiles of about 64k pixels: one a frame keeps the page moving
		const n = Math.max( 1, Math.round( Math.sqrt( w * h / 65536 ) ) );
		pt.tiles.set( n, n );
		// the denoiser's buffers (ptpatch.js: a recompile when switched; left as they are after)
		this.denoise = !! this.hooks.denoise?.() && !! pt.setAOV;
		pt.setAOV?.( this.denoise );
		pt._pathTracer.setSize( w, h );
		pt._lowResPathTracer.setSize( Math.max( 1, Math.floor( w * pt.lowResScale ) ), Math.max( 1, Math.floor( h * pt.lowResScale ) ) );
		// the live path tracer's own state: not its scene now (it rebuilds when it is next used)
		this.pathTracer.invalidate();
		this.hooks.enterPT();
		try {

			buildScene( pt, this.scene, cam );		// (texture layers fitted, multi-material meshes split: pathtracer.js)

		} finally {

			this.hooks.leavePT();
			this.hooks.changed();

		}
		pt.reset();
		this.target.setSize( w, h );
		this.goal = samples ?? this.hooks.samples();
		this.exclusive = exclusive;
		this.done = new Promise( ok => this._done = ok );
		this.t0 = performance.now();
		this.lastRefresh = 0;
		this.running = true;
		this._status( 'Path tracing…', `0 / ${ this.goal } spp` );

	}

	/** One frame's work (main.js's real-time frame, after the page's own draw). */
	tick() {

		if ( ! this.running ) return;
		const pt = this.pathTracer.pt, now = performance.now();
		if ( this.live ) {

			if ( now - this.lastRefresh > 1000 ) this._refresh();
			return;

		}
		// the GPU done with the last frame's tiles first (a fence): requestAnimationFrame comes at 60 Hz whatever
		// the GPU's pace, and with no canvas drawn (exclusive) nothing else holds it back: the queue grew by a
		// sample a frame until Chrome dropped the context (CONTEXT_LOST_WEBGL: the next images black)
		const gl = this.renderer.getContext();
		if ( this._fence ) {

			const st = gl.clientWaitSync( this._fence, 0, 0 );
			if ( st === gl.TIMEOUT_EXPIRED ) return;		// (still drawing: next frame)
			gl.deleteSync( this._fence );
			this._fence = null;

		}
		const was = this.renderer.getRenderTarget();
		// (exclusive: a whole sample a frame, its tiles one after another; else one tile, the page's frame drawn too)
		const n = this.exclusive ? pt.tiles.x * pt.tiles.y : 1;
		for ( let i = 0; i < n && pt.samples < this.goal; ++ i ) pt.renderSample();
		this.renderer.setRenderTarget( was );
		if ( pt.samples < this.goal ) { this._fence = gl.fenceSync( gl.SYNC_GPU_COMMANDS_COMPLETE, 0 ); gl.flush(); return this._refreshIfDue( now ); }
		const done = pt.samples >= this.goal;
		if ( done || now - this.lastRefresh > 1000 ) this._refresh();
		if ( done ) {

			this.running = false;
			this.exclusive = false;
			this._restore();
			this._done?.( Math.floor( pt.samples ) );
			this._status( 'Path traced · click to open', `${ Math.floor( pt.samples ) } spp · ${ this._elapsed() }` );

		}

	}

	_refreshIfDue( now ) { if ( now - this.lastRefresh > 1000 ) this._refresh(); }

	_elapsed() {

		const s = Math.round( ( performance.now() - this.t0 ) / 1000 );
		return `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }`;

	}

	/** The path tracer's linear HDR image now: denoised (ptdenoise.js) when the snapshot asked for it. */
	linearTexture() {

		const pt = this.pathTracer.pt, tex = pt.aovTextures?.();
		if ( this.denoise && tex && ! this.live ) return this.denoiser.render( this.renderer, tex, Math.max( 1, Math.floor( pt.samples ) ) ).texture;
		return pt.target.texture;

	}

	/** The path tracer's image now, finished as the page's (ptpost.js), into the full canvas and the window. */
	_refresh() {

		const pt = this.pathTracer.pt, src = pt.target;
		if ( ! src ) return;
		const w = src.width, h = src.height, r = this.renderer;
		if ( this.target.width !== w || this.target.height !== h ) this.target.setSize( w, h );
		const was = { target: r.getRenderTarget(), auto: r.autoClear };
		this.post.render( r, this.linearTexture(), this.target, this.hooks.post?.() ?? {} );
		const px = new Uint8Array( 4 * w * h );
		r.readRenderTargetPixels( this.target, 0, 0, w, h, px );
		r.setRenderTarget( was.target );
		r.autoClear = was.auto;
		// rows as read are bottom first; alpha opaque (the path tracer's background alpha may not be 1)
		const img = new ImageData( w, h ), d = img.data, row = 4 * w;
		for ( let y = 0; y < h; ++ y ) d.set( px.subarray( ( h - 1 - y ) * row, ( h - y ) * row ), y * row );
		for ( let i = 3; i < d.length; i += 4 ) d[ i ] = 255;
		if ( this.full.width !== w || this.full.height !== h ) Object.assign( this.full, { width: w, height: h } );
		this.full.getContext( '2d' ).putImageData( img, 0, 0 );
		// the window: the image fitted in, its aspect kept
		const t = this.thumb, tw = 320, th = Math.round( tw * h / w );
		if ( t.width !== tw || t.height !== th ) Object.assign( t, { width: tw, height: th } );
		const g = t.getContext( '2d' );
		g.imageSmoothingQuality = 'high';
		g.drawImage( this.full, 0, 0, tw, th );
		this.lastRefresh = performance.now();
		if ( this.running ) this._status( this.live ? 'Path traced (live)' : 'Path tracing…', this.live ? `${ Math.floor( pt.samples ) } spp` : `${ Math.floor( pt.samples ) } / ${ this.goal } spp · ${ this._elapsed() }` );

	}

	/** The full image as it is now, a PNG as base64 (tools/render-pt.mjs). */
	pngBase64() {

		this._refresh();
		return new Promise( ok => this.full.toBlob( b => { const f = new FileReader(); f.onload = () => ok( f.result.slice( f.result.indexOf( ',' ) + 1 ) ); f.readAsDataURL( b ); }, 'image/png' ) );

	}

	/** Samples so far. */
	get samples() { return Math.floor( this.pathTracer.pt.samples ); }

	/** The full image, as it is now, in a new tab (a blob URL). */
	openFull() {

		if ( this.statusEl.textContent === 'Preparing the scene…' ) return;
		const tab = window.open( '', '_blank' );		// (opened in the click: not a blocked pop-up; the image follows)
		this._refresh();
		this.full.toBlob( blob => {

			if ( ! blob ) { tab?.close(); return; }
			const url = URL.createObjectURL( blob );
			if ( this.url ) URL.revokeObjectURL( this.url );		// (the tab before has its image already)
			this.url = url;
			if ( tab ) tab.location.href = url;
			else {		// (pop-ups blocked: a download instead)

				const a = Object.assign( document.createElement( 'a' ), { href: url, download: `pathtraced-${ Date.now() }.png` } );
				a.click();

			}

		}, 'image/png' );

	}

	/** Stop tracing (the image so far stays in the window). */
	stop() {

		this.run ++;
		if ( this._fence ) { this.renderer.getContext().deleteSync( this._fence ); this._fence = null; }
		if ( this.running && ! this.live ) this._restore();
		this.running = false;
		this.exclusive = false;

	}

	close() {

		this.stop();
		this.panel.hidden = true;

	}

	/** The path tracer's own settings back (the live path tracing's). */
	_restore() {

		const pt = this.pathTracer.pt, s = this.saved;
		if ( ! s ) return;
		pt.renderToCanvas = s.renderToCanvas; pt.dynamicLowRes = s.dynamicLowRes; pt.tiles.copy( s.tiles ); pt.synchronizeRenderSize = s.sync;
		pt.minSamples = s.minSamples; pt.fadeDuration = s.fade; pt.renderDelay = s.delay; pt.bounces = s.bounces; pt.pausePathTracing = s.pause;
		this.saved = null;

	}

}

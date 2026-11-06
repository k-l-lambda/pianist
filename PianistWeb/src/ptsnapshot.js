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
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { withSingleMaterials } from './pathtracer.js';

const nextFrame = () => new Promise( r => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

export class PTSnapshot {

	/**
	 * `pathTracer`: src/pathtracer.js's (its `pt`, a WebGLPathTracer: shared with the live path tracing).
	 * `hooks`: { enterPT(), leavePT(), isLive(): the page path traces itself, samples(), bounces(), changed(): the live path tracer must rebuild }.
	 */
	constructor( renderer, pathTracer, scene, camera, hooks ) {

		Object.assign( this, { renderer, pathTracer, scene, camera, hooks } );
		this.running = false;
		this.run = 0;
		this.output = new OutputPass();
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

	/** Start (or restart) a snapshot of the view as it is now. */
	async start() {

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

		const cam = this.frozen = this.camera.clone();
		cam.updateMatrixWorld();
		// its size: the view's, in CSS pixels (not the device's: path tracing at 2x would take 4 times as long)
		const buf = this.renderer.getDrawingBufferSize( new THREE.Vector2() ), dpr = this.renderer.getPixelRatio();
		const w = Math.max( 16, Math.round( buf.x / dpr ) ), h = Math.max( 16, Math.round( buf.y / dpr ) );
		this.saved = { renderToCanvas: pt.renderToCanvas, dynamicLowRes: pt.dynamicLowRes, tiles: pt.tiles.clone(), sync: pt.synchronizeRenderSize, minSamples: pt.minSamples, fade: pt.fadeDuration, delay: pt.renderDelay, bounces: pt.bounces, pause: pt.pausePathTracing };
		Object.assign( pt, { renderToCanvas: false, dynamicLowRes: false, synchronizeRenderSize: false, minSamples: 1, fadeDuration: 0, renderDelay: 0, pausePathTracing: false, bounces: this.hooks.bounces() } );
		// tiles of about 64k pixels: one a frame keeps the page moving
		const n = Math.max( 1, Math.round( Math.sqrt( w * h / 65536 ) ) );
		pt.tiles.set( n, n );
		pt._pathTracer.setSize( w, h );
		pt._lowResPathTracer.setSize( Math.max( 1, Math.floor( w * pt.lowResScale ) ), Math.max( 1, Math.floor( h * pt.lowResScale ) ) );
		// the live path tracer's own state: not its scene now (it rebuilds when it is next used)
		this.pathTracer.invalidate();
		this.hooks.enterPT();
		try {

			withSingleMaterials( this.scene, () => pt.setScene( this.scene, cam ) );		// (multi-material meshes split: pathtracer.js)

		} finally {

			this.hooks.leavePT();
			this.hooks.changed();

		}
		pt.reset();
		this.target.setSize( w, h );
		this.goal = this.hooks.samples();
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
		const was = this.renderer.getRenderTarget();
		if ( pt.samples < this.goal ) pt.renderSample();
		this.renderer.setRenderTarget( was );
		const done = pt.samples >= this.goal;
		if ( done || now - this.lastRefresh > 1000 ) this._refresh();
		if ( done ) {

			this.running = false;
			this._restore();
			this._status( 'Path traced · click to open', `${ Math.floor( pt.samples ) } spp · ${ this._elapsed() }` );

		}

	}

	_elapsed() {

		const s = Math.round( ( performance.now() - this.t0 ) / 1000 );
		return `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }`;

	}

	/** The path tracer's image now, tone mapped (as the page's output), into the full canvas and the window. */
	_refresh() {

		const pt = this.pathTracer.pt, src = pt.target;
		if ( ! src ) return;
		const w = src.width, h = src.height, r = this.renderer;
		if ( this.target.width !== w || this.target.height !== h ) this.target.setSize( w, h );
		const was = { target: r.getRenderTarget(), auto: r.autoClear };
		this.output.renderToScreen = false;
		this.output.render( r, this.target, src );
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
		if ( this.running && ! this.live ) this._restore();
		this.running = false;

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

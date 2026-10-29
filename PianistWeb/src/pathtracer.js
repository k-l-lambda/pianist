// Progressive GPU path tracing (three-gpu-pathtracer) for reference-quality GI:
// multi-bounce diffuse + glossy transport, soft area-light shadows, true glass transmission.

import { WebGLPathTracer } from 'three-gpu-pathtracer';

export class PathTracer {

	constructor( renderer ) {

		this.renderer = renderer;
		this.pt = new WebGLPathTracer( renderer );
		this.pt.tiles.set( 2, 2 );
		this.pt.bounces = 8;
		this.pt.transmissiveBounces = 10;
		this.pt.filterGlossyFactor = 0.5;
		this.pt.minSamples = 1;
		this.pt.fadeDuration = 300;
		this.pt.renderDelay = 0;
		this.pt.dynamicLowRes = true;
		this.pt.lowResScale = 0.3;
		this.pt.textureSize.set( 2048, 2048 );
		this.ready = false;
		this.maxSamples = 2000;

	}

	set rasterCallback( fn ) {

		this.pt.rasterizeSceneCallback = fn;

	}

	get samples() {

		return this.pt.samples;

	}

	setScene( scene, camera ) {

		this.scene = scene;
		this.camera = camera;
		this.pt.setScene( scene, camera );
		this.ready = true;

	}

	updateCamera() {

		if ( this.ready ) this.pt.updateCamera();

	}

	updateLights() {

		if ( this.ready ) {

			this.pt.updateLights();
			this.pt.updateEnvironment();

		}

	}

	render() {

		this.pt.pausePathTracing = this.pt.samples >= this.maxSamples;
		this.pt.renderSample();

	}

	invalidate() {

		this.ready = false;

	}

}

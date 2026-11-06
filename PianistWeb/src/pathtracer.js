// Progressive GPU path tracing (three-gpu-pathtracer) for reference-quality GI:
// multi-bounce diffuse + glossy transport, soft area-light shadows, true glass transmission.

import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

/**
 * Run `fn` (the path tracer's scene build) with each multi-material mesh stood in for by one mesh per
 * group. three-gpu-pathtracer (0.0.27) lists a mesh's every material but gives the mesh one group, its
 * index the mesh's: after the first multi-material mesh (the grand's screen panel, 6) every later mesh
 * reads a material too far on (meshes merge in uuid order, random per load: the rug gold one time, the
 * windows dark another). The stand-ins share the geometry's attributes (the group's indices copied) and
 * sit where the mesh is; gone again after (the path tracer keeps its own copy).
 */
export function withSingleMaterials( scene, fn ) {

	const swaps = [];
	scene.traverseVisible( o => { if ( o.isMesh && Array.isArray( o.material ) && o.geometry.groups.length ) swaps.push( o ); } );
	const added = [];
	for ( const o of swaps ) {

		const g = o.geometry, idx = g.index;
		for ( const gr of g.groups ) {

			const mat = o.material[ gr.materialIndex ];
			if ( ! mat ) continue;
			const sub = new BufferGeometry();
			for ( const [ k, a ] of Object.entries( g.attributes ) ) sub.setAttribute( k, a );
			if ( idx ) sub.setIndex( new BufferAttribute( idx.array.slice( gr.start, gr.start + gr.count ), 1 ) );
			else for ( const [ k, a ] of Object.entries( g.attributes ) ) sub.setAttribute( k, new BufferAttribute( a.array.slice( gr.start * a.itemSize, ( gr.start + gr.count ) * a.itemSize ), a.itemSize, a.normalized ) );		// (the path tracer ignores drawRange)
			const m = new Mesh( sub, mat );
			m.matrixAutoUpdate = false;
			m.matrix.copy( o.matrixWorld ); m.matrixWorld.copy( o.matrixWorld );
			m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow;
			scene.add( m );
			added.push( m );

		}
		o.visible = false;

	}
	try {

		return fn();

	} finally {

		for ( const m of added ) { scene.remove( m ); m.geometry.dispose(); }
		for ( const o of swaps ) o.visible = true;

	}

}

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
		withSingleMaterials( scene, () => this.pt.setScene( scene, camera ) );
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

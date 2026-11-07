// Progressive GPU path tracing (three-gpu-pathtracer) for reference-quality GI:
// multi-bounce diffuse + glossy transport, soft area-light shadows, true glass transmission.

import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { patchPathTracer } from './ptpatch.js';

/**
 * Run `fn` (the path tracer's scene build) with each multi-material mesh stood in for by one mesh per
 * group. three-gpu-pathtracer (0.0.27) lists a mesh's every material but gives the mesh one group, its
 * index the mesh's: after the first multi-material mesh (the grand's screen panel, 6) every later mesh
 * reads a material too far on (meshes merge in uuid order, random per load: the rug gold one time, the
 * windows dark another). The stand-ins share the geometry's attributes (the group's indices copied) and
 * sit where the mesh is; gone again after (the path tracer keeps its own copy).
 */
/**
 * The path tracer's texture layers sized to fit: it copies every texture into one array of
 * textureSize² RGBA8 layers; past the driver's limit (the Berlin hall: 269 textures at 2048² is 4.2 GB)
 * its allocation fails (GL_INVALID_FRAMEBUFFER_OPERATION) and every texture reads black. The largest
 * power of two up to 2048 whose array stays within `budget` bytes.
 */
export function fitTextureSize( pt, scene, budget = 1.5 * 2 ** 30 ) {

	const set = new Set();
	scene.traverseVisible( o => { if ( o.isMesh ) for ( const m of [ o.material ].flat() ) for ( const k in m ) if ( m[ k ]?.isTexture ) set.add( m[ k ] ); } );
	let size = 2048;
	while ( size > 256 && set.size * size * size * 4 > budget ) size /= 2;
	pt.textureSize.set( size, size );
	return { textures: set.size, size };

}

/** Build the path tracer's scene: its texture layers fitted, multi-material meshes split (below). */
export function buildScene( pt, scene, camera ) {

	fitTextureSize( pt, scene );
	return withRGBAColors( scene, () => withSingleMaterials( scene, () => pt.setScene( scene, camera ) ) );

}

/**
 * Run `fn` with every 3-wide vertex colour attribute stood in for by an RGBA one (alpha 1). The path
 * tracer gives meshes without colours a 4-wide white one, then merges each mesh's colours as if all were
 * as wide as the first mesh's (in uuid order: random per load): when that one had none, the RGB meshes
 * (the furniture's TRELLIS colours) were copied out of step and the plants and pillows came out dark.
 */
export function withRGBAColors( scene, fn ) {

	const swaps = [];
	scene.traverseVisible( o => {

		const c = o.isMesh && o.geometry.attributes.color;
		if ( ! c || c.itemSize !== 3 || swaps.some( s => s.g === o.geometry ) ) return;
		const f = new Float32Array( c.count * 4 );
		for ( let i = 0; i < c.count; ++ i ) { f[ 4 * i ] = c.getX( i ); f[ 4 * i + 1 ] = c.getY( i ); f[ 4 * i + 2 ] = c.getZ( i ); f[ 4 * i + 3 ] = 1; }
		swaps.push( { g: o.geometry, c } );
		o.geometry.setAttribute( 'color', new BufferAttribute( f, 4 ) );

	} );
	try {

		return fn();

	} finally {

		for ( const { g, c } of swaps ) g.setAttribute( 'color', c );

	}

}

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
		patchPathTracer( this.pt );		// (lights picked by power, the environment its share; camera-only emitters: ptpatch.js)
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
		buildScene( this.pt, scene, camera );
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

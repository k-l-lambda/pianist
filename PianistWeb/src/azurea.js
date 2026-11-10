// Azurea: the crystal grand's seaside hotel lobby, after Footages.local/azurea/*.png. Glacier blue and pearl
// white, open and airy: a curved floor-to-ceiling glass wall at the back (the piano by it), a long infinity pool
// outside it and the sea, distant mountains and the sky beyond; a curved white marble bar in the middle (light
// strips in it, a backlit bottle wall behind), a lounge on the right (a sofa, two chairs, a round table), a
// spiral staircase on the left up to a mezzanine (glass balustrades, plants); a ring cove in the ceiling with a
// hanging crystal chandelier; a mirror-polished pale marble floor.
//
// The architecture is built here (exact curves: the glass wall, the bar, the stairs, the cove, the pool); the
// furniture and the plants, and the pictures (the sea, the marble, the bottle wall), come from the pack
// (public/azurea/azurea.glb: tools/azurea-gen.mjs's seedream photos, tools/luminara-3d.py's TRELLIS meshes,
// tools/azurea-asset.mjs).
//
// A venue as room.js describes (group, lights, activate/deactivate, presets, lightControls, keyLight, environment,
// place, probePoint, bounds, view, updateLights, setQuality, setMode); daylight by the probe (no lightmap).
//   raster        the sea and the sky: a curved photo (the backdrop) under a gradient dome, seen through the glass;
//                 the sun a distant spot through it (the mullions' shadows); the glass's sky as a portal light;
//                 the floor a planar mirror (src/mirror.js)
//   path tracer   the backdrop and dome captured as its environment (skyEnvironment) and background, the glass,
//                 the crystal and the water transmissive (the water a closed volume, its basin seen through it)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PlaneMirror } from './mirror.js';
import { clock } from './rendermode.js';
import { clearMaterial, setClearMode } from './clearglass.js';
import { CubeToEquirectGenerator } from 'three-gpu-pathtracer/src/utils/CubeToEquirectGenerator.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );
const D = Math.PI / 180;
const phys = p => new THREE.MeshPhysicalMaterial( p );

// ---- the plan (m; the piano at the origin, its keys towards +z, the glass behind it at -z) ----
const H = 7.6;									// the ceiling
const WALL = { x0: - 13, x1: 9, z1: 12 };		// the side walls, the front wall
const GLASS = { cx: - 2, cz: 21.4, r: 26 };		// the glass wall: an arc round ( cx, cz )
GLASS.a0 = - Math.acos( ( WALL.x0 - GLASS.cx ) / GLASS.r );		// (rad: x = cx + r cos a, z = cz + r sin a, its near side; at the left wall)
GLASS.a1 = - Math.acos( ( WALL.x1 - GLASS.cx ) / GLASS.r );		// (at the right wall)
const glassZ = x => GLASS.cz - Math.sqrt( GLASS.r ** 2 - ( x - GLASS.cx ) ** 2 );
const BAR = { cx: - 3.0, cz: 4.2 };				// the bar's arc (its front towards +z), the bottle wall behind it
const STAIRS = { cx: - 8.8, cz: 5.0, r0: 0.9, r1: 2.6, rise: 5.2, steps: 25, sweep: 300 * D, top: Math.PI };		// (its top tread at angle `top`)
const MEZZ = { x0: WALL.x0, x1: - 11.2, z0: - 2.0, z1: WALL.z1, y: 5.2 };
const COVE = { cx: - 0.5, cz: 4.0, r: 5.0, soffit: 3.3 };
const POOL = { x0: - 16, x1: 13, z0: - 11.3, z1: - 8.3, water: - 0.12, depth: 1.2, deck: - 0.03 };
// the backdrop's arc (the sea's photo, 3:1), its horizon at the eye; within the cameras' far planes (main.js 60, the probe's 50)
const SKY = { cx: - 2, cz: 2, r: 40, a0: - 170 * D, a1: - 10 * D, eye: 1.6, dome: 42 };
SKY.h = SKY.r * ( SKY.a1 - SKY.a0 ) / 3; SKY.y0 = SKY.eye - SKY.h / 3;

// the pack's pieces: [ slug, x, z, yaw (rad: its front +z turned to face (sin, cos)) ]
const LAYOUT = [
	[ 'sofa', 5.6, 3.4, Math.PI ],
	[ 'lounge-chair', 4.1, 0.5, Math.atan2( 1.5, 1.2 ) ], [ 'lounge-chair', 7.1, 0.5, Math.atan2( - 1.5, 1.2 ) ],
	...[ 40, 65, 90, 115, 140 ].map( a => [ 'bar-stool', BAR.cx + 3.15 * Math.cos( a * D ), BAR.cz + 3.15 * Math.sin( a * D ), Math.atan2( - Math.cos( a * D ), - Math.sin( a * D ) ) ] ),
	[ 'plant-tall', - 12.1, - 1.0, 0.4 ], [ 'plant-tall', 8.1, - 1.3, - 0.9 ], [ 'plant-tall', - 11.9, 8.6, 2.1 ],
	[ 'plant-low', 2.6, 3.6, 0.3 ], [ 'plant-low', - 6.2, 9.2, 1.7 ], [ 'plant-low', 8.2, 5.0, - 1.1 ],
];

export const AZUREA_PRESETS = {
	'Day': { sun: 9, sunColor: '#fff4e4', sunAz: - 112, sunEl: 34, sky: 1.0, skyColor: '#5aa6e6', tint: '#ffffff', portal: 2.0, cove: 1.0, coveColor: '#e6f4ff', led: 3.5, ledColor: '#bfe7ff', bottles: 1.3, env: 0.8, exposure: 0.42, bloom: 0.06, bloomThreshold: 6 },
	'Golden hour': { sun: 7, sunColor: '#ffb674', sunAz: - 128, sunEl: 9, sky: 0.7, skyColor: '#f2a774', tint: '#ffc79a', portal: 1.2, cove: 2.2, coveColor: '#ffe6c4', led: 4.5, ledColor: '#ffe2bd', bottles: 2.0, env: 0.7, exposure: 0.6, bloom: 0.08, bloomThreshold: 5 },
};
const DEFAULT_PRESET = 'Day';

// ---- geometry ----
/** Its uv in metres by its normal's main axis (a texture's repeat: its size). */
function planar( p, n ) {

	const ax = Math.abs( n.x ), ay = Math.abs( n.y ), az = Math.abs( n.z );
	return ay >= ax && ay >= az ? [ p.x, p.z ] : ax >= az ? [ p.z, p.y ] : [ p.x, p.y ];

}

/** Triangles, as quads: each faced by its normal(s) (its winding turned to match). */
class Geo {

	constructor() { this.p = []; this.n = []; this.t = []; }
	quad( a, b, c, d, n, uv = null ) {

		let P = [ a, b, c, d ], N = Array.isArray( n ) ? n : [ n, n, n, n ], T = uv ?? P.map( ( p, i ) => planar( p, N[ i ] ) );
		const f = new THREE.Vector3().subVectors( b, a ).cross( new THREE.Vector3().subVectors( c, a ) );
		if ( f.lengthSq() < 1e-14 ) f.subVectors( c, a ).cross( new THREE.Vector3().subVectors( d, a ) );
		if ( f.dot( N[ 0 ].clone().add( N[ 1 ] ).add( N[ 2 ] ).add( N[ 3 ] ) ) < 0 ) { P = [ a, d, c, b ]; N = [ N[ 0 ], N[ 3 ], N[ 2 ], N[ 1 ] ]; T = [ T[ 0 ], T[ 3 ], T[ 2 ], T[ 1 ] ]; }
		for ( const i of [ 0, 1, 2, 0, 2, 3 ] ) { this.p.push( P[ i ].x, P[ i ].y, P[ i ].z ); this.n.push( N[ i ].x, N[ i ].y, N[ i ].z ); this.t.push( T[ i ][ 0 ], T[ i ][ 1 ] ); }

	}
	build() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.p, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.n, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.t, 2 ) );
		return g;

	}

}

/**
 * A solid band round a vertical axis at ( cx, cz ): angles a0..a1 (x = cx + r cos a, z = cz + r sin a), radii r0..r1,
 * heights lo..hi (numbers, or functions of the angle: a helix); `faces` of 'oitbse' (outer, inner, top, bottom,
 * start, end); `uv`: ( a, b, la, lb, ha, hb ) -> four [ u, v ] for the outer and inner faces' quads (else planar).
 */
function band( { cx = 0, cz = 0, a0, a1, r0, r1, lo, hi, segs = 32, faces = 'oitbse', uv = null } ) {

	const g = new Geo(), L = typeof lo === 'function' ? lo : () => lo, Hh = typeof hi === 'function' ? hi : () => hi;
	const P = ( a, r, y ) => V( cx + r * Math.cos( a ), y, cz + r * Math.sin( a ) ), R = a => V( Math.cos( a ), 0, Math.sin( a ) );
	for ( let i = 0; i < segs; ++ i ) {

		const a = a0 + ( a1 - a0 ) * i / segs, b = a0 + ( a1 - a0 ) * ( i + 1 ) / segs, la = L( a ), lb = L( b ), ha = Hh( a ), hb = Hh( b );
		const t = uv?.( a, b, la, lb, ha, hb ) ?? null;
		if ( faces.includes( 'o' ) ) g.quad( P( a, r1, la ), P( b, r1, lb ), P( b, r1, hb ), P( a, r1, ha ), [ R( a ), R( b ), R( b ), R( a ) ], t );
		if ( faces.includes( 'i' ) && r0 > 0 ) g.quad( P( a, r0, la ), P( b, r0, lb ), P( b, r0, hb ), P( a, r0, ha ), [ R( a ).negate(), R( b ).negate(), R( b ).negate(), R( a ).negate() ], t );
		if ( faces.includes( 't' ) ) g.quad( P( a, r0, ha ), P( b, r0, hb ), P( b, r1, hb ), P( a, r1, ha ), V( 0, 1, 0 ) );
		if ( faces.includes( 'b' ) ) g.quad( P( a, r0, la ), P( b, r0, lb ), P( b, r1, lb ), P( a, r1, la ), V( 0, - 1, 0 ) );

	}
	if ( faces.includes( 's' ) ) g.quad( P( a0, r0, L( a0 ) ), P( a0, r1, L( a0 ) ), P( a0, r1, Hh( a0 ) ), P( a0, r0, Hh( a0 ) ), V( Math.sin( a0 ), 0, - Math.cos( a0 ) ) );
	if ( faces.includes( 'e' ) ) g.quad( P( a1, r0, L( a1 ) ), P( a1, r1, L( a1 ) ), P( a1, r1, Hh( a1 ) ), P( a1, r0, Hh( a1 ) ), V( - Math.sin( a1 ), 0, Math.cos( a1 ) ) );
	return g.build();

}

/** An axis-aligned box, its uvs planar (metres). */
function box( x0, x1, y0, y1, z0, z1 ) {

	const g = new THREE.BoxGeometry( x1 - x0, y1 - y0, z1 - z0 ).translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
	return replanar( g );

}

function replanar( g ) {

	const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv ?? new THREE.BufferAttribute( new Float32Array( p.count * 2 ), 2 );
	for ( let i = 0; i < p.count; ++ i ) { const t = planar( V( p.getX( i ), p.getY( i ), p.getZ( i ) ), V( n.getX( i ), n.getY( i ), n.getZ( i ) ) ); uv.setXY( i, t[ 0 ], t[ 1 ] ); }
	g.setAttribute( 'uv', uv );
	return g;

}

/** A flat rectangle at height y facing up, x0..x1 by z0..z1 (planar uvs). */
function slab( x0, x1, z0, z1, y ) {

	const g = new Geo();
	g.quad( V( x0, y, z0 ), V( x1, y, z0 ), V( x1, y, z1 ), V( x0, y, z1 ), V( 0, 1, 0 ) );
	return g.build();

}

/** The floor's (or ceiling's) outline: the front, the side walls, the glass's arc; in (x, z). */
function footprint( segs = 64 ) {

	const pts = [ [ WALL.x0, WALL.z1 ], [ WALL.x1, WALL.z1 ] ];
	for ( let i = 0; i <= segs; ++ i ) { const a = GLASS.a1 + ( GLASS.a0 - GLASS.a1 ) * i / segs; pts.push( [ GLASS.cx + GLASS.r * Math.cos( a ), GLASS.cz + GLASS.r * Math.sin( a ) ] ); }
	return pts;

}

// ---- textures ----
/** The pool's tiles: pearl white, glacier-blue joints (a canvas; 0.12 m tiles, 8 to a repeat of 0.96 m). */
function tileTexture() {

	const c = document.createElement( 'canvas' ); c.width = c.height = 256;
	const g = c.getContext( '2d' );
	g.fillStyle = '#eef9fc'; g.fillRect( 0, 0, 256, 256 );
	for ( let i = 0; i < 8; ++ i ) for ( let j = 0; j < 8; ++ j ) { g.fillStyle = `hsl(193, 60%, ${ 88 + 6 * ( ( i * 7 + j * 3 ) % 5 ) / 4 }%)`; g.fillRect( i * 32 + 2, j * 32 + 2, 28, 28 ); }
	const t = new THREE.CanvasTexture( c );
	t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set( 1 / 0.96, 1 / 0.96 ); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
	return t;

}

/** The water's ripples: a tiling normal map of a few crossing waves (integer frequencies: it tiles). */
function rippleTexture( N = 256 ) {

	const W = [ [ 3, 1, 0.9, 0.3 ], [ - 2, 4, 0.6, 1.7 ], [ 5, - 3, 0.35, 2.9 ], [ 1, 6, 0.3, 4.1 ], [ 7, 2, 0.18, 0.7 ], [ - 6, 5, 0.15, 5.3 ] ];
	const d = new Uint8Array( N * N * 4 );
	for ( let y = 0; y < N; ++ y ) for ( let x = 0; x < N; ++ x ) {

		let hx = 0, hy = 0;
		for ( const [ fx, fy, a, ph ] of W ) { const w = 2 * Math.PI * ( fx * x + fy * y ) / N + ph, c = a * Math.cos( w ) * 2 * Math.PI / N; hx += c * fx; hy += c * fy; }
		const n = V( - hx * 18, - hy * 18, 1 ).normalize(), i = 4 * ( y * N + x );
		d[ i ] = Math.round( ( n.x * 0.5 + 0.5 ) * 255 ); d[ i + 1 ] = Math.round( ( n.y * 0.5 + 0.5 ) * 255 ); d[ i + 2 ] = Math.round( ( n.z * 0.5 + 0.5 ) * 255 ); d[ i + 3 ] = 255;

	}
	const t = new THREE.DataTexture( d, N, N );
	t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set( 0.35, 0.35 ); t.colorSpace = THREE.NoColorSpace;
	t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
	return t;

}

export class Azurea {

	constructor( scene, baker ) {

		this.scene = scene;
		this.baker = baker;
		this.highQuality = true;
		this.presets = AZUREA_PRESETS;
		this.preset = new URLSearchParams( location.search ).get( 'preset' ) in AZUREA_PRESETS ? new URLSearchParams( location.search ).get( 'preset' ) : DEFAULT_PRESET;
		this.light = { ...AZUREA_PRESETS[ this.preset ] };
		this.group = new THREE.Group(); this.group.name = 'azurea';
		this.lights = new THREE.Group(); this.lights.name = 'azureaLights';
		this.active = false;
		this.mode = 'raster';
		this.view = { maxDistance: 16, maxPolarAngle: Math.PI * 0.56 };
		this.background = new THREE.Color( '#cfe6f5' );
		this.precompile = null;		// async ( object ): its shaders compiled as the frame will draw them (main.js)
		const ripples = this.ripples = rippleTexture();
		const M = this.materials = {
			// the floor: pale marble, mirror-polished (its marble from the pack; its reflection a planar one)
			floor: phys( { color: '#f6f6f4', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 } ),
			marble: phys( { color: '#f8f8f6', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 } ),
			plaster: phys( { color: '#f2f5f7', roughness: 0.92 } ),
			ceiling: phys( { color: '#f5f8fa', roughness: 0.92 } ),
			lacquer: phys( { color: '#f1f4f6', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 } ),
			plinth: phys( { color: '#d9e5ec', roughness: 0.3, clearcoat: 0.6 } ),
			chrome: phys( { color: '#e8ebee', metalness: 1, roughness: 0.12 } ),
			mullion: phys( { color: '#eef1f3', metalness: 0.5, roughness: 0.32 } ),
			// lines of light (the bar's strips, the soffit's rim) and the cove's glow
			led: new THREE.MeshStandardMaterial( { color: '#000000', roughness: 1, emissive: new THREE.Color( '#bfe7ff' ), emissiveIntensity: 3.5, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } ),
			cove: phys( { color: '#f2f6f8', roughness: 0.9, emissive: new THREE.Color( '#e6f4ff' ), emissiveIntensity: 1, side: THREE.DoubleSide } ),
			// the bar's bottle wall: a backlit picture (the pack's)
			bottles: new THREE.MeshStandardMaterial( { color: '#222222', roughness: 0.4, emissive: new THREE.Color( '#ffffff' ), emissiveIntensity: 1.3 } ),
			// clear things (src/clearglass.js: transmission under GI and the path tracer, Fresnel alpha glass else)
			glass: clearMaterial( { ior: 1.5, roughness: 0.005, thickness: 0.012, tint: '#eef8f9', attenuationDistance: 2, haze: 0.03 } ),
			railGlass: clearMaterial( { ior: 1.5, roughness: 0.01, thickness: 0.012, tint: '#dff2f4', attenuationDistance: 0.8, haze: 0.06 } ),
			crystal: clearMaterial( { ior: 1.6, roughness: 0, thickness: 0.03, dispersion: 4, tint: '#f6fcff', haze: 0.12, flatShading: true } ),
			tableGlass: clearMaterial( { ior: 1.5, roughness: 0.01, thickness: 0.3, tint: '#e6f6f8', attenuationDistance: 1.2, haze: 0.08 } ),
			// the pool: its tiles, its deck (the marble, warmer), its water (raster: a surface; the path tracer: a volume)
			tile: phys( { map: tileTexture(), roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08 } ),
			deck: phys( { color: '#efe4d3', roughness: 0.55 } ),
			// (raster: an opaque aqua body under a Fresnel reflection of the sky, its own envMap: as clear glass it showed
			// only its tiles, grey; the depth's colour is the path tracer's volume)
			water: phys( { color: '#178fa6', roughness: 0.03, metalness: 0, ior: 1.33, normalMap: ripples, normalScale: new THREE.Vector2( 0.35, 0.35 ) } ),
			waterPT: phys( { color: '#ffffff', roughness: 0.02, metalness: 0, ior: 1.33, transmission: 1, thickness: 1.2, attenuationColor: new THREE.Color( '#3cbfd2' ), attenuationDistance: 1.1, normalMap: ripples, normalScale: new THREE.Vector2( 0.35, 0.35 ) } ),
			rug: phys( { color: '#dbe8ef', roughness: 1, sheen: 1, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.6 } ),
			// outside: the dome (a gradient) and the backdrop (the sea's photo, the pack's)
			sky: new THREE.MeshBasicMaterial( { vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false } ),
			backdrop: new THREE.MeshBasicMaterial( { color: '#ffffff', fog: false } ),		// (its inner face turned to the room already)
			// the pack's looks (tools/azurea-asset.mjs MAT; TRELLIS's mixed winding: two-sided)
			boucle: phys( { color: '#f3f1ec', roughness: 1, sheen: 1, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.8, side: THREE.DoubleSide } ),
			velvetBlue: phys( { color: '#a8cce1', roughness: 0.85, sheen: 1, sheenColor: new THREE.Color( '#eaf7ff' ), sheenRoughness: 0.4, side: THREE.DoubleSide } ),
			leather: phys( { color: '#f2f0eb', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4, side: THREE.DoubleSide } ),
			ceramic: phys( { color: '#f5f5f3', roughness: 0.45, clearcoat: 0.4, side: THREE.DoubleSide } ),
			leaf: phys( { color: '#ffffff', vertexColors: true, roughness: 0.6, sheen: 0.3, side: THREE.DoubleSide } ),
			packChrome: phys( { color: '#e8ebee', metalness: 1, roughness: 0.14, side: THREE.DoubleSide } ),
		};
		this.clear = [ M.glass, M.railGlass, M.crystal, M.tableGlass ];
		this.mirror = new PlaneMirror( new THREE.Plane( V( 0, 1, 0 ), 0 ) );		// (the floor's: src/mirror.js)
		this.mirror.addTo( M.floor );
		this._buildLights();
		this._built = false;

	}

	// ---- the venue's API ----
	activate() {

		this.active = true;
		this.scene.add( this.lights );
		if ( ! this._built ) { this.rebuild(); this._built = true; }
		this.scene.add( this.group );
		if ( ! this._loadTried ) this.load();
		this.updateLights();

	}

	deactivate() {

		this.active = false;
		this.scene.remove( this.group, this.lights );

	}

	get keyLight() { return this.sun; }
	get specularOff() { return [ this.sun ]; }		// (the sun shows once, as its own highlight: gi.js)
	get probeHidden() { return []; }		// (the sea and the sky in the probe: the floor's and the piano's reflections of them)
	keyLightRadius() { return 0.005; }
	get environment() { return this.mode === 'pathtrace' ? this.skyEnvironment() : null; }

	/** The piano by the glass, centred. */
	place( piano ) {

		piano.group.position.set( 0, 0, 0 );
		piano.group.rotation.set( 0, 0, 0 );
		piano.group.updateMatrixWorld( true );
		const c = new THREE.Box3().setFromObject( piano.group ).getCenter( new THREE.Vector3() );
		piano.group.position.set( - c.x, 0, - c.z );

	}

	probePoint() { return V( - 0.5, 1.6, 4.0 ); }
	bounds() { return { minX: WALL.x0 + 0.5, maxX: WALL.x1 - 0.5, minZ: - 2.0, maxZ: WALL.z1 - 0.5 }; }
	acousticBox() { return { minX: WALL.x0, maxX: WALL.x1, minZ: glassZ( GLASS.cx ), maxZ: WALL.z1, height: H, acoustics: 'living' }; }

	views() {

		return {
			'Overview': { position: V( - 1.5, 2.3, 11.6 ), target: V( - 1.5, 1.6, - 2 ) },
			'The bar': { position: V( - 3.0, 1.5, 9.3 ), target: V( - 3.0, 1.2, 3.5 ) },
			'The lounge': { position: V( 2.4, 1.4, 6.6 ), target: V( 6.0, 0.7, 1.2 ) },
			'The staircase': { position: V( - 3.4, 1.7, 8.6 ), target: V( - 9.4, 2.6, 4.6 ) },
			'The pool': { position: V( 3.0, 1.6, - 2.2 ), target: V( 0.5, 0.0, - 9.8 ) },
			'Through the glass': { position: V( 5.5, 1.9, 7.5 ), target: V( - 1.5, 0.4, - 9 ) },
			'The chandelier': { position: V( 2.2, 1.4, 9.4 ), target: V( COVE.cx, 5.2, COVE.cz ) },
		};

	}

	lightControls() {

		return [
			[ 'sun', 0, 20, 0.1, 'Sun' ], [ 'sunColor', 'color', 'Sun color' ], [ 'sunAz', - 180, 0, 0.5, 'Sun azimuth (°)' ], [ 'sunEl', 2, 70, 0.5, 'Sun elevation (°)' ],
			[ 'sky', 0, 3, 0.01, 'Sky and sea' ], [ 'skyColor', 'color', 'Sky color' ], [ 'tint', 'color', 'Sea tint' ], [ 'portal', 0, 6, 0.01, 'Window light' ],
			[ 'cove', 0, 6, 0.01, 'Cove' ], [ 'coveColor', 'color', 'Cove color' ], [ 'led', 0, 12, 0.1, 'Bar strips' ], [ 'ledColor', 'color', 'Strip color' ],
			[ 'bottles', 0, 5, 0.01, 'Bottle wall' ], [ 'env', 0, 2, 0.01, 'Ambient (probe)' ],
		];

	}

	// ---- the shell ----
	rebuild() {

		for ( const c of [ ...this.group.children ] ) if ( c !== this.pack ) { this.group.remove( c ); c.traverse( o => o.geometry?.dispose() ); }
		const M = this.materials, parts = new Map();
		const add = ( geo, mat ) => { if ( ! parts.has( mat ) ) parts.set( mat, [] ); parts.get( mat ).push( geo.index ? geo.toNonIndexed() : geo ); };

		// the floor (its outline: the walls and the glass's arc) and the ceiling, with the cove's hole
		const fp = footprint();
		{

			const s = new THREE.Shape( fp.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
			const g = new THREE.ShapeGeometry( s, 1 ).rotateX( - Math.PI / 2 );		// ((x, -z) -> (x, 0, z), facing up)
			const uv = g.attributes.uv; for ( let i = 0; i < uv.count; ++ i ) uv.setY( i, - uv.getY( i ) );
			this.floorMesh = new THREE.Mesh( g, M.floor ); this.floorMesh.receiveShadow = true; this.floorMesh.name = 'azurea:floor';
			this.group.add( this.floorMesh );
			const c = new THREE.Shape( fp.map( ( [ x, z ] ) => new THREE.Vector2( x, z ) ) );
			c.holes.push( new THREE.Path().absarc( COVE.cx, COVE.cz, COVE.r, 0, 2 * Math.PI, false ) );
			add( new THREE.ShapeGeometry( c, 1 ).rotateX( Math.PI / 2 ).translate( 0, H, 0 ), M.ceiling );		// ((x, z) -> (x, 0, z), facing down)

		}
		// the walls (left, right, front: plaster), the mezzanine (marble on it, lacquer round, plaster under)
		add( box( WALL.x0 - 0.2, WALL.x0, 0, H, glassZ( WALL.x0 ) - 0.3, WALL.z1 + 0.2 ), M.plaster );
		add( box( WALL.x1, WALL.x1 + 0.2, 0, H, glassZ( WALL.x1 ) - 0.3, WALL.z1 + 0.2 ), M.plaster );
		add( box( WALL.x0 - 0.2, WALL.x1 + 0.2, 0, H, WALL.z1, WALL.z1 + 0.2 ), M.plaster );
		add( slab( MEZZ.x0, MEZZ.x1, MEZZ.z0, MEZZ.z1, MEZZ.y ), M.marble );
		add( box( MEZZ.x1 - 0.02, MEZZ.x1, MEZZ.y - 0.32, MEZZ.y, MEZZ.z0, MEZZ.z1 ), M.lacquer );
		add( box( MEZZ.x0, MEZZ.x1, MEZZ.y - 0.32, MEZZ.y - 0.3, MEZZ.z0, MEZZ.z1 ), M.ceiling );
		add( box( MEZZ.x0, MEZZ.x1, MEZZ.y - 0.32, MEZZ.y, MEZZ.z0 - 0.02, MEZZ.z0 ), M.lacquer );
		// its balustrade (glass, a chrome rail), open where the stairs arrive
		for ( const [ z0, z1 ] of [ [ MEZZ.z0, STAIRS.cz - 1.3 ], [ STAIRS.cz + 1.3, MEZZ.z1 ] ] ) {

			add( box( MEZZ.x1 + 0.03, MEZZ.x1 + 0.045, MEZZ.y, MEZZ.y + 1.02, z0, z1 ), M.railGlass );
			add( new THREE.CylinderGeometry( 0.022, 0.022, z1 - z0, 12 ).rotateX( Math.PI / 2 ).translate( MEZZ.x1 + 0.0375, MEZZ.y + 1.04, ( z0 + z1 ) / 2 ), M.chrome );

		}

		// the glass wall: a thin arc, full height; its mullions, its head and sill
		const G = GLASS, gs = { cx: G.cx, cz: G.cz, a0: G.a0, a1: G.a1 };
		add( band( { ...gs, r0: G.r - 0.006, r1: G.r + 0.006, lo: 0.04, hi: H - 0.12, segs: 96 } ), M.glass );
		for ( let i = 0; i <= 11; ++ i ) { const a = G.a0 + ( G.a1 - G.a0 ) * i / 11, d = 0.045 / G.r; add( band( { cx: G.cx, cz: G.cz, a0: a - d, a1: a + d, r0: G.r - 0.16, r1: G.r + 0.03, lo: 0, hi: H, segs: 1 } ), M.mullion ); }
		add( band( { ...gs, r0: G.r - 0.14, r1: G.r + 0.03, lo: H - 0.12, hi: H, segs: 96 } ), M.mullion );
		add( band( { ...gs, r0: G.r - 0.14, r1: G.r + 0.03, lo: 0, hi: 0.04, segs: 96 } ), M.mullion );

		// the ceiling's ring cove: its wall (glowing), its top; the floating soffit, a line of light round it
		add( band( { cx: COVE.cx, cz: COVE.cz, a0: 0, a1: 2 * Math.PI, r0: COVE.r, r1: COVE.r + 0.15, lo: H, hi: H + 0.9, segs: 128, faces: 'i' } ), M.cove );
		add( new THREE.CircleGeometry( COVE.r + 0.15, 128 ).rotateX( Math.PI / 2 ).translate( COVE.cx, H + 0.9, COVE.cz ), M.cove );
		add( band( { cx: COVE.cx, cz: COVE.cz, a0: 0, a1: 2 * Math.PI, r0: 0, r1: COVE.soffit, lo: H - 0.2, hi: H - 0.05, segs: 128, faces: 'ob' } ), M.ceiling );
		add( band( { cx: COVE.cx, cz: COVE.cz, a0: 0, a1: 2 * Math.PI, r0: 0, r1: COVE.soffit + 0.004, lo: H - 0.16, hi: H - 0.11, segs: 128, faces: 'o' } ), M.led );
		this._chandelier( add );

		// the bar: a curved marble front on a recessed plinth, a strip of light along it and at its foot, its top
		// overhanging; the bartender's counter inside; the bottle wall behind
		const bar = { cx: BAR.cx, cz: BAR.cz, a0: 20 * D, a1: 160 * D, segs: 64 };
		add( band( { ...bar, r0: 2.0, r1: 2.6, lo: 0.12, hi: 1.06 } ), M.marble );
		add( band( { ...bar, r0: 2.05, r1: 2.5, lo: 0, hi: 0.12 } ), M.plinth );
		add( band( { ...bar, r0: 2.5, r1: 2.512, lo: 0.04, hi: 0.1, faces: 'o' } ), M.led );
		add( band( { ...bar, r0: 2.6, r1: 2.606, lo: 0.54, hi: 0.585, faces: 'o' } ), M.led );
		add( band( { ...bar, a0: 17 * D, a1: 163 * D, r0: 1.86, r1: 2.72, lo: 1.06, hi: 1.12 } ), M.marble );
		add( band( { ...bar, a0: 26 * D, a1: 154 * D, r0: 1.35, r1: 1.82, lo: 0, hi: 0.92 } ), M.lacquer );
		{

			const bw = { cx: BAR.cx, cz: BAR.cz, a0: - 145 * D, a1: - 35 * D, segs: 48 }, y0 = 0.95, y1 = 2.95;
			add( band( { ...bw, r0: 1.35, r1: 1.62, lo: 0, hi: y0 } ), M.lacquer );
			// the picture on its concave face (towards the bar): u along it (its left first, seen from the bar), v down (glTF)
			const u = a => ( a - bw.a0 ) / ( bw.a1 - bw.a0 ), v = y => 1 - ( y - y0 ) / ( y1 - y0 );
			add( band( { ...bw, r0: 1.5, r1: 1.51, lo: y0, hi: y1, faces: 'i', uv: ( a, b, la, lb, ha, hb ) => [ [ u( a ), v( la ) ], [ u( b ), v( lb ) ], [ u( b ), v( hb ) ], [ u( a ), v( ha ) ] ] } ), M.bottles );
			add( band( { ...bw, a0: - 147 * D, a1: - 33 * D, r0: 1.51, r1: 1.62, lo: y0, hi: y1 + 0.1 } ), M.lacquer );
			add( band( { ...bw, a0: - 147 * D, a1: - 33 * D, r0: 1.42, r1: 1.62, lo: y1, hi: y1 + 0.1 } ), M.lacquer );

		}

		// the spiral staircase: floating marble treads round a white column, a white stringer each side, a glass
		// balustrade outside with a chrome handrail
		{

			const S = STAIRS, a0 = S.top - S.sweep, da = S.sweep / S.steps, yAt = a => ( a - a0 ) / S.sweep * S.rise;
			const st = { cx: S.cx, cz: S.cz };
			for ( let k = 0; k < S.steps; ++ k ) { const y = ( k + 1 ) * S.rise / S.steps; add( band( { ...st, a0: a0 + k * da, a1: a0 + ( k + 1 ) * da, r0: S.r0, r1: S.r1, lo: y - 0.06, hi: y, segs: 3 } ), M.marble ); }
			add( new THREE.CylinderGeometry( 0.28, 0.28, S.rise, 32 ).translate( S.cx, S.rise / 2, S.cz ), M.lacquer );
			const helix = { ...st, a0, a1: S.top, segs: 120 };
			add( band( { ...helix, r0: S.r1, r1: S.r1 + 0.06, lo: a => yAt( a ) - 0.32, hi: a => yAt( a ) + 0.06 } ), M.lacquer );
			add( band( { ...helix, r0: S.r0 - 0.06, r1: S.r0, lo: a => yAt( a ) - 0.32, hi: a => yAt( a ) + 0.06 } ), M.lacquer );
			add( band( { ...helix, r0: S.r1 + 0.02, r1: S.r1 + 0.032, lo: a => yAt( a ) + 0.06, hi: a => yAt( a ) + 1.0 } ), M.railGlass );
			const pts = []; for ( let i = 0; i <= 120; ++ i ) { const a = a0 + S.sweep * i / 120; pts.push( V( S.cx + ( S.r1 + 0.026 ) * Math.cos( a ), yAt( a ) + 1.03, S.cz + ( S.r1 + 0.026 ) * Math.sin( a ) ) ); }
			add( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), 240, 0.022, 10 ), M.chrome );

		}

		// the lounge's round table (marble on a glass drum, a chrome ring) and its rug
		add( new THREE.CylinderGeometry( 0.48, 0.48, 0.05, 64 ).translate( 5.6, 0.405, 1.7 ), M.marble );
		add( new THREE.CylinderGeometry( 0.32, 0.32, 0.33, 64 ).translate( 5.6, 0.215, 1.7 ), M.tableGlass );
		add( new THREE.CylinderGeometry( 0.34, 0.34, 0.05, 64 ).translate( 5.6, 0.025, 1.7 ), M.chrome );
		add( new THREE.CircleGeometry( 1.75, 96 ).rotateX( - Math.PI / 2 ).translate( 5.6, 0.004, 1.6 ), M.rug );

		// outside: the deck (before the pool and either side of it), the pool's basin (tiles), its water
		const P = POOL;
		add( slab( - 22, 18, P.z1, glassZ( GLASS.cx ) + 0.5, P.deck ), M.deck );
		add( slab( - 22, P.x0, P.z0, P.z1, P.deck ), M.deck );
		add( slab( P.x1, 18, P.z0, P.z1, P.deck ), M.deck );
		{

			const g = new Geo(), yb = P.water - P.depth;
			g.quad( V( P.x0, yb, P.z0 ), V( P.x1, yb, P.z0 ), V( P.x1, yb, P.z1 ), V( P.x0, yb, P.z1 ), V( 0, 1, 0 ) );		// its floor
			g.quad( V( P.x0, yb, P.z1 ), V( P.x1, yb, P.z1 ), V( P.x1, P.deck, P.z1 ), V( P.x0, P.deck, P.z1 ), V( 0, 0, - 1 ) );		// the near wall
			g.quad( V( P.x0, yb, P.z0 ), V( P.x0, yb, P.z1 ), V( P.x0, P.deck, P.z1 ), V( P.x0, P.deck, P.z0 ), V( 1, 0, 0 ) );
			g.quad( V( P.x1, yb, P.z0 ), V( P.x1, yb, P.z1 ), V( P.x1, P.deck, P.z1 ), V( P.x1, P.deck, P.z0 ), V( - 1, 0, 0 ) );
			// the far wall: up to the water (the infinity edge), its lip, its outer face down
			g.quad( V( P.x0, yb, P.z0 ), V( P.x1, yb, P.z0 ), V( P.x1, P.water - 0.005, P.z0 ), V( P.x0, P.water - 0.005, P.z0 ), V( 0, 0, 1 ) );
			g.quad( V( P.x0, P.water - 0.005, P.z0 ), V( P.x1, P.water - 0.005, P.z0 ), V( P.x1, P.water - 0.005, P.z0 - 0.25 ), V( P.x0, P.water - 0.005, P.z0 - 0.25 ), V( 0, 1, 0 ) );
			g.quad( V( P.x0, P.water - 0.005, P.z0 - 0.25 ), V( P.x1, P.water - 0.005, P.z0 - 0.25 ), V( P.x1, yb - 1, P.z0 - 0.25 ), V( P.x0, yb - 1, P.z0 - 0.25 ), V( 0, 0, - 1 ) );
			add( g.build(), M.tile );

		}
		// the water: a surface for the raster (it spills over the edge a little), a closed volume for the path tracer
		this.water = new THREE.Mesh( slab( P.x0, P.x1, P.z0 - 0.22, P.z1, P.water ), M.water );
		this.water.name = 'azurea:water';
		this.waterPT = new THREE.Mesh( replanar( box( P.x0 + 0.01, P.x1 - 0.01, P.water - P.depth + 0.01, P.water, P.z0 + 0.01, P.z1 - 0.01 ) ), M.waterPT );
		this.waterPT.name = 'azurea:waterPT'; this.waterPT.visible = false; this.waterPT.castShadow = false;
		this.group.add( this.water, this.waterPT );

		// the sea's backdrop (an arc, the photo on its inside) and the dome over it
		{

			const u = a => ( a - SKY.a0 ) / ( SKY.a1 - SKY.a0 ), v = y => 1 - ( y - SKY.y0 ) / SKY.h;
			this.backdrop = new THREE.Mesh( band( { cx: SKY.cx, cz: SKY.cz, a0: SKY.a0, a1: SKY.a1, r0: SKY.r, r1: SKY.r + 0.1, lo: SKY.y0, hi: SKY.y0 + SKY.h, segs: 96, faces: 'i',
				uv: ( a, b, la, lb, ha, hb ) => [ [ u( a ), v( la ) ], [ u( b ), v( lb ) ], [ u( b ), v( hb ) ], [ u( a ), v( ha ) ] ] } ), M.backdrop );
			this.backdrop.name = 'azurea:backdrop';
			const dome = new THREE.SphereGeometry( SKY.dome, 64, 32 ).translate( SKY.cx, SKY.eye, SKY.cz );
			dome.setAttribute( 'color', new THREE.Float32BufferAttribute( new Float32Array( dome.attributes.position.count * 3 ), 3 ) );
			this.dome = new THREE.Mesh( dome, M.sky );
			this.dome.name = 'azurea:sky'; this.dome.renderOrder = - 1;
			this.group.add( this.backdrop, this.dome );

		}

		// the merged parts: a mesh each
		const noShadow = new Set( [ M.glass, M.railGlass, M.crystal, M.tableGlass, M.led, M.cove, M.rug, M.deck, M.tile ] );
		for ( const [ mat, geos ] of parts ) {

			const m = new THREE.Mesh( mergeGeometries( geos, false ), mat );
			m.castShadow = ! noShadow.has( mat ); m.receiveShadow = true;
			m.name = `azurea:${ Object.keys( M ).find( k => M[ k ] === mat ) }`;
			this.group.add( m );

		}
		if ( this.pack ) this.group.add( this.pack );
		this.updateLights();

	}

	/** The chandelier: strands of crystal drops on fine wires from the soffit, in rings, lowest in the middle (a wave). */
	_chandelier( add ) {

		const M = this.materials, top = H - 0.2, drops = [], wires = [];
		const drop = new THREE.OctahedronGeometry( 0.032, 0 ).scale( 1, 2.2, 1 );
		for ( const r of [ 0.35, 0.75, 1.15, 1.55, 1.95, 2.35, 2.75 ] ) {

			const n = Math.max( 6, Math.round( 2 * Math.PI * r / 0.16 ) );
			for ( let i = 0; i < n; ++ i ) {

				const a = 2 * Math.PI * ( i + 0.5 * ( r * 3 % 1 ) ) / n, x = COVE.cx + r * Math.cos( a ), z = COVE.cz + r * Math.sin( a );
				const bottom = top - ( 1.1 + 1.9 * ( 1 - r / 3.0 ) ** 2 + 0.12 * Math.sin( 3 * a + r * 2 ) );
				wires.push( new THREE.CylinderGeometry( 0.0012, 0.0012, top - bottom, 3, 1, true ).translate( x, ( top + bottom ) / 2, z ) );
				for ( let k = 0; k < 3; ++ k ) drops.push( drop.clone().translate( x, bottom + 0.075 + k * 0.17, z ) );

			}

		}
		add( mergeGeometries( drops.map( g => g.toNonIndexed() ), false ), M.crystal );
		add( mergeGeometries( wires.map( g => g.toNonIndexed() ), false ), M.chrome );

	}

	// ---- lights ----
	_buildLights() {

		// the sun: a distant spot through the glass (its shadow map covers the lobby and the pool)
		const sun = this.sun = new THREE.SpotLight( '#ffffff', 1, 0, 0.27, 0.12, 0 );
		sun.castShadow = true;
		sun.shadow.mapSize.set( 4096, 4096 );
		sun.shadow.bias = - 0.0001; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
		sun.shadow.camera.near = 40; sun.shadow.camera.far = 120;
		sun.radius = 0.4;		// (path tracer: the sun's disc, soft shadows)
		this.lights.add( sun, sun.target );
		// the glass's sky as an area light (raster; the path tracer samples the environment through the glass)
		const portal = this.portal = new THREE.RectAreaLight( '#cfe8ff', 2, 2 * GLASS.r * Math.sin( ( GLASS.a1 - GLASS.a0 ) / 2 ), H - 0.4 );
		portal.position.set( GLASS.cx, H / 2, glassZ( GLASS.cx ) + 0.3 );
		portal.lookAt( GLASS.cx, H / 2, 10 );
		this.lights.add( portal );

	}

	sunDirection() {

		const L = this.light, az = L.sunAz * D, el = L.sunEl * D;
		return V( Math.cos( el ) * Math.cos( az ), Math.sin( el ), Math.cos( el ) * Math.sin( az ) );

	}

	updateLights() {

		const L = this.light, M = this.materials;
		const aim = V( - 1, 0.5, 2 ), dir = this.sunDirection();
		this.sun.position.copy( aim ).addScaledVector( dir, 70 );
		this.sun.target.position.copy( aim );
		this.sun.color.set( L.sunColor ); this.sun.intensity = L.sun; this.sun.visible = L.sun > 0;
		this.sun.shadow.camera.updateProjectionMatrix();
		this.portal.color.set( L.skyColor ).lerp( new THREE.Color( '#ffffff' ), 0.6 );
		this.portal.intensity = L.portal * L.sky;
		this.portal.visible = L.portal > 0 && this.mode !== 'pathtrace';
		M.cove.emissive.set( L.coveColor ); M.cove.emissiveIntensity = L.cove;
		M.led.emissive.set( L.ledColor ); M.led.emissiveIntensity = L.led;
		M.bottles.emissiveIntensity = L.bottles;
		M.backdrop.color.set( L.tint ).multiplyScalar( L.sky * 1.25 );
		if ( this.dome ) {

			// the dome: the horizon pale, the zenith the sky's colour, the sea's blue below the horizon
			const p = this.dome.geometry.attributes.position, c = this.dome.geometry.attributes.color;
			const zen = new THREE.Color( L.skyColor ).multiplyScalar( L.sky * 1.1 ), hor = new THREE.Color( '#ffffff' ).lerp( new THREE.Color( L.skyColor ), 0.3 ).multiplyScalar( L.sky * 1.5 );
			const sea = new THREE.Color( '#2a6c90' ).multiply( new THREE.Color( L.tint ) ).multiplyScalar( L.sky * 0.9 ), col = new THREE.Color();
			for ( let i = 0; i < p.count; ++ i ) {

				const y = ( p.getY( i ) - SKY.eye ) / SKY.dome;
				if ( y >= 0 ) col.copy( hor ).lerp( zen, Math.sqrt( y ) ); else col.copy( sea ).lerp( hor, Math.exp( y * 25 ) );
				c.setXYZ( i, col.r, col.g, col.b );

			}
			c.needsUpdate = true;

		}
		if ( this.active ) this.scene.background = this.mode === 'pathtrace' ? this.skyEnvironment() : this.background;
		// the water reflects the sky and the sea (the probe, taken in the lobby, showed its white walls in it)
		if ( this.pack && this.mode !== 'pathtrace' ) {

			const k = JSON.stringify( [ L.sky, L.skyColor, L.tint ] );
			if ( this._waterEnvKey !== k ) { this._waterEnvKey = k; this._waterEnv?.dispose(); this._waterEnv = this._capture( 1024 ); M.water.envMap = this._waterEnv; M.water.needsUpdate = true; }

		}

	}

	setQuality( hq ) {

		this.highQuality = hq;
		const size = hq ? 4096 : 2048;
		if ( this.sun.shadow.mapSize.x !== size ) { this.sun.shadow.mapSize.set( size, size ); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
		this.setClear();
		this.updateLights();

	}

	/** The clear things refracting when transmission is drawn (GI, the path tracer), else alpha glass. */
	setClear() {

		const on = this.highQuality || this.mode === 'pathtrace';
		for ( const m of this.clear ) setClearMode( m, on );

	}

	setMode( mode ) {

		this.mode = mode;
		this.setClear();
		const pt = mode === 'pathtrace';
		// (the path tracer: the sky and the sea its environment, captured: skyEnvironment; the water a volume)
		if ( this.dome ) { this.dome.visible = ! pt; this.backdrop.visible = ! pt; this.water.visible = ! pt; this.waterPT.visible = pt; }
		this.updateLights();

	}

	/**
	 * The dome and the backdrop captured as an equirect map from the eye on the room's axis: the path tracer's
	 * environment and background (the sea through the glass, its light in the room). Kept until the sky changes.
	 */
	skyEnvironment( width = 4096 ) {

		const L = this.light, key = JSON.stringify( [ L.sky, L.skyColor, L.tint, this.materials.backdrop.map?.uuid ?? null, width ] );
		if ( this._skyEnv?.key === key ) return this._skyEnv.texture;
		if ( ! this.dome ) return null;
		const env = this._capture( width );
		this._skyEnv?.texture.dispose();
		this._skyEnv = { key, texture: env };
		return env;

	}

	/** The dome and the backdrop as an equirect map, from the eye on the room's axis. */
	_capture( width ) {

		const r = this.baker.renderer, face = width / 4;
		const rt = new THREE.WebGLCubeRenderTarget( face, { type: THREE.HalfFloatType, generateMipmaps: false } );
		const cam = new THREE.CubeCamera( 0.1, 100, rt ), scene = new THREE.Scene();
		scene.add( new THREE.Mesh( this.dome.geometry, this.materials.sky ), new THREE.Mesh( this.backdrop.geometry, this.materials.backdrop ), cam );
		cam.position.set( SKY.cx, SKY.eye, SKY.cz );
		cam.update( r, scene );
		const env = new CubeToEquirectGenerator( r ).generate( rt.texture, width, width / 2 );
		env.mapping = THREE.EquirectangularReflectionMapping;
		rt.dispose();
		return env;

	}

	beforeRender( renderer, camera ) {

		if ( ! this.active || ! this._built ) return;
		const t = clock.now() / 1000;
		this.ripples.offset.set( t * 0.011, t * 0.006 );		// (the water's ripples drift; on the render clock offline)
		if ( this.mode === 'pathtrace' ) return;
		this.mirror.update( renderer, this.scene, camera, [ this.floorMesh ], this.mirrorScale ?? ( this.highQuality ? 0.5 : 0.35 ) );

	}

	/** Around a capture by a cube camera (the probe): the floor's reflection off (it is the main view's). */
	set capturing( on ) { this.mirror.enabled = ! on; }

	// ---- the pack ----
	load() {

		this._loadTried = true;
		const S = azureaStatus;
		S.pack = 'waiting';
		this.loading = ( async () => {

			const buf = await prefetchAzurea();
			S.pack = 'build';
			await nextFrame();
			const gltf = await new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).parseAsync( buf, new URL( 'azurea.glb', packDir() ).href );
			const pack = this._build( gltf );
			S.pack = 'compile';
			await nextFrame();
			await this.precompile?.( pack );
			await this.precompile?.( this.scene );
			this.group.add( pack );
			this.pack = pack;
			S.pack = 'ready';
			this.updateLights();
			this.onLoad?.();

		} )().catch( e => { S.failed = true; console.warn( `Azurea: ${ e.message ?? e } (the pack: tools/azurea-asset.mjs)` ); } );
		return this.loading;

	}

	_build( gltf ) {

		const M = this.materials, root = gltf.scene, pack = new THREE.Group();
		pack.name = 'azurea:pack';
		const look = m => ( { chrome: M.packChrome, boucle: M.boucle, velvetBlue: M.velvetBlue, leather: M.leather, ceramic: M.ceramic, leaf: M.leaf } )[ m.userData?.look ] ?? m;
		for ( const [ slug, x, z, yaw ] of LAYOUT ) {

			const src = root.getObjectByName( slug );
			if ( ! src ) continue;
			const o = src.clone( true );
			o.position.set( x, 0, z ); o.rotation.set( 0, yaw, 0 );
			o.traverse( m => { if ( m.isMesh ) { m.material = look( m.material ); m.castShadow = m.receiveShadow = true; } } );
			pack.add( o );

		}
		// the pictures: the sea, the marble (the floor, the bar, the stairs, the deck), the bottle wall
		const map = slug => root.getObjectByName( slug )?.isMesh ? root.getObjectByName( slug ).material.map : root.getObjectByName( slug )?.children[ 0 ]?.material.map;
		const sea = map( 'sea' ), marble = map( 'marble' ), bottles = map( 'bottle-wall' );
		if ( sea ) { sea.colorSpace = THREE.SRGBColorSpace; sea.anisotropy = 8; M.backdrop.map = sea; M.backdrop.needsUpdate = true; }
		if ( marble ) {

			marble.wrapS = marble.wrapT = THREE.RepeatWrapping; marble.repeat.set( 1 / 3, 1 / 3 ); marble.anisotropy = 8; marble.colorSpace = THREE.SRGBColorSpace;
			for ( const m of [ M.floor, M.marble, M.deck ] ) { m.map = marble; m.needsUpdate = true; }

		}
		if ( bottles ) { bottles.colorSpace = THREE.SRGBColorSpace; bottles.anisotropy = 8; M.bottles.map = bottles; M.bottles.emissiveMap = bottles; M.bottles.needsUpdate = true; }
		// the pack's quantised attributes (meshopt: normalized Int16 positions, Int8 normals, Uint8 colours) as
		// floats, the same values: three-gpu-pathtracer copies an attribute into one of its own type and writes
		// world-space metres into it (as Luminara's: the furniture became sheets 65 km across, walling the lobby
		// in: the sky black through the glass, the glass a mirror); the clones share the geometry: once each
		const done = new Set();
		pack.traverse( o => {

			if ( ! o.isMesh || done.has( o.geometry ) ) return;
			done.add( o.geometry );
			for ( const [ k, a ] of Object.entries( o.geometry.attributes ) ) {

				if ( ! a.normalized && ! a.isInterleavedBufferAttribute && a.array instanceof Float32Array ) continue;
				const f = new Float32Array( a.count * a.itemSize );
				for ( let i = 0; i < a.count; ++ i ) for ( let c = 0; c < a.itemSize; ++ c ) f[ i * a.itemSize + c ] = a.getComponent( i, c );
				o.geometry.setAttribute( k, new THREE.BufferAttribute( f, a.itemSize ) );

			}

		} );
		return pack;

	}

}

// ---- loading ----
const packDir = () => new URL( 'azurea/', new URL( import.meta.env.BASE_URL, location.href ) );
export const azureaStatus = { received: 0, total: 0, downloading: false, pack: 'pending', failed: false };
let prefetch = null;

/** The pack fetched (once), its bytes counted into azureaStatus. */
export function prefetchAzurea() {

	if ( prefetch ) return prefetch;
	const s = azureaStatus;
	s.downloading = true;
	prefetch = ( async () => {

		const res = await fetch( new URL( 'azurea.glb', packDir() ), { priority: 'high' } );
		if ( ! res.ok ) throw new Error( `azurea.glb: HTTP ${ res.status }` );
		s.total = Number( res.headers.get( 'content-length' ) ) || 0;
		const reader = res.body.getReader(), parts = [];
		for ( ;; ) { const { done, value } = await reader.read(); if ( done ) break; parts.push( value ); s.received += value.length; }
		const out = new Uint8Array( s.received );
		let o = 0; for ( const p of parts ) { out.set( p, o ); o += p.length; }
		return out.buffer;

	} )();
	prefetch.then( () => { s.downloading = false; }, () => { s.downloading = false; s.failed = true; } );
	return prefetch;

}

/** What is being done now: idle | download | build | compile | ready | failed. */
export function azureaPhase() {

	const s = azureaStatus;
	if ( s.failed ) return 'failed';
	if ( s.pack === 'build' ) return 'build';
	if ( s.pack === 'compile' ) return 'compile';
	if ( s.downloading || s.pack === 'waiting' ) return 'download';
	return s.pack === 'ready' ? 'ready' : 'idle';

}

export function azureaProgress() {

	const s = azureaStatus, step = { pending: 0, waiting: 0, build: 0.4, compile: 0.7, ready: 1 };
	const dl = s.downloading ? ( s.total ? Math.min( 1, s.received / s.total ) : 0 ) : 1;
	return 0.8 * dl + 0.2 * step[ s.pack ];

}

export function azureaStatusText() {

	const s = azureaStatus, mb = b => ( b / 1048576 ).toFixed( 1 );
	switch ( azureaPhase() ) {

		case 'download': return s.total ? `Loading Azurea · ${ mb( s.received ) } / ${ mb( s.total ) } MB` : `Loading Azurea · ${ mb( s.received ) } MB`;
		case 'build': return 'Furnishing the lobby';
		case 'compile': return 'Preparing materials';
		case 'failed': return 'Azurea failed to load';
		default: return '';

	}

}

const nextFrame = () => new Promise( r => { const t = setTimeout( r, 100 ); requestAnimationFrame( () => { clearTimeout( t ); setTimeout( r, 0 ); } ); } );

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
import { PlaneMirror, chainCompile } from './mirror.js';
import { clock, RENDER_OPTS } from './rendermode.js';
import { PoolWater, patchPoolWater } from './water.js';
import { Ocean, OCEAN_GLSL } from './ocean.js';
import { Sky, SKY_GLSL, DISC_GLSL } from './sky.js';
import { applyPoolTiles } from './pooltiles.js';
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
// the pool: a long arc concentric with the glass, right outside it (a coping strip between: r0 - GLASS.r), 5.08 m wide
// and 2.4 m deep, its far side (5.43 m from the glass) the infinity edge; from behind the left wall to behind the right (x0..x1 at its near side)
const POOL = { x0: - 16, x1: 13, w: 5.08, coping: 0.35, water: - 0.12, depth: 2.4, deck: - 0.03 };
POOL.r0 = GLASS.r + POOL.coping; POOL.r1 = POOL.r0 + POOL.w;
POOL.a0 = - Math.acos( ( POOL.x0 - GLASS.cx ) / POOL.r0 ); POOL.a1 = - Math.acos( ( POOL.x1 - GLASS.cx ) / POOL.r0 );
const PIANO_GAP = 1.6;		// (m: the piano's nearest point to the glass)
const PIANO_YAW = 15 * D;		// (turned counter-clockwise seen from above: not square to the glass)
// the backdrop's arc (the sea's photo, 3:1), its horizon at the eye; within the cameras' far planes (main.js 60, the probe's 50)
// (the arc wraps all the way round behind the room: at the glass's ends the wall hid a 10-170 degree strip, but a
// camera at the window looking sideways saw past it into the clear colour — the backdrop now closes round)
const SKY = { cx: - 2, cz: 2, r: 40, a0: - 180 * D, a1: 180 * D, eye: 1.6, dome: 42, seaY: - 1.2, horV: 0.60, seaRow: 0.78, nearD: 12 };
// (the photo's own azimuth: 160° facing the room. The arc wraps all the way round — a camera at the glass looking
// sideways saw past its old ends into the clear colour — and the photo is laid on its 160° of it, fading into the
// sky's own colour over the rest, so no coastline repeats round the back)
SKY.pa0 = - 170 * D; SKY.pa1 = - 10 * D;
SKY.h = SKY.r * ( SKY.pa1 - SKY.pa0 ) / 3; SKY.y0 = SKY.eye - SKY.h / 3;
// (the sea 1.2 m below the lobby floor: the eye eyeSea over it; the photo's horizon row horV — the sea's horizon, at
// the eye's own level, a third up from the photo's bottom — and its bottom row the water nearD away)

// the pack's pieces: [ slug, x, z, yaw (rad: its front +z turned to face (sin, cos)) ]
const LAYOUT = [
	[ 'sofa', 5.6, 3.4, Math.PI ],
	[ 'lounge-chair', 4.1, 0.5, Math.atan2( 1.5, 1.2 ) ], [ 'lounge-chair', 7.1, 0.5, Math.atan2( - 1.5, 1.2 ) ],
	...[ 40, 65, 90, 115, 140 ].map( a => [ 'bar-stool', BAR.cx + 3.15 * Math.cos( a * D ), BAR.cz + 3.15 * Math.sin( a * D ), Math.atan2( - Math.cos( a * D ), - Math.sin( a * D ) ) ] ),
	[ 'plant-tall', - 12.1, - 1.0, 0.4 ], [ 'plant-tall', 8.1, - 1.3, - 0.9 ], [ 'plant-tall', - 11.9, 8.6, 2.1 ],
	[ 'plant-low', 2.6, 3.6, 0.3 ], [ 'plant-low', - 6.2, 9.2, 1.7 ], [ 'plant-low', 8.2, 5.0, - 1.1 ],
];

// outside: the sea's photo ('day' | 'sunset' | 'night'); the key light (sun*) is the sun, or at night the moon;
// disc: the sun's or the moon's disc (and its halo) drawn in the sky in the key light's direction, glitter: its
// path on the sea (moon: true: a moon's disc); chand: a warm light in the chandelier (night); the sea state: wind
// (m/s, 10 m up) and windDir (deg, the direction it blows towards: 0 +x along the coast, -90 out to sea), swell
// (m, its significant height), swellDir (deg, towards: 90 onshore) and swellPeriod (s), gust (the gusts' strength
// over the sea: the ripples' amplitude varying; 0 none) and gustScale (m, their largest patches); paws (cat's paws: patches
// of a young wind sea where gusts touch down, added to the sea (a calm one too: wind 0, glassy), 0 none, 1 a full sea of
// pawWind in their cores), pawWind (m/s: the gusts' own; their drift), pawCover (their share of the sea), pawScale (m,
// their largest patches): src/ocean.js; the sky
// (src/sky.js): haze (the aerosols' density, × a clear day's), skyHue (0: the atmosphere's own hue, 1: the photo's;
// its brightness is the photo's sky's always), clouds (thin high cloud's cover, 0..1), stars (× a night sky's),
// airglow (the night sky's share of it)
export const AZUREA_PRESETS = {
	'Day': { moonCore: 1, sunCore: 20, seaVis: 25, wind: 0.7, windDir: 90, gust: 0.25, gustScale: 50, paws: 0.8, pawWind: 5, pawCover: 1, pawScale: 30, swell: 0.15, swellDir: 90, swellPeriod: 9, outside: 'day', sun: 9, sunColor: '#fff4e4', sunAz: - 112, sunEl: 56, moon: false, disc: 1, glitter: 0.6, sky: 1.0, haze: 1.2, skyHue: 0.35, clouds: 0.25, stars: 0, airglow: 0, tint: '#ffffff', portal: 2.0, cove: 1.0, coveColor: '#e6f4ff', led: 3.5, ledColor: '#bfe7ff', bottles: 1.3, chand: 0, chandColor: '#ffd9a8', env: 0.8, exposure: 0.42, bloom: 0.06, bloomThreshold: 6 },
	// (the sun low over the sea, to the right of straight out: az -50)
	'Golden hour': { moonCore: 1, sunCore: 16, seaVis: 22, wind: 0.5, windDir: 90, gust: 0.22, gustScale: 50, paws: 0.6, pawWind: 3.5, pawCover: 1, pawScale: 22, swell: 0.12, swellDir: 90, swellPeriod: 10, outside: 'sunset', sun: 7, sunColor: '#ffaa62', sunAz: - 50, sunEl: 4.5, moon: false, disc: 1, glitter: 1, sky: 0.85, haze: 1.6, skyHue: 0.6, clouds: 0.3, stars: 0, airglow: 0, tint: '#ffffff', portal: 1.2, cove: 2.2, coveColor: '#ffe6c4', led: 4.5, ledColor: '#ffe2bd', bottles: 2.0, chand: 0, chandColor: '#ffd9a8', env: 0.7, exposure: 0.6, bloom: 0.1, bloomThreshold: 5 },
	// (the golden hour's light on a calm sea: no wind of its own, a low swell, glassy; cat's paws drifting over it,
	// along the coast)
	'Calm evening': { moonCore: 1, sunCore: 16, seaVis: 22, wind: 0, windDir: 20, gust: 0, gustScale: 50, paws: 0.45, pawWind: 2.5, pawCover: 1, pawScale: 15, swell: 0.06, swellDir: 90, swellPeriod: 11, outside: 'sunset', sun: 7, sunColor: '#ffaa62', sunAz: - 50, sunEl: 4.5, moon: false, disc: 1, glitter: 1, sky: 0.85, haze: 1.6, skyHue: 0.6, clouds: 0.3, stars: 0, airglow: 0, tint: '#ffffff', portal: 1.2, cove: 2.2, coveColor: '#ffe6c4', led: 4.5, ledColor: '#ffe2bd', bottles: 2.0, chand: 0, chandColor: '#ffd9a8', env: 0.7, exposure: 0.6, bloom: 0.1, bloomThreshold: 5 },
	// (the moon low over the sea, a little right of straight out: az -75, 9 deg up; its light the main light, cool)
	'Night': { moonCore: 0.3, sunCore: 1, seaVis: 30, wind: 0.3, windDir: 90, gust: 0.12, gustScale: 40, paws: 0.35, pawWind: 3, pawCover: 1, pawScale: 40, swell: 0.08, swellDir: 90, swellPeriod: 11, outside: 'night', sun: 1.5, sunColor: '#b4c8ff', sunAz: - 75, sunEl: 9, moon: true, disc: 1, glitter: 0.5, sky: 1.0, haze: 1.0, skyHue: 0.75, clouds: 0.12, stars: 1.6, airglow: 0.2, tint: '#ffffff', portal: 0.08, cove: 0.9, coveColor: '#ffd8a8', led: 2.4, ledColor: '#8fd2ff', bottles: 1.2, chand: 4, chandColor: '#ffcf96', keySpec: 0.05, env: 0.45, exposure: 0.6, bloom: 0.06, bloomThreshold: 9 },
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

/**
 * The backdrop's material: the sea's photo looked up by the view's direction (as seen from the arc's centre: at
 * infinity, so it does not slide against the mullions as the eye moves; the dome and the path tracer's
 * environment, taken from the centre, agree), and in the key light's direction the sun's or the moon's disc and
 * halo over the horizon and its glittering path on the sea below (both at infinity too; the water and the path
 * tracer see them in their reflections of the captured sky).
 */
function backdropMaterial( ocean, sky ) {

	// (a map from the start: the shader reads it; the pack's photo replaces this grey until it loads)
	const grey = Object.assign( new THREE.DataTexture( new Uint8Array( [ 150, 180, 205, 255 ] ), 1, 1 ), { needsUpdate: true } );
	const m = new THREE.MeshBasicMaterial( { color: '#ffffff', fog: false, map: grey, toneMapped: false } );
	const U = m.userData.u = { uLightDir: { value: V( 0, 1, 0 ) }, uDiscColor: { value: new THREE.Color() }, uDisc: { value: 0 }, uGlitter: { value: 0 }, uMoon: { value: 0 }, uTime: { value: 0 },
		uSkyHor: { value: new THREE.Color( '#dfeaf2' ) }, uSkyZen: { value: new THREE.Color( '#3f7fb8' ) }, uSeaColor: { value: new THREE.Color( '#1d6480' ) },
		uSeaExt: { value: new THREE.Vector3( 0.30, 0.055, 0.020 ) }, uSeaExtScale: { value: 1.0 }, uSeaVis: { value: 25 }, ...ocean.uniforms, ...sky.uniforms,
		// (the photo's land matte: tools/azurea-sky-matte.py; black until loaded: all sky)
		uMatte: { value: Object.assign( new THREE.DataTexture( new Uint8Array( [ 0, 0, 0, 255 ] ), 1, 1 ), { needsUpdate: true } ) } };		// (per metre: red first, the O-H overtones; the sea's surface: src/ocean.js)
	m.onBeforeCompile = sh => {

		Object.assign( sh.uniforms, U );
		sh.vertexShader = sh.vertexShader.replace( '#include <common>', '#include <common>\nvarying vec3 vWP;' )
			.replace( '#include <project_vertex>', '#include <project_vertex>\nvWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		sh.fragmentShader = sh.fragmentShader.replace( '#include <common>', `#include <common>
			varying vec3 vWP;
			uniform vec3 uLightDir, uDiscColor, uSkyHor, uSkyZen, uSeaColor, uSeaExt;
			uniform float uDisc, uGlitter, uMoon, uTime, uSeaExtScale, uSeaVis;
			float seaAirT = 1.0;		// (the air's transmittance from the eye to the sea here: the glints' too)
			float azHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
			float azNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
				return mix( mix( azHash( i ), azHash( i + vec2( 1, 0 ) ), f.x ), mix( azHash( i + vec2( 0, 1 ) ), azHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
			${ OCEAN_GLSL }
			float camSea, seaNear;		// (the eye's height over the sea plane; how near the drawn water)
			// the sea under this pixel (src/ocean.js): the slopes' mean over its footprint (the resolved waves' normal)
			// and their covariance (what is finer than the pixel: the lobe's width), its area (m²)
			vec2 seaMean = vec2( 0.0 ); vec3 seaCov = vec3( 0.0 ); float seaArea = 1.0;
			uniform float uSeaFacet;		// (m²: a facet of the unresolved ripples, for the glints' count)
			float azFresnel( float c ) {
				// (unpolarised, water's n = 1.333 from air: exact; 0.0204 face on)
				float n = 1.333, g = sqrt( max( n * n - 1.0 + c * c, 0.0 ) );
				float a = ( g - c ) / ( g + c ), b = ( c * ( g + c ) - 1.0 ) / ( c * ( g - c ) + 1.0 );
				return 0.5 * a * a * ( 1.0 + b * b );
			}
			float azLambda( vec3 d, vec3 cv ) {
				// (Smith's Λ for Gaussian slopes, the variance along d's horizontal direction; Walter et al.'s fit)
				vec2 h = d.xz; float l2 = max( dot( h, h ), 1e-8 );
				float s2 = max( ( cv.x * h.x * h.x + cv.y * h.y * h.y + 2.0 * cv.z * h.x * h.y ) / l2, 1e-6 );
				float a = max( d.y, 1e-4 ) / sqrt( l2 ) / sqrt( 2.0 * s2 );
				return a < 1.6 ? ( 1.0 - 1.259 * a + 0.396 * a * a ) / ( 3.535 * a + 2.181 * a * a ) : 0.0;
			}
			float azVisTilt( vec3 vd, vec3 cv ) {
				// (the mean slope towards the eye of the facets it sees, Gaussian slopes of variance cv along the view)
				vec2 h = - vd.xz; float l2 = max( dot( h, h ), 1e-8 );
				float sg = sqrt( max( ( cv.x * h.x * h.x + cv.y * h.y * h.y + 2.0 * cv.z * h.x * h.y ) / l2, 1e-8 ) );
				float a = max( - vd.y, 0.0 ) / sqrt( l2 ) / sg;
				float ph = 0.39894 * exp( - 0.5 * a * a ), Ph = 0.5 * ( 1.0 + sign( a ) * sqrt( 1.0 - exp( - 0.63662 * a * a ) ) );		// (φ, Φ: erf ~ Bürmann's)
				return sg * Ph / ( a * Ph + ph );
			}
			uint azPcg( uvec3 v ) {
				v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
				v ^= v >> 16u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v.x ^ v.y ^ v.z;
			}
			const float SKY_W = ${ ( SKY.a1 - SKY.a0 ).toFixed( 6 ) };
			${ SKY_GLSL }
			${ DISC_GLSL }
			uniform sampler2D uMatte;
			float landA = 0.0;		// (how much of this pixel is the photo's land: the disc behind it)` )
			.replace( '#include <map_fragment>', `
			vec3 vd = normalize( vWP - cameraPosition );
			float pix = length( fwidth( vd ) );		// (the pixel's angle: the stars' footprint)
			{
				// the photo by direction (at infinity: no parallax against the mullions). The horizon is at the eye's
				// own level (${ SKY.horV.toFixed( 5 ) } up the photo): the sky above it as on the arc; the sea below it
				// by where the view meets the sea plane (${ SKY.seaY.toFixed( 2 ) } m below the floor: its own near water
				// and parallax as the eye rises — a raised eye sees more of it, the horizon itself unmoved)
				float a = atan( vd.z, vd.x ), up = asin( clamp( vd.y, - 1.0, 1.0 ) );
				camSea = max( cameraPosition.y - ${ SKY.seaY.toFixed( 3 ) }, 0.05 );		// (the eye over the sea)
				{
					// (where this pixel's view meets the sea plane, world xz: the waves stay put as the eye moves; its
					// derivatives taken in every pixel, the sky's too, so they are defined at the horizon's edge)
					float dq = max( - vd.y, 2e-4 );
					vec2 sxz = cameraPosition.xz + vd.xz * ( camSea / dq );
					vec2 ddx = dFdx( sxz ), ddy = dFdy( sxz );
					seaArea = max( abs( ddx.x * ddy.y - ddx.y * ddy.x ), 1e-8 );
					float hgt;
					oceanMoments( sxz, ddx, ddy, seaMean, seaCov, hgt );
				}
				float vv, skyMix = 0.0;
				if ( up > 0.0 ) {

					// the photo's sky from the horizon row up to its top, eased (the photo's own clear sky spread over the
					// arc's elevation: its thin clouds not squeezed into a band), then blended into the sky's own colour
					// — the dome's, by the same elevation — so the arc's top edge has no seam
					float e = clamp( up / ${ Math.asin( ( SKY.y0 + SKY.h - SKY.eye ) / SKY.r ).toFixed( 5 ) }, 0.0, 1.0 );
					vv = ${ SKY.horV.toFixed( 5 ) } * ( 1.0 - pow( e, 0.7 ) );		// (v 0: the photo's top row)
					skyMix = smoothstep( 0.78, 0.99, pow( e, 0.7 ) );

				} else {

					// the photo from its horizon row down: its own open sea (rows near the horizon) at the horizon, and
					// no further down than the sea's own rows (its surf, at the photo's bottom, is not water at this
					// distance: the drawn water is the pool's, nearer; the nearest of the photo's rows kept, flat)
					float dist = camSea / max( - vd.y / max( length( vd.xz ), 1e-4 ), 1e-4 );
					// (the photo's open sea by ELEVATION below the horizon, not by distance: the rows a direction meets
					// are continuous across the whole sea (distance piled every far direction onto one row: a flat band
					// with a hard edge under the far water), the photo's own perspective kept for what it shows)
					// (the photo only a thin strip at the horizon: its own rows there are distant sea seen almost edge-on;
					// further down the water is the drawn sea (below), so no stretched photo rows, no band with an edge)
					float dep = - vd.y;
					vv = mix( ${ SKY.horV.toFixed( 5 ) }, ${ SKY.seaRow.toFixed( 4 ) }, clamp( dep / ${ ( SKY.photoDep ?? 0.012 ).toFixed( 4 ) }, 0.0, 1.0 ) );
					seaNear = smoothstep( ${ ( ( SKY.photoDep ?? 0.012 ) * 0.45 ).toFixed( 4 ) }, ${ ( SKY.photoDep ?? 0.012 ).toFixed( 4 ) }, dep );

				}
				// (the photo across its own 160°; beyond, how far outside — a soft blend to the sky's colour)
				// (from the photo's centre, wrapped: -180 deg is no seam)
				float pu = 0.5 + ( mod( a - ${ ( ( SKY.pa0 + SKY.pa1 ) / 2 ).toFixed( 6 ) } + 3.14159265, 6.2831853 ) - 3.14159265 ) / ${ ( SKY.pa1 - SKY.pa0 ).toFixed( 6 ) };
				float outside = max( max( - pu, pu - 1.0 ), 0.0 ) * ${ ( SKY.pa1 - SKY.pa0 ).toFixed( 6 ) };
				skyMix = max( skyMix, smoothstep( 0.0, 22.0 * ${ D.toFixed( 6 ) }, outside ) );
				// (past the photo's own 160 deg: mirrored, its land running on and fading into the sky over 22 deg)
				float pm = clamp( pu < 0.0 ? - pu : ( pu > 1.0 ? 2.0 - pu : pu ), 0.0005, 0.9995 );
				vec2 uv = vec2( pm, clamp( vv, 0.0005, 0.9995 ) );
				vec3 ph = texture2D( map, uv ).rgb;
				// (its pale horizon haze, a flat grey-blue band across the sky once the composer's tone mapping has
				// taken its colour: the photo's own saturations kept, a little more)
				float pl = dot( ph, vec3( 0.2126, 0.7152, 0.0722 ) );
				ph = mix( vec3( pl ), ph, 1.45 );
				float mt = texture2D( uMatte, uv ).r;
				// the sky: the atmosphere's (src/sky.js) behind the photo's land. The matte (tools/azurea-sky-matte.py):
				// how much of a pixel is land (straight alpha: an edge's pixel keeps a trace of the photo's own sky)
				if ( up > 0.0 ) {

					landA = mt * ( 1.0 - skyMix );
					vec3 sky = skyColor( vd, pix, 0.0 );
					ph = mix( sky, ph, landA );

				}
				// below the horizon: the sea's surface (src/ocean.js). Its normal: the waves resolved at this pixel (their
				// slopes' mean over its footprint); the finer ones blur what it mirrors (their covariance: the sky's
				// reflection read from a coarser mip). Fresnel exact (n 1.333); the body by its path through the water
				if ( up < 0.0 ) {

					float dep = - vd.y;
					float far = smoothstep( 0.0, ${ ( SKY.photoDep ?? 0.012 ).toFixed( 4 ) }, dep );
					float DZ2 = max( length( vd.xz ), 1e-4 );
					float dist = camSea / max( dep / DZ2, 1e-4 );
					vec3 nW = normalize( vec3( - seaMean.x, 1.0, - seaMean.y ) );
					// (the reflection: the view mirrored about the resolved normal; kept above the horizon: a facet's mirror
					// of the sea itself is the sky just above it, at this scale)
					vec3 rd = reflect( vd, nW );
					// (the gusts (src/ocean.js): a rougher patch shows facets tilted more towards the eye (those facing away
					// are masked: the visible slopes' mean along the view, σ Φ( a ) / ( a Φ( a ) + φ( a ) ), a = tan of the
					// depression / σ), so it mirrors higher, darker sky: cat's paws darker. Only the gusts' change of it —
					// without them the shading as it was; the path tracer has it of itself)
					#ifdef OCEAN_PAWS
					rd.y += 2.0 * ( azVisTilt( vd, seaCov ) - azVisTilt( vd, oceanCov0 ) ) * seaNear;		// (none in the photo's strip at the horizon: no seam)
					#else
					if ( uOcGust.x > 0.0 ) rd.y += 2.0 * ( azVisTilt( vd, seaCov ) - azVisTilt( vd, oceanCov0 ) ) * seaNear;		// (none in the photo's strip at the horizon: no seam)
					#endif
					rd.y = max( rd.y, 0.002 ); rd = normalize( rd );
					float depR = rd.y;
					float eM = clamp( depR / ${ Math.asin( ( SKY.y0 + SKY.h - SKY.eye ) / SKY.r ).toFixed( 5 ) }, 0.0, 1.0 );
					float vvM = ${ SKY.horV.toFixed( 5 ) } * ( 1.0 - pow( eM, 0.7 ) );
					float aR = atan( rd.z, rd.x );
					float puR = 0.5 + ( mod( aR - ${ ( ( SKY.pa0 + SKY.pa1 ) / 2 ).toFixed( 6 ) } + 3.14159265, 6.2831853 ) - 3.14159265 ) / ${ ( SKY.pa1 - SKY.pa0 ).toFixed( 6 ) };
					float outR = max( max( - puR, puR - 1.0 ), 0.0 ) * ${ ( SKY.pa1 - SKY.pa0 ).toFixed( 6 ) };
					float uR = clamp( puR < 0.0 ? - puR : ( puR > 1.0 ? 2.0 - puR : puR ), 0.0005, 0.9995 );
					// (the unresolved slopes' spread, as an angle (twice the slope's), in the photo's texels: its mip)
					float spread = 2.0 * sqrt( max( seaCov.x + seaCov.y, 0.0 ) );
					float lodR = log2( max( spread / ( ${ ( ( SKY.pa1 - SKY.pa0 ) / 4096 ).toFixed( 7 ) } ), 1.0 ) );
					vec2 uvM = clamp( vec2( uR, vvM ), vec2( 0.0005 ), vec2( 0.9995 ) );
					vec3 phM = textureLod( map, uvM, lodR ).rgb;
					float plM = dot( phM, vec3( 0.2126, 0.7152, 0.0722 ) );
					phM = mix( vec3( plM ), phM, 1.45 );
					// (what it mirrors: the photo's land (its matte), else the sky (src/sky.js), blurred by the spread: its
					// stars and clouds softened)
					float aM = textureLod( uMatte, uvM, 0.0 ).r * ( 1.0 - smoothstep( 0.78, 0.99, pow( eM, 0.7 ) ) ) * ( 1.0 - smoothstep( 0.0, ${ ( 22 * D ).toFixed( 6 ) }, outR ) );
					vec3 skyR = skyColor( rd, pix, spread );
					vec3 reflSky = mix( skyR, phM, aM );
					float cosI = clamp( dot( - vd, nW ), 0.0, 1.0 );
					float fres = azFresnel( max( cosI, 1e-3 ) );
					// (the body: the light's path in the water — its extinction per metre, red first)
					float path = 2.6 * cosI * ( 0.5 + 1.6 * far ) + 0.45 * smoothstep( 3.0, 40.0, dist );
					vec3 T = exp( - uSeaExt * path * uSeaExtScale );
					T = mix( T, T * uSeaColor * 1.6, 0.35 );
					float lit = clamp( uSeaColor.g * 3.0, 0.25, 1.35 );
					ph = mix( uSeaColor * T * lit, reflSky, fres );
					// the air between the eye and the sea (the marine haze: Koschmieder, extinction 3.912 / visibility):
					// the sea dimmed, the haze's own light added — the horizon's colour, the sky just above it in this
					// direction, so the far sea meets the sky (the horizon ~6 km off from this eye)
					seaAirT = exp( - 3.912 * dist / ( 1000.0 * uSeaVis ) );
					vec3 hz = skyAir( normalize( vec3( vd.x, 0.002, vd.z ) ) ).rgb;
					ph = ph * seaAirT + hz * ( 1.0 - seaAirT );

				}
				diffuseColor.rgb *= ph;
			}` )
			.replace( '#include <opaque_fragment>', `
			if ( uDisc > 0.0 || uGlitter > 0.0 ) {

				vec3 L = normalize( uLightDir );
				float above = smoothstep( - 0.0004, 0.0012, vd.y );		// (the horizon cuts a setting sun)
				// (the disc and its halo: src/sky.js, the sizes as before; none in front of the photo's land)
				outgoingLight += uDisc * above * skyDisc( vd, L, uDiscColor, uMoon ) * ( 1.0 - landA );
				// its light on the sea: the sun's or the moon's disc mirrored by the facets. The mean over the pixel:
				// the Gaussian slope distribution (resolved mean, unresolved covariance, widened by the disc's own size)
				// at the slope that mirrors it to the eye, × Fresnel × Smith's masking / ( 4 cos_v cos_h⁴ ) × the disc's
				// irradiance (Bruneton, Neyret & Holzschuch 2010). Then the count: of the pixel's unresolved facets
				// (its area / uSeaFacet) a Poisson number mirror the disc (mean λ), drawn anew each 50 ms (a capillary
				// ripple's life): the pixel shows k / λ of the mean — sparse and bright where λ is small (near, or off
				// the path), even where it is large (the far path); its total is the mean's.
				float dep = - vd.y;
				if ( dep > 0.0 && uGlitter > 0.0 && L.y > - 0.02 ) {

					vec3 V = - vd;
					vec3 Hh = normalize( L + V );
					float cH = max( Hh.y, 1e-3 );
					vec2 mS = - Hh.xz / cH;		// (the slope that mirrors L to the eye)
					float R = uMoon > 0.5 ? 0.0115 : 0.0135;
					// (the disc's directions as slopes: half its angle, over cos_h²; their variance, R² / 4 a disc's)
					float dv = R * R / 16.0 / ( cH * cH * cH * cH );
					vec3 C = seaCov + vec3( dv, dv, 0.0 );
					float det = max( C.x * C.y - C.z * C.z, 1e-12 );
					vec2 d = mS - seaMean;
					float q = ( C.y * d.x * d.x - 2.0 * C.z * d.x * d.y + C.x * d.y * d.y ) / det;
					float pdf = exp( - 0.5 * q ) / ( 6.28318 * sqrt( det ) );
					float fr = azFresnel( clamp( dot( V, Hh ), 1e-3, 1.0 ) );
					float Gm = 1.0 / ( 1.0 + azLambda( V, seaCov ) + azLambda( L, seaCov ) );
					// (the disc's irradiance: its drawn radiance over its solid angle, × uGlitter (the real disc is
					// brighter than the drawn one: the preset's))
					float Ed = 3.14159 * R * R * ( uMoon > 0.5 ? 9.0 : 14.0 );
					float mean = fr * pdf * Gm / ( 4.0 * max( V.y, 2e-3 ) * cH * cH * cH * cH ) * Ed;
					// the count: facets in the pixel × the chance one mirrors the disc (pdf over its slope area, πR²/(4 cH³))
					float nF = seaArea / uSeaFacet;
					float lam = nF * pdf * 3.14159 * R * R / ( 4.0 * cH * cH * cH ) * Gm;
					// (only where the unresolved part is the facets' (not the resolved waves already in the mean): the
					// tail and the mip's own spread over a pixel of many facets)
					float stoch = smoothstep( 1.0, 8.0, nF );
					float k = lam;
					if ( stoch > 0.0 ) {

						float slot = floor( uTime / 0.05 + float( azPcg( uvec3( gl_FragCoord.xy, 7u ) ) & 1023u ) / 1024.0 );
						uvec3 sd = uvec3( gl_FragCoord.xy, uint( mod( slot, 65536.0 ) ) );
						float u1 = float( azPcg( sd ) & 0xffffffu ) / 16777216.0;
						if ( lam < 8.0 ) {

							// (Poisson by inversion)
							float pk = exp( - lam ), cdf = pk; k = 0.0;
							for ( int j = 0; j < 24; ++ j ) { if ( u1 <= cdf ) break; k += 1.0; pk *= lam / k; cdf += pk; }

						} else {

							float u2 = float( azPcg( sd + uvec3( 0u, 0u, 99991u ) ) & 0xffffffu ) / 16777216.0;
							k = max( lam + sqrt( lam ) * sqrt( - 2.0 * log( max( u1, 1e-7 ) ) ) * cos( 6.28318 * u2 ), 0.0 );

						}

					}
					float shown = mix( 1.0, k / max( lam, 1e-6 ), stoch );
					outgoingLight += uGlitter * mean * shown * smoothstep( - 0.02, 0.03, L.y ) * uDiscColor * seaAirT;

				}

			}
			#include <opaque_fragment>` );

	};
	m.customProgramCacheKey = () => 'azurea-backdrop-sky';		// (a new key: the sky from src/sky.js)
	return m;

}

/**
 * The dome's material: the same sky (src/sky.js) by the view's direction as the backdrop's above its photo (the arc's
 * top meets it seamlessly), the disc; below the horizon the sea's tint fading into the air's haze at the horizon.
 * The light's, the disc's and the clock's uniforms: the backdrop's (userData.shared, set before its first draw).
 */
function domeMaterial( sky, shared ) {

	const m = new THREE.MeshBasicMaterial( { color: '#ffffff', side: THREE.BackSide, fog: false, depthWrite: false } );
	const own = { uDomeSea: { value: new THREE.Color( '#2a6c90' ).multiplyScalar( 0.72 ) } };
	m.onBeforeCompile = sh => {

		const S = shared;
		Object.assign( sh.uniforms, sky.uniforms, own, { uLightDir: S.uLightDir, uDiscColor: S.uDiscColor, uDisc: S.uDisc, uMoon: S.uMoon, uTime: S.uTime } );
		sh.vertexShader = sh.vertexShader.replace( '#include <common>', '#include <common>\nvarying vec3 vWP;' )
			.replace( '#include <project_vertex>', '#include <project_vertex>\nvWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		sh.fragmentShader = sh.fragmentShader.replace( '#include <common>', `#include <common>
			varying vec3 vWP;
			uniform vec3 uLightDir, uDiscColor, uDomeSea;
			uniform float uDisc, uMoon, uTime;
			${ SKY_GLSL }
			${ DISC_GLSL }` )
			.replace( '#include <map_fragment>', `
			vec3 vd = normalize( vWP - cameraPosition );
			float pix = length( fwidth( vd ) );
			vec3 sc = vd.y >= 0.0 ? skyColor( vd, pix, 0.0 ) : mix( uDomeSea, skyAir( normalize( vec3( vd.x, 0.0005, vd.z ) ) ).rgb, exp( vd.y * 25.0 ) );
			diffuseColor.rgb *= sc;` )
			.replace( '#include <opaque_fragment>', `
			outgoingLight += uDisc * smoothstep( - 0.0004, 0.0012, vd.y ) * skyDisc( vd, normalize( uLightDir ), uDiscColor, uMoon );
			#include <opaque_fragment>` );

	};
	m.userData.u = own;
	m.customProgramCacheKey = () => 'azurea-dome-sky';
	return m;

}

/**
 * `material`'s direct specular from the venue's spot lights (its key light: the only ones) scaled by `u` (a uniform):
 * a light's polished-surface highlight made what it should be (a moon's, not a lamp's) while its light stays.
 */
function keySpecular( material, u ) {

	chainCompile( material, sh => {

		// (once per program: a material reached twice — a clone sharing its compile hook, the clear glass's own
		// chain — would declare the uniform twice and not compile)
		if ( sh.fragmentShader.includes( 'uniform float uKeySpec;' ) ) return;
		sh.uniforms.uKeySpec = u;
		// (three's chunk: a snapshot of the specular before the point lights' loop, before the spots', and before the
		// suns' / directionals'; then the key light (a spot) scaled by u, the point lights' (the chandelier's: a lamp
		// indoor) dropped, the rest kept. Nothing indoor may show as a reflected spot on the glass or the black screen)
		const point = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', spot = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
			end = '#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )';
		let fs = THREE.ShaderChunk.lights_fragment_begin;
		if ( ! ( fs.includes( point ) && fs.includes( spot ) && fs.includes( end ) ) || fs.indexOf( point ) > fs.indexOf( spot ) ) {

			console.warn( 'Azurea: three\'s lights chunk changed: its specular left as it is' );
			return;

		}
		const snap = n => `vec3 ${ n } = reflectedLight.directSpecular;
			#ifdef USE_CLEARCOAT
			vec3 ${ n }Cc = clearcoatSpecularDirect;
			#endif
			`;
		fs = fs.replace( point, snap( 'azS0' ) + point ).replace( spot, snap( 'azS1' ) + spot ).replace( end, snap( 'azS2' ) + end )
			.replace( end, `reflectedLight.directSpecular = azS0 + uKeySpec * ( azS2 - azS1 );
			#ifdef USE_CLEARCOAT
			clearcoatSpecularDirect = azS0Cc + uKeySpec * ( azS2Cc - azS1Cc );
			#endif
			${ end }` );
		sh.fragmentShader = sh.fragmentShader.replace( '#include <common>', '#include <common>\nuniform float uKeySpec;' ).replace( '#include <lights_fragment_begin>', fs );

	}, 'azurea-keyspec' );

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
		// the open sea's surface (src/ocean.js: its sea state from the preset: wind, swell)
		this.ocean = new Ocean( this._seaState() );
		// the sky (src/sky.js: an atmosphere, stars, thin cloud; the photos' land in front of it)
		this.sky = new Sky();
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
			water: phys( { color: '#178fa6', roughness: 0.03, metalness: 0, ior: 1.33 } ),		// (its normals the simulated surface's, its colour the floor seen through it: build, water.js)
			waterPT: phys( { color: '#ffffff', roughness: 0.02, metalness: 0, ior: 1.33, transmission: 1, thickness: 1.2, attenuationColor: new THREE.Color( '#3cbfd2' ), attenuationDistance: 1.1 } ),		// (its normal map: the simulated surface's, snapshot: setMode)
			rug: phys( { color: '#dbe8ef', roughness: 1, sheen: 1, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.6 } ),
			// outside: the dome (a gradient) and the backdrop (the sea's photo, the pack's)
			backdrop: backdropMaterial( this.ocean, this.sky ),		// (its inner face turned to the room already; the photo by direction, the disc, the glitter)
			// the pack's looks (tools/azurea-asset.mjs MAT; TRELLIS's mixed winding: two-sided)
			boucle: phys( { color: '#f3f1ec', roughness: 1, sheen: 1, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.8, side: THREE.DoubleSide } ),
			velvetBlue: phys( { color: '#a8cce1', roughness: 0.85, sheen: 1, sheenColor: new THREE.Color( '#eaf7ff' ), sheenRoughness: 0.4, side: THREE.DoubleSide } ),
			leather: phys( { color: '#f2f0eb', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4, side: THREE.DoubleSide } ),
			ceramic: phys( { color: '#f5f5f3', roughness: 0.45, clearcoat: 0.4, side: THREE.DoubleSide } ),
			leaf: phys( { color: '#ffffff', vertexColors: true, roughness: 0.6, sheen: 0.3, side: THREE.DoubleSide } ),
			packChrome: phys( { color: '#e8ebee', metalness: 1, roughness: 0.14, side: THREE.DoubleSide } ),
		};
		// the dome: the same sky, the backdrop's light, disc and clock
		M.sky = domeMaterial( this.sky, M.backdrop.userData.u );
		// the PT water's bottom and sides: no normal map, and ior 1 (the water touching the tiles: no interface there.
		// With an air gap's 1.33 the rays a ripple sent steeply sideways met the bottom past the critical angle, were
		// trapped between it and the surface until the traversals ran out: the pool's far part in black patches)
		M.waterPTBody = M.waterPT.clone(); M.waterPTBody.ior = 1.0;
		this.clear = [ M.glass, M.railGlass, M.crystal, M.tableGlass ];
		this.mirror = new PlaneMirror( new THREE.Plane( V( 0, 1, 0 ), 0 ) );		// (the floor's: src/mirror.js)
		this.mirror.addTo( M.floor );
		// the key light's direct specular, scaled per surface (keySpec on the polished stone: at night the moon, a
		// punctual light, made a broad white blob as bright as the moon itself; keySpecGlass on the glass: its
		// reflection of the key light, a lamp's blown blob where a real moon's own small reflection should be)
		this.keySpec = { value: 1 }; this.keySpecGlass = { value: 1 };
		for ( const [ m, u ] of [ [ M.floor, this.keySpec ], [ M.marble, this.keySpec ], [ M.glass, this.keySpecGlass ] ] ) if ( ! m.userData.azureaSpec ) { m.userData.azureaSpec = true; keySpecular( m, u ); }		// (once: rebuild() runs again, its chain would declare uKeySpec twice)
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
		this._ptSeaAttach();
		this.updateLights();

	}

	deactivate() {

		this.active = false;
		this.scene.remove( this.group, this.lights );
		delete this.scene.userData.ptEnvPower;		// (the path tracer's share: another venue's own)
		delete this.scene.userData.ptSea; delete this.scene.userData.ptSun;		// (its sea and disc: src/ptpatch.js)

	}

	get keyLight() { return this.sun; }
	get specularOff() { return [ this.sun ]; }		// (the sun shows once, as its own highlight: gi.js)
	get probeHidden() { return []; }		// (the sea and the sky in the probe: the floor's and the piano's reflections of them)
	keyLightRadius() { return 0.005; }
	get environment() { return this.mode === 'pathtrace' ? this.skyEnvironment() : null; }

	/** The piano by the glass, centred in x, turned PIANO_YAW; its nearest point PIANO_GAP from the glass's inner face. */
	place( piano ) {

		// the piano's screen (its black lacquer panel): no indoor lamp's specular on it either (the chandelier's point
		// light showed as a warm round spot on it); the key light's (the sky's, the moon's) as any other surface's
		piano.group.traverse( o => {

			if ( ! o.isMesh || o.name !== 'panel' ) return;		// (its materials: the face's M.panel and its back's)
			for ( const m of [ ...( Array.isArray( o.material ) ? o.material : [ o.material ] ), piano.materials?.panel ] ) if ( m && ! m.userData.azureaSpec ) { m.userData.azureaSpec = true; keySpecular( m, this.keySpec ); }

		} );
		piano.group.position.set( 0, 0, 0 );
		piano.group.rotation.set( 0, PIANO_YAW, 0 );
		piano.group.updateMatrixWorld( true );
		const c = new THREE.Box3().setFromObject( piano.group ).getCenter( new THREE.Vector3() );
		// its meshes' box corners (in the world, turned): the gap to the arc's inner face (radius r - 0.14) is the
		// least of ( r - 0.14 ) - their distance to the arc's centre; moved along z until it is PIANO_GAP
		const pts = [], k = new THREE.Vector3();
		piano.group.traverse( o => {

			if ( ! o.isMesh || ! o.geometry ) return;
			o.geometry.boundingBox ?? o.geometry.computeBoundingBox();
			const b = o.geometry.boundingBox;
			for ( let m = 0; m < 8; ++ m ) pts.push( k.set( m & 1 ? b.max.x : b.min.x, b.max.y, m & 4 ? b.max.z : b.min.z ).applyMatrix4( o.matrixWorld ).clone() );

		} );
		const gap = ( dx, dz ) => Math.min( ...pts.map( p => GLASS.r - 0.14 - Math.hypot( p.x + dx - GLASS.cx, p.z + dz - GLASS.cz ) ) );
		let dz = - c.z;
		for ( let it = 0; it < 8; ++ it ) dz -= gap( - c.x, dz ) - PIANO_GAP;		// (the arc's normal near the piano is close to z: converges)
		piano.group.position.set( - c.x, 0, dz );

	}

	probePoint() { return V( - 0.5, 1.6, 4.0 ); }
	bounds() { return { minX: WALL.x0 + 0.5, maxX: WALL.x1 - 0.5, minZ: - 3.0, maxZ: WALL.z1 - 0.5 }; }
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
			[ 'outside', [ 'day', 'sunset', 'night' ], 'Outside' ], [ 'moon', 'bool', 'Moon (not sun)' ], [ 'disc', 0, 3, 0.01, 'Sun / moon disc' ], [ 'glitter', 0, 3, 0.01, 'Sea glitter' ],
			[ 'sun', 0, 20, 0.1, 'Sun / moonlight' ], [ 'sunColor', 'color', 'Sun color' ], [ 'sunAz', - 180, 0, 0.5, 'Sun azimuth (°)' ], [ 'sunEl', 2, 70, 0.5, 'Sun elevation (°)' ],
			[ 'wind', 0, 10, 0.1, 'Wind (m/s)' ], [ 'windDir', - 180, 180, 1, 'Wind towards (°)' ], [ 'gust', 0, 0.6, 0.01, 'Gusts (sea)' ], [ 'gustScale', 10, 150, 1, 'Gust size (m)' ],
			[ 'paws', 0, 1, 0.01, "Cat's paws" ], [ 'pawWind', 1, 10, 0.1, "Cat's paws wind (m/s)" ], [ 'pawCover', 0.02, 1, 0.01, "Cat's paws cover" ], [ 'pawScale', 5, 150, 1, "Cat's paws size (m)" ], [ 'swell', 0, 1.5, 0.01, 'Swell height (m)' ],
			[ 'swellDir', - 180, 180, 1, 'Swell towards (°)' ], [ 'swellPeriod', 4, 16, 0.1, 'Swell period (s)' ],
			[ 'sky', 0, 3, 0.01, 'Sky and sea' ], [ 'sunCore', 1, 20, 0.1, 'Sun disc brightness' ], [ 'moonCore', 0.05, 2, 0.01, 'Moon disc brightness' ], [ 'seaVis', 5, 100, 0.5, 'Sea visibility (km)' ], [ 'haze', 0.2, 6, 0.01, 'Haze' ], [ 'skyHue', 0, 1, 0.01, 'Sky hue (photo)' ], [ 'clouds', 0, 1, 0.01, 'High cloud' ],
			[ 'stars', 0, 4, 0.01, 'Stars' ], [ 'airglow', 0, 1, 0.01, 'Airglow (night)' ], [ 'tint', 'color', 'Sea tint' ], [ 'portal', 0, 6, 0.01, 'Window light' ],
			[ 'cove', 0, 6, 0.01, 'Cove' ], [ 'coveColor', 'color', 'Cove color' ], [ 'led', 0, 12, 0.1, 'Bar strips' ], [ 'ledColor', 'color', 'Strip color' ],
			[ 'bottles', 0, 5, 0.01, 'Bottle wall' ], [ 'chand', 0, 60, 0.1, 'Chandelier' ], [ 'chandColor', 'color', 'Chandelier color' ], [ 'env', 0, 2, 0.01, 'Ambient (probe)' ],
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

		// outside: the deck (arcs, as the glass: a coping strip between the glass and the pool, beyond its ends and
		// past its far edge's lip), the pool's basin (tiles), its water
		const P = POOL, pa = { cx: GLASS.cx, cz: GLASS.cz, segs: 128 }, top = { faces: 't', lo: P.deck, hi: P.deck };
		add( band( { ...pa, a0: P.a0, a1: P.a1, r0: GLASS.r, r1: P.r0, ...top } ), M.deck );
		add( band( { ...pa, a0: P.a0 - 0.25, a1: P.a0, r0: GLASS.r, r1: P.r1 + 0.25, ...top, segs: 16 } ), M.deck );
		add( band( { ...pa, a0: P.a1, a1: P.a1 + 0.25, r0: GLASS.r, r1: P.r1 + 0.25, ...top, segs: 16 } ), M.deck );
		{

			const yb = P.water - P.depth, lip = P.water - 0.005;
			add( band( { ...pa, a0: P.a0, a1: P.a1, r0: P.r0, r1: P.r1, faces: 't', lo: yb, hi: yb } ), M.tile );		// its floor
			add( band( { ...pa, a0: P.a0, a1: P.a1, r0: P.r0 - 0.1, r1: P.r0, faces: 'o', lo: yb, hi: P.deck } ), M.tile );		// the near wall (by the glass)
			// its ends (facing in)
			for ( const [ a, d ] of [ [ P.a0, 1 ], [ P.a1, - 1 ] ] ) {

				const g = new Geo(), Pt = ( r, y ) => V( GLASS.cx + r * Math.cos( a ), y, GLASS.cz + r * Math.sin( a ) );
				g.quad( Pt( P.r0, yb ), Pt( P.r1, yb ), Pt( P.r1, P.deck ), Pt( P.r0, P.deck ), V( - d * Math.sin( a ), 0, d * Math.cos( a ) ) );
				add( g.build(), M.tile );

			}
			// the far wall: up to the water (the infinity edge), its lip, its outer face down
			add( band( { ...pa, a0: P.a0, a1: P.a1, r0: P.r1, r1: P.r1 + 0.1, faces: 'i', lo: yb, hi: lip } ), M.tile );
			add( band( { ...pa, a0: P.a0, a1: P.a1, r0: P.r1, r1: P.r1 + 0.25, faces: 't', lo: lip, hi: lip } ), M.tile );
			add( band( { ...pa, a0: P.a0, a1: P.a1, r0: P.r1, r1: P.r1 + 0.25, faces: 'o', lo: yb - 1, hi: lip } ), M.tile );

		}
		// the water: a surface for the raster (it spills over the edge a little), a closed volume for the path tracer
		this.water = new THREE.Mesh( band( { ...pa, a0: P.a0, a1: P.a1, r0: P.r0, r1: P.r1 + 0.22, faces: 't', lo: P.water, hi: P.water } ), M.water );
		this.water.name = 'azurea:water';
		const da = 0.01 / P.r0;
		// (its top the surface, normal-mapped; its bottom and sides flat, the same water: a normal map there tipped
		// the rays leaving the water for the tiles past the critical angle at a grazing view: total internal
		// reflection, the pool's far part in dark patches, more with the map's strength)
		const wb = { ...pa, a0: P.a0 + da, a1: P.a1 - da, r0: P.r0 + 0.01, r1: P.r1 - 0.01, lo: P.water - P.depth + 0.01, hi: P.water };
		this.waterPT = new THREE.Mesh( band( { ...wb, faces: 't' } ), M.waterPT );
		this.waterPT.name = 'azurea:waterPT'; this.waterPT.visible = false; this.waterPT.castShadow = false;
		this.waterPTBody = new THREE.Mesh( band( { ...wb, faces: 'oibse' } ), M.waterPTBody );
		this.waterPTBody.name = 'azurea:waterPTBody'; this.waterPTBody.castShadow = false;
		this.waterPT.add( this.waterPTBody );		// (shown with it)
		this.group.add( this.water, this.waterPT );
		// its surface: a simulated height field (water.js: wind gusts, drops, the inlets' jets; reflecting walls, the
		// infinity edge absorbing), its normal map in the pool's own uv (along the arc, across); the raster's water
		// shows the floor through it (refracted, the caustic on the tiles), the path tracer's takes a snapshot of it
		this.poolWater ??= new PoolWater( { cx: GLASS.cx, cz: GLASS.cz, a0: P.a0, a1: P.a1, r0: P.r0, r1: P.r1 }, { depth: P.depth } );
		this.poolWater.polarUV( this.water.geometry ); this.poolWater.polarUV( this.waterPT.geometry );
		M.water.normalMap = this.poolWater.texture; M.water.normalScale.set( 1, 1 );
		patchPoolWater( M.water, { water: this.poolWater, tiles: M.tile.map, surfaceY: P.water, floorY: P.water - P.depth } );
		// the mosaic, the water that lets it read (the raster's refracted floor at the right mip, one volume in the
		// path tracer), the key light's specular on it per preset (src/pooltiles.js; idempotent)
		applyPoolTiles( this );

		// the sea's backdrop (an arc, the photo on its inside) and the dome over it
		{

			const u = a => ( a - SKY.a0 ) / ( SKY.a1 - SKY.a0 ), v = y => 1 - ( y - SKY.y0 ) / SKY.h;
			this.backdrop = new THREE.Mesh( band( { cx: SKY.cx, cz: SKY.cz, a0: SKY.a0, a1: SKY.a1, r0: SKY.r, r1: SKY.r + 0.1, lo: SKY.y0, hi: SKY.y0 + SKY.h, segs: 96, faces: 'i',
				uv: ( a, b, la, lb, ha, hb ) => [ [ u( a ), v( la ) ], [ u( b ), v( lb ) ], [ u( b ), v( hb ) ], [ u( a ), v( ha ) ] ] } ), M.backdrop );
			this.backdrop.name = 'azurea:backdrop';
			const dome = new THREE.SphereGeometry( SKY.dome, 64, 32 ).translate( SKY.cx, SKY.eye, SKY.cz );
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
		sun.radius = 0.4;
		this.lights.add( sun, sun.target );
		// the path tracer's sun (or moon): a directional light, its disc the drawn one's (the backdrop's R: 0.0135
		// rad the sun, 0.0115 the moon), sampled in its cone (src/ptpatch.js patchSea): the sea outside the spot's
		// cone lit too, the lobby's shadows as soft as the disc is wide. The raster's spot is hidden there
		const sunPT = this.sunPT = new THREE.DirectionalLight( '#ffffff', 1 );
		sunPT.visible = false; sunPT.castShadow = false;
		this.lights.add( sunPT, sunPT.target );
		// the glass's sky as an area light (raster; the path tracer samples the environment through the glass)
		const portal = this.portal = new THREE.RectAreaLight( '#cfe8ff', 2, 2 * GLASS.r * Math.sin( ( GLASS.a1 - GLASS.a0 ) / 2 ), H - 0.4 );
		portal.position.set( GLASS.cx, H / 2, glassZ( GLASS.cx ) + 0.3 );
		portal.lookAt( GLASS.cx, H / 2, 10 );
		this.lights.add( portal );
		// the chandelier's warm light (night): a point in its crystals
		const chand = this.chandLight = new THREE.PointLight( '#ffcf96', 0, 0, 2 );
		chand.position.set( COVE.cx, H - 1.9, COVE.cz );
		this.lights.add( chand );

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
		this.sun.color.set( L.sunColor ); this.sun.intensity = L.sun; this.sun.visible = L.sun > 0 && this.mode !== 'pathtrace';
		this.sunPT.position.copy( aim ).addScaledVector( dir, 70 ); this.sunPT.target.position.copy( aim );
		this.sunPT.color.set( L.sunColor ); this.sunPT.intensity = L.sun; this.sunPT.visible = L.sun > 0 && this.mode === 'pathtrace';
		this.sunPT.updateMatrixWorld(); this.sunPT.target.updateMatrixWorld();
		this.sun.shadow.camera.updateProjectionMatrix();
		this.portal.color.set( '#cfe8ff' );		// (the sky's own colour, once it is drawn: below)
		this.portal.intensity = L.portal * L.sky;
		this.portal.visible = L.portal > 0 && this.mode !== 'pathtrace';
		M.cove.emissive.set( L.coveColor ); M.cove.emissiveIntensity = L.cove;
		M.led.emissive.set( L.ledColor ); M.led.emissiveIntensity = L.led;
		M.bottles.emissiveIntensity = L.bottles;
		this.keySpec.value = L.keySpec ?? 1; this.keySpecGlass.value = L.keySpecGlass ?? 0;
		this.chandLight.color.set( L.chandColor ?? '#ffcf96' ); this.chandLight.intensity = L.chand ?? 0; this.chandLight.visible = ( L.chand ?? 0 ) > 0;
		// the outside: its photo (the hour's), the disc and its path in the key light's direction
		const sea = this.seas?.[ L.outside ] ?? this.seas?.day;
		if ( sea && M.backdrop.map !== sea ) { M.backdrop.map = sea; M.backdrop.needsUpdate = true; }
		M.backdrop.color.set( L.tint ).multiplyScalar( L.sky * 1.25 );
		{

			const U = M.backdrop.userData.u;
			U.uLightDir.value.copy( dir ); U.uMoon.value = L.moon ? 1 : 0; U.uDisc.value = L.disc ?? 0; U.uGlitter.value = L.glitter ?? 0;
			U.uSeaVis.value = L.seaVis ?? 25; this.sky.uniforms.uSunCore.value = L.moon ? 1 : ( L.sunCore ?? 1 ); this.sky.uniforms.uMoonCore.value = L.moon ? ( L.moonCore ?? 1 ) : 1;
			this.ocean.set( this._seaState() );
			this.ocean.setGust( L.gust ?? 0, L.gustScale ?? 50 );		// (the gusts: no new spectrum, a uniform)
			// (the cat's paws: their spectra only when their wind changes, stepped as the sea's)
			this.ocean.setPaws( { paws: L.paws ?? 0, wind: Math.round( ( L.pawWind ?? 4 ) * 10 ) / 10, cover: L.pawCover ?? 0.4, scale: L.pawScale ?? 20 } );
			// (their code in the drawn sea's shader only while they are on: OCEAN_PAWS; a recompile when they come and go)
			{

				const on = ( L.paws ?? 0 ) > 0, m = M.backdrop;
				if ( ( m.defines?.OCEAN_PAWS !== undefined ) !== on ) {

					m.defines = { ...( m.defines ?? {} ) };
					if ( on ) m.defines.OCEAN_PAWS = ''; else delete m.defines.OCEAN_PAWS;
					m.needsUpdate = true;

				}

			}
			U.uDiscColor.value.set( L.moon ? '#dfe8ff' : L.sunColor );
			if ( ! L.moon ) U.uDiscColor.value.lerp( new THREE.Color( '#fff2dc' ), 0.35 );		// (the disc whiter than its light)
			this._ptSeaLight( L );

		}
		if ( this.dome ) {

			const U = M.backdrop.userData.u;
			U.uSeaColor.value.set( L.seaColor ?? '#1d6480' ).multiplyScalar( L.sky );
			// the sky (src/sky.js): the air lit by the key light (the sun, or the moon), as bright as the hour's photo's
			// own sky; the dome with the backdrop's tint
			M.sky.color.copy( M.backdrop.color );
			M.sky.userData.u.uDomeSea.value.set( '#2a6c90' ).multiply( new THREE.Color( L.tint ) ).multiplyScalar( 0.72 );
			const ph = this.skyPhotos?.[ L.outside ] ?? this.skyPhotos?.day;
			if ( ph ) U.uMatte.value = ph.matte;
			const T = ph?.band ?? [ 0.25, 0.42, 0.75 ], tl = 0.2126 * T[ 0 ] + 0.7152 * T[ 1 ] + 0.0722 * T[ 2 ];
			// (the stars' gain: a magnitude-0 star ~40x the sky's band at 1080p, a 5th ~0.4x: src/sky.js)
			this.sky.set( { light: dir, haze: L.haze ?? 1, hue: L.skyHue ?? 0.35, airglow: L.moon ? ( L.airglow ?? 0.25 ) : 0, stars: ( L.stars ?? 0 ) * 6e-5 * tl,
				clouds: L.clouds ?? 0, target: T, profile: ph?.profile, az0: SKY.pa0, az1: SKY.pa1 } );
			const r = this._renderer ?? this.baker?.renderer;
			if ( r ) this.sky.update( r );
			// (the window's light: the sky's own colour, paler)
			const mc = this.sky.mean, ml = Math.max( 0.2126 * mc[ 0 ] + 0.7152 * mc[ 1 ] + 0.0722 * mc[ 2 ], 1e-9 );
			this.portal.color.setRGB( mc[ 0 ] / ml, mc[ 1 ] / ml, mc[ 2 ] / ml ).lerp( new THREE.Color( '#ffffff' ), 0.6 );

		}
		if ( this.active ) this.scene.background = this.mode === 'pathtrace' ? ( this.skyEnvironment(), this._skyEnv?.background ?? this.background ) : this.background;
		// the water reflects the sky and the sea (the probe, taken in the lobby, showed its white walls in it)
		if ( this.pack && this.mode !== 'pathtrace' ) {

			const k = this._outsideKey();
			// (the glass wall too: at a grazing angle it reflects mostly what is before it — the sea and the sky, not the
			// lobby's grey probe, which read as a flat haze band across the sky above the horizon)
			if ( this._waterEnvKey !== k ) {

				this._waterEnvKey = k; this._waterEnv?.dispose(); this._waterEnv = this._capture( 1024 );
				M.water.envMap = this._waterEnv; M.water.needsUpdate = true;
				M.glass.envMap = this._waterEnv; M.glass.envMapIntensity = 1; M.glass.needsUpdate = true;

			}

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
		// the glass wall in the path tracer: anti-reflective (its two faces ~0.5 % each face on, as a coated shop
		// window; at 1.5, 4 % each, the white sunlit lobby in it veiled the pool and the sea: 'ior' only sets the
		// reflectance here, a thin parallel slab barely bends)
		this.materials.glass.ior = pt ? 1.15 : 1.5;
		// the bare strips and the chandelier's crystals in the path tracer: the cove's glow and the bar's many lights
		// bloomed over the frame (ptpost.js); their emission dimmed there, the presets keep the raster's
		if ( this.materials.led ) this.materials.led.emissiveIntensity = ( this.light.led ?? 3.5 ) * ( pt ? 0.35 : 1 );
		if ( this.materials.crystal ) this.materials.crystal.emissiveIntensity = pt ? 0 : ( this.materials.crystal.emissiveIntensity ?? 0 );
		// the path tracer's water: the surface now (it copies its textures when its scene is built: a frame's state)
		if ( pt && this.poolWater && this._renderer ) {

			this.poolWater.update( this._renderer, clock.now() / 1000 );
			const m = this.materials.waterPT;
			m.normalMap = this.poolWater.snapshot( this._renderer ); m.normalScale.set( 1, 1 ); m.needsUpdate = true;		// (full: the dark patches it made were the air gap's (waterPTBody) and the grazing facets' (ptpatch.js))
			applyPoolTiles( this );		// (the surface's map just replaced: the volume's settings put back: src/pooltiles.js)

		}
		if ( ! pt ) delete this.scene.userData.ptEnvPower;
		if ( pt && this._renderer ) this.ocean.updatePT( this._renderer, clock.now() / 1000 );		// (the path tracer's sea now; per sample: _ptSeaAttach)
		this.updateLights();

	}

	/**
	 * The path tracer's open sea (src/ptpatch.js patchSea: scene.userData.ptSea) and the disc (ptSun), while this
	 * venue is active. The sea's time, per sample (beforeSample( k ), k the sample about to be drawn):
	 *   live (the page path traces)   held while it accumulates, taken anew when it starts over (k 0: a camera
	 *                                 move, a rebuild): the image converges on one instant of the sea
	 *   offline (#?pt=…, a frame)     the frame's time (the render clock: every worker the same sea); with
	 *                                 #?pts=<s> (tools/render-video.mjs --pt-shutter) each sample its own time
	 *                                 across a shutter open s of the frame, ending at it (a golden-ratio
	 *                                 sequence: any prefix spread over it): the glints' motion blur
	 */
	_ptSeaAttach() {

		const U = this.materials.backdrop.userData.u, oc = this.ocean;
		const P = POOL;
		this._ptSeaU ??= {
			...oc.ptUniforms,
			ptSeaY: { value: SKY.seaY }, ptSeaPhotoDep: { value: SKY.photoDep ?? 0.012 },
			// (the venue's own water and floors: the far wall's outer face, round the glass's centre)
			ptSeaHole: { value: new THREE.Vector3( GLASS.cx, GLASS.cz, P.r1 + 0.25 ) },
			ptSeaColor: U.uSeaColor, ptSeaExt: U.uSeaExt, ptSeaExtScale: U.uSeaExtScale,
			ptSeaTint: { value: this.materials.backdrop.color },		// (the backdrop's colour: its tint × sky, as the raster's)
			ptSunSeaGain: { value: new THREE.Vector3( 1, 1, 1 ) },
			ptSeaVis: U.uSeaVis,		// (km: the marine haze, as the raster's)
		};
		let t0 = 0;
		const shutter = RENDER_OPTS?.ptShutter ?? 0, dt = RENDER_OPTS ? 1 / RENDER_OPTS.fps : 0;
		this.scene.userData.ptSea = {
			uniforms: this._ptSeaU,
			beforeSample: k => {

				const r = this._renderer;
				if ( ! r ) return;
				const now = clock.now() / 1000;
				let t;
				if ( RENDER_OPTS ) t = shutter > 0 ? now - shutter * dt * ( 1 - ( ( 0.5 + k * 0.6180339887498949 ) % 1 ) ) : now;
				else { if ( k === 0 ) t0 = now; t = t0; }
				oc.updatePT( r, t );

			},
		};
		this.scene.userData.ptSun = { omc: 0 };

	}

	/** The disc's size and its glitter's strength for the path tracer (updateLights). */
	_ptSeaLight( L ) {

		const sun = this.scene.userData.ptSun;
		if ( ! sun || ! this._ptSeaU ) return;
		const R = L.moon ? 0.0115 : 0.0135;		// (the backdrop's drawn disc: its R)
		sun.omc = 1 - Math.cos( R );
		// after a sea bounce the disc's light × this: the raster's glitter (src/azurea.js backdrop: uGlitter × the
		// drawn disc's irradiance π R² × 14 (9 the moon) × its colour) over the light's own (intensity × colour)
		const U = this.materials.backdrop.userData.u, d = U.uDiscColor.value, c = this.sunPT.color, I = Math.max( this.sunPT.intensity, 1e-6 );
		const k = ( L.glitter ?? 0 ) * Math.PI * R * R * ( L.moon ? 9 : 14 ) / I;
		this._ptSeaU.ptSunSeaGain.value.set( k * d.r / Math.max( c.r, 1e-4 ), k * d.g / Math.max( c.g, 1e-4 ), k * d.b / Math.max( c.b, 1e-4 ) );

	}

	/**
	 * The dome and the backdrop captured as an equirect map from the eye on the room's axis: the path tracer's
	 * environment and background (the sea through the glass, its light in the room). Kept until the sky changes.
	 */
	skyEnvironment( width = 4096 ) {

		const key = this._outsideKey() + width;
		if ( this._skyEnv?.key === key ) { this.scene.userData.ptEnvPower = this._skyEnv.power; return this._skyEnv.texture; }
		if ( ! this.dome ) return null;
		const env = this._capture( width );
		this._skyEnv?.texture.dispose();
		// its power through the glass (for the path tracer's share between the lights and it: src/ptpatch.js): the
		// mean luminance of its middle band times pi times the glass's area (at night faint: the lights' share up)
		const d = env.image.data, W = env.image.width, Hh = env.image.height, f = THREE.DataUtils.fromHalfFloat;
		let sum = 0, n = 0;
		if ( d ) for ( let y = Math.floor( Hh / 3 ); y < Math.floor( 2 * Hh / 3 ); y += 4 ) for ( let x = 0; x < W; x += 8 ) { const i = 4 * ( y * W + x ); sum += 0.2126 * f( d[ i ] ) + 0.7152 * f( d[ i + 1 ] ) + 0.0722 * f( d[ i + 2 ] ); n ++; }
		const area = GLASS.r * ( GLASS.a1 - GLASS.a0 ) * ( H - 0.16 );
		this._skyEnv?.background?.dispose();
		// the background (camera rays, and through glass: the sky as drawn, the disc in it) and the environment
		// (what a bounce finds: the disc's light is the directional light's now, its core taken out, the halo
		// kept; below the horizon the sea itself, path traced: nothing there, so the environment's sampling
		// spends nothing on it)
		const bg = Object.assign( new THREE.DataTexture( d.slice(), W, Hh, THREE.RGBAFormat, THREE.HalfFloatType ), { minFilter: env.minFilter, magFilter: env.magFilter, wrapS: env.wrapS, wrapT: env.wrapT, mapping: env.mapping, needsUpdate: true } );
		if ( d ) this._ptEnvEdit( env );
		this._skyEnv = { key, texture: env, background: bg, power: sum / Math.max( n, 1 ) * Math.PI * area };
		this.scene.userData.ptEnvPower = this._skyEnv.power;
		return env;

	}

	/** The preset's sea state for src/ocean.js (stepped: a fade between presets recomputes the spectrum at most ~20 times). */
	_seaState() {

		const L = this.light ?? {}, q = ( v, d, st ) => Math.round( ( v ?? d ) / st ) * st;
		return { wind: q( L.wind, 3, 0.1 ), windDir: q( L.windDir, 90, 1 ) * D, swell: q( L.swell, 0, 0.01 ), swellDir: q( L.swellDir, 90, 1 ) * D, swellPeriod: q( L.swellPeriod, 9, 0.1 ) };

	}

	/**
	 * The path tracer's environment from the capture (half floats, in place): below the horizon black, and the
	 * drawn disc's core (its R and a texel) filled from just outside it, radially (the halo's falloff continued).
	 * Rows: v = 1 - acos( y ) / π, row 0 the bottom (three-gpu-pathtracer's equirectDirectionToUv).
	 */
	_ptEnvEdit( env ) {

		const d = env.image.data, W = env.image.width, Hh = env.image.height, f = THREE.DataUtils.fromHalfFloat, h = THREE.DataUtils.toHalfFloat;
		const zero = h( 0 );
		for ( let y = 0; y < Math.floor( Hh / 2 ); ++ y ) for ( let x = 0; x < W; ++ x ) { const i = 4 * ( y * W + x ); d[ i ] = d[ i + 1 ] = d[ i + 2 ] = zero; }
		const L = this.light;
		if ( ! ( ( L.disc ?? 0 ) > 0 ) ) { env.needsUpdate = true; return; }
		const s = this.sunDirection().normalize(), R = ( L.moon ? 0.0115 : 0.0135 ) + 2 * Math.PI / W;
		const dirOf = ( x, y ) => {

			const u = ( x + 0.5 ) / W, v = ( y + 0.5 ) / Hh, ph = ( u - 0.5 ) * 2 * Math.PI, th = ( 1 - v ) * Math.PI;
			return V( Math.sin( th ) * Math.cos( ph ), Math.cos( th ), Math.sin( th ) * Math.sin( ph ) );

		};
		const texOf = v => {

			const u = Math.atan2( v.z, v.x ) / ( 2 * Math.PI ) + 0.5, w = 1 - Math.acos( THREE.MathUtils.clamp( v.y, - 1, 1 ) ) / Math.PI;
			return [ Math.min( W - 1, Math.max( 0, Math.floor( u * W ) ) ), Math.min( Hh - 1, Math.max( 0, Math.floor( w * Hh ) ) ) ];

		};
		const [ cx, cy ] = texOf( s ), span = Math.ceil( R / ( Math.PI / Hh ) ) + 2, spanX = Math.ceil( span / Math.max( Math.sqrt( 1 - s.y * s.y ), 0.05 ) );
		const out = V(), axis = V();
		for ( let y = cy - span; y <= cy + span; ++ y ) {

			if ( y < 0 || y >= Hh ) continue;
			for ( let xx = cx - spanX; xx <= cx + spanX; ++ xx ) {

				const x = ( ( xx % W ) + W ) % W, dv = dirOf( x, y ), a = Math.acos( THREE.MathUtils.clamp( dv.dot( s ), - 1, 1 ) );
				if ( a >= R ) continue;
				// (the same bearing from the disc's centre, just outside its edge)
				axis.crossVectors( s, dv ); if ( axis.lengthSq() < 1e-12 ) axis.set( 0, 1, 0 ).cross( s );
				axis.normalize();
				out.copy( s ).applyAxisAngle( axis, R * 1.08 );
				const [ ox, oy ] = texOf( out ), j = 4 * ( oy * W + ox ), i = 4 * ( y * W + x );
				for ( let c = 0; c < 3; ++ c ) d[ i + c ] = h( f( d[ j + c ] ) );

			}

		}
		env.needsUpdate = true;

	}

	/** What the captured sky depends on (the water's reflection, the path tracer's environment). */
	_outsideKey() {

		const L = this.light;
		return JSON.stringify( [ L.outside, L.sky, L.haze, L.skyHue, L.clouds, L.stars, L.airglow, L.tint, L.sunAz, L.sunEl, L.sunColor, L.moon, L.disc, L.glitter, L.sunCore, L.moonCore, L.seaVis, this._seaState(), this.materials.backdrop.map?.uuid ?? null, !! this.skyPhotos ] );

	}

	/** The dome and the backdrop as an equirect map, from the eye on the room's axis. */
	_capture( width ) {

		const r = this.baker.renderer, face = width / 4;
		this.ocean.update( r, clock.now() / 1000 );		// (its textures drawn before the capture reads them)
		this.sky.update( r );
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
		this._renderer = renderer;
		this.poolWater?.update( renderer, t );		// (the pool's surface stepped to t: the render clock offline, a pure function of it)
		this.materials.backdrop.userData.u.uTime.value = t;		// (the glints' draws)
		this.ocean.update( renderer, t );		// (the sea's surface at t: a pure function of the render clock)
		this.sky.update( renderer );		// (its LUTs, if the light or the haze changed)
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
		this._loadSky().catch( e => console.warn( `Azurea: the sky's mattes / moon: ${ e.message ?? e }` ) );
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

	/** The photos' land mattes and their skies' brightness (tools/azurea-sky-matte.py), the moon's face (tools/azurea-moon.py). */
	async _loadSky() {

		const dir = packDir(), tl = new THREE.TextureLoader();
		const tex = f => new Promise( ( ok, no ) => tl.load( new URL( f, dir ).href, ok, undefined, no ) );
		const res = await fetch( new URL( 'sky-matte.json', dir ) );
		if ( ! res.ok ) throw new Error( `sky-matte.json: HTTP ${ res.status }` );
		const meta = await res.json(), photos = {};
		for ( const [ k, slug ] of [ [ 'day', 'sea' ], [ 'sunset', 'sea-sunset' ], [ 'night', 'sea-night' ] ] ) {

			const p = meta.photos[ slug ];
			if ( ! p ) continue;
			const t = await tex( `${ slug }-matte.png` );
			// (as the photo: glTF's, not flipped; data; no mipmaps: read in branches)
			Object.assign( t, { flipY: false, colorSpace: THREE.NoColorSpace, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping } );
			t.needsUpdate = true;
			photos[ k ] = { matte: t, band: p.band, profile: p.profile };		// (its clear sky's mean over 5..30 deg: the sky's brightness; its hue by elevation)

		}
		const moon = await tex( 'moon.png' );
		Object.assign( moon, { colorSpace: THREE.NoColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, anisotropy: 4 } );		// (1024²: mipmapped, the disc ~20 px at a normal fov)
		moon.needsUpdate = true;
		this.sky.setMoonTexture( moon );
		this.skyPhotos = photos;
		this.updateLights();

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
		const marble = map( 'marble' ), bottles = map( 'bottle-wall' );
		// the sea by day, at golden hour, at night (one coastline); updateLights picks the hour's
		this.seas = {};
		for ( const [ k, slug ] of [ [ 'day', 'sea' ], [ 'sunset', 'sea-sunset' ], [ 'night', 'sea-night' ] ] ) {

			const t = map( slug );
			if ( ! t ) continue;
			t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
			this.seas[ k ] = t;

		}
		if ( this.seas.day ) { M.backdrop.map = this.seas.day; M.backdrop.needsUpdate = true; }
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

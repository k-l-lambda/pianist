// Luminara: the white grand's venue, a round music salon (after Footages.local/Luminara/f7a6e53c-...png):
// white fluted walls in twelve bays (tall round windows onto a city above the clouds, built-in lit
// shelving with ornaments, the treble clef and its staff as a light (neon acrylic) across from the
// player over a sideboard, the doors behind), a ceiling stepping up in rings, each lit at its edge,
// to a glowing dome over the piano, a mirror-polished marble floor (a planar reflection), a rug
// under the piano, a low lounge set round the wall.
// Built here, procedurally; its furniture, ornaments and textures from the pack
// (public/luminara/luminara.glb, tools/luminara-asset.mjs: TRELLIS meshes of generated photos),
// loaded when it is first entered (the room shows at once, they when there).
//
// Frame: world, the piano at the origin (its centre under the dome), the player towards +z. An
// angle φ round the room as three's LatheGeometry: a point (r sin φ, y, r cos φ); φ 0 behind the
// player (the doors), π across the piano (the clef).
// A venue (see room.js): group, lights, presets, light, place(), probePoint(), ...

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLYPHS } from './luminaraglyphs.js';

export const LUMINARA = {
	radius: 6.5,		// the wall
	wall: 3.4,			// its height, to the cornice
	bays: 12,
	pilaster: 0.36,		// wide
	floorTile: 1.8,		// the marble's repeat (m)
};
const R = LUMINARA.radius, BAY = 2 * Math.PI / LUMINARA.bays;

// what each bay holds (k: its centre at φ = k BAY): its opening in the wall (s across, y up, m;
// `circle`: a round window; `arch`: half width a, from y0, its semicircle springing at yS; `rect`:
// half width a, y0 to y1, corners rounded rc; `none`: the plain wall), how deep (to the back: a
// flat panel; a window goes through)
const OPENINGS = {
	window: { shape: 'circle', a: 1.38, yc: 1.82, depth: 0.36 },		// (almost from the floor to the cornice)
	shelves: { shape: 'rect', a: 1.22, y0: 0.32, y1: 3.12, rc: 0.16, depth: 0.42 },		// (built-in, four shelves)
	pipes: { shape: 'arch', a: 0.62, y0: 0.5, yS: 2.3, depth: 0.32 },		// (a row of lit pipes, as an organ's)
	clef: { shape: 'none' },		// (the clef and its staff: a light on the wall)
	door: { shape: 'arch', a: 0.9, y0: 0, yS: 2.3, depth: 0.18 },
};
const BAYS = [ 'door', 'window', 'shelves', 'window', 'pipes', 'window', 'clef', 'window', 'pipes', 'window', 'shelves', 'window' ];

// the ceiling: soffits stepping in and up to the dome; each step's edge a line of light (LED), the
// riser behind it washed from its foot: [ r of the lip, y of the soffit ]
const STEPS = [ [ 5.45, 3.8 ], [ 4.2, 4.35 ], [ 2.95, 4.9 ] ];
const DOME = { y: 5.45, rise: 1.0 };		// from the last riser's top, to its crown
const LIP = 0.06, GAP = 0.07;
const DOME_SPOTS = [ 35, - 35, 145, - 145 ];		// φ (deg) of the dome's spots: the first the keys' shadow

// the furniture: [ the pack's node, φ (deg), r (null: its back on the wall), turn (deg, about its own up) ]
const FURNITURE = [
	[ 'sofa-low', 90, 5.55, 0 ], [ 'sofa-low', - 90, 5.55, 0 ],
	[ 'tub-chair', 45, 5.3, 0 ], [ 'tub-chair', 135, 5.3, 0 ], [ 'tub-chair', - 45, 5.3, 0 ], [ 'tub-chair', - 135, 5.3, 0 ],
	[ 'side-table', 63, 5.85, 0 ], [ 'side-table', 117, 5.85, 0 ], [ 'side-table', - 63, 5.85, 0 ], [ 'side-table', - 117, 5.85, 0 ],
	[ 'plant', 159, 5.75, 0 ], [ 'plant', - 159, 5.75, 40 ], [ 'plant', 22, 5.75, 80 ], [ 'plant', - 22, 5.75, 120 ],
	[ 'sideboard', 180, null, 0 ],
];
// on the sideboard: [ node, x along it (fraction of its half length), turn (deg) ]
const ON_SIDEBOARD = [ [ 'table-lamp', 0.74, 0 ], [ 'roses', - 0.66, 0 ], [ 'gold-disc', 0.18, - 12 ], [ 'books', - 0.18, 0 ] ];		// (the lamp clear of the clef, on the left)
// in the shelving: per shelf (bottom up), per compartment (left to right): ornaments [ node, x in it (-1..1), turn ]
const SHELVING = [
	[ [ [ 'books', 0, 0 ] ], [ [ 'roses', 0, 0 ] ], [ [ 'books', 0, 0 ] ] ],
	[ [ [ 'crystal', - 0.3, 0 ], [ 'gold-ribbon', 0.4, 20 ] ], [ [ 'clef-statue', 0, 0 ] ], [ [ 'gold-disc', 0, - 15 ] ] ],
	[ [ [ 'gold-disc', 0, 15 ] ], [ [ 'books', 0, 0 ] ], [ [ 'gold-ribbon', - 0.35, - 20 ], [ 'crystal', 0.35, 0 ] ] ],
	[ [ [ 'clef-statue', 0, 0 ] ], [ [ 'crystal', - 0.4, 0 ], [ 'gold-ribbon', 0.35, 30 ] ], [ [ 'roses', 0, 0 ] ] ],
];
const COFFEE = [ [ 90, 4.3 ], [ - 90, 4.3 ] ];		// drum coffee tables before the sofas (built here)

// Lit as such a room would be, by its own fixtures (no stage spots but in Recital): the coves and the
// dome (emissive: their light reaches the room through the probe, `env`), a downlight in the first
// soffit over each bay washing its wall (`washer`, cd), four spots in the dome's rim on the piano
// (`dome`, cd; the first, from the player's right, casts the keys' shadows), a sconce on each pilaster
// (a frosted tube: `sconce`, its glow on the walls round it too), the niches' own lights, the lines
// of light in three tiers (led: the ceiling's, the main ones and the only ones blooming; ledWall: the
// walls' ornament; ledFloor), the windows' outside one of four hours (`outside`; the probe sees it).
// Warm: 2700-3000 K. Bloom faint (a bright room: more reads overexposed). ACES keeps the contrast.
export const LUMINARA_PRESETS = {
	'Afternoon': { baked: true, outside: 'day', sky: 1.25, cove: 1.6, coveColor: '#ffc98c', washer: 70, dome: 130, downColor: '#ffd3a0', sconce: 5, sconceColor: '#ffdcb0', niche: 1.0, nicheColor: '#ffc684', led: 12, ledWall: 2.8, ledFloor: 1.1, ledColor: '#ffc98a', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.75, exposure: 0.5, tone: 'ACES', saturation: 1.0, bloom: 0.1, bloomThreshold: 8 },
	'Golden hour': { baked: true, outside: 'sunset', sky: 1.1, cove: 1.8, coveColor: '#ffc283', washer: 70, dome: 120, downColor: '#ffcd95', sconce: 5.5, sconceColor: '#ffd6a4', niche: 1.1, nicheColor: '#ffc07a', led: 13, ledWall: 3, ledFloor: 1.2, ledColor: '#ffc283', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.7, exposure: 0.52, tone: 'ACES', saturation: 1.0, bloom: 0.1, bloomThreshold: 8 },
	'Blue hour': { baked: true, outside: 'dusk', sky: 0.9, cove: 2.0, coveColor: '#ffc98c', washer: 80, dome: 130, downColor: '#ffd3a0', sconce: 6, sconceColor: '#ffdcb0', niche: 1.2, nicheColor: '#ffc684', led: 14, ledWall: 3.2, ledFloor: 1.3, ledColor: '#ffc98a', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.62, exposure: 0.55, tone: 'ACES', saturation: 1.0, bloom: 0.12, bloomThreshold: 8 },
	'Night': { baked: true, outside: 'night', sky: 0.75, cove: 2.2, coveColor: '#ffc283', washer: 85, dome: 140, downColor: '#ffcd95', sconce: 6.5, sconceColor: '#ffd6a4', niche: 1.3, nicheColor: '#ffc07a', led: 15, ledWall: 3.4, ledFloor: 1.4, ledColor: '#ffc283', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.55, exposure: 0.58, tone: 'ACES', saturation: 1.0, bloom: 0.12, bloomThreshold: 8 },
	// the house down, the piano under a single spot from the dome's crown
	'Recital': { baked: true, outside: 'night', sky: 0.5, cove: 0.5, coveColor: '#ffc283', washer: 0, dome: 0, downColor: '#ffcd95', sconce: 1.6, sconceColor: '#ffd6a4', niche: 0.4, nicheColor: '#ffc07a', led: 4, ledWall: 1.1, ledFloor: 0.5, ledColor: '#ffc283', top: 900, topColor: '#fff0dc', topAngle: 15, env: 0.3, exposure: 0.6, tone: 'ACES', saturation: 1.05, bloom: 0.12, bloomThreshold: 8 },
};
export const LUMINARA_OUTSIDE = [ 'day', 'sunset', 'dusk', 'night' ];

const phys = p => new THREE.MeshPhysicalMaterial( p );

/** The staff round the first riser: five wavy lines and notes, white on black (additive), one repeat. */
function staffTexture() {

	const W = 2048, H = 256, c = document.createElement( 'canvas' );
	c.width = W; c.height = H;
	const g = c.getContext( '2d' ), wave = x => 18 * Math.sin( 2 * Math.PI * x / W ), line = k => 70 + 26 * k;
	g.fillStyle = '#000'; g.fillRect( 0, 0, W, H );
	g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 3;
	for ( let k = 0; k < 5; ++ k ) { g.beginPath(); for ( let x = 0; x <= W; x += 8 ) g[ x ? 'lineTo' : 'moveTo' ]( x, line( k ) + wave( x ) ); g.stroke(); }
	// notes: heads (tilted ellipses) on lines and spaces, stems, a beam for each pair
	let seed = 3;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( let x = 120; x < W - 80; x += 150 ) {

		const pair = rnd() < 0.5, heads = [];
		for ( let j = 0; j < ( pair ? 2 : 1 ); ++ j ) {

			const hx = x + 60 * j, hy = line( 0 ) - 13 + 13 * Math.floor( rnd() * 9 ) + wave( hx );
			g.save(); g.translate( hx, hy ); g.rotate( - 0.35 ); g.beginPath(); g.ellipse( 0, 0, 12, 8.5, 0, 0, 2 * Math.PI ); g.fill(); g.restore();
			g.fillRect( hx + 10, hy - 70, 3, 70 );
			heads.push( [ hx + 10, hy - 70 ] );

		}
		if ( pair ) { g.lineWidth = 9; g.beginPath(); g.moveTo( heads[ 0 ][ 0 ], heads[ 0 ][ 1 ] ); g.lineTo( heads[ 1 ][ 0 ] + 3, heads[ 1 ][ 1 ] ); g.stroke(); g.lineWidth = 3; }
		else { g.beginPath(); g.moveTo( heads[ 0 ][ 0 ] + 3, heads[ 0 ][ 1 ] ); g.quadraticCurveTo( heads[ 0 ][ 0 ] + 26, heads[ 0 ][ 1 ] + 22, heads[ 0 ][ 0 ] + 18, heads[ 0 ][ 1 ] + 46 ); g.stroke(); }

	}
	const t = new THREE.CanvasTexture( c );
	t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
	return t;

}

const NOBAKE = /(^|[#&?])nobake(&|$)/.test( location.hash + '&' ) || /(^|[?&])nobake(&|=|$)/.test( location.search );		// (tools/luminara-bake.mjs: the procedural shell)

/** Another onBeforeCompile on `material`, after its others (each its part of the program's key). */
function chainCompile( material, fn, key ) {

	const prev = material.onBeforeCompile;
	material.onBeforeCompile = ( shader, renderer ) => { prev.call( material, shader, renderer ); fn( shader ); };
	material.userData.programKeys = [ ...( material.userData.programKeys ?? [] ), key ];
	material.customProgramCacheKey = () => material.userData.programKeys.join( '+' );

}

/**
 * The baked light (tools/luminara-bake.mjs: one lightmap per preset, its UVs `uvBake`) as `material`'s
 * diffuse irradiance (in place of the probe's: the map has all of it, the probe's left to the
 * specular). `U`: the uniforms (shared: the map shown, its scale, on).
 */
function addBake( material, U ) {

	chainCompile( material, shader => {

		Object.assign( shader.uniforms, U );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nattribute vec2 uvBake;\nvarying vec2 vUvBake;' )
			.replace( '#include <uv_vertex>', '#include <uv_vertex>\nvUvBake = uvBake;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>\nuniform sampler2D uBake;\nuniform float uBakeScale, uBakeOn;\nvarying vec2 vUvBake;' )
			.replace( '#include <lights_fragment_maps>', `#include <lights_fragment_maps>
			if ( uBakeOn > 0.5 ) { iblIrradiance = vec3( 0.0 ); irradiance += texture2D( uBake, vUvBake ).rgb * uBakeScale; }` );

	}, 'luminaraBake' );

}

/**
 * `material` lit by the sconces too (cheaply, as line lights: each tube a segment, its light to the
 * nearest point on it, cos / d², diffuse only, no shadow): the walls and the lacquer round them, which
 * real lights for twelve sconces would cost every material in the room. `U`: the uniforms (shared).
 */
function addSconceGlow( material, U ) {

	chainCompile( material, shader => {

		Object.assign( shader.uniforms, U );
		shader.defines = { ...shader.defines, SCONCES: U.uSconceA.value.length };
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>\nuniform vec3 uSconceA[ SCONCES ];\nuniform vec3 uSconceB[ SCONCES ];\nuniform vec3 uSconceColor;\nuniform float uSconceOff;' )
			.replace( '#include <lights_fragment_end>', `for ( int i = 0; i < SCONCES; i ++ ) {

				vec3 a = ( viewMatrix * vec4( uSconceA[ i ], 1.0 ) ).xyz, b = ( viewMatrix * vec4( uSconceB[ i ], 1.0 ) ).xyz, ab = b - a;
				vec3 q = a + clamp( dot( geometryPosition - a, ab ) / dot( ab, ab ), 0.0, 1.0 ) * ab - geometryPosition;
				float l2 = max( dot( q, q ), 0.012 );
				reflectedLight.directDiffuse += ( 1.0 - uSconceOff ) * BRDF_Lambert( material.diffuseColor ) * uSconceColor * max( dot( geometryNormal, q * inversesqrt( l2 ) ), 0.0 ) / l2;		// (baked: in the map)

			}
			#include <lights_fragment_end>` );

	}, 'luminaraSconces' );

}

/**
 * A potted palm's fronds (an areca's, as in the reference): stems arching up and out of the pot, each
 * a feather of narrow leaflets (folded along their middle, drooping more towards the tip), one
 * geometry with vertex colour (the stems' and the leaflets', each frond's a little different); its
 * base at the origin, the soil's level.
 */
function palmGeometry( seed = 5, fronds = 15 ) {

	let s = seed;
	const rnd = () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647;
	const P = [], C = [], I = [], up = new THREE.Vector3( 0, 1, 0 ), col = new THREE.Color();
	const vert = ( p, c ) => { P.push( p.x, p.y, p.z ); C.push( c.r, c.g, c.b ); return P.length / 3 - 1; };
	const stemCol = new THREE.Color( '#6f7d43' );
	for ( let f = 0; f < fronds; ++ f ) {

		const yaw = 2 * Math.PI * ( f + 0.4 * rnd() ) / fronds, tilt = 0.2 + 0.6 * ( f % 3 ) / 2 + 0.15 * rnd(), L = 1.15 + 0.45 * rnd();
		const h = new THREE.Vector3( Math.cos( yaw ), 0, Math.sin( yaw ) );
		const p0 = h.clone().multiplyScalar( 0.035 ), p1 = p0.clone().addScaledVector( up, L * 0.62 ).addScaledVector( h, L * 0.28 * Math.sin( tilt ) );
		const p2 = p0.clone().addScaledVector( up, L * ( 0.82 - 0.38 * tilt ) ).addScaledVector( h, L * ( 0.3 + 0.55 * Math.sin( tilt ) ) );
		const curve = new THREE.QuadraticBezierCurve3( p0, p1, p2 );
		// the stem: a thin tube, tapering
		const NS = 14, ring = 5, base = P.length / 3;
		for ( let i = 0; i <= NS; ++ i ) {

			const t = i / NS, c = curve.getPoint( t ), T = curve.getTangent( t ), n = new THREE.Vector3().crossVectors( T, Math.abs( T.y ) > 0.99 ? h : up ).normalize(), b = new THREE.Vector3().crossVectors( n, T ), r = 0.011 * ( 1 - 0.75 * t );
			for ( let k = 0; k < ring; ++ k ) { const a = 2 * Math.PI * k / ring; vert( c.clone().addScaledVector( n, r * Math.cos( a ) ).addScaledVector( b, r * Math.sin( a ) ), stemCol ); }

		}
		for ( let i = 0; i < NS; ++ i ) for ( let k = 0; k < ring; ++ k ) { const a = base + i * ring + k, b = base + i * ring + ( k + 1 ) % ring; I.push( a, b, b + ring, a, b + ring, a + ring ); }
		// the leaflets
		const green = new THREE.Color().setHSL( 0.24 + 0.04 * rnd(), 0.38 + 0.12 * rnd(), 0.27 + 0.07 * rnd() );
		for ( let t = 0.26; t < 0.985; t += 0.016 ) {

			const c = curve.getPoint( t ), T = curve.getTangent( t ), side = new THREE.Vector3().crossVectors( T, Math.abs( T.y ) > 0.99 ? h : up ).normalize(), u = Math.max( 0, ( t - 0.26 ) / 0.725 );		// (0..1 along the leaflets)
			const len = 0.05 + 0.27 * Math.pow( Math.sin( Math.PI * Math.min( 1, u * 1.15 ) ), 0.7 ), wid = 0.012 + 0.005 * Math.sin( Math.PI * u );
			for ( const sg of [ - 1, 1 ] ) {

				const a = 0.55 + 0.15 * rnd();		// forward, towards the tip
				const d = side.clone().multiplyScalar( sg * Math.cos( a ) ).addScaledVector( T, Math.sin( a ) ).addScaledVector( up, - ( 0.45 + 0.75 * u ) ).normalize();
				const w = new THREE.Vector3().crossVectors( d, up );
				if ( w.lengthSq() < 1e-6 ) w.copy( side ); else w.normalize();		// (a leaflet hanging straight down: across the stem)
				const tint = col.copy( green ).offsetHSL( 0, 0, 0.04 * ( rnd() - 0.5 ) + 0.06 * u );
				const rows = [];
				for ( let k = 0; k <= 4; ++ k ) {

					const q = k / 4, wk = wid * [ 0.25, 0.85, 1, 0.65, 0 ][ k ];
					const m = c.clone().addScaledVector( d, len * q ).addScaledVector( up, - 0.12 * len * q * q );		// (its own droop)
					const lift = up.clone().multiplyScalar( 0.3 * wk );		// (folded: the edges up)
					rows.push( [ vert( m.clone().addScaledVector( w, wk ).add( lift ), tint ), vert( m, tint ), vert( m.clone().addScaledVector( w, - wk ).add( lift ), tint ) ] );

				}
				for ( let k = 0; k < 4; ++ k ) for ( let j = 0; j < 2; ++ j ) { const a = rows[ k ][ j ], b = rows[ k ][ j + 1 ], c2 = rows[ k + 1 ][ j + 1 ], d2 = rows[ k + 1 ][ j ]; I.push( a, b, c2, a, c2, d2 ); }

			}

		}

	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) );
	g.setAttribute( 'color', new THREE.Float32BufferAttribute( C, 3 ) );
	g.setIndex( I );
	g.computeVertexNormals();
	return g;

}

/** A tileable normal map of a wool pile (fine random tufts), for the rug. */
function fibreNormalMap() {

	const N = 256, h = new Float32Array( N * N );
	let seed = 11;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( let k = 0; k < 2600; ++ k ) {		// tufts: small soft bumps

		const cx = rnd() * N, cy = rnd() * N, r = 1.5 + 2.5 * rnd(), a = 0.5 + 0.5 * rnd();
		for ( let dy = - 6; dy <= 6; ++ dy ) for ( let dx = - 6; dx <= 6; ++ dx ) {

			const d = Math.hypot( dx, dy ) / r;
			if ( d < 1.5 ) h[ ( ( Math.floor( cy ) + dy + N ) % N ) * N + ( Math.floor( cx ) + dx + N ) % N ] += a * Math.exp( - 2 * d * d );

		}

	}
	const data = new Uint8Array( 4 * N * N ), at = ( x, y ) => h[ ( ( y + N ) % N ) * N + ( x + N ) % N ];
	for ( let y = 0; y < N; ++ y ) for ( let x = 0; x < N; ++ x ) {

		const dx = ( at( x + 1, y ) - at( x - 1, y ) ) * 0.8, dy = ( at( x, y + 1 ) - at( x, y - 1 ) ) * 0.8, l = Math.hypot( dx, dy, 1 ), k = 4 * ( y * N + x );
		data.set( [ Math.round( 255 * ( 0.5 - 0.5 * dx / l ) ), Math.round( 255 * ( 0.5 - 0.5 * dy / l ) ), Math.round( 255 * ( 0.5 + 0.5 / l ) ), 255 ], k );

	}
	const t = new THREE.DataTexture( data, N, N );
	t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set( 18, 18 );
	t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
	return t;

}

/**
 * The floor's reflection: the scene drawn once a frame from the camera mirrored in the floor (y 0;
 * an oblique near plane on it: nothing below), into a half-float target with mipmaps; the floor's
 * materials read it where it has the reflected ray (its blurred levels for their roughness) in place
 * of the probe's (which, from one point, puts the windows' reflections in the wrong places). As
 * three's Reflector, but for physical materials.
 */
class FloorMirror {

	constructor() {

		this.target = new THREE.WebGLRenderTarget( 4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter } );
		this.camera = new THREE.PerspectiveCamera();
		this.uniforms = { uMirror: { value: this.target.texture }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 }, uMirrorLods: { value: 1 } };
		this.enabled = true;
		this._busy = false;

	}

	/** `material` reads the reflection. */
	addTo( material ) {

		const U = this.uniforms;
		chainCompile( material, shader => {

			Object.assign( shader.uniforms, U );
			shader.vertexShader = shader.vertexShader
				.replace( '#include <common>', '#include <common>\nvarying vec3 vMirrorWorld;' )
				.replace( '#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMirrorWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
			shader.fragmentShader = shader.fragmentShader
				.replace( '#include <common>', '#include <common>\nuniform sampler2D uMirror;\nuniform mat4 uMirrorMatrix;\nuniform float uMirrorOn, uMirrorLods;\nvarying vec3 vMirrorWorld;' )
				.replace( '#include <lights_fragment_maps>', `#include <lights_fragment_maps>
				if ( uMirrorOn > 0.5 ) {

					vec4 mp = uMirrorMatrix * vec4( vMirrorWorld, 1.0 );
					vec2 muv = mp.xy / mp.w;
					// (the normal map's tilt shifts it a little)
					muv += ( normal.xy - geometryNormal.xy ) * 0.03;
					if ( mp.w > 0.0 && all( greaterThan( muv, vec2( 0.0 ) ) ) && all( lessThan( muv, vec2( 1.0 ) ) ) ) {

						radiance = textureLod( uMirror, muv, sqrt( material.roughness ) * uMirrorLods * 0.75 ).rgb;
						#ifdef USE_CLEARCOAT
							clearcoatRadiance = textureLod( uMirror, muv, sqrt( material.clearcoatRoughness ) * uMirrorLods * 0.75 ).rgb;
						#endif

					}

				}` );

		}, 'luminaraMirror' );

	}

	/** Draw the reflection for `camera` (once a frame; `hide`: the floor itself; `scale`: of the drawing buffer). */
	update( renderer, scene, camera, hide, scale ) {

		const U = this.uniforms;
		U.uMirrorOn.value = 0;
		if ( ! this.enabled || this._busy ) return;
		const size = renderer.getDrawingBufferSize( new THREE.Vector2() ), w = Math.max( 4, Math.round( size.x * scale ) ), h = Math.max( 4, Math.round( size.y * scale ) );
		if ( this.target.width !== w || this.target.height !== h ) this.target.setSize( w, h );
		U.uMirrorLods.value = Math.log2( Math.max( w, h ) );
		// the camera mirrored in y = 0 (as Reflector: the eye and the look-at point reflected, up likewise)
		camera.updateMatrixWorld();
		const eye = new THREE.Vector3().setFromMatrixPosition( camera.matrixWorld );
		if ( eye.y <= 0.001 ) return;
		const flip = v => v.set( v.x, - v.y, v.z );
		const look = new THREE.Vector3( 0, 0, - 1 ).applyMatrix4( new THREE.Matrix4().extractRotation( camera.matrixWorld ) ).add( eye );
		const up = new THREE.Vector3( 0, 1, 0 ).applyMatrix4( new THREE.Matrix4().extractRotation( camera.matrixWorld ) );
		const vc = this.camera;
		vc.position.copy( flip( eye.clone() ) );
		vc.up.copy( flip( up ) );
		vc.lookAt( flip( look ) );
		vc.near = camera.near; vc.far = camera.far; vc.fov = camera.fov; vc.aspect = camera.aspect; vc.zoom = camera.zoom ?? 1;
		vc.updateMatrixWorld();
		vc.updateProjectionMatrix();
		vc.projectionMatrix.copy( camera.projectionMatrix );
		// the texture matrix: world -> its uv
		U.uMirrorMatrix.value.set( 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1 ).multiply( vc.projectionMatrix ).multiply( vc.matrixWorldInverse );
		// an oblique near plane on the floor (Lengyel)
		const plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ).applyMatrix4( vc.matrixWorldInverse );
		const cp = new THREE.Vector4( plane.normal.x, plane.normal.y, plane.normal.z, plane.constant ), P = vc.projectionMatrix.elements;
		const q = new THREE.Vector4( ( Math.sign( cp.x ) + P[ 8 ] ) / P[ 0 ], ( Math.sign( cp.y ) + P[ 9 ] ) / P[ 5 ], - 1, ( 1 + P[ 10 ] ) / P[ 14 ] );
		cp.multiplyScalar( 2 / cp.dot( q ) );
		P[ 2 ] = cp.x; P[ 6 ] = cp.y; P[ 10 ] = cp.z + 1; P[ 14 ] = cp.w;
		vc.projectionMatrixInverse.copy( vc.projectionMatrix ).invert();
		this._busy = true;
		const was = { target: renderer.getRenderTarget(), xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate, vis: hide.map( o => o.visible ) };
		hide.forEach( o => o.visible = false );
		renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
		renderer.setRenderTarget( this.target );
		renderer.clear();
		renderer.render( scene, vc );
		renderer.setRenderTarget( was.target );
		renderer.xr.enabled = was.xr; renderer.shadowMap.autoUpdate = was.shadow;
		hide.forEach( ( o, i ) => o.visible = was.vis[ i ] );
		this._busy = false;
		U.uMirrorOn.value = 1;

	}

}

/** Outward (f) and the viewer's right (x) at φ, from the centre. */
const outward = phi => new THREE.Vector3( Math.sin( phi ), 0, Math.cos( phi ) );
const rightOf = phi => new THREE.Vector3( - Math.cos( phi ), 0, Math.sin( phi ) );
/** A frame at φ, r out: x the viewer's right, y up, z towards the centre. */
export function frameAt( phi, r, y = 0 ) {

	const x = rightOf( phi ), z = outward( phi ).negate(), o = outward( phi ).multiplyScalar( r ).setY( y );
	return new THREE.Matrix4().makeBasis( x, new THREE.Vector3( 0, 1, 0 ), z ).setPosition( o );

}
/** A point of the wall (the cylinder, radius r) at s across bay φc (right +), y up. */
const onWall = ( phiC, s, y, r = R ) => { const p = phiC - s / R; return new THREE.Vector3( r * Math.sin( p ), y, r * Math.cos( p ) ); };

/** Distance from c along d to the opening's outline. */
function outlineT( o, c, dx, dy ) {

	if ( o.shape === 'circle' ) return o.a;
	if ( o.shape === 'rect' ) {

		const hh = ( o.y1 - o.y0 ) / 2;
		let t = Math.min( Math.abs( dx ) > 1e-9 ? o.a / Math.abs( dx ) : Infinity, Math.abs( dy ) > 1e-9 ? hh / Math.abs( dy ) : Infinity );
		const px = Math.abs( t * dx ), py = Math.abs( t * dy ), cx = o.a - o.rc, cy = hh - o.rc;
		if ( px > cx && py > cy ) {		// a rounded corner: the ray against its circle

			const ax = Math.abs( dx ), ay = Math.abs( dy ), b = ax * cx + ay * cy;
			t = b + Math.sqrt( b * b - ( cx * cx + cy * cy - o.rc * o.rc ) );

		}
		return t;

	}
	const ts = Math.abs( dx ) > 1e-9 ? o.a / Math.abs( dx ) : Infinity;
	if ( dy > 0 ) {

		if ( c[ 1 ] + ts * dy <= o.yS ) return ts;
		const e = c[ 1 ] - o.yS;
		return - e * dy + Math.sqrt( e * e * dy * dy - e * e + o.a * o.a );

	}
	return Math.min( ts, dy < 0 ? ( c[ 1 ] - o.y0 ) / - dy : Infinity );

}
/** The opening's centre (s, y): the point its rays start from. */
const centreOf = o => [ 0, o.shape === 'circle' ? o.yc : o.shape === 'rect' ? ( o.y0 + o.y1 ) / 2 : ( o.y0 + o.yS ) / 2 ];

/** Angles round the opening: uniform, and the bay rectangle's corners (so the panel keeps them). */
function anglesFor( c, hw, h, n = 112 ) {

	const out = [];
	for ( let i = 0; i < n; ++ i ) out.push( 2 * Math.PI * i / n );
	for ( const [ x, y ] of [ [ hw, h ], [ - hw, h ], [ - hw, 0 ], [ hw, 0 ] ] ) out.push( ( Math.atan2( y - c[ 1 ], x - c[ 0 ] ) + 2 * Math.PI ) % ( 2 * Math.PI ) );
	return out.sort( ( a, b ) => a - b );

}

/** Indexed mesh of rings (each an array of [ Vector3, u, v ], all the same length, closed loops). */
function ringsGeometry( rings, flat = false ) {

	const P = [], UV = [], I = [], n = rings[ 0 ].length;
	for ( const ring of rings ) for ( const [ p, u, v ] of ring ) { P.push( p.x, p.y, p.z ); UV.push( u, v ); }
	for ( let j = 0; j < rings.length - 1; ++ j ) for ( let i = 0; i < n; ++ i ) {

		const a = j * n + i, b = j * n + ( i + 1 ) % n, c = ( j + 1 ) * n + ( i + 1 ) % n, d = ( j + 1 ) * n + i;
		I.push( a, b, c, a, c, d );

	}
	let g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( UV, 2 ) );
	g.setIndex( I );
	if ( flat ) g = g.toNonIndexed();
	g.computeVertexNormals();
	return g;

}

/** A vertical gradient (1 x 64, linear): the coves' and the dome's glow along their profiles. */
function gradient( f ) {

	const N = 64, d = new Uint8Array( 4 * N );
	for ( let i = 0; i < N; ++ i ) { const v = Math.round( 255 * Math.min( 1, Math.max( 0, f( i / ( N - 1 ) ) ) ) ); d.set( [ v, v, v, 255 ], 4 * i ); }
	const t = new THREE.DataTexture( d, 1, N );
	t.magFilter = t.minFilter = THREE.LinearFilter;
	t.needsUpdate = true;
	return t;

}

export class Luminara {

	constructor( scene, baker ) {

		this.scene = scene;
		this.baker = baker;
		this.highQuality = true;
		this.presets = LUMINARA_PRESETS;
		this.preset = 'Afternoon';
		this.light = { ...LUMINARA_PRESETS[ this.preset ] };
		this.group = new THREE.Group();
		this.group.name = 'luminara';
		this.lights = new THREE.Group();
		this.lights.name = 'luminaraLights';
		this.active = false;
		this.view = { maxDistance: 5.5, maxPolarAngle: Math.PI * 0.6 };
		this.background = new THREE.Color( '#0b1426' );
		this.pack = null;			// the furniture etc. once loaded (a group)
		this.loading = Promise.resolve();
		this.onLoad = null;		// called once the pack shows (main.js: the probe again)
		this.glow = [];			// the pack's materials glowing with the walls' lines (the clef's raised pattern)
		this.skies = {};		// the windows' outsides, by hour (the pack's)
		this.sconceU = { uSconceA: { value: [] }, uSconceB: { value: [] }, uSconceColor: { value: new THREE.Color() } };
		const black = new THREE.DataTexture( new Uint8Array( 4 ), 1, 1 ); black.needsUpdate = true;
		this.bakeU = { uBake: { value: black }, uBakeScale: { value: 1 }, uBakeOn: { value: 0 } };
		this.sconceU.uSconceOff = this.bakeU.uBakeOn;		// (the same: baked, the sconces' glow is in the map)
		this.bakes = null;		// preset -> { map, scale } (the pack's, while its shell is ours)

		const plaster = baker.plaster();
		const tinted = ( hex, base ) => { const c = new THREE.Color( hex ), b = new THREE.Color( base ); return new THREE.Color( c.r / b.r, c.g / b.g, c.b / b.b ); };
		this.materials = {
			wall: phys( { map: plaster.map, normalMap: plaster.normalMap, normalScale: new THREE.Vector2( 0.5, 0.5 ), roughness: 0.85, color: tinted( '#f1e3cf', '#9aa39a' ), side: THREE.DoubleSide } ),		// (warm cream, as the reference's)
			ceiling: phys( { color: '#f3e8d8', roughness: 0.9, side: THREE.DoubleSide } ),
			// the pilasters, the frames, the shelves, the doors: white lacquer
			lacquer: phys( { color: '#f3ebdf', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide } ),
			// the sconces' frosted tubes: lit through, brightest in the middle
			sconce: phys( { color: '#fbf4ea', roughness: 0.35, clearcoat: 0.6, emissive: new THREE.Color( '#ffdcb0' ), emissiveMap: gradient( v => 0.72 + 0.28 * Math.sin( Math.PI * v ) ) } ),
			brass: phys( { color: '#d6a95c', metalness: 1, roughness: 0.3, side: THREE.DoubleSide } ),
			// the lines of light (LED strips, the windows' and the arches' rings, the pilasters' bars):
			// emissive only, a little in front of what they lie on
			led: new THREE.MeshStandardMaterial( { color: '#000000', roughness: 1, emissive: new THREE.Color( '#ffd9a6' ), emissiveIntensity: 14, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } ),
			ledWall: null, ledFloor: null,		// (the same, dimmer: below)
			// the staff and its notes round the first riser (additive)
			staff: new THREE.MeshBasicMaterial( { map: staffTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } ),
			// the round rug under the piano: wool (its pattern from the pack), a fibre normal map, sheen
			rug: phys( { color: '#f4efe6', roughness: 1, normalMap: fibreNormalMap(), normalScale: new THREE.Vector2( 0.6, 0.6 ), sheen: 1, sheenColor: new THREE.Color( '#fff6ea' ), sheenRoughness: 0.5 } ),
			// the clef and its staff: thick acrylic lit from within (the walls' brightest light, below the bloom)
			neon: phys( { color: '#fff8ee', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, emissive: new THREE.Color( '#ffe2bc' ), emissiveIntensity: 6 } ),
			// the floor (its marble from the pack; plain until then)
			// (polished, not a mirror: the probe's cube, 256 a face, would show its thin lines of light
			// broken into dashes; the reference's floor reflects softly too)
			// (mirror-polished: its reflection a planar one, floorMirror; the probe only where that has nothing)
			floor: phys( { color: '#e6e3de', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 } ),
			border: phys( { color: '#c9c3b8', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 } ),
			inlay: phys( { color: '#d6a95c', metalness: 1, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } ),
			// the risers lit from their lip (bright at the foot), the dome (brighter to its crown, rings)
			cove: phys( { color: '#f2e4d0', roughness: 0.9, emissive: new THREE.Color( '#ffd9a8' ), emissiveMap: gradient( v => 0.12 + 0.88 * Math.exp( - 3.5 * v ) ), side: THREE.DoubleSide } ),
			dome: phys( { color: '#f2e4d0', roughness: 0.9, emissive: new THREE.Color( '#ffd9a8' ), side: THREE.DoubleSide,
				emissiveMap: gradient( v => 0.18 + 0.55 * v * v + [ 0.35, 0.62, 0.84 ].reduce( ( s, c ) => s + 0.35 * Math.exp( - ( ( ( v - c ) / 0.012 ) ** 2 ) ), 0 ) ) } ),
			// the niches' backs and the doors' fanlight: lit from behind
			niche: phys( { color: '#f6eee2', roughness: 0.8, emissive: new THREE.Color( '#ffd29a' ) } ),
			// the city outside (the pack's sky; plain until then)
			sky: new THREE.MeshBasicMaterial( { color: '#33476e', side: THREE.BackSide, fog: false } ),
		};

		this.materials.ledWall = this.materials.led.clone();
		this.materials.ledFloor = this.materials.led.clone();
		for ( const m of [ this.materials.wall, this.materials.lacquer ] ) addSconceGlow( m, this.sconceU );
		this.mirror = new FloorMirror();
		for ( const m of [ this.materials.floor, this.materials.border ] ) this.mirror.addTo( m );
		for ( const m of [ this.materials.wall, this.materials.ceiling, this.materials.lacquer, this.materials.floor, this.materials.border, this.materials.rug ] ) addBake( m, this.bakeU );
		this._buildLights();
		this.rebuild();

	}

	activate() {

		this.active = true;
		this.scene.add( this.group, this.lights );
		if ( ! this._loadTried ) this.load();
		this.updateLights();

	}

	deactivate() {

		this.active = false;
		this.scene.remove( this.group, this.lights );

	}

	get keyLight() { return this.light.top > 0 ? this.topSpot : this.domeSpots[ 0 ]; }
	get specularOff() { return []; }
	get probeHidden() { return []; }		// (the sky in the probe too: else each window is a black hole in the floor's reflection)
	get environment() { return null; }
	keyLightRadius() { return 0.02; }

	/** The piano's footprint centred under the dome. */
	place( piano ) {

		piano.group.position.set( 0, 0, 0 );
		piano.group.rotation.set( 0, 0, 0 );
		piano.group.updateMatrixWorld( true );
		const c = new THREE.Box3().setFromObject( piano.group ).getCenter( new THREE.Vector3() );
		piano.group.position.set( - c.x, 0, - c.z );

	}

	probePoint() { return new THREE.Vector3( 0, 1.3, 2.6 ); }

	/** The open floor (world), inside the furniture. */
	bounds() { return { minX: - 3.8, maxX: 3.8, minZ: - 3.8, maxZ: 3.8 }; }

	/** The offline sound's shoebox (tools/spatialise.py): a square of the room's floor area, its
	 * mean height; hard walls and floor (`living`'s surfaces). */
	acousticBox() {

		const h = R * Math.sqrt( Math.PI ) / 2;
		return { minX: - h, maxX: h, minZ: - h, maxZ: h, height: 4.6, acoustics: 'living' };

	}

	views() {

		const at = ( phi, r, y ) => outward( phi * Math.PI / 180 ).multiplyScalar( r ).setY( y );
		return {
			'From the sofa': { position: at( 90, 4.6, 1.15 ), target: new THREE.Vector3( 0, 1.0, 0 ) },
			'The doors': { position: at( 0, 5.6, 1.65 ), target: new THREE.Vector3( 0, 1.4, 0 ) },
			'The clef': { position: at( 25, 2.4, 1.5 ), target: at( 180, R, 1.7 ) },
			'The coves': { position: at( 200, 3.6, 1.4 ), target: new THREE.Vector3( 0, 5.2, 0 ) },
		};

	}

	lightControls() {

		return [
			[ 'baked', 'bool', 'Baked light (its preset\'s lightmap)' ], [ 'outside', LUMINARA_OUTSIDE, 'Outside' ], [ 'sky', 0, 4, 0.01, 'Sky (windows)' ],
			[ 'cove', 0, 8, 0.01, 'Coves' ], [ 'coveColor', 'color', 'Cove color' ],
			[ 'washer', 0, 300, 1, 'Wall washers (cd)' ], [ 'dome', 0, 400, 1, 'Dome spots (cd)' ], [ 'downColor', 'color', 'Downlight color' ],
			[ 'sconce', 0, 15, 0.1, 'Sconces' ], [ 'sconceColor', 'color', 'Sconce color' ],
			[ 'niche', 0, 6, 0.01, 'Niches' ], [ 'nicheColor', 'color', 'Niche color' ],
			[ 'led', 0, 40, 0.1, 'Ceiling lines' ], [ 'ledWall', 0, 20, 0.1, 'Wall lines' ], [ 'ledFloor', 0, 10, 0.1, 'Floor lines' ], [ 'ledColor', 'color', 'Line color' ],
			[ 'top', 0, 2000, 10, 'Recital spot' ], [ 'topColor', 'color', 'Recital spot color' ], [ 'topAngle', 5, 40, 0.5, 'Recital spot cone (°)' ],
			[ 'env', 0, 1.5, 0.01, 'Ambient (probe)' ],
		];

	}

	// ---------------------------------------------------------------------
	rebuild() {

		for ( const c of [ ...this.group.children ] ) if ( c !== this.pack ) { this.group.remove( c ); c.traverse( o => o.geometry?.dispose() ); }
		const M = this.materials, parts = new Map();		// material -> geometries (merged at the end)
		const add = ( geo, mat ) => { if ( ! parts.has( mat ) ) parts.set( mat, [] ); parts.get( mat ).push( geo.index ? geo.toNonIndexed() : geo ); };
		this.nichePoints = [];
		this.sconceU.uSconceA.value.length = this.sconceU.uSconceB.value.length = 0;
		this.washers = [];		// [ position, target ] of the first soffit's downlights

		// the bays: a panel of wall round each opening, the opening's reveal and back
		for ( let k = 0; k < LUMINARA.bays; ++ k ) this._bay( add, k * BAY, OPENINGS[ BAYS[ k ] ], BAYS[ k ] );

		// the pilasters between the bays: fluted white lacquer, a base and a brass-banded capital
		const pil = this._pilaster();
		for ( let k = 0; k < LUMINARA.bays; ++ k ) {

			const F = frameAt( ( k + 0.5 ) * BAY, R );
			add( pil.shaft.clone().applyMatrix4( F ), M.lacquer );
			add( pil.base.clone().applyMatrix4( F ), M.lacquer );
			add( pil.capital.clone().applyMatrix4( F ), M.lacquer );
			add( pil.band.clone().applyMatrix4( F ), M.brass );
			for ( const g of pil.sconce.brass ) add( g.clone().applyMatrix4( F ), M.brass );
			add( pil.sconce.glass.clone().applyMatrix4( F ), M.sconce );
			this.sconceU.uSconceA.value.push( pil.sconce.seg[ 0 ].clone().applyMatrix4( F ) );
			this.sconceU.uSconceB.value.push( pil.sconce.seg[ 1 ].clone().applyMatrix4( F ) );

		}

		// skirting (broken at the doors), a brass line above it; the cornice
		const doorHalf = ( OPENINGS.door.a + 0.03 ) / R;
		const lathe = ( pts, mat, a0 = 0, len = 2 * Math.PI, n = 192 ) => add( new THREE.LatheGeometry( pts.map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), n, a0, len ), mat );
		lathe( [ [ R, 0 ], [ R - 0.035, 0 ], [ R - 0.035, 0.15 ], [ R - 0.02, 0.17 ], [ R, 0.17 ] ], M.lacquer, doorHalf, 2 * Math.PI - 2 * doorHalf );
		lathe( [ [ R, 0.17 ], [ R - 0.012, 0.17 ], [ R - 0.012, 0.185 ], [ R, 0.185 ] ], M.brass, doorHalf, 2 * Math.PI - 2 * doorHalf );
		lathe( [ [ R - 0.036, 0.008 ], [ R - 0.036, 0.024 ] ], M.ledFloor, doorHalf, 2 * Math.PI - 2 * doorHalf );		// (a line of light along the floor)
		lathe( [ [ R + 0.01, LUMINARA.wall - 0.02 ], [ R - 0.05, LUMINARA.wall ], [ R - 0.06, LUMINARA.wall + 0.1 ], [ R - 0.16, LUMINARA.wall + 0.2 ], [ R - 0.2, LUMINARA.wall + 0.3 ], [ R - 0.2, STEPS[ 0 ][ 1 ] ] ], M.lacquer );
		lathe( [ [ R - 0.062, LUMINARA.wall + 0.1 ], [ R - 0.062, LUMINARA.wall + 0.125 ] ], M.led );		// (a line of light in the cornice)

		// the ceiling: each soffit in to its lip (brass), the gap, the lit riser up to the next soffit
		// the downlights: one in the first soffit over each bay (washing its wall), a brass trim round a
		// lit lens; four spots in the dome's rim on the piano (brass cans, aimed)
		for ( let k = 0; k < LUMINARA.bays; ++ k ) {

			const phi = k * BAY, p = outward( phi ).multiplyScalar( 5.9 ).setY( STEPS[ 0 ][ 1 ] - 0.004 );
			add( new THREE.TorusGeometry( 0.052, 0.007, 8, 40 ).rotateX( Math.PI / 2 ).translate( p.x, p.y, p.z ), M.brass );
			add( new THREE.CircleGeometry( 0.046, 32 ).rotateX( Math.PI / 2 ).translate( p.x, p.y - 0.001, p.z ), M.led );
			this.washers.push( [ p.clone().setY( p.y - 0.02 ), outward( phi ).multiplyScalar( R + 0.2 ).setY( 0.6 ) ] );

		}
		this.domeAt = DOME_SPOTS.map( deg => {

			const phi = deg * Math.PI / 180, t = Math.acos( 2.55 / ( STEPS[ 2 ][ 0 ] - GAP ) ), p = outward( phi ).multiplyScalar( 2.55 ).setY( DOME.y + DOME.rise * Math.sin( t ) - 0.06 );
			const aim = new THREE.Vector3( 0, 0.8, 0 ), dir = aim.clone().sub( p ).normalize(), q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, - 1, 0 ), dir );
			const can = new THREE.CylinderGeometry( 0.045, 0.05, 0.11, 32, 1, true ).applyQuaternion( q ).translate( p.x, p.y, p.z );
			add( can, M.brass );
			add( new THREE.CircleGeometry( 0.042, 32 ).rotateX( Math.PI / 2 ).applyQuaternion( q ).translate( ...p.clone().addScaledVector( dir, 0.05 ).toArray() ), M.led );
			return [ p.clone().addScaledVector( dir, 0.07 ), aim ];

		} );
		let r0 = R - 0.2;
		for ( let i = 0; i < STEPS.length; ++ i ) {

			const [ r, y ] = STEPS[ i ], yNext = i + 1 < STEPS.length ? STEPS[ i + 1 ][ 1 ] : DOME.y;
			lathe( [ [ r0, y ], [ r, y ] ], M.ceiling, 0, 2 * Math.PI, 160 );
			lathe( [ [ r, y ], [ r, y - LIP ], [ r - 0.025, y - LIP ], [ r - 0.025, y ] ], M.ceiling, 0, 2 * Math.PI, 160 );
			lathe( [ [ r - 0.026, y - LIP + 0.008 ], [ r - 0.026, y - 0.008 ] ], M.led, 0, 2 * Math.PI, 160 );		// (the step's edge: a line of light)
			lathe( [ [ r - 0.025, y ], [ r - GAP, y ] ], M.ceiling, 0, 2 * Math.PI, 160 );		// (the gap's floor: the strip's)
			const rr = r - GAP, rise = [];
			for ( let j = 0; j <= 12; ++ j ) rise.push( [ rr, y + ( yNext - y ) * j / 12 ] );
			lathe( rise, M.cove, 0, 2 * Math.PI, 160 );
			if ( i === 0 ) {		// the staff and its notes along the first riser

				const band = new THREE.LatheGeometry( [ new THREE.Vector2( rr - 0.004, y + 0.12 ), new THREE.Vector2( rr - 0.004, y + 0.47 ) ], 192 );
				const m = new THREE.Mesh( band, M.staff );
				m.name = 'luminara:staff'; m.userData.noAO = true;
				this.group.add( m );
				M.staff.map.repeat.set( - 12, 1 );		// (u round the lathe: to the viewer's left)

			}
			r0 = rr;

		}
		{

			const dome = [];
			for ( let j = 0; j <= 32; ++ j ) { const t = j / 32 * Math.PI / 2; dome.push( [ Math.max( 1e-4, r0 * Math.cos( t ) ), DOME.y + DOME.rise * Math.sin( t ) ] ); }
			lathe( dome, M.dome, 0, 2 * Math.PI, 160 );
			lathe( [ [ r0 - 0.002, DOME.y - 0.035 ], [ r0 - 0.002, DOME.y - 0.01 ] ], M.led, 0, 2 * Math.PI, 160 );

		}

		// the floor: the marble field, a border band of darker marble, brass rings
		const disc = ( r1, r2, y, mat ) => {

			const g = r1 > 0 ? new THREE.RingGeometry( r1, r2, 256, 1 ) : new THREE.CircleGeometry( r2, 256 );
			g.rotateX( - Math.PI / 2 ).translate( 0, y, 0 );
			const p = g.attributes.position, uv = g.attributes.uv;
			for ( let i = 0; i < p.count; ++ i ) uv.setXY( i, p.getX( i ) / LUMINARA.floorTile, - p.getZ( i ) / LUMINARA.floorTile );
			return g;

		};
		const floor = new THREE.Mesh( disc( 0, 5.92, 0, null ), M.floor ), border = new THREE.Mesh( disc( 5.92, R + 0.05, 0, null ), M.border );
		for ( const m of [ floor, border ] ) { m.receiveShadow = true; m.name = 'luminara:floor'; this.group.add( m ); }
		this.floorMeshes = [ floor, border ];		// (hidden while their reflection is drawn)
		for ( const [ a, b ] of [ [ 2.68, 2.695 ], [ 5.88, 5.92 ] ] ) add( disc( a, b, 0.0005 ), M.inlay );
		// a ring of light round the rug: a bead (a flat strip this thin breaks up at grazing angles)
		add( new THREE.TorusGeometry( 2.56, 0.009, 6, 256 ).rotateX( Math.PI / 2 ).scale( 1, 0.6, 1 ), M.ledFloor );
		{

			// the rug: its pattern's square on the disc (u, v 0..1 across it), its edge a short band
			const RR = 2.42, top = 0.012, g = new THREE.CircleGeometry( RR, 192 ).rotateX( - Math.PI / 2 ).translate( 0, top, 0 ), p = g.attributes.position, uv = g.attributes.uv;
			for ( let i = 0; i < p.count; ++ i ) uv.setXY( i, 0.5 + 0.485 * p.getX( i ) / RR, 0.5 - 0.485 * p.getZ( i ) / RR );
			const rug = new THREE.Mesh( g, M.rug );
			rug.receiveShadow = true; rug.name = 'luminara:rug';
			this.group.add( rug );
			add( new THREE.CylinderGeometry( RR, RR + 0.006, top, 192, 1, true ).translate( 0, top / 2, 0 ), M.rug );

		}

		// coffee tables before the sofas, as the reference's: a drum, its marble top on a brass rim, its
		// white lacquered body narrowing in a curve to a brass foot ring
		for ( const [ deg, r ] of COFFEE ) {

			const F = frameAt( deg * Math.PI / 180, r ), v = ( a, b ) => new THREE.Vector2( a, b );
			const body = [ v( 0.33, 0.012 ) ];
			for ( let i = 0; i <= 12; ++ i ) { const t = i / 12; body.push( v( 0.33 + 0.13 * Math.sin( 0.5 * Math.PI * t ) ** 1.6, 0.012 + 0.36 * t ) ); }
			add( new THREE.LatheGeometry( body, 96 ).applyMatrix4( F ), M.lacquer );
			add( new THREE.LatheGeometry( [ v( 0.345, 0 ), v( 0.35, 0.006 ), v( 0.35, 0.016 ), v( 0.33, 0.018 ) ], 96 ).applyMatrix4( F ), M.brass );
			add( new THREE.LatheGeometry( [ v( 0.455, 0.37 ), v( 0.505, 0.374 ), v( 0.51, 0.392 ), v( 0.5, 0.395 ) ], 96 ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.5, 0.5, 0.035, 96 ).translate( 0, 0.4125, 0 ).applyMatrix4( F ), M.floor );

		}

		for ( const [ mat, geos ] of parts ) {

			const mesh = new THREE.Mesh( mergeGeometries( geos, false ), mat );
			geos.forEach( g => g.dispose() );
			mesh.castShadow = ! [ M.cove, M.dome, M.ceiling, M.led, M.ledWall, M.ledFloor, M.sconce, M.neon ].includes( mat );
			mesh.receiveShadow = true;
			mesh.name = `luminara:${ Object.keys( M ).find( k => M[ k ] === mat ) }`;
			this.group.add( mesh );

		}

		// the city outside, round the room: the sky photo four times round (mirrored: no seams), its
		// horizon near the seated eye's height; the cylinder taller than the photo (the tall windows see
		// more of it): its top and bottom rows run on (clamped)
		{

			const rs = 11, reps = 4, w = 2 * Math.PI * rs / reps, h = w / 3, top = h * 0.62 + 1.55, ext = 14, yb = - 4;
			const g = new THREE.CylinderGeometry( rs, rs, ext, 128, 1, true ).translate( 0, yb + ext / 2, 0 );
			this.sky = new THREE.Mesh( g, M.sky );
			this.sky.name = 'luminara:sky';
			this.sky.userData.noAO = true;
			this.group.add( this.sky );
			this.skyReps = reps;
			// the photo between top - h and top: v' = 1 - ( yb + ext v - ( top - h ) ) / h (flipped: glTF's)
			this.skyV = { repeat: - ext / h, offset: 1 - ( yb - top + h ) / h };

		}
		if ( this.pack ) this.group.add( this.pack );
		this._hash = this._computeHash();
		if ( this._bakeSrc ) this._applyBake();

	}

	/** Bay k (centred at φc): its wall panel round the opening, the opening's reveal and back. */
	_bay( add, phiC, o, kind ) {

		const M = this.materials, hw = R * BAY / 2, H = LUMINARA.wall;
		if ( o.shape === 'none' ) {		// the plain wall (the clef's: its light on it)

			const rows = [];
			for ( let j = 0; j <= 16; ++ j ) { const row = []; for ( let i = 0; i <= 48; ++ i ) { const sx = - hw + 2 * hw * i / 48, y = H * j / 16; row.push( [ onWall( phiC, sx, y ), ( phiC * R + sx ) / 2.5, y / 2.5 ] ); } rows.push( row ); }
			const P = [], UV = [], I = [];
			for ( const row of rows ) for ( const [ p, u, v ] of row ) { P.push( p.x, p.y, p.z ); UV.push( u, v ); }
			for ( let j = 0; j < 16; ++ j ) for ( let i = 0; i < 48; ++ i ) { const a = j * 49 + i; I.push( a, a + 1, a + 50, a, a + 50, a + 49 ); }
			const g = new THREE.BufferGeometry();
			g.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) ); g.setAttribute( 'uv', new THREE.Float32BufferAttribute( UV, 2 ) ); g.setIndex( I ); g.computeVertexNormals();
			add( g, M.wall );
			if ( kind === 'clef' ) this._clefLight( add, phiC );
			return;

		}
		const c = centreOf( o ), th = anglesFor( c, hw, H );
		const rect = ( dx, dy ) => Math.min( Math.abs( dx ) > 1e-9 ? hw / Math.abs( dx ) : Infinity, dy > 0 ? ( H - c[ 1 ] ) / dy : dy < 0 ? c[ 1 ] / - dy : Infinity );
		const uvOf = ( s, y ) => [ ( phiC * R + s ) / 2.5, y / 2.5 ];
		// the panel: rings from the opening's outline out to the bay's rectangle
		const NR = 10, rings = [];
		for ( let j = 0; j <= NR; ++ j ) rings.push( th.map( a => {

			const dx = Math.cos( a ), dy = Math.sin( a ), t0 = outlineT( o, c, dx, dy ), t = t0 + ( rect( dx, dy ) - t0 ) * j / NR;
			const s = c[ 0 ] + t * dx, y = c[ 1 ] + t * dy;
			return [ onWall( phiC, s, y ), ...uvOf( s, y ) ];

		} ) );
		add( ringsGeometry( rings ), M.wall );
		// the reveal: the outline on the wall, back to the window's far end (round) or the niche's flat back
		const Db = R + o.depth, f = outward( phiC ), x = rightOf( phiC );
		const outline = th.map( a => { const dx = Math.cos( a ), dy = Math.sin( a ), t = outlineT( o, c, dx, dy ); return [ c[ 0 ] + t * dx, c[ 1 ] + t * dy ]; } );
		const back = ( s, y ) => o.shape === 'circle' ? onWall( phiC, s, y, Db ) : f.clone().multiplyScalar( Db ).addScaledVector( x, s ).setY( y );
		const revealRings = [ 0, 0.5, 1 ].map( q => outline.map( ( [ s, y ], i ) => [ onWall( phiC, s, y ).lerp( back( s, y ), q ), i / outline.length * 4, q * o.depth ] ) );
		add( ringsGeometry( revealRings, o.shape !== 'circle' ), o.shape === 'circle' ? M.lacquer : M.wall );
		const F = frameAt( phiC, Db );		// (the back's frame: z 0 the back, +z into the room)
		if ( o.shape === 'circle' ) {

			// a round window: a white frame and a brass ring inside it, on the wall
			const W = frameAt( phiC, R - 0.012, o.yc );
			add( new THREE.TorusGeometry( o.a + 0.04, 0.07, 16, 160 ).applyMatrix4( W ), M.lacquer );
			add( new THREE.TorusGeometry( o.a + 0.004, 0.016, 10, 160 ).translate( 0, 0, 0.03 ).applyMatrix4( W ), M.brass );
			return;

		}
		// an arch: its back flat (lit from behind in a niche; the doors in the door's)
		const shape = new THREE.Shape();
		if ( o.shape === 'rect' ) {

			const { a, y0, y1, rc } = o;
			shape.moveTo( a, y0 + rc ); shape.lineTo( a, y1 - rc ); shape.absarc( a - rc, y1 - rc, rc, 0, Math.PI / 2, false ); shape.lineTo( - a + rc, y1 );
			shape.absarc( - a + rc, y1 - rc, rc, Math.PI / 2, Math.PI, false ); shape.lineTo( - a, y0 + rc ); shape.absarc( - a + rc, y0 + rc, rc, Math.PI, 1.5 * Math.PI, false );
			shape.lineTo( a - rc, y0 ); shape.absarc( a - rc, y0 + rc, rc, 1.5 * Math.PI, 2 * Math.PI, false );

		} else { shape.moveTo( o.a, o.y0 ); shape.lineTo( o.a, o.yS ); shape.absarc( 0, o.yS, o.a, 0, Math.PI, false ); shape.lineTo( - o.a, o.y0 ); shape.closePath(); }
		const backGeo = new THREE.ShapeGeometry( shape, 48 ).applyMatrix4( F );
		// its frame on the wall: a brass line round the arch (not along the floor)
		const line = outline.filter( ( [ , y ] ) => y > o.y0 + 1e-3 || o.y0 > 0 ).map( ( [ s, y ] ) => onWall( phiC, s, y, R - 0.008 ) );
		if ( o.y0 > 0 ) line.push( line[ 0 ].clone() );
		else line.sort( ( p, q ) => p.distanceTo( onWall( phiC, o.a, 0 ) ) - q.distanceTo( onWall( phiC, o.a, 0 ) ) );
		if ( kind === 'door' ) {

			add( backGeo, M.lacquer );
			this._doors( add, F, o );

		} else {

			add( backGeo, kind === 'pipes' ? M.lacquer : kind === 'clef' ? M.wall : M.niche );		// (the clef: its pattern glows, not the niche)
			const mid = new THREE.Vector3( 0, ( o.y0 + ( o.y1 ?? o.yS ) ) / 2, 0.25 ).applyMatrix4( F );
			this.nichePoints.push( { kind, F, o, light: mid } );
			if ( kind === 'shelves' ) this._shelving( add, F, o );
			if ( kind === 'pipes' ) this._pipes( add, F, o );
			if ( kind !== 'shelves' ) add( new THREE.BoxGeometry( 2 * o.a - 0.04, 0.01, 0.012 ).translate( 0, o.y0 + 0.006, 0.02 ).applyMatrix4( F ), M.ledWall );		// (a strip along the back's foot)

		}
		add( this._archTrim( phiC, o ), kind === 'door' ? M.brass : M.ledWall );

	}

	/** A band round an arch on the wall (its two sides and the semicircle), or round a rounded rect: brass, or a line of light. */
	_archTrim( phiC, o ) {

		if ( o.shape === 'rect' ) {

			const g = { ...o, a: o.a + 0.03, y0: o.y0 - 0.03, y1: o.y1 + 0.03, rc: o.rc + 0.03 }, c = centreOf( g ), pts = [];
			for ( let i = 0; i < 160; ++ i ) { const t = 2 * Math.PI * i / 160, dx = Math.cos( t ), dy = Math.sin( t ), d = outlineT( g, c, dx, dy ); pts.push( [ c[ 0 ] + d * dx, c[ 1 ] + d * dy ] ); }
			return this._wallTube( phiC, pts, 0.01, true );

		}
		const pts = [];
		pts.push( [ o.a + 0.03, o.y0 ] );
		for ( let i = 0; i <= 48; ++ i ) { const t = Math.PI * i / 48; pts.push( [ ( o.a + 0.03 ) * Math.cos( t ), o.yS + ( o.a + 0.03 ) * Math.sin( t ) ] ); }
		pts.push( [ - o.a - 0.03, o.y0 ] );
		return this._wallTube( phiC, pts, 0.012, false );

	}

	/** A thin tube along points (s, y) of bay φc's wall, just in front of it. */
	_wallTube( phiC, pts, tube, closed ) {

		const curve = new THREE.CatmullRomCurve3( pts.map( ( [ s, y ] ) => onWall( phiC, s, y, R - 0.006 ) ), closed, 'catmullrom', 0.1 );
		return new THREE.TubeGeometry( curve, Math.max( 64, pts.length * 2 ), tube, 8, closed );

	}

	/** Built-in shelving in a rounded-rect niche (frame F: its back): four shelves, two uprights, a strip of light under each shelf's front. */
	_shelving( add, F, o ) {

		const M = this.materials, hh = o.y1 - o.y0, t = 0.035, w = 2 * o.a + 0.1, d = o.depth;
		this.shelves = [];		// [ y of its top, x of each compartment's middle, its half width ] (the ornaments: _build)
		const ys = [ 0, 1, 2, 3 ].map( k => o.y0 + 0.05 + k * ( hh - 0.1 ) / 4 );
		for ( const y of ys.slice( 1 ) ) {

			add( new RoundedBoxGeometry( w, t, d - 0.02, 2, 0.008 ).translate( 0, y - t / 2, d / 2 ).applyMatrix4( F ), M.lacquer );
			add( new THREE.BoxGeometry( w - 0.24, 0.008, 0.012 ).translate( 0, y - t - 0.006, d - 0.04 ).applyMatrix4( F ), M.ledWall );

		}
		add( new THREE.BoxGeometry( 2 * o.a - 0.2, 0.008, 0.012 ).translate( 0, o.y1 - 0.02, d - 0.06 ).applyMatrix4( F ), M.ledWall );		// (the top's)
		const xs = [ - 1, 1 ].map( s => s * ( o.a - 0.06 ) / 3 );
		for ( const x of xs ) add( new RoundedBoxGeometry( t, hh - 0.06, d - 0.02, 2, 0.008 ).translate( x, o.y0 + hh / 2, d / 2 ).applyMatrix4( F ), M.lacquer );
		const half = ( o.a - 0.06 ) / 3 - t;
		for ( const [ k, y ] of ys.entries() ) this.shelves.push( [ k ? y : o.y0, [ - 2 * ( o.a - 0.06 ) / 3, 0, 2 * ( o.a - 0.06 ) / 3 ], half ] );		// (the lowest: on the niche's floor)
		return ys;

	}

	/**
	 * The clef and its staff, a light on the wall (frame: bay φc): the treble clef's outline (Noto
	 * Music's) extruded as thick acrylic lit from within, five staff lines sweeping from it across the
	 * wall (tubes, waving, fanning a little), a few notes on them. Each piece on its own place on the
	 * curved wall, a little off it.
	 */
	_clefLight( add, phiC ) {

		const M = this.materials, off = 0.035;
		const glyph = ( name, s, y, h ) => {

			const G = GLYPHS[ name ], path = new THREE.ShapePath();
			for ( const c of G.contours ) { path.moveTo( c[ 0 ][ 0 ], c[ 0 ][ 1 ] ); for ( let i = 1; i < c.length; ++ i ) path.lineTo( c[ i ][ 0 ], c[ i ][ 1 ] ); }
			const shapes = path.toShapes( false );
			const g = new THREE.ExtrudeGeometry( shapes, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.008, bevelSegments: 3, curveSegments: 4 } );
			g.computeBoundingBox();
			const b = g.boundingBox, k = h / ( b.max.y - b.min.y ), kz = 0.03 / 0.18;		// (3 cm thick, whatever its height)
			g.translate( - ( b.min.x + b.max.x ) / 2, - b.min.y, 0.03 ).scale( k, k, kz );
			add( g.applyMatrix4( frameAt( phiC - s / R, R - off, y ) ), M.neon );

		};
		glyph( 'clef', - 0.95, 1.14, 1.85 );
		// the staff: five lines from behind the clef across to the right, rising and waving
		const line = ( k, t ) => {

			const sx = - 1.25 + 2.75 * t, y = 1.74 + 0.11 * k * ( 1 + 0.35 * t ) + 0.32 * t + 0.13 * Math.sin( Math.PI * ( 1.6 * t + 0.15 ) );
			return [ sx, y ];

		};
		for ( let k = 0; k < 5; ++ k ) {

			const pts = [];
			for ( let i = 0; i <= 60; ++ i ) pts.push( line( k, i / 60 ) );
			const curve = new THREE.CatmullRomCurve3( pts.map( ( [ sx, y ] ) => onWall( phiC, sx, y, R - off ) ) );
			add( new THREE.TubeGeometry( curve, 180, 0.011, 8, false ), M.neon );

		}
		// notes on it
		for ( const [ name, t, k, h ] of [ [ 'quaver', 0.34, 2.6, 0.36 ], [ 'quavers', 0.55, 1.4, 0.4 ], [ 'crotchet', 0.72, 3.2, 0.32 ], [ 'quaver', 0.88, 1.9, 0.36 ] ] ) {

			const [ sx, y ] = line( k, t );
			glyph( name, sx, y - 0.06, h );

		}

	}

	/** A row of lacquered pipes in a niche (frame F: its back), taller to the middle, each lit along a slit. */
	_pipes( add, F, o ) {

		const M = this.materials, n = 9;
		for ( let i = 0; i < n; ++ i ) {

			const x = ( i - ( n - 1 ) / 2 ) * 0.125, h = 0.95 + 0.75 * ( 1 - ( x / o.a ) ** 2 ), z = 0.15;
			add( new THREE.CylinderGeometry( 0.034, 0.034, h, 24 ).translate( x, o.y0 + h / 2, z ).applyMatrix4( F ), M.lacquer );
			add( new THREE.BoxGeometry( 0.012, h - 0.12, 0.004 ).translate( x, o.y0 + 0.06 + ( h - 0.12 ) / 2, z + 0.034 ).applyMatrix4( F ), M.ledWall );
			add( new THREE.CylinderGeometry( 0.036, 0.036, 0.018, 24 ).translate( x, o.y0 + 0.28, z ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.036, 0.036, 0.012, 24 ).translate( x, o.y0 + h - 0.006, z ).applyMatrix4( F ), M.brass );

		}

	}

	/** The doors in the door's arch (frame F: its back): two lacquered leaves with raised panels,
	 * brass pulls, a fanlight in the arch. */
	_doors( add, F, o ) {

		const M = this.materials, w = o.a, h = o.yS;
		for ( const sx of [ - 1, 1 ] ) {

			const cx = sx * w / 2;
			add( new THREE.BoxGeometry( w - 0.02, h - 0.02, 0.05 ).translate( cx, h / 2, 0.025 ).applyMatrix4( F ), M.lacquer );
			for ( const [ y0, y1 ] of [ [ 0.2, 1.0 ], [ 1.15, h - 0.15 ] ] ) add( new THREE.BoxGeometry( w - 0.24, y1 - y0, 0.02 ).translate( cx, ( y0 + y1 ) / 2, 0.06 ).applyMatrix4( F ), M.lacquer );
			add( new THREE.CylinderGeometry( 0.012, 0.012, 0.55, 12 ).translate( sx * 0.07, 1.05, 0.11 ).applyMatrix4( F ), M.brass );
			for ( const y of [ 0.82, 1.28 ] ) add( new THREE.CylinderGeometry( 0.008, 0.008, 0.06, 8 ).rotateX( Math.PI / 2 ).translate( sx * 0.07, y, 0.08 ).applyMatrix4( F ), M.brass );

		}
		add( new THREE.CircleGeometry( w - 0.02, 48, 0, Math.PI ).translate( 0, h, 0.01 ).applyMatrix4( F ), M.niche );
		add( new THREE.BoxGeometry( 2 * w, 0.05, 0.06 ).translate( 0, h, 0.04 ).applyMatrix4( F ), M.brass );
		for ( let i = 1; i < 6; ++ i ) {		// the fanlight's radial bars

			const t = Math.PI * i / 6;
			add( new THREE.BoxGeometry( w - 0.04, 0.018, 0.02 ).translate( ( w - 0.04 ) / 2, 0, 0 ).rotateZ( t ).translate( 0, h, 0.03 ).applyMatrix4( F ), M.brass );

		}

	}

	/** A pilaster's parts in its own frame (x across, y up, z towards the centre; its back in the wall). */
	_pilaster() {

		const w = LUMINARA.pilaster, d = 0.12, H = LUMINARA.wall, flutes = 5, fr = 0.024, s = new THREE.Shape();
		s.moveTo( - w / 2, - 0.06 ); s.lineTo( - w / 2, d );
		const span = w - 0.08, step = span / flutes;
		for ( let i = 0; i < flutes; ++ i ) {

			const cx = - span / 2 + step * ( i + 0.5 );
			s.lineTo( cx - fr, d );
			for ( let j = 1; j < 12; ++ j ) { const u = Math.PI * j / 12; s.lineTo( cx - fr * Math.cos( u ), d - 0.6 * fr * Math.sin( u ) ); }
			s.lineTo( cx + fr, d );

		}
		s.lineTo( w / 2, d ); s.lineTo( w / 2, - 0.06 ); s.closePath();
		const shaft = new THREE.ExtrudeGeometry( s, { depth: H - 0.62, bevelEnabled: false, curveSegments: 4 } ).rotateX( Math.PI / 2 ).translate( 0, H - 0.3, 0 );
		const base = new THREE.BoxGeometry( w + 0.06, 0.32, d + 0.1 ).translate( 0, 0.16, ( d + 0.1 ) / 2 - 0.06 );
		const capital = new THREE.BoxGeometry( w + 0.06, 0.24, d + 0.1 ).translate( 0, H - 0.12, ( d + 0.1 ) / 2 - 0.06 );
		const band = new THREE.BoxGeometry( w + 0.065, 0.025, d + 0.105 ).translate( 0, H - 0.27, ( d + 0.1 ) / 2 - 0.06 );
		return { shaft, base, capital, band, sconce: this._sconce( d ) };

	}

	/**
	 * A sconce on a pilaster's face (`d`: the face, z towards the centre): a tall rounded brass
	 * backplate, two short arms out to the brass caps holding a frosted glass tube upright, a lip
	 * where each cap meets the glass, a small ball below and above. Its tube's axis: `seg` (the glow's).
	 */
	_sconce( d ) {

		const y = 1.78, h = 0.42, r = 0.028, z = d + 0.078, brass = [];
		brass.push( new RoundedBoxGeometry( 0.072, h + 0.16, 0.014, 2, 0.006 ).translate( 0, y, d + 0.007 ) );
		brass.push( new RoundedBoxGeometry( 0.05, h + 0.1, 0.008, 2, 0.003 ).translate( 0, y, d + 0.016 ) );		// (a raised panel on it)
		for ( const e of [ - 1, 1 ] ) {

			const ye = y + e * ( h / 2 + 0.017 ), z0 = d + 0.02, z1 = z - r - 0.004;
			brass.push( new THREE.CylinderGeometry( r + 0.005, r + 0.007, 0.034, 40 ).translate( 0, ye, z ) );		// the cap
			brass.push( new THREE.CylinderGeometry( r + 0.009, r + 0.009, 0.005, 40 ).translate( 0, ye - e * 0.0175, z ) );		// its lip on the glass
			brass.push( new THREE.CylinderGeometry( 0.0065, 0.0065, z1 - z0, 16 ).rotateX( Math.PI / 2 ).translate( 0, ye, ( z0 + z1 ) / 2 ) );		// the arm
			brass.push( new THREE.CylinderGeometry( 0.011, 0.011, 0.006, 16 ).rotateX( Math.PI / 2 ).translate( 0, ye, z0 + 0.003 ) );		// its rose on the plate
			brass.push( new THREE.SphereGeometry( 0.012, 20, 10 ).translate( 0, ye + e * 0.03, z ) );		// a ball beyond the cap

		}
		const glass = new THREE.CylinderGeometry( r, r, h, 48, 1 ).translate( 0, y, z );
		return { brass, glass, seg: [ new THREE.Vector3( 0, y - h / 2, z ), new THREE.Vector3( 0, y + h / 2, z ) ] };

	}

	// ---------------------------------------------------------------------
	_buildLights() {

		const spot = ( angle, penumbra, mapSize ) => {

			const s = new THREE.SpotLight( '#ffffff', 0, 0, angle, penumbra, 2 );
			s.castShadow = true;
			s.shadow.mapSize.set( mapSize, mapSize );
			s.shadow.bias = - 0.00015;
			s.shadow.normalBias = 0.01;
			s.shadow.radius = 3;
			s.shadow.camera.near = 1.5;
			s.shadow.camera.far = 14;
			this.lights.add( s, s.target );
			return s;

		};
		// the Recital's spot, straight down from the dome's crown
		this.topSpot = spot( THREE.MathUtils.degToRad( 15 ), 0.5, 2048 );
		this.topSpot.radius = 0.3;
		this.topSpot.position.set( 0, 6.2, 0.2 );
		this.topSpot.target.position.set( 0, 0, 0 );
		// the dome's four spots on the piano (placed in rebuild): the first casts the keys' shadow (the
		// key light, 4096), the third the piano's from behind; the others none
		this.domeSpots = DOME_SPOTS.map( ( deg, i ) => {

			const s = spot( THREE.MathUtils.degToRad( 24 ), 0.7, i === 0 ? 4096 : 2048 );
			s.castShadow = i === 0 || i === 2;
			s.radius = 0.08;
			return s;

		} );
		// the first soffit's downlights, one over each bay (no shadows: twelve)
		this.washerLights = Array.from( { length: LUMINARA.bays }, () => {

			const s = new THREE.SpotLight( '#ffffff', 0, 9, THREE.MathUtils.degToRad( 34 ), 0.85, 2 );
			this.lights.add( s, s.target );
			return s;

		} );
		// a warm light in each niche (on its shelves and reliefs)
		this.nicheLights = [];

	}

	updateLights() {

		const L = this.light, M = this.materials;
		this.topSpot.intensity = L.top; this.topSpot.color.set( L.topColor ); this.topSpot.visible = L.top > 0;
		this.topSpot.angle = THREE.MathUtils.degToRad( L.topAngle ?? 15 );
		for ( const [ i, s ] of this.domeSpots.entries() ) {

			const [ p, t ] = this.domeAt[ i ];
			s.position.copy( p ); s.target.position.copy( t );
			s.intensity = L.dome; s.color.set( L.downColor ); s.visible = L.dome > 0;

		}
		for ( const [ i, s ] of this.washerLights.entries() ) {

			const [ p, t ] = this.washers[ i ];
			s.position.copy( p ); s.target.position.copy( t );
			s.intensity = L.washer; s.color.set( L.downColor ); s.visible = L.washer > 0;

		}
		this.lights.updateMatrixWorld( true );
		M.sconce.emissive.set( L.sconceColor ); M.sconce.emissiveIntensity = L.sconce;
		M.neon.emissive.set( L.ledColor ).lerp( new THREE.Color( '#ffffff' ), 0.35 ); M.neon.emissiveIntensity = 2.1 * L.ledWall;
		if ( this.lampLight ) { this.lampLight.color.set( L.sconceColor ); this.lampLight.intensity = 0.35 * L.sconce; this.lampLight.visible = L.sconce > 0; }
		for ( const m of this.shades ?? [] ) { m.emissive.set( L.sconceColor ); m.emissiveIntensity = 0.5 * L.sconce; }
		this.sconceU.uSconceColor.value.set( L.sconceColor ).multiplyScalar( 0.04 * L.sconce );
		for ( const m of [ M.cove, M.dome ] ) { m.emissive.set( L.coveColor ); m.emissiveIntensity = L.cove * ( m === M.dome ? 0.7 : 1 ); }
		M.niche.emissive.set( L.nicheColor ); M.niche.emissiveIntensity = L.niche;
		for ( const [ m, v ] of [ [ M.led, L.led ], [ M.ledWall, L.ledWall ], [ M.ledFloor, L.ledFloor ] ] ) { m.emissive.set( L.ledColor ); m.emissiveIntensity = v; }
		M.staff.color.set( L.ledColor ).multiplyScalar( 0.75 * L.ledWall );		// (on the ceiling, but ornament: the walls' tier)
		for ( const m of this.glow ) { m.emissive.set( L.ledColor ); m.emissiveIntensity = 2.2 * L.ledWall; }		// (the clef's raised pattern: the walls' brightest, below the bloom)
		if ( this.nicheLights.length !== this.nichePoints.filter( n => n.kind !== 'clef' ).length ) {

			for ( const l of this.nicheLights ) this.lights.remove( l );
			this.nicheLights = this.nichePoints.filter( n => n.kind !== 'clef' ).map( n => {

				const l = new THREE.PointLight( '#ffffff', 0, 2.5, 2 );
				l.position.copy( n.light );
				this.lights.add( l );
				return l;

			} );

		}
		for ( const l of this.nicheLights ) { l.color.set( L.nicheColor ); l.intensity = 1.2 * L.niche; l.visible = L.niche > 0; }
		const bake = L.baked !== false && this.bakes?.[ this.preset ];
		this.bakeU.uBakeOn.value = bake ? 1 : 0;
		if ( bake ) { this.bakeU.uBake.value = bake.map; this.bakeU.uBakeScale.value = bake.scale; }
		const sky = this.skies[ L.outside ] ?? Object.values( this.skies )[ 0 ];
		if ( sky && M.sky.map !== sky ) { M.sky.map = sky; M.sky.needsUpdate = ! M.sky.map; }
		M.sky.color.setScalar( this.pack ? L.sky : 0.25 * L.sky );
		const size = this.highQuality ? 4096 : 2048, key = this.domeSpots[ 0 ];
		if ( key.shadow.mapSize.x !== size ) {

			key.shadow.mapSize.set( size, size );
			key.shadow.map?.dispose();
			key.shadow.map = null;

		}
		if ( this.active ) this.scene.background = this.background;

	}

	setQuality( hq ) { this.highQuality = hq; this.updateLights(); }

	/** The static shell's meshes that take baked light (in a fixed order: the lightmaps' shell matches it by place). */
	bakeTargets() {

		const M = this.materials, set = [ M.wall, M.ceiling, M.lacquer, M.floor, M.border, M.rug ];
		return this.group.children.filter( o => o.isMesh && set.includes( o.material ) );

	}

	/** The procedural shell's hash (as built: rebuild), the lightmaps' check that they are its. */
	shellHash() { return this._hash; }

	_computeHash() {

		let s = '';
		for ( const m of this.bakeTargets() ) {

			const g = m.geometry;
			g.computeBoundingBox();
			const b = g.boundingBox;
			s += `${ m.name }:${ ( g.index ?? g.attributes.position ).count }:${ [ b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z ].map( v => v.toFixed( 3 ) ).join( ',' ) };`;

		}
		let h = 2166136261;
		for ( let i = 0; i < s.length; ++ i ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 ) >>> 0;
		return h.toString( 16 );

	}

	/** The pack's baked shell and lightmaps in place, if they are of this shell (else the probe's light, as before). */
	_applyBake() {

		const { nodes, mapOf } = this._bakeSrc, meta = nodes[ 'bake-meta' ]?.userData;
		if ( ! meta?.hash || NOBAKE ) return;
		if ( meta.hash !== this._hash ) { console.warn( `Luminara: the shell changed since its lightmaps were baked (${ meta.hash } -> ${ this._hash }; tools/luminara-bake.mjs): not used` ); return; }
		const T = this.bakeTargets();
		if ( T.some( ( _, i ) => ! nodes[ `shell-${ i }` ] ) ) return;
		for ( const [ i, m ] of T.entries() ) {

			let src = null;
			nodes[ `shell-${ i }` ].traverse( o => { if ( o.isMesh && ! src ) src = o; } );
			src.updateWorldMatrix( true, false );
			const g = new THREE.BufferGeometry();
			for ( const [ k, to ] of [ [ 'position', 'position' ], [ 'normal', 'normal' ], [ 'uv', 'uv' ], [ 'uv1', 'uvBake' ] ] ) {

				const a = src.geometry.attributes[ k ];
				if ( ! a ) continue;
				const f = new Float32Array( a.count * a.itemSize );
				for ( let j = 0; j < a.count; ++ j ) for ( let c = 0; c < a.itemSize; ++ c ) f[ j * a.itemSize + c ] = a.getComponent( j, c );		// (dequantised)
				g.setAttribute( to, new THREE.BufferAttribute( f, a.itemSize ) );

			}
			g.setIndex( src.geometry.index.clone() );
			g.applyMatrix4( src.matrixWorld );
			m.geometry.dispose();
			m.geometry = g;

		}
		this.bakes = {};
		for ( const [ name, p ] of Object.entries( meta.presets ?? {} ) ) {

			const t = mapOf( `bake-${ p.slug }` );
			if ( ! t ) continue;
			t.colorSpace = THREE.SRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
			this.bakes[ name ] = { map: t, scale: p.scale };

		}

	}

	/** Before the frame is drawn (main.js): the floor's reflection, from `camera`. */
	beforeRender( renderer, camera ) {

		if ( ! this.active || this.mode === 'pathtrace' ) return;
		this.mirror.update( renderer, this.scene, camera, [ this.floorMeshes ].flat(), this.highQuality ? 0.5 : 0.35 );

	}

	/** Around a capture by a cube camera (the probe, a mirror): the floor's reflection off (it is the main view's). */
	set capturing( on ) { this.mirror.enabled = ! on; }

	setMode( mode ) { this.mode = mode; this.updateLights(); }

	// ---------------------------------------------------------------------
	/** Load the pack (once): the furniture, the reliefs, the sky and the floor's marble. */
	load() {

		this._loadTried = true;
		const url = new URL( 'luminara/luminara.glb', new URL( import.meta.env.BASE_URL, location.href ) );
		this.loading = prefetchLuminara().then( buf => new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).parseAsync( buf, url.href ) ).then( gltf => {

			this._build( gltf );
			this.updateLights();
			this.onLoad?.();

		} ).catch( e => console.warn( `Luminara: ${ e.message ?? e } (the pack: tools/luminara-asset.mjs)` ) );
		return this.loading;

	}

	_build( gltf ) {

		const M = this.materials, nodes = {};
		gltf.scene.traverse( o => { if ( o.name && o.parent === gltf.scene ) nodes[ o.name ] = o; } );
		const mapOf = name => { let t = null; nodes[ name ]?.traverse( o => { if ( o.material?.map ) t = o.material.map; } ); return t; };
		// the textures on the swatches
		this._bakeSrc = { nodes, mapOf };
		this._applyBake();
		const marble = mapOf( 'marble' ), rugMap = mapOf( 'rug' );
		if ( rugMap ) { rugMap.colorSpace = THREE.SRGBColorSpace; rugMap.anisotropy = 8; M.rug.map = rugMap; M.rug.color.set( '#ffffff' ); M.rug.needsUpdate = true; }
		for ( const [ hour, name ] of [ [ 'day', 'sky-day' ], [ 'sunset', 'sky-sunset' ], [ 'dusk', 'sky-dusk' ], [ 'night', 'sky-night' ], [ 'day', 'sky' ] ] ) {

			const sky = mapOf( name );
			if ( ! sky || this.skies[ hour ] ) continue;
			// (glTF images are not flipped: v down; the cylinder's v is up)
			sky.colorSpace = THREE.SRGBColorSpace; sky.wrapS = THREE.MirroredRepeatWrapping; sky.wrapT = THREE.ClampToEdgeWrapping; sky.repeat.set( this.skyReps, this.skyV.repeat ); sky.offset.set( 0, this.skyV.offset ); sky.needsUpdate = true;
			this.skies[ hour ] = sky;

		}
		M.sky.map = this.skies[ this.light.outside ] ?? Object.values( this.skies )[ 0 ] ?? null; M.sky.color.set( '#ffffff' ); M.sky.needsUpdate = true;
		if ( marble ) {

			marble.colorSpace = THREE.SRGBColorSpace; marble.wrapS = marble.wrapT = THREE.RepeatWrapping; marble.anisotropy = 8; marble.needsUpdate = true;
			for ( const m of [ M.floor, M.border ] ) { m.map = marble; m.needsUpdate = true; }
			M.border.color.set( '#b9b2a6' );

		}
		// our materials for the pack's (by extras.look)
		const ours = new Map();
		const finish = m => {

			if ( ours.has( m ) ) return ours.get( m );
			const look = m.userData.look, base = { color: m.color, roughness: m.roughness, metalness: m.metalness };
			const p = {
				brass: () => phys( { color: '#d6a95c', metalness: 1, roughness: 0.28 } ),
				lacquer: () => phys( { color: '#f3f1ed', roughness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.15 } ),		// (more: the shell mirrors the room and reads as glass)
				boucle: () => phys( { color: '#ebe6dc', roughness: 0.95, sheen: 0.7, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.7 } ),
				marble: () => phys( { color: '#f1efec', map: marble, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.05 } ),
				ceramic: () => phys( { color: '#efede8', roughness: 0.5 } ),
				foliage: () => phys( { color: new THREE.Color( 1.5, 2.1, 1.25 ), vertexColors: true,		// (the decoder's olive: dark and grey)
					 roughness: 0.65, side: THREE.DoubleSide } ),
				natural: () => phys( { color: '#ffffff', vertexColors: true, roughness: 0.85 } ),
				books: () => phys( { color: '#ffffff', vertexColors: true, roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.3 } ),
				shade: () => phys( { color: '#f6efe2', roughness: 0.9, emissive: new THREE.Color( '#ffdcb0' ), emissiveIntensity: 2.5 } ),		// (a lamp's shade: lit through)
				stone: () => phys( { color: '#09090a', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 } ),
				crystal: () => phys( { color: '#eef4f8', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.6 } ),
				relief: () => phys( { color: m.emissiveMap ? '#9c8f80' : '#ffffff', map: m.map,		// (a self-lit relief's panel darker: its lines read)
					 normalMap: m.normalMap, normalMapType: THREE.ObjectSpaceNormalMap, roughness: 0.55, side: THREE.DoubleSide,
					...( m.emissiveMap ? { emissiveMap: m.emissiveMap, emissive: new THREE.Color( '#ffd9a6' ) } : {} ) } ),		// (the clef's gold: a line of light)
			}[ look ]?.() ?? phys( base );
			if ( p.map ) p.map.colorSpace = THREE.SRGBColorSpace;
			// both sides: TRELLIS's surfaces are not wound one way (culled, the egg chair's shell shows
			// through to its cushion: glass)
			p.side = THREE.DoubleSide;
			p.name = m.name;
			if ( p.emissiveMap ) this.glow.push( p );
			if ( look === 'shade' ) ( this.shades ??= [] ).push( p );
			ours.set( m, p );
			return p;

		};
		const pack = new THREE.Group();
		pack.name = 'luminara:pack';
		// the plants: TRELLIS's pot (its own olive's crown and trunk dropped: a blob up close), soil, and
		// a palm built here (palmGeometry)
		const palm = { geo: palmGeometry(), mat: phys( { vertexColors: true, roughness: 0.55, side: THREE.DoubleSide } ) };
		const soil = phys( { color: '#2c241e', roughness: 1 } );
		const place = ( name, F, mirror = false ) => {

			if ( ! nodes[ name ] ) return;
			const holder = new THREE.Group();
			holder.matrixAutoUpdate = false;
			holder.matrix.copy( F );
			if ( mirror ) holder.matrix.multiply( new THREE.Matrix4().makeScale( - 1, 1, 1 ) );
			const o = nodes[ name ].clone();
			o.traverse( c => { if ( c.isMesh ) { c.material = finish( c.material ); c.castShadow = c.receiveShadow = true; } } );
			if ( name === 'plant' ) {

				o.traverse( c => { if ( c.isMesh && [ 'foliage', 'natural' ].includes( c.material.userData.look ?? c.material.name ) ) c.visible = false; } );
				o.updateMatrixWorld( true );
				const box = new THREE.Box3();
				o.traverse( c => { if ( c.isMesh && c.visible ) box.expandByObject( c ); } );
				const top = box.max.y - 0.035, rim = 0.36 * ( box.max.x - box.min.x );
				const dirt = new THREE.Mesh( new THREE.CircleGeometry( rim, 40 ).rotateX( - Math.PI / 2 ).translate( 0, top, 0 ), soil );
				const fronds = new THREE.Mesh( palm.geo, palm.mat );
				fronds.position.y = top; fronds.castShadow = fronds.receiveShadow = true;
				holder.add( dirt, fronds );

			}
			holder.add( o );
			pack.add( holder );

		};
		const size = name => nodes[ name ]?.userData.size ?? [ 0.3, 0.3, 0.3 ];		// (extras: tools/luminara-asset.mjs)
		const turn = deg => new THREE.Matrix4().makeRotationY( deg * Math.PI / 180 );
		for ( const [ name, deg, r, t ] of FURNITURE ) {

			const F = frameAt( deg * Math.PI / 180, r ?? R - 0.12 - size( name )[ 2 ] / 2 ).multiply( turn( t ) );		// (its ends clear of the curved wall)
			place( name, F );
			if ( name === 'sideboard' ) {

				const [ w, h ] = size( name );
				for ( const [ item, x, tt ] of ON_SIDEBOARD ) place( item, F.clone().multiply( new THREE.Matrix4().makeTranslation( x * w / 2, h, 0.02 ) ).multiply( turn( tt ) ) );
				// the lamp's light
				const lamp = new THREE.Vector3( 0.74 * w / 2, h + 0.75 * size( 'table-lamp' )[ 1 ], 0.02 ).applyMatrix4( F );
				this.lampLight = new THREE.PointLight( '#ffdcb0', 0, 3.5, 2 );
				this.lampLight.position.copy( lamp );
				this.lights.add( this.lampLight );

			}

		}
		// the shelving's ornaments, each on its shelf (the other bay's mirrored)
		for ( const [ b, n ] of this.nichePoints.filter( n => n.kind === 'shelves' ).entries() ) SHELVING.forEach( ( row, k ) => row.forEach( ( items, j ) => {

			const [ y, xs, half ] = this.shelves[ k ], cx = ( b ? - 1 : 1 ) * xs[ j ];
			for ( const [ item, x, tt ] of items ) place( item, n.F.clone().multiply( new THREE.Matrix4().makeTranslation( cx + ( b ? - 1 : 1 ) * x * half * 0.6, y, n.o.depth * 0.5 ) ).multiply( turn( b ? - tt : tt ) ), b === 1 );

		} ) );
		this.pack = pack;
		this.group.add( pack );

	}

}

let prefetch = null;
/** Start fetching the pack (safe to call repeatedly); resolves to its bytes. */
export function prefetchLuminara() {

	if ( prefetch ) return prefetch;
	const url = new URL( 'luminara/luminara.glb', new URL( import.meta.env.BASE_URL, location.href ) );
	prefetch = fetch( url, { priority: 'high' } ).then( r => { if ( ! r.ok ) throw new Error( `luminara.glb: HTTP ${ r.status }` ); return r.arrayBuffer(); } );
	return prefetch;

}

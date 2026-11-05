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
import { PlaneMirror, chainCompile } from './mirror.js';

export const LUMINARA = {
	radius: 7.0,		// the wall
	wall: 3.75,			// its height, to the cornice
	bays: 12,
	pilaster: 0.3,		// wide
	floorTile: 1.8,		// the marble's repeat (m)
};
const R = LUMINARA.radius, BAY = 2 * Math.PI / LUMINARA.bays;

// what each bay holds (k: its centre at φ = k BAY): its opening in the wall (s across, y up, m;
// `circle`: a round window; `arch`: half width a, from y0, its semicircle springing at yS; `rect`:
// half width a, y0 to y1, corners rounded rc; `none`: the plain wall), how deep (to the back: a
// flat panel; a window goes through)
const OPENINGS = {
	window: { shape: 'circle', a: 1.5, yc: 1.95, depth: 0.6 },		// (from just above the skirting almost to the cornice; deep: the wall's thickness)
	shelves: { shape: 'rect', a: 1.36, y0: 0.32, y1: 3.42, rc: 0.4, rcBottom: 0.06, depth: 0.6 },		// (built-in: a cabinet below, shelves above in two columns; its top corners round, its foot's barely)
	pipes: { shape: 'arch', a: 0.62, y0: 0.5, yS: 2.3, depth: 0.32 },		// (a row of lit pipes, as an organ's)
	clef: { shape: 'none' },		// (the clef and its staff: a light on the wall)
	door: { shape: 'arch', a: 0.9, y0: 0, yS: 2.3, depth: 0.18 },
};
const BAYS = [ 'door', 'window', 'shelves', 'window', 'pipes', 'window', 'clef', 'window', 'pipes', 'window', 'shelves', 'window' ];

// the ceiling: soffits stepping in and up to the dome; each step's edge a line of light (LED), the
// riser behind it washed from its foot: [ r of the lip, y of the soffit ]
const STEPS = [ [ 5.95, 4.15 ], [ 4.6, 4.7 ], [ 3.2, 5.25 ] ];
const DOME = { y: 5.8, rise: 1.05 };		// from the last riser's top, to its crown
const LIP = 0.06, GAP = 0.07;
const DOME_SPOTS = [ 35, - 35, 145, - 145 ];		// φ (deg) of the dome's spots: the first the keys' shadow

// the furniture: [ the pack's node, φ (deg), r (null: its back on the wall), turn (deg, about its own up) ]
const FURNITURE = [
	[ 'sofa-low', 90, 6.05, 0 ], [ 'sofa-low', - 90, 6.05, 0 ],
	[ 'tub-chair', 45, 5.8, 0 ], [ 'tub-chair', 135, 5.8, 0 ], [ 'tub-chair', - 45, 5.8, 0 ], [ 'tub-chair', - 135, 5.8, 0 ],
	[ 'side-table', 63, 6.35, 0 ], [ 'side-table', 117, 6.35, 0 ], [ 'side-table', - 63, 6.35, 0 ], [ 'side-table', - 117, 6.35, 0 ],
	[ 'plant', 159, 6.25, 0 ], [ 'plant', - 159, 6.25, 40 ], [ 'plant', 22, 6.25, 80 ], [ 'plant', - 22, 6.25, 120 ],
	[ 'sideboard', 180, null, 0 ],
];
// on the sideboard: [ node, x along it (fraction of its half length), turn (deg) ]
const ON_SIDEBOARD = [ [ 'table-lamp', 0.74, 0 ], [ 'roses', - 0.66, 0 ], [ 'gold-disc', 0.18, - 12 ], [ 'books', - 0.18, 0 ] ];		// (the lamp clear of the clef, on the left)
// in the shelving: per surface (src: _shelving's: the cabinet's top in the narrow column, in the wide one,
// the narrow column's shelves, the wide one's, bottom up): ornaments [ node, x in it (-1..1), turn ]
const SHELVING = [
	[ [ 'roses', - 0.3, 0 ], [ 'books', 0.45, 0 ] ],
	[ [ 'clef-statue', - 0.55, 0 ], [ 'gold-disc', 0.05, - 12 ], [ 'crystal', 0.6, 0 ] ],
	[ [ 'gold-ribbon', - 0.3, 20 ], [ 'crystal', 0.4, 0 ] ],
	[ [ 'books', 0, 0 ] ],
	[ [ 'books', - 0.45, 0 ], [ 'gold-ribbon', 0.45, - 25 ] ],
	[ [ 'roses', - 0.45, 0 ], [ 'clef-statue', 0.45, 0 ] ],
];
const COFFEE = [ [ 90, 4.8 ], [ - 90, 4.8 ] ];		// drum coffee tables before the sofas (built here)

// Lit as such a room would be, by its own fixtures (no stage spots but in Recital): the coves and the
// dome (emissive: their light reaches the room through the probe, `env`), four spots in the dome's rim on the piano
// (`dome`, cd; the first, from the player's right, casts the keys' shadows), a sconce on each pilaster
// (a frosted tube: `sconce`, its glow on the walls round it too), the niches' own lights, the lines
// of light in three tiers (led: the ceiling's, the main ones and the only ones blooming; ledWall: the
// walls' ornament; ledFloor), the windows' outside one of four hours (`outside`; the probe sees it).
// Neutral white (about 4000 K) by day and at the blue hour, warm (2700-3000 K) at night. Bloom faint (a bright room: more reads overexposed). ACES keeps the contrast.
// The windows lead: their sky bright, the room's own light in the bake scaled by `bakeInterior` (the day's most).
export const LUMINARA_PRESETS = {
	'Afternoon': { baked: true, bakeInterior: 0.55, shelf: 1.0, outside: 'day', sky: 1.8, cove: 1.6, coveColor: '#ffe8cc', dome: 130, downColor: '#fff1e2', sconce: 5, sconceColor: '#fff0dc', niche: 1.0, nicheColor: '#ffe4c2', led: 12, ledWall: 2.8, ledFloor: 1.1, ledColor: '#ffe9cf', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.75, exposure: 0.56, tone: 'ACES', saturation: 1.0, bloom: 0.1, bloomThreshold: 8 },
	'Golden hour': { baked: true, bakeInterior: 0.6, shelf: 1.1, outside: 'sunset', sky: 1.6, cove: 1.8, coveColor: '#ffdcb0', dome: 120, downColor: '#ffe2c2', sconce: 5.5, sconceColor: '#ffe4c4', niche: 1.1, nicheColor: '#ffd6a8', led: 13, ledWall: 3, ledFloor: 1.2, ledColor: '#ffdcb2', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.7, exposure: 0.58, tone: 'ACES', saturation: 1.0, bloom: 0.1, bloomThreshold: 8 },
	'Blue hour': { baked: true, bakeInterior: 0.75, shelf: 1.2, outside: 'dusk', sky: 1.2, cove: 2.0, coveColor: '#ffe8cc', dome: 130, downColor: '#fff1e2', sconce: 6, sconceColor: '#fff0dc', niche: 1.2, nicheColor: '#ffe4c2', led: 14, ledWall: 3.2, ledFloor: 1.3, ledColor: '#ffe9cf', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.62, exposure: 0.6, tone: 'ACES', saturation: 1.0, bloom: 0.12, bloomThreshold: 8 },
	'Night': { baked: true, bakeInterior: 0.85, shelf: 1.3, outside: 'night', sky: 0.5, cove: 2.2, coveColor: '#ffc283', dome: 140, downColor: '#ffcd95', sconce: 6.5, sconceColor: '#ffd6a4', niche: 1.3, nicheColor: '#ffc07a', led: 15, ledWall: 3.4, ledFloor: 1.4, ledColor: '#ffc283', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.55, exposure: 0.62, tone: 'ACES', saturation: 1.0, bloom: 0.12, bloomThreshold: 8 },
	// the house down, the piano under a single spot from the dome's crown
	'Recital': { baked: true, bakeInterior: 0.9, shelf: 0.45, outside: 'night', sky: 0.32, cove: 0.5, coveColor: '#ffc283', dome: 0, downColor: '#ffcd95', sconce: 1.6, sconceColor: '#ffd6a4', niche: 0.4, nicheColor: '#ffc07a', led: 4, ledWall: 1.1, ledFloor: 0.5, ledColor: '#ffc283', top: 900, topColor: '#fff0dc', topAngle: 15, env: 0.3, exposure: 0.62, tone: 'ACES', saturation: 1.05, bloom: 0.12, bloomThreshold: 8 },
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
 * `material` lit by the line lights too, cheaply (no shadow, diffuse only): the sconces' tubes and the
 * strips under the shelves, each a segment of radiant intensity per metre (uSegCol: its colour × W/m/sr),
 * its light at a point the line's integral 1 / d² along it ((atan(e1/r) - atan(e0/r)) / r) × the cosines
 * at its nearest point (the receiver's; the strip's own, it faces one way: uSegN.w 1; a tube's none).
 * uSegClip: a plane the receiver must be in front of (a strip: inside its niche). Real lights for twenty
 * of them would cost every material in the room. `U`: the uniforms (shared); uSconceOff: their light
 * already in the lightmap (the baked materials').
 */
function addSegmentGlow( material, U ) {

	chainCompile( material, shader => {

		Object.assign( shader.uniforms, U );
		shader.defines = { ...shader.defines, SEGS: U.uSegA.value.length };
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vSegWorld;' )
			.replace( '#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSegWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vSegWorld;\nuniform vec3 uSegA[ SEGS ];\nuniform vec3 uSegB[ SEGS ];\nuniform vec4 uSegN[ SEGS ];\nuniform vec4 uSegClip[ SEGS ];\nuniform vec3 uSegCol[ SEGS ];\nuniform float uSconceOff;' )
			.replace( '#include <lights_fragment_end>', `if ( uSconceOff < 0.5 ) {

				vec3 P = vSegWorld, Nw = inverseTransformDirection( geometryNormal, viewMatrix ), E = vec3( 0.0 );
				for ( int i = 0; i < SEGS; i ++ ) {

					if ( dot( uSegClip[ i ].xyz, P ) + uSegClip[ i ].w < 0.0 ) continue;
					vec3 a = uSegA[ i ], ab = uSegB[ i ] - a; float L = length( ab ); vec3 u = ab / L;
					float sf = dot( P - a, u ), r = max( length( a + u * sf - P ), 0.02 );
					vec3 l = a + u * clamp( sf, 0.0, L ) - P; float d = length( l ); l /= max( d, 1e-4 );
					float c = max( dot( Nw, l ), 0.0 ) * ( uSegN[ i ].w > 0.5 ? max( dot( uSegN[ i ].xyz, - l ), 0.0 ) : 1.0 );
					E += uSegCol[ i ] * c * ( atan( ( L - sf ) / r ) - atan( - sf / r ) ) / r;

				}
				reflectedLight.directDiffuse += BRDF_Lambert( material.diffuseColor ) * E;

			}
			#include <lights_fragment_end>` );

	}, 'luminaraSegments' );

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
		const rc = dy >= 0 ? o.rc : o.rcBottom ?? o.rc;		// (its top corners and its foot's)
		const px = Math.abs( t * dx ), py = Math.abs( t * dy ), cx = o.a - rc, cy = hh - rc;
		if ( px > cx && py > cy ) {		// a rounded corner: the ray against its circle

			const ax = Math.abs( dx ), ay = Math.abs( dy ), b = ax * cx + ay * cy;
			t = b + Math.sqrt( b * b - ( cx * cx + cy * cy - rc * rc ) );

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

/**
 * A glyph's glow and relief, as maps over its em box (the extrusion's cap UVs: its outline's x, y):
 * the outline filled, its distance inside (a two-pass chamfer transform) the stroke's depth; the glow
 * brightest along each stroke's middle and dimmer to its edges (lit acrylic: its light gathers in the
 * thick of it), a little brighter to the top; the relief a dome over the stroke (its normal map).
 */
function glyphMaps( G ) {

	let x0 = Infinity, y0 = Infinity, x1 = - Infinity, y1 = - Infinity;
	for ( const c of G.contours ) for ( const [ x, y ] of c ) { x0 = Math.min( x0, x ); y0 = Math.min( y0, y ); x1 = Math.max( x1, x ); y1 = Math.max( y1, y ); }
	const pad = 0.02; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
	const S = 768, sc = S / Math.max( x1 - x0, y1 - y0 ), W = Math.ceil( ( x1 - x0 ) * sc ), H = Math.ceil( ( y1 - y0 ) * sc );
	const cv = document.createElement( 'canvas' ); cv.width = W; cv.height = H;
	const g = cv.getContext( '2d' );
	g.beginPath();
	for ( const c of G.contours ) { c.forEach( ( [ x, y ], i ) => g[ i ? 'lineTo' : 'moveTo' ]( ( x - x0 ) * sc, ( y1 - y ) * sc ) ); g.closePath(); }
	g.fill( 'nonzero' );
	const img = g.getImageData( 0, 0, W, H ).data, D = new Float32Array( W * H );
	for ( let i = 0; i < W * H; ++ i ) D[ i ] = img[ 4 * i + 3 ] > 127 ? 1e6 : 0;
	const at = ( x, y ) => ( x < 0 || y < 0 || x >= W || y >= H ) ? 0 : D[ y * W + x ];
	for ( let y = 0; y < H; ++ y ) for ( let x = 0; x < W; ++ x ) if ( D[ y * W + x ] ) D[ y * W + x ] = Math.min( D[ y * W + x ], at( x - 1, y ) + 1, at( x, y - 1 ) + 1, at( x - 1, y - 1 ) + 1.414, at( x + 1, y - 1 ) + 1.414 );
	for ( let y = H - 1; y >= 0; -- y ) for ( let x = W - 1; x >= 0; -- x ) if ( D[ y * W + x ] ) D[ y * W + x ] = Math.min( D[ y * W + x ], at( x + 1, y ) + 1, at( x, y + 1 ) + 1, at( x + 1, y + 1 ) + 1.414, at( x - 1, y + 1 ) + 1.414 );
	// each stroke's own half width: the distance's local maximum (a sliding max, rows then columns, over
	// the widest stroke's span); t = its distance over that, 1 along every stroke's middle line
	const span = Math.ceil( 0.07 * sc ), Mx = new Float32Array( W * H ), My = new Float32Array( W * H );
	for ( let y = 0; y < H; ++ y ) for ( let x = 0; x < W; ++ x ) { let m = 0; for ( let k = Math.max( 0, x - span ); k <= Math.min( W - 1, x + span ); ++ k ) m = Math.max( m, D[ y * W + k ] ); Mx[ y * W + x ] = m; }
	for ( let x = 0; x < W; ++ x ) for ( let y = 0; y < H; ++ y ) { let m = 0; for ( let k = Math.max( 0, y - span ); k <= Math.min( H - 1, y + span ); ++ k ) m = Math.max( m, Mx[ k * W + x ] ); My[ y * W + x ] = m; }
	const ht = new Float32Array( W * H ), tt = new Float32Array( W * H );
	for ( let i = 0; i < W * H; ++ i ) {

		const t = D[ i ] ? Math.min( 1, D[ i ] / Math.max( 1, My[ i ] ) ) : 0;
		tt[ i ] = t;
		ht[ i ] = Math.sqrt( Math.max( 0, 1 - ( 1 - t ) ** 2 ) ) * Math.min( 1, My[ i ] / ( 0.03 * sc ) );		// (a dome over the stroke; a hairline's lower)

	}
	const glow = new Uint8Array( 4 * W * H ), nor = new Uint8Array( 4 * W * H ), h = ( x, y ) => ht[ Math.min( H - 1, Math.max( 0, y ) ) * W + Math.min( W - 1, Math.max( 0, x ) ) ];
	const gain = 0.6 * 0.03 * sc;		// (the relief's slope: its height in px over a stroke's half width)
	for ( let y = 0; y < H; ++ y ) for ( let x = 0; x < W; ++ x ) {

		const i = y * W + x, t = tt[ i ], up = 1 - y / H;
		const e = D[ i ] ? 0.22 + 0.78 * t ** 1.4 + 0.1 * up : 0.3;		// (its middle bright, its edges dim; outside: the sides' and bevels' texels)
		glow[ 4 * i ] = glow[ 4 * i + 1 ] = glow[ 4 * i + 2 ] = Math.min( 255, Math.round( 255 * e / 1.1 ) ); glow[ 4 * i + 3 ] = 255;
		const dx = ( h( x + 1, y ) - h( x - 1, y ) ) * gain / 2, dy = ( h( x, y - 1 ) - h( x, y + 1 ) ) * gain / 2, l = Math.hypot( dx, dy, 1 );		// (y up: the image's rows down)
		nor[ 4 * i ] = Math.round( 255 * ( 0.5 - 0.5 * dx / l ) ); nor[ 4 * i + 1 ] = Math.round( 255 * ( 0.5 - 0.5 * dy / l ) ); nor[ 4 * i + 2 ] = Math.round( 255 * ( 0.5 + 0.5 / l ) ); nor[ 4 * i + 3 ] = 255;

	}
	const tex = ( data, srgb ) => {

		const t = new THREE.DataTexture( data, W, H );
		t.flipY = true;		// (the image's rows from the top; the cap's v up)
		t.repeat.set( 1 / ( x1 - x0 ), 1 / ( y1 - y0 ) ); t.offset.set( - x0 / ( x1 - x0 ), - y0 / ( y1 - y0 ) );
		t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
		if ( srgb ) t.colorSpace = THREE.SRGBColorSpace;
		t.needsUpdate = true;
		return t;

	};
	return { glow: tex( glow, false ), normal: tex( nor, false ) };

}

/**
 * A leather's fine grain on `material`, without UVs (TRELLIS's meshes have none): its normal (and its
 * coat's) tilted by a little value noise in the object's own space, a few mm across, so the coat's
 * highlight breaks up as on hide.
 */
function leather( material ) {

	chainCompile( material, shader => {

		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vGrainPos;' )
			.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvGrainPos = position;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>
			varying vec3 vGrainPos;
			float gHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
			float gNoise( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
				return mix( mix( mix( gHash( i ), gHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( gHash( i + vec3( 0, 1, 0 ) ), gHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
					mix( mix( gHash( i + vec3( 0, 0, 1 ) ), gHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( gHash( i + vec3( 0, 1, 1 ) ), gHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }
			vec3 gGrad( vec3 p ) { const float e = 0.15; return vec3( gNoise( p + vec3( e, 0, 0 ) ) - gNoise( p - vec3( e, 0, 0 ) ), gNoise( p + vec3( 0, e, 0 ) ) - gNoise( p - vec3( 0, e, 0 ) ), gNoise( p + vec3( 0, 0, e ) ) - gNoise( p - vec3( 0, 0, e ) ) ) / ( 2.0 * e ); }` )
			.replace( '#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
			{		// (after both normals are set: the coat's declared in clearcoat_normal_fragment_begin)
				vec3 gp = vGrainPos * 260.0, gv = ( viewMatrix * vec4( gGrad( gp ) + 0.5 * gGrad( gp * 2.3 ), 0.0 ) ).xyz;
				normal = normalize( normal - 0.05 * ( gv - dot( gv, normal ) * normal ) );
				#ifdef USE_CLEARCOAT
					clearcoatNormal = normalize( clearcoatNormal - 0.035 * ( gv - dot( gv, clearcoatNormal ) * clearcoatNormal ) );
				#endif
			}` );

	}, 'leatherGrain' );
	return material;

}

/** A gradient along u (64 x 1, linear): a staff line's glow along it. */
function gradientU( f ) {

	const N = 64, d = new Uint8Array( 4 * N );
	for ( let i = 0; i < N; ++ i ) { const v = Math.round( 255 * Math.min( 1, Math.max( 0, f( i / ( N - 1 ) ) ) ) ); d.set( [ v, v, v, 255 ], 4 * i ); }
	const t = new THREE.DataTexture( d, N, 1 );
	t.magFilter = t.minFilter = THREE.LinearFilter;
	t.needsUpdate = true;
	return t;

}

/**
 * A gold record on a brass stand (in place of TRELLIS's: its grooves need their own UVs): the disc's
 * faces with u round it and v out (anisotropy along u: the grooves' direction, so its highlight
 * spreads round it, the fan-shaped flare of a record), in bands (stronger on the tracks, weaker in the
 * gaps between them), a matt label, the hole; leaning back a little in a slotted base with a prop
 * behind. Its base on y 0, its face +z (as the pack's nodes); 0.36 m high.
 */
function goldRecord( segU ) {

	const Rr = 0.15, r0 = 0.05, th = 0.003, NA = 128, NR = 36, P = [], UV = [], I = [];
	for ( const side of [ 1, - 1 ] ) {

		const base = P.length / 3;
		for ( let j = 0; j <= NR; ++ j ) for ( let i = 0; i <= NA; ++ i ) {

			const a = 2 * Math.PI * i / NA, r = r0 + ( Rr - r0 ) * j / NR;
			P.push( r * Math.cos( a ), r * Math.sin( a ), side * th / 2 ); UV.push( i / NA * 16, j / NR );		// (u: 16 rounds of the map)

		}
		for ( let j = 0; j < NR; ++ j ) for ( let i = 0; i < NA; ++ i ) {

			const a = base + j * ( NA + 1 ) + i, b = a + 1, c = a + NA + 1, d = c + 1;
			if ( side > 0 ) I.push( a, b, d, a, d, c ); else I.push( a, d, b, a, c, d );

		}

	}
	const disc = new THREE.BufferGeometry();
	disc.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) ); disc.setAttribute( 'uv', new THREE.Float32BufferAttribute( UV, 2 ) ); disc.setIndex( I ); disc.computeVertexNormals();
	// the anisotropy map: direction along u (rg 1, 0.5), strength (b) by the tracks
	const AN = 256, ad = new Uint8Array( 4 * AN );
	for ( let j = 0; j < AN; ++ j ) { const v = j / ( AN - 1 ), band = Math.abs( Math.sin( v * Math.PI * 6 ) ); ad.set( [ 255, 128, Math.round( 255 * ( 0.35 + 0.65 * Math.min( 1, band * 1.6 ) ) ), 255 ], 4 * j ); }
	const am = new THREE.DataTexture( ad, 1, AN ); am.wrapS = THREE.RepeatWrapping; am.magFilter = am.minFilter = THREE.LinearFilter; am.needsUpdate = true;
	const gold = new THREE.MeshPhysicalMaterial( { color: '#e3b864', metalness: 1, roughness: 0.22, anisotropy: 1, anisotropyRotation: 0, anisotropyMap: am, side: THREE.DoubleSide } );
	const label = new THREE.MeshPhysicalMaterial( { color: '#c9a25a', metalness: 0.85, roughness: 0.55 } );
	const brass = new THREE.MeshPhysicalMaterial( { color: '#d6a95c', metalness: 1, roughness: 0.3 } );
	for ( const m of [ gold, label, brass ] ) addSegmentGlow( m, segU );
	const rec = new THREE.Group(), mesh = ( g, m ) => { const o = new THREE.Mesh( g, m ); o.castShadow = o.receiveShadow = true; rec.add( o ); return o; };
	mesh( disc, gold );
	mesh( new THREE.CylinderGeometry( Rr, Rr, th, NA, 1, true ).rotateX( Math.PI / 2 ), gold );
	for ( const side of [ 1, - 1 ] ) mesh( new THREE.RingGeometry( 0.006, r0, 64 ).translate( 0, 0, side * ( th / 2 + 0.0002 ) ).rotateY( side > 0 ? 0 : Math.PI ), label );
	const tilt = 0.1, group = new THREE.Group(), base = 0.022;
	rec.rotation.x = - tilt; rec.position.set( 0, base + Rr * Math.cos( tilt ) - 0.004, - Rr * Math.sin( tilt ) );
	group.add( rec );
	const stand = ( g, x = 0, y = 0, z = 0 ) => { const o = new THREE.Mesh( g.translate( x, y, z ), brass ); o.castShadow = o.receiveShadow = true; group.add( o ); };
	stand( new RoundedBoxGeometry( 0.16, base, 0.07, 2, 0.006 ), 0, base / 2, - 0.01 );
	stand( new THREE.CylinderGeometry( 0.004, 0.004, 0.2, 8 ).rotateX( 0.45 ), 0, base + 0.08, - 0.075 );
	return group;

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
		this.view = { maxDistance: 6, maxPolarAngle: Math.PI * 0.6 };
		this.background = new THREE.Color( '#0b1426' );
		this.pack = null;			// the furniture etc. once loaded (a group)
		this.loading = Promise.resolve();
		this.onLoad = null;		// called once the pack shows (main.js: the probe again)
		this.glow = [];			// the pack's materials glowing with the walls' lines (the clef's raised pattern)
		this.skies = {};		// the windows' outsides, by hour (the pack's)
		// the line lights (the sconces, the shelves' strips: addSegmentGlow), the pack's materials' a copy lit always (not baked)
		this.segU = { uSegA: { value: [] }, uSegB: { value: [] }, uSegN: { value: [] }, uSegClip: { value: [] }, uSegCol: { value: [] } };
		this.segments = [];
		const black = new THREE.DataTexture( new Uint8Array( 4 ), 1, 1 ); black.needsUpdate = true;
		this.bakeU = { uBake: { value: black }, uBakeScale: { value: 1 }, uBakeOn: { value: 0 } };
		this.segU.uSconceOff = this.bakeU.uBakeOn;		// (the same: baked, the line lights' is in the map)
		this.segUPack = { ...this.segU, uSconceOff: { value: 0 } };
		this.bakes = null;		// preset -> { map, scale } (the pack's, while its shell is ours)

		this.materials = {
			wall: phys( { color: '#f1e3cf', roughness: 0.85, side: THREE.DoubleSide } ),		// (warm cream, plain, as the reference's: its light and shade the bake's)
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
		this.materials.shelfLed = this.materials.led.clone();		// (the shelves' strips: seen dim; their light: the segments')
		this.materials.stepLed = this.materials.led.clone();		// (the skirting's step lights)
		for ( const m of [ this.materials.wall, this.materials.lacquer ] ) addSegmentGlow( m, this.segU );
		this.mirror = new PlaneMirror( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ) );		// (the floor's: src/mirror.js)
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
	bounds() { return { minX: - 4.2, maxX: 4.2, minZ: - 4.2, maxZ: 4.2 }; }

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
			'The clef': { position: at( 25, 2.6, 1.6 ), target: at( 180, R, 1.9 ) },
			'The coves': { position: at( 200, 3.6, 1.4 ), target: new THREE.Vector3( 0, 5.2, 0 ) },
		};

	}

	lightControls() {

		return [
			[ 'baked', 'bool', 'Baked light (its preset\'s lightmap)' ], [ 'outside', LUMINARA_OUTSIDE, 'Outside' ], [ 'sky', 0, 4, 0.01, 'Sky (windows)' ],
			[ 'cove', 0, 8, 0.01, 'Coves' ], [ 'coveColor', 'color', 'Cove color' ],
			[ 'dome', 0, 400, 1, 'Dome spots (cd)' ], [ 'downColor', 'color', 'Downlight color' ],
			[ 'sconce', 0, 15, 0.1, 'Sconces' ], [ 'sconceColor', 'color', 'Sconce color' ], [ 'shelf', 0, 6, 0.01, 'Shelf strips' ],
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
		this._shelvingCount = 0;
		this.segments = [];		// { a, b, n (the strip's facing; null: a tube), clip (a plane, Vector4; null), kind }

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
			this.segments.push( { a: pil.sconce.seg[ 0 ].clone().applyMatrix4( F ), b: pil.sconce.seg[ 1 ].clone().applyMatrix4( F ), n: null, clip: null, kind: 'sconce' } );

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
		// four spots in the dome's rim on the piano (brass cans, aimed)
		this.domeAt = DOME_SPOTS.map( deg => {

			const rd = 0.85 * ( STEPS[ 2 ][ 0 ] - GAP ), phi = deg * Math.PI / 180, t = Math.acos( rd / ( STEPS[ 2 ][ 0 ] - GAP ) ), p = outward( phi ).multiplyScalar( rd ).setY( DOME.y + DOME.rise * Math.sin( t ) - 0.06 );
			const aim = new THREE.Vector3( 0, 0.8, 0 ), dir = aim.clone().sub( p ).normalize(), q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, - 1, 0 ), dir );
			const can = new THREE.CylinderGeometry( 0.045, 0.05, 0.11, 32, 1, true ).applyQuaternion( q ).translate( p.x, p.y, p.z );
			add( can, M.brass );
			add( new THREE.CircleGeometry( 0.042, 32 ).rotateX( Math.PI / 2 ).applyQuaternion( q ).translate( ...p.clone().addScaledVector( dir, 0.05 ).toArray() ), M.led );
			return [ p.clone().addScaledVector( dir, 0.07 ), aim ];

		} );
		let r0 = R - 0.2;
		for ( let i = 0; i < STEPS.length; ++ i ) {

			const [ r, y ] = STEPS[ i ], yNext = i + 1 < STEPS.length ? STEPS[ i + 1 ][ 1 ] : DOME.y;
			lathe( [ [ r0 + 0.02, y ], [ r, y ] ], M.ceiling );		// (its outer edge tucked behind the riser or cornice above it)
			lathe( [ [ r, y ], [ r, y - LIP ], [ r - 0.025, y - LIP ], [ r - 0.025, y ] ], M.ceiling );
			lathe( [ [ r - 0.026, y - LIP + 0.008 ], [ r - 0.026, y - 0.008 ] ], M.led );		// (the step's edge: a line of light)
			lathe( [ [ r - 0.02, y ], [ r - GAP - 0.01, y ] ], M.ceiling );		// (the gap's floor: the strip's; under the lip and the riser's foot)
			const rr = r - GAP, rise = [];
			for ( let j = 0; j <= 12; ++ j ) rise.push( [ rr, y + ( yNext - y ) * j / 12 ] );
			lathe( rise, M.cove );
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
			lathe( dome, M.dome );
			lathe( [ [ r0 - 0.002, DOME.y - 0.035 ], [ r0 - 0.002, DOME.y - 0.01 ] ], M.led );

		}

		// the floor: the marble field, a border band of darker marble, brass rings
		const disc = ( r1, r2, y, mat ) => {

			const g = r1 > 0 ? new THREE.RingGeometry( r1, r2, 256, 1 ) : new THREE.CircleGeometry( r2, 256 );
			g.rotateX( - Math.PI / 2 ).translate( 0, y, 0 );
			const p = g.attributes.position, uv = g.attributes.uv;
			for ( let i = 0; i < p.count; ++ i ) uv.setXY( i, p.getX( i ) / LUMINARA.floorTile, - p.getZ( i ) / LUMINARA.floorTile );
			return g;

		};
		const floor = new THREE.Mesh( disc( 0, R - 0.58, 0, null ), M.floor ), border = new THREE.Mesh( disc( R - 0.58, R + 0.05, 0, null ), M.border );
		for ( const m of [ floor, border ] ) { m.receiveShadow = true; m.name = 'luminara:floor'; this.group.add( m ); }
		this.floorMeshes = [ floor, border ];		// (hidden while their reflection is drawn)
		for ( const [ a, b ] of [ [ 2.68, 2.695 ], [ R - 0.62, R - 0.58 ] ] ) add( disc( a, b, 0.0005 ), M.inlay );
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
			mesh.castShadow = ! [ M.cove, M.dome, M.ceiling, M.led, M.ledWall, M.ledFloor, M.shelfLed, M.stepLed, M.sconce, M.neon ].includes( mat );
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
		{		// the line lights' uniforms (their count fixed from the first build: the shaders')

			const U = this.segU, live = this.segments.filter( g => g.kind !== 'step' );		// (the step lights: on the floor, which takes no glow; baked)
			for ( const g of this.segments ) g.col = new THREE.Color();
			U.uSegA.value = live.map( g => g.a ); U.uSegB.value = live.map( g => g.b );
			U.uSegN.value = live.map( g => g.n ? new THREE.Vector4( g.n.x, g.n.y, g.n.z, 1 ) : new THREE.Vector4( 0, 0, 0, 0 ) );
			U.uSegClip.value = live.map( g => g.clip ?? new THREE.Vector4( 0, 0, 0, 1 ) );
			U.uSegCol.value = live.map( g => g.col );

		}
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
		const revealRings = [ 0, 0.25, 0.5, 0.75, 1 ].map( q => outline.map( ( [ s, y ], i ) => [ onWall( phiC, s, y ).lerp( back( s, y ), q ), i / outline.length * 4, q * o.depth ] ) );
		add( ringsGeometry( revealRings, o.shape !== 'circle' ), o.shape === 'circle' ? M.lacquer : M.wall );
		const F = frameAt( phiC, Db );		// (the back's frame: z 0 the back, +z into the room)
		if ( o.shape === 'circle' ) {

			// a round window: a white frame and a brass ring inside it, on the wall
			// its rings as tubes along circles on the curved wall (flat tori stood off it in the middle and
			// sank into it at the sides): a thick rolled frame, a brass ring inside it, one at the reveal's far end
			const ring = rr => { const pts = []; for ( let i = 0; i < 192; ++ i ) { const t = 2 * Math.PI * i / 192; pts.push( [ rr * Math.cos( t ), o.yc + rr * Math.sin( t ) ] ); } return pts; };
			add( this._wallTube( phiC, ring( o.a + 0.06 ), 0.1, true, R - 0.02, 20 ), M.lacquer );
			add( this._wallTube( phiC, ring( o.a + 0.004 ), 0.018, true, R - 0.06, 10 ), M.brass );
			add( this._wallTube( phiC, ring( o.a - 0.012 ), 0.014, true, R + o.depth - 0.03, 10 ), M.brass );
			return;

		}
		// an arch: its back flat (lit from behind in a niche; the doors in the door's)
		const shape = new THREE.Shape();
		if ( o.shape === 'rect' ) {

			const { a, y0, y1, rc } = o, rb = o.rcBottom ?? rc;
			shape.moveTo( a, y0 + rb ); shape.lineTo( a, y1 - rc ); shape.absarc( a - rc, y1 - rc, rc, 0, Math.PI / 2, false ); shape.lineTo( - a + rc, y1 );
			shape.absarc( - a + rc, y1 - rc, rc, Math.PI / 2, Math.PI, false ); shape.lineTo( - a, y0 + rb ); shape.absarc( - a + rb, y0 + rb, rb, Math.PI, 1.5 * Math.PI, false );
			shape.lineTo( a - rb, y0 ); shape.absarc( a - rb, y0 + rb, rb, 1.5 * Math.PI, 2 * Math.PI, false );

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

			add( backGeo, kind === 'pipes' ? M.lacquer : kind === 'clef' || kind === 'shelves' ? M.wall : M.niche );		// (the clef: its pattern glows; the shelves: lit by their strips, not from behind)
			const mid = new THREE.Vector3( 0, ( o.y0 + ( o.y1 ?? o.yS ) ) / 2, 0.25 ).applyMatrix4( F );
			this.nichePoints.push( { kind, F, o, light: mid } );
			if ( kind === 'shelves' ) this.nichePoints[ this.nichePoints.length - 1 ].surfaces = this._shelving( add, F, o );
			if ( kind === 'pipes' ) this._pipes( add, F, o );
			if ( kind !== 'shelves' ) add( new THREE.BoxGeometry( 2 * o.a - 0.04, 0.01, 0.012 ).translate( 0, o.y0 + 0.006, 0.02 ).applyMatrix4( F ), M.ledWall );		// (a strip along the back's foot)

		}
		add( this._archTrim( phiC, o ), kind === 'door' ? M.brass : M.ledWall );

	}

	/** A band round an arch on the wall (its two sides and the semicircle), or round a rounded rect: brass, or a line of light. */
	_archTrim( phiC, o ) {

		if ( o.shape === 'rect' ) {

			const g = { ...o, a: o.a + 0.03, y0: o.y0 - 0.03, y1: o.y1 + 0.03, rc: o.rc + 0.03, rcBottom: ( o.rcBottom ?? o.rc ) + 0.03 }, c = centreOf( g ), pts = [];
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
	_wallTube( phiC, pts, tube, closed, r = R - 0.006, radial = 8 ) {		// (`r`: the cylinder it follows)

		const curve = new THREE.CatmullRomCurve3( pts.map( ( [ s, y ] ) => onWall( phiC, s, y, r ) ), closed, 'catmullrom', 0.1 );
		return new THREE.TubeGeometry( curve, Math.max( 64, pts.length * 2 ), tube, radial, closed );

	}

	/** Built-in shelving in a rounded-rect niche (frame F: its back): four shelves, two uprights, a strip of light under each shelf's front. */
	_shelving( add, F, o ) {

		// as the reference's, not a grid: a closed lacquered cabinet along the foot (three doors, brass
		// pulls), above it an upright off the middle, two columns of shelves at different heights; a
		// strip of light under each shelf (and the niche's top) along its back edge, by the back wall,
		// facing down and a little back: each part lit from its top, its back washed below it. Its
		// light: a line light (addSegmentGlow, the bake's). Surfaces for ornaments: n.surfaces
		const M = this.materials, t = 0.035, d = o.depth, m = this._shelvingCount = ( this._shelvingCount ?? 0 ) + 1, sx = m % 2 ? 1 : - 1;		// (the other bay's mirrored)
		const cabTop = o.y0 + 0.62, xDiv = sx * - 0.18, top = o.y1 - 0.02;
		const facing = new THREE.Vector3( 0, - 0.85, 0.53 ).normalize();		// (in F: z into the room; back: - z)
		const strip = ( x0, x1, y ) => {

			const z = 0.04, yy = y - 0.007, cx = ( x0 + x1 ) / 2, half = ( x1 - x0 ) / 2;
			add( new THREE.BoxGeometry( 2 * half, 0.007, 0.012 ).translate( cx, yy, z ).applyMatrix4( F ), M.shelfLed );
			const a = new THREE.Vector3( x0, yy - 0.004, z ).applyMatrix4( F ), b = new THREE.Vector3( x1, yy - 0.004, z ).applyMatrix4( F );
			const n = new THREE.Vector3( facing.x, facing.y, - facing.z ).transformDirection( F );		// (down, and to the back wall)
			const out = new THREE.Vector3( 0, 0, 1 ).transformDirection( F ).negate(), opening = new THREE.Vector3( 0, 0, d + 0.02 ).applyMatrix4( F );
			this.segments.push( { a, b, n, clip: new THREE.Vector4( out.x, out.y, out.z, - out.dot( opening ) ), kind: 'shelf' } );		// (only inside its niche)

		};
		const board = ( x0, x1, y ) => add( new RoundedBoxGeometry( x1 - x0, t, d - 0.02, 2, 0.008 ).translate( ( x0 + x1 ) / 2, y - t / 2, d / 2 - 0.01 ).applyMatrix4( F ), M.lacquer );
		// the cabinet: its body, its top, its doors and pulls
		const cw = 2 * o.a - 0.02;
		add( new RoundedBoxGeometry( cw, cabTop - o.y0 - t, d - 0.03, 2, 0.01 ).translate( 0, o.y0 + ( cabTop - o.y0 - t ) / 2, ( d - 0.03 ) / 2 ).applyMatrix4( F ), M.lacquer );
		board( - o.a + 0.01, o.a - 0.01, cabTop );
		for ( let i = 0; i < 3; ++ i ) {

			const x = ( i - 1 ) * cw / 3;
			add( new RoundedBoxGeometry( cw / 3 - 0.012, cabTop - o.y0 - t - 0.04, 0.018, 2, 0.006 ).translate( x, o.y0 + ( cabTop - o.y0 - t ) / 2, d - 0.03 + 0.009 ).applyMatrix4( F ), M.lacquer );
			add( new THREE.CylinderGeometry( 0.006, 0.006, 0.16, 12 ).translate( x + ( i === 1 ? 0 : - Math.sign( x ) * ( cw / 6 - 0.06 ) ), o.y0 + ( cabTop - o.y0 ) * 0.62, d - 0.03 + 0.03 ).applyMatrix4( F ), M.brass );

		}
		// the upright, and the two columns' shelves (the narrow one's higher)
		add( new RoundedBoxGeometry( t, top - cabTop, d - 0.02, 2, 0.008 ).translate( xDiv, ( top + cabTop ) / 2, d / 2 - 0.01 ).applyMatrix4( F ), M.lacquer );
		const L = [ - o.a + 0.01, xDiv - t / 2 ], Rr = [ xDiv + t / 2, o.a - 0.01 ], narrow = sx > 0 ? L : Rr, wide = sx > 0 ? Rr : L;
		const hNarrow = [ cabTop + 1.31, cabTop + 2.21 ], hWide = [ cabTop + 1.0, cabTop + 1.76 ];
		for ( const y of hNarrow ) { board( narrow[ 0 ], narrow[ 1 ], y ); strip( narrow[ 0 ] + 0.06, narrow[ 1 ] - 0.06, y - t ); }
		for ( const y of hWide ) { board( wide[ 0 ], wide[ 1 ], y ); strip( wide[ 0 ] + 0.06, wide[ 1 ] - 0.06, y - t ); }
		strip( - o.a + o.rc + 0.02, o.a - o.rc - 0.02, o.y1 );		// (the niche's top)
		// where the ornaments stand: [ y, x of its middle, half width ] (the cabinet's top in its two
		// columns, then each column's shelves); the ornaments' table (SHELVING) by these, in this order
		const mid = c => ( c[ 0 ] + c[ 1 ] ) / 2, hw = c => ( c[ 1 ] - c[ 0 ] ) / 2 - 0.04;
		return [ [ cabTop, mid( narrow ), hw( narrow ) ], [ cabTop, mid( wide ), hw( wide ) ], ...hNarrow.map( y => [ y, mid( narrow ), hw( narrow ) ] ), ...hWide.map( y => [ y, mid( wide ), hw( wide ) ] ) ];

	}

	/**
	 * The clef and its staff, a light on the wall (frame: bay φc): the treble clef's outline (Noto
	 * Music's) extruded as thick acrylic lit from within, five staff lines sweeping from it across the
	 * wall (tubes, waving, fanning a little), a few notes on them. Each piece on its own place on the
	 * curved wall, a little off it.
	 */
	_clefLight( add, phiC ) {

		const M = this.materials, off = 0.035;
		this.neons ??= {};		// per glyph: its own glow and relief maps (glyphMaps); the staff's
		const glyph = ( name, s, y, h ) => {

			const G = GLYPHS[ name ], path = new THREE.ShapePath();
			for ( const c of G.contours ) { path.moveTo( c[ 0 ][ 0 ], c[ 0 ][ 1 ] ); for ( let i = 1; i < c.length; ++ i ) path.lineTo( c[ i ][ 0 ], c[ i ][ 1 ] ); }
			const shapes = path.toShapes( false );
			const g = new THREE.ExtrudeGeometry( shapes, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.009, bevelSegments: 5, curveSegments: 4 } );
			g.computeBoundingBox();
			const b = g.boundingBox, k = h / ( b.max.y - b.min.y ), kz = 0.05 / 0.22;		// (5 cm deep, whatever its height: it stands out of the wall)
			g.translate( - ( b.min.x + b.max.x ) / 2, - b.min.y, 0.05 ).scale( k, k, kz );
			if ( ! this.neons[ name ] ) {

				const maps = glyphMaps( G ), m = M.neon.clone();
				m.color.set( '#8c8378' );		// (acrylic lit from within: its own light leads, the room's on it less)
				m.emissiveMap = maps.glow; m.normalMap = maps.normal; m.normalScale = new THREE.Vector2( 1.4, 1.4 ); m.clearcoatNormalMap = maps.normal;
				this.neons[ name ] = m;

			}
			add( g.applyMatrix4( frameAt( phiC - s / R, R - off, y ) ), this.neons[ name ] );

		};
		glyph( 'clef', - 1.05, 1.22, 2.05 );
		// the staff: five lines from behind the clef across to the right, rising and waving, brighter in the middle
		this.neons.staff ??= Object.assign( M.neon.clone(), { emissiveMap: gradientU( u => 0.55 + 0.45 * Math.sin( Math.PI * u ) ** 0.7 ) } );
		const line = ( k, t ) => {

			const sx = - 1.4 + 3.0 * t, y = 1.88 + 0.12 * k * ( 1 + 0.35 * t ) + 0.36 * t + 0.14 * Math.sin( Math.PI * ( 1.6 * t + 0.15 ) );
			return [ sx, y ];

		};
		for ( let k = 0; k < 5; ++ k ) {

			const pts = [];
			for ( let i = 0; i <= 60; ++ i ) pts.push( line( k, i / 60 ) );
			const curve = new THREE.CatmullRomCurve3( pts.map( ( [ sx, y ] ) => onWall( phiC, sx, y, R - off ) ) );
			add( new THREE.TubeGeometry( curve, 180, 0.012, 10, false ), this.neons.staff );

		}
		// notes on it
		for ( const [ name, t, k, h ] of [ [ 'quaver', 0.34, 2.6, 0.4 ], [ 'quavers', 0.55, 1.4, 0.44 ], [ 'crotchet', 0.72, 3.2, 0.36 ], [ 'quaver', 0.88, 1.9, 0.4 ] ] ) {

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

		const w = LUMINARA.pilaster, d = 0.12, H = LUMINARA.wall, flutes = 5, fr = 0.02, s = new THREE.Shape();
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

		const y = 1.95, h = 0.42, r = 0.028, z = d + 0.078, brass = [];
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
		this.topSpot.position.set( 0, DOME.y + DOME.rise - 0.25, 0.2 );
		this.topSpot.target.position.set( 0, 0, 0 );
		// the dome's four spots on the piano (placed in rebuild): the first casts the keys' shadow (the
		// key light, 4096), the third the piano's from behind; the others none
		this.domeSpots = DOME_SPOTS.map( ( deg, i ) => {

			const s = spot( THREE.MathUtils.degToRad( 24 ), 0.7, i === 0 ? 4096 : 2048 );
			s.castShadow = i === 0 || i === 2;
			s.radius = 0.08;
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
		this.lights.updateMatrixWorld( true );
		M.sconce.emissive.set( L.sconceColor ); M.sconce.emissiveIntensity = L.sconce;
		for ( const m of [ M.neon, ...Object.values( this.neons ?? {} ) ] ) { m.emissive.set( L.ledColor ).lerp( new THREE.Color( '#ffffff' ), 0.35 ); m.emissiveIntensity = 0.9 * L.ledWall; }		// (its middle about 2.5, its edges under 1: below saturation, its gradient reads)
		if ( this.lampLight ) { this.lampLight.color.set( L.sconceColor ); this.lampLight.intensity = 0.35 * L.sconce; this.lampLight.visible = L.sconce > 0; }
		for ( const m of this.shades ?? [] ) { m.emissive.set( L.sconceColor ); m.emissiveIntensity = 0.5 * L.sconce; }
		// the line lights' intensity per metre: a tube, its radiance × its diameter (0.9: its gradient's mean); a strip, `shelf`
		for ( const g of this.lineLights ) {

			const c = g.col;
			if ( ! c ) continue;
			if ( g.kind === 'sconce' ) c.set( L.sconceColor ).multiplyScalar( 0.9 * L.sconce * 0.056 );
			else if ( g.kind === 'step' ) c.set( L.ledColor ).multiplyScalar( 2.6 * L.ledFloor );
			else c.set( L.ledColor ).multiplyScalar( L.shelf ?? 1 );

		}
		M.shelfLed.emissive.set( L.ledColor ); M.shelfLed.emissiveIntensity = L.ledWall;
		M.stepLed.emissive.set( L.ledColor ); M.stepLed.emissiveIntensity = 3 * L.ledFloor;
		for ( const m of [ M.cove, M.dome ] ) { m.emissive.set( L.coveColor ); m.emissiveIntensity = L.cove * ( m === M.dome ? 0.7 : 1 ); }
		M.niche.emissive.set( L.nicheColor ); M.niche.emissiveIntensity = L.niche;
		for ( const [ m, v ] of [ [ M.led, L.led ], [ M.ledWall, L.ledWall ], [ M.ledFloor, L.ledFloor ] ] ) { m.emissive.set( L.ledColor ); m.emissiveIntensity = v; }
		M.staff.color.set( L.ledColor ).multiplyScalar( 0.75 * L.ledWall );		// (on the ceiling, but ornament: the walls' tier)
		for ( const m of this.glow ) { m.emissive.set( L.ledColor ); m.emissiveIntensity = 2.2 * L.ledWall; }		// (the clef's raised pattern: the walls' brightest, below the bloom)
		if ( this.nicheLights.length !== this.nichePoints.filter( n => n.kind === 'pipes' ).length ) {		// (the pipes' only: the shelves lit by their strips)

			for ( const l of this.nicheLights ) this.lights.remove( l );
			this.nicheLights = this.nichePoints.filter( n => n.kind === 'pipes' ).map( n => {

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

	/** Every line light: the shell's (sconces, shelves) and the pack's (the sideboard's strip). */
	get lineLights() { return [ ...this.segments, ...( this.packSegments ?? [] ) ]; }

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
			if ( ! t || ! Number.isFinite( p.scale ) ) continue;		// (a failed bake: the probe's light)
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
				brassPolished: () => phys( { color: '#e2b46a', metalness: 1, roughness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.05 } ),		// (the sofa's plinth: a clear metal sheen)
				lacquer: () => phys( { color: '#f3f1ed', roughness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.15 } ),		// (more: the shell mirrors the room and reads as glass)
				boucle: () => leather( phys( { color: '#e8dfd0', roughness: 0.55, sheen: 0.25, sheenColor: new THREE.Color( '#fff4e6' ), sheenRoughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.28 } ) ),		// (cream leather: its coat's highlight, a fine grain)
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
			if ( p.isMeshStandardMaterial ) addSegmentGlow( p, this.segUPack );		// (the shelves' ornaments: lit by their strips)
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
		let record = null;
		this.packSegments = [];		// (line lights in the pack's things: the sideboard's strip; baked only)
		const place = ( name, F, mirror = false ) => {

			if ( ! nodes[ name ] && name !== 'gold-disc' ) return;
			const holder = new THREE.Group();
			holder.matrixAutoUpdate = false;
			holder.matrix.copy( F );
			if ( mirror ) holder.matrix.multiply( new THREE.Matrix4().makeScale( - 1, 1, 1 ) );
			if ( name === 'gold-disc' ) { holder.add( ( record ??= goldRecord( this.segUPack ) ).clone() ); pack.add( holder ); return; }		// (ours: goldRecord)
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
				// a thin strip of light under its front (its foot's brass frame: about 0.12 up), a glow on the floor
				{

					const dd = size( name )[ 2 ], z = dd / 2 - 0.05, y = 0.125, half = w / 2 - 0.12;
					const g = new THREE.Mesh( new THREE.BoxGeometry( 2 * half, 0.006, 0.01 ).translate( 0, y, z ).applyMatrix4( F ), M.stepLed );
					g.name = 'luminara:sideboardStrip'; pack.add( g );
					const a = new THREE.Vector3( - half, y - 0.004, z ).applyMatrix4( F ), b = new THREE.Vector3( half, y - 0.004, z ).applyMatrix4( F );
					this.packSegments.push( { a, b, n: new THREE.Vector3( 0, - 0.8, 0.6 ).normalize().transformDirection( F ), clip: null, kind: 'step', col: new THREE.Color() } );

				}
				// the lamp's light
				const lamp = new THREE.Vector3( 0.74 * w / 2, h + 0.75 * size( 'table-lamp' )[ 1 ], 0.02 ).applyMatrix4( F );
				this.lampLight = new THREE.PointLight( '#ffdcb0', 0, 3.5, 2 );
				this.lampLight.position.copy( lamp );
				this.lights.add( this.lampLight );

			}

		}
		// the shelving's ornaments, each on its shelf (the other bay's mirrored)
		for ( const [ b, n ] of this.nichePoints.filter( n => n.kind === 'shelves' ).entries() ) SHELVING.forEach( ( items, k ) => {

			const [ y, cx, half ] = n.surfaces[ k ], sg = b ? - 1 : 1;		// (the other bay's mirrored)
			for ( const [ item, x, tt ] of items ) place( item, n.F.clone().multiply( new THREE.Matrix4().makeTranslation( cx + sg * x * half * 0.7, y, n.o.depth * 0.45 ) ).multiply( turn( sg * tt ) ), b === 1 );

		} );
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

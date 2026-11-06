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
import { clock } from './rendermode.js';

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
	window: { shape: 'circle', a: 1.66, yc: 1.95, depth: 0.6 },		// (as big as its old rolled frame's outer edge: from just above the skirting almost to the cornice, almost to the pilasters; deep: the wall's thickness)
	shelves: { shape: 'rect', a: 1.36, y0: 0.32, y1: 3.0, rc: 0.4, rcBottom: 0.06, depth: 0.6 },		// (built-in, as the close-ups: a cabinet below, two shelves above in two columns, the arch's space over them; its top corners round, its foot's barely)
	pipes: { shape: 'arch', a: 0.62, y0: 0.5, yS: 2.3, depth: 0.32 },		// (a row of lit pipes, as an organ's)
	clef: { shape: 'none' },		// (the clef and its staff: a light on the wall)
	curtain: { shape: 'arch', a: 1.12, y0: 0.2, yS: 2.25, depth: 0.32 },		// (a curtain of light: a pleated curtain, lit tubes of falling lengths before it)
	plain: { shape: 'none' },		// (a painting on it)
	door: { shape: 'arch', a: 0.9, y0: 0, yS: 2.3, depth: 0.18 },
};
// (the player at +z, φ 0 behind them: φ 180 across the piano; the viewer's right towards φ 90): left to right behind the
// piano, window L (252), shelving 1 (225), the clef over its sideboard (204), window M (180), the curtain (158), shelving 2
// (137), window R (108); in front, the doors (0) between pipes (74, 286) and paintings (37, 323). Three windows, 72° apart
// Each [ kind, its width (deg), its opening's own parameters over OPENINGS' ]: the curtain narrow, the
// shelving beside it wide (its room given to the shelving); from the doors' (centred on φ 0) round
const BAYS = [
	[ 'door', 37.2 ], [ 'plain', 37.2 ], [ 'pipes', 37.2 ], [ 'window', 30 ],		// (window R at 108)
	[ 'shelves', 28, { a: 1.51, cols: [ 0.5 ], heights: [ [ 0.48, 1.0 ], [ 0.54, 1.06 ] ] } ],
	[ 'curtain', 14, { a: 0.65 } ], [ 'window', 30 ], [ 'clef', 18 ],		// (window M at 180)
	[ 'shelves', 24, { a: 1.27, cols: [ 0.5 ], heights: [ [ 0.52, 1.04 ], [ 0.46, 0.98 ] ] } ],
	[ 'window', 30 ], [ 'pipes', 37.2 ], [ 'plain', 37.2 ],		// (window L at 252: the three windows 72° apart)
];
/** Each bay's centre and its edges (rad), from BAYS' widths. */
function bayLayout() {

	const out = [];
	let at = - BAYS[ 0 ][ 1 ] / 2;
	for ( const [ kind, w, over ] of BAYS ) { out.push( { kind, o: { ...OPENINGS[ kind ], ...over }, c: ( at + w / 2 ) * Math.PI / 180, e0: at * Math.PI / 180, e1: ( at + w ) * Math.PI / 180 } ); at += w; }
	return out;

}
const SCONCES_AT = [ 165, 195 ];		// φ (deg) of the pilasters with a sconce: either side of window M

// the ceiling: soffits stepping in and up to the dome; each step's edge a line of light (LED), the
// riser behind it washed from its foot: [ r of the lip, y of the soffit ]
const STEPS = [ [ 5.95, 4.15 ], [ 4.6, 4.7 ], [ 3.2, 5.25 ] ];
const DOME = { y: 5.8, rise: 1.05 };		// from the last riser's top, to its crown
const LIP = 0.06, GAP = 0.07;
const DOME_SPOTS = [ 35, - 35, 145, - 145 ];		// φ (deg) of the dome's spots: the first the keys' shadow

// the furniture: [ the pack's node, φ (deg), r (null: its back on the wall), turn (deg, about its own up), face (optional:
// [ φ, r ], the point it faces, in place of the room's middle) ]
const FURNITURE = [
	// by window L (252): the set after its product sheets (Footages.local/Luminara/e3600454-..., ce870b1c-..., d048f4be-...):
	// the curved sofa under it, the round coffee table, two swivel chairs facing it; a side table at the sofa's end
	[ 'sofa-body', 252, 5.95, 0 ], [ 'coffee-table', 252, 4.75, 0 ], [ 'chair-body', 229, 4.95, 0, [ 252, 4.75 ] ], [ 'chair-body', 274, 4.9, 0, [ 252, 4.75 ] ], [ 'side-table', 267, 6.35, 0 ],
	[ 'plant', 235, 6.3, 30 ],
	// the clef's sideboard (204); a lily planter by window M (the bench under the curtain: BENCH)
	[ 'sideboard', 204, null, 0 ], [ 'lily-planter', 167, 6.35, 0 ],
	// shelving 2 (137): a small cabinet and a small round table before it; by window R (108) a chair alone
	[ 'small-cabinet', 129, 6.2, 0 ], [ 'plant', 121, 6.35, 70 ], [ 'chair-body', 106, 5.7, 0 ],
	// the front: plants by the doors, side tables and chairs by the paintings (37, 323)
	[ 'plant', 18, 6.3, 110 ], [ 'plant', - 18, 6.3, 150 ], [ 'side-table', 41, 6.3, 0 ], [ 'side-table', - 41, 6.3, 0 ],
	[ 'tub-chair', 52, 5.7, 0 ], [ 'tub-chair', - 52, 5.7, 0 ],
];
// on the small standing cabinet (before shelving 2): [ node, x (fraction of its half width), z (m, from its middle), turn ]
const ON_SMALL_CABINET = [ [ 'gramophone', 0, - 0.02, 25 ] ];		// (the big-horned gramophone on the cabinet)
// tables built here: [ φ, r, kind ('round': a small one, a marble top on a brass stem), what stands on it ] (the sofa
// group's coffee table: the pack's, FURNITURE)
const TABLES = [ [ 142, 5.55, 'round', [ [ 'clef-statue', 0, 0, 0 ] ] ] ];
// the set's pillows, each its own mesh (TRELLIS, from a photo of one), on the pillow-free bodies: per body, its seat's top
// and its back cushion's front there ( y, z, m in its frame: tools/luminara-asset.mjs's sizes, the sofa 1.8 m, the chair
// 0.86 ), then [ node, x, z (m, from the back cushion's front), yaw, lean (deg) ]: as the sheets (the sofa's two blue and
// the cream between, the chair's lumbar)
const SEAT_PILLOWS = {
	'sofa-body': { y: 0.495, z: - 0.2, pillows: [ [ 'pillow-blue', - 0.48, 0.0, 8, 4 ], [ 'pillow-cream', 0.08, 0.05, - 4, 2 ], [ 'pillow-blue', 0.5, 0.0, - 10, 4 ] ] },
	'chair-body': { y: 0.42, z: - 0.115, pillows: [ [ 'pillow-lumbar', 0, 0.0, 0, 4 ] ] },
};
// on the sofa group's coffee table (the pack's, FURNITURE): [ node, x, z (m, from its middle), turn ] on its top (its extras' `top`)
const ON_COFFEE_TABLE = [ [ 'white-flowers', - 0.17, 0, 0 ], [ 'books-flat', 0.21, 0.05, 25 ] ];
// a bench from under the curtain to under shelving 2, between the lily planter and the small round table: as the
// sideboard (white lacquer, rounded ends, flush drawers, a slim brass plinth on short brass legs); beige fabric
// cushions on it, here and there. φ from, to (deg), its back's distance from the middle (m)
const BENCH = { from: 145.5, to: 163.5, back: 6.75, depth: 0.45, height: 0.44 };
// rugs: [ φ, r, radius ] (the piano's in the middle: radius 2.42)
const RUGS = [ [ 0, 0, 2.42 ], [ 251, 5.0, 1.5 ], [ 106, 5.6, 0.85 ] ];
// on the sideboard: [ node, x along it (fraction of its half length), turn (deg) ]
const ON_SIDEBOARD = [ [ 'table-lamp', 0.74, 0 ], [ 'ceramic-vase', - 0.66, 0 ], [ 'gold-disc', 0.2, - 12 ], [ 'candles', - 0.22, 0 ] ];		// (the lamp clear of the clef, on the left)
// in the shelving, as the close-ups: per surface (_shelving's, left to right: the cabinet's top in each column, then
// each column's shelves, bottom up): ornaments [ node, x in it (-1..1), turn ]. Every ornament model once in the room
// (here, the sideboard, the tables: _build warns of a second use and leaves it out)
const SHELVING = {
	1: [		// (shelving 1, by window L)
		[ [ 'crystal-ball', - 0.45, 0 ], [ 'hourglass', 0.45, 0 ] ],
		[ [ 'books-grey', - 0.4, 0 ], [ 'perfume', 0.3, - 15 ], [ 'crystal-gem', 0.75, 0 ] ],
		[ [ 'pothos', - 0.6, 0 ], [ 'armillary', 0.05, 0 ], [ 'figurine', 0.62, - 20 ] ],
		[ [ 'picture', - 0.5, 0 ], [ 'loop-sculpture', 0.15, 0 ], [ 'shell', 0.65, 20 ] ],
		[ [ 'carousel', - 0.32, 0 ], [ 'gold-star', 0.55, 0 ] ],		// (the carousel music box in the books' place)
		[ [ 'brass-globe', - 0.4, 0 ], [ 'jewelry-box', 0.45, 10 ] ],
	],
	2: [		// (shelving 2, by window R)
		[ [ 'radio', - 0.55, 0 ], [ 'coral-tree', 0.1, 0 ], [ 'mushroom-lamp', 0.65, 0 ] ],
		[ [ 'books-gold', - 0.45, 0 ], [ 'astronaut', 0.25, 20 ], [ 'clock', 0.72, - 10 ] ],
		[ [ 'vinyl', - 0.55, 12 ], [ 'headphones', 0.05, 15 ], [ 'diffuser', 0.65, 0 ] ],
		[ [ 'roses', - 0.55, 0 ], [ 'cloche', 0.1, 0 ], [ 'metronome', 0.65, 0 ] ],
		[ [ 'crystal-note', - 0.45, 0 ], [ 'gold-ribbon', 0.4, - 20 ] ],
		[ [ 'whale-tail', - 0.4, 20 ], [ 'olive-vase', 0.45, 0 ] ],
	],
};
// Lit as such a room would be, by its own fixtures (no stage spots but in Recital): the coves and the
// dome (emissive: their light reaches the room through the probe, `env`), four spots in the dome's rim on the piano
// (`dome`, cd; the first, from the player's right, casts the keys' shadows), a sconce on each pilaster
// (a frosted tube: `sconce`, its glow on the walls round it too), the niches' own lights, the lines
// of light in three tiers (led: the ceiling's, the main ones and the only ones blooming; ledWall: the
// walls' ornament; ledFloor), the windows' outside one of four hours (`outside`; the probe sees it).
// Neutral white (about 4000 K) by day and at the blue hour, warm (2700-3000 K) at night. Bloom faint (a bright room: more reads overexposed). ACES keeps the contrast.
// The windows lead: their sky bright, the room's own light in the bake scaled by `bakeInterior` (the day's most).
export const LUMINARA_PRESETS = {
	'Afternoon': { sun: 0, sunColor: '#ffc890', sunAz: 249, sunEl: 15.5, moon: 0, moonLight: 0, stars: 0, clouds: 0, baked: true, bakeInterior: 0.55, shelf: 1.0, outside: 'day', sky: 1.8, cove: 1.6, coveColor: '#ffe8cc', dome: 130, downColor: '#fff1e2', sconce: 5, sconceColor: '#fff0dc', niche: 1.0, nicheColor: '#ffe4c2', led: 12, ledWall: 2.8, ledFloor: 1.1, ledColor: '#ffe9cf', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.75, exposure: 0.56, tone: 'ACES', saturation: 1.0, bloom: 0.1, bloomThreshold: 8 },
	'Golden hour': { sun: 0, sunColor: '#ffc890', sunAz: 249, sunEl: 15.5, moon: 0, moonLight: 0, stars: 0, clouds: 0, baked: true, bakeInterior: 0.6, shelf: 1.1, outside: 'sunset', sky: 1.6, cove: 1.8, coveColor: '#ffdcb0', dome: 120, downColor: '#ffe2c2', sconce: 5.5, sconceColor: '#ffe4c4', niche: 1.1, nicheColor: '#ffd6a8', led: 13, ledWall: 3, ledFloor: 1.2, ledColor: '#ffdcb2', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.7, exposure: 0.58, tone: 'ACES', saturation: 1.0, bloom: 0.1, bloomThreshold: 8 },
	'Blue hour': { moon: 0, moonLight: 0, stars: 0, clouds: 0, baked: true, bakeInterior: 0.75, shelf: 1.2, outside: 'dusk', sky: 1.2, sun: 16, sunColor: '#ffc890', sunAz: 249, sunEl: 15.5, cove: 2.0, coveColor: '#ffe8cc', dome: 130, downColor: '#fff1e2', sconce: 6, sconceColor: '#fff0dc', niche: 1.2, nicheColor: '#ffe4c2', led: 14, ledWall: 3.2, ledFloor: 1.3, ledColor: '#ffe9cf', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.62, exposure: 0.6, tone: 'ACES', saturation: 1.0, bloom: 0.12, bloomThreshold: 8 },
	'Night': { sun: 0, sunColor: '#ffc890', sunAz: 249, sunEl: 15.5, baked: true, bakeInterior: 0.85, shelf: 1.3, outside: 'night', sky: 0.5, moon: 1, moonLight: 0.7, stars: 1, clouds: 0.55, cove: 2.2, coveColor: '#ffc283', dome: 140, downColor: '#ffcd95', sconce: 6.5, sconceColor: '#ffd6a4', niche: 1.3, nicheColor: '#ffc07a', led: 15, ledWall: 3.4, ledFloor: 1.4, ledColor: '#ffc283', top: 0, topColor: '#fff0dc', topAngle: 15, env: 0.55, exposure: 0.62, tone: 'ACES', saturation: 1.0, bloom: 0.12, bloomThreshold: 8 },
	// the house down, the piano under a single spot from the dome's crown
	'Recital': { sun: 0, sunColor: '#ffc890', sunAz: 249, sunEl: 15.5, baked: true, bakeInterior: 0.9, shelf: 0.45, outside: 'night', sky: 0.32, moon: 0.8, moonLight: 0.35, stars: 0.8, clouds: 0.55, cove: 0.5, coveColor: '#ffc283', dome: 0, downColor: '#ffcd95', sconce: 1.6, sconceColor: '#ffd6a4', niche: 0.4, nicheColor: '#ffc07a', led: 4, ledWall: 1.1, ledFloor: 0.5, ledColor: '#ffc283', top: 900, topColor: '#fff0dc', topAngle: 15, env: 0.3, exposure: 0.62, tone: 'ACES', saturation: 1.05, bloom: 0.12, bloomThreshold: 8 },
};
export const LUMINARA_DEFAULT = 'Afternoon';
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

// The moon: where window M (180°) shows it, from the piano's view and from 30° round (az 194°, 6° up:
// the dark sky of the photo behind it, inside the window's ring from both)
const MOON = { az: 194, el: 6.0 };
// the sky photo by direction (at infinity, as the moon and the stars: no parallax as the eye moves): the
// cylinder's own mapping as seen from SKY_EYE high on its axis
const SKY_EYE = 1.5;
/** A direction (unit) by azimuth (as φ: outward's) and elevation, in degrees. */
const dirOf = ( az, el ) => { const a = THREE.MathUtils.degToRad( az ), e = THREE.MathUtils.degToRad( el ); return new THREE.Vector3( Math.sin( a ) * Math.cos( e ), Math.sin( e ), Math.cos( a ) * Math.cos( e ) ); };

// thin clouds: periodic value noise (fbm), 256² tileable, the same on the CPU (the moon's light under
// them) and in the sky's shader (a DataTexture of it)
const CLOUD_N = 256;
const cloudNoise = ( () => {

	const N = CLOUD_N, out = new Float32Array( N * N );
	let seed = 7; const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( const [ cells, amp ] of [ [ 4, 0.5 ], [ 8, 0.26 ], [ 16, 0.14 ], [ 32, 0.07 ], [ 64, 0.03 ] ] ) {

		const g = Float32Array.from( { length: cells * cells }, rnd ), at = ( i, j ) => g[ ( ( j % cells ) * cells ) + ( i % cells ) ];
		for ( let y = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++ ) {

			const fx = x / N * cells, fy = y / N * cells, i = Math.floor( fx ), j = Math.floor( fy ), u = fx - i, v = fy - j, su = u * u * ( 3 - 2 * u ), sv = v * v * ( 3 - 2 * v );
			out[ y * N + x ] += amp * ( ( at( i, j ) * ( 1 - su ) + at( i + 1, j ) * su ) * ( 1 - sv ) + ( at( i, j + 1 ) * ( 1 - su ) + at( i + 1, j + 1 ) * su ) * sv );

		}

	}
	return out;

} )();
/** The noise at (u, v), tiled, bilinear (as the texture's sampler). */
const cloudAt = ( u, v ) => {

	const N = CLOUD_N, x = ( ( u % 1 + 1 ) % 1 ) * N - 0.5, y = ( ( v % 1 + 1 ) % 1 ) * N - 0.5, i = Math.floor( x ), j = Math.floor( y ), fx = x - i, fy = y - j;
	const at = ( a, b ) => cloudNoise[ ( ( b + N ) % N ) * N + ( ( a + N ) % N ) ];
	return ( at( i, j ) * ( 1 - fx ) + at( i + 1, j ) * fx ) * ( 1 - fy ) + ( at( i, j + 1 ) * ( 1 - fx ) + at( i + 1, j + 1 ) * fx ) * fy;

};
// the clouds' layer: u round the cylinder (CLOUD_TILES times), v by height; drifting along u; density
// from the noise (two layers, the second faster) over a threshold set by the cover
const CLOUD = { tiles: 7, vScale: 0.11, drift: [ 0.0021, 0.0034 ] };
const cloudDensity = ( phi, y, t, cover ) => {

	const u = phi / ( 2 * Math.PI ) * CLOUD.tiles, v = y * CLOUD.vScale;
	const n = 0.65 * cloudAt( u + CLOUD.drift[ 0 ] * t, v ) + 0.35 * cloudAt( 1.7 * u + CLOUD.drift[ 1 ] * t + 0.31, 1.9 * v + 0.43 );
	const th = 0.57 - 0.3 * cover, d = Math.min( 1, Math.max( 0, ( n - th ) / 0.22 ) );
	return 0.85 * d * d * ( 3 - 2 * d ) * Math.min( 1, Math.max( 0, ( y - 2.0 ) / 0.5 ) );

};

/**
 * The sky's extras on the city's photo, by the view's direction (at infinity: the floor's mirror and each
 * window see them where they should be): stars, the moon (its disc, its halo, hazier under cloud), thin
 * clouds drifting over it (lit by it), the low sun (its disc and its glow). The photo's own brightness
 * masks them (its lit city before them).
 */
function addNightSky( material, U ) {

	material.onBeforeCompile = shader => {

		Object.assign( shader.uniforms, U );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vSkyWorld;' )
			.replace( '#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSkyWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		if ( ! shader.vertexShader.includes( 'vSkyWorld = ' ) ) shader.vertexShader = shader.vertexShader.replace( '#include <project_vertex>', '#include <project_vertex>\nvSkyWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>
			varying vec3 vSkyWorld;
			uniform sampler2D uCloud;
			uniform vec3 uMoonDir, uSunDir, uSunColor;
			uniform float uMoon, uStars, uClouds, uSun, uTime, uCloudTiles, uCloudV;
			uniform vec2 uDrift;
			uniform float uSkyEye, uSkyR, uSkyY0, uSkyH;
			#ifdef USE_MAP
				uniform mat3 mapTransform;
			#endif
			float skyHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
			float cloudDens( float phi, float y ) {
				float u = phi / 6.28318 * uCloudTiles, v = y * uCloudV;
				float n = 0.65 * texture2D( uCloud, vec2( u + uDrift.x * uTime, v ) ).r + 0.35 * texture2D( uCloud, vec2( 1.7 * u + uDrift.y * uTime + 0.31, 1.9 * v + 0.43 ) ).r;
				return 0.85 * smoothstep( 0.57 - 0.3 * uClouds, 0.79 - 0.3 * uClouds, n ) * clamp( ( y - 2.0 ) / 0.5, 0.0, 1.0 );
			}` )
			// the photo by direction: its azimuth, and the height on the cylinder seen from the eye on its axis
			// (its wrap at 0°: the doors, no window)
			.replace( '#include <map_fragment>', `
				vec3 skyD = normalize( vSkyWorld - cameraPosition );
				float skyPhi = atan( skyD.x, skyD.z );
				if ( skyPhi < 0.0 ) skyPhi += 6.28318;
				float skyY = uSkyEye + uSkyR * skyD.y / max( length( skyD.xz ), 1e-3 );
				#ifdef USE_MAP
					diffuseColor *= texture2D( map, ( mapTransform * vec3( skyPhi / 6.28318, ( skyY - uSkyY0 ) / uSkyH, 1.0 ) ).xy );
				#endif` )
			.replace( '#include <opaque_fragment>', `{
				vec3 d = skyD;
				float phi = skyPhi;
				vec3 p = vec3( 0.0, skyY, 0.0 );
				float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
				float open = 1.0 - smoothstep( 0.03, 0.09, lum );		// (the dark sky; not the lit city)
				// clouds (only where it is night: uClouds 0 else)
				float cd = uClouds > 0.0 ? cloudDens( phi, p.y ) * open : 0.0;
				float toMoon = max( dot( d, uMoonDir ), 0.0 );
				vec3 cloudCol = vec3( 0.020, 0.024, 0.034 ) + vec3( 0.55, 0.6, 0.7 ) * uMoon * ( 0.008 + 0.35 * pow( toMoon, 3000.0 ) + 0.05 * pow( toMoon, 300.0 ) );		// (lit by the moon close round it only: its silver edge)
				outgoingLight = mix( outgoingLight, cloudCol, 0.8 * cd );
				// stars: a grid by direction, one in some cells, most faint
				if ( uStars > 0.0 && d.y > 0.07 ) {
					vec2 sp = vec2( atan( - d.x, - d.z ), asin( d.y ) ) * 95.0;		// (its azimuth's wrap at the doors' (0°), not the windows')
					vec2 cell = floor( sp ), f = fract( sp );
					float h = skyHash( cell ), h2 = skyHash( cell + 17.1 ), h3 = skyHash( cell + 3.7 );
					vec2 c = vec2( 0.2 + 0.6 * h2, 0.2 + 0.6 * h3 );
					float px = length( fwidth( sp ) ) + 1e-4;
					float r = length( f - c ) / px;		// (in pixels)
					float mag = h < 0.12 ? pow( skyHash( cell + 9.2 ), 5.0 ) : 0.0;
					float tw = 0.75 + 0.25 * sin( uTime * ( 1.5 + 3.0 * h2 ) + 40.0 * h3 );
					vec3 sc = mix( vec3( 0.75, 0.85, 1.0 ), vec3( 1.0, 0.92, 0.8 ), h3 );
					outgoingLight += step( h, 0.12 ) * sc * uStars * ( 0.2 + 9.0 * mag ) * tw * exp( - r * r * 1.2 ) * open * ( 1.0 - cd ) * smoothstep( 0.07, 0.2, d.y );
				}
				// the moon: its disc (mottled, its limb darker), a halo, hazier and wider under cloud
				if ( uMoon > 0.0 ) {
					float ang = length( cross( d, uMoonDir ) ), R = 0.011;
					float aa = fwidth( ang ) + 1e-5;
					float disc = ( 1.0 - smoothstep( R - aa, R + aa, ang ) ) * step( 0.0, dot( d, uMoonDir ) );
					vec3 t1 = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) ), t2 = cross( t1, uMoonDir );
					vec2 q = vec2( dot( d, t1 ), dot( d, t2 ) ) / R;
					float maria = texture2D( uCloud, q * 0.22 + 0.5 ).r;
					float limb = sqrt( max( 0.0, 1.0 - dot( q, q ) ) );
					vec3 moonCol = vec3( 1.0, 0.97, 0.9 ) * ( 0.72 + 0.28 * limb ) * ( 1.18 - 0.55 * smoothstep( 0.45, 0.75, maria ) );
					float halo = 0.06 * exp( - ang / 0.018 ) + 0.015 * exp( - ang / 0.08 );
					float haze = cd * ( 0.35 * exp( - ang / 0.03 ) + 0.06 * exp( - ang / 0.1 ) );		// (thin cloud before it: the light spread out)
					outgoingLight += uMoon * open * ( moonCol * 4.0 * disc * ( 1.0 - 0.92 * cd ) + vec3( 0.75, 0.8, 0.9 ) * ( halo * ( 1.0 - 0.5 * cd ) + haze ) );
				}
				// the low sun: its disc and its glow
				if ( uSun > 0.0 ) {
					float ang = length( cross( d, uSunDir ) ) * step( 0.0, dot( d, uSunDir ) ) + ( 1.0 - step( 0.0, dot( d, uSunDir ) ) ) * 2.0;
					float aa = fwidth( ang ) + 1e-5;
					float disc = 1.0 - smoothstep( 0.0085 - aa, 0.0085 + aa, ang );
					outgoingLight += uSun * uSunColor * ( 60.0 * disc + 1.6 * exp( - ang / 0.03 ) + 0.35 * exp( - ang / 0.16 ) );
				}
			}
			#include <opaque_fragment>` );

	};

}
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
function leather( material, { scale = 260, amount = 0.05, coat = 0.035 } = {} ) {

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
				vec3 gp = vGrainPos * ${ scale.toFixed( 1 ) }, gv = ( viewMatrix * vec4( gGrad( gp ) + 0.5 * gGrad( gp * 2.3 ), 0.0 ) ).xyz;
				normal = normalize( normal - ${ amount.toFixed( 3 ) } * ( gv - dot( gv, normal ) * normal ) );
				#ifdef USE_CLEARCOAT
					clearcoatNormal = normalize( clearcoatNormal - ${ coat.toFixed( 3 ) } * ( gv - dot( gv, clearcoatNormal ) * clearcoatNormal ) );
				#endif
			}` );

	}, `leatherGrain${ scale }-${ amount }-${ coat }` );
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
function goldRecord( segU, dark = false ) {		// (dark: a black vinyl one, its label gold)

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
	const gold = dark ? new THREE.MeshPhysicalMaterial( { color: '#0a0a0b', metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12, anisotropy: 1, anisotropyRotation: 0, anisotropyMap: am, side: THREE.DoubleSide } )
		: new THREE.MeshPhysicalMaterial( { color: '#e3b864', metalness: 1, roughness: 0.22, anisotropy: 1, anisotropyRotation: 0, anisotropyMap: am, side: THREE.DoubleSide } );
	const label = new THREE.MeshPhysicalMaterial( dark ? { color: '#d6a95c', metalness: 1, roughness: 0.35 } : { color: '#c9a25a', metalness: 0.85, roughness: 0.55 } );
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

/**
 * A framed picture: a painting (`tex`: the pack's, whole) in a thin brass frame with a white mat, `w` × `h` m;
 * on a wall (lean 0) or leaning back on a shelf (`lean` rad, its foot on y 0). Its face +z.
 */
function framedPicture( tex, w, h, lean = 0 ) {

	const t = tex.clone();
	t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set( 1, - 1 ); t.offset.set( 0, 1 ); t.needsUpdate = true;		// (glTF images not flipped)
	const g = new THREE.Group(), mat = 0.06 * Math.min( w, h ), fr = 0.018 * Math.max( 1, w );
	const brass = new THREE.MeshPhysicalMaterial( { color: '#d6a95c', metalness: 1, roughness: 0.3 } );
	const pic = new THREE.Mesh( new THREE.PlaneGeometry( w - 2 * mat, h - 2 * mat ).translate( 0, 0, 0.012 ), new THREE.MeshPhysicalMaterial( { map: t, roughness: 0.6 } ) );
	const card = new THREE.Mesh( new THREE.BoxGeometry( w, h, 0.01 ).translate( 0, 0, 0.006 ), new THREE.MeshPhysicalMaterial( { color: '#f2ece2', roughness: 0.9 } ) );
	g.add( pic, card );
	for ( const [ x, y, sw, sh ] of [ [ 0, h / 2, w + 2 * fr, fr ], [ 0, - h / 2, w + 2 * fr, fr ], [ w / 2, 0, fr, h ], [ - w / 2, 0, fr, h ] ] ) g.add( new THREE.Mesh( new THREE.BoxGeometry( sw, sh, 0.025 ).translate( x, y, 0.0125 ), brass ) );
	g.traverse( o => { if ( o.isMesh ) o.castShadow = o.receiveShadow = true; } );
	if ( lean ) { g.position.y = h / 2 + fr; g.position.z = - 0.04; g.rotation.x = - lean; const out = new THREE.Group(); out.add( g ); return out; }
	return g;

}

/**
 * The carousel music box (the sheets Footages.local/Luminara/5d2295d4-..., e50eec08-...), about 0.33 m high, its
 * parts each their own material: a still base (an ivory lacquered drum, fluted, gilt rings and ribs, six gilt ball
 * feet) and on it the carousel, turning (`root.userData.turn( t )`, t in s): its platform, a fluted ivory centre
 * column, four twisted gilt poles, the horses (`horse`: the pack's TRELLIS horse, white porcelain, pale blue saddle,
 * gilt; four round the platform, rising and falling out of phase), the canopy (a pale blue enamel band with gilt
 * notes and a scalloped hem, warm bulbs under it, an ivory bell roof, gilt ribs, a finial with a tilted ring).
 */
function carouselBox( horse ) {

	const ivory = phys( { color: '#f4efe6', roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.08 } );		// (lacquered porcelain)
	const gilt = phys( { color: '#e2bf7a', metalness: 1, roughness: 0.16, clearcoat: 0.25, clearcoatRoughness: 0.08 } );
	const bulb = phys( { color: '#fff3dc', roughness: 0.4, emissive: new THREE.Color( '#ffc982' ), emissiveIntensity: 3.2 } );
	const root = new THREE.Group(), turning = new THREE.Group();
	root.name = 'carousel'; turning.name = 'carousel:turning';
	const mesh = ( g, m, parent = root, shadow = true ) => { const o = new THREE.Mesh( g, m ); o.castShadow = shadow; o.receiveShadow = true; parent.add( o ); return o; };
	const lathe = ( pts, seg = 96 ) => new THREE.LatheGeometry( pts.map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), seg );
	const ring = ( r, tube, y, m, parent, seg = 96 ) => mesh( new THREE.TorusGeometry( r, tube, 10, seg ).rotateX( Math.PI / 2 ).translate( 0, y, 0 ), m, parent );
	const fluted = ( g, n, depth, phase = 0 ) => {		// (the radius of a lathe's surface modulated round it: shallow flutes, or a roof's gores)
		const p = g.attributes.position;
		for ( let i = 0; i < p.count; ++ i ) { const x = p.getX( i ), z = p.getZ( i ), a = Math.atan2( z, x ), k = 1 - depth * ( 0.5 + 0.5 * Math.cos( n * a + phase ) ) ** 2; p.setX( i, x * k ); p.setZ( i, z * k ); }
		g.computeVertexNormals();
		return g;
	};
	const star = ( r, points = 5, depth = 0.002, inner = 0.45 ) => {		// (a gilt star, flat, its face on +z)
		const sh = new THREE.Shape();
		for ( let i = 0; i < 2 * points; ++ i ) { const a = Math.PI / 2 + i * Math.PI / points, q = i % 2 ? r * inner : r; i ? sh.lineTo( q * Math.cos( a ), q * Math.sin( a ) ) : sh.moveTo( q * Math.cos( a ), q * Math.sin( a ) ); }
		return new THREE.ExtrudeGeometry( sh, { depth, bevelEnabled: true, bevelThickness: depth / 3, bevelSize: depth / 4, bevelSegments: 1 } );
	};

	// the base: a smooth drum, a little swelled, between gilt bands, a gilt star at its front; ball feet
	mesh( lathe( [ [ 0, 0.008 ], [ 0.112, 0.008 ], [ 0.118, 0.012 ], [ 0.118, 0.018 ] ] ), gilt );
	mesh( lathe( [ [ 0.112, 0.018 ], [ 0.116, 0.034 ], [ 0.117, 0.05 ], [ 0.115, 0.064 ], [ 0.111, 0.07 ] ], 160 ), ivory );
	mesh( star( 0.014, 8, 0.0015, 0.38 ).translate( 0, 0, 0 ).translate( 0, 0.045, 0.1172 ), gilt );		// (a compass star at its front, as the sheets')
	mesh( lathe( [ [ 0.111, 0.07 ], [ 0.12, 0.072 ], [ 0.121, 0.078 ], [ 0.114, 0.082 ], [ 0.098, 0.084 ], [ 0, 0.084 ] ] ), ivory );
	ring( 0.119, 0.0032, 0.019, gilt, root ); ring( 0.113, 0.0028, 0.069, gilt, root ); ring( 0.12, 0.0026, 0.079, gilt, root );
	for ( let i = 0; i < 6; ++ i ) { const a = i / 6 * 2 * Math.PI + Math.PI / 6; mesh( new THREE.SphereGeometry( 0.011, 16, 12 ).translate( 0.098 * Math.cos( a ), 0.008, 0.098 * Math.sin( a ) ), gilt ); }

	// the carousel, turning: its platform, the centre column, the poles, the horses, the canopy
	root.add( turning );
	mesh( lathe( [ [ 0, 0.086 ], [ 0.104, 0.086 ], [ 0.108, 0.089 ], [ 0.108, 0.095 ], [ 0.102, 0.097 ], [ 0, 0.097 ] ] ), ivory, turning );
	ring( 0.107, 0.0026, 0.096, gilt, turning );
	// the centre column: a lantern, warm and lit from within (the sheets'), fluted, gilt rings at its foot and head
	const glow = phys( { color: '#fff4e2', roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.1, emissive: new THREE.Color( '#ffcf8f' ), emissiveIntensity: 1.1 } );
	mesh( lathe( [ [ 0.036, 0.097 ], [ 0.036, 0.112 ], [ 0.03, 0.116 ], [ 0, 0.116 ] ] ), ivory, turning );
	mesh( fluted( lathe( [ [ 0.03, 0.116 ], [ 0.028, 0.13 ], [ 0.028, 0.214 ], [ 0.03, 0.226 ] ], 96 ), 10, 0.1 ), glow, turning, false );
	mesh( lathe( [ [ 0, 0.226 ], [ 0.034, 0.226 ], [ 0.036, 0.232 ] ] ), ivory, turning );
	ring( 0.031, 0.0028, 0.117, gilt, turning ); ring( 0.031, 0.0028, 0.225, gilt, turning ); ring( 0.036, 0.0022, 0.104, gilt, turning );
	const R = 0.074, N = 4, top = 0.244;
	for ( let i = 0; i < N; ++ i ) {

		const a = i / N * 2 * Math.PI + Math.PI / 4, x = R * Math.cos( a ), z = R * Math.sin( a );
		mesh( new THREE.CylinderGeometry( 0.0024, 0.0024, top - 0.097, 10 ).translate( x, ( top + 0.097 ) / 2, z ), gilt, turning, false );
		for ( const ph of [ 0, Math.PI ] ) {		// (two strands twisted round it)

			const pts = [];
			for ( let k = 0; k <= 48; ++ k ) { const t = k / 48, y = 0.097 + t * ( top - 0.097 ), w = ph + t * 7 * Math.PI; pts.push( new THREE.Vector3( x + 0.0032 * Math.cos( w ), y, z + 0.0032 * Math.sin( w ) ) ); }
			mesh( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), 96, 0.0012, 6 ), gilt, turning, false );

		}

	}
	// the horses: the pack's one, sized and turned to face along its path (the carousel turns anticlockwise from
	// above), on each pole, rising and falling
	const holders = [];
	if ( horse ) {

		const h0 = horse.clone();
		h0.updateMatrixWorld( true );
		const box = new THREE.Box3().setFromObject( h0 ), sz = box.getSize( new THREE.Vector3() );
		const k = 0.078 / sz.y;		// (0.078 m high, mane to hooves)
		// its head: the end of its longer horizontal axis that is higher (a raised head and front legs)
		const along = sz.x >= sz.z ? 'x' : 'z', mid = ( box.min[ along ] + box.max[ along ] ) / 2;
		let hiPos = - Infinity, hiNeg = - Infinity;
		h0.traverse( o => { if ( ! o.isMesh ) return; const p = o.geometry.attributes.position, v = new THREE.Vector3(); for ( let j = 0; j < p.count; j += 7 ) { v.fromBufferAttribute( p, j ).applyMatrix4( o.matrixWorld ); if ( v[ along ] > mid ) hiPos = Math.max( hiPos, v.y ); else hiNeg = Math.max( hiNeg, v.y ); } } );
		const facing = ( along === 'x' ? 0 : Math.PI / 2 ) + ( hiPos >= hiNeg ? 0 : Math.PI );		// (the turn round y that puts its head on +x: +z to +x is +90°)
		const centre = box.getCenter( new THREE.Vector3() );
		for ( let i = 0; i < N; ++ i ) {

			const a = i / N * 2 * Math.PI + Math.PI / 4, holder = new THREE.Group();
			const h = h0.clone();
			h.position.set( - centre.x, - box.min.y, - centre.z );		// (its feet's middle on the pole, its hooves at 0)
			const turnH = new THREE.Group(); turnH.rotation.y = facing; turnH.add( h );
			const sized = new THREE.Group(); sized.scale.setScalar( k ); sized.add( turnH );
			holder.add( sized );
			// on the pole at angle a, its head (on +x) along its motion there: the turning group's rotation.y goes negative
			// (anticlockwise from above), the horse at ( cos a, 0, sin a ) moves along ( -sin a, 0, cos a ); +x turned by
			// a y-rotation θ is ( cos θ, 0, -sin θ ): θ = -π/2 - a (measured: head·motion +1 for all four)
			holder.position.set( R * Math.cos( a ), 0.128, R * Math.sin( a ) );
			holder.rotation.y = - Math.PI / 2 - a;
			holder.userData.phase = i * Math.PI / 2;
			h.traverse( o => { if ( o.isMesh ) { o.castShadow = false; o.receiveShadow = true; } } );		// (turning: a shadow map drawn once would freeze them)
			turning.add( holder ); holders.push( holder );

		}

	}
	// the canopy: under it a ceiling, an ivory band with a gilt staff, medallions and notes and a scalloped hem (a
	// canvas: colour and alpha, a second its metalness and roughness), bulbs under the band, an ivory tent roof (gores
	// between gilt ribs, gilt stars), a finial with a tilted ring and a star
	const bandR = 0.118, bandY0 = 0.232, bandY1 = 0.266;
	mesh( new THREE.CircleGeometry( bandR - 0.002, 64 ).rotateX( Math.PI / 2 ).translate( 0, bandY1 - 0.002, 0 ), phys( { color: '#f4efe6', roughness: 0.4, side: THREE.DoubleSide } ), turning );
	{

		const W = 1024, H = 128, cv = document.createElement( 'canvas' ), mr = document.createElement( 'canvas' );
		cv.width = mr.width = W; cv.height = mr.height = H;
		const g = cv.getContext( '2d' ), q = mr.getContext( '2d' );
		const gold = '#e2bf7a', scal = 16, hem = 0.24 * H;		// (16 scallops round; the hem's depth)
		g.fillStyle = '#f2ebde'; g.fillRect( 0, 0, W, H );		// (ivory, as the sheets'; their pale blue is the saddles')
		q.fillStyle = 'rgb(0,150,0)'; q.fillRect( 0, 0, W, H );		// (g: roughness, b: metalness, as three reads it)
		const both = fn => { for ( const [ c, col ] of [ [ g, gold ], [ q, 'rgb(0,40,255)' ] ] ) { c.fillStyle = c.strokeStyle = col; fn( c ); } };
		both( c => { c.fillRect( 0, 0, W, 0.09 * H ); c.fillRect( 0, H - hem - 0.07 * H, W, 0.05 * H ); } );		// (a gilt top edge, a line above the hem)
		// a gilt staff round the band (five lines), four medallions on it (a ring, a star), notes between
		both( c => { c.lineWidth = 1.5; for ( let l = 0; l < 5; ++ l ) { const y = ( 0.2 + 0.075 * l ) * H; c.beginPath(); c.moveTo( 0, y ); c.lineTo( W, y ); c.stroke(); } } );
		for ( let i = 0; i < 4; ++ i ) {

			const x = ( i + 0.5 ) / 4 * W, y = 0.35 * H, r = 0.2 * H;
			g.fillStyle = '#f2ebde'; g.beginPath(); g.arc( x, y, r, 0, 2 * Math.PI ); g.fill();		// (the staff behind it hidden)
			q.fillStyle = 'rgb(0,150,0)'; q.beginPath(); q.arc( x, y, r, 0, 2 * Math.PI ); q.fill();
			both( c => {
				c.lineWidth = 3; c.beginPath(); c.arc( x, y, r, 0, 2 * Math.PI ); c.stroke();
				c.beginPath(); for ( let k = 0; k < 16; ++ k ) { const a = - Math.PI / 2 + k * Math.PI / 8, rr = k % 2 ? 0.28 * r : 0.78 * r; k ? c.lineTo( x + rr * Math.cos( a ), y + rr * Math.sin( a ) ) : c.moveTo( x + rr * Math.cos( a ), y + rr * Math.sin( a ) ); } c.closePath(); c.fill();
			} );

		}
		for ( let i = 0; i < 12; ++ i ) {

			if ( i % 3 === 1 ) continue;		// (the medallions' places)
			const x = ( i + 0.5 ) / 12 * W, y = ( i % 3 === 0 ? 0.42 : 0.35 ) * H, r = 0.04 * H;
			both( c => {
				c.save(); c.translate( x, y ); c.rotate( - 0.35 ); c.beginPath(); c.ellipse( 0, 0, 1.35 * r, r, 0, 0, 2 * Math.PI ); c.fill(); c.restore();
				c.lineWidth = 2.5; c.beginPath(); c.moveTo( x + 1.2 * r, y - 0.2 * r ); c.lineTo( x + 1.2 * r, y - 0.26 * H ); c.stroke();
				if ( i % 2 === 0 ) { c.beginPath(); c.moveTo( x + 1.2 * r, y - 0.26 * H ); c.quadraticCurveTo( x + 3.2 * r, y - 0.16 * H, x + 2.4 * r, y - 0.06 * H ); c.stroke(); }
			} );

		}
		// the scallops: the hem's lower edge cut in arcs (alpha), each arc's edge gilt, a gilt bead at each point
		g.globalCompositeOperation = 'destination-out';
		for ( let i = 0; i <= scal; ++ i ) { const cx = i / scal * W; g.beginPath(); g.ellipse( cx, H, W / scal / 2, hem * 0.62, 0, 0, 2 * Math.PI ); g.fill(); }
		g.globalCompositeOperation = 'source-over';
		both( c => { c.lineWidth = 3; for ( let i = 0; i <= scal; ++ i ) { const cx = i / scal * W; c.beginPath(); c.ellipse( cx, H, W / scal / 2, hem * 0.62, 0, Math.PI, 2 * Math.PI ); c.stroke(); } } );
		const t = new THREE.CanvasTexture( cv ), m2 = new THREE.CanvasTexture( mr );
		t.colorSpace = THREE.SRGBColorSpace; m2.colorSpace = THREE.NoColorSpace;
		for ( const x of [ t, m2 ] ) { x.wrapS = THREE.RepeatWrapping; x.anisotropy = 8; }
		const band = phys( { color: '#ffffff', map: t, metalnessMap: m2, roughnessMap: m2, metalness: 1, roughness: 1, alphaTest: 0.5, side: THREE.DoubleSide, clearcoat: 0.4, clearcoatRoughness: 0.12 } );
		mesh( new THREE.CylinderGeometry( bandR, bandR, bandY1 - bandY0, 128, 1, true ).translate( 0, ( bandY0 + bandY1 ) / 2, 0 ), band, turning );
		ring( bandR + 0.0005, 0.0024, bandY1, gilt, turning );
		for ( let i = 0; i < scal; ++ i ) { const a = ( i + 0.5 ) / scal * 2 * Math.PI; mesh( new THREE.SphereGeometry( 0.0034, 10, 8 ).translate( bandR * Math.cos( a ), bandY0 + 0.001, bandR * Math.sin( a ) ), gilt, turning ); }
		// warm bulbs under the band's inside
		for ( let i = 0; i < 12; ++ i ) { const a = i / 12 * 2 * Math.PI; mesh( new THREE.SphereGeometry( 0.0042, 12, 8 ).translate( ( bandR - 0.012 ) * Math.cos( a ), bandY1 - 0.008, ( bandR - 0.012 ) * Math.sin( a ) ), bulb, turning, false ); }

	}
	// the roof: a tent (concave, rising from a flared eave wider than the band to a peak), its cloth sagging in gores
	// between eight gilt ribs, a gilt star on each gore, a finial: a ball, a tilted ring round it, a star on top
	const eave = 0.132, roofH = 0.072, roof = [ [ eave - 0.004, bandY1 - 0.004 ], [ eave, bandY1 ] ];
	for ( let k = 1; k <= 24; ++ k ) { const t = k / 24; roof.push( [ Math.max( 0.008, eave * ( 1 - t ) ** 1.9 ), bandY1 + roofH * t ** 0.9 ] ); }
	const roofMat = phys( { color: '#efe6d6', roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.25, side: THREE.DoubleSide } );		// (satin: a glossier one took the lit wall behind and read as glass)
	mesh( fluted( lathe( roof, 128 ), 8, 0.035, Math.PI ), roofMat, turning );		// (phase π: the ribs at the gores' high lines)
	for ( let i = 0; i < 8; ++ i ) {

		const a = i / 8 * 2 * Math.PI, pts = roof.slice( 1 ).filter( ( _, k ) => k % 2 === 0 ).map( ( [ r, y ] ) => new THREE.Vector3( ( r + 0.0015 ) * Math.cos( a ), y + 0.0008, ( r + 0.0015 ) * Math.sin( a ) ) );
		mesh( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), 48, 0.002, 6 ), gilt, turning );
		mesh( new THREE.SphereGeometry( 0.0045, 12, 8 ).translate( ( eave + 0.002 ) * Math.cos( a ), bandY1 + 0.001, ( eave + 0.002 ) * Math.sin( a ) ), gilt, turning );
		// a star on the gore after this rib, about halfway up, facing out along the roof's slope
		const b = a + Math.PI / 8, t = 0.42, rr = eave * ( 1 - t ) ** 1.9 * ( 1 - 0.035 * 0.0 ) + 0.0008, yy = bandY1 + roofH * t ** 0.9;
		const o = new THREE.Object3D(); o.position.set( rr * Math.cos( b ), yy, rr * Math.sin( b ) ); o.lookAt( 2 * rr * Math.cos( b ), yy + 0.6 * rr, 2 * rr * Math.sin( b ) ); o.updateMatrix();
		mesh( star( 0.006, 5, 0.0012 ).applyMatrix4( o.matrix ), gilt, turning );

	}
	const fy = bandY1 + roofH;
	mesh( lathe( [ [ 0.012, fy - 0.004 ], [ 0.006, fy + 0.004 ], [ 0.0045, fy + 0.012 ], [ 0.0001, fy + 0.014 ] ], 48 ), gilt, turning );
	mesh( new THREE.SphereGeometry( 0.0105, 24, 16 ).translate( 0, fy + 0.023, 0 ), gilt, turning );
	mesh( new THREE.TorusGeometry( 0.024, 0.0016, 8, 72 ).rotateX( Math.PI / 2 - 0.45 ).rotateZ( 0.25 ).translate( 0, fy + 0.023, 0 ), gilt, turning );
	mesh( star( 0.0075, 5, 0.0018 ).translate( 0, fy + 0.042, - 0.0009 ), gilt, turning );		// (on top, upright)

	// turning: one turn in 24 s (a music box's slow pace), anticlockwise from above; the horses up and down twice a turn
	root.userData.turn = t => {

		const a = 2 * Math.PI * ( t / 24 );
		turning.rotation.y = - a;		// (three's +y rotation is clockwise from above)
		for ( const h of holders ) h.position.y = 0.128 + 0.009 * Math.sin( 2 * a + h.userData.phase );

	};
	root.userData.turn( 0 );
	return root;

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
		this.preset = LUMINARA_DEFAULT;
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
			brightMetal: phys( { color: '#e6c483', metalness: 1, roughness: 0.07, clearcoat: 0.5, clearcoatRoughness: 0.04, side: THREE.DoubleSide } ),		// (the windows' rings: a bright polished edge)
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
		{

			const tex = new THREE.DataTexture( Uint8Array.from( cloudNoise, v => Math.round( 255 * Math.min( 1, Math.max( 0, v ) ) ) ), CLOUD_N, CLOUD_N, THREE.RedFormat );
			tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
			this.skyU = { uCloud: { value: tex }, uMoonDir: { value: dirOf( MOON.az, MOON.el ) }, uSunDir: { value: new THREE.Vector3( 0, 1, 0 ) }, uSunColor: { value: new THREE.Color() },
				uMoon: { value: 0 }, uStars: { value: 0 }, uClouds: { value: 0 }, uSun: { value: 0 }, uTime: { value: 0 },
				uSkyEye: { value: SKY_EYE }, uSkyR: { value: 11 }, uSkyY0: { value: - 4 }, uSkyH: { value: 14 },
				uCloudTiles: { value: CLOUD.tiles }, uCloudV: { value: CLOUD.vScale }, uDrift: { value: new THREE.Vector2( ...CLOUD.drift ) } };
			addNightSky( this.materials.sky, this.skyU );

		}

		this.materials.ledWall = this.materials.led.clone();
		this.materials.ledFloor = this.materials.led.clone();
		this.materials.shelfLed = this.materials.led.clone();		// (the shelves' strips: seen dim; their light: the segments')
		this.materials.stepLed = this.materials.led.clone();		// (the sideboard's strip)
		this.materials.curtainLed = this.materials.led.clone();		// (the curtain's tubes)
		for ( const m of [ this.materials.wall, this.materials.lacquer ] ) addSegmentGlow( m, this.segU );
		this.mirror = new PlaneMirror( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ) );		// (the floor's: src/mirror.js)
		for ( const m of [ this.materials.floor, this.materials.border ] ) this.mirror.addTo( m );
		for ( const m of [ this.materials.wall, this.materials.ceiling, this.materials.lacquer, this.materials.floor, this.materials.border, this.materials.rug ] ) addBake( m, this.bakeU );
		this._buildLights();
		this._built = false;		// (the shell: built when Luminara first shows, _buildShell; not at the page's start)
		this.precompile = null;		// async ( object ): compile its shaders as the frame will draw it (main.js)

	}

	activate() {

		this.active = true;
		this.scene.add( this.lights );
		if ( this._built ) this.scene.add( this.group );
		else this.building ??= this._buildShell();
		if ( ! this._loadTried ) this.load();
		this.updateLights();

	}

	/** The room's shell, a frame after it was asked for (the bar drawn first), then its shaders compiled before it shows. */
	async _buildShell() {

		const S = luminaraStatus;
		S.shell = 'build';
		await nextFrame();
		// the clef's glyph maps first, one a frame (each a few hundred ms of canvas work), then the shell
		this._glyphMaps = {};
		for ( const name of Object.keys( GLYPHS ) ) { this._glyphMaps[ name ] = glyphMaps( GLYPHS[ name ] ); await nextFrame(); }
		this.rebuild();
		this._built = true;
		this.updateLights();
		S.shell = 'compile';
		await nextFrame();
		// (its own shaders, and the scene's again: its lights now in it change every lit material's program)
		await this.precompile?.( this.group );
		await this.precompile?.( this.scene );
		S.shell = 'ready';
		if ( this.active ) this.scene.add( this.group );
		this.onBake?.();		// (the probe again: the room in it)

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
			'From the sofa': { position: at( 252, 5.2, 1.15 ), target: new THREE.Vector3( 0, 1.0, 0 ) },
			'The doors': { position: at( 0, 5.6, 1.65 ), target: new THREE.Vector3( 0, 1.4, 0 ) },
			'The clef': { position: at( 24, 2.6, 1.6 ), target: at( 204, R, 1.9 ) },
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
			[ 'sun', 0, 30, 0.1, 'Sun (through a window)' ], [ 'sunColor', 'color', 'Sun color' ], [ 'sunAz', 0, 360, 0.5, 'Sun azimuth (°)' ], [ 'sunEl', 2, 60, 0.1, 'Sun elevation (°)' ],
			[ 'moon', 0, 2, 0.01, 'Moon' ], [ 'moonLight', 0, 4, 0.01, 'Moonlight' ], [ 'stars', 0, 3, 0.01, 'Stars' ], [ 'clouds', 0, 1, 0.01, 'Clouds' ],
		];

	}

	// ---------------------------------------------------------------------
	rebuild() {

		for ( const c of [ ...this.group.children ] ) if ( c !== this.pack ) { this.group.remove( c ); c.traverse( o => o.geometry?.dispose() ); }
		const M = this.materials, parts = new Map();		// material -> geometries (merged at the end)
		const add = ( geo, mat ) => { if ( ! parts.has( mat ) ) parts.set( mat, [] ); parts.get( mat ).push( geo.index ? geo.toNonIndexed() : geo ); };
		this.nichePoints = [];
		this._shelvingCount = 0;
		this.paintings = [];
		this.segments = [];		// { a, b, n (the strip's facing; null: a tube), clip (a plane, Vector4; null), kind }

		// the bays: a panel of wall round each opening, the opening's reveal and back
		const layout = bayLayout();
		for ( const b of layout ) this._bay( add, b.c, b.o, b.kind, R * ( b.e1 - b.e0 ) / 2 );

		// the pilasters between the bays: fluted white lacquer, a base and a brass-banded capital
		const pil = this._pilaster();
		for ( const b of layout ) {		// (one at each bay's far edge)

			const F = frameAt( b.e1, R );
			add( pil.shaft.clone().applyMatrix4( F ), M.lacquer );
			if ( ! SCONCES_AT.some( d => Math.abs( d - b.e1 * 180 / Math.PI ) < 1 ) ) continue;		// (a sconce either side of window M only)
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

			// the rugs: each its pattern's square on its disc (u, v 0..1 across it), its edge a short band
			for ( const [ deg, rr, RR ] of RUGS ) {

				const c = outward( deg * Math.PI / 180 ).multiplyScalar( rr ), top = 0.012;
				const g = new THREE.CircleGeometry( RR, 192 ).rotateX( - Math.PI / 2 ), p = g.attributes.position, uv = g.attributes.uv;
				for ( let i = 0; i < p.count; ++ i ) uv.setXY( i, 0.5 + 0.485 * p.getX( i ) / RR, 0.5 - 0.485 * p.getZ( i ) / RR );
				g.translate( c.x, top, c.z );
				const rug = new THREE.Mesh( g, M.rug );
				rug.receiveShadow = true; rug.name = 'luminara:rug';
				this.group.add( rug );
				add( new THREE.CylinderGeometry( RR, RR + 0.006, top, 192, 1, true ).translate( c.x, top / 2, c.z ), M.rug );

			}

		}

		// the tables: the drum coffee table (as the reference's: its marble top on a brass rim, its white
		// lacquered body narrowing in a curve to a brass foot ring), small round ones (marble on a brass stem)
		this.tableTops = [];		// [ frame, the top's y, its radius, what stands on it ] (the ornaments: _build)
		for ( const [ deg, r, kind, items ] of TABLES ) {

			const F = frameAt( deg * Math.PI / 180, r );
			if ( kind !== 'round' ) continue;
			add( new THREE.CylinderGeometry( 0.27, 0.27, 0.025, 72 ).translate( 0, 0.6375, 0 ).applyMatrix4( F ), M.floor );
			add( new THREE.CylinderGeometry( 0.275, 0.275, 0.01, 72 ).translate( 0, 0.62, 0 ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.018, 0.026, 0.6, 20 ).translate( 0, 0.31, 0 ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.17, 0.18, 0.018, 48 ).translate( 0, 0.009, 0 ).applyMatrix4( F ), M.brass );
			this.tableTops.push( [ F, 0.65, 0.27, items ] );

		}

		this._bench( add );
		for ( const [ mat, geos ] of parts ) {

			const mesh = new THREE.Mesh( mergeGeometries( geos, false ), mat );
			geos.forEach( g => g.dispose() );
			mesh.castShadow = ! [ M.cove, M.dome, M.ceiling, M.led, M.ledWall, M.ledFloor, M.shelfLed, M.stepLed, M.curtainLed, M.sconce, M.neon ].includes( mat );
			mesh.receiveShadow = true;
			mesh.name = `luminara:${ Object.keys( M ).find( k => M[ k ] === mat ) }`;
			this.group.add( mesh );
			// (the tables' marble tops share the floor's material, its mirror: hidden while it is drawn, else
			// they sample the target being drawn into, a feedback loop: GL drops the draw and warns)
			if ( mat === M.floor || mat === M.border ) this.floorMeshes.push( mesh );

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
			this.skyU.uSkyR.value = rs; this.skyU.uSkyY0.value = yb; this.skyU.uSkyH.value = ext;		// (the photo by direction: this cylinder's mapping)
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
	_bay( add, phiC, o, kind, hw = R * BAY / 2 ) {		// (`hw`: half its width on the wall)

		const M = this.materials, H = LUMINARA.wall;
		if ( o.shape === 'none' ) {		// the plain wall (the clef's: its light on it)

			const rows = [];
			for ( let j = 0; j <= 16; ++ j ) { const row = []; for ( let i = 0; i <= 48; ++ i ) { const sx = - hw + 2 * hw * i / 48, y = H * j / 16; row.push( [ onWall( phiC, sx, y ), ( phiC * R + sx ) / 2.5, y / 2.5 ] ); } rows.push( row ); }
			const P = [], UV = [], I = [];
			for ( const row of rows ) for ( const [ p, u, v ] of row ) { P.push( p.x, p.y, p.z ); UV.push( u, v ); }
			for ( let j = 0; j < 16; ++ j ) for ( let i = 0; i < 48; ++ i ) { const a = j * 49 + i; I.push( a, a + 1, a + 50, a, a + 50, a + 49 ); }
			const g = new THREE.BufferGeometry();
			g.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) ); g.setAttribute( 'uv', new THREE.Float32BufferAttribute( UV, 2 ) ); g.setIndex( I ); g.computeVertexNormals();
			add( g, M.wall );
			if ( kind === 'clef' ) this._clefLight( add, phiC, hw );
			if ( kind === 'plain' ) ( this.paintings ??= [] ).push( phiC );		// (its painting: _build, the sky's photo in it)
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
			// its rings as tubes along circles on the curved wall: no frame standing out of it, a bright
			// polished metal ring on its edge (where the wall turns into the reveal), a brass one at the reveal's far end
			const ring = rr => { const pts = []; for ( let i = 0; i < 192; ++ i ) { const t = 2 * Math.PI * i / 192; pts.push( [ rr * Math.cos( t ), o.yc + rr * Math.sin( t ) ] ); } return pts; };
			add( this._wallTube( phiC, ring( o.a + 0.002 ), 0.016, true, R - 0.004, 14 ), M.brightMetal );
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

			add( backGeo, kind === 'pipes' ? M.lacquer : kind === 'clef' || kind === 'shelves' || kind === 'curtain' ? M.wall : M.niche );		// (the clef: its pattern glows; the shelves: lit by their strips, not from behind)
			const mid = new THREE.Vector3( 0, ( o.y0 + ( o.y1 ?? o.yS ) ) / 2, 0.25 ).applyMatrix4( F );
			this.nichePoints.push( { kind, F, o, light: mid, deg: Math.round( phiC * 180 / Math.PI ) } );
			if ( kind === 'shelves' ) this.nichePoints[ this.nichePoints.length - 1 ].surfaces = this._shelving( add, F, o );
			if ( kind === 'pipes' ) this._pipes( add, F, o );
			if ( kind === 'curtain' ) this._curtain( add, F, o );
			if ( kind !== 'shelves' ) add( new THREE.BoxGeometry( 2 * o.a - 0.04, 0.01, 0.012 ).translate( 0, o.y0 + 0.006, 0.02 ).applyMatrix4( F ), M.ledWall );		// (a strip along the back's foot)

		}
		add( this._archTrim( phiC, o, kind === 'curtain' ? 0.03 : 0.012 ), kind === 'door' ? M.brass : kind === 'curtain' ? M.lacquer : M.ledWall );		// (the curtain's: a lacquered moulding)

	}

	/** A band round an arch on the wall (its two sides and the semicircle), or round a rounded rect: brass, or a line of light. */
	_archTrim( phiC, o, tube = 0.012 ) {

		if ( o.shape === 'rect' ) {

			const g = { ...o, a: o.a + 0.03, y0: o.y0 - 0.03, y1: o.y1 + 0.03, rc: o.rc + 0.03, rcBottom: ( o.rcBottom ?? o.rc ) + 0.03 }, c = centreOf( g ), pts = [];
			for ( let i = 0; i < 160; ++ i ) { const t = 2 * Math.PI * i / 160, dx = Math.cos( t ), dy = Math.sin( t ), d = outlineT( g, c, dx, dy ); pts.push( [ c[ 0 ] + d * dx, c[ 1 ] + d * dy ] ); }
			return this._wallTube( phiC, pts, 0.01, true );

		}
		const pts = [];
		pts.push( [ o.a + 0.03, o.y0 ] );
		for ( let i = 0; i <= 48; ++ i ) { const t = Math.PI * i / 48; pts.push( [ ( o.a + 0.03 ) * Math.cos( t ), o.yS + ( o.a + 0.03 ) * Math.sin( t ) ] ); }
		pts.push( [ - o.a - 0.03, o.y0 ] );
		return this._wallTube( phiC, pts, tube, false, R - 0.006, tube > 0.02 ? 14 : 8 );

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
		const M = this.materials, t = 0.035, d = o.depth, m = this._shelvingCount = ( this._shelvingCount ?? 0 ) + 1, sx = 1;
		const cabTop = o.y0 + 0.83, top = o.y1 - 0.02;		// (the cabinet: as the close-ups', about a third of the niche)
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
		const cw = 2 * o.a - 0.02, doors = Math.max( 3, Math.round( cw / 0.9 ) );
		add( new RoundedBoxGeometry( cw, cabTop - o.y0 - t, d - 0.03, 2, 0.01 ).translate( 0, o.y0 + ( cabTop - o.y0 - t ) / 2, ( d - 0.03 ) / 2 ).applyMatrix4( F ), M.lacquer );
		board( - o.a + 0.01, o.a - 0.01, cabTop );
		for ( let i = 0; i < doors; ++ i ) {

			const x = ( i - ( doors - 1 ) / 2 ) * cw / doors, pull = i < ( doors - 1 ) / 2 ? 1 : i > ( doors - 1 ) / 2 ? - 1 : 0;		// (the pulls towards the middle)
			add( new RoundedBoxGeometry( cw / doors - 0.012, cabTop - o.y0 - t - 0.04, 0.018, 2, 0.006 ).translate( x, o.y0 + ( cabTop - o.y0 - t ) / 2, d - 0.03 + 0.009 ).applyMatrix4( F ), M.lacquer );
			add( new THREE.CylinderGeometry( 0.006, 0.006, 0.16, 12 ).translate( x + pull * ( cw / doors / 2 - 0.06 ), o.y0 + ( cabTop - o.y0 ) * 0.62, d - 0.03 + 0.03 ).applyMatrix4( F ), M.brass );

		}
		// the uprights between the columns (o.cols: their places, fractions across; the other bay's
		// mirrored), each column's shelves at its own heights (o.heights: above the cabinet; staggered)
		const fr = ( o.cols ?? [ 0.434 ] ).map( f => sx > 0 ? f : 1 - f ).sort( ( a, b ) => a - b );
		const xs = fr.map( f => - o.a + 0.01 + f * ( cw ) ), bounds = [ - o.a + 0.01, ...xs, o.a - 0.01 ];
		const heights = sx > 0 ? o.heights : [ ...o.heights ].reverse();
		for ( const x of xs ) add( new RoundedBoxGeometry( t, top - cabTop, d - 0.02, 2, 0.008 ).translate( x, ( top + cabTop ) / 2, d / 2 - 0.01 ).applyMatrix4( F ), M.lacquer );
		const cols = bounds.slice( 0, - 1 ).map( ( x0, i ) => [ x0 + ( i ? t / 2 : 0 ), bounds[ i + 1 ] - ( i < bounds.length - 2 ? t / 2 : 0 ) ] );
		cols.forEach( ( c, i ) => { for ( const h of heights[ i ] ) { board( c[ 0 ], c[ 1 ], cabTop + h ); strip( c[ 0 ] + 0.06, c[ 1 ] - 0.06, cabTop + h - t ); } } );
		strip( - o.a + o.rc + 0.02, o.a - o.rc - 0.02, o.y1 );		// (the niche's top)
		// where the ornaments stand: [ y, x of its middle, half width ]: the cabinet's top in each column,
		// then each column's shelves (left to right); SHELVING by these
		const mid = c => ( c[ 0 ] + c[ 1 ] ) / 2, hw = c => ( c[ 1 ] - c[ 0 ] ) / 2 - 0.04, ord = sx > 0 ? cols : [ ...cols ].reverse();
		return [ ...ord.map( c => [ cabTop, mid( c ), hw( c ) ] ), ...ord.flatMap( ( c, i ) => o.heights[ i ].map( h => [ cabTop + h, mid( c ), hw( c ) ] ) ) ];

	}

	/**
	 * The clef and its staff, a light on the wall (frame: bay φc): the treble clef's outline (Noto
	 * Music's) extruded as thick acrylic lit from within, five staff lines sweeping from it across the
	 * wall (tubes, waving, fanning a little), a few notes on them. Each piece on its own place on the
	 * curved wall, a little off it.
	 */
	_clefLight( add, phiC, hw = 1.7 ) {		// (`hw`: its bay's half width: the staff across it)

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

				const maps = this._glyphMaps?.[ name ] ?? glyphMaps( G ), m = M.neon.clone();		// (_buildShell made them a frame each)
				m.color.set( '#8c8378' );		// (acrylic lit from within: its own light leads, the room's on it less)
				m.emissiveMap = maps.glow; m.normalMap = maps.normal; m.normalScale = new THREE.Vector2( 1.4, 1.4 ); m.clearcoatNormalMap = maps.normal;
				this.neons[ name ] = m;

			}
			add( g.applyMatrix4( frameAt( phiC - s / R, R - off, y ) ), this.neons[ name ] );

		};
		const ks = Math.min( 1, ( hw - 0.25 ) / 1.45 );		// (in a narrow bay, smaller)
		glyph( 'clef', - 1.05 * ks, 1.22 + 0.2 * ( 1 - ks ), 2.05 * ( 0.75 + 0.25 * ks ) );
		// the staff: five lines from behind the clef across to the right, rising and waving, brighter in the middle
		this.neons.staff ??= Object.assign( M.neon.clone(), { emissiveMap: gradientU( u => 0.55 + 0.45 * Math.sin( Math.PI * u ) ** 0.7 ) } );
		const line = ( k, t ) => {

			const sx = ( - 1.4 + 3.0 * t ) * ks, y = 1.88 + 0.12 * k * ( 1 + 0.35 * t ) + 0.36 * t + 0.14 * Math.sin( Math.PI * ( 1.6 * t + 0.15 ) );
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

	/** The bench (BENCH): its body baked with the lacquer, its plinth brass (its cushions: the pack's, _build). */
	_bench( add ) {

		const M = this.materials, B = BENCH, phi = ( B.from + B.to ) / 2 * Math.PI / 180;
		const w = 2 * B.back * Math.sin( ( B.to - B.from ) / 2 * Math.PI / 180 ), d = B.depth, rc = 0.16, y0 = 0.11, y1 = B.height;
		const F = frameAt( phi, B.back - d / 2 );		// (its front, +z, to the room)
		// the body: its plan a rounded rect (round ends, as the sideboard's), up from the plinth, its edges softened
		const plan = new THREE.Shape(), hx = w / 2, hz = d / 2;
		plan.moveTo( - hx + rc, - hz ); plan.lineTo( hx - rc, - hz ); plan.absarc( hx - rc, - hz + rc, rc, - Math.PI / 2, 0, false ); plan.lineTo( hx, hz - rc );
		plan.absarc( hx - rc, hz - rc, rc, 0, Math.PI / 2, false ); plan.lineTo( - hx + rc, hz ); plan.absarc( - hx + rc, hz - rc, rc, Math.PI / 2, Math.PI, false );
		plan.lineTo( - hx, - hz + rc ); plan.absarc( - hx + rc, - hz + rc, rc, Math.PI, 1.5 * Math.PI, false );
		const body = new THREE.ExtrudeGeometry( plan, { depth: y1 - y0 - 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3, curveSegments: 12 } ).rotateX( - Math.PI / 2 ).translate( 0, y0 + 0.01, 0 );
		body.deleteAttribute( 'uv' ); body.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( body.attributes.position.count * 2 ), 2 ) );		// (as the other lacquer's)
		add( body.applyMatrix4( F ), M.lacquer );
		// its drawers, flush (a hair proud, thin gaps), along its flat front
		const n = 3, pw = ( w - 2 * rc ) / n;
		for ( let i = 0; i < n; ++ i ) add( new RoundedBoxGeometry( pw - 0.008, y1 - y0 - 0.06, 0.01, 2, 0.003 ).translate( - hx + rc + ( i + 0.5 ) * pw, ( y0 + y1 ) / 2, hz + 0.004 ).applyMatrix4( F ), M.lacquer );
		// the plinth and its legs
		add( new RoundedBoxGeometry( w - 0.1, 0.02, d - 0.08, 2, 0.006 ).translate( 0, y0 - 0.01, 0 ).applyMatrix4( F ), M.brass );
		for ( const x of [ - ( hx - 0.12 ), 0, hx - 0.12 ] ) for ( const z of [ - ( hz - 0.07 ), hz - 0.07 ] ) add( new THREE.CylinderGeometry( 0.012, 0.009, y0 - 0.02, 12 ).translate( x, ( y0 - 0.02 ) / 2, z ).applyMatrix4( F ), M.brass );
		// its seat, for the cushions (the pack's, TRELLIS: _build)
		this.benchSeat = { F, y: y1, back: - hz, w };

	}

	/**
	 * A curtain of light in an arched niche (frame F: its back), as the reference's: a pleated curtain
	 * at its back (the pack's: _build), and before it thin lit tubes falling from the arch, longest in the
	 * middle, a little shorter each way. The tubes: line lights (their glow on the curtain; the bake's).
	 */
	_curtain( add, F, o ) {

		// the curtain itself: the pack's (a relief of a generated photo, MoGe-2), hung at the niche's back (_build)
		const M = this.materials, n = Math.max( 5, Math.round( 2 * ( o.a - 0.12 ) / 0.198 ) ), sp = 2 * ( o.a - 0.12 ) / n, zt = 0.22;		// (the tubes before its folds)
		this.curtainAt = { F, o };
		for ( let i = 0; i < n; ++ i ) {		// the tubes

			const x = - o.a + 0.12 + ( i + 0.5 ) * sp, u = x / o.a, top = o.yS + Math.sqrt( Math.max( 0, o.a * o.a - x * x ) ) - 0.14;
			const len = 0.75 + 1.1 * ( 1 - u * u ) * ( 0.85 + 0.15 * Math.cos( 7 * i ) ), bottom = top - len;
			add( new THREE.CylinderGeometry( 0.016, 0.016, len, 14 ).translate( x, ( top + bottom ) / 2, zt ).applyMatrix4( F ), M.curtainLed );
			add( new THREE.CylinderGeometry( 0.02, 0.02, 0.024, 14 ).translate( x, top + 0.012, zt ).applyMatrix4( F ), M.brass );
			this.segments.push( { a: new THREE.Vector3( x, bottom, zt ).applyMatrix4( F ), b: new THREE.Vector3( x, top, zt ).applyMatrix4( F ), n: null, clip: null, kind: 'curtain' } );

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

		// plain: a flat lacquered upright from the floor to the cornice, its edges softly rounded (no
		// flutes, no band, no base or capital)
		const w = LUMINARA.pilaster, d = 0.12, H = LUMINARA.wall;
		const shaft = new RoundedBoxGeometry( w, H + 0.02, d + 0.06, 3, 0.012 ).translate( 0, ( H + 0.02 ) / 2 - 0.01, ( d + 0.06 ) / 2 - 0.06 );
		return { shaft, sconce: this._sconce( d ) };

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
		// the low sun through a window (Blue hour), or the moon (night): a directional light, its shadow over
		// the room (the walls round the windows cast it), soft
		this.sun = new THREE.DirectionalLight( '#ffffff', 0 );
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set( 4096, 4096 );
		Object.assign( this.sun.shadow.camera, { left: - 9, right: 9, top: 9, bottom: - 9, near: 1, far: 40 } );
		this.sun.shadow.bias = - 0.0002; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 4;
		this.sun.target.position.set( 0, 0, 0 );
		this.lights.add( this.sun, this.sun.target );

	}

	updateLights() {

		if ( ! this._built ) return;		// (no shell yet: _buildShell calls it)
		const L = this.light, M = this.materials;
		this.topSpot.intensity = L.top; this.topSpot.color.set( L.topColor ); this.topSpot.visible = L.top > 0;
		this.topSpot.angle = THREE.MathUtils.degToRad( L.topAngle ?? 15 );
		for ( const [ i, s ] of this.domeSpots.entries() ) {

			const [ p, t ] = this.domeAt[ i ];
			s.position.copy( p ); s.target.position.copy( t );
			s.intensity = L.dome; s.color.set( L.downColor ); s.visible = L.dome > 0;

		}
		// the sun (its disc in the sky, its light through a window) or the moon (the night's: its disc, stars, clouds)
		const S = this.skyU, sunOn = ( L.sun ?? 0 ) > 0, moonOn = ( L.moon ?? 0 ) > 0;
		S.uSunDir.value.copy( dirOf( L.sunAz ?? 249, L.sunEl ?? 15 ) ); S.uSunColor.value.set( L.sunColor ?? '#ffc890' ); S.uSun.value = sunOn ? Math.sqrt( L.sun / 16 ) : 0;		// (its disc and glow: the preset's at 1)
		S.uMoon.value = L.moon ?? 0; S.uStars.value = L.stars ?? 0; S.uClouds.value = moonOn ? L.clouds ?? 0 : 0;
		const sunDir = sunOn ? S.uSunDir.value : S.uMoonDir.value;
		this.sun.position.copy( sunDir ).multiplyScalar( 20 );
		this.sun.color.set( sunOn ? L.sunColor ?? '#ffc890' : '#b8c8e8' );
		this.sun.userData.intensity = sunOn ? L.sun : moonOn ? L.moonLight ?? 0 : 0;
		this.sun.intensity = this.sun.userData.intensity * ( sunOn ? 1 : 1 - this.moonCloud() );
		this.sun.visible = this.sun.userData.intensity > 0;
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
			else if ( g.kind === 'curtain' ) c.set( L.ledColor ).multiplyScalar( 0.083 * L.ledWall );		// (a tube: its radiance × its diameter, as a sconce's)
			else c.set( L.ledColor ).multiplyScalar( L.shelf ?? 1 );

		}
		M.shelfLed.emissive.set( L.ledColor ); M.shelfLed.emissiveIntensity = L.ledWall;
		M.stepLed.emissive.set( L.ledColor ); M.stepLed.emissiveIntensity = 3 * L.ledFloor;
		M.curtainLed.emissive.set( L.ledColor ); M.curtainLed.emissiveIntensity = 2.6 * L.ledWall;		// (the walls' brightest with the clef, below the bloom)
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
		// the preset's lightmap once it has come (_needBake); until then the one shown before (closer than none)
		const want = L.baked !== false ? this.bakes?.[ this.preset ] : null;
		if ( want && ! want.map ) this._needBake( this.preset );
		const bake = want?.map ? want : want ? this._bakeShown : null;
		if ( bake?.map ) this._bakeShown = bake;
		this.bakeU.uBakeOn.value = bake?.map ? 1 : 0;
		if ( bake?.map ) { this.bakeU.uBake.value = bake.map; this.bakeU.uBakeScale.value = bake.scale; }
		const sky = this.skies[ L.outside ] ?? Object.values( this.skies )[ 0 ];
		if ( sky && M.sky.map !== sky ) { M.sky.map = sky; M.sky.needsUpdate = ! M.sky.map; }
		M.sky.color.setScalar( this.pack ? L.sky : 0.25 * L.sky );
		for ( const { raster, pt } of this._ptTwins?.values() ?? [] ) {		// (path tracing's emitting twins: setMode)

			pt.emissive.copy( raster.color ); pt.emissiveMap = raster.map ?? null; pt.emissiveIntensity = 1;
			// an additive raster material (the staff: white lines on black, added to the riser behind it): its map as
			// the twin's alpha too, so its black lets the riser show through (the path tracer: a stochastic pass-through),
			// not an opaque black band
			const additive = raster.blending === THREE.AdditiveBlending;
			pt.alphaMap = additive ? raster.map ?? null : null; pt.transparent = additive; pt.depthWrite = ! additive;
			pt.needsUpdate = true;

		}
		const size = this.highQuality ? 4096 : 2048, key = this.domeSpots[ 0 ];
		if ( key.shadow.mapSize.x !== size ) {

			key.shadow.mapSize.set( size, size );
			key.shadow.map?.dispose();
			key.shadow.map = null;

		}
		if ( this.active ) this.scene.background = this.background;

	}

	setQuality( hq ) { this.highQuality = hq; this.setClear(); this.updateLights(); }

	/** The clear things (crystal, glass) refracting when transmission is drawn (GI, the path tracer), else alpha glass with brighter reflections. */
	setClear() {

		const on = this.highQuality || this.mode === 'pathtrace';
		for ( const m of this.clear ?? [] ) {

			if ( ( m.transmission > 0 ) === on && m.userData.clearSet ) continue;
			m.userData.clearSet = true;
			m.transmission = on ? 1 : 0;
			m.transparent = ! on; m.depthWrite = on; m.side = on ? THREE.FrontSide : THREE.DoubleSide;		// (three draws a two-sided transmissive thing's back into its own transmission first: TRELLIS's mixed winding refracted it into itself, milky)
			// (off: premultiplied by hand in its shader, the reflection added, the back dimmed by its alpha)
			Object.assign( m, on ? { blending: THREE.NormalBlending } : { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } );
			m.needsUpdate = true;

		}

	}

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
		// each preset's lightmap: fetched when it is shown (_needBake), the first with the pack (prefetchLuminara)
		this.bakes = {};
		for ( const [ name, p ] of Object.entries( meta.presets ?? {} ) ) {

			if ( ! p.file || ! Number.isFinite( p.scale ) ) continue;		// (a failed bake, or an old pack: the probe's light)
			this.bakes[ name ] = { file: p.file, scale: p.scale, map: null, loading: null };

		}

	}

	/** The lightmap for `name` (resolves once it is on its bake; null when there is none). The others fetched later, while idle. */
	_needBake( name ) {

		const b = this.bakes?.[ name ];
		if ( ! b ) return Promise.resolve( null );
		b.loading ??= lightmapTexture( b.file ).then( t => {

			b.map = t;
			if ( this.preset === name ) { this.updateLights(); this.onBake?.(); }
			return b;

		} ).catch( e => { console.warn( `Luminara: ${ e.message ?? e } (the preset's light from the probe)` ); delete this.bakes[ name ]; this.updateLights(); return null; } );
		return b.loading;

	}

	/** Fetch the other presets' lightmaps' bytes in the background (decoded when shown). */
	_prefetchBakes() {

		for ( const b of Object.values( this.bakes ?? {} ) ) lightmapBytes( b.file ).catch( () => {} );

	}

	/** Before the frame is drawn (main.js): the floor's reflection, from `camera`. */
	/** The clouds before the moon now (0 clear .. 0.85), seen from the room's middle: its light dims under them. */
	moonCloud() {

		const S = this.skyU, d = S.uMoonDir.value;
		if ( ! S.uClouds.value ) return 0;
		const y = SKY_EYE + S.uSkyR.value * d.y / Math.hypot( d.x, d.z );		// (by direction, as the shader's)
		return cloudDensity( Math.atan2( d.x, d.z ) + ( Math.atan2( d.x, d.z ) < 0 ? 2 * Math.PI : 0 ), y, S.uTime.value, S.uClouds.value );

	}

	beforeRender( renderer, camera ) {

		if ( ! this.active || ! this._built ) return;
		// the sky's time (its clouds drift, its stars twinkle), the moon's light under the clouds
		const S = this.skyU;
		S.uTime.value = ( window.__pianistPaused ? S.uTime.value : clock.now() / 1000 + ( this.skyTimeShift ?? 0 ) );		// (the render clock offline: a render's sky the same each time)		// (skyTimeShift: to look at another moment)
		if ( this.sun.visible && ! S.uSun.value ) this.sun.intensity = this.sun.userData.intensity * ( 1 - this.moonCloud() );
		this.carousel?.userData.turn( clock.now() / 1000 );		// (the music box's carousel: on the render clock, as the sky)
		if ( this.mode === 'pathtrace' ) return;
		this.mirror.update( renderer, this.scene, camera, [ this.floorMeshes ].flat(), this.mirrorScale ?? ( this.highQuality ? 0.5 : 0.35 ) );		// (mirrorScale: an offline render's, main.js)

	}

	/** Around a capture by a cube camera (the probe, a mirror): the floor's reflection off (it is the main view's). */
	set capturing( on ) { this.mirror.enabled = ! on; }

	setMode( mode ) {

		this.mode = mode;
		this.setClear();
		// path tracing: what only the raster shows as light (MeshBasicMaterial: no emission to the path
		// tracer, it reads it as a dark surface) as an emitter: the sky (the windows' daylight), the staff
		this._ptTwins ??= new Map();
		for ( const o of [ this.sky, ...this.group.children.filter( c => c.name === 'luminara:staff' ) ] ) {

			if ( ! o ) continue;
			if ( ! this._ptTwins.has( o ) ) this._ptTwins.set( o, { raster: o.material, pt: new THREE.MeshStandardMaterial( { color: 0x000000, roughness: 1, metalness: 0, side: o.material.side } ) } );
			o.material = mode === 'pathtrace' ? this._ptTwins.get( o ).pt : this._ptTwins.get( o ).raster;

		}
		this.updateLights();

	}

	// ---------------------------------------------------------------------
	/** Load the pack (once): the furniture, the reliefs, the sky and the floor's marble. */
	load() {

		this._loadTried = true;
		const S = luminaraStatus, url = new URL( 'luminara.glb', packDir() );
		S.pack = 'waiting';
		this.loading = ( async () => {

			const [ buf ] = await Promise.all( [ prefetchLuminara(), this.building ] );		// (the pack's pieces go where the shell says)
			S.pack = 'build';
			await nextFrame();
			const gltf = await new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).parseAsync( buf, url.href );
			await nextFrame();
			const pack = this._build( gltf );
			await this._needBake( this.preset );		// (its light from the start: the probe then sees the room lit as it will be)
			// its shaders before it shows (a long freeze at its first frame else); its lamp's light in the scene: every lit program again
			S.pack = 'compile';
			await nextFrame();
			await this.precompile?.( pack );
			await this.precompile?.( this.scene );
			this.group.add( pack );
			this.pack = pack;
			S.pack = 'ready';
			this.updateLights();
			this.onLoad?.();
			setTimeout( () => this._prefetchBakes(), 4000 );

		} )().catch( e => { S.failed = true; console.warn( `Luminara: ${ e.message ?? e } (the pack: tools/luminara-asset.mjs)` ); } );
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
			sky.colorSpace = THREE.SRGBColorSpace; sky.wrapS = THREE.MirroredRepeatWrapping; sky.wrapT = THREE.ClampToEdgeWrapping; sky.repeat.set( this.skyReps, this.skyV.repeat ); sky.offset.set( 0.5, this.skyV.offset ); sky.needsUpdate = true;		// (half a photo round: its mirrored joins at 45° + k 90°, between the windows, not in window M)
			this.skies[ hour ] = sky;

		}
		M.sky.map = this.skies[ this.light.outside ] ?? Object.values( this.skies )[ 0 ] ?? null; M.sky.color.set( '#ffffff' ); M.sky.needsUpdate = true;
		if ( marble ) {

			marble.colorSpace = THREE.SRGBColorSpace; marble.wrapS = marble.wrapT = THREE.RepeatWrapping; marble.anisotropy = 8; marble.needsUpdate = true;
			for ( const m of [ M.floor, M.border ] ) { m.map = marble; m.needsUpdate = true; }
			M.border.color.set( '#b9b2a6' );

		}
		// clear things: refracting (transmission) under GI and the path tracer, as the piano's glass, alpha
		// glass else (setClear); cut crystal faceted (flat shading: each facet its own sparkle), a crystal's
		// index and dispersion (its rainbow edges); smooth glass as glass. No shadow (place())
		this.clear = [];
		const clear = cut => {

			const ior = cut ? 2.0 : 1.5;
			const m = phys( { color: '#ffffff', metalness: 0, roughness: cut ? 0.0 : 0.02, ior, thickness: cut ? 0.06 : 0.02, dispersion: cut ? 4 : 1,
				attenuationColor: new THREE.Color( cut ? '#f4f8ff' : '#f6fbfb' ), attenuationDistance: 0.6, specularIntensity: 1,
				flatShading: cut, side: THREE.DoubleSide } );
			m.userData.clear = true;
			// Fresnel for the alpha fallback (transmission has its own: three's refraction is weighted by 1 - F): what is
			// seen through is dimmed by 1 - F, the reflection (its specular, F already in it) added in full, not faded
			// with the body; a little haze (the body's diffuse) so it does not vanish face on
			const U = { uClearF0: { value: ( ( ior - 1 ) / ( ior + 1 ) ) ** 2 }, uClearHaze: { value: cut ? 0.08 : 0.1 } };
			chainCompile( m, shader => {

				Object.assign( shader.uniforms, U );
				shader.fragmentShader = shader.fragmentShader
					.replace( '#include <common>', '#include <common>\nuniform float uClearF0, uClearHaze;' )
					.replace( '#include <opaque_fragment>', `#ifdef USE_TRANSMISSION
						#include <opaque_fragment>
					#else
						float clearF = uClearF0 + ( 1.0 - uClearF0 ) * pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 5.0 );
						float clearHaze = uClearHaze * ( 1.0 - clearF );
						gl_FragColor = vec4( totalSpecular + ( outgoingLight - totalSpecular ) * clearHaze, clearF + clearHaze );
					#endif` );

			}, 'clearFresnel' );
			this.clear.push( m );
			return m;

		};
		// our materials for the pack's (by extras.look)
		const ours = new Map();
		const finish = m => {

			if ( ours.has( m ) ) return ours.get( m );
			const look = m.userData.look, base = { color: m.color, roughness: m.roughness, metalness: m.metalness };
			const p = {
				brass: () => phys( { color: '#d6a95c', metalness: 1, roughness: 0.28 } ),
				brassPolished: () => phys( { color: '#e2b46a', metalness: 1, roughness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.05 } ),		// (the sofa's plinth: a clear metal sheen)
				// the sofa group's set (its sheets): an ivory leather shell (a satin coat, a fine grain), beige boucle (its loops: a
				// coarse bump, a soft sheen; the decoder's shading as its colour), dusty blue velvet pillows (a strong sheen at the
				// edges), a polished champagne-gold inlay and floor ring, a satin champagne pedestal, the table's polished marble
				leatherShell: () => leather( phys( { color: '#efe7da', roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.22, sheen: 0.15, sheenColor: new THREE.Color( '#fff6ea' ), sheenRoughness: 0.5 } ) ),
				boucleFabric: () => leather( phys( { color: new THREE.Color( 1.28, 1.24, 1.2 ), vertexColors: true, roughness: 0.97, sheen: 0.6, sheenColor: new THREE.Color( '#f6e8d6' ), sheenRoughness: 0.6 } ), { scale: 95, amount: 0.22, coat: 0 } ),
				velvetCream: () => phys( { color: '#ece3d4', roughness: 0.82, sheen: 1, sheenColor: new THREE.Color( '#fff8ee' ), sheenRoughness: 0.35 } ),		// (the sofa's middle pillow)
				velvetBlue: () => phys( { color: '#8295b4', roughness: 0.82, sheen: 1, sheenColor: new THREE.Color( '#d4e0ee' ), sheenRoughness: 0.35 } ),		// (the sheets' dusty blue: lighter than it renders flat)
				goldInlay: () => phys( { color: '#e3c58c', metalness: 1, roughness: 0.14, clearcoat: 0.3, clearcoatRoughness: 0.06 } ),
				champagne: () => phys( { color: '#c4a986', metalness: 1, roughness: 0.3 } ),		// (the sheets' light satin champagne)
				tableMarble: () => phys( { color: '#f4f1ec', map: marble, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 } ),
				// the carousel music box's horse (carouselBox: the box's own parts in the same three)
				porcelain: () => phys( { color: '#f4efe6', roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.08 } ),
				enamelBlue: () => phys( { color: '#b9cfe4', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 } ),
				gilt: () => phys( { color: '#e2bf7a', metalness: 1, roughness: 0.16, clearcoat: 0.25, clearcoatRoughness: 0.08 } ),
				lacquer: () => phys( { color: '#f3f1ed', roughness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.15 } ),		// (more: the shell mirrors the room and reads as glass)
				boucle: () => leather( phys( { color: '#e8dfd0', roughness: 0.55, sheen: 0.25, sheenColor: new THREE.Color( '#fff4e6' ), sheenRoughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.28 } ) ),		// (cream leather: its coat's highlight, a fine grain)
				marble: () => phys( { color: '#f1efec', map: marble, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.05 } ),
				ceramic: () => phys( { color: '#efede8', roughness: 0.5 } ),
				foliage: () => phys( { color: new THREE.Color( 1.5, 2.1, 1.25 ), vertexColors: true,		// (the decoder's olive: dark and grey)
					 roughness: 0.65, side: THREE.DoubleSide } ),
				natural: () => phys( { color: '#ffffff', vertexColors: true, roughness: 0.85 } ),
				books: () => phys( { color: '#ffffff', vertexColors: true, roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.3 } ),
				fabric: () => phys( { color: '#ffffff', vertexColors: true, roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color( '#fff4e4' ), sheenRoughness: 0.55 } ),		// (the cushions)
				shade: () => phys( { color: '#f6efe2', roughness: 0.9, emissive: new THREE.Color( '#ffdcb0' ), emissiveIntensity: 2.5 } ),		// (a lamp's shade: lit through)
				stone: () => phys( { color: '#09090a', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 } ),
				glass: () => clear( false ),		// (smooth glass: a ball, a dome, a vase)
				silver: () => phys( { color: '#d9dbe0', metalness: 1, roughness: 0.2 } ),
				crystal: () => clear( true ),		// (cut crystal: faceted, more dispersion)
				relief: () => phys( { color: m.emissiveMap ? '#9c8f80' : '#ffffff', map: m.map, ...( m.name === 'relief-curtain' ? { roughness: 0.9, sheen: 0.7, sheenColor: new THREE.Color( '#fff6ea' ), sheenRoughness: 0.5 } : {} ),		// (a self-lit relief's panel darker: its lines read; the curtain: cloth)
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
		const ORNAMENTS = new Set( [ ...Object.values( SHELVING ).flat( 2 ), ...ON_SIDEBOARD, ...ON_SMALL_CABINET, ...TABLES.flatMap( t => t[ 3 ] ) ].map( i => i[ 0 ] ) ), used = new Set();
		const place = ( name, F, mirror = false ) => {

			if ( ORNAMENTS.has( name ) ) {		// (an ornament: once in the room)

				if ( used.has( name ) ) { console.warn( `Luminara: ornament ${ name } placed twice: the second left out` ); return; }
				used.add( name );

			}

			const built = { 'gold-disc': () => goldRecord( this.segUPack ), 'vinyl': () => goldRecord( this.segUPack, true ), 'picture': () => mapOf( 'painting-3' ) && framedPicture( mapOf( 'painting-3' ), 0.34, 0.26, 0.1 ),
				// the carousel music box: built here round the pack's horse (its looks finished), turning (beforeRender)
				'carousel': () => {
					const h = nodes[ 'carousel-horse' ]?.clone();
					h?.traverse( c => { if ( c.isMesh ) c.material = finish( c.material ); } );
					return ( this.carousel = carouselBox( h ) );
				} }[ name ];
			if ( ! nodes[ name ] && ! built ) return;
			const holder = new THREE.Group();
			holder.matrixAutoUpdate = false;
			holder.matrix.copy( F );
			if ( mirror ) holder.matrix.multiply( new THREE.Matrix4().makeScale( - 1, 1, 1 ) );
			if ( built ) {		// (ours: the records, a picture)

				const g = name === 'picture' || name === 'carousel' ? built() : ( ( record ??= {} )[ name ] ??= built() ).clone();		// (the carousel: itself, not a clone: it turns)
				if ( g ) { holder.add( g ); pack.add( holder ); }
				return;

			}
			const o = nodes[ name ].clone();
			if ( ORNAMENTS.has( name ) && ! /^books/.test( name ) ) o.scale.multiplyScalar( 1.15 );		// (as the close-ups': about three quarters of a shelf's height)
			o.traverse( c => { if ( c.isMesh ) { c.material = finish( c.material ); c.castShadow = ! c.material.transparent && ! c.material.userData.clear; c.receiveShadow = true; } } );		// (glass: no shadow)
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
		for ( const [ name, deg, r, t, face ] of FURNITURE ) {

			const F = frameAt( deg * Math.PI / 180, r ?? R - 0.12 - size( name )[ 2 ] / 2 ).multiply( turn( t ) );		// (its ends clear of the curved wall)
			if ( face ) {		// turned to face that point (its front +z)

				const p = outward( face[ 0 ] * Math.PI / 180 ).multiplyScalar( face[ 1 ] ).applyMatrix4( new THREE.Matrix4().copy( F ).invert() );
				F.multiply( new THREE.Matrix4().makeRotationY( Math.atan2( p.x, p.z ) ) );

			}
			place( name, F );
			if ( SEAT_PILLOWS[ name ] ) {		// (its pillows: their backs on its back cushion, their feet on its seat)

				const S = SEAT_PILLOWS[ name ];
				for ( const [ item, x, dz, yaw, lean ] of S.pillows ) { const d = size( item )[ 2 ]; place( item, F.clone().multiply( new THREE.Matrix4().makeTranslation( x, S.y, S.z + d / 2 + dz ) ).multiply( turn( yaw ) ).multiply( new THREE.Matrix4().makeRotationX( - lean * Math.PI / 180 ) ) ); }

			}
			if ( name === 'coffee-table' ) { const top = nodes[ name ]?.userData.top ?? size( name )[ 1 ]; for ( const [ item, x, z, tt ] of ON_COFFEE_TABLE ) place( item, F.clone().multiply( new THREE.Matrix4().makeTranslation( x, top, z ) ).multiply( turn( tt ) ) ); }
			if ( name === 'small-cabinet' ) { const [ cw, ch ] = size( name ); for ( const [ item, x, z, tt ] of ON_SMALL_CABINET ) place( item, F.clone().multiply( new THREE.Matrix4().makeTranslation( x * cw / 2, ch, z ) ).multiply( turn( tt ) ) ); }
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
		// the shelving's ornaments, each on its shelf
		for ( const n of this.nichePoints.filter( n => n.kind === 'shelves' ) ) ( SHELVING[ n.deg > 180 ? 1 : 2 ] ).forEach( ( items, k ) => {

			if ( ! n.surfaces[ k ] ) return;
			const [ y, cx, half ] = n.surfaces[ k ];		// (each shelving its own ornaments)
			for ( const [ item, x, tt ] of items ) place( item, n.F.clone().multiply( new THREE.Matrix4().makeTranslation( cx + x * half * 0.75, y, n.o.depth * 0.45 ) ).multiply( turn( tt ) ) );

		} );
		// the curtain at the curtain of light's back (its relief: its back on z 0, its middle at x 0; as wide as the niche)
		if ( nodes.curtain && this.curtainAt ) {

			const { F, o } = this.curtainAt, sz = size( 'curtain' ), k = ( 2 * o.a + 0.08 ) / sz[ 0 ];		// (the niche's full width, a little over: its sides and top hidden behind the reveal)
			place( 'curtain', F.clone().multiply( new THREE.Matrix4().makeTranslation( 0, o.y0 - 0.05, 0.005 ) ).multiply( new THREE.Matrix4().makeScale( k, k, Math.min( k, 0.15 / sz[ 2 ] ) ) ) );

		}
		// the bench's cushions, each one of its own, leaning back on the seat here and there
		if ( this.benchSeat ) {

			const { F, y, back, w } = this.benchSeat;
			for ( const [ name, x, lean, yaw ] of [ [ 'cushion-square', - 0.36, 0.3, 0.12 ], [ 'cushion-lumbar', 0.02, 0.22, - 0.06 ], [ 'cushion-velvet', 0.36, 0.28, - 0.15 ] ] ) {

				const d = size( name )[ 2 ];
				place( name, F.clone().multiply( new THREE.Matrix4().makeTranslation( x * w, y, back + d / 2 + 0.05 ) ).multiply( new THREE.Matrix4().makeRotationY( yaw ) ).multiply( new THREE.Matrix4().makeRotationX( - lean ) ) );

			}

		}
		// on the tables
		for ( const [ F, y, rad, items ] of this.tableTops ) for ( const [ item, x, z, tt ] of items ) place( item, F.clone().multiply( new THREE.Matrix4().makeTranslation( x * rad * 2, y, z * rad * 2 ) ).multiply( turn( tt ) ) );
		// a painting on each plain wall: the city outside (the day's photo, a part of it), framed
		const painting = k => mapOf( `painting-${ k }` ) ?? null;
		for ( const [ i, phi ] of this.paintings.entries() ) {

			const t = painting( i + 1 );
			if ( ! t ) continue;
			const g = framedPicture( t, 1.25, 0.84 );
			g.applyMatrix4( frameAt( phi, R - 0.03, 1.55 ) );
			pack.add( g );

		}
		this.setClear();
		// the pack's quantised attributes (meshopt: normalized Int16 positions, Int8 normals, Uint8 colours)
		// as floats, the same values: three-gpu-pathtracer copies an attribute into one of its own type and
		// writes world-space metres into it (positions clamped to ±32767, normals and colours unscaled: the
		// furniture became sheets 65 km across); the raster draw is unchanged
		pack.traverse( o => {

			if ( ! o.isMesh ) return;
			for ( const [ k, a ] of Object.entries( o.geometry.attributes ) ) {

				if ( ! a.normalized && ! a.isInterleavedBufferAttribute && a.array instanceof Float32Array ) continue;
				const f = new Float32Array( a.count * a.itemSize );
				for ( let i = 0; i < a.count; ++ i ) for ( let c = 0; c < a.itemSize; ++ c ) f[ i * a.itemSize + c ] = a.getComponent( i, c );
				o.geometry.setAttribute( k, new THREE.BufferAttribute( f, a.itemSize ) );

			}

		} );
		return pack;		// (load(): compiled, then into the group)

	}

}

// ---- loading, for the progress bar (main.js, as the Berlin hall's): the pack and the first preset's
// lightmap downloaded (streamed: their bytes so far), the room's shell built and its shaders compiled
// (shown when Luminara first shows), then the pack's built and compiled; the page drawing in between ----

/** shell, pack: pending | build | compile | ready; downloading while the bytes come; failed: the pack's. */
export const luminaraStatus = { received: 0, total: 0, downloading: false, shell: 'pending', pack: 'pending', failed: false };

/** What is being done now: idle | download | build | compile | ready | failed. */
export function luminaraPhase() {

	const s = luminaraStatus;
	if ( s.failed ) return 'failed';
	if ( s.shell === 'build' || s.pack === 'build' ) return 'build';
	if ( s.shell === 'compile' || s.pack === 'compile' ) return 'compile';
	if ( s.downloading || s.pack === 'waiting' ) return 'download';
	return s.shell === 'ready' && s.pack === 'ready' ? 'ready' : 'idle';

}

/** 0..1 through the loading (the download most of it: what takes long on a real connection). */
export function luminaraProgress() {

	const s = luminaraStatus, step = { pending: 0, waiting: 0, build: 0.3, compile: 0.6, ready: 1 };
	const dl = s.downloading ? ( s.total ? Math.min( 1, s.received / s.total ) : 0 ) : 1;
	return 0.78 * dl + 0.1 * step[ s.shell ] + 0.12 * step[ s.pack ];

}

/** A short line for the progress bar. */
export function luminaraStatusText() {

	const s = luminaraStatus, mb = b => ( b / 1048576 ).toFixed( 1 );
	switch ( luminaraPhase() ) {

		case 'download': return s.total ? `Loading Luminara · ${ mb( s.received ) } / ${ mb( s.total ) } MB` : `Loading Luminara · ${ mb( s.received ) } MB`;
		case 'build': return s.shell === 'build' ? 'Building the room' : 'Furnishing the room';
		case 'compile': return 'Preparing materials';
		case 'failed': return 'Luminara failed to load';
		default: return '';

	}

}

let prefetch = null;
const packDir = () => new URL( 'luminara/', new URL( import.meta.env.BASE_URL, location.href ) );

/** Fetch `url` streamed, its bytes counted into luminaraStatus (slot `i` of `n`: the total once all have said their size). */
const tracked = { got: [], size: [], n: 0 };
async function fetchTracked( url, i, opts ) {

	const res = await fetch( url, opts ), s = luminaraStatus, T = tracked, sum = a => a.reduce( ( x, y ) => x + ( y ?? 0 ), 0 );
	if ( ! res.ok ) throw new Error( `${ url.pathname.split( '/' ).pop() }: HTTP ${ res.status }` );
	// (a compressed response's length is not the body's: then no total, only the bytes so far)
	T.size[ i ] = res.headers.get( 'content-encoding' ) ? 0 : Number( res.headers.get( 'content-length' ) ) || 0;
	if ( T.size.filter( v => v !== undefined ).length === T.n && T.size.every( v => v ) ) s.total = sum( T.size );
	if ( ! res.body ) return res.arrayBuffer();
	const reader = res.body.getReader(), chunks = [];
	T.got[ i ] = 0;
	for ( ;; ) {

		const { done, value } = await reader.read();
		if ( done ) break;
		chunks.push( value );
		T.got[ i ] += value.length;
		s.received = sum( T.got );

	}
	const out = new Uint8Array( T.got[ i ] );
	let o = 0;
	for ( const c of chunks ) { out.set( c, o ); o += c.length; }
	return out.buffer;

}

/** Start fetching the pack (safe to call repeatedly); resolves to its bytes. The first preset's lightmap with it. */
export function prefetchLuminara() {

	if ( prefetch ) return prefetch;
	const s = luminaraStatus;
	// (the preset shown first: main.js's ?preset=, else the venue's default; its file named as tools/luminara-asset.mjs names it)
	const first = new URLSearchParams( location.search ).get( 'preset' ) ?? LUMINARA_DEFAULT;
	const firstMap = ! NOBAKE && LUMINARA_PRESETS[ first ] ? `lightmaps/${ first.toLowerCase().replace( /[^a-z0-9]+/g, '-' ) }.webp` : null;
	tracked.n = firstMap ? 2 : 1;
	s.downloading = true;
	prefetch = fetchTracked( new URL( 'luminara.glb', packDir() ), 0, { priority: 'high' } );
	const all = [ prefetch ];
	if ( firstMap ) {

		const map = fetchTracked( new URL( firstMap, packDir() ), 1 ).then( b => new Blob( [ b ], { type: 'image/webp' } ) );
		lightmapFetches.set( firstMap, map );
		all.push( map.catch( () => {} ) );		// (no lightmap: the probe's light, not a failed load)

	}
	Promise.all( all ).then( () => { s.downloading = false; }, () => { s.downloading = false; s.failed = true; } );
	return prefetch;

}

// the lightmaps (one per preset, beside the pack): their bytes fetched once each, when a preset needs one
const lightmapFetches = new Map();
function lightmapBytes( file ) {

	if ( ! lightmapFetches.has( file ) ) lightmapFetches.set( file, fetch( new URL( file, packDir() ) ).then( r => { if ( ! r.ok ) throw new Error( `${ file }: HTTP ${ r.status }` ); return r.blob(); } ) );
	return lightmapFetches.get( file );

}

/** Let a frame be drawn (or, in a hidden tab, where frames wait, go on after a moment). */
const nextFrame = () => new Promise( r => { const t = setTimeout( r, 100 ); requestAnimationFrame( () => { clearTimeout( t ); setTimeout( r, 0 ); } ); } );
/** A lightmap as a texture: as GLTFLoader would make it (its image not flipped: v 0 its first row). */
async function lightmapTexture( file ) {

	const blob = await lightmapBytes( file );
	const image = typeof createImageBitmap === 'function'
		? await createImageBitmap( blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } )
		: await new Promise( ( ok, no ) => { const im = new Image(); im.onload = () => ok( im ); im.onerror = no; im.src = URL.createObjectURL( blob ); } );
	const t = new THREE.Texture( image );
	t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
	return t;

}

// Grand piano after the FIND GF smart grand (GF156C / F150G: 150 W x 156-160 D x 100 H cm;
// Footages.local/find/GF-TYPE-*.jpg, MHGF*.jpg; diary-job memo/piano/grand-piano-design-
// references.md): bentside rim with a wood-veneered inner face, open lid on a prop stick, gold
// plate with struts, overstrung strings, dampers, a full-width tilted display in place of the
// fallboard and music desk (bezel 1343 x 320 mm, 117° to the keyboard plane), a lid with its
// front flap folded back, and the frame below after USD834638 (Figs. 1, 2, 5, 7): two flat front
// legs set back under the case, flaring into its underside and joined at the floor by a
// stretcher carrying 7 pedals grouped 2-3-2, a tapered tail leg, a frosted panel between the
// front legs with the pedal rods, trapwork, belly braces and a speaker grille underneath.
//
// Frame: origin at floor below the keyboard center, key fronts at z = 0, body towards -z.

import * as THREE from 'three';
import { Keyboard } from './keyboard.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { woodBox, v3, extrudeTop, merge, beam, rod, boxProjectUV } from './geometry.js';
import { sweep, profile, filletPlan, meet, latheProfile, roundCorners } from './castdetail.js';
import { buildBridges, buildBassBridge } from './soundboard.js';
import { PianoAction } from './action.js';
import { pedalShape } from './upright.js';
import { buildBench } from './bench.js';

const KEY_BOTTOM = 0.698;
// heights from the patent's side elevation (Fig. 5, rim top 1.00 m): the rim is 0.28 m deep,
// its underside at 0.72 m; the keybed section in front (to z = -0.72) hangs lower, to 0.645
const RIM_BOTTOM = 0.72;
const FRONT_BOTTOM = 0.645;
const FRONT_SECTION_Z = - 0.72;
const RIM_TOP = 0.985;
const RIM_T = 0.045;
const HALF_W = 0.745;			// 1.49 m wide
const FRONT_Z = - 0.20;			// rim front (behind the display)
const LENGTH = 1.56;			// case length (F150G 1555 mm)

// display: bezel 1343 x 320 mm leaning back 27° (117° to the keys), standing on the key-back
// felt like the upright's screen
const SCREEN_W = 1.343, SCREEN_H = 0.32, SCREEN_T = 0.03;
const SCREEN_LEAN = THREE.MathUtils.degToRad( 27 );
const SCREEN_BOTTOM = v3( 0, 0.737, - 0.150 );
// the lid's front edge: just behind the display's top (it stands above the rim top)
const LID_FRONT_Z = SCREEN_BOTTOM.z - ( SCREEN_H * Math.sin( SCREEN_LEAN ) + SCREEN_T * Math.cos( SCREEN_LEAN ) ) - 0.008;
// side profile after USD834638 Figs. 4/5: flat key blocks level with the white keys, then side
// boards whose front edge follows the display's lean up to its top, a little above the rim
// top; the straight rim sides start only behind the display
const KEY_BLOCK_TOP = 0.722;					// white key top 0.720
const SIDE_STEP = 0.014;						// side boards stand this much above the key blocks
const KEY_FRONT_Z = 0.022;						// front of the key slip and key blocks
const SCREEN_TOP_Y = SCREEN_BOTTOM.y + SCREEN_H * Math.cos( SCREEN_LEAN );
const screenFrontZ = y => SCREEN_BOTTOM.z - ( y - SCREEN_BOTTOM.y ) * Math.tan( SCREEN_LEAN );
const RIM_START = LID_FRONT_Z;				// front of the straight rim sides
// inside the shallower rim: soundboard, plate (strings and dampers stay below the rim top)
const SOUNDBOARD_Y = RIM_BOTTOM + 0.05;
const PLATE_Y = RIM_BOTTOM + 0.10;			// top of the plate floor (the plate, the frame and the strings 5 cm lower than they were)
const PLATE_RIB = 0.043;						// the tenor / treble strings' height over the plate floor, less 7 mm
const STRING_Y = PLATE_RIB + 0.007;				// tenor / treble strings above the floor at the pins (0.004 lower at the hitch pins)
const BASS_Y = STRING_Y + 0.018;				// overstrung bass, above the tenor
// the lid's front flap: hinged to the main lid along FOLD_Z, folded back onto it when open
// (Fig. 5 shows it lying on the lid from z = -0.65 to -0.99)
const FOLD_Z = - 0.65;
const SCREEN_EDGE_X = SCREEN_W / 2;			// side boards between the display's ends and the case sides

const v2 = ( x, y ) => new THREE.Vector2( x, y );

// the plate's plan, after Footages.local/ref/grand-piano-interior-illustration-white-35943134.jpg mapped onto this
// case (x 2.97 mm/px from the spine, z 2.47 mm/px back from the front; the case's own outline kept):
// - its solid part, a crescent along the tail and the bentside: PLATE_EDGE its inner edge, (x, z) from the bass's
//   hitch at the tail round to the bentside's front (x increasing); the strings' hitch pins on a rail just behind it
//   (HITCH_BACK), its top HITCH_RAIL above the floor; the holes in it (x, z, radius), eight, small to large
// - its frame over the strings (FRAME_Y: its beams' bottom and top above the floor; the bass strings at BASS_Y below,
//   the closed lid 9 mm above): across the front, behind the display, a plate pierced by four bays, its back edge
//   in two halves (FRAME_Z, FRONT_RIGHT), the first two bays either side of a gusset (GUSSET: its apex at the back); an X over the bass
//   and the tenor, its node X_NODE, its legs from the first bay's back corner and the gusset, out to the tail; a
//   strut from the gusset to the crescent; the treble's two struts at FRAME_V (in the gaps between the bays),
//   straight back to the crescent and sweeping out to the bentside
// (the edge one smooth S, a single cubic Bezier: flat along the bass's end at the tail, falling through the tenor,
// flat again along the treble's; fitted to the illustration's edge, within 18 mm)
const PLATE_EDGE = new THREE.CubicBezierCurve( v2( - 0.463, - 1.30 ), v2( 0.2488, - 1.2384 ), v2( - 0.301, - 0.5868 ), v2( 0.68, - 0.535 ) ).getSpacedPoints( 120 );
/** z of a polyline of (x, z) increasing in x, at x (its ends' z beyond them). */
function polyZ( e, x ) {

	if ( x <= e[ 0 ].x ) return e[ 0 ].y;
	for ( let i = 1; i < e.length; ++ i ) if ( x <= e[ i ].x ) return e[ i - 1 ].y + ( x - e[ i - 1 ].x ) / ( e[ i ].x - e[ i - 1 ].x ) * ( e[ i ].y - e[ i - 1 ].y );
	return e[ e.length - 1 ].y;

}
const plateEdgeZ = x => polyZ( PLATE_EDGE, x );
const HITCH_BACK = 0.025, HITCH_RAIL = 0.03;
const PIN_FRONT = - 0.333;
// the bass's strings: their dampers' x (the first and the last of BASS_COUNT, evenly between); the bass bridge's opening
// in the crescent: a slot along the S edge, from SLOT[ 0 ] to SLOT[ 1 ] behind it (between the tenor's hitch rail's
// foot and the bass's), across the bass strings, SLOT_END on past the end ones (less where a strut's foot is near)
const BASS_COUNT = 29, BASS_DX = [ - 0.575, - 0.238 ];
const SLOT = [ 0.049, 0.095 ], SLOT_END = 0.014;		// (z: the tuning pins' front row, in the front plate's bays)
/** z of a string's hitch pin (the centre of the rail along the crescent's edge) at x. */
const hitchZ = x => plateEdgeZ( x ) - HITCH_BACK;
// the casting's rounded profiles (src/castdetail.js; u across their path, towards its left normal: the front
// for PLATE_EDGE's, the plate's inside for the rim's outline; v up from the plate's floor):
// - the S edge's bead: the floor's edge EDGE_BEAD wide, rounded over at the top (3 mm) and the bottom (1.5 mm)
// - the lip along the rim: rounded over on the rim's side (3 mm), a fillet (3 mm) up into strut 6 on its inner half
// - the hitch rail: 24 mm wide, HITCH_RAIL high, its top edges rounded (4 mm), filleted into the floor (5 mm)
const EDGE_BEAD = 0.004;
const EDGE_PROFILE = profile( [ [ - EDGE_BEAD, - 0.012 ], [ 0, - 0.012 ], [ 0, 0 ], [ - EDGE_BEAD, 0 ] ], [ 0, 0.0015, 0.003, 0 ] );
const LIP_PROFILE = profile( [ [ - 0.0003, - 0.0115 ], [ 0.012, - 0.0115 ], [ 0.012, 0.022 ], [ 0.007, 0.022 ], [ 0.007, 0.014 ], [ - 0.0003, 0.014 ] ], [ 0, 0, 0, 0, 0.003, 0.003 ] );
const RAIL_PROFILE = profile( [ [ - 0.017, - 0.0006 ], [ 0.017, - 0.0006 ], [ 0.012, - 0.0006 ], [ 0.012, HITCH_RAIL ], [ - 0.012, HITCH_RAIL ], [ - 0.012, - 0.0006 ] ], [ 0, 0, 0.005, 0.004, 0.004, 0.005 ] );
// (struts numbered by their lower ends, left to right: 1 the X's long leg, 2 the strut from the gusset parallel to
// it, 3 the X's other leg, 4 and 5 the treble's. One hole between the X's upper legs; two small ones close together
// by the rim between struts 1 and 2 (against 2), behind the bass's hitch rail; one against the rim between 2 and 4's
// sweep; two large between the treble struts' sweeps, two after the second's)
const PLATE_HOLES = [ [ - 0.383, - 1.407, 0.045 ], [ - 0.050, - 1.328, 0.024 ], [ 0.017, - 1.275, 0.026 ], [ 0.106, - 1.196, 0.0306 ],
	[ 0.22, - 0.94, 0.055 ], [ 0.31, - 0.81, 0.04 ], [ 0.489, - 0.74, 0.034 ], [ 0.575, - 0.70, 0.026 ] ];
const FRAME_Y = [ 0.074, 0.106 ];
const TREBLE_STRUT_ANGLE = [ 70, 90 ];		// struts 4 and 5 meet strut 6 at these angles (deg, on their right)
const RIM_STRUT_LOW = 0.025;
// the casting's fillets (m): the struts' feet into the floor (strut 6's smaller), the struts' ends into strut 6 and
// their roots at the front plate (plan), the X's crossing, the V of struts 2 and 3 behind the gusset
const BOLT_PITCH = 0.16;		// (m: the plate's hold-down bolts along the crescent)
const plateHoleCollars = [];		// (the holes' collars' outer radii as built: [ x, z, r ]; the bolts keep clear)
const STRUT_FOOT = 0.010, RIM_FOOT = 0.008, JOIN_FILLET = 0.016, X_FILLET = 0.02, GUSSET_FILLET = 0.03;		// strut 6's top at the tail, above the plate floor
const X_TAIL_R = v2( - 0.24, - 1.47 );		// (where the X's long leg, from the front plate's left end, meets the tail)
const FRAME_Z = - 0.465, GUSSET = v2( - 0.213, - 0.48 ), X_NODE = v2( - 0.39, - 1.05 ), FRAME_V = [ 0.083, 0.368 ];
// the front plate's back edge right of the first treble strut: 20 mm forward of FRAME_Z there, sloping back to the
// bentside (the illustration's 515 -> 505 px)
const FRONT_RIGHT = [ [ 0.083, - 0.445 ], [ 0.13, - 0.446 ], [ 0.22, - 0.450 ], [ 0.31, - 0.455 ], [ 0.48, - 0.458 ], [ 0.60, - 0.462 ], [ 0.68, - 0.468 ] ].map( ( [ x, z ] ) => v2( x, z ) );
/** z of the front plate's back edge at x (its left half straight, its right half FRONT_RIGHT). */
const frontBackZ = x => x > FRONT_RIGHT[ 0 ].x ? polyZ( FRONT_RIGHT, x ) : FRAME_Z;
// the floor plate under it (over the pin block, under the strings): its back edge a curve rising from the spine
// (FLOOR_LEFT) and bowing back, a quadratic meeting the front plate's right half at the first treble strut along
// its tangent, then that half's own edge to the bentside
const FLOOR_LEFT = v2( - 0.68, - 0.36 );

const mesh = ( geo, mat, cast = true ) => {

	const m = new THREE.Mesh( geo, mat );
	m.castShadow = cast && ! [ mat ].flat().some( x => x?.userData?.clear );		// (clear parts: no shadow; src/clearglass.js)
	m.receiveShadow = true;
	return m;

};

// the rim's plan outline, measured on the patent's bottom view (Fig. 7, 956 px/m): the spine
// straight back to z = -1.2, the tail apex at x = -0.36, and a full bentside, still 0.66 m out
// at z = -0.86 and 0.44 m at z = -0.99, with the S-bend around z = -1.2 to -1.35
const RIM_CURVE = [
	[ - 0.745, - 1.10 ], [ - 0.745, - 1.20 ], [ - 0.735, - 1.27 ], [ - 0.705, - 1.36 ], [ - 0.657, - 1.441 ],
	[ - 0.583, - 1.509 ], [ - 0.510, - 1.541 ], [ - 0.437, - 1.553 ], [ - 0.364, - 1.556 ], [ - 0.291, - 1.550 ],
	[ - 0.217, - 1.539 ], [ - 0.144, - 1.525 ], [ - 0.071, - 1.505 ], [ 0.002, - 1.475 ], [ 0.076, - 1.428 ],
	[ 0.149, - 1.357 ], [ 0.190, - 1.300 ], [ 0.225, - 1.240 ], [ 0.265, - 1.180 ], [ 0.300, - 1.135 ],
	[ 0.368, - 1.055 ], [ 0.444, - 0.993 ], [ 0.515, - 0.957 ], [ 0.588, - 0.907 ], [ 0.661, - 0.857 ],
	[ 0.703, - 0.804 ], [ 0.733, - 0.740 ], [ 0.745, - 0.66 ], [ 0.745, - 0.58 ],
];

/** Open polyline of the rim in (x, z) running from front-left round the tail to front-right. */
function rimPath() {

	const p = new THREE.Path();
	p.moveTo( - HALF_W, RIM_START );
	p.lineTo( - HALF_W, RIM_CURVE[ 0 ][ 1 ] );
	p.splineThru( RIM_CURVE.slice( 1 ).map( ( [ x, z ] ) => new THREE.Vector2( x, z ) ) );
	p.lineTo( HALF_W, RIM_START );
	return fairOutline( p, 0.045 ).getSpacedPoints( 240 );

}

/**
 * The path faired: its curvature (the turn per step, densely sampled) smoothed by a gaussian `sigma` m long and
 * the outline integrated again from its start (the total turn kept: the straights keep their directions; the
 * few mm it ends off its end spread along it), kept within the case's width. The spline through the measured
 * points wobbled in curvature (+-4.6 deg per 16 mm step within a few cm): bands in the lacquer's reflections.
 * At 4.5 cm it stays within ~5 mm of the measured outline.
 */
function fairOutline( path, sigma ) {

	const M = 2400, d = path.getSpacedPoints( M ), ds = path.getLength() / M;
	const head = [], turn = [];
	for ( let i = 0; i < M; ++ i ) head.push( Math.atan2( d[ i + 1 ].y - d[ i ].y, d[ i + 1 ].x - d[ i ].x ) );
	for ( let i = 1; i < M; ++ i ) { const t = head[ i ] - head[ i - 1 ]; turn.push( Math.atan2( Math.sin( t ), Math.cos( t ) ) ); }
	const sd = sigma / ds, R = Math.ceil( 3 * sd ), w = [];
	for ( let k = - R; k <= R; ++ k ) w.push( Math.exp( - 0.5 * ( k / sd ) ** 2 ) );
	const ws = w.reduce( ( a, b ) => a + b );
	const sm = turn.map( ( _, i ) => { let a = 0; for ( let k = - R; k <= R; ++ k ) { const j = i + k; if ( j >= 0 && j < turn.length ) a += w[ k + R ] * turn[ j ]; } return a / ws; } );
	const tot = turn.reduce( ( a, b ) => a + b ), tots = sm.reduce( ( a, b ) => a + b );
	const q = [ d[ 0 ].clone() ];
	let h = head[ 0 ];
	for ( let i = 0; i < M; ++ i ) {

		if ( i > 0 ) h += sm[ i - 1 ] * tot / tots;
		q.push( q[ i ].clone().add( new THREE.Vector2( Math.cos( h ), Math.sin( h ) ).multiplyScalar( ds ) ) );

	}
	const err = d[ M ].clone().sub( q[ M ] );
	const out = new THREE.Path();
	for ( let i = 0; i <= M; ++ i ) {

		const v = q[ i ].addScaledVector( err, i / M );
		v.x = THREE.MathUtils.clamp( v.x, - HALF_W, HALF_W );
		if ( i === 0 ) out.moveTo( v.x, v.y ); else out.lineTo( v.x, v.y );

	}
	return out;

}

function offsetPolyline( pts, d ) {

	// offset towards the inside (the outline runs clockwise seen from above in (x, z))
	const out = [];
	for ( let i = 0; i < pts.length; ++ i ) {

		const a = pts[ Math.max( 0, i - 1 ) ], b = pts[ Math.min( pts.length - 1, i + 1 ) ];
		const t = new THREE.Vector2().subVectors( b, a ).normalize();
		const n = new THREE.Vector2( - t.y, t.x );
		out.push( pts[ i ].clone().addScaledVector( n, d ) );

	}

	return out;

}

/** Shape (x, z) -> extruded between y0 and y1. Shape coordinates are (x, z). */
function extrudeXZ( shape, y0, y1, bevel = 0.003 ) {

	// (smooth along the outline: three's own normals are per face, and on lacquer the rim's 240 facets showed as
	// vertical bands in its reflections; the caps flat, the bevel rounded, the outline's real corners kept)
	const g = extrudeTop( shape, y0, y1, { bevel, curveSegments: 64 } ), pos = g.attributes.position;
	const ez = new Float32Array( pos.count );
	for ( let i = 0; i < pos.count; ++ i ) ez[ i ] = pos.getY( i ) - y0;
	return bevelNormals( g, ez, y1 - y0, Math.min( bevel, ( y1 - y0 ) / 2 ) );

}

/**
 * Vertical ribbon along a polyline in (x, z) from y0 to y1, facing the polyline's left side
 * (the inside of the rim); UVs in metres (u along the polyline, v up) for the wood textures.
 */
function rimVeneer( pts, y0, y1 ) {

	// each point's normal across the polyline (its neighbours' chord), smooth along it; hard where it turns more
	// than 30° (the corners at the front ends): there each segment keeps its own
	const seg = i => new THREE.Vector2().subVectors( pts[ i + 1 ], pts[ i ] ).normalize();
	const across = t => new THREE.Vector2( t.y, - t.x );		// (to the polyline's left in (x, z): the inside)
	const nrm = ( i, side ) => {		// point i's normal for the segment on `side` (-1: before it, +1: after it)

		const own = seg( side < 0 ? i - 1 : i ), other = side < 0 ? ( i + 1 < pts.length ? seg( i ) : null ) : ( i > 0 ? seg( i - 1 ) : null );
		const t = other && own.dot( other ) > Math.cos( Math.PI / 6 ) ? own.clone().add( other ).normalize() : own;
		return across( t );

	};
	const pos = [], uv = [], nor = [];
	let u = 0;
	for ( let i = 1; i < pts.length; ++ i ) {

		const a = pts[ i - 1 ], b = pts[ i ];
		const du = a.distanceTo( b ), na = nrm( i - 1, 1 ), nb = nrm( i, - 1 );
		const quad = [ [ a, y0, u, na ], [ b, y0, u + du, nb ], [ b, y1, u + du, nb ], [ a, y0, u, na ], [ b, y1, u + du, nb ], [ a, y1, u, na ] ];
		for ( const [ p, y, uu, n ] of quad ) {

			pos.push( p.x, y, p.y );
			uv.push( uu, y );
			nor.push( n.x, 0, n.y );

		}

		u += du;

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	// (the side the faces show, as the winding has it: the normals turned to match)
	g.computeVertexNormals();
	const fn = g.attributes.normal, flip = fn.getX( 0 ) * nor[ 0 ] + fn.getZ( 0 ) * nor[ 2 ] < 0 ? - 1 : 1;
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor.map( v => v * flip ), 3 ) );
	return g;

}

/** Outer x of the outline at a given z on the right (bentside) side. */
function bentsideX( pts, z ) {

	let best = - Infinity;
	for ( let i = 1; i < pts.length; ++ i ) {

		const a = pts[ i - 1 ], b = pts[ i ];
		if ( ( a.y - z ) * ( b.y - z ) <= 0 && a.y !== b.y ) {

			const t = ( z - a.y ) / ( b.y - a.y );
			best = Math.max( best, a.x + ( b.x - a.x ) * t );

		}

	}

	return best;

}

/** A beam from a to b (as geometry.js beam: w across, h high), its long edges and ends chamfered (r). */
function chamferBeam( a, b, w, h, r ) {

	const len = a.distanceTo( b );
	const geo = new RoundedBoxGeometry( w, h, len, 1, Math.min( r, w / 2 - 1e-4, h / 2 - 1e-4 ) );
	geo.applyMatrix4( new THREE.Matrix4().lookAt( a, b, Math.abs( b.x - a.x ) + Math.abs( b.z - a.z ) < 1e-6 ? new THREE.Vector3( 0, 0, 1 ) : new THREE.Vector3( 0, 1, 0 ) ) );
	geo.translate( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2, ( a.z + b.z ) / 2 );
	return geo;

}

/**
 * A box tapering linearly from (w0, d0) at y0 to (w1, d1) at y1, centred on (x, z), its edges rounded
 * (radius r at the top, scaled with the section below: 3 segments, the normals the surface's own), so
 * the lacquer catches a thin line of light along each.
 */
function taperedBox( x, z, y0, y1, w0, d0, w1, d1, r = 0.004 ) {

	const g = new RoundedBoxGeometry( w1, y1 - y0, d1, 3, r );
	const p = g.attributes.position, n = g.attributes.normal, h = y1 - y0;
	for ( let i = 0; i < p.count; ++ i ) {

		// the section at height t scaled by (sx, sz) of the top's: a point (px, py, pz) -> (sx px, y, sz pz);
		// its normal by the inverse transpose of that map (sx, sz vary with y: a y term too)
		const t = p.getY( i ) / h + 0.5;
		const sx = THREE.MathUtils.lerp( w0 / w1, 1, t ), sz = THREE.MathUtils.lerp( d0 / d1, 1, t );
		const dsx = ( 1 - w0 / w1 ) / h, dsz = ( 1 - d0 / d1 ) / h;
		const px = p.getX( i ), pz = p.getZ( i );
		const nx = n.getX( i ) / sx, nz = n.getZ( i ) / sz;
		const ny = n.getY( i ) - nx * px * dsx - nz * pz * dsz;
		const l = Math.hypot( nx, ny, nz );
		n.setXYZ( i, nx / l, ny / l, nz / l );
		p.setXYZ( i, x + px * sx, THREE.MathUtils.lerp( y0, y1, t ), z + pz * sz );

	}

	return boxProjectUV( g );

}

/**
 * Normals for an ExtrudeGeometry with a bevel (non-indexed; `ez`: each vertex's extrusion coordinate
 * before any transform, the caps at 0 and `len`, the bevel `bt` deep at each end): the caps flat (their
 * face's), the walls smooth along the outline where it bends gently (under 30°: the leg's flare) and hard at
 * its corners, the bevel's rings blending from the cap's normal to the wall's: a rounded edge, shaded so.
 * The geometry in its final place (mirrored, tapered): the normals from its faces as they are.
 */
function bevelNormals( g, ez, len, bt ) {

	const pos = g.attributes.position, N = pos.count / 3, eps = 1e-5;
	const fn = [], kind = [];		// per triangle: its normal; 'cap' | 'wall' | 'bevel'
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	for ( let f = 0; f < N; ++ f ) {

		a.fromBufferAttribute( pos, 3 * f ); b.fromBufferAttribute( pos, 3 * f + 1 ); c.fromBufferAttribute( pos, 3 * f + 2 );
		const v = new THREE.Vector3().subVectors( c, b ).cross( a.sub( b ) );
		fn.push( v.lengthSq() > 0 ? v.normalize() : v );
		const z = [ ez[ 3 * f ], ez[ 3 * f + 1 ], ez[ 3 * f + 2 ] ], lo = Math.min( ...z ), hi = Math.max( ...z );
		kind.push( hi - lo < eps ? 'cap' : ( lo > bt - eps && hi < len - bt + eps ) ? 'wall' : 'bevel' );

	}
	// the triangles at each position (welded by value)
	const key = i => `${ Math.round( pos.getX( i ) * 1e6 ) },${ Math.round( pos.getY( i ) * 1e6 ) },${ Math.round( pos.getZ( i ) * 1e6 ) }`;
	const at = new Map();
	for ( let i = 0; i < pos.count; ++ i ) { const k = key( i ); if ( ! at.has( k ) ) at.set( k, [] ); at.get( k ).push( Math.floor( i / 3 ) ); }
	// a corner's normal: its face's, averaged with the faces of `kinds` at its position within `cos` of it
	const smooth = ( i, kinds, cos ) => {

		const f = Math.floor( i / 3 ), s = new THREE.Vector3();
		for ( const o of at.get( key( i ) ) ) if ( kinds.includes( kind[ o ] ) && fn[ o ].dot( fn[ f ] ) > cos ) s.add( fn[ o ] );
		return s.lengthSq() > 0 ? s.normalize() : fn[ f ].clone();

	};
	const COS30 = Math.cos( Math.PI / 6 ), COS60 = 0.5;
	const out = new Float32Array( pos.count * 3 );
	for ( let i = 0; i < pos.count; ++ i ) {

		const f = Math.floor( i / 3 );
		let n;
		if ( kind[ f ] === 'cap' ) n = fn[ f ];
		else if ( kind[ f ] === 'wall' ) n = smooth( i, [ 'wall' ], COS30 );
		else {

			// a bevel's corner on the cap's edge or the wall's: that one's normal (the nearest such face's, so a
			// corner of the outline takes its own side's); within the bevel: the rings' facets averaged
			let best = null, bestDot = COS60;
			for ( const o of at.get( key( i ) ) ) {

				if ( kind[ o ] === 'bevel' ) continue;
				const d = fn[ o ].dot( fn[ f ] );
				if ( d > bestDot ) { bestDot = d; best = o; }

			}
			if ( best === null ) n = smooth( i, [ 'bevel' ], COS60 );
			else if ( kind[ best ] === 'cap' ) n = fn[ best ];
			else {

				// the wall's smoothed normal at this position (as its own corner there computes it)
				const tri = 3 * best;
				let j = tri;
				for ( let k = 0; k < 3; ++ k ) if ( key( tri + k ) === key( i ) ) j = tri + k;
				n = smooth( j, [ 'wall' ], COS30 );

			}

		}
		out[ 3 * i ] = n.x; out[ 3 * i + 1 ] = n.y; out[ 3 * i + 2 ] = n.z;

	}
	g.setAttribute( 'normal', new THREE.BufferAttribute( out, 3 ) );
	return g;

}

/** Small dark perforated-metal texture (speaker grille). */
function grilleMaterial() {

	const c = document.createElement( 'canvas' );
	c.width = c.height = 64;
	const g = c.getContext( '2d' );
	g.fillStyle = '#3a3b3e';
	g.fillRect( 0, 0, 64, 64 );
	g.fillStyle = '#050506';
	for ( const [ x, y ] of [ [ 16, 16 ], [ 48, 16 ], [ 0, 48 ], [ 32, 48 ], [ 64, 48 ] ] ) {

		g.beginPath();
		g.arc( x, y, 9, 0, Math.PI * 2 );
		g.fill();

	}

	const map = new THREE.CanvasTexture( c );
	map.colorSpace = THREE.SRGBColorSpace;
	map.wrapS = map.wrapT = THREE.RepeatWrapping;
	map.anisotropy = 4;
	return new THREE.MeshPhysicalMaterial( { map, metalness: 0.7, roughness: 0.55 } );

}

export function buildGrand( M, { lidAngle = 34 } = {} ) {

	// the case's parts, each its own material when the set has one (the crystal grand: clear rim, lid and
	// prop, smoked legs, white lacquer elsewhere), else the case's
	const RIM = M.rim ?? M.case, LID = M.lid ?? M.case, PROP = M.prop ?? M.case, LEGS = M.legs ?? M.case, BASE = M.caseBase ?? M.case, STRETCHER = M.stretcher ?? LEGS;
	const group = new THREE.Group();
	const dampers = new Map();
	const hammers = new Map(), hammerRack = new THREE.Group();		// (the soft pedal shifts the rack with the keyboard)
	hammerRack.name = 'hammerRack';
	const pedals = {};
	group.name = 'grand';

	const outer = rimPath();
	const inner = offsetPolyline( outer, RIM_T );

	// --- rim ------------------------------------------------------------
	{

		// the shape's y axis maps to world z
		const s = new THREE.Shape( outer );
		for ( let i = inner.length - 1; i >= 0; -- i ) s.lineTo( inner[ i ].x, inner[ i ].y );
		s.closePath();
		group.add( mesh( extrudeXZ( s, RIM_BOTTOM, RIM_TOP, 0.004 ), RIM ) );

		// bottom board (on to the front of the case, under the keybed), and the deeper front
		// section holding keybed and action, down to FRONT_BOTTOM back to z = -0.72 (Fig. 5)
		const closed = new THREE.Shape( [ v2( - HALF_W, FRONT_Z ), ...outer, v2( HALF_W, FRONT_Z ) ] );
		closed.closePath();
		group.add( mesh( extrudeXZ( closed, RIM_BOTTOM - 0.03, RIM_BOTTOM, 0.006 ), BASE ) );
		const front = new THREE.Shape( [ v2( - HALF_W, FRONT_Z ), ...outer.map( p => v2( p.x, Math.max( p.y, FRONT_SECTION_Z ) ) ), v2( HALF_W, FRONT_Z ) ] );
		front.closePath();
		group.add( mesh( extrudeXZ( front, FRONT_BOTTOM, RIM_BOTTOM - 0.03, 0.006 ), BASE ) );

		const sb = new THREE.Shape( inner );
		sb.closePath();
		// (its grain diagonal, as a grand's: from the treble's front towards the bass's tail, along ( 1, 1 ) in plan;
		// the texture's u along the grain)
		const board = extrudeXZ( sb, SOUNDBOARD_Y - 0.01, SOUNDBOARD_Y, 0 ), bp = board.attributes.position, buv = board.attributes.uv;
		for ( let i = 0; i < bp.count; ++ i ) buv.setXY( i, ( bp.getX( i ) + bp.getZ( i ) ) * Math.SQRT1_2, ( bp.getZ( i ) - bp.getX( i ) ) * Math.SQRT1_2 );
		group.add( mesh( board, M.spruce ) );

		// front belly rail closing the case under the display (kept below its face: at 0.84 m its
		// top edge stood out of the screen as a ridge across the middle)
		group.add( mesh( woodBox( v3( - HALF_W, RIM_BOTTOM, FRONT_Z - RIM_T ), v3( HALF_W, 0.78, FRONT_Z ), { noUV: true } ), BASE ) );

		// side boards: one board per side between the display's end and the case side (Fig. 6:
		// a strip the display abuts), from the front of the keyboard back to the rim. Its top
		// edge (Figs. 1, 5) runs forward just above the key blocks to a rounded front end, and
		// back along the display's lean up to its top, a little above the rim. Profile in (z, y),
		// extruded across x
		const yLow = KEY_BLOCK_TOP + SIDE_STEP, R = 0.014, zF = KEY_FRONT_Z + 0.002;
		const zFoot = screenFrontZ( yLow ) + 0.002, zTop = screenFrontZ( SCREEN_TOP_Y ) + 0.002;
		const pts = [ v2( zF, FRONT_BOTTOM ) ];
		for ( let i = 0; i <= 6; ++ i ) {

			const a = i / 6 * Math.PI / 2;
			pts.push( v2( zF - R + R * Math.cos( a ), yLow - R + R * Math.sin( a ) ) );

		}

		pts.push( v2( zFoot, yLow ), v2( zTop, SCREEN_TOP_Y ), v2( RIM_START, SCREEN_TOP_Y ), v2( RIM_START, FRONT_BOTTOM ) );
		const prof = new THREE.Shape( pts );
		for ( const sx of [ - 1, 1 ] ) {

			const w = HALF_W - SCREEN_EDGE_X;
			const g = new THREE.ExtrudeGeometry( prof, { depth: w, bevelEnabled: false } );
			// shape (z, y) on the xy plane, extruded along +z -> rotate so x <- extrusion
			g.rotateY( - Math.PI / 2 );			// shape x -> world z, extrusion -> world -x
			g.translate( sx < 0 ? - HALF_W + w : HALF_W, 0, 0 );
			group.add( mesh( boxProjectUV( g.toNonIndexed() ), M.case ) );

		}

		// inner rim veneer (the photos show warm wood inside the lacquered case), from the
		// soundboard up to just below the rim top
		if ( M.rimInner !== null ) group.add( mesh( rimVeneer( offsetPolyline( inner, 0.0015 ), SOUNDBOARD_Y, RIM_TOP - 0.012 ), M.rimInner ?? M.case, false ) );		// (null: none, the crystal grand's rim is clear)

	}

	// --- plate ------------------------------------------------------------
	// (its plan: PLATE_EDGE and the rest, above.) Under the strings the solid crescent along the tail and the
	// bentside, a thin floor with a lip against the rim, the hitch rail along its inner edge, its holes each in a
	// raised collar; a strip of floor across the front (the pin block's). Over the strings the frame, box beams
	// flanged top and bottom, standing on feet where they meet the plate. Elsewhere the soundboard shows
	const plateY = PLATE_Y;
	const frameLines = [];		// (the frame's beams, plan: [ a, b, width ]; the dampers keep clear of them)
	const struts = [];		// (the frame's struts, plan polylines: built once the strings are laid out, see below)
	let bassDir;		// (plan: the X's long leg's direction, back; the strut from the gusset's and the bass strings')
	let floorBack;		// (plan: the floor plate's back edge, x increasing: the tuning pins stand in front of it)
	let bassSlot;		// (the bass bridge's opening: { midZ, path, half }, for src/soundboard.js)
	{

		const parts = [];
		const [ fy0, fy1 ] = FRAME_Y;
		const outline = offsetPolyline( inner, 0.02 ), lim = offsetPolyline( inner, 0.03 );
		const inLim = p => {

			let c = false;
			for ( let i = 0, j = lim.length - 1; i < lim.length; j = i ++ ) {

				const pi = lim[ i ], pj = lim[ j ];
				if ( ( pi.y > p.y ) !== ( pj.y > p.y ) && p.x < ( pj.x - pi.x ) * ( p.y - pi.y ) / ( pj.y - pi.y ) + pi.x ) c = ! c;

			}

			return c;

		};
		// from a towards b (and on past it) to the last point inside the rim's lip
		const toRim = ( a, b ) => {

			let end = a.clone();
			for ( let k = 1; k <= 600; ++ k ) {

				const p = a.clone().lerp( b, k / 400 );
				if ( ! inLim( p ) ) break;
				end = p;

			}

			return end;

		};
		// the crescent: the rim's side behind the edge and right of the X's upper left leg, then the edge back
		const leg = [ X_NODE, v2( - 0.507, - 1.42 ) ];
		const side = p => ( leg[ 1 ].x - leg[ 0 ].x ) * ( p.y - leg[ 0 ].y ) - ( leg[ 1 ].y - leg[ 0 ].y ) * ( p.x - leg[ 0 ].x );
		const right = Math.sign( side( v2( 0, - 1.45 ) ) );
		const keep = outline.map( ( p, i ) => i ).filter( i => outline[ i ].y < plateEdgeZ( outline[ i ].x ) && Math.sign( side( outline[ i ] ) ) === right );
		// (its S edge EDGE_BEAD back: the bead along the edge rounds it over)
		const crescent = new THREE.Shape( [ ...keep.map( i => outline[ i ] ), ...offsetPolyline( PLATE_EDGE, - EDGE_BEAD ).reverse() ].filter( ( p, k, a ) => k === 0 || p.distanceTo( a[ k - 1 ] ) > 0.004 ) );
		// (its holes: cut below, as wide as each one's dish, once the struts are laid out)

		// the S edge's bead: the floor's edge rounded over (top and bottom), its top flush with the floor
		parts.push( sweep( PLATE_EDGE, () => EDGE_PROFILE, { y: plateY, closed: true } ) );
		// its lip against the rim: rounded over on the rim's side, a fillet up into strut 6 (which stands on its
		// inner half) on the other
		parts.push( sweep( keep.map( i => outline[ i ] ), () => LIP_PROFILE, { y: plateY, closed: true } ) );

		// the hitch rail along the edge: every string's hitch pins; filleted into the floor, its top rounded
		parts.push( sweep( offsetPolyline( PLATE_EDGE, - HITCH_BACK ), () => RAIL_PROFILE, { y: plateY, closed: true } ) );

		// the front strip (under the pin block's cover, back under the front bar)
		const xS = HALF_W - RIM_T - 0.02;
		// the floor plate across the front (under the pin block's cover, back to its curved edge: FLOOR_LEFT)
		{

			const V0 = FRONT_RIGHT[ 0 ], slope = ( FRONT_RIGHT[ 1 ].y - V0.y ) / ( FRONT_RIGHT[ 1 ].x - V0.x );
			const cx = ( FLOOR_LEFT.x + V0.x ) / 2, c = v2( cx, V0.y + slope * ( cx - V0.x ) );		// (on the right half's tangent: no kink)
			const left = new THREE.QuadraticBezierCurve( FLOOR_LEFT.clone().setX( - xS ), c, V0 ).getPoints( 24 );
			const right = FRONT_RIGHT.slice( 1 ).map( p => v2( Math.min( p.x, xS ), p.y ) );
			floorBack = [ ...left, ...right ];
			parts.push( extrudeXZ( new THREE.Shape( [ v2( - xS, - 0.33 ), v2( xS, - 0.33 ), ...right.reverse(), ...left.reverse() ] ), plateY - 0.012, plateY, 0.002 ) );

		}

		// a strut of the frame: a plan polyline, one width (its height along it: after the strings, below); a node,
		// a round boss the beams' height
		const strut = ( pts, rim = false, w = 0.014 ) => {

			for ( let i = 0; i + 1 < pts.length; ++ i ) frameLines.push( [ pts[ i ].clone(), pts[ i + 1 ].clone(), w ] );
			struts.push( { pts, rim, w } );

		};
		const node = ( p, r ) => parts.push( new THREE.CylinderGeometry( r, r, fy1 - fy0, 32 ).translate( p.x, plateY + ( fy0 + fy1 ) / 2, p.y ) );

		// the front plate over the pin block and the dampers (above them: its 12 mm deep top at the beams'), one
		// piece pierced by four bays (the illustration's: Footages.local/ref/grand-piano-interior-illustration-white-
		// 35943134.jpg): its back edge in two halves meeting at the first treble strut out of line, the left
		// straight (FRAME_Z) with the gusset's apex standing out of it, the right 20 mm further forward there and
		// sloping back towards the bentside (FRONT_RIGHT); its left side slanting with the X's leg; the gusset, the
		// plate between the first two bays, widening to the front. On posts behind the dampers
		const RING_Y = [ 0.094, fy1 ], zF = - 0.312;		// (zF: the display's back 5 mm in front of its top edge)
		// a polygon's outline with its corners rounded (radius r), as a Shape or a Path
		const rounded = ( pts, r, P ) => {

			const n = pts.length;
			for ( let i = 0; i < n; ++ i ) {

				const p = pts[ i ], a = pts[ ( i + n - 1 ) % n ], b = pts[ ( i + 1 ) % n ];
				const p0 = p.clone().addScaledVector( new THREE.Vector2().subVectors( a, p ).normalize(), r );
				const p1 = p.clone().addScaledVector( new THREE.Vector2().subVectors( b, p ).normalize(), r );
				if ( i === 0 ) P.moveTo( p0.x, p0.y ); else P.lineTo( p0.x, p0.y );
				P.quadraticCurveTo( p.x, p.y, p1.x, p1.y );

			}

			P.closePath();
			return P;

		};
		const V0 = FRAME_V[ 0 ], xLf = - xS, B = 0.014, G = 0.012;		// (B: the border; G: half a divider)
		// strut 1 from the front plate's front-left corner (on its bottom beam) straight to the X's node; the plate's
		// left side along it
		const S1 = v2( xLf + 0.012, zF - 0.008 ), u1 = new THREE.Vector2().subVectors( X_NODE, S1 ).normalize();
		const xLb = xLf + ( FRAME_Z - zF ) * u1.x / u1.y;
		const front = rounded( [
			v2( xLf, zF ), v2( xLb, FRAME_Z ), v2( GUSSET.x - 0.019, FRAME_Z ), GUSSET.clone(), v2( GUSSET.x + 0.019, FRAME_Z ),
			v2( V0, FRAME_Z ), v2( V0, FRONT_RIGHT[ 0 ].y ), ...FRONT_RIGHT.filter( p => p.x > V0 ), v2( xS, zF ),
		], 0.008, new THREE.Shape() );
		const zFi = zF - B, zBi = FRAME_Z + B;
		const bays = [
			[ v2( xLb + 0.026, zBi ), v2( GUSSET.x - 0.027, zBi ), v2( GUSSET.x - 0.059, zFi ), v2( xLf + B + 0.02, zFi ) ],		// (its left side clear of strut 1)
			[ v2( GUSSET.x + 0.027, zBi ), v2( V0 - G, zBi ), v2( V0 - G, zFi ), v2( GUSSET.x + 0.061, zFi ) ],
			[ v2( V0 + G, frontBackZ( V0 + G ) + B ), v2( FRAME_V[ 1 ] - G, frontBackZ( FRAME_V[ 1 ] - G ) + B ), v2( FRAME_V[ 1 ] - G, zFi ), v2( V0 + G, zFi ) ],
			[ v2( FRAME_V[ 1 ] + G, frontBackZ( FRAME_V[ 1 ] + G ) + B ), v2( xS - B, frontBackZ( xS - B ) + B ), v2( xS - B, zFi ), v2( FRAME_V[ 1 ] + G, zFi ) ],
		];
		for ( const q of bays ) front.holes.push( rounded( q.slice().reverse(), 0.014, new THREE.Path() ) );
		parts.push( extrudeXZ( front, plateY + RING_Y[ 0 ], plateY + RING_Y[ 1 ], 0.003 ) );

		// the X: its lower legs from the bar's left end and the gusset to the node, its upper legs on to the tail
		const eB = toRim( X_NODE, leg[ 1 ] );		// (strut 3's end at the rim)
		strut( [ S1, X_NODE, toRim( X_NODE, X_TAIL_R ) ] );		// strut 1
		strut( [ GUSSET, X_NODE, eB ] );		// strut 3

		node( GUSSET, 0.016 );		// (the X's node: its four corners filleted instead, below)

		// the strut from the gusset to the rim, parallel to the X's long leg (from the front plate's
		// left end out to the tail): the bass's strings between the two
		const dA = new THREE.Vector2().subVectors( X_TAIL_R, S1 ).normalize();
		bassDir = dA.clone();
		// (on across the crescent to strut 6 at the rim)
		const sRim = toRim( GUSSET, GUSSET.clone().addScaledVector( dA, 2 ) );
		strut( [ GUSSET, sRim ] );		// strut 2

		// strut 6: along the rim, over the plate's lip, from the front plate's right end up the bentside and round
		// the tail to strut 3's end (the X's leg from the gusset): the frame's outer edge, standing on the plate its
		// full height (no strings under it), its top falling along the bentside from the beams' to RIM_STRUT_LOW at
		// the tail; struts 1 to 5 meet it at the rim
		{

			const line = offsetPolyline( inner, 0.034 ), near = p => line.reduce( ( b, q, k ) => q.distanceTo( p ) < line[ b ].distanceTo( p ) ? k : b, 0 );
			let kR = line.length - 1;
			while ( kR > 0 && line[ kR ].y > frontBackZ( line[ kR ].x ) - 0.004 ) -- kR;
			const k0 = near( eB ), pts = [ v2( line[ kR ].x, frontBackZ( line[ kR ].x ) ) ];
			for ( let k = kR; k >= k0; -- k ) pts.push( line[ k ] );
			strut( pts, true );		// (from the front)

		}

		// the treble's struts: straight back from the bar past the hitch rail, then a sweep (G2 at the join) out to
		// the bentside
		// the sweep: a clothoid (curvature rising linearly from 0 along it: no kink, no S, G2 with the straight part),
		// its length and total turn such that it reaches strut 6 at TREBLE_STRUT_ANGLE to it (on its right, towards
		// the front)
		const rimLine = offsetPolyline( inner, 0.034 );
		const rimFrame = q => {

			const k = rimLine.reduce( ( b, r, j ) => r.distanceTo( q ) < rimLine[ b ].distanceTo( q ) ? j : b, 0 );
			const u = new THREE.Vector2().subVectors( rimLine[ Math.min( rimLine.length - 1, k + 1 ) ], rimLine[ Math.max( 0, k - 1 ) ] ).normalize();
			if ( u.y < 0 ) u.negate();		// (along the rim towards the front)
			return u;

		};
		const clothoid = ( b0, L, turn, N = 60 ) => {

			const pts = [ b0.clone() ], ds = L / N;
			let phi = 0;		// (heading from -z towards +x)
			for ( let j = 0; j < N; ++ j ) {

				const s0 = ( j + 0.5 ) * ds;
				phi = turn * ( s0 / L ) ** 2;
				pts.push( pts[ j ].clone().add( v2( Math.sin( phi ), - Math.cos( phi ) ).multiplyScalar( ds ) ) );

			}

			return pts;

		};
		FRAME_V.forEach( ( x, which ) => {

			const b0 = v2( x, plateEdgeZ( x ) - HITCH_BACK - 0.03 );
			// (strut 4 from the bottom beam, over the divider between the second and third bays, as strut 1: no thin
			// joint at the back edge's step)
			const start = v2( x, x === FRAME_V[ 0 ] ? zF - 0.008 : frontBackZ( x ) + 0.008 );
			const alpha = THREE.MathUtils.degToRad( TREBLE_STRUT_ANGLE[ which ] );
			// the heading that meets the rim at alpha where the curve ends at q
			const turnAt = ( q, p0 ) => {

				const u = rimFrame( q ), n = v2( - u.y, u.x );
				if ( n.dot( new THREE.Vector2().subVectors( p0, q ) ) < 0 ) n.negate();		// (into the plate)
				const d = u.clone().multiplyScalar( Math.cos( alpha ) ).addScaledVector( n, Math.sin( alpha ) ).negate();		// (the strut's direction, out)
				return Math.atan2( d.x, - d.y );

			};
			let turn = 0.9, pts;
			for ( let it = 0; it < 6; ++ it ) {

				let lo = 0.05, hi = 1.5;
				for ( let k = 0; k < 40; ++ k ) {

					const mid = ( lo + hi ) / 2, e = clothoid( b0, mid, turn ).pop();
					if ( inLim( e ) ) lo = mid; else hi = mid;

				}

				pts = clothoid( b0, lo, turn );
				turn = turnAt( pts[ pts.length - 1 ], b0 );

			}

			strut( [ start, ...pts ] );		// struts 4 and 5

		} );

		// the frame's joins, filleted (plan, extruded): the X's crossing (its four corners), the V of struts 2 and 3
		// behind the gusset (the frame's height over the strings), struts 1, 4 and 5 leaving the front plate's back
		// edge (in the plate's thickness)
		{

			const h = 0.007;
			const corners = ( X, arms, R, y0, y1 ) => {

				const a = arms.map( d => d.clone().normalize() ).sort( ( p, q ) => Math.atan2( p.y, p.x ) - Math.atan2( q.y, q.x ) );
				for ( let i = 0; i < a.length; ++ i ) {

					const d1 = a[ i ], d2 = a[ ( i + 1 ) % a.length ];
					let th = Math.atan2( d2.y, d2.x ) - Math.atan2( d1.y, d1.x );
					if ( th <= 0 ) th += 2 * Math.PI;
					if ( th >= Math.PI - 0.05 ) continue;
					const C = X.clone().addScaledVector( d1.clone().add( d2 ).normalize(), h / Math.sin( th / 2 ) );
					const f = filletPlan( C, d1, d2, R );
					if ( f ) parts.push( extrudeXZ( new THREE.Shape( f ), y0, y1, 0.0025 ) );

				}

			};
			const sub = ( a, b ) => new THREE.Vector2().subVectors( a, b );
			const s1 = struts.find( t => t.pts[ 0 ].equals( S1 ) ).pts, s3 = struts.find( t => t.pts[ 0 ].equals( GUSSET ) && t.pts.length === 3 ).pts;
			corners( X_NODE, [ sub( S1, X_NODE ), sub( s1[ 2 ], X_NODE ), sub( GUSSET, X_NODE ), sub( s3[ 2 ], X_NODE ) ], X_FILLET, plateY + fy0, plateY + fy1 );
			corners( GUSSET, [ dA, sub( X_NODE, GUSSET ) ], GUSSET_FILLET, plateY + fy0, plateY + fy1 );
			// the roots at the front plate's back edge
			const roots = [ s1, ...struts.filter( t => ! t.rim && Math.abs( t.pts[ 0 ].x - FRAME_V[ 0 ] ) < 1e-6 || Math.abs( t.pts[ 0 ].x - FRAME_V[ 1 ] ) < 1e-6 ).map( t => t.pts ) ];
			for ( const pts of roots ) {

				const t = sub( pts[ 1 ], pts[ 0 ] ).normalize(), n = v2( - t.y, t.x ), len = pts[ 0 ].distanceTo( pts[ 1 ] );
				for ( const sg of [ - 1, 1 ] ) {

					const S = pts[ 0 ].clone().addScaledVector( n, sg * h );
					const behind = m => { const q = S.clone().addScaledVector( t, m ); return q.y < frontBackZ( q.x ); };
					if ( behind( 0 ) || ! behind( len ) ) continue;
					let lo = 0, hi = len;
					for ( let k = 0; k < 40; ++ k ) { const m = ( lo + hi ) / 2; if ( behind( m ) ) hi = m; else lo = m; }
					const C = S.clone().addScaledVector( t, lo );
					let e = v2( 1, ( frontBackZ( C.x + 0.004 ) - frontBackZ( C.x - 0.004 ) ) / 0.008 ).normalize();
					if ( Math.abs( C.x - FRAME_V[ 0 ] ) < 0.012 ) e = v2( 1, C.x > FRAME_V[ 0 ] ? ( FRONT_RIGHT[ 1 ].y - FRONT_RIGHT[ 0 ].y ) / ( FRONT_RIGHT[ 1 ].x - FRONT_RIGHT[ 0 ].x ) : 0 ).normalize();		// (by the step: its own half's line)
					if ( e.dot( n ) * sg < 0 ) e.negate();
					if ( pts === s1 && e.x < 0 ) continue;		// (strut 1's outer side: the plate's own slanted side)
					const f = filletPlan( C, t, e, JOIN_FILLET );
					if ( f ) parts.push( extrudeXZ( new THREE.Shape( f ), plateY + RING_Y[ 0 ], plateY + RING_Y[ 1 ], 0.002 ) );

				}

			}

		}

		const segD = ( q, a, b ) => { const e = new THREE.Vector2().subVectors( b, a ), u = THREE.MathUtils.clamp( new THREE.Vector2().subVectors( q, a ).dot( e ) / e.lengthSq(), 0, 1 ); return a.clone().addScaledVector( e, u ).distanceTo( q ); };
		const lineD = ( q, L ) => { let m = Infinity; for ( let i = 0; i + 1 < L.length; ++ i ) m = Math.min( m, segD( q, L[ i ], L[ i + 1 ] ) ); return m; };

		// the bass bridge's opening (as a real grand's: behind the tenor's hitch pins, under the bass's strings only): a
		// slot in the crescent along its edge (SLOT), across where the bass strings cross it, its corners rounded, a low
		// rounded lip round it; the bridge stands on an apron in it (src/soundboard.js)
		{

			const half = ( SLOT[ 1 ] - SLOT[ 0 ] ) / 2, mid = offsetPolyline( PLATE_EDGE, - ( SLOT[ 0 ] + SLOT[ 1 ] ) / 2 );
			const A = [ 0 ];
			for ( let i = 1; i < mid.length; ++ i ) A.push( A[ i - 1 ] + mid[ i ].distanceTo( mid[ i - 1 ] ) );
			const N = mid.map( ( p, i ) => { const t = new THREE.Vector2().subVectors( mid[ Math.min( mid.length - 1, i + 1 ) ], mid[ Math.max( 0, i - 1 ) ] ).normalize(); return v2( - t.y, t.x ); } );
			const at = ( a, u = 0 ) => {

				let i = 0;
				while ( i + 2 < mid.length && A[ i + 1 ] < a ) ++ i;
				const f = ( a - A[ i ] ) / ( A[ i + 1 ] - A[ i ] );
				return mid[ i ].clone().lerp( mid[ i + 1 ], f ).addScaledVector( N[ i ].clone().lerp( N[ i + 1 ], f ).normalize(), u );

			};
			const arcOf = q => { let best = 0, bd = Infinity; for ( let a = 0; a <= A.at( - 1 ); a += 0.001 ) { const d = at( a ).distanceTo( q ); if ( d < bd ) { bd = d; best = a; } } return best; };
			const midZ = x => polyZ( mid, x );
			// the first and the last bass string's crossing of its centre line (as laid out below: from their dampers along dA)
			const cross = [ 0, BASS_COUNT - 1 ].map( i => {

				const d = v2( BASS_DX[ 0 ] + ( BASS_DX[ 1 ] - BASS_DX[ 0 ] ) * i / ( BASS_COUNT - 1 ), 0 );
				d.y = frontBackZ( d.x ) - 0.022;
				let sc = 0;
				while ( d.y + dA.y * sc > midZ( d.x + dA.x * sc ) ) sc += 0.0005;
				return arcOf( d.addScaledVector( dA, sc ) );

			} );
			// (its ends clear of struts 1 and 2's feet)
			const s1 = struts.find( t => t.pts[ 0 ].equals( S1 ) ).pts, s2 = struts.find( t => t.pts[ 0 ].equals( GUSSET ) && t.pts.length === 2 ).pts;
			const footClear = ( a, pts ) => lineD( at( a ), pts ) > 0.007 + STRUT_FOOT + 0.004;
			let aL = cross[ 0 ] - SLOT_END, aR = cross[ 1 ] + SLOT_END;
			while ( aL < cross[ 0 ] - 0.004 && ! footClear( aL, s1 ) ) aL += 0.0005;
			while ( aR > cross[ 1 ] + 0.004 && ! footClear( aR, s2 ) ) aR -= 0.0005;
			const poly = ( h, a0, a1, r ) => {

				const pts = [], k0 = A.findIndex( a => a > a0 ), k1 = A.findLastIndex( a => a < a1 );
				const front = [ at( a0, h ), ...mid.slice( k0, k1 + 1 ).map( ( p, j ) => p.clone().addScaledVector( N[ k0 + j ], h ) ), at( a1, h ) ];
				const back = [ at( a0, - h ), ...mid.slice( k0, k1 + 1 ).map( ( p, j ) => p.clone().addScaledVector( N[ k0 + j ], - h ) ), at( a1, - h ) ];
				pts.push( ...front, ...back.reverse() );
				const radii = pts.map( ( p, j ) => ( j === 0 || j === front.length - 1 || j === front.length || j === pts.length - 1 ) ? r : 0 );
				return roundCorners( pts, radii, { closed: true, n: 5 } ).map( q => q.p );

			};
			crescent.holes.push( new THREE.Path( poly( half, aL, aR, 0.008 ) ) );
			const lip = new THREE.Shape( poly( half + 0.005, aL - 0.005, aR + 0.005, 0.013 ) );
			lip.holes.push( new THREE.Path( poly( half - 0.0005, aL + 0.0005, aR - 0.0005, 0.0075 ) ) );
			parts.push( extrudeXZ( lip, plateY - 0.0115, plateY + 0.003, 0.0015 ) );
			const k0 = A.findIndex( a => a > aL + 0.004 ), k1 = A.findLastIndex( a => a < aR - 0.004 );
			bassSlot = { midZ, half, path: [ at( aL + 0.004 ), ...mid.slice( k0, k1 + 1 ), at( aR - 0.004 ) ] };

		}

		// the holes, as cast (the middle hole of Footages.local/ref/soundboard/20261113-155903.jpg through MoGe-2:
		// Footages.local/render/plate-hole-moge/): each a raised ring, its outer edge Ro (PLATE_HOLES' radius plus
		// HOLE_RING: as the collars were) on a concave slope rising from the floor, faster towards the ring (as much
		// room as the struts, strut 6, the hitch rail and the next hole leave, up to 0.4 Ro); inwards a narrow outer
		// bead, a wide flat groove (HOLE_GROOVE at the largest hole, in proportion on the others), a bead at the bore
		// rounding over into it; the bore's edge thin (the casting thicker away from it underneath). The beads, the
		// groove and the heights in proportion to Ro (the small holes' all scaled down). The floor is cut at the slope's
		// foot, the lathe the hole's whole surface
		const HOLE_RING = 0.0075, HOLE_GROOVE = 0.0126, RO_MAX = Math.max( ...PLATE_HOLES.map( h => h[ 2 ] ) ) + HOLE_RING;
		const face6 = offsetPolyline( inner, 0.041 ), rail = offsetPolyline( PLATE_EDGE, - HITCH_BACK );
		const FT = 0.012;		// (the floor's thickness)
		plateHoleCollars.length = 0;
		const holeLathes = [];
		for ( const [ cx, cz, r ] of PLATE_HOLES ) {

			const c = v2( cx, cz ), Ro = r + HOLE_RING, k = Ro / RO_MAX;
			let room = Math.min( lineD( c, face6 ) - STRUT_FOOT * 0.6, lineD( c, rail ) - 0.017 );
			for ( const [ a, b, w ] of frameLines ) room = Math.min( room, segD( c, a, b ) - w / 2 - STRUT_FOOT * 0.6 );
			for ( const [ ox, oz, orr ] of PLATE_HOLES ) if ( ox !== cx || oz !== cz ) room = Math.min( room, Ro + ( c.distanceTo( v2( ox, oz ) ) - Ro - orr - HOLE_RING ) / 2 );		// (half the gap between the two rings)
			const dw = 0.6 * THREE.MathUtils.clamp( room - Ro - 0.002, 0.004, 0.4 * Ro ), Rd = Ro + dw;		// (the slope out to the floor)
			const ob = 0.0056 * k, g = HOLE_GROOVE * k, ib = 0.006 * k, rb = Ro - ob - g - ib;		// (the outer bead, the groove, the inner bead; the bore)
			const hu = 1.4 * Ro;		// (the heights below in units of hu: the ring stands 0.087 Ro over the floor)
			plateHoleCollars.push( [ cx, cz, Rd ] );
			const cut = new THREE.Path();
			cut.absellipse( cx, cz, Rd, Rd, 0, Math.PI * 2, true );
			crescent.holes.push( cut );
			// (outer edge to the bore, then down the bore and back under the floor; corner radii in m)
			const Hb = 0.045 * hu, ramp = [];
			for ( let j = 0; j <= 8; ++ j ) { const t = j / 8; ramp.push( [ Rd - t * dw, Hb * t ** 2.4 ] ); }
			const pts = [
				...ramp, [ Ro - 0.45 * ob, 0.062 * hu ],		// (the outer bead's crest)
				[ Ro - ob, 0.041 * hu ], [ Ro - ob - g, 0.041 * hu ],		// (the wide flat groove: a third as deep as the ring stands over the floor)
				[ rb + 0.5 * ib, 0.062 * hu ], [ rb + 0.12 * ib, 0.057 * hu ], [ rb, 0.035 * hu ], [ rb, - 0.0015 ], [ rb + 0.006, - 0.0025 ], [ Rd, - FT ],		// (the inner bead, over into the bore)
			];
			const rad = [ ...ramp.map( ( q, j ) => j === 8 ? 0.0008 * k : 0 ), ...[ 0.0013, 0.001, 0.001, 0.0018, 0.0012, 0.001, 0.0008 ].map( v => v * k ), 0.002, 0 ];
			holeLathes.push( new THREE.LatheGeometry( latheProfile( pts, rad, 3 ), 56 ).translate( cx, plateY, cz ) );

		}
		parts.push( extrudeXZ( crescent, plateY - FT, plateY, 0 ) );		// (no bevel: at its sharp corners the bevel's offsets shot across the holes)
		parts.push( ...holeLathes );

		// the bolts holding the plate down (hex heads on washers, in the plate's finish): along the crescent inside strut 6, about
		// BOLT_PITCH apart, where clear of the holes' collars, the struts' feet and the rails; a screw by each hole on its
		// rim's side; small domed screws at the front plate's bays' corners
		{

			const bolts = [], clear = ( q, m ) => {

				for ( const [ cx, cz, R0 ] of plateHoleCollars ) if ( q.distanceTo( v2( cx, cz ) ) < R0 + m ) return false;
				for ( const t of struts ) if ( ! t.rim && lineD( q, t.pts ) < t.w / 2 + STRUT_FOOT + m ) return false;		// (strut 6: the bolts run along it)
				return lineD( q, rail ) > 0.017 + m && q.y < plateEdgeZ( q.x ) - 0.045 && Math.sign( side( q ) ) === right;

			};
			const bolt = q => {

				bolts.push( new THREE.CylinderGeometry( 0.0115, 0.0118, 0.0018, 20 ).translate( q.x, plateY + 0.0009, q.y ) );
				bolts.push( new THREE.CylinderGeometry( 0.0078, 0.0085, 0.0058, 6 ).rotateY( ( q.x * 37.1 + q.y * 91.7 ) % 1.047 ).translate( q.x, plateY + 0.0018 + 0.0029, q.y ) );

			};
			const screw = ( q, y, r = 0.004 ) => bolts.push( new THREE.SphereGeometry( r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2 ).scale( 1, 0.6, 1 ).translate( q.x, y, q.y ) );
			const line = offsetPolyline( inner, 0.062 );
			let run = BOLT_PITCH / 2;
			for ( let i = 1; i < line.length; ++ i ) {

				run += line[ i ].distanceTo( line[ i - 1 ] );
				if ( run < BOLT_PITCH || ! clear( line[ i ], 0.012 ) ) continue;
				bolt( line[ i ] );
				run = 0;

			}
			for ( const [ cx, cz, R0 ] of plateHoleCollars ) {

				const c = v2( cx, cz ), k = face6.reduce( ( b, q, j ) => q.distanceTo( c ) < face6[ b ].distanceTo( c ) ? j : b, 0 );
				const q = c.clone().addScaledVector( new THREE.Vector2().subVectors( face6[ k ], c ).normalize(), R0 + 0.011 );
				if ( clear( q, 0.006 ) ) screw( q, plateY );

			}
			for ( const b of bays ) {

				const m = b.reduce( ( a, q ) => a.add( q ), v2( 0, 0 ) ).multiplyScalar( 1 / b.length );
				for ( const q of b ) screw( q.clone().addScaledVector( new THREE.Vector2().subVectors( q, m ).normalize(), 0.0115 ), plateY + RING_Y[ 1 ], 0.0034 );

			}
			parts.push( ...bolts );		// (cast-in look: the plate's own finish, each variant's)

		}

		group.add( mesh( merge( parts ), M.plate ) );

	}

	// --- strings, pins, dampers --------------------------------------------
	{

		const steel = [], copper = [], pins = [], hitch = [];
		const damperMats = [ M.hammerFelt, M.keyBlack ];
		// Each note's string(s) laid out through its damper. The dampers stand in a row just behind the front
		// plate's back edge (its two halves), their blocks' fronts 7 mm from it,
		// in four groups between the struts leaving the front plate (numbered by their lower ends, left to right:
		// 1 the X's long leg, 2 the strut from the gusset parallel to it, 3 the X's other leg, 4 and 5 the
		// treble's): the bass's (29, compressed to 12 mm apart: their pins, forward along the strings, inside the
		// case) between 1 and 2, parallel to them, on over the crescent to their own hitch rail parallel to its edge; the
		// tenor's (20) between 3 and 4, turning note by note from 3's angle (leaning to the spine, under the bass:
		// overstrung) to 4's, along -z; the treble's straight back, either side of 5 (none above note 68). From
		// the damper forward to the tuning pins, back to the hitch pins (the tenor's and the treble's on the rail
		// along the crescent's edge)
		const n = 88, bassCount = BASS_COUNT, tenorCount = 20, stringSegs = [];
		// (the bass's hitch rail's centre line: the crescent's edge moved 12 cm back along its normal, so the bass's
		// ends run parallel to it; the two holes by the rim just behind it)
		const bassRail = PLATE_EDGE.map( ( p, k, e ) => {

			const t = new THREE.Vector2().subVectors( e[ Math.min( e.length - 1, k + 1 ) ], e[ Math.max( 0, k - 1 ) ] ).normalize();
			const nb = v2( t.y, - t.x );
			return p.clone().addScaledVector( nb.y > 0 ? nb.negate() : nb, 0.12 );

		} ), bassEnds = [];
		const x1 = HALF_W - 0.1;		// (the top string clear of strut 6 along the bentside)
		const [ V0, V1 ] = FRAME_V, treble = n - bassCount - tenorCount;
		const t1 = Math.round( treble * ( V1 - 0.02 - ( V0 + 0.02 ) ) / ( x1 - ( V0 + 0.02 ) - 0.04 ) );
		const span = ( a, b, k, m ) => a + ( b - a ) * k / ( m - 1 );
		const damperX = i => i < bassCount ? span( BASS_DX[ 0 ], BASS_DX[ 1 ], i, bassCount )
			: i < bassCount + tenorCount ? span( - 0.185, V0 - 0.02, i - bassCount, tenorCount )
				: i < bassCount + tenorCount + t1 ? span( V0 + 0.02, V1 - 0.02, i - bassCount - tenorCount, t1 )
					: span( V1 + 0.02, x1, i - bassCount - tenorCount - t1, treble - t1 );
		const damperZ = x => frontBackZ( x ) - 0.022;		// (in line by the gusset too: its apex, the front plate's, is above them, and they clear it sideways)
		const angA = Math.atan2( bassDir.x, - bassDir.y ), angB = Math.atan2( X_NODE.x - GUSSET.x, GUSSET.y - X_NODE.y );
		const angle = i => i < bassCount ? angA : i < bassCount + tenorCount ? angB * ( 1 - ( i - bassCount ) / ( tenorCount - 1 ) ) : 0;
		// a damper resting on its string at d (plan) on a string running along dir (plan, back), its top y there
		const addDamper = ( i, d, dir, y, w ) => {

			for ( const [ fa, fb, fw ] of frameLines ) {

				const e = new THREE.Vector2().subVectors( fb, fa ), u = THREE.MathUtils.clamp( new THREE.Vector2().subVectors( d, fa ).dot( e ) / e.lengthSq(), 0, 1 );
				if ( fa.clone().addScaledVector( e, u ).distanceTo( d ) < fw / 2 + 0.008 ) return;		// (a beam over it: none)

			}

			const felt = boxProjectUV( new THREE.BoxGeometry( w, 0.006, 0.026 ).translate( 0, 0.003, 0 ) );
			const block = boxProjectUV( new THREE.BoxGeometry( w - 0.001, 0.026, 0.030 ).translate( 0, 0.019, 0 ) );
			const node = new THREE.Group();
			node.position.set( d.x, y, d.y );
			node.rotation.y = Math.atan2( dir.x, dir.y );
			node.add( mesh( merge( [ felt ] ), damperMats[ 0 ] ), mesh( merge( [ block ] ), damperMats[ 1 ] ) );
			group.add( node );
			dampers.set( i + 21, { node, axis: 'y', lift: 0.010 } );

		};
		// a hammer from below (as the upright's: src/stringing.js): its strike point 35 mm behind the damper along
		// the string (the front plate's floor reaches the dampers in the treble: no room in front of them), the felt
		// head 45 mm under the string at rest, its wooden core below, the shank forward to its pivot (SHANK) under the
		// floor plate; a pivot per note turned along its string, swung about its own x up to the string (the strike
		// angle: the felt's top just touching the string's underside)
		const SHANK = 0.13, BLOW = 0.045;
		const addHammer = ( i, d, dir, yBottom, w, h ) => {

			const S = d.clone().addScaledVector( dir, 0.035 ), Q = S.clone().addScaledVector( dir, - SHANK );
			const top = yBottom - BLOW, pivotY = top - h + 0.004;
			const turn = new THREE.Group();
			turn.position.set( Q.x, pivotY, Q.y );
			turn.rotation.y = Math.atan2( dir.x, dir.y );		// (local +z back along the string)
			const node = new THREE.Group();
			turn.add( node );
			const yt = top - pivotY;		// (the felt's top over the pivot)
			const felt = new RoundedBoxGeometry( w, 0.024, 0.02, 2, 0.004 ).translate( 0, yt - 0.012, SHANK );
			const core = boxProjectUV( new RoundedBoxGeometry( w - 0.001, h - 0.02, 0.016, 1, 0.0015 ).translate( 0, yt - 0.02 - ( h - 0.02 ) / 2 + 0.002, SHANK ), { grain: 'y' } );
			const shank = boxProjectUV( rod( v3( 0, 0, - 0.012 ), v3( 0, yt - h + 0.008, SHANK ), 0.0023, 6 ), { grain: 'z' } );
			// (one material per mesh: the path tracer maps materials per mesh)
			for ( const [ geo, mat ] of [ [ merge( [ felt ] ), M.hammerFelt ], [ merge( [ core, shank ] ), M.spruce ] ] ) node.add( mesh( geo, mat ) );
			hammerRack.add( turn );
			const fp = felt.attributes.position;
			const maxY = phi => { let m = - Infinity; const sn = Math.sin( phi ), cs = Math.cos( phi ); for ( let k = 0; k < fp.count; ++ k ) m = Math.max( m, fp.getY( k ) * cs - fp.getZ( k ) * sn ); return m; };
			let lo = - 0.8, hi = 0;
			for ( let k = 0; k < 40; ++ k ) { const mid = ( lo + hi ) / 2; if ( maxY( mid ) < yBottom - pivotY ) hi = mid; else lo = mid; }
			hammers.set( i + 21, { node, strike: lo } );

		};
		// the tuning pins: in the front plate's bays (the pin field), standing in the floor plate in front of its back
		// edge (the hammers' shanks pass under it), in four staggered rows across the strings (PIN_FRONT back, at
		// most 10.5 mm apart), each in a maple bushing, its string coiled round it; one per string (a course's two,
		// a bass note's one)
		const pinRow = ( x, k ) => { const zb = polyZ( floorBack, x ) + 0.007, sp = THREE.MathUtils.clamp( ( PIN_FRONT - zb ) / 3, 0.0055, 0.0105 ); return PIN_FRONT - k * sp; };
		const bushings = [], coils = [], courses = [];
		for ( let i = 0; i < n; ++ i ) {

			const bass = i < bassCount, th = angle( i ), dir = v2( Math.sin( th ), - Math.cos( th ) ), side = v2( - dir.y, dir.x );
			const d = v2( damperX( i ), 0 );
			d.y = damperZ( d.x );
			// each string's start (its tuning pin), along its own line (side offset o), in its row
			const offs = bass ? [ 0 ] : [ - 0.003, 0.003 ];
			const starts = offs.map( ( o, j ) => {

				const base = d.clone().addScaledVector( side, o ), z = pinRow( base.x, bass ? i % 4 : ( i % 2 ) * 2 + j );
				const sj = ( z - base.y ) / dir.y;		// (negative: forward)
				return { o, P: base.clone().addScaledVector( dir, sj ), s: - sj };

			} );
			const sF = starts.reduce( ( a, q ) => a + q.s, 0 ) / starts.length, P = d.clone().addScaledVector( dir, - sF );
			// the hitch pin: on the rail along the crescent's edge (the bass's on theirs along the rim), the notes'
			// pins in two staggered rows either side of its centre line; the strings (a course's two either side of
			// its pin: one wire round it) to it
			const railZ = bass ? x => polyZ( bassRail, x ) : hitchZ, zH = x => railZ( x ) + ( i % 2 ? - 0.0045 : 0.0045 );
			let sH = 0;
			while ( d.y + dir.y * sH > zH( d.x + dir.x * sH ) ) sH += 0.001;
			const sB = bass ? sH - 0.0025 : sH, E = d.clone().addScaledVector( dir, sB ), H = d.clone().addScaledVector( dir, sH );
			stringSegs.push( [ P, E, bass ? 0.0015 : 0.0045 ] );		// (plan, half the course's width)
			const y0 = bass ? BASS_Y : STRING_Y, y1 = y0 - ( bass ? 0.006 : 0.004 ), yD = plateY + y0 + ( y1 - y0 ) * sF / ( sF + sB );
			courses.push( { i, bass, d, dir, side, offs, sF, sB, y0, y1 } );
			// tuning pins up to just above their string, a coil of the string round each at its height, a bushing
			const pinTop = plateY + y0 + 0.008;
			for ( const q of starts ) {

				pins.push( rod( v3( q.P.x, plateY - 0.004, q.P.y ), v3( q.P.x, pinTop, q.P.y ), 0.0035, 10 ) );
				bushings.push( new THREE.CylinderGeometry( 0.0062, 0.0066, 0.0026, 14 ).translate( q.P.x, plateY + 0.0013, q.P.y ) );
				coils.push( new THREE.CylinderGeometry( 0.0047, 0.0047, 0.0045, 12 ).translate( q.P.x, plateY + y0, q.P.y ) );

			}
			hitch.push( rod( v3( H.x, plateY + HITCH_RAIL - 0.002, H.y ), v3( H.x, plateY + y1 + 0.004, H.y ), 0.0022, 8 ) );
			if ( bass ) {

				bassEnds.push( E );
				const q = starts[ 0 ];
				copper.push( beam( v3( q.P.x, plateY + y0, q.P.y ), v3( E.x, plateY + y1, E.y ), 0.003, 0.003 ) );
				addDamper( i, d, dir, yD + 0.0015, 0.011 );
				addHammer( i, d, dir, yD - 0.0015, 0.0105, 0.044 );

			} else {

				for ( const q of starts ) { const e = E.clone().addScaledVector( side, q.o ); steel.push( beam( v3( q.P.x, plateY + y0, q.P.y ), v3( e.x, plateY + y1, e.y ), 0.0012, 0.0012 ) ); }
				if ( i < 68 ) addDamper( i, d, dir, yD + 0.0006, 0.012 );
				addHammer( i, d, dir, yD - 0.0006, i < bassCount + tenorCount ? 0.0115 : 0.0122, THREE.MathUtils.lerp( 0.04, 0.032, ( i - bassCount ) / ( n - bassCount - 1 ) ) );

			}

		}

		// the bass's hitch rail: parallel to the crescent's edge, past the first and the last bass string's end (as
		// the other: filleted into the floor, its top rounded)
		{

			// (from 10 mm before its first pin to 10 mm past its last: its ends clear of struts 1 and 2's feet, where its
			// old end, a whole rail point on, stood out of strut 2's side)
			const A = [ 0 ];
			for ( let k = 1; k < bassRail.length; ++ k ) A.push( A[ k - 1 ] + bassRail[ k ].distanceTo( bassRail[ k - 1 ] ) );
			const at = a => { let k = 0; while ( k + 2 < bassRail.length && A[ k + 1 ] < a ) ++ k; return bassRail[ k ].clone().lerp( bassRail[ k + 1 ], ( a - A[ k ] ) / ( A[ k + 1 ] - A[ k ] ) ); };
			const arcOf = q => { let k = 0, bd = Infinity; for ( let j = 0; j < bassRail.length; ++ j ) { const d = bassRail[ j ].distanceTo( q ); if ( d < bd ) { bd = d; k = j; } } const j = Math.min( k, bassRail.length - 2 ), e = new THREE.Vector2().subVectors( bassRail[ j + 1 ], bassRail[ j ] ); return A[ j ] + new THREE.Vector2().subVectors( q, bassRail[ j ] ).dot( e ) / e.length(); };
			const as = bassEnds.map( arcOf ), a0 = Math.min( ...as ) - 0.01, a1 = Math.max( ...as ) + 0.01;
			const path = [ at( a0 ), ...bassRail.filter( ( q, k ) => A[ k ] > a0 + 0.002 && A[ k ] < a1 - 0.002 ), at( a1 ) ];
			group.add( mesh( sweep( path, () => RAIL_PROFILE, { y: plateY, closed: true } ), M.plate ) );

		}

		// the bridges on the soundboard (src/soundboard.js: the long bridge under the tenor and the treble, the bass's
		// on its apron), the strings bearing on them
		const bridges = buildBridges( { courses, plateY, soundboardY: SOUNDBOARD_Y, bassCount, stringSegs, edgeZ: plateEdgeZ, edge: PLATE_EDGE } );
		bridges.push( ...buildBassBridge( { courses, slot: bassSlot, plateY, soundboardY: SOUNDBOARD_Y } ) );
		for ( const key of [ 'maple', 'graphite', 'steel' ] ) {

			const geos = bridges.filter( b => b[ 1 ] === key ).map( b => b[ 0 ] );
			if ( geos.length ) group.add( mesh( merge( geos ), M[ key ] ?? M.spruce ) );

		}
		group.add( mesh( merge( bushings ), M.maple ?? M.spruce ) );
		group.add( mesh( merge( coils ), M.steel ) );

		group.add( hammerRack );
		group.add( mesh( merge( steel ), M.steel ) );
		group.add( mesh( merge( copper ), M.copper ) );
		group.add( mesh( merge( pins ), M.steel ) );
		group.add( mesh( merge( hitch ), M.steel ) );		// hitch pins on the plate's hitch rails

		// the frame's struts, lofted along their plan polylines, a chamfered section 14 mm wide:
		// - strut 6 along the rim, standing on the plate: its top FRAME_Y's at the front, falling (smoothly) along
		//   the bentside's curve to RIM_STRUT_LOW at the tail
		// - struts 1 to 5 over the strings (FRAME_Y); from where no string passes under them any more on to the rim,
		//   down onto the plate (a short ramp under them) and their tops falling ever faster to strut 6's height where
		//   they meet it
		{

			const [ fy0, fy1 ] = FRAME_Y, C = 0.003, rimTop = [];
			const segDist = ( q, a, b ) => { const e = new THREE.Vector2().subVectors( b, a ), u = THREE.MathUtils.clamp( new THREE.Vector2().subVectors( q, a ).dot( e ) / e.lengthSq(), 0, 1 ); return a.clone().addScaledVector( e, u ).distanceTo( q ); };
			const sample = pts => {

				const out = [];
				for ( let i = 0; i + 1 < pts.length; ++ i ) {

					const L = pts[ i ].distanceTo( pts[ i + 1 ] ), m = Math.max( 1, Math.ceil( L / 0.01 ) );
					for ( let k = 0; k < m; ++ k ) out.push( pts[ i ].clone().lerp( pts[ i + 1 ], k / m ) );

				}

				out.push( pts[ pts.length - 1 ].clone() );
				const s = [ 0 ];
				for ( let i = 1; i < out.length; ++ i ) s.push( s[ i - 1 ] + out[ i ].distanceTo( out[ i - 1 ] ) );
				return { p: out, s };

			};
			// a strut's section (u across, v up over the floor, counter-clockwise: src/castdetail.js sweep): w wide
			// from y0 to y1, its top edges rounded (3.5 mm); floating (over the strings) its bottom edges rounded
			// (2 mm), standing on the plate (down 1) its foot filleted into the floor (rf), in between blended
			const NB = 4, NT = 3;
			const section = ( y0, y1, w, down, rf ) => {

				const h = w / 2, ft = Math.min( 0.0035, ( y1 - y0 ) / 3 ), rb = Math.min( 0.002, ( y1 - y0 ) / 4 ), yb = y0 - 0.0005 * down;
				const right = [];		// (the bottom right corner, from the bottom to the wall)
				for ( let k = 0; k <= NB; ++ k ) {

					const a = - Math.PI / 2 + Math.PI / 2 * k / NB, b = - Math.PI / 2 - Math.PI / 2 * k / NB;
					const fu = h - rb + rb * Math.cos( a ), fv = yb + rb + rb * Math.sin( a );
					const gu = h + rf + rf * Math.cos( b ), gv = yb + rf + rf * Math.sin( b );
					right.push( { u: fu + ( gu - fu ) * down, v: fv + ( gv - fv ) * down, smooth: k > 0 } );

				}
				const out = [ ...right ];
				for ( let k = 0; k <= NT; ++ k ) { const a = Math.PI / 2 * k / NT; out.push( { u: h - ft + ft * Math.cos( a ), v: y1 - ft + ft * Math.sin( a ), smooth: true } ); }
				for ( let k = 0; k <= NT; ++ k ) { const a = Math.PI / 2 + Math.PI / 2 * k / NT; out.push( { u: - h + ft + ft * Math.cos( a ), v: y1 - ft + ft * Math.sin( a ), smooth: true } ); }
				for ( let k = NB; k >= 0; -- k ) out.push( { u: - right[ k ].u, v: right[ k ].v, smooth: right[ k ].smooth } );
				return out;

			};
			// a strut lofted through plan points p, its sections [ y0, y1, down ] (above the floor), w wide
			const loft = ( p, ys, w, rf = STRUT_FOOT ) => sweep( p, i => section( ys[ i ][ 0 ], ys[ i ][ 1 ], w, ys[ i ][ 2 ] ?? ( ys[ i ][ 0 ] <= 0 ? 1 : 0 ), rf ), { y: plateY, closed: true } );
			const geos = [];
			// strut 6
			const rim = struts.find( t => t.rim ), R = sample( rim.pts );
			const sCurve = R.s[ R.p.findIndex( q => q.y < - 0.62 ) ] ?? 0;		// (where the bentside starts to curve)
			const rimH = R.s.map( s => { const u = THREE.MathUtils.smoothstep( s, sCurve, sCurve + 0.35 ); return fy1 + ( RIM_STRUT_LOW - fy1 ) * u; } );
			R.p.forEach( ( q, i ) => rimTop.push( [ q, rimH[ i ] ] ) );
			geos.push( loft( R.p, rimH.map( h => [ 0, h, 1 ] ), rim.w, RIM_FOOT ) );
			const rimAt = q => rimTop.reduce( ( b, e ) => e[ 0 ].distanceTo( q ) < b[ 0 ].distanceTo( q ) ? e : b )[ 1 ];
			const face6 = offsetPolyline( inner, 0.034 + rim.w / 2 );		// (strut 6's inner face, plan)
			// struts 1 to 5
			for ( const t of struts.filter( t => ! t.rim ) ) {

				const { p, s } = sample( t.pts ), L = s[ s.length - 1 ];
				const busy = p.map( q => stringSegs.some( ( [ a, b, hw ] ) => segDist( q, a, b ) < t.w / 2 + hw + 0.005 ) );
				let f = p.length;		// (the first sample from which none is over a string)
				while ( f > 0 && ! busy[ f - 1 ] ) -- f;
				if ( f >= p.length ) { geos.push( loft( p, p.map( () => [ fy0, fy1 ] ), t.w ) ); continue; }
				const sF = s[ f ] + 0.006, hEnd = rimAt( p[ p.length - 1 ] );
				const ys = s.map( si => {

					const down = THREE.MathUtils.clamp( ( si - sF ) / 0.012, 0, 1 );		// (the ramp onto the plate)
					const u = THREE.MathUtils.clamp( ( si - sF ) / ( L - sF ), 0, 1 );
					return [ fy0 * ( 1 - down ), fy1 + ( hEnd - fy1 ) * u * u, down ];

				} );
				geos.push( loft( p, ys, t.w ) );
				// where it meets strut 6: a fillet either side (plan), from the floor up its height, round into strut 6's
				// inner face (its plan line taken straight there)
				const E = p[ p.length - 1 ], tE = new THREE.Vector2().subVectors( E, p[ Math.max( 0, p.length - 4 ) ] ).normalize(), nE = v2( - tE.y, tE.x );
				const k6 = face6.reduce( ( b, q, k ) => q.distanceTo( E ) < face6[ b ].distanceTo( E ) ? k : b, 0 );
				const F6 = face6[ k6 ], u6 = new THREE.Vector2().subVectors( face6[ Math.min( face6.length - 1, k6 + 1 ) ], face6[ Math.max( 0, k6 - 1 ) ] ).normalize();
				for ( const sg of [ - 1, 1 ] ) {

					const C = meet( E.clone().addScaledVector( nE, sg * t.w / 2 ), tE, F6, u6 );
					if ( ! C ) continue;
					const d2 = u6.clone().multiplyScalar( Math.sign( u6.dot( nE ) * sg ) || 1 );
					const f = filletPlan( C, tE.clone().negate(), d2, JOIN_FILLET );
					if ( f ) geos.push( extrudeXZ( new THREE.Shape( f ), plateY - 0.0005, plateY + hEnd - 0.0008, 0.0025 ) );

				}

			}

			group.add( mesh( merge( geos ), M.plate ) );

		}

		// pin block cover / plate flange across the front
		group.add( mesh( woodBox( v3( - HALF_W + RIM_T, plateY, - 0.33 ), v3( HALF_W - RIM_T, plateY + 0.006, - 0.245 ), { noUV: true } ), M.plate ) );

	}

	// --- lid -------------------------------------------------------------
	// main lid behind FOLD_Z and the front flap in front of it (to just behind the display).
	// Open, the flap is folded back on top of the main lid (Figs. 1, 5); brass hinges along the
	// fold (3) and on the spine (2)
	{

		const T = 0.02;
		const main = new THREE.Shape( outer.map( p => new THREE.Vector2( p.x, Math.min( p.y, FOLD_Z ) ) ) );
		main.closePath();
		const flapPts = [ v2( - HALF_W, LID_FRONT_Z ), v2( - HALF_W, FOLD_Z ), v2( bentsideX( outer, FOLD_Z ), FOLD_Z ) ];
		for ( const p of outer ) if ( p.x > 0 && p.y > FOLD_Z && p.y < LID_FRONT_Z ) flapPts.push( p.clone() );
		flapPts.push( v2( HALF_W, LID_FRONT_Z ) );
		const flapShape = new THREE.Shape( flapPts );
		flapShape.closePath();
		const open = lidAngle > 2;
		const lidGeo = extrudeXZ( main, 0, T, 0.004 );
		const flapGeo = extrudeXZ( flapShape, 0, T, 0.004 );
		if ( open ) {

			// rotate 180° about the fold line at the lid's top face: the flap lies on the lid
			flapGeo.translate( 0, - T, - FOLD_Z );
			flapGeo.rotateX( Math.PI );
			flapGeo.translate( 0, T, FOLD_Z );

		}

		// the hinges, as a real lid's (Footages.local/find/MHGF3.jpg, GF-TYPE-3.jpg), none standing out of the case's lines:
		// - the fold: one long piano hinge joining the flap to the main lid over most of the width, a knuckled barrel
		//   along the fold (2.5 mm, set in at the boards' edges) and a thin leaf on each board beside it
		// - the spine: two butt hinges between the lid and the rim, their barrels in the corner where the lid's edge
		//   meets the rim's (the lid's pivot: KN in from the case's side and below the lid, so the barrel's
		//   outside is flush with both), their leaves on the lid's underside and the rim's top: only the barrel shows
		const hinges = [], rimHinges = [];
		const knuckles = ( list, a, b, r, n, gap ) => {		// a barrel from `a` to `b` in n knuckles

			const L = a.distanceTo( b ), step = L / n;
			for ( let i = 0; i < n; ++ i ) list.push( rod( a.clone().lerp( b, ( i * step + gap / 2 ) / L ), a.clone().lerp( b, ( ( i + 1 ) * step - gap / 2 ) / L ), r, 10 ) );

		};
		// the fold hinge, on the boards' edges at the joint: its barrel's axis at (y T, z FOLD_Z), the line both boards
		// turn about. Open, the flap lies folded back on the main lid, the two edges one above the other in the plane
		// z FOLD_Z, facing the keys (the lid's y 0..T, the flap's T..2T): the leaves on them, mortised (just proud),
		// the barrel along the joint between them, nested in the groove of the boards' rounded edges. Closed, the
		// edges meet: the leaves in the joint, the barrel on top along it. One long hinge (brass), or the case's own:
		// M.foldHinge, `userData.count` short ones evenly along the fold (the crystal's four, black metal)
		// `userData.rivets` (the crystal's: its rivet caps' material): each short hinge riveted, 3 pairs of domed caps
		// along it, one of each pair on each leaf's outer face
		const foldParts = [], rivetParts = [], FH = M.foldHinge ?? M.brass, count = FH.userData.count ?? 0, RIV = FH.userData.rivets;
		// a rivet's domed cap: 5.5 mm across, 1.7 mm high, its foot at `p`, facing `n`
		const cap = ( p, n ) => {

			const g = new THREE.SphereGeometry( 0.00275, 12, 6, 0, 2 * Math.PI, 0, Math.PI / 2 ).scale( 1, 0.0017 / 0.00275, 1 );
			g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( v3( 0, 1, 0 ), n ) ).translate( p.x, p.y, p.z );
			rivetParts.push( g.toNonIndexed() );

		};
		{

			const r = 0.0025, lt = 0.0006, leaf = 0.011;
			const x0 = - HALF_W + 0.06, x1 = Math.min( HALF_W - 0.1, bentsideX( outer, FOLD_Z ) - 0.06 );
			const spans = count ? Array.from( { length: count }, ( _, i ) => { const c = x0 + ( i + 0.5 ) * ( x1 - x0 ) / count; return [ c - 0.035, c + 0.035, 3 ]; } )
				: [ [ x0, x1, Math.round( ( x1 - x0 ) / 0.06 ) ] ];
			for ( const [ a, b, n ] of spans ) {

				// the rivets: 3 pairs along the hinge, between its knuckles' ends and middle; each leaf's one halfway
				// across it from the barrel
				const along = RIV ? [ 0.18, 0.5, 0.82 ].map( f => a + f * ( b - a ) ) : [], mid = r + ( leaf - r ) / 2;
				if ( open ) {

					knuckles( foldParts, v3( a, T, FOLD_Z - 0.0008 ), v3( b, T, FOLD_Z - 0.0008 ), r, n, 0.0012 );
					foldParts.push( woodBox( v3( a, T - leaf, FOLD_Z - 0.0004 ), v3( b, T + leaf, FOLD_Z + lt ), { noUV: true } ) );		// (both leaves: one plate across the joint)
					for ( const x of along ) for ( const s of [ - 1, 1 ] ) cap( v3( x, T + s * mid, FOLD_Z + lt - 0.0001 ), v3( 0, 0, 1 ) );		// (on the leaves' face, towards the keys)

				} else {

					knuckles( foldParts, v3( a, T - 0.0008, FOLD_Z ), v3( b, T - 0.0008, FOLD_Z ), r, n, 0.0012 );
					if ( RIV ) {		// (the leaves in the joint, back to back: seen through the crystal's clear lid; their caps into each board)

						for ( const s of [ - 1, 1 ] ) foldParts.push( woodBox( v3( a, T - leaf, s < 0 ? FOLD_Z - 0.0006 : FOLD_Z ), v3( b, T - 0.0008, s < 0 ? FOLD_Z : FOLD_Z + 0.0006 ), { noUV: true } ) );
						for ( const x of along ) for ( const s of [ - 1, 1 ] ) cap( v3( x, T - mid, FOLD_Z + s * 0.0005 ), v3( 0, 0, s ) );

					}

				}

			}

		}
		const KN = 0.004;		// the spine hinges' barrel radius: the lid's pivot this far in and down from the corner
		for ( const z of [ - 0.75, - 1.21 ] ) {

			knuckles( hinges, v3( - HALF_W + KN, 0, z - 0.035 ), v3( - HALF_W + KN, 0, z + 0.035 ), KN, 3, 0.001 );
			hinges.push( woodBox( v3( - HALF_W + KN, - 0.0001 + KN, z - 0.035 ), v3( - HALF_W + 0.05, 0.0011 + KN, z + 0.035 ), { noUV: true } ) );		// (the lid's leaf, under it: hidden closed)
			rimHinges.push( woodBox( v3( - HALF_W + KN, RIM_TOP - 0.0012, z - 0.035 ), v3( - HALF_W + 0.05, RIM_TOP + 0.0001, z + 0.035 ), { noUV: true } ) );		// (the rim's, on its top)

		}
		// the lid's own geometry in the pivot's frame: the pivot at the barrels' axis (x -HALF_W + KN, y RIM_TOP + KN)
		for ( const g of [ lidGeo, flapGeo ] ) g.translate( HALF_W - KN, - KN, 0 );
		for ( const g of [ ...hinges, ...foldParts, ...rivetParts ] ) g.translate( HALF_W - KN, - KN, 0 );
		const pivot = new THREE.Group();
		pivot.position.set( - HALF_W + KN, RIM_TOP + KN, 0 );
		pivot.rotation.z = THREE.MathUtils.degToRad( lidAngle );
		pivot.add( mesh( lidGeo, LID ), mesh( flapGeo, LID ), mesh( merge( hinges ), M.brass ), mesh( merge( foldParts ), FH ) );
		if ( rivetParts.length ) pivot.add( mesh( merge( rivetParts ), RIV ) );
		group.add( pivot, mesh( merge( rimHinges ), M.brass ) );

		if ( open ) {

			// the prop stick: its foot in a bracket on the bentside's inner face, a little below the rim's top, on a
			// pin along the rim (it folds down along the rim to close; MHGF3, GF-TYPE-3: the foot inside the case);
			// its top where the lid's underside was met before
			const zs = - 0.88;
			const bx = bentsideX( outer, zs ) - 0.06;
			const a = THREE.MathUtils.degToRad( lidAngle );
			const r = ( bx + HALF_W ) * 0.86;
			const top = v3( - HALF_W + r * Math.cos( a ), RIM_TOP + r * Math.sin( a ), zs );
			// the rim's inner face there, its tangent (the pin's axis) and normal (into the case)
			const xi = bentsideX( inner, zs ), dz = 0.01, tan = v3( bentsideX( inner, zs + dz ) - bentsideX( inner, zs - dz ), 0, 2 * dz ).normalize();
			const into = v3( - tan.z, 0, tan.x );
			if ( into.x > 0 ) into.negate();		// (into the case: towards - x)
			const pin = v3( xi, RIM_TOP - 0.03, zs ).addScaledVector( into, 0.016 );		// (the pin 16 mm off the rim's face, 30 mm below its top)
			group.add( mesh( rod( pin, top, 0.011, 12, 0.009 ), PROP ) );
			group.add( mesh( new THREE.SphereGeometry( 0.0125, 16, 10 ).translate( pin.x, pin.y, pin.z ), PROP ) );		// (its rounded foot round the pin)
			// the bracket: a plate on the rim's face, two cheeks either side of the foot, the pin through them
			const at = ( p, w, h, d ) => {		// a box w (along the rim) × h × d (into the case), its back at p

				const g = new THREE.BoxGeometry( w, h, d ).translate( 0, 0, d / 2 );
				g.applyMatrix4( new THREE.Matrix4().makeBasis( tan, v3( 0, 1, 0 ), into ).setPosition( p ) );
				return g;

			};
			const face = v3( xi, RIM_TOP - 0.03, zs ), parts = [ at( face.clone().addScaledVector( v3( 0, 1, 0 ), 0.002 ), 0.06, 0.05, 0.003 ) ];
			for ( const s of [ - 1, 1 ] ) parts.push( at( face.clone().addScaledVector( tan, s * 0.0165 ), 0.004, 0.03, 0.027 ) );
			parts.push( rod( pin.clone().addScaledVector( tan, - 0.02 ), pin.clone().addScaledVector( tan, 0.02 ), 0.0028, 10 ) );
			group.add( mesh( merge( parts.map( g => g.index ? g.toNonIndexed() : g ) ), M.brass ) );

		}

	}

	// --- keyboard area -----------------------------------------------------
	{

		// keybed + keyslip
		// key bed: top slab behind the keyslip, its front face hidden behind the keyslip
		group.add( mesh( woodBox( v3( - 0.66, 0.655, - 0.25 ), v3( 0.66, 0.685, 0 ), { noUV: true } ), M.keybed ) );
		group.add( mesh( woodBox( v3( - 0.66, FRONT_BOTTOM, - 0.25 ), v3( 0.66, 0.655, - 0.012 ), { noUV: true } ), M.case ) );
		group.add( mesh( woodBox( v3( - SCREEN_EDGE_X, 0.655, - 0.01 ), v3( SCREEN_EDGE_X, 0.705, KEY_FRONT_Z ), { noUV: true, radius: 0.004 } ), M.case ) );
		// key blocks: flat, level with the white key tops (USD834638 Figs. 1, 4/5), between the
		// keys and the side boards, from the key slip back to the display
		for ( const sx of [ - 1, 1 ] ) {

			const a = v3( sx < 0 ? - SCREEN_EDGE_X : 0.618, FRONT_BOTTOM, screenFrontZ( KEY_BLOCK_TOP ) - 0.01 );
			const b = v3( sx < 0 ? - 0.618 : SCREEN_EDGE_X, KEY_BLOCK_TOP, KEY_FRONT_Z );
			group.add( mesh( woodBox( a, b, { noUV: true, radius: 0.006 } ), M.case ) );

		}

		// felt strip along the key backs, under the display
		group.add( mesh( woodBox( v3( - 0.618, 0.72, - 0.157 ), v3( 0.618, 0.737, - 0.146 ) ), M.redFelt ) );

		// the display, in place of fallboard and music desk: a glossy black slab leaning back
		// from the felt, its front face the screen (M.panel: the piano roll plays on it, the
		// handheld mode's planar mirror uses it)
		// (only the face is glass: the back, towards the lid and the hall, and the edges are matte)
		const geo = new THREE.BoxGeometry( SCREEN_W, SCREEN_H, SCREEN_T );
		geo.translate( 0, SCREEN_H / 2, - SCREEN_T / 2 - 0.0005 );
		const back = M.panelBack ?? M.panel;
		const screen = mesh( geo, [ back, back, back, back, M.panel, back ] );		// box groups: ±x, ±y, +z (the face), -z
		screen.name = 'panel';
		screen.position.copy( SCREEN_BOTTOM );
		screen.rotation.x = - SCREEN_LEAN;
		group.add( screen );

	}

	// --- legs and the frame below the case (USD834638 Figs. 1, 2, 5, 7) ------------------------
	{

		const caseParts = [], legParts = [], stretcherParts = [], brass = [], steel = [];

		// front legs: flat posts set back under the case (z = -0.32, outer face 13 mm inside the
		// case side), 0.10 m wide tapering to 0.075 at the floor (outer face vertical), 0.08 m
		// deep, flaring at the top into the case's underside, back to z = -0.50 and forward to
		// -0.14 (the footprint drawn in Fig. 7)
		const LEG_Z = - 0.318, LEG_OUT = HALF_W - 0.013, LEG_W0 = 0.075, LEG_W1 = 0.10, FOOT = 0.075;
		const prof = new THREE.Shape();
		prof.moveTo( LEG_Z - 0.038, FOOT );
		prof.lineTo( LEG_Z + 0.038, FOOT );
		prof.lineTo( LEG_Z + 0.042, 0.55 );
		prof.quadraticCurveTo( LEG_Z + 0.042, FRONT_BOTTOM, - 0.14, FRONT_BOTTOM + 0.001 );
		prof.lineTo( - 0.50, FRONT_BOTTOM + 0.001 );
		prof.quadraticCurveTo( LEG_Z - 0.042, FRONT_BOTTOM, LEG_Z - 0.042, 0.48 );
		prof.closePath();
		// its edges rounded, LEG_R in the profile's plane and across the width (3 segments: the black and
		// white lacquer and the crystal's dark glass catch a thin, sharp line of light along each edge)
		const LEG_R = 0.004, LEG_BT = LEG_R / LEG_W1;		// (the extrusion is 1 deep, then scaled to the width)
		for ( const sx of [ - 1, 1 ] ) {

			let g = new THREE.ExtrudeGeometry( prof, { depth: 1 - 2 * LEG_BT, bevelEnabled: true, bevelThickness: LEG_BT, bevelSize: LEG_R, bevelOffset: - LEG_R, bevelSegments: 3, curveSegments: 16 } );
			g = g.index ? g.toNonIndexed() : g;
			g.deleteAttribute( 'normal' ); g.deleteAttribute( 'uv' );
			g.translate( 0, 0, LEG_BT );		// (the bevel starts at -bevelThickness: the caps at 0 and 1)
			const pos = g.attributes.position, ez = new Float32Array( pos.count );
			for ( let i = 0; i < pos.count; ++ i ) ez[ i ] = pos.getZ( i );
			g.rotateY( - Math.PI / 2 );			// profile (z, y) -> world (z, y); extrusion -> -x, 0..-1
			for ( let i = 0; i < pos.count; ++ i ) {

				// width tapers towards the floor; the outer face stays vertical
				const t = THREE.MathUtils.clamp( ( pos.getY( i ) - FOOT ) / ( FRONT_BOTTOM - FOOT ), 0, 1 );
				const w = THREE.MathUtils.lerp( LEG_W0, LEG_W1, t );
				pos.setX( i, sx * ( LEG_OUT + pos.getX( i ) * w ) );

			}

			if ( sx < 0 ) {

				// mirrored: restore the winding (each triangle's corners 1 and 2 swapped)
				for ( let i = 0; i < pos.count; i += 3 ) {

					for ( let c = 0; c < 3; ++ c ) { const t = pos.array[ 3 * ( i + 1 ) + c ]; pos.array[ 3 * ( i + 1 ) + c ] = pos.array[ 3 * ( i + 2 ) + c ]; pos.array[ 3 * ( i + 2 ) + c ] = t; }
					const t = ez[ i + 1 ]; ez[ i + 1 ] = ez[ i + 2 ]; ez[ i + 2 ] = t;

				}

			}

			legParts.push( boxProjectUV( bevelNormals( g, ez, 1, LEG_BT ) ) );

		}

		// tail leg under the tail (x -0.265, z -1.456; Fig. 7), on a mounting plate across the
		// bottom board; tapered, 0.085 x 0.097 m at the top to 0.06 x 0.07 at the floor (Fig. 5)
		const TAIL = v2( - 0.265, - 1.456 );
		const TAIL_TOP = RIM_BOTTOM - 0.06;
		caseParts.push( woodBox( v3( - 0.448, TAIL_TOP, - 1.503 ), v3( - 0.065, RIM_BOTTOM - 0.03, - 1.397 ), { noUV: true, radius: 0.006 } ) );
		legParts.push( taperedBox( TAIL.x, TAIL.y, FOOT, TAIL_TOP, 0.06, 0.07, 0.085, 0.097 ) );

		// casters, one under each leg
		for ( const [ x, z ] of [ [ - LEG_OUT + 0.044, LEG_Z ], [ LEG_OUT - 0.044, LEG_Z ], [ TAIL.x, TAIL.y ] ] ) {

			brass.push( rod( v3( x, 0.04, z ), v3( x, FOOT, z ), 0.03, 24 ) );
			const wheel = new THREE.SphereGeometry( 0.03, 16, 12 );
			wheel.translate( x, 0.03, z );
			brass.push( wheel );

		}

		// the stretcher joining the front legs just above the floor (Fig. 2: the full width between
		// them, 6 cm high), with a deeper box in the middle holding the pedal pivots (Fig. 7)
		const ST0 = 0.035, ST1 = 0.095, STZ0 = - 0.323, STZ1 = - 0.279;
		stretcherParts.push( woodBox( v3( - LEG_OUT + 0.06, ST0, STZ0 ), v3( LEG_OUT - 0.06, ST1, STZ1 ), { noUV: true, radius: 0.008 } ) );
		stretcherParts.push( woodBox( v3( - 0.11, ST0, - 0.41 ), v3( 0.11, ST1 + 0.01, STZ1 - 0.002 ), { noUV: true, radius: 0.008 } ) );

		// frosted panel between the front legs, from the pedal box up to the keybed (Fig. 2: 0.30 m
		// wide; GF-TYPE-2/3), the two pedal rods behind it
		const panelMat = M.lyrePanel ?? new THREE.MeshPhysicalMaterial( { color: '#b9bcc1', metalness: 0.75, roughness: 0.42 } );		// (the crystal grand: its own, satin silver)
		group.add( mesh( woodBox( v3( - 0.15, ST1 + 0.01, - 0.375 ), v3( 0.15, FRONT_BOTTOM, - 0.365 ), { noUV: true } ), panelMat ) );
		const RODS_Y = 0.585;
		for ( const x of [ - 0.04, 0.05 ] ) steel.push( rod( v3( x, ST1, - 0.395 ), v3( x, RODS_Y, - 0.395 ), 0.006, 8 ) );

		// trapwork under the case (Figs. 5, 7): rods from the pedal rods back to the trapwork
		// block (sostenuto) and on to the damper lift, rising into the case
		caseParts.push( woodBox( v3( - 0.265, 0.60, - 0.80 ), v3( 0.18, RIM_BOTTOM - 0.03, - 0.72 ), { noUV: true, radius: 0.006 } ) );
		steel.push( rod( v3( - 0.04, RODS_Y, - 0.395 ), v3( - 0.04, RODS_Y, - 0.72 ), 0.006, 8 ) );
		steel.push( rod( v3( 0.05, RODS_Y, - 0.395 ), v3( 0.205, RODS_Y, - 0.99 ), 0.006, 8 ) );
		steel.push( rod( v3( 0.205, RODS_Y, - 0.99 ), v3( 0.205, RIM_BOTTOM - 0.03, - 0.99 ), 0.006, 8 ) );

		// control box under the keybed, treble side (Figs. 2, 7): 21.6 mm thick (0.4 of the 54 mm it was), its top
		// against the keybed's underside
		caseParts.push( woodBox( v3( 0.325, FRONT_BOTTOM - 0.0216, - 0.242 ), v3( 0.60, FRONT_BOTTOM, - 0.028 ), { noUV: true, radius: 0.004 } ) );

		// belly braces under the bottom board (Fig. 7): two from the trapwork block towards the
		// tail, two out to the bentside, and the cross beam in front of the tail leg
		const BR0 = RIM_BOTTOM - 0.065, BR1 = RIM_BOTTOM - 0.03;
		const brace = ( ax, az, bx, bz ) => {

			const a = v3( ax, ( BR0 + BR1 ) / 2, az ), b = v3( bx, ( BR0 + BR1 ) / 2, bz );
			caseParts.push( beam( a, b, 0.05, BR1 - BR0 ) );

		};

		brace( - 0.01, - 0.78, 0.09, - 1.30 );
		brace( - 0.15, - 0.78, - 0.35, - 1.31 );
		brace( 0.42, - 0.73, 0.55, - 0.90 );
		brace( 0.24, - 0.73, 0.35, - 1.04 );
		brace( 0.16, - 1.32, - 0.66, - 1.35 );

		// speaker grille on the underside of the front section, between the front legs (Fig. 7)
		{

			const w = 2 * ( LEG_OUT - LEG_W1 ) - 0.02, d = 0.20;
			const g = new THREE.PlaneGeometry( w, d );
			g.rotateX( Math.PI / 2 );			// facing down
			g.translate( 0, FRONT_BOTTOM - 0.002, - 0.40 );
			const uv = g.attributes.uv;
			for ( let i = 0; i < uv.count; ++ i ) uv.setXY( i, uv.getX( i ) * w / 0.04, uv.getY( i ) * d / 0.04 );
			group.add( mesh( g, grilleMaterial(), false ) );

		}

		group.add( mesh( merge( caseParts ), BASE ) );
		group.add( mesh( merge( legParts ), LEGS ) );
		group.add( mesh( merge( stretcherParts ), STRETCHER ) );
		group.add( mesh( merge( brass ), M.brass ) );
		group.add( mesh( merge( steel ), M.steel ) );

		// 7 brass pedals grouped 2-3-2 (Fig. 2): two function pedals left (page turn), soft,
		// sostenuto and sustain in the middle (clickable, animated), two function pedals right
		// (forward / back, tempo); pads reach 8 cm out of the stretcher (to z -0.20)
		const pedal = extrudeTop( pedalShape(), - 0.006, 0.006, { bevel: 0.002 } );
		pedal.scale( 0.9, 1, 0.62 );
		pedal.computeBoundingBox();
		const PIVOT_Y = 0.06, PIVOT_Z = - 0.31, TIP_Z = - 0.198;
		pedal.translate( 0, 0, TIP_Z - PIVOT_Z - pedal.boundingBox.max.z );
		[ [ 'f1', - 0.279 ], [ 'f2', - 0.198 ], [ 'soft', - 0.081 ], [ 'sostenuto', 0 ], [ 'sustain', 0.081 ], [ 'f3', 0.198 ], [ 'f4', 0.279 ] ].forEach( ( [ name, x ] ) => {

			const pivot = new THREE.Group();
			pivot.position.set( x, PIVOT_Y, PIVOT_Z );
			const m = mesh( pedal, M.brass );
			m.name = 'pedal-' + name;
			pivot.add( m );
			group.add( pivot );
			if ( name[ 0 ] === 'f' ) return;
			m.userData.pedal = name;
			pedals[ name ] = pivot;

		} );

	}

	const keyboard = new Keyboard( { white: M.keyWhite, black: M.keyBlack } );
	keyboard.group.position.set( 0, KEY_BOTTOM, 0 );
	group.add( keyboard.group );

	// the bench, in the case's lacquer, its front ~0.3 m from the keys
	const bench = buildBench( M.benchFrame ?? M.case, { dark: M.case.color.getHSL( {} ).l < 0.5, metal: M.benchMetal } );		// (the crystal's: its own, src/materials.js)
	bench.position.set( 0, 0, KEY_FRONT_Z + 0.48 );
	group.add( bench );

	return {
		group,
		keyboard,
		// the grand's hammers strike from below, seen through the strings behind the dampers.
		// Soft pedal: the whole keyboard and action shift right (una corda)
		action: new PianoAction( { hammers, dampers, pedals, softShift: [ keyboard.group, hammerRack ], softShiftAmount: 0.003 } ),
		depth: LENGTH,
		camera: { position: v3( 1.45, 1.5, 1.6 ), target: v3( 0.0, 0.85, - 0.5 ) },
		// MIDI roll plane (pianoroll.js): the display's face
		roll: { origin: SCREEN_BOTTOM.clone(), up: v3( 0, Math.cos( SCREEN_LEAN ), - Math.sin( SCREEN_LEAN ) ), height: SCREEN_H, width: SCREEN_W, screen: true },
	};

}

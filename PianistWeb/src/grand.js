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
import { woodBox, v3, extrudeTop, merge, beam, rod, boxProjectUV } from './geometry.js';
import { PianoAction } from './action.js';
import { pedalShape } from './upright.js';

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
const SOUNDBOARD_Y = RIM_BOTTOM + 0.10;
const PLATE_Y = RIM_BOTTOM + 0.15;			// top of the plate floor
const PLATE_RIB = 0.043;						// struts' and front bar's height above the floor (web + flange)
const PLATE_BAND = 0.035;						// the plate rim band along the case
const STRING_Y = PLATE_RIB + 0.007;				// tenor / treble strings above the floor at the pins (0.004 lower at the hitch pins)
const BASS_Y = STRING_Y + 0.018;				// overstrung bass, above the tenor
// the lid's front flap: hinged to the main lid along FOLD_Z, folded back onto it when open
// (Fig. 5 shows it lying on the lid from z = -0.65 to -0.99)
const FOLD_Z = - 0.65;
const SCREEN_EDGE_X = SCREEN_W / 2;			// side boards between the display's ends and the case sides

const v2 = ( x, y ) => new THREE.Vector2( x, y );

const mesh = ( geo, mat, cast = true ) => {

	const m = new THREE.Mesh( geo, mat );
	m.castShadow = cast;
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
	return p.getSpacedPoints( 240 );

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

	return extrudeTop( shape, y0, y1, { bevel, curveSegments: 64 } );

}

/**
 * Vertical ribbon along a polyline in (x, z) from y0 to y1, facing the polyline's left side
 * (the inside of the rim); UVs in metres (u along the polyline, v up) for the wood textures.
 */
function rimVeneer( pts, y0, y1 ) {

	const pos = [], uv = [];
	let u = 0;
	for ( let i = 1; i < pts.length; ++ i ) {

		const a = pts[ i - 1 ], b = pts[ i ];
		const du = a.distanceTo( b );
		const quad = [ [ a, y0, u ], [ b, y0, u + du ], [ b, y1, u + du ], [ a, y0, u ], [ b, y1, u + du ], [ a, y1, u ] ];
		for ( const [ p, y, uu ] of quad ) {

			pos.push( p.x, y, p.y );
			uv.push( uu, y );

		}

		u += du;

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.computeVertexNormals();
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

/** Inner end (z) of the case for a string running along -z at x. */
function caseEndZ( pts, x ) {

	let best = 0;
	for ( let i = 1; i < pts.length; ++ i ) {

		const a = pts[ i - 1 ], b = pts[ i ];
		if ( ( a.x - x ) * ( b.x - x ) <= 0 && a.x !== b.x ) {

			const t = ( x - a.x ) / ( b.x - a.x );
			best = Math.min( best, a.y + ( b.y - a.y ) * t );

		}

	}

	return best;

}

/** Keep the part of polygon `poly` (Vector2[]) where n·p >= c (Sutherland–Hodgman, one plane). */
function clipHalfPlane( poly, n, c ) {

	const out = [];
	for ( let i = 0; i < poly.length; ++ i ) {

		const a = poly[ i ], b = poly[ ( i + 1 ) % poly.length ];
		const da = n.dot( a ) - c, db = n.dot( b ) - c;
		if ( da >= 0 ) out.push( a );
		if ( ( da >= 0 ) !== ( db >= 0 ) ) out.push( a.clone().lerp( b, da / ( da - db ) ) );

	}

	return out;

}

/**
 * A plate opening: the region of `area` on the same side as `inside` of every strut, each strut
 * [a, b, halfWidth] a line through a and b widened by halfWidth.
 */
function plateOpening( area, struts, inside ) {

	let poly = area;
	for ( const [ a, b, w ] of struts ) {

		const d = new THREE.Vector2().subVectors( b, a ).normalize();
		let n = new THREE.Vector2( - d.y, d.x );
		if ( n.dot( inside ) < n.dot( a ) ) n = n.negate();
		poly = clipHalfPlane( poly, n, n.dot( a ) + w );
		if ( poly.length < 3 ) return null;

	}

	return poly;

}

/** The same surface seen from the other side (reversed triangles and normals), non-indexed. */
function insideOut( geo ) {

	const g = geo.toNonIndexed();
	for ( const name of [ 'position', 'normal', 'uv' ] ) {

		const at = g.attributes[ name ];
		if ( ! at ) continue;
		for ( let i = 0; i < at.count; i += 3 ) for ( let k = 0; k < at.itemSize; ++ k ) {

			const t = at.array[ ( i + 1 ) * at.itemSize + k ];
			at.array[ ( i + 1 ) * at.itemSize + k ] = at.array[ ( i + 2 ) * at.itemSize + k ];
			at.array[ ( i + 2 ) * at.itemSize + k ] = t;

		}

	}

	const n = g.attributes.normal;
	for ( let i = 0; i < n.array.length; ++ i ) n.array[ i ] = - n.array[ i ];
	return g;

}

/** A box tapering linearly from (w0, d0) at y0 to (w1, d1) at y1, centred on (x, z). */
function taperedBox( x, z, y0, y1, w0, d0, w1, d1 ) {

	const g = new THREE.BoxGeometry( 1, 1, 1 ).toNonIndexed();
	const p = g.attributes.position;
	for ( let i = 0; i < p.count; ++ i ) {

		const t = p.getY( i ) + 0.5;
		p.setXYZ( i, x + p.getX( i ) * THREE.MathUtils.lerp( w0, w1, t ), THREE.MathUtils.lerp( y0, y1, t ), z + p.getZ( i ) * THREE.MathUtils.lerp( d0, d1, t ) );

	}

	g.computeVertexNormals();
	return boxProjectUV( g );

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

	const group = new THREE.Group();
	const dampers = new Map();
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
		group.add( mesh( extrudeXZ( s, RIM_BOTTOM, RIM_TOP, 0.004 ), M.case ) );

		// bottom board (on to the front of the case, under the keybed), and the deeper front
		// section holding keybed and action, down to FRONT_BOTTOM back to z = -0.72 (Fig. 5)
		const closed = new THREE.Shape( [ v2( - HALF_W, FRONT_Z ), ...outer, v2( HALF_W, FRONT_Z ) ] );
		closed.closePath();
		group.add( mesh( extrudeXZ( closed, RIM_BOTTOM - 0.03, RIM_BOTTOM, 0.006 ), M.case ) );
		const front = new THREE.Shape( [ v2( - HALF_W, FRONT_Z ), ...outer.map( p => v2( p.x, Math.max( p.y, FRONT_SECTION_Z ) ) ), v2( HALF_W, FRONT_Z ) ] );
		front.closePath();
		group.add( mesh( extrudeXZ( front, FRONT_BOTTOM, RIM_BOTTOM - 0.03, 0.006 ), M.case ) );

		const sb = new THREE.Shape( inner );
		sb.closePath();
		group.add( mesh( extrudeXZ( sb, SOUNDBOARD_Y - 0.01, SOUNDBOARD_Y, 0 ), M.spruce ) );

		// front belly rail closing the case under the display (kept below its face: at 0.84 m its
		// top edge stood out of the screen as a ridge across the middle)
		group.add( mesh( woodBox( v3( - HALF_W, RIM_BOTTOM, FRONT_Z - RIM_T ), v3( HALF_W, 0.78, FRONT_Z ), { noUV: true } ), M.case ) );

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
		group.add( mesh( rimVeneer( offsetPolyline( inner, 0.0015 ), SOUNDBOARD_Y, RIM_TOP - 0.012 ), M.rimInner ?? M.case, false ) );

	}

	// --- plate ------------------------------------------------------------
	// A cast plate is ribs standing on edge, not a flat sheet: over a thin floor (with the
	// openings that show the soundboard), the front bar is a hollow box whose top carries three
	// round holes (GF-TYPE-3, Fig. 1); the bass-break, tenor and treble struts (at x -0.21, 0.10,
	// 0.40 behind the bar, top view Fig. 6) and a cross bar from the spine to the tenor strut are
	// T sections (a web with a flange on top); along the case the plate rim is a raised band
	// carrying the hitch pins. The strings run just above the ribs (PLATE_RIB below them)
	const plateY = PLATE_Y;
	const area = offsetPolyline( inner, 0.06 );		// inside the plate rim band
	{

		const plateOutline = offsetPolyline( inner, 0.02 );
		const s = new THREE.Shape( plateOutline );
		s.closePath();
		const W = 0.014;			// floor kept either side of a strut's centre line: just under its flange
		const bar = [ v2( - 1, - 0.58 ), v2( 1, - 0.58 ), 0 ];
		const bass = [ v2( - 0.21, - 0.58 ), v2( - 0.32, - 1.52 ), W ];
		const tenor = [ v2( 0.10, - 0.58 ), v2( 0.02, - 1.47 ), W ];
		const treble = [ v2( 0.40, - 0.58 ), v2( 0.30, - 1.14 ), W ];
		const cross = [ v2( - 0.75, - 1.00 ), v2( 0.03, - 1.12 ), W ];
		const openings = [
			[ [ bar, bass, cross ], v2( - 0.5, - 0.8 ) ],
			[ [ bar, bass, cross ], v2( - 0.5, - 1.3 ) ],
			[ [ bar, bass, tenor, cross ], v2( - 0.05, - 0.8 ) ],
			[ [ bar, bass, tenor, cross ], v2( - 0.13, - 1.3 ) ],
			[ [ bar, tenor, treble ], v2( 0.25, - 0.8 ) ],
			[ [ bar, treble ], v2( 0.6, - 0.75 ) ],
		];
		for ( const [ struts, inside ] of openings ) {

			const poly = plateOpening( area, struts, inside );
			if ( poly && Math.abs( THREE.ShapeUtils.area( poly ) ) > 0.004 ) s.holes.push( new THREE.Path( poly ) );

		}

		const HOLES = [ - 0.40, - 0.05, 0.27 ], HOLE_Z = - 0.47, HOLE_R = 0.045;
		for ( const cx of HOLES ) {

			const h = new THREE.Path();
			h.absellipse( cx, HOLE_Z, HOLE_R, HOLE_R, 0, Math.PI * 2, true );
			s.holes.push( h );

		}

		const parts = [ extrudeXZ( s, plateY - 0.012, plateY, 0.004 ) ];
		const top = plateY + PLATE_RIB;

		// T rib along a -> b (plan, (x, z)): web `t` thick up to `h` below the top, flange `f`
		// wide and `tf` thick on top
		const rib = ( a, b, h, t, f, tf ) => {

			const A = v3( a.x, 0, a.y ), B = v3( b.x, 0, b.y );
			parts.push( beam( A.clone().setY( plateY + ( h - tf ) / 2 ), B.clone().setY( plateY + ( h - tf ) / 2 ), t, h - tf ) );
			parts.push( beam( A.clone().setY( plateY + h - tf / 2 ), B.clone().setY( plateY + h - tf / 2 ), f, tf ) );

		};

		// a strut from its start on the bar, back to where it meets the rim band
		const inside = p => {

			let c = false;
			for ( let i = 0, j = area.length - 1; i < area.length; j = i ++ ) {

				const pi = area[ i ], pj = area[ j ];
				if ( ( pi.y > p.y ) !== ( pj.y > p.y ) && p.x < ( pj.x - pi.x ) * ( p.y - pi.y ) / ( pj.y - pi.y ) + pi.x ) c = ! c;

			}

			return c;

		};
		const toRim = ( a, b ) => {

			let end = a.clone();
			for ( let k = 1; k <= 400; ++ k ) {

				const p = a.clone().lerp( b, k / 400 * 1.3 );
				if ( ! inside( p ) ) break;
				end = p;

			}

			return end.addScaledVector( new THREE.Vector2().subVectors( b, a ).normalize(), 0.03 );		// into the band

		};
		for ( const [ a, b ] of [ bass, tenor, treble ] ) rib( a, toRim( a, b ), PLATE_RIB, 0.012, 0.024, 0.005 );
		// cross bar: spine (inside the band) to the tenor strut
		const tenorAt = x => tenor[ 0 ].clone().lerp( tenor[ 1 ], ( x - tenor[ 0 ].x ) / ( tenor[ 1 ].x - tenor[ 0 ].x ) );
		const cA = cross[ 0 ].clone().lerp( cross[ 1 ], 0.02 ), cB = cross[ 1 ].clone();
		cB.x = tenorAt( cB.x ).x;
		rib( cA, cB, PLATE_RIB - 0.008, 0.011, 0.02, 0.004 );

		// front bar: a hollow box from z -0.405 to -0.58, its top skin cut by the three holes
		const zF = - 0.405, zB = - 0.58, xL = - HALF_W + RIM_T + 0.03, xR = HALF_W - RIM_T - 0.03;
		rib( v2( xL, zB ), v2( xR, zB ), PLATE_RIB, 0.02, 0.02, 0.004 );
		rib( v2( xL, zF ), v2( xR, zF ), PLATE_RIB - 0.004, 0.014, 0.014, 0.004 );
		const skin = new THREE.Shape( [ v2( xL, zF ), v2( xR, zF ), v2( xR, zB ), v2( xL, zB ) ] );
		for ( const cx of HOLES ) {

			const h = new THREE.Path();
			h.absellipse( cx, HOLE_Z, HOLE_R, HOLE_R, 0, Math.PI * 2, true );
			skin.holes.push( h );
			// raised collar round each hole
			const ring = new THREE.Shape();
			ring.absellipse( cx, HOLE_Z, HOLE_R + 0.008, HOLE_R + 0.008, 0, Math.PI * 2, false );
			const bore = new THREE.Path();
			bore.absellipse( cx, HOLE_Z, HOLE_R, HOLE_R, 0, Math.PI * 2, true );
			ring.holes.push( bore );
			parts.push( extrudeXZ( ring, top - 0.006, top + 0.003, 0.0015 ) );
			// the hole's wall down to the floor (the box is hollow)
			parts.push( insideOut( new THREE.CylinderGeometry( HOLE_R + 0.001, HOLE_R + 0.001, PLATE_RIB, 32, 1, true ).translate( cx, plateY + PLATE_RIB / 2, HOLE_Z ) ) );

		}

		parts.push( extrudeXZ( skin, top - 0.006, top, 0.002 ) );

		// plate rim: a raised band along the case (sides and tail), from the case wall to the
		// openings, its inner edge a web down to the floor; the hitch pins stand on it
		const band = offsetPolyline( inner, 0.02 );
		for ( let i = 0; i + 1 < band.length; ++ i ) {

			if ( band[ i ].y > - 0.57 || band[ i + 1 ].y > - 0.57 ) continue;
			const q = new THREE.Shape( [ band[ i ], band[ i + 1 ], area[ i + 1 ], area[ i ] ] );
			parts.push( extrudeXZ( q, plateY - 0.001, plateY + PLATE_BAND, 0 ) );

		}

		group.add( mesh( merge( parts ), M.plate ) );

	}

	// --- strings, pins, dampers --------------------------------------------
	{

		const steel = [], copper = [], pins = [], hitch = [];
		const DAMPER_Z = - 0.385;
		const damperMats = [ M.hammerFelt, M.keyBlack ];
		// one damper per note, resting on the top of its string(s) at DAMPER_Z; lifts upwards
		const addDamper = ( i, a, b, r, w ) => {

			const t = ( DAMPER_Z - a.z ) / ( b.z - a.z );
			const p = a.clone().lerp( b, t );
			const felt = boxProjectUV( new THREE.BoxGeometry( w, 0.006, 0.026 ).translate( 0, 0.003, 0 ) );
			const block = boxProjectUV( new THREE.BoxGeometry( w - 0.001, 0.026, 0.030 ).translate( 0, 0.019, 0 ) );
			const node = new THREE.Group();
			node.position.set( p.x, p.y + r, p.z );
			node.rotation.y = Math.atan2( b.x - a.x, b.z - a.z );
			node.add( mesh( merge( [ felt ] ), damperMats[ 0 ] ), mesh( merge( [ block ] ), damperMats[ 1 ] ) );
			group.add( node );
			dampers.set( i + 21, { node, axis: 'y', lift: 0.010 } );

		};
		const n = 88;
		const x0 = - HALF_W + 0.08, x1 = HALF_W - 0.06;
		const pinZ = - 0.29;
		const bassCount = 22;
		for ( let i = 0; i < n; ++ i ) {

			const t = i / ( n - 1 );
			const x = x0 + ( x1 - x0 ) * t;
			const zPin = pinZ - ( i % 2 ) * 0.02;
			// tuning pins up to just above their string
			const pinTop = plateY + ( i < bassCount ? BASS_Y : STRING_Y ) + 0.008;
			pins.push( rod( v3( x - 0.004, plateY, zPin ), v3( x - 0.004, pinTop, zPin ), 0.0035, 8 ) );
			pins.push( rod( v3( x + 0.004, plateY, zPin - 0.01 ), v3( x + 0.004, pinTop, zPin - 0.01 ), 0.0035, 8 ) );

			if ( i < bassCount ) {

				// bass fan: from the left front diagonally towards the tail, above the tenor strings
				const a = v3( x, plateY + BASS_Y, zPin );
				const endX = - 0.55 + 0.45 * t * n / bassCount;
				const b = v3( endX, plateY + BASS_Y - 0.006, caseEndZ( inner, endX ) + 0.06 );
				hitch.push( rod( v3( endX, plateY + PLATE_BAND, b.z - 0.004 ), v3( endX, b.y + 0.004, b.z - 0.004 ), 0.0022, 6 ) );
				copper.push( beam( a, b, 0.003, 0.003 ) );
				addDamper( i, a, b, 0.0015, 0.011 );

			} else {

				const endZ = caseEndZ( inner, x ) + 0.06;
				const a = v3( x - 0.003, plateY + STRING_Y, zPin ), b = v3( x - 0.003, plateY + STRING_Y - 0.004, endZ );
				hitch.push( rod( v3( x, plateY + PLATE_BAND, endZ - 0.004 ), v3( x, b.y + 0.004, endZ - 0.004 ), 0.0022, 6 ) );
				steel.push( beam( a, b, 0.0012, 0.0012 ) );
				steel.push( beam( a.clone().setX( x + 0.003 ), b.clone().setX( x + 0.003 ), 0.0012, 0.0012 ) );
				if ( i < 68 ) addDamper( i, a.clone().setX( x ), b.clone().setX( x ), 0.0006, 0.012 );

			}

		}

		group.add( mesh( merge( steel ), M.steel ) );
		group.add( mesh( merge( copper ), M.copper ) );
		group.add( mesh( merge( pins ), M.steel ) );
		group.add( mesh( merge( hitch ), M.steel ) );		// hitch pins on the plate rim band

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

		const hinges = [];
		for ( const x of [ - 0.5, 0.0, 0.5 ] ) hinges.push( woodBox( v3( x - 0.025, open ? 2 * T - 0.001 : T - 0.001, FOLD_Z - 0.02 ), v3( x + 0.025, open ? 2 * T + 0.001 : T + 0.001, FOLD_Z + 0.02 ), { noUV: true } ) );
		for ( const z of [ - 0.75, - 1.21 ] ) hinges.push( woodBox( v3( - HALF_W - 0.002, - 0.035, z - 0.03 ), v3( - HALF_W + 0.001, T, z + 0.03 ), { noUV: true } ) );
		for ( const g of [ lidGeo, flapGeo, ...hinges ] ) g.translate( HALF_W, 0, 0 );		// hinge along the spine at x = -HALF_W
		const pivot = new THREE.Group();
		pivot.position.set( - HALF_W, RIM_TOP, 0 );
		pivot.rotation.z = THREE.MathUtils.degToRad( lidAngle );
		pivot.add( mesh( lidGeo, M.case ), mesh( flapGeo, M.case ), mesh( merge( hinges ), M.brass ) );
		group.add( pivot );

		if ( open ) {

			// prop stick from the bentside rim up to the lid
			const zs = - 0.88;
			const bx = bentsideX( outer, zs ) - 0.06;
			const base = v3( bx, RIM_TOP, zs );
			const a = THREE.MathUtils.degToRad( lidAngle );
			const r = ( bx + HALF_W ) * 0.86;
			const top = v3( - HALF_W + r * Math.cos( a ), RIM_TOP + r * Math.sin( a ), zs );
			group.add( mesh( rod( base, top, 0.011, 12, 0.009 ), M.case ) );

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
		const geo = new THREE.BoxGeometry( SCREEN_W, SCREEN_H, SCREEN_T );
		geo.translate( 0, SCREEN_H / 2, - SCREEN_T / 2 - 0.0005 );
		const screen = mesh( geo, M.panel );
		screen.name = 'panel';
		screen.position.copy( SCREEN_BOTTOM );
		screen.rotation.x = - SCREEN_LEAN;
		group.add( screen );

	}

	// --- legs and the frame below the case (USD834638 Figs. 1, 2, 5, 7) ------------------------
	{

		const caseParts = [], brass = [], steel = [];

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
		for ( const sx of [ - 1, 1 ] ) {

			const g = new THREE.ExtrudeGeometry( prof, { depth: 1, bevelEnabled: false, curveSegments: 16 } ).toNonIndexed();
			g.rotateY( - Math.PI / 2 );			// profile (z, y) -> world (z, y); extrusion -> -x, 0..-1
			const pos = g.attributes.position;
			for ( let i = 0; i < pos.count; ++ i ) {

				// width tapers towards the floor; the outer face stays vertical
				const t = THREE.MathUtils.clamp( ( pos.getY( i ) - FOOT ) / ( FRONT_BOTTOM - FOOT ), 0, 1 );
				const w = THREE.MathUtils.lerp( LEG_W0, LEG_W1, t );
				pos.setX( i, sx * ( LEG_OUT + pos.getX( i ) * w ) );

			}

			if ( sx < 0 ) {

				// mirrored: restore the winding
				const idx = [];
				for ( let i = 0; i < pos.count; i += 3 ) idx.push( i, i + 2, i + 1 );
				g.setIndex( idx );

			}

			g.computeVertexNormals();
			caseParts.push( boxProjectUV( g.index ? g.toNonIndexed() : g ) );

		}

		// tail leg under the tail (x -0.265, z -1.456; Fig. 7), on a mounting plate across the
		// bottom board; tapered, 0.085 x 0.097 m at the top to 0.06 x 0.07 at the floor (Fig. 5)
		const TAIL = v2( - 0.265, - 1.456 );
		const TAIL_TOP = RIM_BOTTOM - 0.06;
		caseParts.push( woodBox( v3( - 0.448, TAIL_TOP, - 1.503 ), v3( - 0.065, RIM_BOTTOM - 0.03, - 1.397 ), { noUV: true, radius: 0.006 } ) );
		caseParts.push( taperedBox( TAIL.x, TAIL.y, FOOT, TAIL_TOP, 0.06, 0.07, 0.085, 0.097 ) );

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
		caseParts.push( woodBox( v3( - LEG_OUT + 0.06, ST0, STZ0 ), v3( LEG_OUT - 0.06, ST1, STZ1 ), { noUV: true, radius: 0.008 } ) );
		caseParts.push( woodBox( v3( - 0.11, ST0, - 0.41 ), v3( 0.11, ST1 + 0.01, STZ1 - 0.002 ), { noUV: true, radius: 0.008 } ) );

		// frosted panel between the front legs, from the pedal box up to the keybed (Fig. 2: 0.30 m
		// wide; GF-TYPE-2/3), the two pedal rods behind it
		const panelMat = new THREE.MeshPhysicalMaterial( { color: '#b9bcc1', metalness: 0.75, roughness: 0.42 } );
		group.add( mesh( woodBox( v3( - 0.15, ST1 + 0.01, - 0.375 ), v3( 0.15, FRONT_BOTTOM, - 0.365 ), { noUV: true } ), panelMat ) );
		const RODS_Y = 0.585;
		for ( const x of [ - 0.04, 0.05 ] ) steel.push( rod( v3( x, ST1, - 0.395 ), v3( x, RODS_Y, - 0.395 ), 0.006, 8 ) );

		// trapwork under the case (Figs. 5, 7): rods from the pedal rods back to the trapwork
		// block (sostenuto) and on to the damper lift, rising into the case
		caseParts.push( woodBox( v3( - 0.265, 0.60, - 0.80 ), v3( 0.18, RIM_BOTTOM - 0.03, - 0.72 ), { noUV: true, radius: 0.006 } ) );
		steel.push( rod( v3( - 0.04, RODS_Y, - 0.395 ), v3( - 0.04, RODS_Y, - 0.72 ), 0.006, 8 ) );
		steel.push( rod( v3( 0.05, RODS_Y, - 0.395 ), v3( 0.205, RODS_Y, - 0.99 ), 0.006, 8 ) );
		steel.push( rod( v3( 0.205, RODS_Y, - 0.99 ), v3( 0.205, RIM_BOTTOM - 0.03, - 0.99 ), 0.006, 8 ) );

		// control box under the keybed, treble side (Figs. 2, 7)
		caseParts.push( woodBox( v3( 0.325, FRONT_BOTTOM - 0.054, - 0.242 ), v3( 0.60, FRONT_BOTTOM, - 0.028 ), { noUV: true, radius: 0.004 } ) );

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

		group.add( mesh( merge( caseParts ), M.case ) );
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

	return {
		group,
		keyboard,
		// the grand's hammers strike from below, hidden in the case; only the dampers show.
		// Soft pedal: the whole keyboard and action shift right (una corda)
		action: new PianoAction( { dampers, pedals, softShift: keyboard.group, softShiftAmount: 0.003 } ),
		depth: LENGTH,
		camera: { position: v3( 1.45, 1.5, 1.6 ), target: v3( 0.0, 0.85, - 0.5 ) },
		// MIDI roll plane (pianoroll.js): the display's face
		roll: { origin: SCREEN_BOTTOM.clone(), up: v3( 0, Math.cos( SCREEN_LEAN ), - Math.sin( SCREEN_LEAN ) ), height: SCREEN_H, width: SCREEN_W, screen: true },
	};

}

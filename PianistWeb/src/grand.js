// Grand piano (~1.9 m): bentside rim, open lid on a prop stick, gold plate, overstrung
// strings, dampers, music desk, three tapered legs and a lyre with pedals.
//
// Frame: origin at floor below the keyboard center, key fronts at z = 0, body towards -z.

import * as THREE from 'three';
import { Keyboard } from './keyboard.js';
import { woodBox, v3, extrudeTop, merge, beam, rod } from './geometry.js';
import { pedalShape } from './upright.js';

const KEY_BOTTOM = 0.698;
const RIM_BOTTOM = 0.62;
const RIM_TOP = 0.985;
const RIM_T = 0.045;
const HALF_W = 0.74;
const FRONT_Z = - 0.20;			// rim front (behind the fallboard)
const LENGTH = 1.90;

const mesh = ( geo, mat, cast = true ) => {

	const m = new THREE.Mesh( geo, mat );
	m.castShadow = cast;
	m.receiveShadow = true;
	return m;

};

/** Open polyline of the rim in (x, z) running from front-left round the tail to front-right. */
function rimPath() {

	const p = new THREE.Path();
	p.moveTo( - HALF_W, FRONT_Z );
	p.lineTo( - HALF_W, - 1.62 );
	p.quadraticCurveTo( - HALF_W, - LENGTH, - 0.48, - LENGTH );
	p.bezierCurveTo( - 0.30, - LENGTH, - 0.20, - 1.86, - 0.12, - 1.72 );
	p.bezierCurveTo( 0.02, - 1.36, 0.30, - 1.02, 0.56, - 0.80 );
	p.bezierCurveTo( 0.72, - 0.64, HALF_W, - 0.48, HALF_W, - 0.34 );
	p.lineTo( HALF_W, FRONT_Z );
	return p.getSpacedPoints( 220 );

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

export function buildGrand( M, { lidAngle = 34 } = {} ) {

	const group = new THREE.Group();
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

		// bottom board and soundboard
		const closed = new THREE.Shape( outer );
		closed.closePath();
		group.add( mesh( extrudeXZ( closed, RIM_BOTTOM - 0.06, RIM_BOTTOM, 0.006 ), M.case ) );

		const sb = new THREE.Shape( inner );
		sb.closePath();
		group.add( mesh( extrudeXZ( sb, RIM_BOTTOM + 0.15, RIM_BOTTOM + 0.16, 0 ), M.spruce ) );

		// front belly rail closing the rim behind the fallboard
		group.add( mesh( woodBox( v3( - HALF_W, RIM_BOTTOM, FRONT_Z - RIM_T ), v3( HALF_W, 0.84, FRONT_Z ), { noUV: true } ), M.case ) );

	}

	// --- plate ------------------------------------------------------------
	const plateY = RIM_BOTTOM + 0.20;
	{

		const plateOutline = offsetPolyline( inner, 0.02 );
		const s = new THREE.Shape( plateOutline );
		s.closePath();
		const holes = [
			[ - 0.40, - 0.62, 0.22, 0.13 ],
			[ 0.10, - 0.55, 0.20, 0.12 ],
			[ - 0.38, - 1.12, 0.18, 0.16 ],
			[ 0.02, - 1.02, 0.12, 0.16 ],
			[ - 0.32, - 1.55, 0.14, 0.12 ],
		];
		for ( const [ cx, cz, rx, rz ] of holes ) {

			const h = new THREE.Path();
			h.absellipse( cx, cz, rx, rz, 0, Math.PI * 2, true );
			s.holes.push( h );

		}

		group.add( mesh( extrudeXZ( s, plateY - 0.012, plateY, 0.004 ), M.plate ) );

	}

	// --- strings, pins, dampers --------------------------------------------
	{

		const steel = [], copper = [], pins = [], dampers = [];
		const n = 88;
		const x0 = - HALF_W + 0.08, x1 = HALF_W - 0.06;
		const pinZ = - 0.29;
		const bassCount = 22;
		for ( let i = 0; i < n; ++ i ) {

			const t = i / ( n - 1 );
			const x = x0 + ( x1 - x0 ) * t;
			const zPin = pinZ - ( i % 2 ) * 0.02;
			pins.push( rod( v3( x - 0.004, plateY, zPin ), v3( x - 0.004, plateY + 0.03, zPin ), 0.0035, 8 ) );
			pins.push( rod( v3( x + 0.004, plateY, zPin - 0.01 ), v3( x + 0.004, plateY + 0.03, zPin - 0.01 ), 0.0035, 8 ) );

			if ( i < bassCount ) {

				// bass fan: from the left front diagonally towards the tail, above the tenor strings
				const a = v3( x, plateY + 0.03, zPin );
				const endX = - 0.55 + 0.45 * t * n / bassCount;
				const b = v3( endX, plateY + 0.02, caseEndZ( inner, endX ) + 0.06 );
				copper.push( beam( a, b, 0.003, 0.003 ) );

			} else {

				const endZ = caseEndZ( inner, x ) + 0.06;
				const a = v3( x - 0.003, plateY + 0.012, zPin ), b = v3( x - 0.003, plateY + 0.008, endZ );
				steel.push( beam( a, b, 0.0012, 0.0012 ) );
				steel.push( beam( a.clone().setX( x + 0.003 ), b.clone().setX( x + 0.003 ), 0.0012, 0.0012 ) );

			}

			// dampers sit above the strings a little behind the hammers
			if ( i < 70 ) dampers.push( woodBox( v3( x - 0.006, plateY + 0.03, - 0.40 ), v3( x + 0.006, plateY + 0.06, - 0.37 ), { noUV: true, radius: 0.002 } ) );

		}

		group.add( mesh( merge( steel ), M.steel ) );
		group.add( mesh( merge( copper ), M.copper ) );
		group.add( mesh( merge( pins ), M.steel ) );
		group.add( mesh( merge( dampers ), M.keyBlack ) );

		// pin block cover / plate flange across the front
		group.add( mesh( woodBox( v3( - HALF_W + RIM_T, plateY, - 0.33 ), v3( HALF_W - RIM_T, plateY + 0.006, - 0.245 ), { noUV: true } ), M.plate ) );

	}

	// --- lid -------------------------------------------------------------
	{

		const s = new THREE.Shape( outer );
		s.closePath();
		const geo = extrudeXZ( s, 0, 0.02, 0.004 );
		// hinge along the straight (bass) side at x = -HALF_W
		geo.translate( HALF_W, 0, 0 );
		const pivot = new THREE.Group();
		pivot.position.set( - HALF_W, RIM_TOP, 0 );
		pivot.rotation.z = THREE.MathUtils.degToRad( lidAngle );
		pivot.add( mesh( geo, M.case ) );
		group.add( pivot );

		if ( lidAngle > 2 ) {

			// prop stick from the bentside rim up to the lid
			const zs = - 0.95;
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
		group.add( mesh( woodBox( v3( - 0.66, 0.62, - 0.25 ), v3( 0.66, 0.685, 0 ), { noUV: true } ), M.keybed ) );
		group.add( mesh( woodBox( v3( - 0.70, 0.655, - 0.01 ), v3( 0.70, 0.705, 0.022 ), { noUV: true, radius: 0.004 } ), M.case ) );
		// cheek blocks
		for ( const sx of [ - 1, 1 ] ) {

			const a = v3( sx < 0 ? - HALF_W : 0.618, 0.62, - 0.25 );
			const b = v3( sx < 0 ? - 0.618 : HALF_W, 0.80, 0.022 );
			group.add( mesh( woodBox( a, b, { noUV: true, radius: 0.008 } ), M.case ) );

		}

		// fallboard (open, standing behind the key backs) and felt strip
		group.add( mesh( woodBox( v3( - 0.618, 0.72, - 0.19 ), v3( 0.618, 0.86, - 0.155 ), { noUV: true, radius: 0.006 } ), M.case ) );
		group.add( mesh( woodBox( v3( - 0.618, 0.72, - 0.157 ), v3( 0.618, 0.737, - 0.146 ), { noUV: true } ), M.redFelt ) );

		// music desk
		const desk = mesh( new THREE.BoxGeometry( 0.86, 0.30, 0.014 ), M.case );
		desk.geometry.translate( 0, 0.15, 0 );
		desk.position.set( 0, RIM_TOP + 0.005, - 0.36 );
		desk.rotation.x = - THREE.MathUtils.degToRad( 16 );
		group.add( desk );
		const ledge = mesh( woodBox( v3( - 0.43, - 0.004, 0 ), v3( 0.43, 0.02, 0.035 ), { noUV: true } ), M.case );
		ledge.position.copy( desk.position );
		ledge.rotation.copy( desk.rotation );
		group.add( ledge );

	}

	// --- legs ----------------------------------------------------------------
	{

		const legs = [ v3( - 0.64, 0, - 0.12 ), v3( 0.64, 0, - 0.12 ), v3( - 0.36, 0, - 1.70 ) ];
		const brass = [];
		const legGeos = [];
		for ( const p of legs ) {

			const h = RIM_BOTTOM - 0.06 - 0.07;
			const g = new THREE.CylinderGeometry( 0.06, 0.042, h, 4, 1 ).toNonIndexed();
			g.rotateY( Math.PI / 4 );
			g.computeVertexNormals();
			g.translate( p.x, 0.07 + h / 2, p.z );
			legGeos.push( g );
			// block at the top of the leg
			legGeos.push( woodBox( v3( p.x - 0.07, RIM_BOTTOM - 0.10, p.z - 0.07 ), v3( p.x + 0.07, RIM_BOTTOM - 0.06, p.z + 0.07 ), { noUV: true, radius: 0.006 } ) );
			brass.push( rod( v3( p.x, 0.04, p.z ), v3( p.x, 0.075, p.z ), 0.032, 24 ) );
			const wheel = new THREE.SphereGeometry( 0.03, 16, 12 );
			wheel.translate( p.x, 0.03, p.z );
			brass.push( wheel );

		}

		group.add( mesh( merge( legGeos ), M.case ) );

		// lyre
		const lyre = [];
		for ( const x of [ - 0.09, 0.09 ] ) lyre.push( woodBox( v3( x - 0.018, 0.12, - 0.61 ), v3( x + 0.018, RIM_BOTTOM - 0.06, - 0.57 ), { noUV: true, radius: 0.006 } ) );
		lyre.push( woodBox( v3( - 0.20, 0.035, - 0.66 ), v3( 0.20, 0.13, - 0.52 ), { noUV: true, radius: 0.01 } ) );
		lyre.push( rod( v3( - 0.15, 0.10, - 0.66 ), v3( - 0.30, RIM_BOTTOM - 0.06, - 1.10 ), 0.008, 8 ) );
		lyre.push( rod( v3( 0.15, 0.10, - 0.66 ), v3( 0.30, RIM_BOTTOM - 0.06, - 1.10 ), 0.008, 8 ) );
		group.add( mesh( merge( lyre ), M.case ) );

		const pedal = extrudeTop( pedalShape(), 0.065, 0.077, { bevel: 0.003 } );
		for ( const x of [ - 0.075, 0, 0.075 ] ) brass.push( pedal.clone().translate( x, 0, - 0.52 + 0.215 - 0.03 ) );
		group.add( mesh( merge( brass ), M.brass ) );

	}

	const keyboard = new Keyboard( { white: M.keyWhite, black: M.keyBlack } );
	keyboard.group.position.set( 0, KEY_BOTTOM, 0 );
	group.add( keyboard.group );

	return {
		group,
		keyboard,
		depth: LENGTH,
		camera: { position: v3( 1.55, 1.55, 1.65 ), target: v3( 0.0, 0.85, - 0.65 ) },
	};

}

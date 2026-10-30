// Grand piano after the FIND GF smart grand (GF156C / F150G: 150 W x 156-160 D x 100 H cm;
// Footages.local/find/GF-TYPE-*.jpg, MHGF*.jpg; diary-job memo/piano/grand-piano-design-
// references.md): bentside rim with a wood-veneered inner face, open lid on a prop stick, gold
// plate, overstrung strings, dampers, a full-width tilted display in place of the fallboard and
// music desk (bezel 1343 x 320 mm, 117° to the keyboard plane), square tapered legs on gold
// casters and, instead of a lyre, a metal pedal bar between the front legs with 7 pedals (the
// 3 standard ones in the middle, 2 function pedals each side).
//
// Frame: origin at floor below the keyboard center, key fronts at z = 0, body towards -z.

import * as THREE from 'three';
import { Keyboard } from './keyboard.js';
import { woodBox, v3, extrudeTop, merge, beam, rod, boxProjectUV } from './geometry.js';
import { PianoAction } from './action.js';
import { pedalShape } from './upright.js';

const KEY_BOTTOM = 0.698;
const RIM_BOTTOM = 0.62;
const RIM_TOP = 0.985;
const RIM_T = 0.045;
const HALF_W = 0.745;			// 1.49 m wide
const FRONT_Z = - 0.20;			// rim front (behind the display)
const LENGTH = 1.56;			// case length (F150G 1555 mm)
// the curves below were drawn for a 1.90 m case; Z() maps their depth to LENGTH (front fixed)
const K = ( LENGTH + FRONT_Z ) / ( 1.90 + FRONT_Z );
const Z = z => FRONT_Z + ( z - FRONT_Z ) * K;

// display: bezel 1343 x 320 mm leaning back 27° (117° to the keys), standing on the key-back
// felt like the upright's screen
const SCREEN_W = 1.343, SCREEN_H = 0.32, SCREEN_T = 0.03;
const SCREEN_LEAN = THREE.MathUtils.degToRad( 27 );
const SCREEN_BOTTOM = v3( 0, 0.737, - 0.150 );
// the lid's front edge: just behind the display's top (it stands above the rim top)
const LID_FRONT_Z = SCREEN_BOTTOM.z - ( SCREEN_H * Math.sin( SCREEN_LEAN ) + SCREEN_T * Math.cos( SCREEN_LEAN ) ) - 0.008;

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
	p.lineTo( - HALF_W, Z( - 1.62 ) );
	p.quadraticCurveTo( - HALF_W, - LENGTH, - 0.48, - LENGTH );
	p.bezierCurveTo( - 0.30, - LENGTH, - 0.20, Z( - 1.86 ), - 0.12, Z( - 1.72 ) );
	p.bezierCurveTo( 0.02, Z( - 1.36 ), 0.30, Z( - 1.02 ), 0.56, Z( - 0.80 ) );
	p.bezierCurveTo( 0.72, Z( - 0.64 ), HALF_W, Z( - 0.48 ), HALF_W, Z( - 0.34 ) );
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

		// bottom board and soundboard
		const closed = new THREE.Shape( outer );
		closed.closePath();
		group.add( mesh( extrudeXZ( closed, RIM_BOTTOM - 0.06, RIM_BOTTOM, 0.006 ), M.case ) );

		const sb = new THREE.Shape( inner );
		sb.closePath();
		group.add( mesh( extrudeXZ( sb, RIM_BOTTOM + 0.15, RIM_BOTTOM + 0.16, 0 ), M.spruce ) );

		// front belly rail closing the rim behind the display
		group.add( mesh( woodBox( v3( - HALF_W, RIM_BOTTOM, FRONT_Z - RIM_T ), v3( HALF_W, 0.84, FRONT_Z ), { noUV: true } ), M.case ) );

		// inner rim veneer (the photos show warm wood inside the lacquered case), from the
		// soundboard up to just below the rim top
		group.add( mesh( rimVeneer( offsetPolyline( inner, 0.0015 ), RIM_BOTTOM + 0.16, RIM_TOP - 0.012 ), M.rimInner ?? M.case, false ) );

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
			h.absellipse( cx, Z( cz ), rx, rz * K, 0, Math.PI * 2, true );
			s.holes.push( h );

		}

		group.add( mesh( extrudeXZ( s, plateY - 0.012, plateY, 0.004 ), M.plate ) );

	}

	// --- strings, pins, dampers --------------------------------------------
	{

		const steel = [], copper = [], pins = [];
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
			pins.push( rod( v3( x - 0.004, plateY, zPin ), v3( x - 0.004, plateY + 0.03, zPin ), 0.0035, 8 ) );
			pins.push( rod( v3( x + 0.004, plateY, zPin - 0.01 ), v3( x + 0.004, plateY + 0.03, zPin - 0.01 ), 0.0035, 8 ) );

			if ( i < bassCount ) {

				// bass fan: from the left front diagonally towards the tail, above the tenor strings
				const a = v3( x, plateY + 0.03, zPin );
				const endX = - 0.55 + 0.45 * t * n / bassCount;
				const b = v3( endX, plateY + 0.02, caseEndZ( inner, endX ) + 0.06 );
				copper.push( beam( a, b, 0.003, 0.003 ) );
				addDamper( i, a, b, 0.0015, 0.011 );

			} else {

				const endZ = caseEndZ( inner, x ) + 0.06;
				const a = v3( x - 0.003, plateY + 0.012, zPin ), b = v3( x - 0.003, plateY + 0.008, endZ );
				steel.push( beam( a, b, 0.0012, 0.0012 ) );
				steel.push( beam( a.clone().setX( x + 0.003 ), b.clone().setX( x + 0.003 ), 0.0012, 0.0012 ) );
				if ( i < 68 ) addDamper( i, a.clone().setX( x ), b.clone().setX( x ), 0.0006, 0.012 );

			}

		}

		group.add( mesh( merge( steel ), M.steel ) );
		group.add( mesh( merge( copper ), M.copper ) );
		group.add( mesh( merge( pins ), M.steel ) );

		// pin block cover / plate flange across the front
		group.add( mesh( woodBox( v3( - HALF_W + RIM_T, plateY, - 0.33 ), v3( HALF_W - RIM_T, plateY + 0.006, - 0.245 ), { noUV: true } ), M.plate ) );

	}

	// --- lid -------------------------------------------------------------
	{

		const s = new THREE.Shape( outer.map( p => new THREE.Vector2( p.x, Math.min( p.y, LID_FRONT_Z ) ) ) );
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
			const zs = Z( - 0.95 );
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
		group.add( mesh( woodBox( v3( - 0.66, 0.62, - 0.25 ), v3( 0.66, 0.655, - 0.012 ), { noUV: true } ), M.case ) );
		group.add( mesh( woodBox( v3( - 0.70, 0.655, - 0.01 ), v3( 0.70, 0.705, 0.022 ), { noUV: true, radius: 0.004 } ), M.case ) );
		// cheek blocks
		for ( const sx of [ - 1, 1 ] ) {

			const a = v3( sx < 0 ? - HALF_W : 0.618, 0.62, - 0.25 );
			const b = v3( sx < 0 ? - 0.618 : HALF_W, 0.80, 0.022 );
			group.add( mesh( woodBox( a, b, { noUV: true, radius: 0.008 } ), M.case ) );

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

	// --- legs ----------------------------------------------------------------
	{

		// square legs tapering to gold casters: two under the cheek blocks, one under the tail
		const legs = [ v3( - 0.655, 0, - 0.11 ), v3( 0.655, 0, - 0.11 ), v3( - 0.36, 0, Z( - 1.70 ) ) ];
		const brass = [];
		const legGeos = [];
		for ( const p of legs ) {

			const h = RIM_BOTTOM - 0.06 - 0.07;
			const g = new THREE.CylinderGeometry( 0.066, 0.046, h, 4, 1 ).toNonIndexed();
			g.rotateY( Math.PI / 4 );
			g.computeVertexNormals();
			g.translate( p.x, 0.07 + h / 2, p.z );
			legGeos.push( g );
			// block at the top of the leg
			legGeos.push( woodBox( v3( p.x - 0.075, RIM_BOTTOM - 0.10, p.z - 0.075 ), v3( p.x + 0.075, RIM_BOTTOM - 0.06, p.z + 0.075 ), { noUV: true, radius: 0.006 } ) );
			brass.push( rod( v3( p.x, 0.04, p.z ), v3( p.x, 0.075, p.z ), 0.034, 24 ) );
			const wheel = new THREE.SphereGeometry( 0.03, 16, 12 );
			wheel.translate( p.x, 0.03, p.z );
			brass.push( wheel );

		}

		group.add( mesh( merge( legGeos ), M.case ) );
		group.add( mesh( merge( brass ), M.brass ) );

		// no lyre: a metal pedal bar between the front legs (hollow alloy frame), a deeper box in
		// the middle holding the pedal pivots
		const bar = [];
		bar.push( woodBox( v3( - 0.62, 0.075, - 0.13 ), v3( 0.62, 0.105, - 0.09 ), { noUV: true, radius: 0.006 } ) );
		bar.push( woodBox( v3( - 0.235, 0.06, - 0.17 ), v3( 0.235, 0.12, - 0.08 ), { noUV: true, radius: 0.01 } ) );
		group.add( mesh( merge( bar ), M.steel ) );

		// 7 pedals: soft, sostenuto, sustain in the middle (clickable, animated) and the four
		// function pedals (page turn, forward / back, tempo) beside them
		const pedal = extrudeTop( pedalShape(), 0.081, 0.093, { bevel: 0.003 } );
		const pivotY = 0.087, pivotZ = - 0.13;
		pedal.translate( 0, - pivotY, 0.195 );
		const PITCH = 0.062;
		[ [ 'f1', - 3 ], [ 'f2', - 2 ], [ 'soft', - 1 ], [ 'sostenuto', 0 ], [ 'sustain', 1 ], [ 'f3', 2 ], [ 'f4', 3 ] ].forEach( ( [ name, i ] ) => {

			const pivot = new THREE.Group();
			pivot.position.set( i * PITCH, pivotY, pivotZ );
			const m = mesh( pedal, M.steel );
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

// Upright string scale and wrest-pin field, following Footages.local/upright-scale
// (Wolfenden 1916 "Scale Drawing"; CN209947410U):
//  - keys 1–14 single wound, 15–32 double wound (bass, overstrung, 30°→40° from vertical),
//    33–58 tenor and 59–88 treble trichords (leaning the other way, ~20°→13°)
//  - strike-line pitch: bass 14.0/14.2 mm, tenor 13.5 mm, treble 13.0 mm, gaps at the struts
//  - trichord pins on 6 parallel lines above the pressure bar, spacing 8→12 mm towards the treble;
//    even notes use lines 1·3·5, odd notes 2·4·6, the unison's three strings converge upward
//  - bass pins in 2 rows above stud bearings; double strings: bass-side string to the lower row
//  - pin Ø6.85 with coil Ø9.1, pin sits on the treble side of its string
//
// Coordinates: x along the keyboard, y up (absolute), strings in planes of constant z.

import * as THREE from 'three';
import { v3, merge, rod, beam, woodBox } from './geometry.js';

const lerp = THREE.MathUtils.lerp;
const D2R = Math.PI / 180;
const PIN_R = 0.00685 / 2;
const COIL_R = 0.0091 / 2;

function intersect( p, d, a, b ) {

	// p + t d = a + s (b - a) -> t
	const e = new THREE.Vector2().subVectors( b, a );
	const den = d.x * e.y - d.y * e.x;
	return ( ( a.x - p.x ) * e.y - ( a.y - p.y ) * e.x ) / den;

}

/** Per-note layout in the (x, y) plane, relative to the strike line at y = 0. */
export function uprightScale() {

	const notes = [];
	let x = 0;
	for ( let n = 1; n <= 88; ++ n ) {

		if ( n > 1 ) x += n <= 14 ? 0.0140 : n === 15 ? 0.0141 : n <= 32 ? 0.0142 : n === 33 ? 0.034 : n <= 58 ? 0.0135 : n === 59 ? 0.028 : 0.0130;
		const section = n <= 32 ? 'bass' : n <= 58 ? 'tenor' : 'treble';
		const unison = n <= 14 ? 1 : n <= 32 ? 2 : 3;
		// angle from vertical; positive leans the top towards the treble
		const tilt = section === 'bass' ? - lerp( 30, 40, ( n - 1 ) / 31 )
			: section === 'tenor' ? lerp( 20, 17, ( n - 33 ) / 25 ) : lerp( 17, 13, ( n - 59 ) / 29 );
		const dir = new THREE.Vector2( Math.sin( tilt * D2R ), Math.cos( tilt * D2R ) );
		// wound bass: overall diameter; plain wire: steel diameter
		const dia = n <= 14 ? lerp( 4.8, 3.2, ( n - 1 ) / 13 ) * 1e-3 : n <= 32 ? lerp( 3.0, 1.9, ( n - 15 ) / 17 ) * 1e-3 : lerp( 1.1, 0.8, ( n - 33 ) / 55 ) * 1e-3;
		notes.push( { n, x, section, unison, dir, dia } );

	}

	const mid = ( notes[ 0 ].x + notes[ 87 ].x ) / 2;
	for ( const o of notes ) o.strike = new THREE.Vector2( o.x - mid, 0 );

	// bearing points: bass studs on a line (heights 115 → 89 mm); tenor/treble pressure bars
	const at = ( o, h ) => o.strike.clone().addScaledVector( o.dir, h / o.dir.y );
	const bars = {
		tenor: [ at( notes[ 32 ], 0.100 ), at( notes[ 57 ], 0.035 ) ],
		treble: [ at( notes[ 58 ], 0.030 ), at( notes[ 87 ], 0.008 ) ],
	};
	for ( const o of notes ) {

		if ( o.section === 'bass' ) {

			o.bearing = at( o, lerp( 0.115, 0.089, ( o.n - 1 ) / 31 ) );

		} else {

			const [ a, b ] = bars[ o.section ];
			o.bearing = o.strike.clone().addScaledVector( o.dir, intersect( o.strike, o.dir, a, b ) );

		}

	}

	// strings: list of { from (below), bearing, to (pin contact) } and pins
	for ( const o of notes ) {

		o.strings = [];
		const right = new THREE.Vector2( o.dir.y, - o.dir.x );		// towards the treble side of the string

		if ( o.section === 'bass' ) {

			const rows = [ 0.014, 0.028 ];
			const offsets = o.unison === 1 ? [ 0 ] : [ - 0.002, 0.002 ];
			offsets.forEach( ( off, i ) => {

				const row = o.unison === 1 ? rows[ ( o.n - 1 ) % 2 ] : rows[ i ];
				const b = o.bearing.clone().addScaledVector( right, off );
				const end = b.clone().addScaledVector( o.dir, row / o.dir.y );
				o.strings.push( { bearing: b, end, pin: end.clone().addScaledVector( right, PIN_R + o.dia / 2 ) } );

			} );

		} else {

			const t = ( o.n - 33 ) / 55;
			const sp = lerp( 0.008, 0.012, t );
			const w = lerp( 0.0055, 0.0065, t );
			const lines = o.n % 2 === 0 ? [ 0, 2, 4 ] : [ 1, 3, 5 ];
			const lineH = k => 0.016 + k * sp;
			// left string -> highest line, right string -> lowest (so no string runs through a pin)
			const assign = [ lines[ 2 ], lines[ 1 ], lines[ 0 ] ];
			const topH = lineH( lines[ 2 ] ) * 1.15;
			const C = o.bearing.clone().addScaledVector( o.dir, topH / o.dir.y );
			[ - 1, 0, 1 ].forEach( ( i, k ) => {

				const b = o.bearing.clone().add( new THREE.Vector2( i * w / 2, 0 ) );
				const f = lineH( assign[ k ] ) / topH;
				const end = b.clone().lerp( C, f );
				const sdir = new THREE.Vector2().subVectors( C, b ).normalize();
				const r = new THREE.Vector2( sdir.y, - sdir.x );
				o.strings.push( { bearing: b, end, pin: end.clone().addScaledVector( r, PIN_R + o.dia / 2 ) } );

			} );

		}

	}

	return { notes, bars };

}

/**
 * Build plate, pins, strings, pressure bars and hammers.
 * @param M materials
 * @param o { yStrike, zPlate (front face), zTenor, zBass, top, halfWidth }
 */
export function buildStringing( M, { yStrike, zPlate, zTenor, zBass, top, halfWidth } ) {

	const g = new THREE.Group();
	g.name = 'stringing';
	const { notes, bars } = uprightScale();
	const Y = p => p.y + yStrike;

	const add = ( geo, mat, cast = true ) => {

		const m = new THREE.Mesh( geo, mat );
		m.castShadow = cast;
		m.receiveShadow = true;
		g.add( m );
		return m;

	};

	// --- plate: pin plate whose lower edge follows the bearing lines, plus struts --------
	{

		const below = 0.016;
		const pts = [];
		pts.push( new THREE.Vector2( - halfWidth, top - 0.008 ) );
		pts.push( new THREE.Vector2( halfWidth, top - 0.008 ) );
		const tr = bars.treble, te = bars.tenor;
		pts.push( new THREE.Vector2( halfWidth, Y( tr[ 1 ] ) - below ) );
		pts.push( new THREE.Vector2( tr[ 1 ].x, Y( tr[ 1 ] ) - below ) );
		pts.push( new THREE.Vector2( tr[ 0 ].x - 0.004, Y( tr[ 0 ] ) - below ) );
		pts.push( new THREE.Vector2( te[ 1 ].x + 0.004, Y( te[ 1 ] ) - below ) );
		pts.push( new THREE.Vector2( te[ 0 ].x, Y( te[ 0 ] ) - below ) );
		const b1 = notes[ 0 ].bearing, b32 = notes[ 31 ].bearing;
		pts.push( new THREE.Vector2( b32.x + 0.01, Y( b32 ) - below ) );
		pts.push( new THREE.Vector2( b1.x - 0.004, Y( b1 ) - below ) );
		pts.push( new THREE.Vector2( - halfWidth, Y( b1 ) - below ) );
		const s = new THREE.Shape( pts );
		const geo = new THREE.ExtrudeGeometry( s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelOffset: - 0.003, bevelSegments: 2 } );
		geo.translate( 0, 0, zPlate - 0.019 );
		add( geo, M.plate, true ).name = 'plate';

		// side flanges and struts running down behind the strings
		const struts = [];
		// struts end where the pin plate begins (its edge follows the bearing lines)
		const strutAt = ( xa, xb, yTop, w ) => {

			const x = ( xa + xb ) / 2;
			struts.push( woodBox( v3( x - w / 2, yStrike - 0.35, zPlate - 0.02 ), v3( x + w / 2, yTop, zPlate ), { noUV: true, radius: 0.003 } ) );

		};
		strutAt( notes[ 31 ].strike.x, notes[ 32 ].strike.x, Y( bars.tenor[ 0 ] ), 0.024 );
		strutAt( notes[ 57 ].strike.x, notes[ 58 ].strike.x, Y( bars.tenor[ 1 ] ), 0.02 );
		for ( const sx of [ - 1, 1 ] ) struts.push( woodBox( v3( sx * halfWidth - 0.03, yStrike - 0.35, zPlate - 0.02 ), v3( sx * halfWidth + 0.0, top - 0.01, zPlate + 0.002 ), { noUV: true } ).translate( sx > 0 ? 0 : 0.03, 0, 0 ) );
		add( merge( struts ), M.plate );

	}

	// --- strings and pins ------------------------------------------------------------
	const steel = [], copper = [], pins = [], bushings = [], studs = [];
	for ( const o of notes ) {

		const z = o.section === 'bass' ? zBass : zTenor;
		const r = o.dia / 2;
		const segs = o.section === 'bass' ? 6 : 4;
		const list = o.section === 'bass' ? copper : steel;

		for ( const s of o.strings ) {

			const low = s.bearing.clone().addScaledVector( o.dir, - ( s.bearing.y + 0.40 ) / o.dir.y );
			list.push( rod( v3( low.x, Y( low ), z ), v3( s.bearing.x, Y( s.bearing ), z ), r, segs ) );
			// above the bearing the wire (for bass: plain core) runs to the pin coil
			steel.push( rod( v3( s.bearing.x, Y( s.bearing ), z ), v3( s.end.x, Y( s.end ), z ), o.section === 'bass' ? 0.0006 : r, 4 ) );

			const px = s.pin.x, py = Y( s.pin );
			pins.push( rod( v3( px, py, zPlate ), v3( px, py, z + 0.022 ), PIN_R, 10 ) );
			pins.push( rod( v3( px, py, z - 0.004 ), v3( px, py, z + 0.004 ), COIL_R, 10 ) );
			pins.push( woodBox( v3( px - 0.0026, py - 0.0026, z + 0.022 ), v3( px + 0.0026, py + 0.0026, z + 0.030 ), { noUV: true } ) );
			bushings.push( rod( v3( px, py, zPlate - 0.001 ), v3( px, py, zPlate + 0.0015 ), 0.0055, 12 ) );

		}

		if ( o.section === 'bass' ) {

			const b = o.bearing;
			studs.push( rod( v3( b.x, Y( b ) - 0.0055 - r, zPlate ), v3( b.x, Y( b ) - 0.0055 - r, z + 0.004 ), 0.0055, 12 ) );

		}

	}

	add( merge( steel ), M.steel, false ).name = 'steelStrings';
	add( merge( copper ), M.copper ).name = 'bassStrings';
	add( merge( pins ), M.steel ).name = 'pins';
	add( merge( bushings ), M.keyBlack, false );
	add( merge( studs ), M.steel );

	// --- pressure bars with screws ---------------------------------------------------------
	{

		const parts = [];
		for ( const [ a, b ] of [ bars.tenor, bars.treble ] ) {

			const d = new THREE.Vector2().subVectors( b, a ).normalize();
			const up = new THREE.Vector2( - d.y, d.x );
			const A = a.clone().addScaledVector( up, 0.0065 ).addScaledVector( d, - 0.012 );
			const B = b.clone().addScaledVector( up, 0.0065 ).addScaledVector( d, 0.012 );
			const zc = zTenor + 0.0055;
			parts.push( beam( v3( A.x, Y( A ), zc ), v3( B.x, Y( B ), zc ), 0.009, 0.012 ) );
			const len = A.distanceTo( B );
			const count = Math.max( 2, Math.round( len / 0.07 ) );
			for ( let i = 0; i <= count; ++ i ) {

				const p = A.clone().lerp( B, i / count );
				parts.push( rod( v3( p.x, Y( p ), zc + 0.0045 ), v3( p.x, Y( p ), zc + 0.0075 ), 0.0045, 14 ) );

			}

		}

		add( merge( parts ), M.steel ).name = 'pressureBars';

	}

	// --- hammers (at rest, 45 mm in front of the strings) -------------------------------
	{

		const felt = [], molding = [], shanks = [];
		for ( const o of notes ) {

			const t = ( o.n - 1 ) / 87;
			const h = lerp( 0.046, 0.034, t );
			const pitch = o.section === 'bass' ? 0.014 : o.section === 'tenor' ? 0.0135 : 0.013;
			const w = Math.min( pitch - 0.0018, lerp( 0.0125, 0.0105, t ) );
			const zf = ( o.section === 'bass' ? zBass : zTenor ) + 0.045;
			const x = o.strike.x, y = yStrike;
			felt.push( woodBox( v3( x - w / 2, y - h / 2, zf ), v3( x + w / 2, y + h / 2, zf + 0.018 ), { noUV: true, radius: 0.004 } ) );
			molding.push( woodBox( v3( x - w / 2 + 0.0005, y - h / 2 + 0.004, zf + 0.016 ), v3( x + w / 2 - 0.0005, y + h / 2 - 0.006, zf + 0.028 ), { noUV: true, radius: 0.002 } ) );
			shanks.push( rod( v3( x, y - 0.14, zf + 0.022 ), v3( x, y - h / 2 + 0.004, zf + 0.022 ), 0.0023, 6 ) );

		}

		add( merge( felt ), M.hammerFelt ).name = 'hammers';
		add( merge( molding ), M.spruce );
		add( merge( shanks ), M.spruce );

	}

	return g;

}

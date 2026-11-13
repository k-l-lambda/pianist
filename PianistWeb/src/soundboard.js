// The grands' long bridge on the soundboard (after Footages.local/ref/soundboard/20261113-*.jpg): a maple strip
// standing on the board under the tenor's and the treble's strings, its top just under them, a graphite cap V-notched
// at every string, front and back, and two staggered rows of bridge pins (each string between its front pin on
// one side and its back pin on the other).
//
// Where it runs: across the strings a few cm in front of the plate's S edge (BACK in front of it), as a real
// grand's follows its hitch pins; never under the hammers (their felt to 45 mm behind the dampers) nor under the
// edge's bead. In the high treble the room between the two runs out (the hammers strike 1 to 2 cm from the edge
// there): the bridge keeps to the room left, narrowing, and ends where under MIN_HALF would be left.
//
// No bass bridge: in a real overstrung grand it stands behind the tenor's hitch pins, in an opening of the plate;
// here the tenor's strings run on under the bass's to their rail on the crescent, and the crescent is solid behind
// it, so there is no board under the bass's strings that the tenor's do not cross.

import * as THREE from 'three';
import { extrudeTop, boxProjectUV, rod, merge } from './geometry.js';
import { sweep, profile } from './castdetail.js';

export const debug = { capture: false };

const BACK = 0.034;				// (m: the bridge's centre in front of the S edge, along the strings)
const FELT_END = 0.048;			// (the hammers' felt to 45 mm behind the dampers, and 3 mm)
const HALF = [ 0.016, 0.0115 ];	// (its half width at the tenor's end and at the treble's)
const MIN_HALF = 0.0075;
const CAP = 0.0016;				// (the graphite cap's thickness)
const NOTCH_W = 0.0015, NOTCH_IN = 0.68;	// (a notch: 1.5 mm either side of its apex, in to 0.68 of the half width, where the pin stands)

/**
 * `courses`: the strings' layout (grand.js: per note { bass, d, dir, side, offs, sF, sB, y0, y1 }, plan; heights
 * over the plate's floor), `plateY`, `soundboardY`, `edgeZ( x )` the S edge's z, `edgeBead` its bead's width.
 * Returns [ [ geometry, material key ] ].
 */
export function buildBridges( { courses, plateY, soundboardY, edgeZ, edgeBead = 0.004 } ) {

	if ( debug.capture ) Object.assign( debug, { courses, edgeZ } );
	const along = courses.filter( c => ! c.bass ), pts = [];
	for ( const [ k, c ] of along.entries() ) {

		let sEdge = 0;
		while ( c.d.y + c.dir.y * sEdge > edgeZ( c.d.x + c.dir.x * sEdge ) ) sEdge += 0.0005;
		let hw = THREE.MathUtils.lerp( HALF[ 0 ], HALF[ 1 ], k / ( along.length - 1 ) ), sb = sEdge - BACK;
		const sLo = FELT_END, sHi = sEdge - edgeBead - 0.003;
		if ( sb - hw < sLo ) sb = sLo + hw;
		if ( sb + hw > sHi ) { hw = ( sHi - sLo ) / 2; sb = ( sHi + sLo ) / 2; }
		if ( hw < MIN_HALF ) break;
		const yb = c.y0 + ( c.y1 - c.y0 ) * ( c.sF + sb ) / ( c.sF + c.sB );
		pts.push( { B: c.d.clone().addScaledVector( c.dir, sb ), hw, yb, c } );

	}
	if ( debug.capture ) debug.long = pts;
	if ( pts.length < 3 ) return [];
	// (smoothed: where it turns from following the edge to keeping clear of the hammers, no corner)
	for ( let pass = 0; pass < 3; ++ pass ) {

		const B = pts.map( q => q.B.clone() ), H = pts.map( q => q.hw );
		for ( let k = 1; k + 1 < pts.length; ++ k ) {

			pts[ k ].B.copy( B[ k - 1 ] ).add( B[ k ].clone().multiplyScalar( 2 ) ).add( B[ k + 1 ] ).multiplyScalar( 0.25 );
			pts[ k ].hw = Math.min( H[ k ], ( H[ k - 1 ] + 2 * H[ k ] + H[ k + 1 ] ) / 4 );

		}

	}
	// its top: just under the lowest string on it (the cap's top); the strings from tenor to treble fall 1 mm at most
	const top = plateY + Math.min( ...pts.map( q => q.yb ) ) - 0.0008;
	// the path: through the notes' points, on 12 mm past the end ones
	const t0 = new THREE.Vector2().subVectors( pts[ 1 ].B, pts[ 0 ].B ).normalize(), t1 = new THREE.Vector2().subVectors( pts.at( - 1 ).B, pts.at( - 2 ).B ).normalize();
	const path = [ pts[ 0 ].B.clone().addScaledVector( t0, - 0.012 ), ...pts.map( q => q.B ), pts.at( - 1 ).B.clone().addScaledVector( t1, 0.012 ) ];
	const hws = [ pts[ 0 ].hw, ...pts.map( q => q.hw ), pts.at( - 1 ).hw ];
	const body = sweep( path, i => profile( [ [ - hws[ i ], soundboardY - 0.0005 ], [ hws[ i ], soundboardY - 0.0005 ], [ hws[ i ], top - CAP ], [ - hws[ i ], top - CAP ] ], [ 0, 0, 0.0022, 0.0022 ] ), { y: 0, closed: true } );

	// the path's frame: arc length a, normal n (left: towards the front); a point at ( a, u )
	const A = [ 0 ], N = [];
	for ( let i = 1; i < path.length; ++ i ) A.push( A[ i - 1 ] + path[ i ].distanceTo( path[ i - 1 ] ) );
	for ( let i = 0; i < path.length; ++ i ) {

		const t = new THREE.Vector2().subVectors( path[ Math.min( path.length - 1, i + 1 ) ], path[ Math.max( 0, i - 1 ) ] ).normalize();
		N.push( new THREE.Vector2( - t.y, t.x ) );

	}
	const at = ( a, u ) => {

		let i = 0;
		while ( i + 2 < path.length && A[ i + 1 ] < a ) ++ i;
		const f = ( a - A[ i ] ) / ( A[ i + 1 ] - A[ i ] );
		const p = path[ i ].clone().lerp( path[ i + 1 ], f ), n = N[ i ].clone().lerp( N[ i + 1 ], f ).normalize();
		return p.addScaledVector( n, u );

	};
	const hwAt = a => { let i = 0; while ( i + 2 < path.length && A[ i + 1 ] < a ) ++ i; const f = THREE.MathUtils.clamp( ( a - A[ i ] ) / ( A[ i + 1 ] - A[ i ] ), 0, 1 ); return hws[ i ] + ( hws[ i + 1 ] - hws[ i ] ) * f; };
	// each string's crossing, and its notches' apexes (in from the cap's edges, along the string) and pins
	const front = [], back = [], pins = [];
	pts.forEach( ( q, k ) => {

		const i = k + 1, t = new THREE.Vector2( N[ i ].y, - N[ i ].x ), n = N[ i ];
		const ds = { a: q.c.dir.dot( t ), u: q.c.dir.dot( n ) };		// (the string's direction, back: u falling)
		for ( const o of q.c.offs ) {

			const off = q.c.side.clone().multiplyScalar( o ), aX = A[ i ] + off.dot( t ), uX = off.dot( n );
			const lf = ( NOTCH_IN * q.hw - uX ) / Math.max( - ds.u, 0.3 ), lb = ( uX + NOTCH_IN * q.hw ) / Math.max( - ds.u, 0.3 );
			const af = aX - ds.a * lf, ab = aX + ds.a * lb;
			front.push( af ); back.push( ab );
			const side = q.c.side;
			pins.push( at( af, NOTCH_IN * q.hw ).addScaledVector( side, 0.0016 ), at( ab, - NOTCH_IN * q.hw ).addScaledVector( side, - 0.0016 ) );

		}

	} );
	// the cap's outline: straight along its edges, a V notch (NOTCH_W either side, in to NOTCH_IN of the half width)
	// at each string's apex
	const notchW = a => Math.min( NOTCH_W, 0.4 * a );
	const edge = ( apexes, sgn ) => {

		const s = apexes.slice().sort( ( x, y ) => x - y ), out = [];
		for ( let j = 0; j < s.length; ++ j ) {

			const gap = Math.min( j > 0 ? s[ j ] - s[ j - 1 ] : 1, j + 1 < s.length ? s[ j + 1 ] - s[ j ] : 1 ), w = notchW( gap );
			out.push( [ s[ j ] - w, sgn ], [ s[ j ], sgn * NOTCH_IN ], [ s[ j ] + w, sgn ] );

		}
		return out;

	};
	const aEnd = A.at( - 1 ), fr = edge( front, 1 ), bk = edge( back, - 1 ).reverse();
	const outline = [ [ 0, 1 ], ...fr, [ aEnd, 1 ], [ aEnd, - 1 ], ...bk, [ 0, - 1 ] ].map( ( [ a, f ] ) => at( a, f * hwAt( a ) ) );
	const cap = extrudeTop( new THREE.Shape( outline ), top - CAP, top, { bevel: 0.0004, curveSegments: 4 } );
	const pinGeo = merge( pins.map( p => rod( new THREE.Vector3( p.x, top - CAP - 0.003, p.y ), new THREE.Vector3( p.x, top + 0.0055, p.y ), 0.0011, 6 ) ) );
	return [ [ boxProjectUV( body, { grain: 'x' } ), 'maple' ], [ cap, 'graphite' ], [ pinGeo, 'steel' ] ];

}

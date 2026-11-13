// Cast-iron detail for the grands' plate: rounded profiles swept along plan paths (struts, rails, lips, edges),
// fillets where its members meet (in plan, extruded), and the corner rounding they share. Every surface's normals
// smooth across its rounded corners and along its path, sharp only at the corners left square (those buried in
// the plate).

import * as THREE from 'three';

const v2 = ( x, y ) => new THREE.Vector2( x, y );

/**
 * A polygon's (or open polyline's) corners rounded: `pts` [ x, y ] (Vector2), `radii` per vertex (0: left sharp),
 * each corner replaced by `n` + 1 points on an arc tangent to its two edges (convex or concave alike; a radius too
 * big for its edges shrunk to fit). Returns [ { p, smooth } ]: smooth on the arcs, not at a sharp corner.
 */
export function roundCorners( pts, radii, { closed = true, n = 4 } = {} ) {

	const out = [], m = pts.length;
	for ( let i = 0; i < m; ++ i ) {

		const P = pts[ i ], r = radii[ i ] ?? 0;
		const hasPrev = closed || i > 0, hasNext = closed || i < m - 1;
		if ( ! ( r > 0 ) || ! hasPrev || ! hasNext ) { out.push( { p: P.clone(), smooth: false } ); continue; }
		const A = pts[ ( i + m - 1 ) % m ], B = pts[ ( i + 1 ) % m ];
		const la = A.distanceTo( P ), lb = B.distanceTo( P );
		if ( la < 1e-9 || lb < 1e-9 ) { out.push( { p: P.clone(), smooth: false } ); continue; }
		const d1 = new THREE.Vector2().subVectors( A, P ).divideScalar( la ), d2 = new THREE.Vector2().subVectors( B, P ).divideScalar( lb );
		const th = Math.acos( THREE.MathUtils.clamp( d1.dot( d2 ), - 1, 1 ) );
		if ( th < 1e-3 || th > Math.PI - 1e-3 ) { out.push( { p: P.clone(), smooth: th > Math.PI - 1e-3 } ); continue; }
		let L = r / Math.tan( th / 2 );
		const Lmax = 0.5 * Math.min( la, lb ) * ( radii[ ( i + m - 1 ) % m ] > 0 && radii[ ( i + 1 ) % m ] > 0 ? 1 : 1.98 );
		L = Math.min( L, Lmax );
		const rr = L * Math.tan( th / 2 );
		const bis = new THREE.Vector2().addVectors( d1, d2 ).normalize();
		const O = P.clone().addScaledVector( bis, rr / Math.sin( th / 2 ) );
		const S = P.clone().addScaledVector( d1, L ), E = P.clone().addScaledVector( d2, L );
		let a0 = Math.atan2( S.y - O.y, S.x - O.x ), a1 = Math.atan2( E.y - O.y, E.x - O.x );
		let da = a1 - a0;
		while ( da > Math.PI ) da -= 2 * Math.PI;
		while ( da < - Math.PI ) da += 2 * Math.PI;
		for ( let k = 0; k <= n; ++ k ) {

			const a = a0 + da * k / n;
			out.push( { p: v2( O.x + rr * Math.cos( a ), O.y + rr * Math.sin( a ) ), smooth: true } );

		}

	}

	return out;

}

/**
 * A profile swept along a plan path: `path` (Vector2: x, z), `profileAt( i )` the section at path point i: [ { u,
 * v, smooth } ] (u across the path, along its left normal ( -t.z, t.x ): offsetPolyline's inside; v up, over `y`),
 * counter-clockwise in (u, v) (the material on its left), the same count at every point. A closed section is a
 * ring; an open one is closed across its ends at the caps. Normals: along the path averaged between neighbouring
 * pieces, across the section averaged at its smooth points, its own face's at a sharp one; the end caps flat
 * (unless `caps` false). Non-indexed, position and normal.
 */
export function sweep( path, profileAt, { y = 0, closed = true, caps = true } = {} ) {

	const P = path.length, T = [], N2 = [];
	for ( let i = 0; i < P; ++ i ) {

		const t = new THREE.Vector2().subVectors( path[ Math.min( P - 1, i + 1 ) ], path[ Math.max( 0, i - 1 ) ] ).normalize();
		T.push( t ); N2.push( v2( - t.y, t.x ) );

	}
	const prof = path.map( ( p, i ) => profileAt( i ) );
	const M = prof[ 0 ].length, C = closed ? M : M - 1;		// (points; faces round the section)
	const V = prof.map( ( s, i ) => s.map( q => new THREE.Vector3( path[ i ].x + N2[ i ].x * q.u, y + q.v, path[ i ].y + N2[ i ].y * q.u ) ) );
	// each piece's faces' normals, oriented by the section's outward side ( dv, -du )
	const F = [];
	for ( let i = 0; i + 1 < P; ++ i ) {

		const row = [];
		for ( let k = 0; k < C; ++ k ) {

			const k1 = ( k + 1 ) % M, s = prof[ i ], du = s[ k1 ].u - s[ k ].u, dv = s[ k1 ].v - s[ k ].v;
			const n2 = N2[ i ].clone().add( N2[ i + 1 ] ).normalize();
			const want = new THREE.Vector3( n2.x * dv, - du, n2.y * dv );
			const a = V[ i ][ k ], b = V[ i ][ k1 ], d = V[ i + 1 ][ k ], c = V[ i + 1 ][ k1 ];
			let nn = new THREE.Vector3().subVectors( c, a ).cross( new THREE.Vector3().subVectors( d, b ) );
			if ( nn.lengthSq() < 1e-16 ) nn = want.clone();
			if ( nn.dot( want ) < 0 ) nn.negate();
			row.push( nn.lengthSq() > 0 ? nn.normalize() : new THREE.Vector3( 0, 1, 0 ) );

		}
		F.push( row );

	}
	const along = ( r, c ) => new THREE.Vector3().add( F[ Math.max( 0, r - 1 ) ][ c ] ).add( F[ Math.min( F.length - 1, r ) ][ c ] ).normalize();
	const vn = ( r, q, own ) => {

		// at row r, section point q, for the face column `own`: the neighbouring column too where q is smooth
		const cols = [ own ];
		if ( prof[ Math.min( r, P - 1 ) ][ q ].smooth ) {

			const other = q === own ? own - 1 : own + 1;
			if ( closed ) cols.push( ( other + C ) % C ); else if ( other >= 0 && other < C ) cols.push( other );

		}
		const s = new THREE.Vector3();
		for ( const c of cols ) s.add( along( r, c ) );
		return s.normalize();

	};
	const pos = [], nor = [];
	const put = ( v, n ) => { pos.push( v.x, v.y, v.z ); nor.push( n.x, n.y, n.z ); };
	for ( let i = 0; i + 1 < P; ++ i ) for ( let k = 0; k < C; ++ k ) {

		const k1 = ( k + 1 ) % M, a = V[ i ][ k ], b = V[ i ][ k1 ], c = V[ i + 1 ][ k1 ], d = V[ i + 1 ][ k ];
		const na = vn( i, k, k ), nb = vn( i, k1, k ), nc = vn( i + 1, k1, k ), nd = vn( i + 1, k, k );
		const flip = new THREE.Vector3().subVectors( b, a ).cross( new THREE.Vector3().subVectors( d, a ) ).dot( F[ i ][ k ] ) < 0;
		const quad = flip ? [ [ a, na ], [ d, nd ], [ c, nc ], [ a, na ], [ c, nc ], [ b, nb ] ] : [ [ a, na ], [ b, nb ], [ c, nc ], [ a, na ], [ c, nc ], [ d, nd ] ];
		for ( const [ v, n ] of quad ) put( v, n );

	}
	if ( caps ) for ( const [ i, sgn ] of [ [ 0, - 1 ], [ P - 1, 1 ] ] ) {

		const s = prof[ i ], c2 = s.map( q => v2( q.u, q.v ) );
		const tris = THREE.ShapeUtils.triangulateShape( c2, [] );
		const out = new THREE.Vector3( T[ i ].x, 0, T[ i ].y ).multiplyScalar( sgn );
		for ( const [ a, b, c ] of tris ) {

			const A = V[ i ][ a ], B = V[ i ][ b ], Cc = V[ i ][ c ];
			const ok = new THREE.Vector3().subVectors( B, A ).cross( new THREE.Vector3().subVectors( Cc, A ) ).dot( out ) >= 0;
			for ( const v of ok ? [ A, B, Cc ] : [ A, Cc, B ] ) put( v, out );

		}

	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	return g;

}

/** A closed profile from a control polygon (CCW, [ u, v ] pairs) with its corners rounded (radii per vertex). */
export function profile( ctrl, radii, n = 4 ) {

	const r = roundCorners( ctrl.map( ( [ u, v ] ) => v2( u, v ) ), radii, { closed: true, n } );
	return r.filter( ( q, k ) => k === 0 || q.p.distanceTo( r[ k - 1 ].p ) > 1e-7 ).map( ( { p, smooth } ) => ( { u: p.x, v: p.y, smooth } ) );

}

/**
 * The fillet in a corner (plan): C the corner (where the two faces' lines meet), d1, d2 unit directions along the
 * faces away from it, R its radius. The region between the faces and a concave arc tangent to both: [ C, A, arc,
 * B ] (Vector2), or null for a corner too flat or too sharp.
 */
export function filletPlan( C, d1, d2, R, n = 8 ) {

	const th = Math.acos( THREE.MathUtils.clamp( d1.dot( d2 ), - 1, 1 ) );
	if ( th < 0.15 || th > Math.PI - 0.15 ) return null;
	const L = R / Math.tan( th / 2 ), bis = new THREE.Vector2().addVectors( d1, d2 ).normalize();
	const O = C.clone().addScaledVector( bis, R / Math.sin( th / 2 ) );
	const A = C.clone().addScaledVector( d1, L ), B = C.clone().addScaledVector( d2, L );
	let a0 = Math.atan2( A.y - O.y, A.x - O.x ), a1 = Math.atan2( B.y - O.y, B.x - O.x ), da = a1 - a0;
	while ( da > Math.PI ) da -= 2 * Math.PI;
	while ( da < - Math.PI ) da += 2 * Math.PI;
	const pts = [ C.clone() ];
	for ( let k = 0; k <= n; ++ k ) { const a = a0 + da * k / n; pts.push( v2( O.x + R * Math.cos( a ), O.y + R * Math.sin( a ) ) ); }
	return pts;

}

/** Where two plan lines meet: p + s d and q + t e (null if parallel). */
export function meet( p, d, q, e ) {

	const den = d.x * e.y - d.y * e.x;
	if ( Math.abs( den ) < 1e-9 ) return null;
	const s = ( ( q.x - p.x ) * e.y - ( q.y - p.y ) * e.x ) / den;
	return p.clone().addScaledVector( d, s );

}

/**
 * A lathe's profile (r, y) from a control polyline with its corners rounded, ordered so that the material is on
 * the profile's left (its surface faces right of the way it runs): LatheGeometry's outward side.
 */
export function latheProfile( ctrl, radii, n = 4 ) {

	return roundCorners( ctrl.map( ( [ r, y ] ) => v2( r, y ) ), radii, { closed: false, n } ).map( q => q.p );

}

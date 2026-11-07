// Adjustable piano bench (duet size), after the usual concert model: four square tapered legs and
// aprons in the piano's lacquer, a storage box with a height knob each side, a tufted leather
// cushion on top (buttons in a diamond pattern), the scissor lift between frame and box.
// Dimensions in metres; local frame: x across (the keyboard's width), y up from the floor, z
// towards the player's back (the keyboard at -z), its centre at the origin.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BENCH_TOP } from './benchtop.js';

const W = 0.76, D = 0.36;			// cushion

// The cushion's top: the tufted relief measured from a photo (benchtop.js: a quadrant, in face
// widths) over the whole top, its pillows' middle level the seat's height; at the edge it rolls down
// to the vertical side (one surface: no rim, no seam). TUFT_GAIN: a photo's depth reads shallow.
const TUFT_GAIN = 3.5;
const PLAN_R = 0.022;			// the cushion's corners in plan
// the edge's roll down to the side (radius): a soft 20 mm round, so the top's leather turns into the side's
// with no line between them (at 8 mm the roll's tight highlight drew a seam, and the side read as a band of its own)
const ROLL = 0.02;
const ROLL_STEPS = 10;			// (the roll's rows)
const BLEND = 0.032;			// the edge's last strip, where the relief eases to its rim's mean level (the roll a clean round)
let _tuft = null;
/** The relief (m, about the pillows' middle level) at (s, t): fractions of the half sizes, -1..1, mirrored. */
function tuftRelief( s, t ) {

	if ( ! _tuft ) {

		const [ nu, nv ] = BENCH_TOP.size, raw = Uint8Array.from( atob( BENCH_TOP.data ), c => c.charCodeAt( 0 ) );
		const T = Float32Array.from( raw, v => BENCH_TOP.min + ( BENCH_TOP.max - BENCH_TOP.min ) * v / 255 );
		const mid = [];
		for ( let j = 0; j < 0.8 * nv; ++ j ) for ( let i = 0; i < 0.8 * nu; ++ i ) mid.push( T[ j * nu + i ] );
		mid.sort( ( a, b ) => a - b );
		let rim = 0;
		for ( let i = 0; i < nu; ++ i ) rim += T[ ( nv - 1 ) * nu + i ];
		for ( let j = 0; j < nv; ++ j ) rim += T[ j * nu + nu - 1 ];
		_tuft = { nu, nv, T, zero: mid[ mid.length >> 1 ], rim: rim / ( nu + nv ) };

	}
	const { nu, nv, T, zero } = _tuft;
	const x = Math.min( 1, Math.abs( s ) ) * ( nu - 1 ), y = Math.min( 1, Math.abs( t ) ) * ( nv - 1 );
	const i = Math.min( nu - 2, Math.floor( x ) ), j = Math.min( nv - 2, Math.floor( y ) ), fx = x - i, fy = y - j;
	const at = ( a, b ) => T[ b * nu + a ];
	const h = ( at( i, j ) * ( 1 - fx ) + at( i + 1, j ) * fx ) * ( 1 - fy ) + ( at( i, j + 1 ) * ( 1 - fx ) + at( i + 1, j + 1 ) * fx ) * fy;
	return TUFT_GAIN * ( h - zero ) * W;

}
/** The relief's level along the rim (m, as tuftRelief's). */
const tuftRim = () => ( tuftRelief( 0, 0 ), TUFT_GAIN * ( _tuft.rim - _tuft.zero ) * W );

/**
 * A polyline [ a, r ] with its corners rounded (each point's radius, [ a, r, radius ]), and long
 * straight runs split (a vertex every `step` m): the knob's profile.
 */
function roundedProfile( pts, step = 0.0015, arcSteps = 7 ) {

	const out = [], P = pts.map( p => new THREE.Vector2( p[ 0 ], p[ 1 ] ) );
	const corners = [ { a: P[ 0 ], b: P[ 0 ] } ];		// each point's arc: from a to b (the ends: the point itself)
	for ( let i = 1; i < P.length - 1; ++ i ) {

		const rad = pts[ i ][ 2 ] ?? 0, u = P[ i - 1 ].clone().sub( P[ i ] ), v = P[ i + 1 ].clone().sub( P[ i ] );
		const lu = u.length(), lv = v.length(); u.divideScalar( lu ); v.divideScalar( lv );
		const th = Math.acos( THREE.MathUtils.clamp( u.dot( v ), - 1, 1 ) );
		if ( ! rad || th > Math.PI - 1e-3 ) { corners.push( { a: P[ i ], b: P[ i ] } ); continue; }
		const t = Math.min( rad / Math.tan( th / 2 ), 0.45 * lu, 0.45 * lv ), r = t * Math.tan( th / 2 );
		const c = P[ i ].clone().add( u.clone().add( v ).normalize().multiplyScalar( r / Math.sin( th / 2 ) ) );
		corners.push( { a: P[ i ].clone().addScaledVector( u, t ), b: P[ i ].clone().addScaledVector( v, t ), c, r } );

	}
	corners.push( { a: P[ P.length - 1 ], b: P[ P.length - 1 ] } );
	for ( let i = 0; i < corners.length; ++ i ) {

		const k = corners[ i ];
		if ( k.c ) {		// the arc

			let a0 = Math.atan2( k.a.y - k.c.y, k.a.x - k.c.x ), a1 = Math.atan2( k.b.y - k.c.y, k.b.x - k.c.x );
			if ( a1 - a0 > Math.PI ) a1 -= 2 * Math.PI; else if ( a0 - a1 > Math.PI ) a1 += 2 * Math.PI;
			for ( let s = 0; s <= arcSteps; ++ s ) { const a = a0 + ( a1 - a0 ) * s / arcSteps; out.push( [ k.c.x + k.r * Math.cos( a ), k.c.y + k.r * Math.sin( a ) ] ); }

		} else out.push( [ k.a.x, k.a.y ] );
		if ( i < corners.length - 1 ) {		// the straight run to the next arc

			const from = k.b, to = corners[ i + 1 ].a, n = Math.floor( from.distanceTo( to ) / step );
			for ( let s = 1; s < n; ++ s ) out.push( [ from.x + ( to.x - from.x ) * s / n, from.y + ( to.y - from.y ) * s / n ] );

		}

	}
	return out;

}

const KNOB_FLUTES = 14, KNOB_SEGMENTS = 14 * 8;
/**
 * A height knob: turned about its axle (x, out of the box's end at `x0` on side `sx`, at y, z), one
 * seamless indexed mesh (smooth normals all round): a thin rosette on the box, a neck, the knob's
 * back rounded out to the grip, a band of shallow flutes (fading in and out along it, so no step),
 * a rounded front edge and a gently domed face.
 */
function knobGeometry( sx, x0, y, z ) {

	// [ along the axle from the box, radius, corner radius ]
	const prof = roundedProfile( [
		[ 0, 0.021 ], [ 0.0025, 0.0215, 0.0012 ], [ 0.004, 0.012, 0.0015 ],		// the rosette (its back hidden in the box)
		[ 0.009, 0.0115, 0.003 ], [ 0.0135, 0.0295, 0.005 ],		// the neck, the knob's back
		[ 0.033, 0.0305, 0.004 ], [ 0.0375, 0.022, 0.005 ], [ 0.0395, 0, 0.0 ],		// the grip, its front edge, the face (to the axis)
	] );
	const fl = a => THREE.MathUtils.smoothstep( a, 0.016, 0.0195 ) * ( 1 - THREE.MathUtils.smoothstep( a, 0.0295, 0.0335 ) );		// the flutes along the grip
	const P = [], I = [], N = KNOB_SEGMENTS, rings = prof.length - 1;		// (the last point: the face's centre, one vertex)
	for ( let i = 0; i < rings; ++ i ) {

		const [ a, r ] = prof[ i ], w = fl( a );
		for ( let k = 0; k < N; ++ k ) {

			const t = 2 * Math.PI * k / N, rr = r - 0.0011 * w * ( 0.5 - 0.5 * Math.cos( KNOB_FLUTES * t ) );
			P.push( sx * ( x0 + a ), y + rr * Math.cos( t ), z + rr * Math.sin( t ) );

		}

	}
	const tip = P.length / 3;
	P.push( sx * ( x0 + prof[ rings ][ 0 ] ), y, z );
	const quads = [];
	for ( let i = 0; i < rings - 1; ++ i ) for ( let k = 0; k < N; ++ k ) quads.push( [ i * N + k, i * N + ( k + 1 ) % N, ( i + 1 ) * N + ( k + 1 ) % N, ( i + 1 ) * N + k ] );
	// winding: a quad on the grip faces out from the axle
	const v = j => new THREE.Vector3( P[ 3 * j ], P[ 3 * j + 1 ], P[ 3 * j + 2 ] );
	const q = quads[ Math.floor( quads.length / 2 ) ], n = new THREE.Vector3().crossVectors( v( q[ 1 ] ).sub( v( q[ 0 ] ) ), v( q[ 3 ] ).sub( v( q[ 0 ] ) ) );
	const out = v( q[ 0 ] ).sub( new THREE.Vector3( P[ 3 * q[ 0 ] ], y, z ) ), flip = n.dot( out ) < 0;
	for ( const [ a, b, c, d ] of quads ) flip ? I.push( a, d, c, a, c, b ) : I.push( a, b, c, a, c, d );
	for ( let k = 0; k < N; ++ k ) { const a = ( rings - 1 ) * N + k, b = ( rings - 1 ) * N + ( k + 1 ) % N; flip ? I.push( a, tip, b ) : I.push( a, b, tip ); }
	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) );
	geo.setIndex( I );
	geo.computeVertexNormals();
	return geo;

}

/** Coordinates across the top: uniform inside, crowded towards the edge (the roll), from -h to h. */
function edgeCrowded( h, step ) {

	const inner = h - ROLL, n = Math.ceil( 2 * inner / step ), out = [];
	for ( let k = ROLL_STEPS; k >= 1; -- k ) out.push( - inner - ROLL * Math.sin( k / ROLL_STEPS * Math.PI / 2 ) );
	for ( let k = 0; k <= n; ++ k ) out.push( - inner + 2 * inner * k / n );
	for ( let k = 1; k <= ROLL_STEPS; ++ k ) out.push( inner + ROLL * Math.sin( k / ROLL_STEPS * Math.PI / 2 ) );
	return out;

}

/**
 * The cushion (above the box's top, y 0 its bottom): one indexed mesh, the tufted top over the
 * whole of its plan (a rounded rectangle), rolled down at the edge into its vertical side, which
 * shares the top's outline vertices (smooth across), and a flat bottom. Returns the geometry and
 * the top's height function (for the buttons).
 */
function cushionGeometry( height ) {

	const hw = W / 2, hd = D / 2, crown = ( x, z ) => 0.006 * ( 1 - ( x / hw ) ** 4 ) * ( 1 - ( z / hd ) ** 4 );
	const inner = ( x, z ) => height + crown( x, z ) + tuftRelief( x / hw, z / hd );
	const rimLevel = height + tuftRim();
	// a grid point -> the plan (its corner squares onto quarter discs) and its distance to the outline
	const plan = ( x, z ) => {

		const ex = Math.abs( x ) - ( hw - PLAN_R ), ez = Math.abs( z ) - ( hd - PLAN_R );
		if ( ex > 0 && ez > 0 ) {

			const m = Math.max( ex, ez ), k = m / Math.hypot( ex, ez );
			return [ Math.sign( x ) * ( hw - PLAN_R + ex * k ), Math.sign( z ) * ( hd - PLAN_R + ez * k ), PLAN_R - m ];

		}
		return [ x, z, Math.min( hw - Math.abs( x ), hd - Math.abs( z ) ) ];

	};
	const y = ( x, z, d ) => {

		const w = 1 - THREE.MathUtils.smoothstep( d, 0, BLEND );
		const base = inner( x, z ) * ( 1 - w ) + rimLevel * w;
		return d < ROLL ? base - ( ROLL - Math.sqrt( ROLL * ROLL - ( ROLL - d ) ** 2 ) ) : base;

	};
	// the outline's outward direction in plan at (px, pz) (its corners: from their centres)
	const outward = ( px, pz ) => {

		const ex = Math.abs( px ) - ( hw - PLAN_R ), ez = Math.abs( pz ) - ( hd - PLAN_R );
		let ox = ex > 0 ? Math.sign( px ) * ex : 0, oz = ez > 0 ? Math.sign( pz ) * ez : 0;
		const l = Math.hypot( ox, oz ) || 1;
		return [ ox / l, oz / l ];

	};
	const xs = edgeCrowded( hw, 0.005 ), zs = edgeCrowded( hd, 0.005 ), nx = xs.length, nz = zs.length;
	const P = [], UV = [], I = [];
	for ( let j = 0; j < nz; ++ j ) for ( let i = 0; i < nx; ++ i ) {

		const [ px, pz, d ] = plan( xs[ i ], zs[ j ] ), dd = Math.max( 0, d );
		P.push( px, y( px, pz, dd ), pz );
		// UVs: the plan's, unfolded over the roll by its arc (a plan projection squeezed the grain into
		// streaks there, as it turned down); the side's continue from these, so the grain runs on unbroken
		let u = ( px + hw ) / W, v = ( pz + hd ) / D;
		if ( dd < ROLL ) {

			const extra = ROLL * Math.asin( Math.min( 1, ( ROLL - dd ) / ROLL ) ) - ( ROLL - dd ), [ ox, oz ] = outward( px, pz );
			u += ox * extra / W; v += oz * extra / D;

		}
		UV.push( u, v );

	}
	const id = ( i, j ) => j * nx + i;
	for ( let j = 0; j < nz - 1; ++ j ) for ( let i = 0; i < nx - 1; ++ i ) {

		const a = id( i, j ), b = id( i + 1, j ), c = id( i + 1, j + 1 ), d = id( i, j + 1 );
		I.push( a, d, c, a, c, b );		// (facing up)

	}
	// the side: the top's outline (shared) down to the bottom, its UVs unfolded outwards from the top's (by its height)
	const ring = [];
	for ( let i = 0; i < nx; ++ i ) ring.push( id( i, 0 ) );
	for ( let j = 1; j < nz; ++ j ) ring.push( id( nx - 1, j ) );
	for ( let i = nx - 2; i >= 0; -- i ) ring.push( id( i, nz - 1 ) );
	for ( let j = nz - 2; j >= 1; -- j ) ring.push( id( 0, j ) );
	const low = ring.map( k => {

		const px = P[ 3 * k ], pz = P[ 3 * k + 2 ], h = P[ 3 * k + 1 ];
		const [ nxp, nzp ] = outward( px, pz );		// (the outline's outward normal in plan)
		P.push( px, 0, pz );
		UV.push( UV[ 2 * k ] + nxp * h / W, UV[ 2 * k + 1 ] + nzp * h / D );
		return P.length / 3 - 1;

	} );
	// winding: the first quad's normal must point out of the plan
	const v = k => new THREE.Vector3( P[ 3 * k ], P[ 3 * k + 1 ], P[ 3 * k + 2 ] );
	const mid = Math.floor( ring.length / 8 ), n0 = new THREE.Vector3().crossVectors( v( ring[ mid + 1 ] ).sub( v( ring[ mid ] ) ), v( low[ mid ] ).sub( v( ring[ mid ] ) ) );
	const flip = n0.dot( v( ring[ mid ] ).setY( 0 ) ) < 0;
	for ( let k = 0; k < ring.length; ++ k ) {

		const k1 = ( k + 1 ) % ring.length, a = ring[ k ], b = ring[ k1 ], c = low[ k1 ], d = low[ k ];
		if ( flip ) I.push( a, d, c, a, c, b ); else I.push( a, b, c, a, c, d );

	}
	// the bottom: its own outline (a sharp edge there), a fan, facing down
	const b0 = P.length / 3;
	P.push( 0, 0, 0 ); UV.push( 0.5, 0.5 );
	for ( const k of ring ) { P.push( P[ 3 * k ], 0, P[ 3 * k + 2 ] ); UV.push( UV[ 2 * k ], UV[ 2 * k + 1 ] ); }
	const down = new THREE.Vector3().crossVectors( v( b0 + 2 + mid ).sub( v( b0 ) ), v( b0 + 3 + mid ).sub( v( b0 ) ) ).y < 0;		// (b0, a, b) faces down?
	for ( let k = 0; k < ring.length; ++ k ) {

		const a = b0 + 1 + k, b = b0 + 1 + ( k + 1 ) % ring.length;
		if ( down ) I.push( b0, a, b ); else I.push( b0, b, a );

	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) );
	geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( UV, 2 ) );
	geo.setIndex( I );
	geo.computeVertexNormals();
	return { geo, top: inner, check: { flip, verts: P.length / 3, tris: I.length / 3 } };

}

// Tileable normal map of leather grain: pebbles (cells of a jittered grid, domed, with creases
// between), a few per centimetre at the cushion's UV repeat
let _grain = null;
function leatherGrain() {

	if ( _grain ) return _grain;
	const N = 256, G = 24, pts = [];
	let seed = 7;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( let j = 0; j < G; ++ j ) for ( let i = 0; i < G; ++ i ) pts.push( [ ( i + rnd() ) / G, ( j + rnd() ) / G ] );
	const h = new Float32Array( N * N );
	for ( let y = 0; y < N; ++ y ) for ( let x = 0; x < N; ++ x ) {

		const u = x / N, v = y / N, ci = Math.floor( u * G ), cj = Math.floor( v * G );
		let d1 = 9, d2 = 9;
		for ( let dj = - 1; dj <= 1; ++ dj ) for ( let di = - 1; di <= 1; ++ di ) {

			const p = pts[ ( ( cj + dj + G ) % G ) * G + ( ci + di + G ) % G ];
			let dx = Math.abs( u - p[ 0 ] ), dy = Math.abs( v - p[ 1 ] );
			dx = Math.min( dx, 1 - dx ); dy = Math.min( dy, 1 - dy );
			const d = Math.hypot( dx, dy );
			if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;

		}

		h[ y * N + x ] = Math.min( 1, ( d2 - d1 ) * G * 1.6 );		// 0 in the creases, up on the pebbles

	}

	const data = new Uint8Array( 4 * N * N ), at = ( x, y ) => h[ ( ( y + N ) % N ) * N + ( x + N ) % N ];
	for ( let y = 0; y < N; ++ y ) for ( let x = 0; x < N; ++ x ) {

		const dx = ( at( x + 1, y ) - at( x - 1, y ) ) * 1.5, dy = ( at( x, y + 1 ) - at( x, y - 1 ) ) * 1.5, l = Math.hypot( dx, dy, 1 ), k = 4 * ( y * N + x );
		data[ k ] = Math.round( 255 * ( 0.5 - 0.5 * dx / l ) );
		data[ k + 1 ] = Math.round( 255 * ( 0.5 - 0.5 * dy / l ) );
		data[ k + 2 ] = Math.round( 255 * ( 0.5 + 0.5 / l ) );
		data[ k + 3 ] = 255;

	}

	_grain = new THREE.DataTexture( data, N, N );
	_grain.wrapS = _grain.wrapT = THREE.RepeatWrapping;
	_grain.repeat.set( 12, 6 );
	_grain.magFilter = THREE.LinearFilter;
	_grain.minFilter = THREE.LinearMipmapLinearFilter;
	_grain.generateMipmaps = true;
	_grain.needsUpdate = true;
	return _grain;

}
const FRAME_TOP = 0.36;				// legs and aprons
const BOX_BOTTOM = 0.405, BOX_TOP = 0.475;	// the storage box, lifted on the scissors
const SEAT = 0.53;					// top of the cushion

/**
 * @param {THREE.Material} lacquer the piano's case material (legs, aprons, box)
 * @param {{ dark: boolean }} opts dark: a black piano (black leather, black knobs); else white
 */
export function buildBench( lacquer, { dark = true } = {} ) {

	const group = new THREE.Group();
	group.name = 'bench';
	// leather: a grained base under a glossy finish (the coat follows the grain too). Black hide
	// diffuses very little: nearly black, the shine all from the coat; no sheen (its grey rim
	// made the black read as grey under the top light)
	const grain = leatherGrain();
	const leather = new THREE.MeshPhysicalMaterial( {
		// (black: the base's own broad specular cut down too, or under the top light it is a grey haze)
		color: dark ? '#040405' : '#bdb8ae', roughness: dark ? 0.55 : 0.5, specularIntensity: dark ? 0.25 : 1, normalMap: grain, normalScale: new THREE.Vector2( 0.4, 0.4 ),
		clearcoat: 1, clearcoatRoughness: dark ? 0.12 : 0.2, clearcoatNormalMap: grain, clearcoatNormalScale: new THREE.Vector2( 0.08, 0.08 ),
	} );
	const button = new THREE.MeshPhysicalMaterial( { color: dark ? '#060607' : '#ddd8cf', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 } );		// covered in the same leather
	const knobMat = new THREE.MeshPhysicalMaterial( { color: dark ? '#111112' : '#e9dfc9', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 } );		// (lacquered, like the case)
	const metal = new THREE.MeshStandardMaterial( { color: '#1b1b1d', metalness: 0.8, roughness: 0.45 } );
	const rubber = new THREE.MeshStandardMaterial( { color: '#111111', roughness: 0.9 } );

	const mesh = ( geo, mat ) => {

		const m = new THREE.Mesh( geo, mat );
		m.castShadow = m.receiveShadow = true;
		group.add( m );
		return m;

	};
	const rbox = ( w, h, d, r, x, y, z ) => new RoundedBoxGeometry( w, h, d, 2, r ).translate( x, y, z ).toNonIndexed();

	// legs: square, tapering towards the floor, set in from the box's corners
	const lacq = [];
	const lx = W / 2 - 0.06, lz = D / 2 - 0.045;
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const leg = new THREE.CylinderGeometry( 0.024 * Math.SQRT2, 0.019 * Math.SQRT2, FRAME_TOP, 4, 1 ).rotateY( Math.PI / 4 ).translate( sx * lx, FRAME_TOP / 2, sz * lz );
		lacq.push( leg.toNonIndexed() );
		mesh( new THREE.CylinderGeometry( 0.016, 0.016, 0.008, 12 ).translate( sx * lx, 0.004, sz * lz ), rubber );

	}

	// aprons between the legs, a rail across inside
	lacq.push( rbox( 2 * lx + 0.03, 0.075, 0.022, 0.006, 0, FRAME_TOP - 0.0375, lz ) );
	lacq.push( rbox( 2 * lx + 0.03, 0.075, 0.022, 0.006, 0, FRAME_TOP - 0.0375, - lz ) );
	for ( const sx of [ - 1, 1 ] ) lacq.push( rbox( 0.022, 0.075, 2 * lz, 0.006, sx * lx, FRAME_TOP - 0.0375, 0 ) );
	// the box, slightly wider than the frame, its sides wrapping the knobs' axle
	lacq.push( rbox( W - 0.01, BOX_TOP - BOX_BOTTOM, D - 0.01, 0.01, 0, ( BOX_TOP + BOX_BOTTOM ) / 2, 0 ) );
	mesh( mergeGeometries( lacq ), lacquer );

	// scissor lift: two crossed bars at each end, under the box
	const bars = [];
	for ( const sx of [ - 1, 1 ] ) for ( const t of [ - 1, 1 ] ) {

		const len = Math.hypot( 0.2, BOX_BOTTOM - FRAME_TOP );
		const bar = new THREE.BoxGeometry( 0.012, len, 0.006 ).rotateX( t * Math.atan2( 0.2, BOX_BOTTOM - FRAME_TOP ) )
			.translate( sx * ( lx - 0.06 ), ( FRAME_TOP + BOX_BOTTOM ) / 2, t * 0.004 );
		bars.push( bar.toNonIndexed() );

	}

	mesh( mergeGeometries( bars ), metal );

	// cushion: the tufted relief measured from a photo of a tufted bench (benchtop.js,
	// tools/bench-top.py: 13 buttons in three staggered rows, the diamond creases between them) over
	// the whole top, rolled down into the side at its edge (cushionGeometry: one surface)
	{

		const { geo, top } = cushionGeometry( SEAT - BOX_TOP );
		mesh( geo.translate( 0, BOX_TOP, 0 ), leather );
		const btn = [];
		for ( const [ u, v ] of BENCH_TOP.buttons ) for ( const sx of u ? [ - 1, 1 ] : [ 1 ] ) for ( const sz of v ? [ - 1, 1 ] : [ 1 ] ) {

			const bx = sx * u * W / 2, bz = sz * v * D / 2;
			btn.push( new THREE.SphereGeometry( 0.0075, 12, 8 ).scale( 1, 0.55, 1 ).translate( bx, BOX_TOP + top( bx, bz ) + 0.0012, bz ).toNonIndexed() );		// (on the dimple's floor)

		}
		mesh( mergeGeometries( btn ), button );

	}

	// the height knobs, one each end of the box (knobGeometry: a rosette on the box, a neck, a fluted grip)
	for ( const sx of [ - 1, 1 ] ) mesh( knobGeometry( sx, ( W - 0.01 ) / 2, ( BOX_TOP + BOX_BOTTOM ) / 2, 0.02 ), knobMat );

	return group;

}

export const BENCH = { width: W, depth: D, seat: SEAT };

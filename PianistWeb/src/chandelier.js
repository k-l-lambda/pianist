// A crystal chandelier, built procedurally (the Konzerthaus Berlin's Großer Saal: it stands in for the
// scanned `kronleuchter` of tools/hall-asset.mjs's packs, too coarse at its size). An Empire basket
// chandelier, its proportions from the hall's photos (Footages.local/ref/chandelier/: the main ring's
// diameter D 2.2 m as the scan's), in its own frame: y up, its origin at the main ring's centre (where the
// hall's chandelier light is):
//
//   +5.99          the ceiling: a canopy, the rod down from it, a few knops
//   +2.45 .. +2.8  the crown: a gilt cap over a small ring (0.37 D) with a crest of leaves
//   +2.45 .. +0.1  the tent: a tall truncated cone of straight, taut bead strands, radially, from the crown
//                  ring down to the main ring
//   -0.06 .. +0.35 the main ring: a wide moulded band, a crest of leaves; 40 candles, 24 on arms outside and
//                  16 on the band, their tips the only light; a fringe of short drops round its lower edge
//   -0.08 .. -0.88 the basket: a hanging hemisphere of strands to a small gilt ring (0.15 D), swags round it
//   -0.88 .. -1.12 the skirt: a short cylinder of pendant strands, prisms at their ends
//
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = ( x, y, z ) => new THREE.Vector3( x, y, z );

// the shape (m, the chandelier's frame)
export const CHANDELIER = {
	ceiling: 5.99,
	crownY: 2.45, crownR: 0.41,
	ringR: 1.1, ringY: 0.0,			// the main ring (its band's outer radius)
	tentR: 0.98, tentY: 0.1,			// where the tent's strands meet it
	basketR: 0.97, basketY: - 0.08, bottomR: 0.17, bottomY: - 0.88,
	skirtLen: 0.22,
	tentStrands: 72, basketStrands: 60, fringeStrands: 120, skirtStrands: 36,
	candlesOuter: 24, candlesInner: 16, candleLen: 0.2,
	bead: { r: 0.0085, len: 0.024, pitch: 0.026 },		// (an octagonal bead: its girdle's radius, its length; the strands' pitch)
};

// the path tracer's crystals: within NEAR m (horizontally) of the stage's piano the bead pitch × NEARPITCH, else
// × PITCH (bigger beads × SCALE): ~1 M triangles for the hall's fourteen
export const CHANDELIER_PT_LOD = { near: 6, nearPitch: 1.3, pitch: 4.5, scale: 1.55 };

function rng( seed ) {

	let s = seed >>> 0;
	return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul( s ^ s >>> 15, 1 | s ); t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t; return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296; };

}

/** A faceted solid of revolution: `n` sides, rings [ r, y ] top down, each facet flat (non-indexed, face normals). */
function facetedLathe( rings, n, twist = 0 ) {

	const pos = [];
	for ( let k = 0; k + 1 < rings.length; ++ k ) {

		const [ r0, y0 ] = rings[ k ], [ r1, y1 ] = rings[ k + 1 ];
		for ( let i = 0; i < n; ++ i ) {

			const a0 = ( i + k * twist ) / n * Math.PI * 2, a1 = ( i + 1 + k * twist ) / n * Math.PI * 2;
			const b0 = ( i + ( k + 1 ) * twist ) / n * Math.PI * 2, b1 = ( i + 1 + ( k + 1 ) * twist ) / n * Math.PI * 2;
			const p00 = [ r0 * Math.cos( a0 ), y0, r0 * Math.sin( a0 ) ], p01 = [ r0 * Math.cos( a1 ), y0, r0 * Math.sin( a1 ) ];
			const p10 = [ r1 * Math.cos( b0 ), y1, r1 * Math.sin( b0 ) ], p11 = [ r1 * Math.cos( b1 ), y1, r1 * Math.sin( b1 ) ];
			if ( r0 > 1e-6 ) pos.push( ...p00, ...p01, ...p10 );
			if ( r1 > 1e-6 ) pos.push( ...p01, ...p11, ...p10 );

		}

	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.computeVertexNormals();		// (non-indexed: each face its own normal)
	return g;

}

// the shared crystal geometries (unit: as built; instances scale them)
let _geos = null;
function crystalGeometries() {

	if ( _geos ) return _geos;
	const B = CHANDELIER.bead;
	_geos = {
		// an octagonal bead: two eight-sided pyramids, girdle to girdle, along y
		bead: facetedLathe( [ [ 0, B.len / 2 ], [ B.r, 0 ], [ 0, - B.len / 2 ] ], 8 ),
		// a pendeloque: an almond, eight facets round, its top a small collet
		drop: facetedLathe( [ [ 0, 0 ], [ 0.012, - 0.012 ], [ 0.019, - 0.035 ], [ 0.016, - 0.055 ], [ 0, - 0.085 ] ], 8, 0.5 ),
		// a prism (the skirt's ends): a long hexagonal drop
		prism: facetedLathe( [ [ 0, 0 ], [ 0.007, - 0.008 ], [ 0.009, - 0.05 ], [ 0, - 0.068 ] ], 6 ),
		// the finial: a faceted ball
		ball: ( () => { const g = new THREE.IcosahedronGeometry( 1, 1 ).toNonIndexed(); g.deleteAttribute( 'uv' ); g.computeVertexNormals(); return g; } )(),
	};
	return _geos;

}

/** Point and tangent along a polyline at arc lengths `step` apart (from `s0`). */
function along( pts, step, s0 = step / 2 ) {

	const seg = [], out = [];
	let L = 0;
	for ( let i = 0; i + 1 < pts.length; ++ i ) { const d = pts[ i ].distanceTo( pts[ i + 1 ] ); seg.push( [ L, d ] ); L += d; }
	for ( let s = s0; s < L; s += step ) {

		let i = seg.findIndex( ( [ a, d ] ) => s <= a + d );
		if ( i < 0 ) i = seg.length - 1;
		const [ a, d ] = seg[ i ], u = d > 0 ? ( s - a ) / d : 0;
		out.push( { p: pts[ i ].clone().lerp( pts[ i + 1 ], u ), t: pts[ i + 1 ].clone().sub( pts[ i ] ).normalize() } );

	}
	return out;

}

/** The basket's meridian at angle `a`: a hemisphere (an ellipse's quarter) from the ring down to the bottom ring. */
function basketCurve( a, sag = 0 ) {

	const C = CHANDELIER, pts = [];
	for ( let i = 0; i <= 40; ++ i ) {

		const u = i / 40 * Math.PI / 2, r = C.bottomR + ( C.basketR - C.bottomR ) * Math.cos( u ) + sag * Math.sin( 2 * u );
		const y = C.basketY + ( C.bottomY - C.basketY ) * Math.sin( u );
		pts.push( V( r * Math.cos( a ), y, r * Math.sin( a ) ) );

	}
	return pts;

}

/** A festoon: a swag of beads hanging between `a` and `b`, `sag` m at its middle (a parabola). */
function swag( a, b, sag, n = 24 ) {

	const pts = [];
	for ( let i = 0; i <= n; ++ i ) { const u = i / n; pts.push( a.clone().lerp( b, u ).add( V( 0, - sag * 4 * u * ( 1 - u ), 0 ) ) ); }
	return pts;

}

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _up = V( 0, 1, 0 );
/** The crystals' layout: per kind a list of matrices (the chandelier's frame). `pitchK`, `scaleK`: the path tracer's coarser one. */
export function crystalLayout( { pitchK = 1, scaleK = 1, seed = 1 } = {} ) {

	const C = CHANDELIER, B = C.bead, r = rng( seed ), out = { bead: [], drop: [], prism: [], ball: [] };
	const pitch = B.pitch * pitchK;
	const put = ( kind, p, t, s = 1, spin = 0 ) => {

		_q.setFromUnitVectors( _up, t );
		if ( spin ) _q.multiply( new THREE.Quaternion().setFromAxisAngle( _up, spin ) );
		out[ kind ].push( _m.compose( p, _q, _s.setScalar( s ) ).clone() );

	};
	const strand = ( pts, kind = 'bead', s = scaleK ) => { for ( const { p, t } of along( pts, pitch ) ) put( kind, p, t, s * ( 0.92 + 0.16 * r() ), r() * 0.8 ); };
	const at = ( rad, a, y ) => V( rad * Math.cos( a ), y, rad * Math.sin( a ) );
	// the tent: straight strands from the crown ring to the main ring
	for ( let i = 0; i < C.tentStrands; ++ i ) {

		const a = ( i + 0.5 ) / C.tentStrands * Math.PI * 2;
		strand( [ at( C.crownR - 0.01, a, C.crownY - 0.02 ), at( C.tentR, a, C.tentY ) ] );

	}
	// the fringe: short strands round the main ring's lower edge, each ending in a drop or a prism
	for ( let i = 0; i < C.fringeStrands; ++ i ) {

		const a = ( i + 0.5 ) / C.fringeStrands * Math.PI * 2, len = 0.07 + 0.03 * ( i % 2 );
		const top = at( C.ringR - 0.015, a, - 0.07 ), end = top.clone().add( V( 0, - len, 0 ) );
		strand( [ top, end ] );
		put( i % 2 ? 'drop' : 'prism', end.clone().add( V( 0, - 0.004, 0 ) ), V( 0, 1, 0 ), scaleK * ( i % 2 ? 0.8 : 1 ), a );

	}
	// the basket: meridian strands from the ring to the bottom ring, and swags round it at three heights
	for ( let i = 0; i < C.basketStrands; ++ i ) strand( basketCurve( ( i + 0.5 ) / C.basketStrands * Math.PI * 2, ( r() - 0.5 ) * 0.01 ) );
	for ( const [ u, n, sag ] of [ [ 0.18, 30, 0.06 ], [ 0.45, 24, 0.055 ], [ 0.72, 16, 0.045 ] ] ) {

		const w = u * Math.PI / 2, rad = C.bottomR + ( C.basketR - C.bottomR ) * Math.cos( w ) + 0.012, y = C.basketY + ( C.bottomY - C.basketY ) * Math.sin( w );
		for ( let i = 0; i < n; ++ i ) strand( swag( at( rad, i / n * Math.PI * 2, y ), at( rad, ( i + 1 ) / n * Math.PI * 2, y ), sag ) );

	}
	// the skirt: pendant strands from the bottom ring, prisms at their ends
	for ( let i = 0; i < C.skirtStrands; ++ i ) {

		const a = ( i + 0.5 ) / C.skirtStrands * Math.PI * 2, top = at( C.bottomR - 0.01, a, C.bottomY - 0.02 ), end = top.clone().add( V( 0, - C.skirtLen + 0.02 * ( i % 2 ), 0 ) );
		strand( [ top, end ] );
		put( 'prism', end.clone().add( V( 0, - 0.004, 0 ) ), V( 0, 1, 0 ), scaleK, a );

	}
	// in the skirt's middle: a faceted ball and a drop
	put( 'ball', V( 0, C.bottomY - 0.1, 0 ), V( 0, 1, 0 ), 0.06 * Math.min( scaleK, 1.15 ) );
	put( 'drop', V( 0, C.bottomY - 0.16, 0 ), V( 0, 1, 0 ), 1.4 );
	return out;

}

/** The gilt frame (one geometry, the chandelier's frame), the candles' wax and their flame tips. */
export function frameGeometries() {

	const C = CHANDELIER, gilt = [], wax = [], flame = [];
	const tube = ( pts, rad, seg = 6 ) => gilt.push( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), Math.max( 8, pts.length * 6 ), rad, seg, false ) );
	const ringAt = ( R, y, tubeR, seg = 128 ) => gilt.push( new THREE.TorusGeometry( R, tubeR, 8, seg ).rotateX( Math.PI / 2 ).translate( 0, y, 0 ) );
	const lathe = ( prof, seg = 32 ) => gilt.push( new THREE.LatheGeometry( prof.map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), seg ) );
	// the ceiling's canopy, the rod, its knops
	lathe( [ [ 0.001, C.ceiling - 0.01 ], [ 0.3, C.ceiling - 0.01 ], [ 0.28, C.ceiling - 0.05 ], [ 0.12, C.ceiling - 0.16 ], [ 0.05, C.ceiling - 0.25 ], [ 0.001, C.ceiling - 0.27 ] ] );
	gilt.push( new THREE.CylinderGeometry( 0.022, 0.022, C.ceiling - 2.84, 12, 1, true ).translate( 0, ( C.ceiling + 2.84 ) / 2, 0 ) );
	for ( const y of [ 3.3, 4.2, 5.1 ] ) gilt.push( new THREE.SphereGeometry( 0.05, 16, 10 ).scale( 1, 0.8, 1 ).translate( 0, y, 0 ) );
	const leaves = ( R, y, n, h ) => { for ( let i = 0; i < n; ++ i ) { const a = i / n * Math.PI * 2; gilt.push( new THREE.ConeGeometry( h * 0.32, h, 4 ).scale( 1, 1, 0.35 ).translate( 0, h / 2, 0 ).rotateY( - a + Math.PI / 2 ).translate( R * Math.cos( a ), y, R * Math.sin( a ) ) ); } };
	// the crown: a cap over a moulded ring, a crest of leaves
	lathe( [ [ 0.001, 2.86 ], [ 0.05, 2.84 ], [ 0.09, 2.78 ], [ 0.13, 2.72 ], [ 0.3, 2.62 ], [ 0.4, 2.55 ], [ 0.44, 2.5 ], [ 0.43, 2.44 ], [ 0.4, 2.42 ], [ 0.38, 2.45 ] ], 64 );
	ringAt( C.crownR + 0.01, 2.43, 0.014 );
	leaves( C.crownR + 0.02, 2.55, 20, 0.07 );
	// the stem inside the tent, down to the bottom ring: open round the centre, where the hall's chandelier light
	// is (it lights the crystals, not a hub round it); spokes to the main ring
	gilt.push( new THREE.CylinderGeometry( 0.02, 0.02, 2.45 - 0.14, 10, 1, true ).translate( 0, ( 2.45 + 0.14 ) / 2, 0 ) );
	gilt.push( new THREE.CylinderGeometry( 0.016, 0.016, - 0.14 - C.bottomY, 10, 1, true ).translate( 0, ( - 0.14 + C.bottomY ) / 2, 0 ) );
	for ( let i = 0; i < 8; ++ i ) {

		const a = ( i + 0.5 ) / 8 * Math.PI * 2, c = Math.cos( a ), s = Math.sin( a );
		tube( [ V( 0.02 * c, - 0.14, 0.02 * s ), V( 0.5 * c, - 0.04, 0.5 * s ), V( ( C.ringR - 0.05 ) * c, - 0.02, ( C.ringR - 0.05 ) * s ) ], 0.009 );
		tube( [ V( 0.02 * c, C.bottomY + 0.3, 0.02 * s ), V( C.bottomR * c, C.bottomY + 0.02, C.bottomR * s ) ], 0.006 );

	}
	// the main ring: a wide moulded band (beads top and bottom, a broad frieze), a crest of leaves on it
	lathe( [ [ C.ringR - 0.06, - 0.07 ], [ C.ringR - 0.005, - 0.07 ], [ C.ringR + 0.008, - 0.058 ], [ C.ringR - 0.002, - 0.048 ], [ C.ringR + 0.004, - 0.04 ], [ C.ringR + 0.004, 0.03 ],
		[ C.ringR - 0.002, 0.038 ], [ C.ringR + 0.012, 0.05 ], [ C.ringR + 0.006, 0.065 ], [ C.ringR - 0.06, 0.065 ], [ C.ringR - 0.06, - 0.07 ] ], 192 );
	leaves( C.ringR - 0.01, 0.065, 48, 0.06 );
	ringAt( C.tentR, C.tentY, 0.01 );
	// the bottom ring: a small band
	lathe( [ [ C.bottomR - 0.02, C.bottomY - 0.025 ], [ C.bottomR + 0.008, C.bottomY - 0.025 ], [ C.bottomR + 0.014, C.bottomY - 0.01 ], [ C.bottomR + 0.008, C.bottomY + 0.02 ], [ C.bottomR - 0.02, C.bottomY + 0.02 ], [ C.bottomR - 0.02, C.bottomY - 0.025 ] ], 64 );
	// candles: their cups (a bobèche), the wax, a flame tip (the only light)
	const candle = p => {

		lathe( [ [ 0.001, 0 ], [ 0.016, 0.004 ], [ 0.026, 0.016 ], [ 0.018, 0.022 ], [ 0.015, 0.03 ], [ 0.001, 0.03 ] ], 12 );
		gilt[ gilt.length - 1 ].translate( p.x, p.y, p.z );
		wax.push( new THREE.CylinderGeometry( 0.012, 0.013, C.candleLen, 10 ).translate( p.x, p.y + 0.03 + C.candleLen / 2, p.z ) );
		flame.push( new THREE.SphereGeometry( 0.01, 10, 8 ).scale( 1, 1.8, 1 ).translate( p.x, p.y + 0.03 + C.candleLen + 0.016, p.z ) );

	};
	// the outer tier on S arms out from the band, the inner on the band
	for ( let i = 0; i < C.candlesOuter; ++ i ) {

		const a = ( i + 0.5 ) / C.candlesOuter * Math.PI * 2, c = Math.cos( a ), s = Math.sin( a ), R = C.ringR + 0.17;
		tube( [ V( ( C.ringR - 0.01 ) * c, - 0.02, ( C.ringR - 0.01 ) * s ), V( ( C.ringR + 0.09 ) * c, - 0.05, ( C.ringR + 0.09 ) * s ), V( ( R - 0.02 ) * c, 0.0, ( R - 0.02 ) * s ), V( R * c, 0.07, R * s ) ], 0.009 );
		candle( V( R * c, 0.07, R * s ) );

	}
	for ( let i = 0; i < C.candlesInner; ++ i ) { const a = i / C.candlesInner * Math.PI * 2; candle( V( ( C.ringR - 0.035 ) * Math.cos( a ), 0.13, ( C.ringR - 0.035 ) * Math.sin( a ) ) ); }
	const clean = gs => mergeGeometries( gs.map( g => { const n = g.index ? g.toNonIndexed() : g; for ( const k of Object.keys( n.attributes ) ) if ( ! [ 'position', 'normal' ].includes( k ) ) n.deleteAttribute( k ); return n; } ), false );
	return { gilt: clean( gilt ), wax: clean( wax ), flame: clean( flame ) };

}

/**
 * The raster crystal: a dielectric without a transmission pass (MeshStandardMaterial underneath: its
 * reflection of the environment and its lights' highlights as glass's, F0 0.045, roughness 0.035). Added:
 * light through the facet: the view ray refracted in (ior per colour: dispersion), turned at a back facet
 * (a direction from the facet's hash: the cut's brilliance; out by refraction, or reflected on when past
 * the critical angle) and out, reading the environment and the chandelier's candle rings (their glow round
 * the ray: uLamp, the house lights' level), × ( 1 − Fresnel ). The chandelier's centre: its model matrix's
 * origin (each chandelier its own meshes).
 */
export function crystalMaterial() {

	const m = new THREE.MeshStandardMaterial( { color: 0x000000, metalness: 0, roughness: 0.035, envMapIntensity: 1 } );
	const u = m.userData.u = { uLamp: { value: 1 }, uLampColor: { value: new THREE.Color( '#ffcf94' ) }, uRings: { value: new THREE.Vector4( CHANDELIER.ringR + 0.17, 0.32, CHANDELIER.ringR - 0.035, 0.38 ) } };
	m.onBeforeCompile = sh => {

		Object.assign( sh.uniforms, u );
		sh.vertexShader = sh.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vCWorld;\nvarying vec3 vCCentre;\nflat varying float vCHash;' )
			.replace( '#include <project_vertex>', `#include <project_vertex>
			{
				vec4 wp = vec4( transformed, 1.0 );
				#ifdef USE_INSTANCING
					wp = instanceMatrix * wp;
				#endif
				vCWorld = ( modelMatrix * wp ).xyz;
				vCCentre = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
				// (a facet's hash: its instance and its face, flat across the face)
				vCHash = fract( sin( float( gl_InstanceID ) * 12.9898 + float( gl_VertexID / 3 ) * 78.233 ) * 43758.5453 );
			}` );
		sh.fragmentShader = sh.fragmentShader
			.replace( 'void main() {', `
			varying vec3 vCWorld;
			varying vec3 vCCentre;
			flat varying float vCHash;
			uniform float uLamp;
			uniform vec3 uLampColor;
			uniform vec4 uRings;		// (outer ring r, its candles' height; inner ring r, its candles' height)
			// the candle rings' glow along a ray (world): each ring a circle of light in the chandelier's frame,
			// its glow falling off with the ray's distance from it
			float cRingGlow( vec3 o, vec3 d, float R, float h ) {
				vec3 p = o - vCCentre;
				float t = clamp( ( h - p.y ) / ( abs( d.y ) > 1e-3 ? d.y : 1e-3 ), 0.0, 4.0 );
				vec3 q = p + d * t;
				float e = length( vec2( length( q.xz ) - R, q.y - h ) );
				// (the ray's nearest pass along it, a few samples: a ray along the ring's plane)
				for ( int k = 0; k < 4; k ++ ) {
					vec3 q2 = p + d * ( float( k ) * 0.6 + 0.2 );
					e = min( e, length( vec2( length( q2.xz ) - R, q2.y - h ) ) );
				}
				return exp( - e * e / 0.0045 ) * 1.6 + exp( - e / 0.12 ) * 0.25;
			}
			vec3 cGlow( vec3 o, vec3 d ) {
				vec3 p = o - vCCentre;
				float c = length( cross( d, - p ) );		// (the centre's light: the ray's distance from it)
				float g = cRingGlow( o, d, uRings.x, uRings.y ) + cRingGlow( o, d, uRings.z, uRings.w ) + 0.4 * exp( - c / 0.25 ) * step( 0.0, dot( d, - p ) );
				return uLampColor * g * uLamp;
			}
			vec3 cEnv( vec3 d ) {
				#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
					return textureCubeUV( envMap, envMapRotation * d, 0.02 ).rgb * envMapIntensity;
				#else
					return vec3( 0.0 );
				#endif
			}
			void main() {` )
			.replace( '#include <opaque_fragment>', `
			{
				vec3 n = normalize( inverseTransformDirection( normal, viewMatrix ) );		// (world)
				vec3 v = normalize( vCWorld - cameraPosition );
				if ( dot( n, v ) > 0.0 ) n = - n;
				float cosI = clamp( - dot( v, n ), 0.0, 1.0 );
				float F = 0.045 + 0.955 * pow( 1.0 - cosI, 5.0 );
				// a back facet from the hash: mostly facing away along the ray, tilted by the cut
				vec3 hb = vec3( fract( vCHash * 7.13 ), fract( vCHash * 13.7 ), fract( vCHash * 31.1 ) ) * 2.0 - 1.0;
				vec3 trans = vec3( 0.0 );
				vec3 iors = vec3( 1.535, 1.55, 1.57 );
				for ( int c = 0; c < 3; c ++ ) {
					float eta = iors[ c ];
					vec3 t1 = refract( v, n, 1.0 / eta );
					vec3 nb = normalize( - t1 + hb * 0.85 );		// (the back facet's outward normal)
					vec3 t2 = refract( t1, - nb, eta );
					if ( dot( t2, t2 ) < 1e-4 ) t2 = reflect( t1, - nb );		// (past the critical angle: on, inside: read as out)
					// (and the chandelier's own light seen through the glass: its candles, its other crystals, an
					// average glow everywhere; a facet now and then lined up with a flame (by the hash and the ray's
					// direction, so the glints move as the eye does): sparkle)
					float h2 = fract( sin( vCHash * 91.7 + floor( dot( t2, vec3( 0.61, 0.48, 0.63 ) ) * 7.0 ) * 17.3 + float( c ) * 0.0 ) * 43758.5453 );
					vec3 Lc = cEnv( t2 ) + cGlow( vCWorld, t2 ) + uLampColor * uLamp * ( 0.16 + 3.5 * pow( h2, 14.0 ) );
					trans[ c ] = Lc[ c ];
				}
				outgoingLight += trans * ( 1.0 - F ) * 0.92;
			}
			#include <opaque_fragment>` );

	};
	m.customProgramCacheKey = () => 'crystalFacet2';
	return m;

}

/** The path tracer's crystal: glass. */
export function crystalPTMaterial() {

	return new THREE.MeshPhysicalMaterial( { color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, ior: 1.55, thickness: 0.01, specularIntensity: 1 } );

}

/** One chandelier's crystals as instanced meshes (raster), from `layout` (crystalLayout). */
export function crystalInstances( layout, material ) {

	const G = crystalGeometries(), out = [];
	for ( const [ kind, mats ] of Object.entries( layout ) ) {

		if ( ! mats.length ) continue;
		const im = new THREE.InstancedMesh( G[ kind ], material, mats.length );
		mats.forEach( ( M, i ) => im.setMatrixAt( i, M ) );
		im.instanceMatrix.needsUpdate = true;
		im.computeBoundingSphere();
		im.frustumCulled = true;
		im.name = `chandelier:${ kind }`;
		out.push( im );

	}
	return out;

}

/** One chandelier's crystals merged (the path tracer: no instancing), from `layout`. */
export function crystalMerged( layout ) {

	const G = crystalGeometries(), parts = [];
	for ( const [ kind, mats ] of Object.entries( layout ) ) for ( const M of mats ) parts.push( G[ kind ].clone().applyMatrix4( M ) );
	return mergeGeometries( parts, false );

}

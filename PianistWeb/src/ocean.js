// The sea's surface as a statistical wave field (Tessendorf's FFT ocean), for Azurea's open sea.
//
// The spectrum: a fetch-limited JONSWAP wind sea with Hasselmann's directional spreading (narrow at the peak,
// near-isotropic for the short waves: the ripples run every way, not one), plus an optional swell (a narrow band
// from one direction). Its short-wave end is damped above k_d, found so that the field's total mean square slope
// is Cox & Munk's for the wind speed (1954, clean surface: 0.003 + 5.12e-3 U): the glitter's width is the
// measured sea's, not a guess. The deep-water dispersion with surface tension (ω² = g k + σ/ρ k³).
//
// Four cascades (tiles of 257, 37.3, 5.5 and 0.79 m, 256² each; their wavenumber bands contiguous, no mode in two),
// each turned by its own angle so no two tile together. Per frame: the spectrum at t (a fragment pass), its
// inverse FFT (16 Stockham passes, two complex fields at once: the slopes ∂h/∂x + i ∂h/∂z and the height), and
// the moments: per cascade two half-float textures with mipmaps, (sx, sz, sx², sz²) and (h, sx sz), in world axes.
// A pixel's sample of them over its footprint (textureGrad) is the mean and the covariance of the slopes there:
// the resolved waves' normal, and the roughness of what is finer than the pixel (LEAN mapping, Olano & Baker 2010;
// the sea BRDF of Bruneton, Neyret & Holzschuch 2010). What is finer than the finest cascade: `tail` (uniform).
//
// Gusts (cat's paws): the short waves' amplitude varies over the sea, a log-normal factor a( x, z, t ) = exp( L ) of
// three octaves of value noise (periodic, quintic: C²) drifting downwind at about the wind's speed and slowly
// re-drawn (gustGLSL); each cascade follows it by its own share (GUST_SHARE: not the long waves, fully the ripples
// and the tail), its slopes and height × a^k, their variance × a^2k. The raster takes the octaves finer than its
// pixel's footprint as a variance of L (the mean and the moments of a log-normal: no shimmer far off); the path
// tracer takes a at its point. Off (gust 0): exactly the sea before.
//
// A pure function of the render clock (h0 from a fixed seed; the phases reduced modulo a 1200 s period on the CPU,
// in double): every worker of an offline render draws the same sea at the same t.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const G = 9.81, SIGMA = 0.074 / 1025;		// (m/s², the surface tension over the density: m³/s²)
export const N = 256;
export const CASCADES = [
	{ L: 257, angle: 0.0 }, { L: 37.3, angle: 0.61 }, { L: 5.5, angle: 1.37 }, { L: 0.79, angle: 2.29 },
];
// (how much each cascade's waves follow the gusts: the 257 m tile's (the dominant waves, the swell) not at all)
export const GUST_SHARE = [ 0, 0.5, 1, 1 ];
// the octaves: their scales (× gustScale, m: across the wind; 1.6× longer along it), weights, drift (× the wind's
// speed) and re-draw rate (cells per metre the wind blows); the noise's own spread (std of one octave: measured)
const GUST_OCT = [ { s: 1, w: 0.6, drift: 0.8, rate: 0.12 }, { s: 0.42, w: 0.3, drift: 0.9, rate: 0.18 }, { s: 0.18, w: 0.15, drift: 1.0, rate: 0.25 } ];
const GUST_STD = 0.4, GUST_W = GUST_OCT.reduce( ( a, o ) => a + o.w, 0 );
const GUST_K = 3.2;		// (L = GUST_K g n / ( GUST_W GUST_STD ), n the octaves' weighted sum)
// (L's standard deviation per unit of gust: the octaves independent)
const GUST_LSTD = GUST_K * Math.sqrt( GUST_OCT.reduce( ( a, o ) => a + o.w * o.w, 0 ) ) / GUST_W;
const GUST_PERIOD = 256;		// (the noise's lattice period, cells: the offsets wrapped by it on the CPU, in double)
// cat's paws (an additive layer: a second, young wind sea on the short-wave cascades where a gust touches down, on
// a sea that may have no wind of its own): their patches' octaves (× pawScale, m, across; 1.6× along the wind;
// drift × pawWind; re-draw rate as the gusts'), the cascades they cover, their sea's fetch (m: young, short waves)
// Each octave's drift turns slowly: across the wind at U Σ b sin( 2π t / T + φ ) (its direction swinging ±~40°
// about the wind's, never still: the patches wander), its offset that velocity's integral (closed form: in double).
const PAW_OCT = [
	{ s: 1, w: 0.7, drift: 0.9, rate: 0.12, turn: [ [ 0.6, 71, 0.4 ], [ 0.3, 29, 2.1 ] ] },
	{ s: 0.38, w: 0.35, drift: 1.0, rate: 0.2, turn: [ [ 0.6, 53, 1.7 ], [ 0.3, 23, 4.4 ] ] },
	{ s: 0.15, w: 0.15, drift: 1.0, rate: 0.3, turn: [ [ 0.6, 41, 3.3 ], [ 0.3, 17, 0.9 ] ] },
];
const PAW_D = GUST_STD * Math.sqrt( PAW_OCT.reduce( ( a, o ) => a + o.w * o.w, 0 ) );		// (n's std: n / PAW_D ~ N( 0, 1 ))
// Their ripples run out from each patch's core (the patch field's downhill direction, turned by a slow noise ±25°;
// the wind's where the field is flat): a direction θ( x, t ) a point. The cat's paws' sea is built at four fixed
// directions (world: +x, +z, −x, −z) and blended by θ, a basis d weighted sqrt( f_d / Σ f ), f_d = ( 1 + cos( θ − φ_d ) )⁴:
// over the whole circle (θ and θ + 180° apart: the waves' travel, one-sided), the weights' squares summing to 1
// (independent draws: the variance the same whatever θ, no seams where it turns). Four, not three: at the peak
// (s ~7 there) a blend of bases 120° apart has two lobes (the valley between them 0.27 of the peak); 90° apart with
// the spreading held to s ≤ 3.5 it has one (0.999; 6 bases would not need the cap, at 1.5× the cost). Only the
// 37.3 and 5.5 m cascades (the peak, λ ~1.9 m, and the band above it: their slopes 75 % of the paws'); the 0.79 m
// one's ripples run every way already (s 0.15) and it is one field.
const PAW_DIRS = 4, PAW_SPREAD_MAX = 3.5;
export const PAW_LAYERS = [ ...[ 0, 1, 2, 3 ].map( d => ( { ci: 1, d } ) ), ...[ 0, 1, 2, 3 ].map( d => ( { ci: 2, d } ) ), { ci: 3, d: - 1 } ];
const PAW_FETCH = 1500, PAW_SOFT = 0.45;		// (m; the patches' edge, in σ of n either side of the threshold)
const PAW_GRAD = [ 1, 0.4 ];		// (the octaves' shares in the patches' downhill direction: the largest's shape, the middle's a little)
const PAW_BIAS = 0.35, PAW_DIRSCALE = 60, PAW_DIRTIME = 45;		// (the wind's share of θ; the direction noise's scale (m) and time (s a cell))
// (for a comparison, ?pawsOneWay: every patch's ripples the wind's way (as before they turned; the patches the same)
const PAW_ONE_WAY = typeof location !== 'undefined' && new URLSearchParams( location.search ).has( 'pawsOneWay' );
// (the normal's quantile: Acklam's rational fit, the patches' threshold from their cover)
function probit( p ) {

	const a = [ - 39.69683028665376, 220.9460984245205, - 275.9285104469687, 138.357751867269, - 30.66479806614716, 2.506628277459239 ];
	const b = [ - 54.47609879822406, 161.5858368580409, - 155.6989798598866, 66.80131188771543, - 13.28068155288572 ];
	const c = [ - 0.007784894002430293, - 0.3223964580411365, - 2.400758277161838, - 2.549732539343734, 4.374664141464968, 2.938163982698783 ];
	const d = [ 0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416 ];
	p = Math.min( Math.max( p, 1e-6 ), 1 - 1e-6 );
	if ( p < 0.02425 ) { const q = Math.sqrt( - 2 * Math.log( p ) ); return ( ( ( ( ( c[ 0 ] * q + c[ 1 ] ) * q + c[ 2 ] ) * q + c[ 3 ] ) * q + c[ 4 ] ) * q + c[ 5 ] ) / ( ( ( ( d[ 0 ] * q + d[ 1 ] ) * q + d[ 2 ] ) * q + d[ 3 ] ) * q + 1 ); }
	if ( p > 1 - 0.02425 ) return - probit( 1 - p );
	const q = p - 0.5, r = q * q;
	return ( ( ( ( ( a[ 0 ] * r + a[ 1 ] ) * r + a[ 2 ] ) * r + a[ 3 ] ) * r + a[ 4 ] ) * r + a[ 5 ] ) * q / ( ( ( ( ( b[ 0 ] * r + b[ 1 ] ) * r + b[ 2 ] ) * r + b[ 3 ] ) * r + b[ 4 ] ) * r + 1 );

}

/**
 * GLSL: the gust field. `prefix` the uniforms' (uOc for the raster, ptOc for the path tracer: the same values).
 *   <p>Gust      ( g · GUST_K / GUST_W / GUST_STD, cos, sin of the wind's direction, V: L's variance )
 *   <p>GustO[ i ] ( the octave's offset along, across, its time (cells, wrapped), 1 / its scale (1/m) )
 * `float <p>GustL( vec2 xz, float foot, out float s2 )`: L at xz; with foot (m, the pixel's) > 0 the octaves finer
 * than it faded out, their variance in s2. A cascade takes a^k = exp( k L − k² V ): the mean of a^2k over the sea
 * is 1 (its mean square slope Cox & Munk's still: the gusts move the roughness about, they add none).
 */
function gustGLSL( p, pawGuard = false ) {

	return /* glsl */`
	uniform vec4 ${ p }Gust, ${ p }GustO[ ${ GUST_OCT.length } ];
	float ${ p }GustHash( ivec3 c ) {
		uvec3 v = uvec3( c & ${ GUST_PERIOD - 1 } ) * 1664525u + 1013904223u;
		v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
		return float( ( v.x ^ v.y ^ v.z ) & 0xffffu ) / 32767.5 - 1.0;
	}
	float ${ p }GustNoise( vec3 q ) {
		vec3 fl = floor( q ), f = q - fl; ivec3 i = ivec3( fl );
		vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
		return mix( mix( mix( ${ p }GustHash( i ), ${ p }GustHash( i + ivec3( 1, 0, 0 ) ), u.x ), mix( ${ p }GustHash( i + ivec3( 0, 1, 0 ) ), ${ p }GustHash( i + ivec3( 1, 1, 0 ) ), u.x ), u.y ),
			mix( mix( ${ p }GustHash( i + ivec3( 0, 0, 1 ) ), ${ p }GustHash( i + ivec3( 1, 0, 1 ) ), u.x ), mix( ${ p }GustHash( i + ivec3( 0, 1, 1 ) ), ${ p }GustHash( i + ivec3( 1, 1, 1 ) ), u.x ), u.y ), u.z );
	}
	float ${ p }GustL( vec2 xz, float foot, out float s2 ) {
		s2 = 0.0;
		if ( ${ p }Gust.x <= 0.0 ) return 0.0;
		vec2 w = ${ p }Gust.yz;
		vec2 fr = vec2( dot( xz, w ) / 1.6, dot( xz, vec2( - w.y, w.x ) ) );		// (along the wind (stretched), across)
		float L = 0.0;
		${ GUST_OCT.map( ( o, i ) => `{
			vec4 O = ${ p }GustO[ ${ i } ];
			float keep = 1.0 - smoothstep( 0.3, 1.2, foot * O.w );
			if ( keep > 0.0 ) L += ${ o.w.toFixed( 3 ) } * keep * ${ p }GustNoise( vec3( fr * O.w - O.xy, O.z ) );
			s2 += ${ ( o.w * o.w * GUST_STD * GUST_STD ).toFixed( 5 ) } * ( 1.0 - keep * keep );
		}` ).join( '\n' ) }
		s2 *= ${ p }Gust.x * ${ p }Gust.x;
		return ${ p }Gust.x * L;
	}
	${ pawGuard ? '#ifdef OCEAN_PAWS' : '' }
	// the cat's paws' weight: w = paws · smoothstep over n / σ about the threshold (most of the sea 0). <p>Paw: ( paws,
	// cos, sin of the wind's direction, the threshold ); <p>PawO[ i ] as <p>GustO. With foot > 0 (m) the octaves finer
	// than it are a spread of n (Gauss-Hermite, 3 points): E[ w ], and E[ w² ] in w2
	uniform vec4 ${ p }Paw, ${ p }PawO[ ${ PAW_OCT.length } ];
	uniform vec4 ${ p }PawD;		// ( the direction noise's time (cells, wrapped), 1 / its scale (1/m), the wind's share, pawScale (m) )
	float ${ p }PawF( float n ) { return ${ p }Paw.x * smoothstep( ${ p }Paw.w - ${ PAW_SOFT.toFixed( 3 ) }, ${ p }Paw.w + ${ PAW_SOFT.toFixed( 3 ) }, n ); }
	// (the noise and its derivatives along q.x, q.y)
	vec3 ${ p }GustNoiseD( vec3 q ) {
		vec3 fl = floor( q ), f = q - fl; ivec3 i = ivec3( fl );
		vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 ), du = 30.0 * f * f * ( f - 1.0 ) * ( f - 1.0 );
		float n000 = ${ p }GustHash( i ), n100 = ${ p }GustHash( i + ivec3( 1, 0, 0 ) ), n010 = ${ p }GustHash( i + ivec3( 0, 1, 0 ) ), n110 = ${ p }GustHash( i + ivec3( 1, 1, 0 ) );
		float n001 = ${ p }GustHash( i + ivec3( 0, 0, 1 ) ), n101 = ${ p }GustHash( i + ivec3( 1, 0, 1 ) ), n011 = ${ p }GustHash( i + ivec3( 0, 1, 1 ) ), n111 = ${ p }GustHash( i + ivec3( 1, 1, 1 ) );
		float a = mix( n000, n100, u.x ), b = mix( n010, n110, u.x ), c = mix( n001, n101, u.x ), d = mix( n011, n111, u.x );
		float dx = mix( mix( n100 - n000, n110 - n010, u.y ), mix( n101 - n001, n111 - n011, u.y ), u.z ) * du.x;
		float dy = mix( b - a, d - c, u.z ) * du.y;
		return vec3( mix( mix( a, b, u.y ), mix( c, d, u.y ), u.z ), dx, dy );
	}
	// the weight, E[ w ] (E[ w² ] in w2); gn the patch field's gradient (its two larger octaves, PAW_GRAD: the patches'
	// shape, not their ragged edge; 1/m), dk how far the direction is resolved (the middle octave's keep: 1 near, 0 far)
	float ${ p }PawW( vec2 xz, float foot, out float w2, out vec2 gn, out float dk ) {
		vec2 w = ${ p }Paw.yz, wp = vec2( - w.y, w.x );
		vec2 fr = vec2( dot( xz, w ) / 1.6, dot( xz, wp ) );
		float n = 0.0, s2 = 0.0;
		gn = vec2( 0.0 ); dk = 0.0;
		${ PAW_OCT.map( ( o, i ) => `{
			vec4 O = ${ p }PawO[ ${ i } ];
			float keep = 1.0 - smoothstep( 0.3, 1.2, foot * O.w );
			if ( keep > 0.0 ) {
				vec3 g = ${ p }GustNoiseD( vec3( fr * O.w - O.xy, O.z ) );
				n += ${ ( o.w / PAW_D ).toFixed( 5 ) } * keep * g.x;
				${ i < 2 ? `gn += ${ ( o.w / PAW_D * PAW_GRAD[ i ] ).toFixed( 5 ) } * keep * O.w * ( w * ( g.y / 1.6 ) + wp * g.z );` : '' }
			}
			${ i === 1 ? 'dk = keep;' : '' }
			s2 += ${ ( ( o.w * GUST_STD / PAW_D ) ** 2 ).toFixed( 5 ) } * ( 1.0 - keep * keep );
		}` ).join( '\n' ) }
		if ( s2 < 1e-4 ) { float f = ${ p }PawF( n ); w2 = f * f; return f; }
		float e = 1.7320508 * sqrt( s2 ), f0 = ${ p }PawF( n ), fa = ${ p }PawF( n - e ), fb = ${ p }PawF( n + e );
		w2 = ( 4.0 * f0 * f0 + fa * fa + fb * fb ) / 6.0;
		return ( 4.0 * f0 + fa + fb ) / 6.0;
	}
	// the directional bases' weights (+x, +z, −x, −z): θ the field's downhill direction (and the wind's share), turned
	// by the slow noise; isotropic (each 1/2: their squares 1/4) where θ is undefined (the field flat against the
	// wind) or unresolved (finer than the pixel: the mean of the squares over θ's spread)
	vec4 ${ p }PawBasis( vec2 xz, vec2 gn, float dk ) {
		vec2 v = - gn * ${ p }PawD.w + ${ p }PawD.z * ${ p }Paw.yz;
		float r = length( v ), an = ${ ( 0.436 / GUST_STD ).toFixed( 4 ) } * sign( ${ p }PawD.y ) * ${ p }GustNoise( vec3( xz * ${ p }PawD.y + vec2( 17.3, 41.9 ), ${ p }PawD.x ) );
		vec2 u = r > 1e-6 ? v / r : vec2( 1.0, 0.0 );
		u = vec2( cos( an ) * u.x - sin( an ) * u.y, sin( an ) * u.x + cos( an ) * u.y );
		vec4 f = 1.0 + vec4( u.x, u.y, - u.x, - u.y ); f *= f; f *= f;
		float iso = max( 1.0 - smoothstep( 0.05, 0.25, r ), 1.0 - dk );
		return sqrt( ( 1.0 - iso ) * f / ( f.x + f.y + f.z + f.w ) + 0.25 * iso );
	}
	${ pawGuard ? '#endif' : '' }
`;

}

const REPEAT = 1200;		// (s: the ω quantised to multiples of 2π / REPEAT, the phases exact at any t)
const W0 = 2 * Math.PI / REPEAT;

export const omega = k => Math.sqrt( G * k + SIGMA * k * k * k );
export const dOmega = k => ( G + 3 * SIGMA * k * k ) / ( 2 * omega( k ) );

/** Cox & Munk's clean-surface mean square slopes for wind speed U (m/s): [ total, up-wind, cross-wind ]. */
export const coxMunk = U => [ 0.003 + 5.12e-3 * U, 0.000 + 3.16e-3 * U, 0.003 + 1.92e-3 * U ];

function lgamma( x ) {

	// (Lanczos, g = 7)
	const c = [ 0.99999999999980993, 676.5203681218851, - 1259.1392167224028, 771.32342877765313, - 176.61502916214059, 12.507343278686905, - 0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7 ];
	if ( x < 0.5 ) return Math.log( Math.PI / Math.abs( Math.sin( Math.PI * x ) ) ) - lgamma( 1 - x );
	x -= 1;
	let a = c[ 0 ]; const t = x + 7.5;
	for ( let i = 1; i < 9; ++ i ) a += c[ i ] / ( x + i );
	return 0.5 * Math.log( 2 * Math.PI ) + ( x + 0.5 ) * Math.log( t ) - t + Math.log( a );

}

/**
 * The sea state's spectrum: `S( w )` the wind sea's frequency spectrum (m² s), `D( w, theta )` its spreading
 * (theta from the wind's direction), `swellS`, `swellD` the swell's; `kd` the damping's wavenumber.
 */
export class SeaState {

	constructor( { wind = 2, windDir = 0, fetch = 40e3, swell = 0, swellDir = 0, swellPeriod = 9, spreadMax = Infinity } = {} ) {

		this.spreadMax = spreadMax;		// (the spreading's exponent held under it: the cat's paws' bases)

		// (below 0.3 m/s the wind sea of 0.3, its energy × ( wind / 0.3 )²: calm at 0, the swell alone)
		const U0 = Math.max( wind, 0 ), U = this.U = Math.max( U0, 0.3 );
		this.windDir = windDir; this.swellDir = swellDir;
		// (JONSWAP, Hasselmann et al. 1973, fetch-limited; no further than a fully developed sea, Pierson-Moskowitz)
		const X = G * fetch / ( U * U );
		this.wp = Math.max( 22 * Math.pow( X, - 0.33 ), 0.855 ) * G / U;
		this.alpha = Math.max( 0.076 * Math.pow( X, - 0.22 ), 0.0081 );
		this.gamma = 3.3;
		this.swellHs = swell; this.swellW = 2 * Math.PI / swellPeriod;
		this.kd = 1e9;
		this.kd = this._calibrate();
		if ( U0 < 0.3 ) this.alpha *= ( U0 / 0.3 ) ** 2;

	}

	S( w ) {

		const { wp, alpha, gamma } = this, s = w <= wp ? 0.07 : 0.09;
		const r = Math.exp( - ( ( w - wp ) ** 2 ) / ( 2 * s * s * wp * wp ) );
		return alpha * G * G / w ** 5 * Math.exp( - 1.25 * ( wp / w ) ** 4 ) * gamma ** r;

	}

	/** The spreading's exponent s (cos^2s of half the angle: Hasselmann 1980). */
	spread( w ) {

		const r = w / this.wp;
		const s = Math.max( r < 1 ? 6.97 * r ** 4.06 : 9.77 * r ** ( - 2.33 - 1.45 * ( this.U * this.wp / G - 1.17 ) ), 0.15 );
		return this.spreadMax < s ? this.spreadMax : s;

	}

	D( w, theta ) {

		const s = this.spread( w );
		const n = Math.exp( 2 * s * Math.log( 2 ) - Math.log( Math.PI ) + 2 * lgamma( s + 1 ) - lgamma( 2 * s + 1 ) - Math.log( 2 ) );
		return n * Math.pow( Math.abs( Math.cos( theta / 2 ) ), 2 * s );

	}

	swellS( w ) {

		if ( ! ( this.swellHs > 0 ) ) return 0;
		const s = 0.06 * this.swellW;		// (a narrow Gaussian band; its variance Hs² / 16)
		return this.swellHs ** 2 / 16 * Math.exp( - ( ( w - this.swellW ) ** 2 ) / ( 2 * s * s ) ) / ( s * Math.sqrt( 2 * Math.PI ) );

	}

	swellD( theta ) { const s = 24; return Math.exp( 2 * s * Math.log( 2 ) - Math.log( Math.PI ) + 2 * lgamma( s + 1 ) - lgamma( 2 * s + 1 ) - Math.log( 2 ) ) * Math.pow( Math.abs( Math.cos( theta / 2 ) ), 2 * s ); }

	/** The damping of the short waves: exp( -( k / kd )² ). */
	damp( k ) { return Math.exp( - ( ( k / this.kd ) ** 2 ) ); }

	/**
	 * The directional wavenumber spectrum Ψ( k, θ ) (m⁴ / rad: its integral over kx, kz the height's variance) at
	 * kx, kz in world axes (θ the angle of k's direction).
	 */
	psi( kx, kz ) {

		const k = Math.hypot( kx, kz );
		if ( k < 1e-6 ) return 0;
		const w = omega( k ), J = dOmega( k ) / k, th = Math.atan2( kz, kx );
		let v = this.S( w ) * this.D( w, th - this.windDir ) * this.damp( k );
		v += this.swellS( w ) * this.swellD( th - this.swellDir );
		return v * J;

	}

	/** The wind sea's slope moments over k in [ k0, k1 ): [ along the wind, across it ] (m²/m²). */
	slopes( k0, k1, n = 400 ) {

		let a = 0, c = 0;
		const l0 = Math.log( Math.max( k0, 1e-4 ) ), l1 = Math.log( k1 );
		for ( let i = 0; i < n; ++ i ) {

			const k = Math.exp( l0 + ( l1 - l0 ) * ( i + 0.5 ) / n ), dk = k * ( l1 - l0 ) / n;
			const w = omega( k ), base = this.S( w ) * dOmega( k ) * this.damp( k ) * k * k * dk;		// (∫ k² F(k) dk: the slope's variance)
			// the spreading's cos² moment: ( 1 + E[ cos 2θ ] ) / 2, E[ cos 2θ ] = s ( s - 1 ) / ( ( s + 1 ) ( s + 2 ) ) for cos^2s( θ / 2 )
			const s = this.spread( w ), c2 = 0.5 * ( 1 + s * ( s - 1 ) / ( ( s + 1 ) * ( s + 2 ) ) );
			a += base * c2; c += base * ( 1 - c2 );

		}
		return [ a, c ];

	}

	/** kd: the damping that brings the total mean square slope to Cox & Munk's. */
	_calibrate() {

		const target = coxMunk( this.U )[ 0 ], kp = this.wp ** 2 / G;
		const mss = kd => { this.kd = kd; const [ a, c ] = this.slopes( kp * 0.2, kd * 6, 160 ); return a + c; };
		let lo = kp * 1.5, hi = 4000;
		if ( mss( hi ) < target ) return hi;		// (never short of it: the spectrum's own tail as it is)
		for ( let i = 0; i < 24; ++ i ) { const m = Math.sqrt( lo * hi ); if ( mss( m ) > target ) hi = m; else lo = m; }
		return Math.sqrt( lo * hi );

	}

}

// the cascades' bands: from the cascade's own fundamental up to where the next one's starts (its 4th harmonic:
// its waves at least 8 texels long in the coarser); the finest to its Nyquist's half (4 texels a wave)
export function bands() {

	return CASCADES.map( ( c, i ) => {

		const k0 = i === 0 ? 0 : 4 * 2 * Math.PI / CASCADES[ i ].L;
		const k1 = i + 1 < CASCADES.length ? 4 * 2 * Math.PI / CASCADES[ i + 1 ].L : N / 4 * 2 * Math.PI / c.L;
		return [ k0, k1 ];

	} );

}

function mulberry( seed ) {

	return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul( seed ^ seed >>> 15, 1 | seed ); t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t; return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296; };

}

/** The Gaussian draws of cascade `ci` (fixed: the same sea whatever its state; 2 per mode). */
const draws = {};
function gauss( ci, set = 0 ) {

	const key = `${ set }:${ ci }`;
	if ( draws[ key ] ) return draws[ key ];
	const r = mulberry( 0x5ea + 7919 * ci + 104729 * set ), g = new Float32Array( 2 * N * N );
	for ( let i = 0; i < N * N; ++ i ) {

		const u1 = Math.max( r(), 1e-12 ), u2 = r(), m = Math.sqrt( - 2 * Math.log( u1 ) );
		g[ 2 * i ] = m * Math.cos( 2 * Math.PI * u2 ); g[ 2 * i + 1 ] = m * Math.sin( 2 * Math.PI * u2 );

	}
	return ( draws[ key ] = g );

}

/**
 * Cascade `ci`'s initial spectrum h0( κ ) on its grid, κ in the cascade's own (turned) axes: RGBA per texel,
 * ( h0( κ ), conj h0( -κ ) ), and its quantised ω in a second array. Also the resolved slopes' variance (world
 * axes: xx, zz, xz) and the band's.
 */
export function initialSpectrum( state, ci, set = 0 ) {

	const { L, angle } = CASCADES[ ci ], [ k0, k1 ] = bands()[ ci ];
	const dk = 2 * Math.PI / L, c = Math.cos( angle ), s = Math.sin( angle );
	const amp = new Float32Array( N * N ), g = gauss( ci, set ), w = new Float32Array( N * N );
	let vxx = 0, vzz = 0, vxz = 0, vh = 0;
	const idx = i => ( i < N / 2 ? i : i - N );
	for ( let j = 0; j < N; ++ j ) for ( let i = 0; i < N; ++ i ) {

		const kx = idx( i ) * dk, kz = idx( j ) * dk, k = Math.hypot( kx, kz );
		const p = j * N + i;
		if ( k < k0 || k >= k1 || k === 0 || i === N / 2 || j === N / 2 ) continue;
		// (world axes: the cascade's x axis turned by its angle)
		const wx = c * kx - s * kz, wz = s * kx + c * kz;
		const v = state.psi( wx, wz ) * dk * dk;		// (this mode's share of the height's variance)
		amp[ p ] = Math.sqrt( v ) / 2;		// (a pair ±κ: 2 Re( H e^{iκx} ), H of two draws, each E|ξ|² = 2: 4 ( amp² + amp²(-κ) ) = v + v(-κ))
		w[ p ] = Math.round( omega( k ) / W0 ) * W0;
		vh += v; vxx += v * wx * wx; vzz += v * wz * wz; vxz += v * wx * wz;

	}
	const out = new Float32Array( 4 * N * N );
	for ( let j = 0; j < N; ++ j ) for ( let i = 0; i < N; ++ i ) {

		const p = j * N + i, q = ( ( N - j ) % N ) * N + ( N - i ) % N;		// (the mode at -κ)
		out[ 4 * p ] = amp[ p ] * g[ 2 * p ]; out[ 4 * p + 1 ] = amp[ p ] * g[ 2 * p + 1 ];
		out[ 4 * p + 2 ] = amp[ q ] * g[ 2 * q ]; out[ 4 * p + 3 ] = - amp[ q ] * g[ 2 * q + 1 ];		// (conj h0(-κ))

	}
	return { h0: out, w, variance: { h: vh, xx: vxx, zz: vzz, xz: vxz } };

}

/** What is finer than the finest cascade: the slopes' variance in world axes (xx, zz, xz). */
export function tailVariance( state ) {

	const k1 = bands()[ CASCADES.length - 1 ][ 1 ];
	const [ a, c ] = state.slopes( k1, Math.max( state.kd * 6, k1 * 1.01 ) );
	const cw = Math.cos( state.windDir ), sw = Math.sin( state.windDir );
	return { xx: a * cw * cw + c * sw * sw, zz: a * sw * sw + c * cw * cw, xz: ( a - c ) * cw * sw };

}

// ---- the GPU passes ----
const VERT = /* glsl */`
	in vec3 position;
	void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

// the spectrum at t: two complex fields, the slopes (i kx h + i i kz h = sx + i sz after the transform) and the height
const SPECTRUM = /* glsl */`
	precision highp float; precision highp sampler2D;
	uniform sampler2D uH0, uW;
	uniform float uL, uT;
	out vec4 o;
	vec2 cmul( vec2 a, vec2 b ) { return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy );
		vec4 h0 = texelFetch( uH0, p, 0 );
		float w = texelFetch( uW, p, 0 ).r;
		vec2 k = vec2( p.x < ${ N / 2 } ? p.x : p.x - ${ N }, p.y < ${ N / 2 } ? p.y : p.y - ${ N } ) * ( 6.28318530718 / uL );
		// (the phase: ω t mod 2π, ω a multiple of 2π / ${ REPEAT }: uT is t mod ${ REPEAT } s, taken in double)
		float ph = mod( w * uT, 6.28318530718 );
		vec2 e = vec2( cos( ph ), sin( ph ) );
		vec2 h = cmul( h0.xy, vec2( e.x, - e.y ) ) + cmul( h0.zw, e );		// h0(κ) e^{-iωt} + conj h0(-κ) e^{iωt}
		vec2 ih = vec2( - h.y, h.x );		// (i h)
		vec2 sxz = ih * k.x + vec2( - ih.y, ih.x ) * k.y;		// (i kx h + i (i kz h))
		o = vec4( sxz, h );
	}
`;

// one Stockham radix-2 pass of the inverse FFT along x or y (e^{+i}), on both fields at once
const BUTTERFLY = /* glsl */`
	precision highp float; precision highp sampler2D;
	uniform sampler2D uIn;
	uniform int uNs, uDir;
	out vec4 o;
	vec2 cmul( vec2 a, vec2 b ) { return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy );
		int i = uDir == 0 ? p.x : p.y;
		int Ns = uNs, hN = ${ N / 2 };
		int j = ( i / ( 2 * Ns ) ) * Ns + i % Ns;
		int r = ( i / Ns ) % 2;
		int k = i % Ns;
		float a = 3.14159265359 * float( k ) / float( Ns );		// (+2π k / 2Ns: the inverse transform)
		vec2 tw = vec2( cos( a ), sin( a ) );
		ivec2 q0 = uDir == 0 ? ivec2( j, p.y ) : ivec2( p.x, j ), q1 = uDir == 0 ? ivec2( j + hN, p.y ) : ivec2( p.x, j + hN );
		vec4 v0 = texelFetch( uIn, q0, 0 ), v1 = texelFetch( uIn, q1, 0 );
		vec4 t1 = vec4( cmul( v1.xy, tw ), cmul( v1.zw, tw ) );
		o = r == 0 ? v0 + t1 : v0 - t1;
	}
`;

// the moments, in world axes: (sx, sz, sx², sz²) and (h, sx sz)
const RESOLVE = /* glsl */`
	precision highp float; precision highp sampler2D;
	uniform sampler2D uIn;
	uniform vec2 uRot;		// (cos, sin of the cascade's angle)
	layout( location = 0 ) out vec4 oA;
	layout( location = 1 ) out vec4 oB;
	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy );
		vec4 v = texelFetch( uIn, p, 0 );
		vec2 s = v.xy, sw = vec2( uRot.x * s.x - uRot.y * s.y, uRot.y * s.x + uRot.x * s.y );
		oA = vec4( sw, sw * sw );
		oB = vec4( v.z, sw.x * sw.y, 0.0, 1.0 );
	}
`;

// the cat's paws' moments, one of the two a pass (a layer of an array: (sx, sz, sx², sz²) or (h, sx sz, 0, 1))
const RESOLVE_ONE = /* glsl */`
	precision highp float; precision highp sampler2D;
	uniform sampler2D uIn;
	uniform vec2 uRot;
	uniform int uPart;
	out vec4 o;
	void main() {
		vec4 v = texelFetch( uIn, ivec2( gl_FragCoord.xy ), 0 );
		vec2 s = v.xy, sw = vec2( uRot.x * s.x - uRot.y * s.y, uRot.y * s.x + uRot.x * s.y );
		o = uPart == 0 ? vec4( sw, sw * sw ) : vec4( v.z, sw.x * sw.y, 0.0, 1.0 );
	}
`;

// the path tracer's sea: per cascade (a layer) the slopes and the height at mip 0, in world axes: (sx, sz, h)
const RESOLVE_PT = /* glsl */`
	precision highp float; precision highp sampler2D;
	uniform sampler2D uIn;
	uniform vec2 uRot;
	out vec4 o;
	void main() {
		vec4 v = texelFetch( uIn, ivec2( gl_FragCoord.xy ), 0 );
		vec2 s = v.xy, sw = vec2( uRot.x * s.x - uRot.y * s.y, uRot.y * s.x + uRot.x * s.y );
		o = vec4( sw, v.z, 1.0 );
	}
`;

export class Ocean {

	constructor( params = {} ) {

		const ft = () => new THREE.WebGLRenderTarget( N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false } );
		this.ping = [ ft(), ft() ];
		this.moments = CASCADES.map( () => {

			const rt = new THREE.WebGLRenderTarget( N, N, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true } );
			for ( const t of rt.textures ) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; t.colorSpace = THREE.NoColorSpace; }
			return rt;

		} );
		this.h0 = CASCADES.map( () => Object.assign( new THREE.DataTexture( new Float32Array( 4 * N * N ), N, N, THREE.RGBAFormat, THREE.FloatType ), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } ) );
		this.w = CASCADES.map( () => Object.assign( new THREE.DataTexture( new Float32Array( N * N ), N, N, THREE.RedFormat, THREE.FloatType ), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } ) );
		const raw = ( fs, uniforms ) => new FullScreenQuad( new THREE.RawShaderMaterial( { glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false } ) );
		this.qSpec = raw( SPECTRUM, { uH0: { value: null }, uW: { value: null }, uL: { value: 1 }, uT: { value: 0 } } );
		this.qFFT = raw( BUTTERFLY, { uIn: { value: null }, uNs: { value: 1 }, uDir: { value: 0 } } );
		this.qRes = raw( RESOLVE, { uIn: { value: null }, uRot: { value: new THREE.Vector2( 1, 0 ) } } );
		this.qResPT = raw( RESOLVE_PT, { uIn: { value: null }, uRot: { value: new THREE.Vector2( 1, 0 ) } } );
		this.raw = raw;
		this.pawRT = null;		// (the cat's paws' resources: made when they first come on (_pawInit): none made, none of three's ids taken)
		// the path tracer's own copy (an array, a layer a cascade: one sampler there), drawn only when it asks
		// (updatePT: its time held while it accumulates, its own per sample with a shutter)
		// (its layers: the cascades, then the cat's paws' (PAW_LAYERS))
		this.pt = new THREE.WebGLArrayRenderTarget( N, N, CASCADES.length + PAW_LAYERS.length, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false } );
		Object.assign( this.pt.texture, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace } );
		this.tPT = null;
		// the shader's uniforms (shared: the materials that read the sea take this object's entries)
		this.uniforms = {
			uOcA: { value: this.moments.map( m => m.textures[ 0 ] ) }, uOcB: { value: this.moments.map( m => m.textures[ 1 ] ) },
			uOcRot: { value: CASCADES.map( c => new THREE.Vector4( Math.cos( c.angle ), Math.sin( c.angle ), 1 / c.L, 0 ) ) },
			uOcTail: { value: new THREE.Vector3() },		// (the slopes' variance finer than the cascades: xx, zz, xz)
			uSeaFacet: { value: 1e-4 },
			// the gusts (gustGLSL): ( gain, the wind's direction, on ), the octaves' offsets and scales
			uOcGust: { value: new THREE.Vector4( 0, 1, 0, 0 ) }, uOcGustO: { value: GUST_OCT.map( () => new THREE.Vector4( 0, 0, 0, 1 ) ) },		// (m²: one facet of the shortest ripples left, (2 / k_d)², for the glints' count)
			// the cat's paws (gustGLSL's <p>PawW): ( paws, the wind's direction, the threshold ), the octaves; their moments
			// (an array: layer PAW_LAYERS[ j ]'s A at 2j, B at 2j + 1), their tail's slope variance
			uOcPaw: { value: new THREE.Vector4( 0, 1, 0, 1 ) }, uOcPawO: { value: PAW_OCT.map( () => new THREE.Vector4( 0, 0, 0, 1 ) ) },
			uOcPawD: { value: new THREE.Vector4( 0, 1 / PAW_DIRSCALE, PAW_BIAS, 20 ) },
			uOcPawTex: { value: null }, uOcPawTail: { value: new THREE.Vector3() },
		};
		// the path tracer's (src/ptpatch.js): the array, the cascades' axes, the slab's half-thickness (m: ~4.5 σ of
		// the height), the GGX α of what is finer than the cascades (from the tail's slope variance)
		this.ptUniforms = {
			ptOcTex: { value: this.pt.texture }, ptOcRot: this.uniforms.uOcRot,
			ptOcSlab: { value: 0.05 }, ptOcAlpha: { value: 0.004 },
			ptOcGust: this.uniforms.uOcGust, ptOcGustO: this.uniforms.uOcGustO,
			ptOcPaw: this.uniforms.uOcPaw, ptOcPawO: this.uniforms.uOcPawO, ptOcPawD: this.uniforms.uOcPawD, ptOcPawAlpha: { value: 0 },
		};
		// (each cascade's share of the gusts: its rotation's 4th component)
		this.uniforms.uOcRot.value.forEach( ( v, i ) => { v.w = GUST_SHARE[ i ]; } );
		this.gust = { g: 0, scale: 50 };
		this.paws = { paws: 0, wind: 4, cover: 0.4, scale: 20, speed: null };
		this.t = null;
		this.set( params );

	}

	/** A new sea state (the wind, the swell: see SeaState); the same draws, so it changes smoothly with them. */
	set( params ) {

		const key = JSON.stringify( params );
		if ( key === this._key ) return;
		this._key = key;
		const state = this.state = new SeaState( params );
		this.stats = CASCADES.map( ( c, i ) => {

			const { h0, w, variance } = initialSpectrum( state, i );
			this.h0[ i ].image.data.set( h0 ); this.h0[ i ].needsUpdate = true;
			this.w[ i ].image.data.set( w ); this.w[ i ].needsUpdate = true;
			return variance;

		} );
		const tv = this.tail = tailVariance( state );
		this.uniforms.uOcTail.value.set( tv.xx, tv.zz, tv.xz );
		this.uniforms.uSeaFacet.value = Math.min( Math.max( ( 2 / state.kd ) ** 2, 1e-5 ), 1e-3 );
		this._slab();
		// (Beckmann's mss = α² for GGX's α to first order; floored: the cascades' finest texel is bilinear, not a facet)
		this.ptUniforms.ptOcAlpha.value = Math.max( Math.sqrt( Math.max( tv.xx + tv.zz, 0 ) ), 0.004 );
		this._pawKey = null; this._pawSpectrum();
		this.t = null; this.tPT = null;

	}

	/**
	 * The cat's paws: paws their strength (0: none, nothing drawn; 1: the patches' cores a full sea of `wind`), wind (m/s:
	 * the gusts' own, their sea's and their drift's), cover (the share of the sea in patches), scale (m: the largest
	 * octave's, across the wind), speed (m/s: their drift; the gusts' wind if null). The direction: the sea's wind's.
	 */
	setPaws( { paws = 0, wind = 4, cover = 0.4, scale = 20, speed = null } = {} ) {

		const P = { paws, wind, cover, scale, speed };
		if ( JSON.stringify( P ) === JSON.stringify( this.paws ) ) return;
		this.paws = P;
		this.uniforms.uOcPaw.value.x = paws;
		this.uniforms.uOcPaw.value.w = probit( 1 - Math.min( Math.max( cover, 0.01 ), 0.99 ) );
		this._pawSpectrum();
		this.t = null; this.tPT = null;

	}

	/** The cat's paws' resources (once). */
	_pawInit() {

		if ( this.pawRT ) return;
		this.qResOne = this.raw( RESOLVE_ONE, { uIn: { value: null }, uRot: { value: new THREE.Vector2( 1, 0 ) }, uPart: { value: 0 } } );
		// the cat's paws' sea: its own spectra (own draws) on PAW_LAYERS (cascades × directional bases), the raster's moments in an array (two layers a
		// cascade: A, B; mipmapped), drawn only while they are on
		this.pawH0 = PAW_LAYERS.map( () => Object.assign( new THREE.DataTexture( new Float32Array( 4 * N * N ), N, N, THREE.RGBAFormat, THREE.FloatType ), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } ) );
		this.pawW = PAW_LAYERS.map( () => Object.assign( new THREE.DataTexture( new Float32Array( N * N ), N, N, THREE.RedFormat, THREE.FloatType ), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter } ) );
		this.pawRT = new THREE.WebGLArrayRenderTarget( N, N, 2 * PAW_LAYERS.length, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true } );
		Object.assign( this.pawRT.texture, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: 16, colorSpace: THREE.NoColorSpace } );
		this.uniforms.uOcPawTex.value = this.pawRT.texture;

	}

	/** The cat's paws' sea (its spectra: only when they are on, and their wind or direction changed). */
	_pawSpectrum() {

		if ( ! ( this.paws.paws > 0 ) || ! this.state ) { this._slab(); return; }
		this._pawInit();
		// (the bases fixed in the world: only the gusts' wind rebuilds them, not the wind's direction)
		const key = JSON.stringify( [ this.paws.wind ] );
		if ( key !== this._pawKey ) {

			this._pawKey = key;
			const states = [ 0, 1, 2, 3 ].map( d => new SeaState( { wind: this.paws.wind, windDir: d * 2 * Math.PI / PAW_DIRS, fetch: PAW_FETCH, spreadMax: PAW_SPREAD_MAX } ) );
			this.pawStats = PAW_LAYERS.map( ( { ci, d }, j ) => {

				const { h0, w, variance } = initialSpectrum( states[ Math.max( d, 0 ) ], ci, 1 + j );
				this.pawH0[ j ].image.data.set( h0 ); this.pawH0[ j ].needsUpdate = true;
				this.pawW[ j ].image.data.set( w ); this.pawW[ j ].needsUpdate = true;
				return variance;

			} );
			// (what is finer than the cascades: ~nothing at this fetch (1e-21); isotropic)
			const tv = tailVariance( states[ 0 ] ), m = 0.5 * ( tv.xx + tv.zz );
			this.uniforms.uOcPawTail.value.set( m, m, 0 );
			this.ptUniforms.ptOcPawAlpha.value = Math.sqrt( Math.max( tv.xx + tv.zz, 0 ) );

		}
		this._slab();

	}

	/** The path tracer's slab: ~4.5 σ of the height, each cascade at its largest gust (L at 3 σ). */
	_slab() {

		if ( ! this.stats ) return;
		const Lmax = 3 * GUST_LSTD * this.gust.g;
		let vh = this.stats.reduce( ( a, v, i ) => a + v.h * Math.exp( 2 * GUST_SHARE[ i ] * Lmax ), 0 );
		// (the bases' weights' squares sum to 1: one basis' variance a cascade)
		if ( this.paws?.paws > 0 && this.pawStats ) vh += this.paws.paws ** 2 * this.pawStats.reduce( ( a, v, j ) => a + ( PAW_LAYERS[ j ].d <= 0 ? v.h : 0 ), 0 );
		this.ptUniforms.ptOcSlab.value = Math.max( 4.5 * Math.sqrt( vh ), 0.01 );

	}

	/**
	 * The gusts: g their strength (0: none; L's σ is GUST_LSTD g: at 0.25 the ripples' amplitude × e^±0.5), scale the largest
	 * octave's (m, across the wind).
	 */
	setGust( g = 0, scale = 50 ) {

		if ( g === this.gust.g && scale === this.gust.scale ) return;
		this.gust = { g, scale };
		this.uniforms.uOcGust.value.x = g * GUST_K / GUST_W / GUST_STD;
		const x = this.uniforms.uOcGust.value.x;
		this.uniforms.uOcGust.value.w = x * x * GUST_OCT.reduce( ( a, o ) => a + ( o.w * GUST_STD ) ** 2, 0 );
		this._slab();
		this.t = null; this.tPT = null;

	}

	/** The gusts' offsets at t (s): the octaves drifting downwind, re-drawn; wrapped by the lattice's period in double. */
	_gustAt( t ) {

		const st = this.state, U = st.U, wd = st.windDir, G = this.uniforms.uOcGust.value;
		G.y = Math.cos( wd ); G.z = Math.sin( wd );
		const P = GUST_PERIOD, m = v => ( ( v % P ) + P ) % P;
		GUST_OCT.forEach( ( o, i ) => {

			const inv = 1 / ( this.gust.scale * o.s ), O = this.uniforms.uOcGustO.value[ i ];
			// (fr · inv - O.xy: the pattern moves downwind by drift · U · t, along the stretched axis)
			O.set( m( o.drift * U * t / 1.6 * inv + 37.1 * i ), m( 91.7 * i ), m( o.rate * U * t * inv + 13.3 * i ), inv );

		} );

	}

	/** The cat's paws' offsets at t (s): as the gusts', drifting at their own speed. */
	_pawAt( t ) {

		const P = this.paws, U = P.speed ?? P.wind, wd = this.state.windDir, W = this.uniforms.uOcPaw.value;
		W.y = Math.cos( wd ); W.z = Math.sin( wd );
		const Pd = GUST_PERIOD, m = v => ( ( v % Pd ) + Pd ) % Pd;
		PAW_OCT.forEach( ( o, i ) => {

			const inv = 1 / ( P.scale * o.s ), O = this.uniforms.uOcPawO.value[ i ];
			// (along the wind U t; across it the turning drift's integral: U Σ b ( cos φ − cos( ω t + φ ) ) / ω)
			const across = o.turn.reduce( ( a, [ b, T, ph ] ) => { const w = 2 * Math.PI / T; return a + b * ( Math.cos( ph ) - Math.cos( w * t + ph ) ) / w; }, 0 );
			O.set( m( o.drift * U * t / 1.6 * inv + 53.7 * i + 11.0 ), m( o.drift * U * across * inv + 71.3 * i + 29.0 ), m( o.rate * U * t * inv + 17.9 * i + 5.0 ), inv );

		} );
		const D = this.uniforms.uOcPawD.value;
		D.x = m( t / PAW_DIRTIME ); D.w = P.scale;
		if ( PAW_ONE_WAY ) { D.y = 0; D.z = 1e4; } else { D.y = 1 / PAW_DIRSCALE; D.z = PAW_BIAS; }

	}

	/** Cascade ci's spectrum at tm (s, mod REPEAT) and its inverse FFT: the ping target that holds it. */
	_fft( renderer, ci, tm, h0 = this.h0[ ci ], w = this.w[ ci ] ) {

		const c = CASCADES[ ci ];
		let u = this.qSpec.material.uniforms;
		u.uH0.value = h0; u.uW.value = w; u.uL.value = c.L; u.uT.value = tm;
		renderer.setRenderTarget( this.ping[ 0 ] ); this.qSpec.render( renderer );
		let cur = 0;
		u = this.qFFT.material.uniforms;
		for ( const dir of [ 0, 1 ] ) for ( let ns = 1; ns < N; ns *= 2 ) {

			u.uIn.value = this.ping[ cur ].texture; u.uNs.value = ns; u.uDir.value = dir;
			renderer.setRenderTarget( this.ping[ 1 - cur ] ); this.qFFT.render( renderer );
			cur = 1 - cur;

		}
		return this.ping[ cur ];

	}

	/** The surface at time t (s, the render clock): the raster's moments. */
	update( renderer, t ) {

		if ( t === this.t ) return;
		this.t = t;
		this._gustAt( t );
		const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
		renderer.autoClear = false;
		const tm = ( ( t % REPEAT ) + REPEAT ) % REPEAT;
		CASCADES.forEach( ( c, ci ) => {

			const src = this._fft( renderer, ci, tm ), u = this.qRes.material.uniforms;
			u.uIn.value = src.texture; u.uRot.value.set( Math.cos( c.angle ), Math.sin( c.angle ) );
			renderer.setRenderTarget( this.moments[ ci ] ); this.qRes.render( renderer );		// (its mipmaps: three's, after the draw)

		} );
		if ( this.paws.paws > 0 ) {

			this._pawAt( t );
			const u = this.qResOne.material.uniforms;
			PAW_LAYERS.forEach( ( { ci }, j ) => {

				const c = CASCADES[ ci ], src = this._fft( renderer, ci, tm, this.pawH0[ j ], this.pawW[ j ] );
				u.uIn.value = src.texture; u.uRot.value.set( Math.cos( c.angle ), Math.sin( c.angle ) );
				for ( const part of [ 0, 1 ] ) {

					// (the array's mipmaps once, after its last layer: three makes them after each draw that asks)
					this.pawRT.texture.generateMipmaps = j === PAW_LAYERS.length - 1 && part === 1;
					u.uPart.value = part; renderer.setRenderTarget( this.pawRT, 2 * j + part ); this.qResOne.render( renderer );

				}

			} );

		}
		renderer.setRenderTarget( prev );
		renderer.autoClear = auto;

	}

	/** The path tracer's copy at time t (s): its slopes and height, mip 0. */
	updatePT( renderer, t ) {

		if ( t === this.tPT ) return;
		this.tPT = t;
		this._gustAt( t );
		const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
		renderer.autoClear = false;
		const tm = ( ( t % REPEAT ) + REPEAT ) % REPEAT;
		CASCADES.forEach( ( c, ci ) => {

			const src = this._fft( renderer, ci, tm ), u = this.qResPT.material.uniforms;
			u.uIn.value = src.texture; u.uRot.value.set( Math.cos( c.angle ), Math.sin( c.angle ) );
			renderer.setRenderTarget( this.pt, ci ); this.qResPT.render( renderer );		// (layer ci)

		} );
		if ( this.paws.paws > 0 ) {

			this._pawAt( t );
			const u = this.qResPT.material.uniforms;
			PAW_LAYERS.forEach( ( { ci }, j ) => {

				const c = CASCADES[ ci ], src = this._fft( renderer, ci, tm, this.pawH0[ j ], this.pawW[ j ] );
				u.uIn.value = src.texture; u.uRot.value.set( Math.cos( c.angle ), Math.sin( c.angle ) );
				renderer.setRenderTarget( this.pt, CASCADES.length + j ); this.qResPT.render( renderer );

			} );

		}
		renderer.setRenderTarget( prev );
		renderer.autoClear = auto;

	}

	dispose() {

		for ( const t of [ ...this.ping, ...this.moments, this.pt ] ) t.dispose();
		for ( const t of [ ...this.h0, ...this.w ] ) t.dispose();
		this.qSpec.dispose(); this.qFFT.dispose(); this.qRes.dispose(); this.qResPT.dispose();
		if ( this.pawRT ) { this.pawRT.dispose(); for ( const t of [ ...this.pawH0, ...this.pawW ] ) t.dispose(); this.qResOne.dispose(); }

	}

}

/**
 * GLSL: `void oceanMoments( vec2 xz, vec2 dx, vec2 dy, out vec2 mean, out vec3 cov )`: the slopes' mean and
 * covariance (xx, zz, xz) over a pixel's footprint on the sea (xz in metres, dx / dy its derivatives), all four
 * cascades and the tail. And `float oceanHeight( ... )`. The material needs this.uniforms.
 */
export const OCEAN_GLSL = /* glsl */`
	uniform sampler2D uOcA[ ${ CASCADES.length } ], uOcB[ ${ CASCADES.length } ];
	uniform vec4 uOcRot[ ${ CASCADES.length } ];
	uniform vec3 uOcTail;
	#ifdef OCEAN_PAWS
	uniform vec3 uOcPawTail;
	uniform sampler2DArray uOcPawTex;
	#endif
	${ gustGLSL( 'uOc', true ) }
	vec3 oceanCov0;		// (the covariance as without the gusts: the shading's own reference, src/azurea.js)
	void oceanMoments( vec2 xz, vec2 dx, vec2 dy, out vec2 mean, out vec3 cov, out float height ) {
		mean = vec2( 0.0 ); vec3 m2 = vec3( 0.0 ), m20 = vec3( 0.0 ); height = 0.0;
		// the gusts over the pixel's footprint: L's mean, its variance (the octaves finer than the pixel)
		float gs2, gL = uOcGustL( xz, max( length( dx ), length( dy ) ), gs2 );
		${ CASCADES.map( ( c, i ) => `{
			vec4 r = uOcRot[ ${ i } ];
			// (the cascade's own axes: the world turned back by its angle; its tile 1 / r.z m)
			mat2 Rt = mat2( r.x, - r.y, r.y, r.x );
			vec2 q = Rt * xz * r.z;
			vec2 qx = Rt * dx * r.z, qy = Rt * dy * r.z;
			vec4 a = textureGrad( uOcA[ ${ i } ], fract( q ), qx, qy );
			vec4 b = textureGrad( uOcB[ ${ i } ], fract( q ), qx, qy );
			// (the gust's factor a^k, log-normal over the footprint: its mean E1, its square's E2; each cascade's own mean
			// removed before the sum: independent bands, their covariances add)
			float k2 = r.w * r.w, E1 = exp( r.w * gL + k2 * ( 0.5 * gs2 - uOcGust.w ) ), E2 = exp( 2.0 * r.w * gL + 2.0 * k2 * ( gs2 - uOcGust.w ) );
			mean += E1 * a.xy;
			m2 += vec3( E2 * a.z - E1 * E1 * a.x * a.x, E2 * a.w - E1 * E1 * a.y * a.y, E2 * b.y - E1 * E1 * a.x * a.y );
			height += E1 * b.x;
			m20 += vec3( a.z - a.x * a.x, a.w - a.y * a.y, b.y - a.x * a.y );
		}` ).join( '\n' ) }
		cov = max( m2, vec3( 0.0, 0.0, - 1.0 ) ) + uOcTail * exp( 2.0 * gL + 2.0 * ( gs2 - uOcGust.w ) );
		oceanCov0 = max( m20, vec3( 0.0, 0.0, - 1.0 ) ) + uOcTail;
		// the cat's paws: their sea × w (E[ w ], E[ w² ] over the footprint), independent of the rest (covariances add).
		// (compiled in only while they are on: OCEAN_PAWS, the material's define; without it the shader as before)
		#ifdef OCEAN_PAWS
		{
			vec2 gn; float dk, w2, w1 = uOcPawW( xz, max( length( dx ), length( dy ) ), w2, gn, dk );
			if ( w2 > 0.0 ) {
				vec3 pm2 = vec3( 0.0 );
				// (each layer: × its basis' weight (1: the finest, one field); the weights' and w's spreads independent)
				vec4 wb = uOcPawBasis( xz, gn, dk ), wb2 = wb * wb;
				${ PAW_LAYERS.map( ( { ci, d }, j ) => `{
					vec4 r = uOcRot[ ${ ci } ];
					mat2 Rt = mat2( r.x, - r.y, r.y, r.x );
					vec2 q = Rt * xz * r.z, qx = Rt * dx * r.z, qy = Rt * dy * r.z;
					vec4 a = textureGrad( uOcPawTex, vec3( fract( q ), ${ 2 * j }.0 ), qx, qy );
					vec4 b = textureGrad( uOcPawTex, vec3( fract( q ), ${ 2 * j + 1 }.0 ), qx, qy );
					float m1 = w1${ d >= 0 ? ` * wb[ ${ d } ]` : '' }, m2 = w2${ d >= 0 ? ` * wb2[ ${ d } ]` : '' };
					mean += m1 * a.xy; height += m1 * b.x;
					pm2 += vec3( m2 * a.z - m1 * m1 * a.x * a.x, m2 * a.w - m1 * m1 * a.y * a.y, m2 * b.y - m1 * m1 * a.x * a.y );
				}` ).join( '\n' ) }
				cov += max( pm2, vec3( 0.0, 0.0, - 1.0 ) ) + w2 * uOcPawTail;
			}
		}
		#endif
	}
`;

/**
 * GLSL for the path tracer (src/ptpatch.js): `vec3 ptOceanSample( vec2 xz )`: the slopes (x, z) and the height
 * at a point of the sea (world xz, m), every cascade at mip 0 (a path is a point sample: the pixel's average is
 * the samples'); `ptOceanHeight( xz )`: the height alone (the three coarser cascades: the finest's is ~mm).
 */
export const OCEAN_PT_GLSL = /* glsl */`
	uniform sampler2DArray ptOcTex;
	uniform vec4 ptOcRot[ ${ CASCADES.length } ];
	uniform float ptOcSlab, ptOcAlpha, ptOcPawAlpha;
	${ gustGLSL( 'ptOc' ) }
	float ptOcGustA = 1.0;		// (the gust's factor at the last ptOceanSample: the unresolved roughness × it)
	float ptOcRough = 0.004;		// (the GGX α there: the tail's, × the gust's factor; with the cat's paws' tail × w)
	vec3 ptOceanSample( vec2 xz ) {
		vec3 r = vec3( 0.0 );
		float s2, L = ptOcGustL( xz, 0.0, s2 );
		for ( int i = 0; i < ${ CASCADES.length }; i ++ ) {
			vec4 c = ptOcRot[ i ];
			vec2 q = mat2( c.x, - c.y, c.y, c.x ) * xz * c.z;
			r += exp( c.w * L - c.w * c.w * ptOcGust.w ) * textureLod( ptOcTex, vec3( fract( q ), float( i ) ), 0.0 ).xyz;
		}
		ptOcGustA = exp( L - ptOcGust.w );
		ptOcRough = ptOcAlpha * ptOcGustA;
		if ( ptOcPaw.x > 0.0 ) {
			vec2 gn; float dk, w2, w = ptOcPawW( xz, 0.0, w2, gn, dk );
			if ( w > 0.0 ) {
				vec4 wb = ptOcPawBasis( xz, gn, dk );
				${ PAW_LAYERS.map( ( { ci, d }, j ) => `{
					vec4 c = ptOcRot[ ${ ci } ];
					vec2 q = mat2( c.x, - c.y, c.y, c.x ) * xz * c.z;
					r += w${ d >= 0 ? ` * wb[ ${ d } ]` : '' } * textureLod( ptOcTex, vec3( fract( q ), ${ CASCADES.length + j }.0 ), 0.0 ).xyz;
				}` ).join( '\n' ) }
				ptOcRough = sqrt( ptOcRough * ptOcRough + w2 * ptOcPawAlpha * ptOcPawAlpha );
			}
		}
		return r;
	}
	float ptOceanHeight( vec2 xz ) {
		float h = 0.0;
		float s2, L = ptOcGustL( xz, 0.0, s2 );
		for ( int i = 0; i < ${ CASCADES.length - 1 }; i ++ ) {
			vec4 c = ptOcRot[ i ];
			vec2 q = mat2( c.x, - c.y, c.y, c.x ) * xz * c.z;
			h += exp( c.w * L - c.w * c.w * ptOcGust.w ) * textureLod( ptOcTex, vec3( fract( q ), float( i ) ), 0.0 ).z;
		}
		if ( ptOcPaw.x > 0.0 ) {
			vec2 gn; float dk, w2, w = ptOcPawW( xz, 0.0, w2, gn, dk );
			if ( w > 0.0 ) {
				vec4 wb = ptOcPawBasis( xz, gn, dk );
				${ PAW_LAYERS.map( ( l, j ) => [ l, j ] ).filter( ( [ { ci } ] ) => ci < CASCADES.length - 1 ).map( ( [ { ci, d }, j ] ) => `{
					vec4 c = ptOcRot[ ${ ci } ];
					vec2 q = mat2( c.x, - c.y, c.y, c.x ) * xz * c.z;
					h += w${ d >= 0 ? ` * wb[ ${ d } ]` : '' } * textureLod( ptOcTex, vec3( fract( q ), ${ CASCADES.length + j }.0 ), 0.0 ).z;
				}` ).join( '\n' ) }
			}
		}
		return h;
	}
`;

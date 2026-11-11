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
// A pure function of the render clock (h0 from a fixed seed; the phases reduced modulo a 1200 s period on the CPU,
// in double): every worker of an offline render draws the same sea at the same t.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const G = 9.81, SIGMA = 0.074 / 1025;		// (m/s², the surface tension over the density: m³/s²)
export const N = 256;
export const CASCADES = [
	{ L: 257, angle: 0.0 }, { L: 37.3, angle: 0.61 }, { L: 5.5, angle: 1.37 }, { L: 0.79, angle: 2.29 },
];
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

	constructor( { wind = 2, windDir = 0, fetch = 40e3, swell = 0, swellDir = 0, swellPeriod = 9 } = {} ) {

		const U = this.U = Math.max( wind, 0.3 );
		this.windDir = windDir; this.swellDir = swellDir;
		// (JONSWAP, Hasselmann et al. 1973, fetch-limited; no further than a fully developed sea, Pierson-Moskowitz)
		const X = G * fetch / ( U * U );
		this.wp = Math.max( 22 * Math.pow( X, - 0.33 ), 0.855 ) * G / U;
		this.alpha = Math.max( 0.076 * Math.pow( X, - 0.22 ), 0.0081 );
		this.gamma = 3.3;
		this.swellHs = swell; this.swellW = 2 * Math.PI / swellPeriod;
		this.kd = 1e9;
		this.kd = this._calibrate();

	}

	S( w ) {

		const { wp, alpha, gamma } = this, s = w <= wp ? 0.07 : 0.09;
		const r = Math.exp( - ( ( w - wp ) ** 2 ) / ( 2 * s * s * wp * wp ) );
		return alpha * G * G / w ** 5 * Math.exp( - 1.25 * ( wp / w ) ** 4 ) * gamma ** r;

	}

	/** The spreading's exponent s (cos^2s of half the angle: Hasselmann 1980). */
	spread( w ) {

		const r = w / this.wp;
		return Math.max( r < 1 ? 6.97 * r ** 4.06 : 9.77 * r ** ( - 2.33 - 1.45 * ( this.U * this.wp / G - 1.17 ) ), 0.15 );

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
const draws = [];
function gauss( ci ) {

	if ( draws[ ci ] ) return draws[ ci ];
	const r = mulberry( 0x5ea + 7919 * ci ), g = new Float32Array( 2 * N * N );
	for ( let i = 0; i < N * N; ++ i ) {

		const u1 = Math.max( r(), 1e-12 ), u2 = r(), m = Math.sqrt( - 2 * Math.log( u1 ) );
		g[ 2 * i ] = m * Math.cos( 2 * Math.PI * u2 ); g[ 2 * i + 1 ] = m * Math.sin( 2 * Math.PI * u2 );

	}
	return ( draws[ ci ] = g );

}

/**
 * Cascade `ci`'s initial spectrum h0( κ ) on its grid, κ in the cascade's own (turned) axes: RGBA per texel,
 * ( h0( κ ), conj h0( -κ ) ), and its quantised ω in a second array. Also the resolved slopes' variance (world
 * axes: xx, zz, xz) and the band's.
 */
export function initialSpectrum( state, ci ) {

	const { L, angle } = CASCADES[ ci ], [ k0, k1 ] = bands()[ ci ];
	const dk = 2 * Math.PI / L, c = Math.cos( angle ), s = Math.sin( angle );
	const amp = new Float32Array( N * N ), g = gauss( ci ), w = new Float32Array( N * N );
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
		// the shader's uniforms (shared: the materials that read the sea take this object's entries)
		this.uniforms = {
			uOcA: { value: this.moments.map( m => m.textures[ 0 ] ) }, uOcB: { value: this.moments.map( m => m.textures[ 1 ] ) },
			uOcRot: { value: CASCADES.map( c => new THREE.Vector4( Math.cos( c.angle ), Math.sin( c.angle ), 1 / c.L, 0 ) ) },
			uOcTail: { value: new THREE.Vector3() },		// (the slopes' variance finer than the cascades: xx, zz, xz)
			uSeaFacet: { value: 1e-4 },		// (m²: one facet of the shortest ripples left, (2 / k_d)², for the glints' count)
		};
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
		this.t = null;

	}

	/** The surface at time t (s, the render clock). */
	update( renderer, t ) {

		if ( t === this.t ) return;
		this.t = t;
		const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
		renderer.autoClear = false;
		const tm = ( ( t % REPEAT ) + REPEAT ) % REPEAT;
		CASCADES.forEach( ( c, ci ) => {

			let u = this.qSpec.material.uniforms;
			u.uH0.value = this.h0[ ci ]; u.uW.value = this.w[ ci ]; u.uL.value = c.L; u.uT.value = tm;
			renderer.setRenderTarget( this.ping[ 0 ] ); this.qSpec.render( renderer );
			let cur = 0;
			u = this.qFFT.material.uniforms;
			for ( const dir of [ 0, 1 ] ) for ( let ns = 1; ns < N; ns *= 2 ) {

				u.uIn.value = this.ping[ cur ].texture; u.uNs.value = ns; u.uDir.value = dir;
				renderer.setRenderTarget( this.ping[ 1 - cur ] ); this.qFFT.render( renderer );
				cur = 1 - cur;

			}
			u = this.qRes.material.uniforms;
			u.uIn.value = this.ping[ cur ].texture; u.uRot.value.set( Math.cos( c.angle ), Math.sin( c.angle ) );
			renderer.setRenderTarget( this.moments[ ci ] ); this.qRes.render( renderer );		// (its mipmaps: three's, after the draw)

		} );
		renderer.setRenderTarget( prev );
		renderer.autoClear = auto;

	}

	dispose() {

		for ( const t of [ ...this.ping, ...this.moments ] ) t.dispose();
		for ( const t of [ ...this.h0, ...this.w ] ) t.dispose();
		this.qSpec.dispose(); this.qFFT.dispose(); this.qRes.dispose();

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
	void oceanMoments( vec2 xz, vec2 dx, vec2 dy, out vec2 mean, out vec3 cov, out float height ) {
		mean = vec2( 0.0 ); vec3 m2 = vec3( 0.0 ); height = 0.0;
		${ CASCADES.map( ( c, i ) => `{
			vec4 r = uOcRot[ ${ i } ];
			// (the cascade's own axes: the world turned back by its angle; its tile 1 / r.z m)
			mat2 Rt = mat2( r.x, - r.y, r.y, r.x );
			vec2 q = Rt * xz * r.z;
			vec2 qx = Rt * dx * r.z, qy = Rt * dy * r.z;
			vec4 a = textureGrad( uOcA[ ${ i } ], fract( q ), qx, qy );
			vec4 b = textureGrad( uOcB[ ${ i } ], fract( q ), qx, qy );
			// (each cascade's own mean removed before the sum: independent bands, their covariances add)
			mean += a.xy;
			m2 += vec3( a.z - a.x * a.x, a.w - a.y * a.y, b.y - a.x * a.y );
			height += b.x;
		}` ).join( '\n' ) }
		cov = max( m2, vec3( 0.0, 0.0, - 1.0 ) ) + uOcTail;
	}
`;

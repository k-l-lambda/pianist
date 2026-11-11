// Moving water for Azurea: the pool's surface simulated, the sea's waves summed.
//
//   PoolWater   a height field on the pool's own (polar) grid, stepped by a damped wave equation on the GPU:
//               reflecting walls (the near wall by the glass, the two ends), the far side an infinity edge
//               (a sponge: what reaches it spills and is gone). Driven by gusts of wind (patches of pressure
//               noise drifting with the wind: cat's paws), drops falling now and then, and the jets of the
//               inlets along the near wall (slow wave trains). Its output: a normal map in the pool's uv
//               (u along the arc, v across: polarUV), with a capillary detail on top (where the wind blows),
//               and its alpha a caustic factor for the floor (the curvature's focus).
//   seaWaves    a GLSL chunk: the sea as a sum of directional deep-water waves (the dispersion ω² = g k), a
//               slope at a point and time (filtered by the pixel's footprint): for the sea's photo, its
//               shimmer and the sun's or the moon's glitter.
//
// Determinism (offline frames rendered apart, on several GPUs, or from a seek): the state at step n (dt
// fixed: 1/60 s, n = floor( t / dt ), t the render clock) is a pure function of n. The forcing is a hash of
// the step and the place. Two simulations run: A, started from rest at the epoch before's start, and B from
// rest at this epoch's ( E steps each; the damping forgets what is older than an epoch, e^-γE ≈ 1 %). The
// output is A, faded to B over the epoch's last second; at the epoch's end B becomes A and a new B starts. A
// seek runs A and B from their starts (at most 2E + E steps): the same steps, in the same order, as a
// continuous run, so the same numbers.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const DT = 1 / 60, EPOCH = 480, FADE = 60;		// (steps: 8 s epochs; the fade over the last second)

const HASH = /* glsl */`
	uvec3 pcg3( uvec3 v ) {
		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
		v ^= v >> 16u;
		v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
		return v;
	}
	vec3 hash3( ivec3 p ) { return vec3( pcg3( uvec3( p + 32768 ) ) ) / 4294967295.0; }
	// value noise in 3d (smooth, lattice hashed): -0.5..0.5
	float vnoise( vec3 p ) {
		ivec3 i = ivec3( floor( p ) ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
		float n000 = hash3( i ).x, n100 = hash3( i + ivec3( 1, 0, 0 ) ).x, n010 = hash3( i + ivec3( 0, 1, 0 ) ).x, n110 = hash3( i + ivec3( 1, 1, 0 ) ).x;
		float n001 = hash3( i + ivec3( 0, 0, 1 ) ).x, n101 = hash3( i + ivec3( 1, 0, 1 ) ).x, n011 = hash3( i + ivec3( 0, 1, 1 ) ).x, n111 = hash3( i + ivec3( 1, 1, 1 ) ).x;
		return mix( mix( mix( n000, n100, f.x ), mix( n010, n110, f.x ), f.y ), mix( mix( n001, n101, f.x ), mix( n011, n111, f.x ), f.y ), f.z ) - 0.5;
	}
`;

// the pool's frame: cell ( i, j ) -> angle a (i along x) and radius r (j along y); its world xz
const FRAME = /* glsl */`
	uniform vec2 uCentre;		// the arc's centre (x, z)
	uniform vec4 uArc;			// a0, a1, r0, r1
	uniform ivec2 uSize;		// cells along, across
	vec2 cellAR( vec2 ij ) { return vec2( mix( uArc.x, uArc.y, ( ij.x + 0.5 ) / float( uSize.x ) ), mix( uArc.z, uArc.w, ( ij.y + 0.5 ) / float( uSize.y ) ) ); }
	vec2 worldXZ( vec2 ar ) { return uCentre + ar.y * vec2( cos( ar.x ), sin( ar.x ) ); }
	// the wind: its direction (xz) and speed (m/s); gusts: where it blows now (0..1), a pure function of place and time
	uniform vec3 uWind;
	float gust( vec2 xz, float t ) {
		vec2 w = uWind.xy * uWind.z;
		float g = vnoise( vec3( ( xz - w * t ) / 4.5, t * 0.07 ) ) + 0.5 * vnoise( vec3( ( xz - w * t * 1.2 ) / 1.7, t * 0.15 + 17.0 ) );
		return smoothstep( 0.02, 0.38, g );
	}
`;

const STEP = /* glsl */`
	precision highp float; precision highp int; precision highp sampler2D;
	${ HASH }
	${ FRAME }
	uniform sampler2D uState;		// ( h now, h before )
	uniform int uStep;				// the absolute step (the forcing's clock)
	uniform float uDt, uC, uDamp, uSponge;
	uniform vec4 uForce;			// wind, drops, jets (amplitudes), jets' frequency (Hz)
	out vec4 outState;
	float H( ivec2 c ) { return texelFetch( uState, clamp( c, ivec2( 0 ), uSize - 1 ), 0 ).x; }		// (clamped: a mirror ghost, the walls reflect)
	void main() {
		ivec2 c = ivec2( gl_FragCoord.xy );
		vec2 s = texelFetch( uState, c, 0 ).xy;
		vec2 ar = cellAR( vec2( c ) ), xz = worldXZ( ar );
		float da = ( uArc.y - uArc.x ) / float( uSize.x ), dr = ( uArc.w - uArc.z ) / float( uSize.y ), r = ar.y;
		float hE = H( c + ivec2( 1, 0 ) ), hW = H( c - ivec2( 1, 0 ) ), hN = H( c + ivec2( 0, 1 ) ), hS = H( c - ivec2( 0, 1 ) );
		// the Laplacian in polar coordinates: h_rr + h_r / r + h_aa / r²
		float lap = ( hN - 2.0 * s.x + hS ) / ( dr * dr ) + ( hN - hS ) / ( 2.0 * dr * r ) + ( hE - 2.0 * s.x + hW ) / ( da * da * r * r );
		float t = float( uStep ) * uDt;
		// the forcing (an acceleration, m/s²)
		float f = 0.0;
		// wind: pressure noise drifting with it, where the gusts are; re-drawn every 6 steps (blended)
		{
			vec2 w = uWind.xy * uWind.z;
			float layer = float( uStep ) / 6.0;
			float n = vnoise( vec3( ( xz - w * t ) / 0.18, layer ) ) + 0.6 * vnoise( vec3( ( xz - w * t ) / 0.09, layer * 1.3 + 41.0 ) );
			f += uForce.x * gust( xz, t ) * n;
		}
		// jets: five inlets along the near wall, each a slow oscillator
		for ( int k = 0; k < 5; ++ k ) {
			vec3 hk = hash3( ivec3( k, 7, 1 ) );
			float ak = mix( uArc.x, uArc.y, ( float( k ) + 0.5 + 0.3 * ( hk.x - 0.5 ) ) / 5.0 );
			vec2 p = worldXZ( vec2( ak, uArc.z + 0.12 ) );
			float d2 = dot( xz - p, xz - p );
			float env = 0.6 + 0.4 * sin( 6.2832 * ( t / ( 7.0 + 5.0 * hk.y ) + hk.z ) );
			f += uForce.z * env * exp( - d2 / ( 0.09 * 0.09 ) ) * sin( 6.2832 * uForce.w * ( 1.0 + 0.15 * hk.y ) * t + 6.2832 * hk.z );
		}
		// the step: damped (more in the sponge before the far edge)
		float g = uDamp + uSponge * smoothstep( uArc.w - 0.7, uArc.w, r );
		float h1 = s.x + ( s.x - s.y ) * ( 1.0 - g * uDt ) + uDt * uDt * ( uC * uC * lap - 0.6 * s.x + f );		// (a weak spring: the level held, its mean does not wander)
		// drops: in each slot of 20 steps, maybe one, at a hashed step and place (an impulse: a dent)
		{
			int slot = uStep / 20;
			vec3 hd = hash3( ivec3( slot, 3, 11 ) ), hp = hash3( ivec3( slot, 5, 13 ) );
			if ( hd.x < 0.45 && uStep == slot * 20 + int( hd.y * 20.0 ) ) {
				vec2 p = worldXZ( vec2( mix( uArc.x, uArc.y, hp.x ), mix( uArc.z + 0.2, uArc.w - 0.8, hp.y ) ) );
				float rad = 0.035 + 0.04 * hp.z;
				h1 -= uForce.y * ( 0.4 + hd.z ) * exp( - dot( xz - p, xz - p ) / ( rad * rad ) );
			}
		}
		outState = vec4( h1, s.x, 0.0, 1.0 );
	}
`;

const NORMAL = /* glsl */`
	precision highp float; precision highp int; precision highp sampler2D;
	${ HASH }
	${ FRAME }
	uniform sampler2D uA, uB;
	uniform float uMix, uGain, uDetail, uTime, uDepth;
	uniform ivec2 uOut;
	out vec4 outColor;
	float Hs( sampler2D s, ivec2 c ) { return texelFetch( s, clamp( c, ivec2( 0 ), uSize - 1 ), 0 ).x; }
	float Hc( ivec2 c ) { return mix( Hs( uA, c ), Hs( uB, c ), uMix ); }
	// the height at a fractional cell (bilinear, by hand: float textures need not filter)
	float Hf( vec2 p ) {
		vec2 q = p - 0.5; ivec2 i = ivec2( floor( q ) ); vec2 f = q - floor( q );
		return mix( mix( Hc( i ), Hc( i + ivec2( 1, 0 ) ), f.x ), mix( Hc( i + ivec2( 0, 1 ) ), Hc( i + ivec2( 1, 1 ) ), f.x ), f.y );
	}
	void main() {
		vec2 p = gl_FragCoord.xy / vec2( uOut ) * vec2( uSize );		// (in cells)
		vec2 ar = cellAR( p - 0.5 ), xz = worldXZ( ar );
		float da = ( uArc.y - uArc.x ) / float( uSize.x ), dr = ( uArc.w - uArc.z ) / float( uSize.y );
		float ds = da * ar.y;		// (a cell along, in metres here)
		float hE = Hf( p + vec2( 1, 0 ) ), hW = Hf( p - vec2( 1, 0 ) ), hN = Hf( p + vec2( 0, 1 ) ), hS = Hf( p - vec2( 0, 1 ) ), h0 = Hf( p );
		vec2 grad = vec2( ( hE - hW ) / ( 2.0 * ds ), ( hN - hS ) / ( 2.0 * dr ) );		// (along u, along v: the tangent frame's)
		float lap = ( hE - 2.0 * h0 + hW ) / ( ds * ds ) + ( hN - 2.0 * h0 + hS ) / ( dr * dr );
		// capillary detail where the wind blows (directional waves, ω² = g k + σ k³ / ρ; their slopes summed)
		vec2 tU = vec2( - sin( ar.x ), cos( ar.x ) ), tV = vec2( cos( ar.x ), sin( ar.x ) );		// (u, v in the world: along the arc, outwards)
		vec2 slope = vec2( 0.0 );
		float gu = gust( xz, uTime );
		for ( int k = 0; k < 10; ++ k ) {
			vec3 hk = hash3( ivec3( k, 2, 9 ) );
			float lambda = mix( 0.035, 0.16, hk.x * hk.x ), kk = 6.2832 / lambda;
			float om = sqrt( 9.81 * kk + 0.0000728 * kk * kk * kk );
			float ang = atan( uWind.y, uWind.x ) + ( hk.y - 0.5 ) * 1.6;
			vec2 dir = vec2( cos( ang ), sin( ang ) );
			float amp = 0.0006 * lambda / 0.1 * ( 0.5 + hk.z );
			slope += dir * ( amp * kk * cos( kk * dot( dir, xz ) - om * uTime + 6.2832 * hk.z ) );
		}
		slope *= uDetail * ( 0.15 + 0.85 * gu );
		grad += vec2( dot( slope, tU ), dot( slope, tV ) );
		// (the slope bounded softly, under 0.2: steeper facets turned away from a grazing view, which a path tracer
		// shades as from behind: dark patches)
		grad *= uGain / ( 1.0 + length( grad * uGain ) / 0.2 );
		vec3 n = normalize( vec3( - grad, 1.0 ) );
		// the floor's caustic: a converging surface focuses (curvature × depth)
		float caustic = clamp( 1.0 - uDepth * lap * 0.6, 0.2, 3.0 );
		outColor = vec4( n.xy * 0.5 + 0.5, n.z, caustic / 4.0 );
	}
`;

/** The pool's simulated surface (see the head of the file). `arc`: { cx, cz, a0, a1, r0, r1 } (the pool's polar extent, rad / m). */
export class PoolWater {

	constructor( arc, { along = 512, across = 112, outScale = 2, c = 0.8, damp = 0.55, sponge = 9, wind = [ - 0.35, - 0.94 ], windSpeed = 1.2, force = { wind: 2, drops: 0.03, jets: 8, jetHz: 1.3 }, gain = 1, detail = 1.2, depth = 1.2 } = {} ) {

		this.arc = arc;
		this.size = new THREE.Vector2( along, across );
		const rt = () => new THREE.WebGLRenderTarget( along, across, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false } );
		this.sims = [ { rt: [ rt(), rt() ], cur: 0, n: null, start: null }, { rt: [ rt(), rt() ], cur: 0, n: null, start: null } ];		// A, B
		this.out = new THREE.WebGLRenderTarget( along * outScale, across * outScale, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true } );
		this.texture = this.out.texture;		// (the normal map: u along the arc, v across; alpha the caustic / 4)
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
		this.texture.anisotropy = 8;
		const frame = {
			uCentre: { value: new THREE.Vector2( arc.cx, arc.cz ) }, uArc: { value: new THREE.Vector4( arc.a0, arc.a1, arc.r0, arc.r1 ) },
			uSize: { value: new THREE.Vector2( along, across ) }, uWind: { value: new THREE.Vector3( wind[ 0 ], wind[ 1 ], windSpeed ) },
		};
		this.stepQuad = new FullScreenQuad( new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: STEP,
			uniforms: { ...frame, uState: { value: null }, uStep: { value: 0 }, uDt: { value: DT }, uC: { value: c }, uDamp: { value: damp }, uSponge: { value: sponge },
				uForce: { value: new THREE.Vector4( force.wind, force.drops, force.jets, force.jetHz ) } },
		} ) );
		this.normalQuad = new FullScreenQuad( new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: NORMAL,
			uniforms: { ...frame, uA: { value: null }, uB: { value: null }, uMix: { value: 0 }, uGain: { value: gain }, uDetail: { value: detail }, uTime: { value: 0 }, uDepth: { value: depth },
				uOut: { value: new THREE.Vector2( along * outScale, across * outScale ) } },
		} ) );
		// (ivec uniforms: three sends a Vector2 to an ivec2 as ints)
		this.n = null;		// the step shown
		this.snapshotTexture = null;

	}

	/** Its uv on a geometry over the pool: u along the arc (a0 -> a1), v across (r0 -> r1); tangents along u (the path tracer's). */
	polarUV( geometry ) {

		const { cx, cz, a0, a1, r0, r1 } = this.arc, p = geometry.attributes.position, n = p.count;
		const uv = new Float32Array( 2 * n ), tan = new Float32Array( 4 * n );
		for ( let i = 0; i < n; ++ i ) {

			const dx = p.getX( i ) - cx, dz = p.getZ( i ) - cz, a = Math.atan2( dz, dx ), r = Math.hypot( dx, dz );
			uv[ 2 * i ] = ( a - a0 ) / ( a1 - a0 ); uv[ 2 * i + 1 ] = ( r - r0 ) / ( r1 - r0 );
			tan.set( [ - Math.sin( a ), 0, Math.cos( a ), 1 ], 4 * i );

		}
		geometry.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
		geometry.setAttribute( 'tangent', new THREE.BufferAttribute( tan, 4 ) );
		return geometry;

	}

	_reset( renderer, sim, start ) {

		const prev = renderer.getRenderTarget();
		for ( const t of sim.rt ) { renderer.setRenderTarget( t ); renderer.setClearColor( 0x000000, 0 ); renderer.clear( true, false, false ); }
		renderer.setRenderTarget( prev );
		sim.cur = 0; sim.n = start; sim.start = start;

	}

	/** One sim from its step n to n + 1 (the forcing of step n). */
	_step( renderer, sim ) {

		const m = this.stepQuad.material;
		m.uniforms.uState.value = sim.rt[ sim.cur ].texture;
		m.uniforms.uStep.value = sim.n;
		renderer.setRenderTarget( sim.rt[ 1 - sim.cur ] );
		this.stepQuad.render( renderer );
		sim.cur = 1 - sim.cur; sim.n ++;

	}

	/** The surface at time `t` (s, the render clock): the sims stepped (or re-run from their starts), the normal map drawn. */
	update( renderer, t ) {

		const n = Math.max( 0, Math.floor( t / DT + 1e-6 ) ), k = Math.floor( n / EPOCH );
		if ( n === this.n ) return false;
		const prev = renderer.getRenderTarget(), auto = renderer.autoClear, clear = renderer.getClearColor( new THREE.Color() ), clearA = renderer.getClearAlpha();
		renderer.autoClear = false;
		const [ A, B ] = this.sims, startA = ( k - 1 ) * EPOCH, startB = k * EPOCH;
		// the epoch moved on by one, continuously: B becomes A, a new B
		if ( A.start !== startA && B.start === startA && B.n !== null && B.n <= n ) { this.sims.reverse(); }
		const [ a, b ] = this.sims;
		const ok = ( s, start ) => s.start === start && s.n !== null && s.n <= n;
		if ( ! ok( a, startA ) ) this._reset( renderer, a, startA );
		if ( ! ok( b, startB ) ) this._reset( renderer, b, startB );
		while ( a.n < n ) this._step( renderer, a );
		while ( b.n < n ) this._step( renderer, b );
		// the output: A, faded to B over the epoch's last second
		const into = n - startB, w = THREE.MathUtils.smoothstep( into, EPOCH - FADE, EPOCH );
		const u = this.normalQuad.material.uniforms;
		u.uA.value = a.rt[ a.cur ].texture; u.uB.value = b.rt[ b.cur ].texture; u.uMix.value = w; u.uTime.value = n * DT;
		renderer.setRenderTarget( this.out );
		this.normalQuad.render( renderer );
		renderer.setRenderTarget( prev );
		renderer.autoClear = auto; renderer.setClearColor( clear, clearA );
		this.n = n;
		return true;

	}

	/** The normal map now as a DataTexture (the path tracer's: it copies its textures once, by version). */
	snapshot( renderer ) {

		const w = this.out.width, h = this.out.height;
		let s = this.snapshotTexture;
		if ( ! s ) {

			s = this.snapshotTexture = new THREE.DataTexture( new Uint8Array( 4 * w * h ), w, h );
			Object.assign( s, { colorSpace: THREE.NoColorSpace, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true } );

		}
		renderer.readRenderTargetPixels( this.out, 0, 0, w, h, s.image.data );
		s.needsUpdate = true;
		return s;

	}

	dispose() {

		for ( const s of this.sims ) for ( const t of s.rt ) t.dispose();
		this.out.dispose(); this.snapshotTexture?.dispose();
		this.stepQuad.dispose(); this.normalQuad.dispose();

	}

}

const VERT = /* glsl */`
	in vec3 position;
	void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

/**
 * The raster's pool water (an opaque surface: three has no cheap refraction) made to show its floor: per pixel the
 * view refracted through the rippled surface (n 1.33) down to the floor, the tiles there (their texture, planar in
 * world xz) lit by the caustic (the normal map's alpha at that point of the floor), dimmed by the water's
 * absorption over the path and veiled by its scattering colour; that is the surface's diffuse colour (lit as
 * before: the sun, the probe), its reflection on top (Fresnel). `opts`: { water: PoolWater, tiles: texture,
 * tileScale (1 / m), surfaceY, floorY, absorb: Color (per metre: 1 - attenuation), deep: Color (scattering),
 * caustics: strength }.
 */
export function patchPoolWater( material, { water, tiles, tileScale = 1 / 0.96, surfaceY, floorY, absorb = new THREE.Color( 1.3, 0.22, 0.13 ), deep = new THREE.Color( '#0b6f8a' ), caustics = 0.45 } ) {

	const { cx, cz, a0, a1, r0, r1 } = water.arc;
	const uniforms = {
		uPoolTiles: { value: tiles }, uPoolTileScale: { value: tileScale }, uPoolNormal: { value: water.texture },
		uPoolY: { value: new THREE.Vector2( surfaceY, floorY ) }, uPoolAbsorb: { value: absorb }, uPoolDeep: { value: deep },
		uPoolCaustics: { value: caustics }, uPoolArc: { value: new THREE.Vector4( a0, a1, r0, r1 ) }, uPoolCentre: { value: new THREE.Vector2( cx, cz ) },
	};
	material.userData.pool = uniforms;
	material.onBeforeCompile = sh => {

		Object.assign( sh.uniforms, uniforms );
		sh.vertexShader = sh.vertexShader.replace( '#include <common>', '#include <common>\nvarying vec3 vPoolW;' )
			.replace( '#include <project_vertex>', '#include <project_vertex>\nvPoolW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
		sh.fragmentShader = sh.fragmentShader.replace( '#include <common>', `#include <common>
			varying vec3 vPoolW;
			uniform sampler2D uPoolTiles, uPoolNormal;
			uniform float uPoolTileScale, uPoolCaustics;
			uniform vec2 uPoolY, uPoolCentre;
			uniform vec3 uPoolAbsorb, uPoolDeep;
			uniform vec4 uPoolArc;
			vec2 poolUV( vec2 xz ) { vec2 d = xz - uPoolCentre; return vec2( ( atan( d.y, d.x ) - uPoolArc.x ) / ( uPoolArc.y - uPoolArc.x ), ( length( d ) - uPoolArc.z ) / ( uPoolArc.w - uPoolArc.z ) ); }` )
			.replace( '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
			{
				// what the refracted view meets in the basin: the floor, the two radial walls (the near one by the
				// glass, the far one at the infinity edge) or one of its ends — the nearest, each with the mosaic
				// laid on its own surface (the floor in plan; a wall by arc length across, height up; an end by
				// radius across, height up)
				vec3 nW = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );		// (view -> world: the transpose)
				vec3 v = normalize( vPoolW - cameraPosition );
				vec3 rr = refract( v, nW, 1.0 / 1.33 );
				float depth = uPoolY.x - uPoolY.y, floorY = uPoolY.y;
				float t = 1e9, tWall = 1e9; int face = 0;		// (0 floor, 1 radial wall, 2 end)
				vec2 wallUV = vec2( 0.0 );
				if ( rr.y < - 1e-5 ) t = ( floorY - vPoolW.y ) / rr.y;
				{

					// the radial walls: | ( vPoolW.xz - centre ) + t * rr.xz | = r
					vec2 rel = vPoolW.xz - uPoolCentre;
					float qa = dot( rr.xz, rr.xz ), qb = dot( rel, rr.xz ), qc0 = dot( rel, rel );
					for ( int k = 0; k < 2; ++ k ) {

						float r = k == 0 ? uPoolArc.z : uPoolArc.w, qc = qc0 - r * r;
						float disc = qb * qb - qa * qc;
						if ( qa < 1e-8 || disc < 0.0 ) continue;
						float sq = sqrt( disc ), tk = ( - qb - sq ) / qa;
						if ( tk < 1e-4 ) tk = ( - qb + sq ) / qa;
						if ( tk < 1e-4 || tk >= tWall ) continue;
						vec3 h = vPoolW + rr * tk;
						if ( h.y > uPoolY.x || h.y < floorY ) continue;
						vec2 d = h.xz - uPoolCentre;
						float ang = atan( d.y, d.x );
						if ( ang < uPoolArc.x || ang > uPoolArc.y ) continue;		// (beyond an end: that face)
						tWall = tk; face = 1;
						wallUV = vec2( ( ang - uPoolArc.x ) * r, h.y ) * uPoolTileScale;

					}
					// the ends: a vertical plane through the centre at a0 or a1
					for ( int k = 0; k < 2; ++ k ) {

						float ang = k == 0 ? uPoolArc.x : uPoolArc.y;
						vec2 nn = vec2( - sin( ang ), cos( ang ) );
						float dn = dot( rr.xz, nn );		// (its own line: a vec2 declaration would make dn a vec2 too)
						if ( abs( dn ) < 1e-6 ) continue;
						float tk = - dot( rel, nn ) / dn;
						if ( tk < 1e-4 || tk >= min( t, tWall ) ) continue;
						vec3 h = vPoolW + rr * tk;
						if ( h.y > uPoolY.x || h.y < floorY ) continue;
						float rad = length( h.xz - uPoolCentre );
						if ( rad < uPoolArc.z || rad > uPoolArc.w ) continue;
						tWall = tk; face = 2;
						wallUV = vec2( rad, h.y ) * uPoolTileScale;

					}

				}
				vec3 hit = vPoolW + rr * t;
				// a wall or end nearer than the floor: the refracted view meets it instead
				bool wall = face > 0 && tWall < t;
				float tt = wall ? tWall : t;
				vec3 surfCol;
				if ( wall ) surfCol = texture2D( uPoolTiles, wallUV ).rgb;
				else {

					surfCol = texture2D( uPoolTiles, hit.xz * uPoolTileScale ).rgb;
					float c = texture2D( uPoolNormal, poolUV( hit.xz ) ).a * 4.0;
					surfCol *= mix( 1.0, c, uPoolCaustics );

				}
				vec3 T = exp( - uPoolAbsorb * ( tt + depth ) );		// (down to it and the light's way down)
				diffuseColor.rgb = surfCol * T + uPoolDeep * ( 1.0 - T );
			}` );

	};
	material.customProgramCacheKey = () => 'poolWater';
	material.needsUpdate = true;
	return material;

}

// A spatial denoiser for the path tracer's image, after SVGF's variance-guided filtering (Schied et al.
// 2017), without its temporal part: a frame here has hundreds of samples, enough for a variance of its own.
//
// The path tracer's buffers (ptpatch.js patchAOV, PT_AOV): colour, albedo, normal, direct, stats, averaged
// over the frame's samples. The illumination, (colour − direct) / albedo, is what is noisy and smooth enough
// to filter (light on a surface, its texture divided out); albedo (texture detail), direct (lights, the sky,
// what is seen in glass and mirrors, emission) are kept as they are. Its variance of the mean: (E[l²] −
// E[l]²) / samples, from the stats.
//
// The filter: à-trous wavelet passes (a 5×5 B3 spline kernel, steps 1, 2, 4, 8, 16), each tap weighted by its
// normal (cos^σn), depth (relative difference over the step), and illumination (its difference over σl times
// the variance's √, prefiltered 3×3): edges and converged areas stay sharp. The variance filtered along
// (weights²). Then colour = illumination × albedo + direct.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = 'out vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
const glsl3 = ( fragmentShader, uniforms ) => new THREE.ShaderMaterial( { glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false } );

// the illumination and its variance of the mean
const DEMOD = `precision highp float;
	uniform sampler2D tColor, tAlbedo, tDirect, tStats; uniform float uSamples; in vec2 vUv; out vec4 o;
	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy );
		vec3 c = texelFetch( tColor, p, 0 ).rgb, a = texelFetch( tAlbedo, p, 0 ).rgb, d = texelFetch( tDirect, p, 0 ).rgb;
		vec4 s = texelFetch( tStats, p, 0 );
		vec3 il = any( greaterThan( a, vec3( 0.0 ) ) ) ? max( c - d, vec3( 0.0 ) ) / max( a, vec3( 1e-3 ) ) : vec3( 0.0 );
		float v = max( s.y - s.x * s.x, 0.0 ) / max( uSamples, 1.0 );
		o = vec4( il, v );
	}`;

// one à-trous pass
const ATROUS = `precision highp float;
	uniform sampler2D tIllum, tNormal, tStats; uniform int uStep; uniform float uSigmaL, uSigmaN, uSigmaZ; in vec2 vUv;
	layout( location = 0 ) out vec4 o;
	const float K[ 3 ] = float[ 3 ]( 0.375, 0.25, 0.0625 );
	float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy ), size = textureSize( tIllum, 0 );
		vec4 c0 = texelFetch( tIllum, p, 0 );
		vec3 n0 = texelFetch( tNormal, p, 0 ).rgb * 2.0 - 1.0;
		float nl = length( n0 ); n0 = nl > 1e-4 ? n0 / nl : vec3( 0.0 );
		float z0 = texelFetch( tStats, p, 0 ).z;
		if ( z0 <= 0.0 ) { o = c0; return; }		// (no surface: the direct light only)
		// the variance prefiltered (3×3 gaussian): a steadier guide
		float vs = 0.0, ws = 0.0;
		for ( int y = -1; y <= 1; ++ y ) for ( int x = -1; x <= 1; ++ x ) {
			float w = ( x == 0 ? 0.5 : 0.25 ) * ( y == 0 ? 0.5 : 0.25 );
			vs += w * texelFetch( tIllum, clamp( p + ivec2( x, y ), ivec2( 0 ), size - 1 ), 0 ).a; ws += w;
		}
		float sl = uSigmaL * sqrt( max( vs / ws, 0.0 ) ) + 1e-6;
		float l0 = lum( c0.rgb );
		// the depth's local slope (for a relative depth weight across slanted surfaces)
		float zx = texelFetch( tStats, clamp( p + ivec2( 1, 0 ), ivec2( 0 ), size - 1 ), 0 ).z - z0;
		float zy = texelFetch( tStats, clamp( p + ivec2( 0, 1 ), ivec2( 0 ), size - 1 ), 0 ).z - z0;
		float dz = max( abs( zx ), abs( zy ) ) + 1e-4;
		vec3 sum = vec3( 0.0 ); float var = 0.0, wsum = 0.0;
		for ( int y = -2; y <= 2; ++ y ) for ( int x = -2; x <= 2; ++ x ) {
			ivec2 q = p + ivec2( x, y ) * uStep;
			if ( any( lessThan( q, ivec2( 0 ) ) ) || any( greaterThanEqual( q, size ) ) ) continue;
			vec4 c = texelFetch( tIllum, q, 0 );
			float z = texelFetch( tStats, q, 0 ).z;
			if ( z <= 0.0 ) continue;
			vec3 n = texelFetch( tNormal, q, 0 ).rgb * 2.0 - 1.0; float ln = length( n ); n = ln > 1e-4 ? n / ln : vec3( 0.0 );
			float wn = pow( max( dot( n0, n ), 0.0 ), uSigmaN );
			float wz = exp( - abs( z - z0 ) / ( uSigmaZ * dz * length( vec2( x, y ) * float( uStep ) ) + 1e-4 ) );
			float wl = exp( - abs( lum( c.rgb ) - l0 ) / sl );
			float w = K[ abs( x ) ] * K[ abs( y ) ] * wn * wz * wl;
			sum += w * c.rgb; var += w * w * c.a; wsum += w;
		}
		o = wsum > 0.0 ? vec4( sum / wsum, var / ( wsum * wsum ) ) : c0;
	}`;

// colour = illumination × albedo + direct
const COMBINE = `precision highp float;
	uniform sampler2D tIllum, tAlbedo, tDirect, tColor, tStats; uniform int uShow; in vec2 vUv; out vec4 o;
	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy );
		vec3 il = texelFetch( tIllum, p, 0 ).rgb, a = texelFetch( tAlbedo, p, 0 ).rgb, d = texelFetch( tDirect, p, 0 ).rgb;
		float z = texelFetch( tStats, p, 0 ).z;
		vec3 c = z > 0.0 ? il * a + d : texelFetch( tColor, p, 0 ).rgb;
		if ( uShow == 1 ) c = a; else if ( uShow == 2 ) c = d; else if ( uShow == 3 ) c = il; else if ( uShow == 4 ) c = vec3( sqrt( texelFetch( tIllum, p, 0 ).a ) );
		o = vec4( c, 1.0 );
	}`;

export class PTDenoiser {

	constructor( { iterations = 5, sigmaL = 4, sigmaN = 64, sigmaZ = 1 } = {} ) {

		Object.assign( this, { iterations, sigmaL, sigmaN, sigmaZ, show: 0 } );
		const t = () => new THREE.WebGLRenderTarget( 1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false } );
		this.ping = t(); this.pong = t();
		this.out = new THREE.WebGLRenderTarget( 1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false } );
		this.demod = new FullScreenQuad( glsl3( DEMOD, { tColor: { value: null }, tAlbedo: { value: null }, tDirect: { value: null }, tStats: { value: null }, uSamples: { value: 1 } } ) );
		this.atrous = new FullScreenQuad( glsl3( ATROUS, { tIllum: { value: null }, tNormal: { value: null }, tStats: { value: null }, uStep: { value: 1 }, uSigmaL: { value: sigmaL }, uSigmaN: { value: sigmaN }, uSigmaZ: { value: sigmaZ } } ) );
		this.combine = new FullScreenQuad( glsl3( COMBINE, { tIllum: { value: null }, tAlbedo: { value: null }, tDirect: { value: null }, tColor: { value: null }, tStats: { value: null }, uShow: { value: 0 } } ) );

	}

	/**
	 * `textures`: the path tracer's [ colour, albedo, normal, direct, stats ] (ptpatch.js pt.aovTextures()),
	 * `samples`: its count. Returns the denoised linear HDR image (this.out, half float).
	 */
	render( renderer, textures, samples ) {

		const [ color, albedo, normal, direct, stats ] = textures, w = color.image.width, h = color.image.height;
		for ( const r of [ this.ping, this.pong, this.out ] ) if ( r.width !== w || r.height !== h ) r.setSize( w, h );
		const was = { target: renderer.getRenderTarget(), auto: renderer.autoClear, tone: renderer.toneMapping };
		renderer.autoClear = false;
		renderer.toneMapping = THREE.NoToneMapping;
		Object.assign( this.demod.material.uniforms, { tColor: { value: color }, tAlbedo: { value: albedo }, tDirect: { value: direct }, tStats: { value: stats }, uSamples: { value: samples } } );
		renderer.setRenderTarget( this.ping ); this.demod.render( renderer );
		let src = this.ping, dst = this.pong;
		const U = this.atrous.material.uniforms;
		Object.assign( U, { tNormal: { value: normal }, tStats: { value: stats } } );
		U.uSigmaL.value = this.sigmaL; U.uSigmaN.value = this.sigmaN; U.uSigmaZ.value = this.sigmaZ;
		for ( let i = 0; i < this.iterations; ++ i ) {

			U.tIllum.value = src.texture; U.uStep.value = 1 << i;
			renderer.setRenderTarget( dst ); this.atrous.render( renderer );
			[ src, dst ] = [ dst, src ];

		}
		Object.assign( this.combine.material.uniforms, { tIllum: { value: src.texture }, tAlbedo: { value: albedo }, tDirect: { value: direct }, tColor: { value: color }, tStats: { value: stats }, uShow: { value: this.show } } );
		renderer.setRenderTarget( this.out ); this.combine.render( renderer );
		renderer.setRenderTarget( was.target );
		renderer.autoClear = was.auto;
		renderer.toneMapping = was.tone;
		return this.out;

	}

	dispose() {

		for ( const r of [ this.ping, this.pong, this.out ] ) r.dispose();
		for ( const q of [ this.demod, this.atrous, this.combine ] ) { q.material.dispose(); q.dispose(); }

	}

}

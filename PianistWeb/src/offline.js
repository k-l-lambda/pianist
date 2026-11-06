// An offline render's frame (rendermode.js, tools/render-video.mjs), from the scene's linear light to
// the encoder's pixels, without the 8-bit canvas in between:
//
//   accumulate   each sub-frame's linear HDR result (the composer's buffer before its tone mapping,
//                or the path tracer's mean) added into a float target, weighted 1 / sub-frames: the
//                shutter's motion blur and the camera's sub-pixel jitter (main.js) average here
//   resolve      the supersampled buffer down to the output size in linear light, with a
//                Blackman-Harris window (non-negative: no dark rings round the sun's glare); the
//                canvas's drawImage did this after the tone mapping, in 8-bit sRGB, where a thin bright
//                line or highlight averages darker and thinner than the light it is
//   tone map     three's OutputPass (the renderer's tone mapping, exposure, sRGB), as on the page
//   finish       the watermark (blended in sRGB, as the 2D canvas did), then quantised with
//                triangular dither to 8 or 10 bits: smooth gradients (walls, the dome, the sky, the
//                bloom) without bands; read back top row first as rgb24 or rgb48le for ffmpeg

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

export class OfflineFrame {

	/** `filter`: the resolve's window radius, in output pixels. */
	constructor( renderer, { filter = 1.25 } = {} ) {

		this.renderer = renderer;
		const gl = renderer.getContext();
		if ( ! gl.getExtension( 'EXT_float_blend' ) ) throw new Error( 'offline render: EXT_float_blend is needed (sub-frames added in a float target)' );
		const rt = type => new THREE.WebGLRenderTarget( 1, 1, { type, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false } );
		this.accum = rt( THREE.FloatType );		// (source size: the sub-frames' sum)
		this.linear = rt( THREE.FloatType );		// (output size: resolved, linear)
		this.toned = rt( THREE.FloatType );		// (output size: tone mapped, sRGB-encoded, not yet quantised)
		this.out8 = rt( THREE.UnsignedByteType );		// (quantised to 8 bits)
		this.out16 = rt( THREE.FloatType );		// (quantised to 10 bits, as 16-bit integers)
		this.count = 0;

		this.add = new FullScreenQuad( new THREE.ShaderMaterial( {
			uniforms: { src: { value: null }, weight: { value: 1 } },
			vertexShader: VERT,
			fragmentShader: 'uniform sampler2D src; uniform float weight; varying vec2 vUv; void main() { gl_FragColor = vec4( texture2D( src, vUv ).rgb * weight, weight ); }',
			blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
			blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthTest: false, depthWrite: false,
		} ) );
		// the resolve: each output pixel the window-weighted mean of the source texels within `radius` of
		// its centre (in source texels: radius × the scale); the window's weights summed, so its own shape
		// and the edges' cut-off do not change the brightness
		this.resolveQuad = new FullScreenQuad( new THREE.ShaderMaterial( {
			uniforms: { src: { value: null }, srcSize: { value: new THREE.Vector2() }, outSize: { value: new THREE.Vector2() }, radius: { value: filter } },
			vertexShader: VERT,
			fragmentShader: /* glsl */`
				uniform sampler2D src; uniform vec2 srcSize, outSize; uniform float radius; varying vec2 vUv;
				float bh( float x ) {		// Blackman-Harris, x in [ -1, 1 ]
					float t = 3.14159265 * ( x + 1.0 );
					return 0.35875 - 0.48829 * cos( t ) + 0.14128 * cos( 2.0 * t ) - 0.01168 * cos( 3.0 * t );
				}
				void main() {
					vec2 k = srcSize / outSize, c = vUv * srcSize;		// (the output pixel's centre, in source texels)
					vec2 r = radius * max( k, vec2( 1.0 ) );
					ivec2 lo = ivec2( floor( c - r ) ), hi = ivec2( ceil( c + r ) );
					vec3 sum = vec3( 0.0 ); float wsum = 0.0, alpha = 0.0;
					for ( int y = lo.y; y <= hi.y; ++ y ) {
						float dy = ( float( y ) + 0.5 - c.y ) / r.y;
						if ( abs( dy ) >= 1.0 ) continue;
						float wy = bh( dy );
						for ( int x = lo.x; x <= hi.x; ++ x ) {
							float dx = ( float( x ) + 0.5 - c.x ) / r.x;
							if ( abs( dx ) >= 1.0 ) continue;
							float w = bh( dx ) * wy;
							vec4 s = texelFetch( src, clamp( ivec2( x, y ), ivec2( 0 ), ivec2( srcSize ) - 1 ), 0 );
							sum += w * s.rgb; alpha += w * s.a; wsum += w;
						}
					}
					// (the sum's alpha: the weights added, 1 when all sub-frames came; divided out in case not)
					gl_FragColor = vec4( sum / max( alpha, 1e-6 ), 1.0 );
				}`,
		} ) );
		this.output = new OutputPass();
		// the watermark (src/main.js WATERMARK: its rect, px from the top-left), then the quantisation; the
		// rows flipped (the encoder's first row is the top)
		this.finishQuad = new FullScreenQuad( new THREE.ShaderMaterial( {
			uniforms: { src: { value: null }, mark: { value: null }, markRect: { value: new THREE.Vector4() }, markOpacity: { value: 0 }, outSize: { value: new THREE.Vector2() }, levels: { value: 255 }, dither: { value: 1 }, seed: { value: 0 } },
			vertexShader: VERT,
			fragmentShader: /* glsl */`
				uniform sampler2D src, mark; uniform vec4 markRect; uniform float markOpacity, levels, dither, seed; uniform vec2 outSize; varying vec2 vUv;
				float hash( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
				void main() {
					// (the target's first row read is the image's top: the source sampled flipped; px from the top-left, as the canvas)
					vec2 uv = vec2( vUv.x, 1.0 - vUv.y ), px = vUv * outSize;
					vec3 c = texture2D( src, uv ).rgb;
					if ( markOpacity > 0.0 && px.x >= markRect.x && px.y >= markRect.y && px.x < markRect.x + markRect.z && px.y < markRect.y + markRect.w ) {
						vec4 m = texture2D( mark, ( px - markRect.xy ) / markRect.zw );
						c = mix( c, m.rgb, m.a * markOpacity );		// (source-over in sRGB values, as the 2D canvas)
					}
					// triangular dither, ±1 step, a new pattern each frame (no fixed grain): the gradients' steps
					// become noise finer than the eye's threshold, and the encoder's rounding keeps them so
					vec3 n = vec3( 0.0 );
					if ( dither > 0.0 ) for ( int i = 0; i < 3; ++ i ) n[ i ] = hash( vec3( px, seed + float( i ) * 7.13 ) ) - hash( vec3( px.yx + 17.0, seed + float( i ) * 3.71 + 1.0 ) );
					vec3 q = floor( clamp( c, 0.0, 1.0 ) * levels + 0.5 + n * dither );
					gl_FragColor = vec4( clamp( q, 0.0, levels ) / ( levels == 255.0 ? 255.0 : 1.0 ), 1.0 );
				}`,
		} ) );

	}

	/** Start a new frame of `n` sub-frames at the source's size. */
	begin( w, h, n ) {

		if ( this.accum.width !== w || this.accum.height !== h ) this.accum.setSize( w, h );
		this.weight = 1 / n;
		this.count = 0;

	}

	/** Add a sub-frame: `texture`, linear HDR, at the source's size. */
	accumulate( texture ) {

		const r = this.renderer, was = { target: r.getRenderTarget(), auto: r.autoClear, xr: r.xr.enabled };
		r.autoClear = false;
		r.setRenderTarget( this.accum );
		if ( this.count === 0 ) { r.setClearColor( 0x000000, 0 ); r.clear( true, false, false ); }
		this.add.material.uniforms.src.value = texture;
		this.add.material.uniforms.weight.value = this.weight;
		this.add.render( r );
		r.setRenderTarget( was.target );
		r.autoClear = was.auto;
		this.count ++;

	}

	/**
	 * The frame at `width` × `height`: resolved, tone mapped, watermarked, quantised to `bits` (8: rgb24,
	 * 10: rgb48le, the 10 bits in a 16-bit word), top row first. `mark`: { texture, rect: [ x, y, w, h ]
	 * px from the top-left, opacity } or null; `dither` false for none (the old, banded output).
	 */
	read( width, height, { bits = 8, mark = null, dither = true, seed = 0 } = {} ) {

		const r = this.renderer, was = { target: r.getRenderTarget(), auto: r.autoClear, cc: r.getClearColor( new THREE.Color() ), ca: r.getClearAlpha() };
		for ( const t of [ this.linear, this.toned, this.out8, this.out16 ] ) if ( t.width !== width || t.height !== height ) t.setSize( width, height );
		r.autoClear = false;
		// resolve
		const R = this.resolveQuad.material.uniforms;
		R.src.value = this.accum.texture; R.srcSize.value.set( this.accum.width, this.accum.height ); R.outSize.value.set( width, height );
		r.setRenderTarget( this.linear ); this.resolveQuad.render( r );
		// tone map (OutputPass: to its write buffer when not to the screen)
		this.output.renderToScreen = false;
		this.output.clear = false;
		this.output.render( r, this.toned, this.linear );
		// finish
		const F = this.finishQuad.material.uniforms, ten = bits === 10, target = ten ? this.out16 : this.out8;
		F.src.value = this.toned.texture; F.outSize.value.set( width, height );
		F.levels.value = ten ? 1023 : 255; F.dither.value = dither ? 1 : 0; F.seed.value = seed % 4096;
		F.mark.value = mark?.texture ?? null; F.markOpacity.value = mark ? mark.opacity : 0;
		if ( mark ) F.markRect.value.set( ...mark.rect );
		r.setRenderTarget( target ); this.finishQuad.render( r );
		// read back: rgba, then rgb (the alpha dropped)
		const n = width * height, rgb = ten ? new Uint16Array( 3 * n ) : new Uint8Array( 3 * n );
		if ( ten ) {

			const px = new Float32Array( 4 * n );
			r.readRenderTargetPixels( target, 0, 0, width, height, px );
			for ( let i = 0, j = 0; i < 4 * n; i += 4, j += 3 ) for ( let c = 0; c < 3; ++ c ) { const v = px[ i + c ]; rgb[ j + c ] = ( v << 6 ) | ( v >> 4 ); }		// (10 bits to 16: the top bits repeated below, 1023 -> 65535)

		} else {

			const px = new Uint8Array( 4 * n );
			r.readRenderTargetPixels( target, 0, 0, width, height, px );
			for ( let i = 0, j = 0; i < 4 * n; i += 4, j += 3 ) { rgb[ j ] = px[ i ]; rgb[ j + 1 ] = px[ i + 1 ]; rgb[ j + 2 ] = px[ i + 2 ]; }

		}
		r.setRenderTarget( was.target );
		r.autoClear = was.auto;
		r.setClearColor( was.cc, was.ca );
		return rgb;

	}

	/** The accumulated frame tone mapped onto the canvas at the source's size (the old capture: drawImage from it). */
	toCanvas() {

		const r = this.renderer, R = this.resolveQuad.material.uniforms;
		R.src.value = this.accum.texture; R.srcSize.value.set( this.accum.width, this.accum.height ); R.outSize.value.set( this.accum.width, this.accum.height );
		if ( this.linear.width !== this.accum.width || this.linear.height !== this.accum.height ) this.linear.setSize( this.accum.width, this.accum.height );
		const was = { target: r.getRenderTarget(), auto: r.autoClear };
		r.autoClear = false;
		const radius = R.radius.value;
		R.radius.value = 0.5;		// (one texel: a copy)
		r.setRenderTarget( this.linear ); this.resolveQuad.render( r );
		R.radius.value = radius;
		this.output.renderToScreen = true;
		this.output.render( r, null, this.linear );
		this.output.renderToScreen = false;
		r.setRenderTarget( was.target );
		r.autoClear = was.auto;

	}

}

/** Bytes as base64 (the browser's own encoder: fast for megabytes). */
export function toBase64( bytes ) {

	return new Promise( ( ok, fail ) => {

		const fr = new FileReader();
		fr.onload = () => ok( fr.result.slice( fr.result.indexOf( ',' ) + 1 ) );
		fr.onerror = () => fail( fr.error );
		fr.readAsDataURL( new Blob( [ bytes.buffer ] ) );

	} );

}

/** Halton( 2, 3 ) point `i` (from 1), in [ -0.5, 0.5 )²: the sub-frames' jitter. */
export function halton2( i ) {

	const h = ( i, b ) => { let f = 1, r = 0; for ( ; i > 0; i = Math.floor( i / b ) ) { f /= b; r += f * ( i % b ); } return r; };
	return [ h( i, 2 ) - 0.5, h( i, 3 ) - 0.5 ];

}

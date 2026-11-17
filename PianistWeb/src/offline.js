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
//   (HDR: --hdr hlg|pq, read( { hdr } ): instead of the OutputPass, hdrQuad below: the SDR curve's midtones
//                kept (its white at 203 nits, BT.2408's reference white), its highlights carried on to the peak,
//                BT.2020, HLG or PQ; then the finish as below at 10 bits)
//   finish       the watermark (blended in sRGB, as the 2D canvas did), then quantised with
//                triangular dither to 8 or 10 bits: smooth gradients (walls, the dome, the sky, the
//                bloom) without bands; read back top row first as rgb24 or rgb48le for ffmpeg

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { withToneMix, toneMix } from './tonemix.js';

// HDR: the SDR curve's luminance from which the highlights go on to the peak (hdrQuad)
const KNEE = 0.5;
// the renderer's tone mapping as hdrQuad's `tone`
const TONE_KIND = { [ THREE.AgXToneMapping ]: 1, [ THREE.ACESFilmicToneMapping ]: 2, [ THREE.NeutralToneMapping ]: 3, [ THREE.CustomToneMapping ]: 4 };

// the meter's grid (meter())
export const METER_W = 16, METER_H = 32;

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
		// the meter (autoExposure, main.js): the frame's light, linear, before any exposure: per cell of a 16 x 32 grid
		// the mean log luminance of 8 x 8 points in it (main.js weights the cells, centre-weighted)
		this.meterTarget = rt( THREE.FloatType );
		this.meterTarget.setSize( METER_W, METER_H );
		this.meterBuf = new Float32Array( 4 * METER_W * METER_H );
		this.meterQuad = new FullScreenQuad( new THREE.ShaderMaterial( {
			uniforms: { src: { value: null } },
			vertexShader: VERT,
			fragmentShader: /* glsl */`
				uniform sampler2D src; varying vec2 vUv;
				void main() {
					vec2 cell = vec2( ${ METER_W }.0, ${ METER_H }.0 ), c0 = floor( vUv * cell ) / cell;
					float s = 0.0;
					for ( int j = 0; j < 8; ++ j ) for ( int i = 0; i < 8; ++ i ) {
						vec4 t = texture2D( src, c0 + ( vec2( float( i ), float( j ) ) + 0.5 ) / ( 8.0 * cell ) );
						float l = dot( t.rgb / max( t.a, 1e-6 ), vec3( 0.2126, 0.7152, 0.0722 ) );		// (the sum's alpha: the sub-frames' weights)
						s += log( max( l, 0.0 ) + 1e-4 );
					}
					gl_FragColor = vec4( s / 64.0, 0.0, 0.0, 1.0 );
				}`,
			depthTest: false, depthWrite: false,
		} ) );
		this.output = withToneMix( new OutputPass() );
		// HDR (an HLG or PQ video): the frame's light in display nits, then encoded.
		//   SDR      the page's own curve (the renderer's tone mapping and exposure, the presets' crossfade
		//            between two: tonemix.js), its display-linear result s, its luminance ys
		//   midtones ys below KNEE: ys x 203 nits (an SDR white at HDR's reference white): the frame as the SDR
		//            one where most of it is (walls, floors, faces of things, the door in the corridor)
		//   highlights  from the knee on, more and more the scene's own luminance Y (pre-curve) on a curve
		//            to the peak, H = 203 G Y / ( 1 + 203 G Y / peak ), G set so that it meets the SDR at the
		//            knee (the knee's scene value found per frame on a grey ramp: any curve, the crossfade
		//            too); the larger of the two, so never below the SDR's: the lamps, the spot on the lacquer,
		//            the screen, the crystal go up to the peak where the SDR curve pressed them under 1
		//   colour   the SDR curve's (its hue and its highlights' desaturation, ACES's or AgX's), scaled to H;
		//            then BT.709 -> BT.2020 primaries (linear), capped at the peak per channel
		//   encoded  HLG (BT.2100: the inverse OOTF for a 1000 nit display, gamma 1.2, then the OETF; 203 nits
		//            at 75 % signal) or PQ (SMPTE 2084, absolute nits)
		this.hdrQuad = new FullScreenQuad( new THREE.ShaderMaterial( {
			toneMapped: false,
			uniforms: { src: { value: null }, toneMappingExposure: { value: 1 }, ptToneMix: toneMix, tone: { value: 1 }, mode: { value: 1 }, peak: { value: 1000 }, white: { value: 203 }, knee: { value: KNEE } },
			vertexShader: VERT,
			fragmentShader: /* glsl */`
				uniform sampler2D src; uniform int tone, mode; uniform float peak, white, knee; varying vec2 vUv;
				${ THREE.ShaderChunk.tonemapping_pars_fragment }
				vec3 sdr( vec3 c ) {
					if ( tone == 1 ) return AgXToneMapping( c );
					if ( tone == 2 ) return ACESFilmicToneMapping( c );
					if ( tone == 3 ) return NeutralToneMapping( c );
					if ( tone == 4 ) return CustomToneMapping( c );
					return saturate( toneMappingExposure * c );
				}
				float lum709( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
				float kneeAt() {		// (the grey whose SDR luminance is the knee: bisection)
					float lo = 0.0, hi = 1.0;
					for ( int i = 0; i < 24; ++ i ) { if ( lum709( sdr( vec3( hi ) ) ) >= knee ) break; lo = hi; hi *= 2.0; }
					for ( int i = 0; i < 22; ++ i ) { float m = 0.5 * ( lo + hi ); if ( lum709( sdr( vec3( m ) ) ) < knee ) lo = m; else hi = m; }
					return 0.5 * ( lo + hi );
				}
				float hlgOETF( float e ) { return e <= 1.0 / 12.0 ? sqrt( 3.0 * e ) : 0.17883277 * log( 12.0 * e - 0.28466892 ) + 0.55991073; }
				float pq( float n ) { float p = pow( clamp( n, 0.0, 1.0 ), 0.1593017578125 ); return pow( ( 0.8359375 + 18.8515625 * p ) / ( 1.0 + 18.6875 * p ), 78.84375 ); }
				void main() {
					vec3 x = max( texture2D( src, vUv ).rgb, 0.0 );
					vec3 s = max( sdr( x ), 0.0 );
					float ys = lum709( s ), Y = lum709( x );
					float G = knee / ( kneeAt() * max( 1e-3, 1.0 - white * knee / peak ) );
					float hmid = white * ys, hhi = white * G * Y / ( 1.0 + white * G * Y / peak );
					float H = mix( hmid, max( hmid, hhi ), smoothstep( knee, 1.0, ys ) );
					vec3 d = ys > 1e-7 ? s * ( H / ys ) : s * white;		// (nits, BT.709 linear)
					d = mat3( 0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0114, 0.8956 ) * d;		// (BT.2087: to BT.2020)
					d = max( d, 0.0 );
					float mc = max( d.r, max( d.g, d.b ) );
					if ( mc > peak ) d *= peak / mc;
					vec3 e;
					if ( mode == 1 ) {
						// HLG: the display light (a 1000 nit display) back to the scene light (inverse OOTF), then the OETF
						vec3 f = d / 1000.0;
						float yd = dot( f, vec3( 0.2627, 0.6780, 0.0593 ) );
						vec3 es = yd > 0.0 ? f * pow( yd, ( 1.0 - 1.2 ) / 1.2 ) : vec3( 0.0 );
						es = clamp( es, 0.0, 1.0 );
						e = vec3( hlgOETF( es.r ), hlgOETF( es.g ), hlgOETF( es.b ) );
					} else {
						e = vec3( pq( d.r / 10000.0 ), pq( d.g / 10000.0 ), pq( d.b / 10000.0 ) );
					}
					gl_FragColor = vec4( e, 1.0 );
				}`,
		} ) );
		// the watermark (src/main.js WATERMARK: its rect, px from the top-left), then the quantisation; the
		// rows flipped (the encoder's first row is the top)
		this.finishQuad = new FullScreenQuad( new THREE.ShaderMaterial( {
			uniforms: { src: { value: null }, mark: { value: null }, markRect: { value: new THREE.Vector4() }, markOpacity: { value: 0 }, markGain: { value: 1 }, outSize: { value: new THREE.Vector2() }, levels: { value: 255 }, dither: { value: 1 }, seed: { value: 0 } },
			vertexShader: VERT,
			fragmentShader: /* glsl */`
				uniform sampler2D src, mark; uniform vec4 markRect; uniform float markOpacity, markGain, levels, dither, seed; uniform vec2 outSize; varying vec2 vUv;
				float hash( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
				void main() {
					// (the target's first row read is the image's top: the source sampled flipped; px from the top-left, as the canvas)
					vec2 uv = vec2( vUv.x, 1.0 - vUv.y ), px = vUv * outSize;
					vec3 c = texture2D( src, uv ).rgb;
					if ( markOpacity > 0.0 && px.x >= markRect.x && px.y >= markRect.y && px.x < markRect.x + markRect.z && px.y < markRect.y + markRect.w ) {
						vec4 m = texture2D( mark, ( px - markRect.xy ) / markRect.zw );
						c = mix( c, m.rgb * markGain, m.a * markOpacity );		// (source-over in sRGB values, as the 2D canvas; HDR: in the signal, its white at reference white's)
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

	/** The frame's metered light (the sum so far): the cells' mean log luminance, METER_W x METER_H, rows from the bottom. */
	meter() {

		const r = this.renderer, was = r.getRenderTarget();
		this.meterQuad.material.uniforms.src.value = this.accum.texture;
		r.setRenderTarget( this.meterTarget ); this.meterQuad.render( r );
		r.readRenderTargetPixels( this.meterTarget, 0, 0, METER_W, METER_H, this.meterBuf );
		r.setRenderTarget( was );
		const cells = new Float32Array( METER_W * METER_H );
		for ( let i = 0; i < cells.length; ++ i ) cells[ i ] = this.meterBuf[ 4 * i ];
		return cells;

	}

	/**
	 * The frame at `width` × `height`: resolved, tone mapped, watermarked, quantised to `bits` (8: rgb24,
	 * 10: rgb48le, the 10 bits in a 16-bit word), top row first. `mark`: { texture, rect: [ x, y, w, h ]
	 * px from the top-left, opacity } or null; `dither` false for none (the old, banded output). `hdr`: 'hlg' or
	 * 'pq' (10 bits, BT.2020: hdrQuad), `hdrPeak` its highlights' peak in nits (HLG: at most 1000).
	 */
	read( width, height, { bits = 8, mark = null, dither = true, seed = 0, hdr = null, hdrPeak = 1000 } = {} ) {

		if ( hdr ) bits = 10;

		const r = this.renderer, was = { target: r.getRenderTarget(), auto: r.autoClear, cc: r.getClearColor( new THREE.Color() ), ca: r.getClearAlpha() };
		for ( const t of [ this.linear, this.toned, this.out8, this.out16 ] ) if ( t.width !== width || t.height !== height ) t.setSize( width, height );
		r.autoClear = false;
		// resolve
		const R = this.resolveQuad.material.uniforms;
		R.src.value = this.accum.texture; R.srcSize.value.set( this.accum.width, this.accum.height ); R.outSize.value.set( width, height );
		r.setRenderTarget( this.linear ); this.resolveQuad.render( r );
		if ( hdr ) {

			// HDR: hdrQuad (the renderer's curve and exposure, as the OutputPass would take them)
			const H = this.hdrQuad.material.uniforms;
			H.src.value = this.linear.texture;
			H.toneMappingExposure.value = r.toneMappingExposure;
			H.tone.value = TONE_KIND[ r.toneMapping ] ?? 0;
			H.mode.value = hdr === 'pq' ? 2 : 1;
			H.peak.value = hdr === 'pq' ? hdrPeak : Math.min( hdrPeak, 1000 );
			r.setRenderTarget( this.toned ); this.hdrQuad.render( r );

		} else {

			// tone map (OutputPass: to its write buffer when not to the screen)
			this.output.renderToScreen = false;
			this.output.clear = false;
			this.output.render( r, this.toned, this.linear );

		}
		// finish
		const F = this.finishQuad.material.uniforms, ten = bits === 10, target = ten ? this.out16 : this.out8;
		F.src.value = this.toned.texture; F.outSize.value.set( width, height );
		F.levels.value = ten ? 1023 : 255; F.dither.value = dither ? 1 : 0; F.seed.value = seed % 4096;
		F.mark.value = mark?.texture ?? null; F.markOpacity.value = mark ? mark.opacity : 0;
		F.markGain.value = hdr === 'pq' ? 0.58 : hdr ? 0.75 : 1;		// (reference white, 203 nits, in the signal)
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

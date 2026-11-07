// The path tracer's image as the raster's composer would finish it: the HDR sanitised and the venue's
// saturation (hdrClamp, shared with main.js's composer), its bloom, the tone mapping and sRGB (OutputPass),
// then a triangular dither to 8 bits (smooth gradients without banding). The path tracer's accumulated
// image is linear HDR already: bloom on it is the real thing, not a raster's clipped highlights.
//
// No GTAO (the path tracer's occlusion is its own) and no screen-space depth of field (the path tracer's
// lens: ptLens(), a PhysicalCamera's aperture and focus).

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PhysicalCamera } from 'three-gpu-pathtracer';

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }';

/**
 * HDR sanitising, and the venue preset's saturation (in linear light, before the tone mapping). Non-finite
 * values to 0, the rest capped at `max`: the sun's glare in the glossy screen reaches ~7000 in a half-float
 * buffer, and summed in the bloom's blur that overflowed (Inf, then NaN: black rectangles).
 */
export function makeHDRClamp( max = 4096 ) {

	return new ShaderPass( {
		uniforms: { tDiffuse: { value: null }, uMax: { value: max }, uSaturation: { value: 1 } },
		vertexShader: VERTEX,
		fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax; uniform float uSaturation; varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				c = mix( c, vec4( 0.0 ), vec4( notEqual( c, c ) ) );		// NaN
				vec3 rgb = clamp( c.rgb, 0.0, uMax );		// Inf, too bright
				rgb = max( mix( vec3( dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), rgb, uSaturation ), 0.0 );
				gl_FragColor = vec4( rgb, clamp( c.a, 0.0, 1.0 ) );
			}`,
	} );

}

export class PTPost {

	constructor() {

		const half = () => new THREE.WebGLRenderTarget( 1, 1, { type: THREE.HalfFloatType, depthBuffer: false } );
		this.a = half(); this.b = half();
		this.clamp = makeHDRClamp();
		this.bloom = new UnrealBloomPass( new THREE.Vector2( 1, 1 ), 0, 0.6, 0.92 );
		this.output = new OutputPass();
		// triangular dither, ±1 step of 8 bits, on the sRGB image (the steps of a slow gradient: the walls, the sky)
		this.dither = new ShaderPass( {
			uniforms: { tDiffuse: { value: null }, uOn: { value: 1 }, uSeed: { value: 0 } },
			vertexShader: VERTEX,
			fragmentShader: `uniform sampler2D tDiffuse; uniform float uOn, uSeed; varying vec2 vUv;
				float hash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.yzx + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
				void main() {
					vec4 c = texture2D( tDiffuse, vUv );
					vec2 px = gl_FragCoord.xy;
					vec3 n = vec3( 0.0 );
					for ( int i = 0; i < 3; ++ i ) n[ i ] = hash( vec3( px, uSeed + float( i ) * 7.13 ) ) - hash( vec3( px.yx + 17.0, uSeed + float( i ) * 3.71 + 1.0 ) );
					vec3 q = floor( clamp( c.rgb, 0.0, 1.0 ) * 255.0 + 0.5 + n * uOn ) / 255.0;
					gl_FragColor = vec4( clamp( q, 0.0, 1.0 ), 1.0 );
				}`,
		} );
		this.size = new THREE.Vector2();

	}

	/**
	 * `src` (the path tracer's linear HDR texture) into `target` (RGBA8; null: the canvas). `params`:
	 * { saturation, bloom (strength; 0 none), bloomThreshold, dither }.
	 */
	render( renderer, src, target, { saturation = 1, bloom = 0, bloomThreshold = 0.92, dither = true } = {} ) {

		const w = src.image.width, h = src.image.height;
		if ( this.size.x !== w || this.size.y !== h ) {

			this.size.set( w, h );
			this.a.setSize( w, h ); this.b.setSize( w, h );
			this.bloom.setSize( w, h );

		}

		const was = { target: renderer.getRenderTarget(), auto: renderer.autoClear };
		renderer.autoClear = true;
		// clamp and saturation: src -> a
		this.clamp.uniforms.uSaturation.value = saturation;
		this.clamp.renderToScreen = false;
		this.clamp.render( renderer, this.a, { texture: src } );
		// bloom: added into a, in place
		if ( bloom > 0 ) {

			Object.assign( this.bloom, { strength: bloom, threshold: bloomThreshold, renderToScreen: false } );
			this.bloom.render( renderer, null, this.a, 0, false );

		}
		// tone mapping, sRGB: a -> b (half float: the dither quantises)
		this.output.renderToScreen = false;
		this.output.render( renderer, this.b, this.a );
		// dither to 8 bits: b -> target
		this.dither.uniforms.uOn.value = dither ? 1 : 0;
		this.dither.uniforms.uSeed.value = ( this.dither.uniforms.uSeed.value + 1 ) % 4096;
		this.dither.renderToScreen = ! target;
		if ( target ) this.dither.render( renderer, target, this.b );
		else this.dither.render( renderer, null, this.b );
		renderer.setRenderTarget( was.target );
		renderer.autoClear = was.auto;

	}

	/**
	 * `src` sanitised, its saturation and bloom applied, still linear HDR: the offline frame's input
	 * (src/offline.js tone maps, resolves and dithers it itself). Returns the half-float target (this.a).
	 */
	renderLinear( renderer, src, { saturation = 1, bloom = 0, bloomThreshold = 0.92 } = {} ) {

		const w = src.image.width, h = src.image.height;
		if ( this.size.x !== w || this.size.y !== h ) {

			this.size.set( w, h );
			this.a.setSize( w, h ); this.b.setSize( w, h );
			this.bloom.setSize( w, h );

		}

		const was = { target: renderer.getRenderTarget(), auto: renderer.autoClear };
		renderer.autoClear = true;
		this.clamp.uniforms.uSaturation.value = saturation;
		this.clamp.renderToScreen = false;
		this.clamp.render( renderer, this.a, { texture: src } );
		if ( bloom > 0 ) {

			Object.assign( this.bloom, { strength: bloom, threshold: bloomThreshold, renderToScreen: false } );
			this.bloom.render( renderer, null, this.a, 0, false );

		}
		renderer.setRenderTarget( was.target );
		renderer.autoClear = was.auto;
		return this.a;

	}

	dispose() {

		for ( const p of [ this.clamp, this.bloom, this.output, this.dither ] ) p.dispose?.();
		this.a.dispose(); this.b.dispose();

	}

}

/**
 * The path tracer's lens: a PhysicalCamera copied from `camera`, its aperture `fStop` (0 or less: a pinhole,
 * no depth of field) focused at `focus` m. The path tracer reads a PhysicalCamera's aperture (bokehSize: the
 * focal length over the f-number, in mm) and focus; any other camera is a pinhole to it.
 */
export function ptLens( camera, { fStop = 0, focus = 2, blades = 0 } = {} ) {

	const c = new PhysicalCamera();
	c.copy( camera );		// (a PerspectiveCamera's: the lens's own fields set below)
	Object.assign( c, { apertureBlades: blades, apertureRotation: 0, anamorphicRatio: 1, focusDistance: Math.max( 0.05, focus ) } );
	c.fStop = fStop > 0 ? fStop : Infinity;		// (Infinity: bokehSize 0, FEATURE_DOF off)
	c.updateProjectionMatrix(); c.updateMatrixWorld();
	return c;

}

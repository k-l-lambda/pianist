// Planar reflections for physical materials: the scene drawn once a frame from the camera mirrored
// in a plane (an oblique near plane on it: nothing behind it), into a half-float target with
// mipmaps; a material given it (addTo) reads it where it has the reflected ray (its blurred levels
// for its roughness) in place of its environment map's radiance. As three's Reflector, but under
// MeshPhysicalMaterial's own shading (Fresnel, clearcoat, roughness). Used for Luminara's floor
// (src/luminara.js) and the piano's screen (main.js).

import * as THREE from 'three';

/** Another onBeforeCompile on `material`, after its others (each its part of the program's key). */
export function chainCompile( material, fn, key ) {

	const prev = material.onBeforeCompile;
	material.onBeforeCompile = ( shader, renderer ) => { prev.call( material, shader, renderer ); fn( shader ); };
	material.userData.programKeys = [ ...( material.userData.programKeys ?? [] ), key ];
	material.customProgramCacheKey = () => material.userData.programKeys.join( '+' );

}

const all = new Set();		// (every mirror's reflection off while any one is drawn: theirs are of the main view)

export class PlaneMirror {

	/** `plane`: world (its normal towards the viewer); `blur`: how far its roughness reads into the blurred levels. */
	constructor( plane, { blur = 0.75 } = {} ) {

		this.plane = plane.clone();
		this.target = new THREE.WebGLRenderTarget( 4, 4, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter } );
		this.camera = new THREE.PerspectiveCamera();
		this.uniforms = { uMirror: { value: this.target.texture }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 }, uMirrorLods: { value: 1 }, uMirrorBlur: { value: blur } };
		this.enabled = true;
		all.add( this );

	}

	/** `material` reads the reflection (its radiance and its clearcoat's). */
	addTo( material ) {

		const U = this.uniforms;
		chainCompile( material, shader => {

			Object.assign( shader.uniforms, U );
			shader.vertexShader = shader.vertexShader
				.replace( '#include <common>', '#include <common>\nvarying vec3 vMirrorWorld;' )
				.replace( '#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMirrorWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' );
			shader.fragmentShader = shader.fragmentShader
				.replace( '#include <common>', '#include <common>\nuniform sampler2D uMirror;\nuniform mat4 uMirrorMatrix;\nuniform float uMirrorOn, uMirrorLods, uMirrorBlur;\nvarying vec3 vMirrorWorld;' )
				.replace( '#include <lights_fragment_maps>', `#include <lights_fragment_maps>
				if ( uMirrorOn > 0.5 ) {

					vec4 mp = uMirrorMatrix * vec4( vMirrorWorld, 1.0 );
					vec2 muv = mp.xy / mp.w;
					muv += ( normal.xy - geometryNormal.xy ) * 0.03;		// (a normal map's tilt shifts it a little)
					if ( mp.w > 0.0 && all( greaterThan( muv, vec2( 0.0 ) ) ) && all( lessThan( muv, vec2( 1.0 ) ) ) ) {

						radiance = textureLod( uMirror, muv, sqrt( material.roughness ) * uMirrorLods * uMirrorBlur ).rgb;
						#ifdef USE_CLEARCOAT
							clearcoatRadiance = textureLod( uMirror, muv, sqrt( material.clearcoatRoughness ) * uMirrorLods * uMirrorBlur ).rgb;
						#endif

					}

				}` );

		}, 'planeMirror' );
		material.needsUpdate = true;

	}

	/**
	 * Draw the reflection for `camera` (once a frame, before the frame): `hide` (the mirror's own
	 * surface and what lies on it), `scale` of the drawing buffer. Not drawn (its materials read their
	 * environment again) when off, or the camera is behind the plane, or `visible` says no.
	 */
	update( renderer, scene, camera, hide, scale, visible = null ) {

		const U = this.uniforms;
		U.uMirrorOn.value = 0;
		if ( ! this.enabled || this._busy ) return;
		camera.updateMatrixWorld();
		const eye = new THREE.Vector3().setFromMatrixPosition( camera.matrixWorld );
		if ( this.plane.distanceToPoint( eye ) <= 0.001 || ( visible && ! visible( camera ) ) ) return;
		const size = renderer.getDrawingBufferSize( new THREE.Vector2() ), w = Math.max( 4, Math.round( size.x * scale ) ), h = Math.max( 4, Math.round( size.y * scale ) );
		if ( this.target.width !== w || this.target.height !== h ) this.target.setSize( w, h );
		U.uMirrorLods.value = Math.log2( Math.max( w, h ) );
		// the camera mirrored in the plane (as Reflector: the eye and the look-at point reflected, its up likewise)
		const n = this.plane.normal, P = v => v.addScaledVector( n, - 2 * this.plane.distanceToPoint( v ) ), D = v => v.addScaledVector( n, - 2 * v.dot( n ) );
		const rot = new THREE.Matrix4().extractRotation( camera.matrixWorld );
		const look = new THREE.Vector3( 0, 0, - 1 ).applyMatrix4( rot ).add( eye ), up = new THREE.Vector3( 0, 1, 0 ).applyMatrix4( rot );
		const vc = this.camera;
		vc.position.copy( P( eye.clone() ) );
		vc.up.copy( D( up ) );
		vc.lookAt( P( look ) );
		vc.near = camera.near; vc.far = camera.far; vc.fov = camera.fov; vc.aspect = camera.aspect; vc.zoom = camera.zoom ?? 1;
		vc.updateMatrixWorld();
		vc.projectionMatrix.copy( camera.projectionMatrix );
		// world -> its uv
		U.uMirrorMatrix.value.set( 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1 ).multiply( vc.projectionMatrix ).multiply( vc.matrixWorldInverse );
		// an oblique near plane on the mirror (Lengyel)
		const pl = this.plane.clone().applyMatrix4( vc.matrixWorldInverse );
		const cp = new THREE.Vector4( pl.normal.x, pl.normal.y, pl.normal.z, pl.constant ), E = vc.projectionMatrix.elements;
		const q = new THREE.Vector4( ( Math.sign( cp.x ) + E[ 8 ] ) / E[ 0 ], ( Math.sign( cp.y ) + E[ 9 ] ) / E[ 5 ], - 1, ( 1 + E[ 10 ] ) / E[ 14 ] );
		cp.multiplyScalar( 2 / cp.dot( q ) );
		E[ 2 ] = cp.x; E[ 6 ] = cp.y; E[ 10 ] = cp.z + 1; E[ 14 ] = cp.w;
		vc.projectionMatrixInverse.copy( vc.projectionMatrix ).invert();
		// draw (every mirror's reflection off meanwhile: theirs are of the main view, not this one)
		this._busy = true;
		const flags = [ ...all ].map( m => [ m, m.uniforms.uMirrorOn.value ] );
		for ( const [ m ] of flags ) m.uniforms.uMirrorOn.value = 0;
		const was = { target: renderer.getRenderTarget(), xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate, vis: hide.map( o => o.visible ) };
		hide.forEach( o => o.visible = false );
		renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
		renderer.setRenderTarget( this.target );
		renderer.clear();
		renderer.render( scene, vc );
		renderer.setRenderTarget( was.target );
		renderer.xr.enabled = was.xr; renderer.shadowMap.autoUpdate = was.shadow;
		hide.forEach( ( o, i ) => o.visible = was.vis[ i ] );
		for ( const [ m, v ] of flags ) m.uniforms.uMirrorOn.value = v;
		this._busy = false;
		U.uMirrorOn.value = 1;

	}

}

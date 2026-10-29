// Dedicated sun shadow map for the keyboard.
//
// The room's sun map covers the whole window shaft, so at the low afternoon sun one texel
// lands as a several-millimetre streak on the key tops and the black keys' shadows break up.
// This map looks along the same sun direction but is framed tightly around the keyboard
// (orthographic, ~0.1 mm texels). Key materials take the near-occluder shadow from here and
// only the farther bands (window frame, leaves, piano body) from the room's map, multiplied
// together (see softshadows.js, KEY_SHADOW).

import * as THREE from 'three';

const LAYER = 7;

export class KeyShadow {

	constructor( renderer ) {

		this.renderer = renderer;
		const max = renderer.capabilities.maxTextureSize;
		const w = Math.min( 8192, max ), h = Math.min( 2048, max );
		const depth = new THREE.DepthTexture( w, h, THREE.UnsignedShortType );
		depth.compareFunction = THREE.LessEqualCompare;
		depth.minFilter = depth.magFilter = THREE.LinearFilter;
		this.target = new THREE.WebGLRenderTarget( w, h, { depthBuffer: true, depthTexture: depth, format: THREE.RedFormat, generateMipmaps: false } );
		this.size = new THREE.Vector2( w, h );

		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0.1, 10 );
		this.camera.layers.set( LAYER );
		// back faces: the stored depth is the far side of each caster, so lit surfaces don't self-shadow
		this.depthMaterial = new THREE.MeshDepthMaterial( { side: THREE.BackSide } );

		this.uniforms = {
			keyShadowMap: { value: depth },
			keyShadowMatrix: { value: new THREE.Matrix4() },
			keyShadowRadius: { value: new THREE.Vector2() },
			keyShadowBias: { value: 0 },
			keyShadowNormalBias: { value: 0.0004 },
		};
		this.box = new THREE.Box3();
		this.piano = null;

	}

	/** Make the piano's keys (and the case around them) cast into, and receive from, this map. */
	attach( piano, materials ) {

		this.piano = piano;
		piano.group.updateMatrixWorld( true );
		this.box.setFromObject( piano.keyboard.group ).expandByScalar( 0.01 );
		for ( const m of piano.keyboard.pickables ) m.layers.enable( LAYER );
		piano.group.traverse( o => o.name === 'caseWood' && o.layers.enable( LAYER ) );

		for ( const mat of materials ) {

			mat.defines = { ...( mat.defines || {} ), KEY_SHADOW: '' };
			mat.customProgramCacheKey = () => 'keyshadow';
			mat.onBeforeCompile = shader => {

				Object.assign( shader.uniforms, this.uniforms );
				shader.vertexShader = shader.vertexShader
					.replace( '#include <shadowmap_pars_vertex>', '#include <shadowmap_pars_vertex>\nuniform mat4 keyShadowMatrix;\nuniform float keyShadowNormalBias;\nvarying vec4 vKeyShadowCoord;' )
					.replace( '#include <shadowmap_vertex>', '#include <shadowmap_vertex>\n\t{\n\t\tvec3 ksNormal = inverseTransformDirection( transformedNormal, viewMatrix );\n\t\tvKeyShadowCoord = keyShadowMatrix * vec4( worldPosition.xyz + ksNormal * keyShadowNormalBias, 1.0 );\n\t}' );

			};
			mat.needsUpdate = true;

		}

	}

	/** Re-render the map for the current sun and key positions. */
	update( scene, sun, sunAngularRadius ) {

		if ( ! this.piano || ! sun.visible ) return;
		const r = this.renderer;
		const cam = this.camera;

		const dir = new THREE.Vector3().subVectors( sun.position, sun.target.position ).normalize();
		const center = this.box.getCenter( new THREE.Vector3() );
		cam.position.copy( center ).addScaledVector( dir, 3 );
		cam.up.set( 0, 1, 0 );
		cam.lookAt( center );
		cam.updateMatrixWorld( true );

		// fit the keyboard box in light space; reach 1 m towards the sun for casters (the arms)
		const inv = cam.matrixWorldInverse;
		const lo = new THREE.Vector3( Infinity, Infinity, Infinity ), hi = lo.clone().negate();
		const p = new THREE.Vector3();
		for ( let i = 0; i < 8; ++ i ) {

			p.set( i & 1 ? this.box.max.x : this.box.min.x, i & 2 ? this.box.max.y : this.box.min.y, i & 4 ? this.box.max.z : this.box.min.z ).applyMatrix4( inv );
			lo.min( p );
			hi.max( p );

		}

		cam.left = lo.x; cam.right = hi.x; cam.bottom = lo.y; cam.top = hi.y;
		cam.near = - hi.z - 1.0;
		cam.far = - lo.z + 0.01;
		cam.updateProjectionMatrix();

		const spanX = hi.x - lo.x, spanY = hi.y - lo.y;
		// penumbra of an occluder ~3 cm away (black key on white key), at least one texel
		const pen = sunAngularRadius * 0.03;
		this.uniforms.keyShadowRadius.value.set( Math.max( 1 / this.size.x, pen / spanX ), Math.max( 1 / this.size.y, pen / spanY ) );
		this.uniforms.keyShadowBias.value = 0.0003 / ( cam.far - cam.near );
		this.uniforms.keyShadowMatrix.value.multiplyMatrices( cam.projectionMatrix, cam.matrixWorldInverse );

		const prev = {
			target: r.getRenderTarget(), override: scene.overrideMaterial, bg: scene.background,
			auto: r.shadowMap.autoUpdate, needs: r.shadowMap.needsUpdate,
		};
		scene.overrideMaterial = this.depthMaterial;
		scene.background = null;
		r.shadowMap.autoUpdate = false;
		r.shadowMap.needsUpdate = false;
		r.setRenderTarget( this.target );
		r.clear( true, true, false );
		r.render( scene, cam );
		r.setRenderTarget( prev.target );
		scene.overrideMaterial = prev.override;
		scene.background = prev.bg;
		r.shadowMap.autoUpdate = prev.auto;
		r.shadowMap.needsUpdate = prev.needs;

	}

}

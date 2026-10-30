// Real-time global illumination for the raster path:
// the lit room is captured into a cube map from the piano's position and prefiltered
// (PMREM) into scene.environment. Repeating the capture with the previous result
// applied adds one more diffuse/specular bounce each time.
//
// Mirror-like surfaces get a second map (`specular`) captured without the sun, the sky and the
// leaves: from the probe's position the window opening and the sunlit wall patch would appear
// as a second, offset and pixelated window next to the sharp one the window light gives.

import * as THREE from 'three';

export class GIProbe {

	constructor( renderer, scene, { size = 256 } = {} ) {

		this.renderer = renderer;
		this.scene = scene;
		this.cubeRT = new THREE.WebGLCubeRenderTarget( size, { type: THREE.HalfFloatType, generateMipmaps: false } );
		this.cubeCamera = new THREE.CubeCamera( 0.05, 50, this.cubeRT );
		this.pmrem = new THREE.PMREMGenerator( renderer );
		this.targets = [ null, null ];
		this.specTarget = null;
		this.specular = null;
		this.flip = 0;
		this.position = new THREE.Vector3( 0, 1.1, 1.0 );
		this.bounces = 2;
		this.intensity = 1;

	}

	/**
	 * `hide`: objects left out of both captures (the piano itself); `specularOff`: lights
	 * (dimmed to 0, no shader rebuild) and objects left out of the specular one.
	 */
	update( hide = [], { lights = [], objects = [] } = {} ) {

		const r = this.renderer;
		const scene = this.scene;
		const prev = {
			toneMapping: r.toneMapping,
			shadowAuto: r.shadowMap.autoUpdate,
			background: scene.background,
		};
		r.toneMapping = THREE.NoToneMapping;

		const visible = hide.map( o => o.visible );
		hide.forEach( o => o.visible = false );

		this.cubeCamera.position.copy( this.position );
		scene.add( this.cubeCamera );

		scene.environment = null;
		for ( let i = 0; i < Math.max( 1, this.bounces ); ++ i ) {

			this.cubeCamera.update( r, scene );
			r.shadowMap.autoUpdate = false;		// shadows don't change between bounces
			this.flip ^= 1;
			this.targets[ this.flip ] = this.pmrem.fromCubemap( this.cubeRT.texture, this.targets[ this.flip ] );
			scene.environment = this.targets[ this.flip ].texture;

		}

		// specular map: the room lit by the sky and the bounce light only
		const saved = lights.map( l => l.intensity );
		const vis = objects.map( o => o.visible );
		lights.forEach( l => l.intensity = 0 );
		objects.forEach( o => o.visible = false );
		const env = scene.environment;
		scene.environment = null;
		scene.background = null;
		this.cubeCamera.update( r, scene );
		this.specTarget = this.pmrem.fromCubemap( this.cubeRT.texture, this.specTarget );
		this.specular = this.specTarget.texture;
		scene.environment = env;
		lights.forEach( ( l, i ) => l.intensity = saved[ i ] );
		objects.forEach( ( o, i ) => o.visible = vis[ i ] );

		scene.environmentIntensity = this.intensity;
		scene.remove( this.cubeCamera );
		hide.forEach( ( o, i ) => o.visible = visible[ i ] );
		r.toneMapping = prev.toneMapping;
		r.shadowMap.autoUpdate = prev.shadowAuto;
		r.shadowMap.needsUpdate = true;
		scene.background = prev.background;

		return scene.environment;

	}

	/**
	 * Re-capture only the specular (mirror) map, from `position` (e.g. the viewer, so things
	 * near the camera — the person holding it — show up in glossy reflections). Cheap enough to
	 * call a few times a second; uses the same exclusions as update().
	 */
	updateSpecular( position, hide = [], { lights = [], objects = [] } = {} ) {

		if ( ! this.specTarget ) return;
		const r = this.renderer, scene = this.scene;
		const prev = { toneMapping: r.toneMapping, shadowAuto: r.shadowMap.autoUpdate, background: scene.background, env: scene.environment };
		const hv = hide.map( o => o.visible ), ov = objects.map( o => o.visible ), li = lights.map( l => l.intensity );
		hide.forEach( o => o.visible = false );
		objects.forEach( o => o.visible = false );
		lights.forEach( l => l.intensity = 0 );
		r.toneMapping = THREE.NoToneMapping;
		r.shadowMap.autoUpdate = false;
		scene.background = null;
		this.cubeCamera.position.copy( position );
		scene.add( this.cubeCamera );
		this.cubeCamera.update( r, scene );
		scene.remove( this.cubeCamera );
		this.pmrem.fromCubemap( this.cubeRT.texture, this.specTarget );
		hide.forEach( ( o, i ) => o.visible = hv[ i ] );
		objects.forEach( ( o, i ) => o.visible = ov[ i ] );
		lights.forEach( ( l, i ) => l.intensity = li[ i ] );
		r.toneMapping = prev.toneMapping;
		r.shadowMap.autoUpdate = prev.shadowAuto;
		scene.background = prev.background;
		scene.environment = prev.env;

	}

	/**
	 * Mirror map for one flat glossy surface (`plane`, normal towards the viewer): captured from
	 * the viewer's mirror image behind the plane, with everything behind the plane clipped. A
	 * ray reflected off the plane runs on from that point, so looking the map up by reflection
	 * direction alone gives the exact planar reflection — the viewer (the person holding the
	 * camera) at the right size and place. Same exclusions as update(). Returns the texture.
	 * Own, sharper cube: a mirror shows the cube's texels at several screen pixels each.
	 */
	updateMirror( viewer, plane, hide = [], { lights = [], objects = [], size = 1024 } = {} ) {

		if ( this.mirrorRT?.width !== size ) {

			this.mirrorRT?.dispose();
			this.mirrorTarget?.dispose();
			this.mirrorTarget = null;
			this.mirrorRT = new THREE.WebGLCubeRenderTarget( size, { type: THREE.HalfFloatType, generateMipmaps: false } );
			this.mirrorCamera = new THREE.CubeCamera( 0.05, 50, this.mirrorRT );

		}

		const r = this.renderer, scene = this.scene, cam = this.mirrorCamera;
		const prev = { toneMapping: r.toneMapping, shadowAuto: r.shadowMap.autoUpdate, background: scene.background, env: scene.environment, clip: r.clippingPlanes };
		const hv = hide.map( o => o.visible ), ov = objects.map( o => o.visible ), li = lights.map( l => l.intensity );
		hide.forEach( o => o.visible = false );
		objects.forEach( o => o.visible = false );
		lights.forEach( l => l.intensity = 0 );
		r.toneMapping = THREE.NoToneMapping;
		r.shadowMap.autoUpdate = false;
		scene.background = null;
		const d = plane.distanceToPoint( viewer );
		cam.position.copy( viewer ).addScaledVector( plane.normal, - 2 * d );
		r.clippingPlanes = [ plane ];
		scene.add( cam );
		cam.update( r, scene );
		scene.remove( cam );
		r.clippingPlanes = prev.clip;
		this.mirrorTarget = this.pmrem.fromCubemap( this.mirrorRT.texture, this.mirrorTarget );
		hide.forEach( ( o, i ) => o.visible = hv[ i ] );
		objects.forEach( ( o, i ) => o.visible = ov[ i ] );
		lights.forEach( ( l, i ) => l.intensity = li[ i ] );
		r.toneMapping = prev.toneMapping;
		r.shadowMap.autoUpdate = prev.shadowAuto;
		scene.background = prev.background;
		scene.environment = prev.env;
		return this.mirrorTarget.texture;

	}

	dispose() {

		this.cubeRT.dispose();
		this.targets.forEach( t => t?.dispose() );
		this.specTarget?.dispose();
		this.mirrorTarget?.dispose();
		this.mirrorRT?.dispose();
		this.pmrem.dispose();

	}

}

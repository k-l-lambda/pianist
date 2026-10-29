// Real-time global illumination for the raster path:
// the lit room is captured into a cube map from the piano's position and prefiltered
// (PMREM) into scene.environment. Repeating the capture with the previous result
// applied adds one more diffuse/specular bounce each time.

import * as THREE from 'three';

export class GIProbe {

	constructor( renderer, scene, { size = 256 } = {} ) {

		this.renderer = renderer;
		this.scene = scene;
		this.cubeRT = new THREE.WebGLCubeRenderTarget( size, { type: THREE.HalfFloatType, generateMipmaps: false } );
		this.cubeCamera = new THREE.CubeCamera( 0.05, 50, this.cubeRT );
		this.pmrem = new THREE.PMREMGenerator( renderer );
		this.targets = [ null, null ];
		this.flip = 0;
		this.position = new THREE.Vector3( 0, 1.1, 1.0 );
		this.bounces = 2;
		this.intensity = 1;

	}

	/** `hide` lists objects to exclude from the capture (e.g. the piano itself). */
	update( hide = [] ) {

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

		scene.environmentIntensity = this.intensity;
		scene.remove( this.cubeCamera );
		hide.forEach( ( o, i ) => o.visible = visible[ i ] );
		r.toneMapping = prev.toneMapping;
		r.shadowMap.autoUpdate = prev.shadowAuto;
		r.shadowMap.needsUpdate = true;
		scene.background = prev.background;

		return scene.environment;

	}

	dispose() {

		this.cubeRT.dispose();
		this.targets.forEach( t => t?.dispose() );
		this.pmrem.dispose();

	}

}

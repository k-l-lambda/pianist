// Clear things (crystal, glass, acrylic: Luminara's ornaments, the crystal grand's case) with refraction
// and Fresnel in each mode:
//   transmission drawn (GI, the path tracer): three's transmission (refraction through `thickness` at
//     its `ior`, `dispersion`, the tint by attenuationColor / attenuationDistance and by the colour);
//     Fresnel comes with it (the refracted light weighted by 1 - F, the reflection by F); one-sided (three
//     draws a two-sided transmissive thing's back into its own transmission first: TRELLIS's mixed
//     winding refracted it into itself, milky)
//   no transmission (the fast real-time mode): alpha glass with Fresnel by hand (clearMaterial's shader):
//     what is seen through dimmed by 1 - F, the reflection (its specular, F already in it) added in full,
//     not faded with the body; a little haze (the body's lit colour) so it does not vanish face on; two-
//     sided (its back's reflections too)
// Marked userData.clear: no shadow (grand.js, luminara.js), not an occluder in Luminara's bake.

import * as THREE from 'three';
import { chainCompile } from './mirror.js';

/** A clear material (its mode set by setClearMode). `haze`: the body's share face on, without transmission. */
export function clearMaterial( { ior = 1.5, roughness = 0.02, thickness = 0.02, dispersion = 1, color = '#ffffff', tint = '#f6fbfb', attenuationDistance = 0.6, haze = 0.1, flatShading = false, ...extra } = {} ) {

	const m = new THREE.MeshPhysicalMaterial( { color, metalness: 0, roughness, ior, thickness, dispersion,
		attenuationColor: new THREE.Color( tint ), attenuationDistance, specularIntensity: 1, flatShading, side: THREE.DoubleSide, ...extra } );
	m.userData.clear = true;
	const U = { uClearF0: { value: ( ( ior - 1 ) / ( ior + 1 ) ) ** 2 }, uClearHaze: { value: haze } };
	chainCompile( m, shader => {

		Object.assign( shader.uniforms, U );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>\nuniform float uClearF0, uClearHaze;' )
			.replace( '#include <opaque_fragment>', `#ifdef USE_TRANSMISSION
				#include <opaque_fragment>
			#else
				float clearF = uClearF0 + ( 1.0 - uClearF0 ) * pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 5.0 );
				float clearHaze = uClearHaze * ( 1.0 - clearF );
				gl_FragColor = vec4( totalSpecular + ( outgoingLight - totalSpecular ) * clearHaze, clearF + clearHaze );
			#endif` );

	}, 'clearFresnel' );
	return m;

}

/** Refracting (`physical`: transmission drawn: GI, the path tracer) or the Fresnel alpha glass. */
export function setClearMode( m, physical ) {

	if ( ( m.transmission > 0 ) === physical && m.userData.clearSet ) return;
	m.userData.clearSet = true;
	m.transmission = physical ? 1 : 0;
	m.transparent = ! physical; m.depthWrite = physical; m.side = physical ? THREE.FrontSide : THREE.DoubleSide;
	// (off: premultiplied by hand in its shader, the reflection added, the back dimmed by its alpha)
	Object.assign( m, physical ? { blending: THREE.NormalBlending } : { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } );
	m.needsUpdate = true;

}

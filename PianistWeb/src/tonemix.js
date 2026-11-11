// A crossfade between two of three's tone mappings, for a lighting preset's fade from one that asks for a tone
// mapping (the Berlin hall's Recital: ACES) to one that does not (its Spotlight: the page's AgX). Switched at
// either end, the curve itself jumped: at the same light, ACES's midtones ~35 % below AgX's (Liebestraum, 4 s).
// Three's CustomToneMapping is replaced by a mix of the two, weighted by `toneMix` (a, b: 1 AgX, 2 ACES,
// 3 Neutral; t: b's weight); a renderer's OutputPass gets the uniform with withToneMix(). Imported before any
// program is compiled (main.js's first import).

import * as THREE from 'three';

export const TONE_ID = { AgX: 1, ACES: 2, Neutral: 3 };
export const toneMix = { value: new THREE.Vector3( 1, 1, 0 ) };

const CUSTOM = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
if ( chunk.includes( CUSTOM ) ) {

	THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace( CUSTOM, `uniform vec3 ptToneMix;
		vec3 ptToneOne( vec3 color, float k ) {
			return k < 1.5 ? AgXToneMapping( color ) : k < 2.5 ? ACESFilmicToneMapping( color ) : NeutralToneMapping( color );
		}
		vec3 CustomToneMapping( vec3 color ) { return mix( ptToneOne( color, ptToneMix.x ), ptToneOne( color, ptToneMix.y ), ptToneMix.z ); }` );

} else console.warn( 'tonemix: three\'s tone mapping chunk changed: tone mappings switch, not fade' );

/** `pass` (an OutputPass) with the mix's uniform. */
export function withToneMix( pass ) {

	pass.material.uniforms.ptToneMix = toneMix;		// (its material's uniforms are the pass's)
	return pass;

}

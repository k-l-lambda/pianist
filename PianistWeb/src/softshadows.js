// Percentage-closer soft shadows (PCSS) for the sun, patched into three's PCF shadow code.
//
// The sun's penumbra should grow with the distance between occluder and receiver: black keys
// a few millimetres above the white keys give crisp shadows, the window frame and leaves
// metres away give soft ones. three's PCF only reads the shadow map through a comparison
// sampler, so the blocker search probes it at several depth offsets ("is there an occluder
// at least Δ in front of me?") instead of averaging raw depths.
//
// Lights opt in by setting shadow.radius = 1000 + K, where K = (sun angular radius) /
// (angle of one shadow-map texel); every other light keeps the stock PCF filter.

import * as THREE from 'three';

const TEXEL = 'vec2 texelSize = vec2( 1.0 ) / shadowMapSize;';
const RADIUS = 'float radius = shadowRadius * texelSize.x;';
const PHI = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';

export function applyPCSS( { near, far } ) {

	const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
	if ( chunk.includes( 'PCSS_SUN' ) ) return;
	// the PCF filter's setup lines (comments may be stripped in the bundled build)
	const r = chunk.indexOf( RADIUS );
	const t = chunk.lastIndexOf( TEXEL, r );
	const p = chunk.indexOf( PHI, r );
	if ( r < 0 || t < 0 || p < 0 || chunk.indexOf( RADIUS, r + 1 ) >= 0 ) {

		console.warn( 'softshadows: three.js shadow chunk changed; PCSS not applied' );
		return;

	}

	const f = v => v.toFixed( 4 );
	const pcss = /* glsl */`
				// PCSS_SUN
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				#ifndef USE_REVERSED_DEPTH_BUFFER
				if ( shadowRadius > 999.0 ) {

					float K = shadowRadius - 1000.0;
					const float N = ${ f( near ) }, F = ${ f( far ) };
					float zr = shadowCoord.z;
					float dR = 2.0 * F * N / ( F + N - ( 2.0 * zr - 1.0 ) * ( F - N ) );

					// blocker search: occlusion fraction for occluders at least delta in front
					const float LEVELS[ 6 ] = float[]( 0.003, 0.012, 0.05, 0.2, 0.8, 3.0 );
					float occ[ 6 ];
					for ( int l = 0; l < 6; ++ l ) {

						float delta = LEVELS[ l ];
						// shadow-map depth of the distance dR - delta (perspective spot camera)
						float z = 0.5 * ( ( F + N - 2.0 * F * N / max( dR - delta, N ) ) / ( F - N ) ) + 0.5;
						float r = clamp( K * delta / dR, 1.0, 80.0 ) * texelSize.x;
						float s = 0.0;
						for ( int i = 0; i < 6; ++ i ) s += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 6, phi ) * r, z ) );
						occ[ l ] = 1.0 - s / 6.0;

					}

					// blocker distance: deepest level that still sees occluders, interpolated in log space
					float dB = 0.0;
					for ( int l = 0; l < 6; ++ l ) {

						if ( occ[ l ] > 0.02 ) {

							float next = l < 5 ? occ[ l + 1 ] : 0.0;
							float t = clamp( ( occ[ l ] - 0.02 ) / max( occ[ l ] - next, 1e-3 ), 0.0, 1.0 );
							float hi = l < 5 ? LEVELS[ l + 1 ] : LEVELS[ 5 ] * 2.0;
							dB = LEVELS[ l ] * pow( hi / LEVELS[ l ], t );

						}

					}

					// no occluder at any distance: lit. (Testing only the nearest level here would cut
					// off the outer half of far occluders' penumbrae, e.g. the leaves.)
					if ( dB == 0.0 ) return 1.0;

					// filter with the penumbra this blocker distance produces
					float pr = clamp( K * dB / max( dR - dB, 1.0 ), 0.75, 80.0 ) * texelSize.x;
					float sum = 0.0;
					for ( int i = 0; i < 24; ++ i ) sum += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 24, phi ) * pr, shadowCoord.z ) );
					return mix( 1.0, sum / 24.0, shadowIntensity );

				}
				#endif
				float radius = shadowRadius * texelSize.x;`;

	// replace texelSize / radius / phi setup; the PCSS block declares texelSize and phi itself
	THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice( 0, t ) + pcss + chunk.slice( p + PHI.length );

}

// Percentage-closer soft shadows (PCSS) for the sun, patched into three's PCF shadow code.
//
// The sun's penumbra should grow with the distance between occluder and receiver: black keys
// a few millimetres above the white keys give crisp shadows, the window frame and leaves
// metres away give soft ones — and where both fall on the same spot they must multiply
// (a sharp key shadow inside the frame's soft penumbra), not blend into one blur.
//
// So occluders are split into distance bands, each filtered with the penumbra size of its
// own distance, and the band visibilities are multiplied. three's PCF only reads the shadow
// map through a comparison sampler; "lit by band b" is estimated as the fraction of samples
// with no occluder beyond the band's near limit, among those with none beyond its far limit
// (the shadow map stores only the occluder nearest to the light per texel). Where a band is
// almost entirely hidden behind farther occluders, it is estimated on the next wider ring.
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
					float dR = 2.0 * F * N / ( F + N - ( 2.0 * shadowCoord.z - 1.0 ) * ( F - N ) );

					// bands of occluder distance in front of the receiver (m), a representative
					// distance for each band's penumbra, and sample counts
					const float E[ 6 ] = float[]( 0.0, 0.1, 0.4, 1.5, 4.0, 1e6 );
					const float REP[ 5 ] = float[]( 0.0, 0.2, 0.77, 2.45, 5.5 );
					const int NS[ 5 ] = int[]( 4, 6, 8, 12, 16 );

					// early out: most receivers are plainly lit or plainly in shadow (e.g. the walls
					// behind the window wall). Test the receiver point and a wide ring at its own
					// depth; only penumbrae run the banded search below.
					{

						// at least as wide as the farthest band's penumbra, so no penumbra pixel skips the search
						float rw = 1.25 * clamp( K * REP[ 4 ] / max( dR - REP[ 4 ], 1.0 ), 4.0, 80.0 ) * texelSize.x;
						float c = texture( shadowMap, shadowCoord.xyz );
						float ring = 0.0;
						for ( int i = 0; i < 16; ++ i ) ring += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 16, phi ) * rw, shadowCoord.z ) );
						if ( c < 0.5 && ring < 0.01 ) return mix( 1.0, 0.0, shadowIntensity );
						#ifdef KEY_SHADOW
						if ( c > 0.5 && ring > 15.99 ) return mix( 1.0, keyShadowVisibility(), shadowIntensity );
						#else
						if ( c > 0.5 && ring > 15.99 ) return 1.0;
						#endif

					}

					// per band: shadow-map depths of its limits dR - E (perspective spot camera; band 0
					// starts at the receiver), filter radius, and lit counts A (beyond near limit) /
					// B (beyond far limit) on its own sample ring
					float z0[ 5 ], z1[ 5 ], rt[ 5 ], A[ 5 ], B[ 5 ];
					for ( int b = 0; b < 5; ++ b ) {

						rt[ b ] = clamp( K * REP[ b ] / max( dR - REP[ b ], 1.0 ), 0.75, 80.0 ) * texelSize.x;
						z0[ b ] = b == 0 ? shadowCoord.z : 0.5 * ( ( F + N - 2.0 * F * N / max( dR - E[ b ], N ) ) / ( F - N ) ) + 0.5;
						z1[ b ] = 0.5 * ( ( F + N - 2.0 * F * N / max( dR - E[ b + 1 ], N ) ) / ( F - N ) ) + 0.5;
						int n = NS[ b ];
						float s0 = 0.0, s1 = 0.0;
						for ( int i = 0; i < 16; ++ i ) {

							if ( i >= n ) break;
							vec2 uv = shadowCoord.xy + vogelDiskSample( i, n, phi + float( b ) * 1.7 ) * rt[ b ];
							s0 += texture( shadowMap, vec3( uv, z0[ b ] ) );
							if ( b < 4 ) s1 += texture( shadowMap, vec3( uv, z1[ b ] ) );

						}

						A[ b ] = s0;
						B[ b ] = s1;

					}

					float vis = A[ 4 ] / float( NS[ 4 ] );
					for ( int b = 3; b >= 0; -- b ) {

						// fraction lit by this band among samples not hidden behind farther occluders.
						// Where its own ring is (mostly) hidden — e.g. the piano behind the leaves, seen
						// from the sun — move outward ring by ring until the band shows through the
						// gaps. The band's visibility is the average over what the rings did see; only
						// if no ring sees it at all is it taken as clear (farther bands carry the shadow).
						float v = 0.0, remaining = 1.0;
						for ( int r = b; r < 5; ++ r ) {

							float c, d;
							if ( r == b ) {

								c = A[ b ];
								d = B[ b ];

							} else {

								int n = NS[ r ];
								c = 0.0;
								d = 0.0;
								for ( int i = 0; i < 16; ++ i ) {

									if ( i >= n ) break;
									vec2 uv = shadowCoord.xy + vogelDiskSample( i, n, phi + float( r ) * 1.7 ) * rt[ r ];
									c += texture( shadowMap, vec3( uv, z0[ b ] ) );
									if ( r > b + 1 ) d += texture( shadowMap, vec3( uv, z1[ b ] ) );

								}

								// ring b+1 at our far limit is that ring's own near-limit count
								if ( r == b + 1 ) d = A[ b + 1 ];

							}

							float w = smoothstep( 0.25, 1.5, d ) * remaining;
							v += w * clamp( c / max( d, 1e-4 ), 0.0, 1.0 );
							remaining -= w;
							if ( remaining < 0.01 ) break;

						}

						float seen = 1.0 - remaining;
						v = mix( 1.0, v / max( seen, 1e-4 ), smoothstep( 0.0, 0.1, seen ) );
						vis *= v;
						if ( vis < 0.004 ) break;
						#ifdef KEY_SHADOW
						// nearest band (black keys, arms) comes from the keyboard's own map below
						if ( b == 1 ) break;
						#endif

					}

					#ifdef KEY_SHADOW
					vis *= keyShadowVisibility();
					#endif
					return mix( 1.0, vis, shadowIntensity );

				}
				#endif
				float radius = shadowRadius * texelSize.x;`;

	// replace texelSize / radius / phi setup; the PCSS block declares texelSize and phi itself
	let patched = chunk.slice( 0, t ) + pcss + chunk.slice( p + PHI.length );

	// materials with KEY_SHADOW (the keys) also read the keyboard's own sun map (keyshadow.js)
	const PCF_FN = 'float getShadow( sampler2DShadow shadowMap,';
	const keyFn = /* glsl */`
		#ifdef KEY_SHADOW
			uniform sampler2DShadow keyShadowMap;
			uniform vec2 keyShadowRadius;
			uniform float keyShadowBias;
			varying vec4 vKeyShadowCoord;
			float keyShadowVisibility() {
				vec3 c = vKeyShadowCoord.xyz / vKeyShadowCoord.w * 0.5 + 0.5;
				if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
				float ph = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				float s = 0.0;
				for ( int i = 0; i < 8; ++ i ) s += texture( keyShadowMap, vec3( c.xy + vogelDiskSample( i, 8, ph ) * keyShadowRadius, c.z - keyShadowBias ) );
				return s / 8.0;
			}
		#endif
		`;
	const fnAt = patched.indexOf( PCF_FN );
	if ( fnAt >= 0 ) patched = patched.slice( 0, fnAt ) + keyFn + patched.slice( fnAt );
	else console.warn( 'softshadows: PCF getShadow not found; key shadows not applied' );
	THREE.ShaderChunk.shadowmap_pars_fragment = patched;

}

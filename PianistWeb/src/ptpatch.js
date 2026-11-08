// Two changes to three-gpu-pathtracer's (0.0.27) path-tracing shader, made to its source text at run time
// (each replacement checked: the patch is left out, with a warning, if the library's text has changed):
//
//   light selection by power   next-event estimation picked one light uniformly (or the environment, as one
//                              more light). With Luminara's lines of light as area lights (a few hundred:
//                              src/luminara.js ptLights) the environment and the few strong lights (the
//                              dome's spots, the sun) were each sampled 1 time in N. Now the environment is
//                              picked with a fixed share (`lightsShare` the lights', the rest the
//                              environment's), and a light by its power (mixed with a uniform part, so a
//                              faint one near the camera still gets samples): a CDF in a small texture.
//   camera-only emission       a material with castShadow false (a fixture whose light an area light stands
//                              in for: ptLights) emits only to rays from the camera (or through glass); a
//                              bounce finds its light through the area light, not twice. Such a mesh is
//                              no occluder either (castShadow false: the library's own meaning).

import * as THREE from 'three';
import { getLights } from 'three-gpu-pathtracer/src/core/utils/sceneUpdateUtils.js';

const POWER_MIX = 0.75;		// (the power-weighted part of a light's pick; the rest uniform)

function patchShader( fs ) {

	const edits = [
		// the CDF's declarations, before the light sampling (and the share beside lightsDenom)
		[ 'float lightsDenom;', `float lightsDenom;
			float ptLightsShare;
			uniform sampler2D ptLightCdf;		// ( cdf, p ) per light, in the lights' order
			uniform float ptLightsShareSet;
			uniform uint ptCdfCount;
			// (the CDF has as many bins as the lights uploaded: updateLights; the lights' own struct is declared later)
			float ptLightProb( uint l ) { return texelFetch( ptLightCdf, ivec2( int( l ), 0 ), 0 ).y; }
			uint ptPickLight( float u ) {
				uint lo = 0u, hi = max( ptCdfCount, 1u ) - 1u;
				for ( int k = 0; k < 16 && lo < hi; k ++ ) { uint mid = ( lo + hi ) / 2u; if ( texelFetch( ptLightCdf, ivec2( int( mid ), 0 ), 0 ).x > u ) hi = mid; else lo = mid + 1u; }
				return lo;
			}` ],
		// the pick: by the CDF
		[ 'uint l = uint( ruv.x * float( lightCount ) );', 'uint l = ptPickLight( ruv.x );' ],
		// the share: lights or the environment
		[ 'if( lightsDenom != 0.0 && rand( 5 ) < float( lights.count ) / lightsDenom ) {', 'if( lightsDenom != 0.0 && rand( 5 ) < ptLightsShare ) {' ],
		// the pdfs: the light's pick and the share, the environment's share
		[ 'float lightPdf = lightRec.pdf / lightsDenom;', 'float lightPdf = lightRec.pdf * ptLightsShare * ptLightProb( ptPickLight( pickU ) );' ],
		[ 'LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, rand3( 6 ) );', 'vec3 pickR = rand3( 6 ); float pickU = pickR.x;\n			LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, pickR );' ],
		[ 'float misWeight = misHeuristic( scatterRec.pdf, lightRec.pdf / lightsDenom );', 'float misWeight = misHeuristic( scatterRec.pdf, lightRec.pdf * ptLightsShare * ptLightProb( i ) );' ],
		// the share, set where lightsDenom is
		[ /lightsDenom =\s*\(\s*environmentIntensity == 0\.0 \|\| envMapInfo\.totalSum == 0\.0 \) && lights\.count != 0u \?\s*float\( lights\.count \) :\s*float\( lights\.count \+ 1u \);/,
			`$&
					ptLightsShare = lights.count == 0u ? 0.0 : ( environmentIntensity == 0.0 || envMapInfo.totalSum == 0.0 ) ? 1.0 : ptLightsShareSet;` ],
		// camera-only emission for a fixture an area light stands in for (castShadow false)
		[ 'scatterRec = bsdfSample( - ray.direction, surf );', 'bool ptSeenDirectly = state.firstRay || state.transmissiveRay;\n						scatterRec = bsdfSample( - ray.direction, surf );' ],
		[ 'gl_FragColor.rgb += ( surf.emission * state.throughputColor );', 'if ( material.castShadow || ptSeenDirectly ) gl_FragColor.rgb += ( surf.emission * state.throughputColor );' ],
	];
	for ( const [ from, to ] of edits ) {

		const n = typeof from === 'string' ? fs.split( from ).length - 1 : ( fs.match( new RegExp( from.source, 'g' ) ) ?? [] ).length;
		if ( n !== 1 ) throw new Error( `ptpatch: ${ String( from ).slice( 0, 60 ) }… found ${ n } times` );
		fs = fs.replace( from, to );

	}
	// the environment's pdfs: its share (two places)
	const env = fs.split( 'envPdf /= lightsDenom;' ).length - 1;
	if ( env !== 2 ) throw new Error( `ptpatch: envPdf /= lightsDenom found ${ env } times` );
	fs = fs.split( 'envPdf /= lightsDenom;' ).join( 'envPdf *= 1.0 - ptLightsShare;' );
	// the selection's pdf: randomLightSample's record times its pick's probability (the light's own pdf: the area's)
	return patchAOV( fs );

}

/**
 * The denoiser's buffers (ptdenoise.js), with PT_AOV 1: four more outputs beside the colour, averaged by the
 * same blending (each its alpha the colour's), at the first non-delta surface along the camera path (through
 * glass and near-mirrors: what is seen in them):
 *   1 ptAlbedo   that surface's albedo (diffuse + a specular share, floored) times the path's throughput to it
 *   2 ptNormal   its shading normal (world) and its distance along the path
 *   3 ptDirect   what is not its reflected light: lights and sky seen directly or through delta surfaces,
 *                specular hits on the way, its own emission: added back unfiltered
 *   4 ptStats    the demodulated illumination's luminance and its square (the variance), the count of
 *                samples that found such a surface
 * The rest (colour − direct) / albedo is the illumination the filter smooths.
 */
function patchAOV( fs ) {

	const edits = [
		[ 'float lightsDenom;', `float lightsDenom;
				#if PT_AOV
				layout( location = 1 ) out highp vec4 ptAlbedo;
				layout( location = 2 ) out highp vec4 ptNormal;
				layout( location = 3 ) out highp vec4 ptDirect;
				layout( location = 4 ) out highp vec4 ptStats;
				#endif` ],
		[ 'gl_FragColor = vec4( 0, 0, 0, 1 );', `gl_FragColor = vec4( 0, 0, 0, 1 );
					// the first non-delta surface: not yet found; its albedo, normal, path distance; the light before it
					bool aovSet = false, aovSkip = false;
					vec3 aovAlbedo = vec3( 0.0 ), aovNormal = vec3( 0.0 ), aovPre = vec3( 0.0 ), aovPost = vec3( 0.0 ), aovEmit = vec3( 0.0 );
					float aovDist = 0.0, aovPath = 0.0;` ],
		// at a surface, before its next-event estimation: is it the first non-delta one?
		[ '// next event estimation\n', `// (the denoiser's buffers: the first surface that is not glass or a near-mirror)
						aovPath += surfaceHit.dist;
						bool aovMark = false;
						if ( ! aovSet && ! aovSkip ) {

							float dl = luminance( surf.color ) * ( 1.0 - surf.metalness ) * ( 1.0 - surf.transmission );
							bool delta = surf.transmission > 0.5 || ( surf.roughness < 0.08 && ( surf.metalness > 0.5 || dl < 0.1 ) );
							// seen through a dim mirror (the black screen: ~4 % Fresnel): left unfiltered. Its samples' illumination
							// over so small an albedo varies widely with the lobe each takes, the variance with it, and the filter
							// smeared the reflection; dim, its own noise shows little. Bright glass (the strings behind the
							// cabinet's) stays filtered
							if ( ! delta && luminance( state.throughputColor ) < 0.5 ) aovSkip = true;
							else if ( ! delta || i == bounces - 1 ) {

								vec3 spec = mix( vec3( 0.04 ), surf.color, surf.metalness ) + vec3( 0.04 * surf.clearcoat );
								vec3 alb = surf.color * ( 1.0 - surf.metalness ) * ( 1.0 - surf.transmission ) + spec;
								aovAlbedo = state.throughputColor * max( alb, vec3( 0.02 ) );
								aovNormal = surf.normal;
								aovDist = aovPath;
								aovPre = gl_FragColor.rgb;
								aovSet = true;
								aovMark = true;

							}

						}
						// next event estimation
` ],
		// after it: the colour so far (to take the surface's own emission out as direct)
		[ 'gl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );\n\n						#endif',
			`gl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );

						#endif
						if ( aovMark ) aovPost = gl_FragColor.rgb;` ],
		[ 'if ( material.castShadow || ptSeenDirectly ) gl_FragColor.rgb += ( surf.emission * state.throughputColor );',
			`if ( material.castShadow || ptSeenDirectly ) gl_FragColor.rgb += ( surf.emission * state.throughputColor );
						if ( aovMark ) aovEmit = gl_FragColor.rgb - aovPost;` ],
		[ 'gl_FragColor.a *= opacity;', `gl_FragColor.a *= opacity;
					#if PT_AOV
					{

						// direct: before the surface, plus its own emission; illumination: the rest over the albedo
						vec3 direct = aovSet ? aovPre + aovEmit : gl_FragColor.rgb;
						vec3 illum = aovSet ? max( gl_FragColor.rgb - direct, vec3( 0.0 ) ) / aovAlbedo : vec3( 0.0 );
						float l = luminance( illum );
						float a = gl_FragColor.a;
						ptAlbedo = vec4( aovSet ? aovAlbedo : vec3( 0.0 ), a );
						ptNormal = vec4( aovNormal * 0.5 + 0.5, a );		// (averaged encoded: decoded and renormalised by the filter)
						ptDirect = vec4( direct, a );
						ptStats = vec4( l, l * l, aovSet ? aovDist : 0.0, a );
						if ( any( isnan( ptStats ) ) || any( isinf( ptStats ) ) ) ptStats = vec4( 0.0, 0.0, 0.0, a );

					}
					#endif` ],
	];
	for ( const [ from, to ] of edits ) {

		const n = fs.split( from ).length - 1;
		if ( n !== 1 ) throw new Error( `ptpatch (AOV): ${ from.slice( 0, 60 ) }… found ${ n } times` );
		fs = fs.replace( from, to );

	}
	return fs;

}

/** A light's power, roughly (its selection weight): an area light's radiance × area × π, a spot's cone, a point's sphere. */
function power( l ) {

	const c = l.color, lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, I = l.intensity * lum;
	if ( l.isRectAreaLight ) return I * l.width * l.height * Math.PI * ( l.isCircular ? Math.PI / 4 : 1 );
	if ( l.isSpotLight ) return I * 2 * Math.PI * ( 1 - Math.cos( l.angle ) );
	if ( l.isPointLight ) return I * 4 * Math.PI;
	if ( l.isDirectionalLight || l.isSunLight ) return I * 4;		// (as a 4 m² patch of light)
	return I;

}

/**
 * Patch `pt` (a WebGLPathTracer): its path-tracing materials' shaders (the main and the low-res one), and its
 * updateLights() (the CDF built from the lights it uploads). `share`: the lights' share of next-event samples
 * when there is an environment too. Returns false (unpatched, a warning) if the library's text has changed.
 */
export function patchPathTracer( pt, { share = 0.5 } = {} ) {

	const mats = [ pt._pathTracer.material, pt._lowResPathTracer.material ];
	let patched;
	try {

		patched = patchShader( mats[ 0 ].fragmentShader );

	} catch ( e ) {

		console.warn( `${ e.message }: the path tracer left as it is (uniform light selection)` );
		return false;

	}
	// the CDF: a new texture whenever the number of lights changes (three allocates a texture's storage once,
	// at its first upload, immutable: a larger image after that is not uploaded, the old size kept, and the
	// pick read past its end: with a light more than at the first build, the room's sun went dark; two more,
	// the image black)
	const makeCdf = ( data, n ) => Object.assign( new THREE.DataTexture( data, n, 1, THREE.RGFormat, THREE.FloatType ), { needsUpdate: true } );
	let cdf = makeCdf( new Float32Array( [ 1, 1 ] ), 1 );
	for ( const m of mats ) {

		m.fragmentShader = patched;
		Object.assign( m.uniforms, { ptLightCdf: { value: cdf }, ptLightsShareSet: { value: share }, ptCdfCount: { value: 0 } } );
		m.defines.PT_AOV = 0;
		m.needsUpdate = true;

	}
	const update = pt.updateLights.bind( pt );
	pt.updateLights = () => {

		update();
		const lights = getLights( pt.scene );		// (as the path tracer uploads them: visible, by uuid)
		const w = lights.map( power ), sum = w.reduce( ( a, b ) => a + b, 0 ), n = lights.length;
		const data = new Float32Array( Math.max( n, 1 ) * 2 );
		let acc = 0;
		for ( let i = 0; i < n; ++ i ) {

			const p = POWER_MIX * ( sum > 0 ? w[ i ] / sum : 1 / n ) + ( 1 - POWER_MIX ) / n;
			acc += p;
			data[ 2 * i ] = acc; data[ 2 * i + 1 ] = p;

		}
		if ( n ) data[ 2 * ( n - 1 ) ] = 1;		// (the last bin closed: rounding)
		// the lights' share against the environment: `share`, unless the venue says its environment is faint
		// (scene.userData.ptEnvPower under a tenth of the lights': Luminara's sky at night): then 0.85. (By the
		// powers' ratio the afternoon's window light got 22 %: a spot's power all lands on the piano, the
		// window's spreads over the room, and the room is what the image shows)
		const env = pt.scene.userData?.ptEnvPower;
		const lightsShare = env !== undefined && sum > 0 && env < 0.1 * sum ? 0.85 : share;
		for ( const m of mats ) m.uniforms.ptLightsShareSet.value = lightsShare;
		pt.lightsShareNow = lightsShare;
		if ( cdf.image.width === Math.max( n, 1 ) ) { cdf.image.data = data; cdf.needsUpdate = true; } else {

			cdf.dispose();
			cdf = makeCdf( data, Math.max( n, 1 ) );

		}
		for ( const m of mats ) { m.uniforms.ptLightCdf.value = cdf; m.uniforms.ptCdfCount.value = n; }

	};
	pt.lightsShare = v => { for ( const m of mats ) m.uniforms.ptLightsShareSet.value = v; pt.reset(); };
	// the denoiser's buffers (patchAOV): the main path tracer's target with 5 attachments and PT_AOV 1 (a
	// recompile: switched only when asked otherwise, and left so); its textures: colour, albedo, normal, direct, stats
	const R = pt._pathTracer, single = R._primaryTarget;
	let multi = null;
	pt.setAOV = on => {

		if ( !! on === !! pt.aovOn ) return;
		if ( on ) {

			multi ??= new THREE.WebGLRenderTarget( 1, 1, { count: 5, format: THREE.RGBAFormat, type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false } );
			multi.setSize( single.width, single.height );
			R._primaryTarget = multi;

		} else R._primaryTarget = single;
		R.material.defines.PT_AOV = on ? 1 : 0;
		R.material.needsUpdate = true;
		pt.aovOn = !! on;
		R.reset();

	};
	pt.aovTextures = () => pt.aovOn ? multi.textures : null;
	return true;

}

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
	return true;

}

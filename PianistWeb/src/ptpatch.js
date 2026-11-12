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
//   the open sea               (patchSea) a venue's sea as an analytic height field (src/ocean.js's FFT, its
//                              own copy for the path tracer), intersected in traceScene beside the BVH: a
//                              water surface (ior 1.333, GGX), its body as the raster's; the sun or the moon
//                              a directional light with a disc (cone sampling, MIS with the BSDF).

import * as THREE from 'three';
import { getLights } from 'three-gpu-pathtracer/src/core/utils/sceneUpdateUtils.js';
import { OCEAN_PT_GLSL, CASCADES } from './ocean.js';

// one sample's light after the first rough surface, capped (its luminance; 0: off; ?ptclamp= to try others): see patchAOV
// ?ptsea=0: the path tracer's shader without the sea (patchSea): to tell a GPU / driver that cannot compile it
const SEA_PATCH = typeof location === 'undefined' || new URLSearchParams( location.search ).get( 'ptsea' ) !== '0';
// one spot / point light sample's direct light, capped (its luminance; 0: off; ?ptdclamp= to try others): see patchShader
const DIRECT_MAX = ( () => { const v = typeof location !== 'undefined' ? new URLSearchParams( location.search ).get( 'ptdclamp' ) : null; return v !== null && Number.isFinite( Number( v ) ) ? Number( v ) : 256; } )();
const INDIRECT_MAX = ( () => { const v = typeof location !== 'undefined' ? new URLSearchParams( location.search ).get( 'ptclamp' ) : null; return v !== null && Number.isFinite( Number( v ) ) ? Number( v ) : 64; } )();

const POWER_MIX = 0.75;		// (the power-weighted part of a light's pick; the rest uniform)

function patchShader( fs ) {

	const edits = [
		// the CDF's declarations, before the light sampling (and the share beside lightsDenom)
		[ 'float lightsDenom;', `float lightsDenom;
			float ptLightsShare;
			uniform float ptLightsShareSet, ptDirectMax;
			uniform uint ptCdfCount, ptCdfOffset;
			// the CDF: ( cdf, p ) per light, in the lights' order, in the lights' own texture after their data
			// (texel ptCdfOffset + l: updateLights). Not a sampler of its own: the shader already has the 16 a
			// fragment shader may have on many GPUs (MAX_TEXTURE_IMAGE_UNITS); one more and it does not compile
			vec2 ptCdfAt( sampler2D t, uint l ) { return texelFetch1D( t, ptCdfOffset + l ).xy; }
			float ptLightProb( sampler2D t, uint l ) { return ptCdfAt( t, l ).y; }
			uint ptPickLight( sampler2D t, float u ) {
				uint lo = 0u, hi = max( ptCdfCount, 1u ) - 1u;
				for ( int k = 0; k < 16 && lo < hi; k ++ ) { uint mid = ( lo + hi ) / 2u; if ( ptCdfAt( t, mid ).x > u ) hi = mid; else lo = mid + 1u; }
				return lo;
			}` ],
		// no IES profiles (no venue has an IES light): their sampler out of the shader, a spot's photometric
		// attenuation 1 (the 16-sampler limit, as the CDF above)
		[ 'uniform sampler2DArray iesProfiles;', '' ],
		[ /float getPhotometricAttenuation\( sampler2DArray iesProfiles, int iesProfile, vec3 posToLight, vec3 lightDir, vec3 u, vec3 v \) \{[\s\S]*?return texture2D\( iesProfiles, vec3\( angle, 0\.0, iesProfile \) \)\.r;\s*\}/,
			'float getPhotometricAttenuation( int iesProfile, vec3 posToLight, vec3 lightDir, vec3 u, vec3 v ) { return 1.0; }' ],
		[ 'LightRecord randomSpotLightSample( Light light, sampler2DArray iesProfiles, vec3 rayOrigin, vec2 ruv ) {', 'LightRecord randomSpotLightSample( Light light, vec3 rayOrigin, vec2 ruv ) {' ],
		[ 'getPhotometricAttenuation( iesProfiles, light.iesProfile,', 'getPhotometricAttenuation( light.iesProfile,' ],
		[ 'LightRecord randomLightSample( sampler2D lights, sampler2DArray iesProfiles, uint lightCount, vec3 rayOrigin, vec3 ruv ) {', 'LightRecord randomLightSample( sampler2D lights, uint lightCount, vec3 rayOrigin, vec3 ruv ) {' ],
		[ 'result = randomSpotLightSample( light, iesProfiles, rayOrigin, ruv.yz );', 'result = randomSpotLightSample( light, rayOrigin, ruv.yz );' ],
		// one spot / point light sample's direct light capped at ptDirectMax in luminance (Cycles' clamp direct). Their
		// discs (radius 0.25-0.35 m: soft shadows) are sampled but never hit (misWeight 1, no MIS): on a glossy surface
		// (the lacquer, brass, the keys, the gilt) a rare point of the disc in the lobe's peak brought ~1000x a pixel's
		// light in one sample of 2048, a flash the bloom spread over the frame for a frame (the indirect cap is after
		// the first rough surface; this was its own direct light)
		[ /(\n(\s*)result = attenuatedColor \* lightRec\.emission[^\n]*misWeight \/ lightPdf;)/,
			`$1
$2if ( ptDirectMax > 0.0 && ( lightRec.type == SPOT_LIGHT_TYPE || lightRec.type == POINT_LIGHT_TYPE ) ) { float ptL = luminance( result ); if ( ptL > ptDirectMax ) result *= ptDirectMax / ptL; }` ],
		// the pick: by the CDF
		[ 'uint l = uint( ruv.x * float( lightCount ) );', 'uint l = ptPickLight( lights, ruv.x );' ],
		// the share: lights or the environment
		[ 'if( lightsDenom != 0.0 && rand( 5 ) < float( lights.count ) / lightsDenom ) {', 'if( lightsDenom != 0.0 && rand( 5 ) < ptLightsShare ) {' ],
		// the pdfs: the light's pick and the share, the environment's share
		[ 'float lightPdf = lightRec.pdf / lightsDenom;', 'float lightPdf = lightRec.pdf * ptLightsShare * ptLightProb( lights.tex, ptPickLight( lights.tex, pickU ) );' ],
		[ 'LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, rand3( 6 ) );', 'vec3 pickR = rand3( 6 ); float pickU = pickR.x;\n			LightRecord lightRec = randomLightSample( lights.tex, lights.count, rayOrigin, pickR );' ],
		[ 'float misWeight = misHeuristic( scatterRec.pdf, lightRec.pdf / lightsDenom );', 'float misWeight = misHeuristic( scatterRec.pdf, lightRec.pdf * ptLightsShare * ptLightProb( lights.tex, i ) );' ],
		// the share, set where lightsDenom is
		[ /lightsDenom =\s*\(\s*environmentIntensity == 0\.0 \|\| envMapInfo\.totalSum == 0\.0 \) && lights\.count != 0u \?\s*float\( lights\.count \) :\s*float\( lights\.count \+ 1u \);/,
			`$&
					ptLightsShare = lights.count == 0u ? 0.0 : ( environmentIntensity == 0.0 || envMapInfo.totalSum == 0.0 ) ? 1.0 : ptLightsShareSet;` ],
		// camera-only emission for a fixture an area light stands in for (castShadow false)
		// a normal-mapped surface's shading normal turned away from the view (a ripple's far side seen grazing): bent
		// back until the view is just above it. Else the BSDF, in the normal's frame, saw the view from below: its
		// samples rejected (isDirectionValid), the pool's far half in dark patches growing with the normal map's
		// strength (the usual fix, as other renderers')
		[ 'scatterRec = bsdfSample( - ray.direction, surf );', `bool ptSeenDirectly = state.firstRay || state.transmissiveRay;
						if ( material.normalMap != - 1 ) {

							vec3 ptV = - ray.direction;
							vec3 ptGN = surf.faceNormal * surfaceHit.side;
							float ptD = dot( surf.normal, ptV ), ptG = dot( ptGN, ptV );
							if ( ptG > 0.0 && ptD < 0.25 * ptG ) surf.normal = normalize( surf.normal + ( 0.25 * ptG - ptD ) * ptV );
							// and its mirror direction kept above the surface too (at a grazing view a ripple's slope sent it
							// below: the sample rejected, a dark patch): turned towards the geometric normal until it is
							for ( int k = 0; k < 4 && ptG > 0.0 && dot( reflect( - ptV, surf.normal ), ptGN ) < 0.05 * ptG; k ++ ) surf.normal = normalize( mix( surf.normal, ptGN, 0.5 ) );

						}
						scatterRec = bsdfSample( - ray.direction, surf );` ],
		// a refracted ray through a normal-mapped clear surface (a ripple): valid by the true surface alone. It may lie on
		// the wrong side of the tilted shading normal while truly passing through: the path was dropped, black: the
		// pool's patches, even with no absorption
		[ 'if ( scatterRec.pdf <= 0.0 || ! isDirectionValid( scatterRec.direction, surf.normal, surf.faceNormal ) ) {',
			'if ( scatterRec.pdf <= 0.0 || ( ! isDirectionValid( scatterRec.direction, surf.normal, surf.faceNormal ) && ! ( material.normalMap != - 1 && surf.transmission > 0.0 ) ) ) {' ],
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

/** The sea's and the disc's uniforms (patchSea): their defaults, none (a venue sets scene.userData.ptSea / ptSun). */
function seaUniforms() {

	const tex = new THREE.DataArrayTexture( new Uint16Array( 4 * CASCADES.length ), 1, 1, CASCADES.length );
	Object.assign( tex, { format: THREE.RGBAFormat, type: THREE.HalfFloatType, needsUpdate: true } );
	return {
		ptSeaOn: { value: 0 }, ptSeaY: { value: 0 }, ptSeaPhotoDep: { value: 0.012 }, ptSeaExtScale: { value: 1 }, ptSunOmc: { value: 0 },
		ptSeaHole: { value: new THREE.Vector3( 0, 0, 0 ) }, ptSeaColor: { value: new THREE.Color( 0, 0, 0 ) }, ptSeaExt: { value: new THREE.Vector3() },
		ptSeaTint: { value: new THREE.Color( 1, 1, 1 ) }, ptSunSeaGain: { value: new THREE.Vector3( 1, 1, 1 ) }, ptSeaVis: { value: 25 },
		ptOcTex: { value: tex }, ptOcRot: { value: CASCADES.map( () => new THREE.Vector4( 1, 0, 1, 0 ) ) }, ptOcSlab: { value: 0.05 }, ptOcAlpha: { value: 0.004 },
	};

}

/**
 * The open sea (scene.userData.ptSea, a venue's: src/azurea.js) and the sun's disc (scene.userData.ptSun):
 *   traceScene   the BVH's hit, or the sea's if nearer: the plane y = ptSeaY plus the FFT height (src/ocean.js),
 *                marched in its slab (± ptOcSlab: ~4.5 σ of the height; 24 steps, 10 bisections), not inside
 *                the venue's own water (ptSeaHole: a disc, the pool and the lobby); its normal the slopes'
 *   the surface  water: a GGX mirror (metalness 1 over F0 0.0204 of n 1.333: all its samples the reflection; its
 *                roughness the cascades' unresolved slopes), its body (the light from below the surface) as the
 *                raster's drawn sea (the same colour, extinction and tint: src/azurea.js), × ( 1 − Fresnel )
 *   occlusion    a shadow ray that meets the sea is blocked (the sun below the crests)
 *   the disc     a directional light with ptSunOmc > 0 (1 − cos of its angular radius): sampled in its cone,
 *                hit by rays in it (MIS); its light after a sea bounce × ptSunSeaGain (the raster's own glitter
 *                strength: the art's, not the photometric ratio)
 */
function patchSea( fs ) {

	const edits = [
		[ 'float lightsDenom;', `float lightsDenom;
				uniform float ptSeaOn, ptSeaY, ptSeaPhotoDep, ptSeaExtScale, ptSunOmc, ptSeaVis;
				float ptSeaAirT = 1.0; vec3 ptSeaAirL = vec3( 0.0 );		// (the air from the eye to the sea hit: its transmittance, its light)
				uniform vec3 ptSeaHole, ptSeaColor, ptSeaExt, ptSeaTint, ptSunSeaGain;
				bool ptSeaHit = false, ptLastSea = false;
				vec3 ptSeaN = vec3( 0.0, 1.0, 0.0 );
				${ OCEAN_PT_GLSL }` ],
		[ '#define NO_HIT 0', `// the sea: where the ray meets it (its distance, or -1), ptSeaN its normal there
				float ptSeaIntersect( vec3 ro, vec3 rd, float maxDist ) {
					if ( ptSeaOn < 0.5 || rd.y > - 1e-5 ) return - 1.0;
					float top = ptSeaY + ptOcSlab, bot = ptSeaY - ptOcSlab;
					float s0 = max( ( top - ro.y ) / rd.y, 0.0 ), s1 = ( bot - ro.y ) / rd.y;
					if ( s1 <= 0.0 || s0 >= maxDist ) return - 1.0;
					// (far off, the cascades' coordinates lose their fraction in single precision: a flat sea there)
					if ( s0 > 4000.0 ) {
						float s = ( ptSeaY - ro.y ) / rd.y;
						if ( s >= maxDist ) return - 1.0;
						ptSeaN = vec3( 0.0, 1.0, 0.0 ); return s;
					}
					s1 = min( s1, maxDist );
					float a = s0;
					vec3 p = ro + rd * a;
					float fa = p.y - ( ptSeaY + ptOceanHeight( p.xz ) );
					if ( fa < 0.0 ) return - 1.0;		// (starting under it: no hit, the ray leaves)
					float b = - 1.0;
					const int STEPS = 24;
					for ( int k = 1; k <= STEPS; k ++ ) {
						float s = s0 + ( s1 - s0 ) * float( k ) / float( STEPS );
						p = ro + rd * s;
						float f = p.y - ( ptSeaY + ptOceanHeight( p.xz ) );
						if ( f < 0.0 ) { b = s; break; }
						a = s;
					}
					if ( b < 0.0 ) return - 1.0;
					for ( int k = 0; k < 10; k ++ ) {
						float m = 0.5 * ( a + b );
						p = ro + rd * m;
						if ( p.y - ( ptSeaY + ptOceanHeight( p.xz ) ) < 0.0 ) b = m; else a = m;
					}
					float s = 0.5 * ( a + b );
					p = ro + rd * s;
					if ( distance( p.xz, ptSeaHole.xy ) < ptSeaHole.z ) return - 1.0;		// (the venue's own water and floors)
					vec3 o = ptOceanSample( p.xz );
					ptSeaN = normalize( vec3( - o.x, 1.0, - o.y ) );
					return s;
				}

				#define NO_HIT 0` ],
		// the scene's hit, or the sea's
		[ 'bool hit = bvhIntersectFirstHit( bvh, ray.origin, ray.direction, surfaceHit.faceIndices, surfaceHit.faceNormal, surfaceHit.barycoord, surfaceHit.side, surfaceHit.dist );',
			`bool hit = bvhIntersectFirstHit( bvh, ray.origin, ray.direction, surfaceHit.faceIndices, surfaceHit.faceNormal, surfaceHit.barycoord, surfaceHit.side, surfaceHit.dist );
			ptSeaHit = false;
			{
				float sd = ptSeaIntersect( ray.origin, ray.direction, hit ? surfaceHit.dist : INFINITY );
				if ( sd > 0.0 ) {
					hit = true; ptSeaHit = true;
					surfaceHit.dist = sd; surfaceHit.faceNormal = ptSeaN; surfaceHit.side = 1.0;
					surfaceHit.faceIndices = uvec4( 0u ); surfaceHit.barycoord = vec3( 1.0, 0.0, 0.0 );
				}
			}` ],
		// a shadow ray: the sea blocks it
		[ '} else if ( hitType == SURFACE_HIT ) {\n\n				float totalDist = distance( startPoint, ray.origin + ray.direction * surfaceHit.dist );',
			`} else if ( hitType == SURFACE_HIT ) {

				if ( ptSeaHit ) { result = distance( startPoint, ray.origin + ray.direction * surfaceHit.dist ) <= rayDist; break; }
				float totalDist = distance( startPoint, ray.origin + ray.direction * surfaceHit.dist );` ],
		// the main loop: the sea's hit has no material of its own (face 0's read): an opaque, plain one
		[ 'uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;\n						Material material = readMaterialInfo( materials, materialIndex );\n\n						#if FEATURE_FOG',
			`uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );
						if ( ptSeaHit ) {

							material.matte = false; material.castShadow = true; material.fogVolume = false; material.normalMap = - 1;
							material.transparent = false; material.alphaTest = 0.0; material.side = 0.0; material.transmission = 0.0;

						}

						#if FEATURE_FOG` ],
		[ 'SurfaceRecord surf;\n', 'ptLastSea = ptSeaHit;\n						SurfaceRecord surf;\n' ],
		// the air before a sea hit (ptSeaSurface: ptSeaAirT, ptSeaAirL): its light added, all that follows (the sea's
		// next-event light, its emission, its reflection) through its transmittance
		[ 'scatterRec = bsdfSample( - ray.direction, surf );',
			`if ( ptSeaHit ) { gl_FragColor.rgb += ptSeaAirL * state.throughputColor; state.throughputColor *= ptSeaAirT; }
						scatterRec = bsdfSample( - ray.direction, surf );` ],
		[ /getSurfaceRecord\(\s*material, surfaceHit, attributesArray, state\.accumulatedRoughness,\s*surf\s*\) == SKIP_SURFACE/,
			'( ptSeaHit ? ptSeaSurface( ray, surfaceHit, state.accumulatedRoughness, surf ) : getSurfaceRecord( material, surfaceHit, attributesArray, state.accumulatedRoughness, surf ) ) == SKIP_SURFACE' ],
		// the disc's light after a sea bounce: the raster's glitter strength
		[ 'gl_FragColor.rgb += lightRec.emission * state.throughputColor * misWeight;',
			'gl_FragColor.rgb += lightRec.emission * ( ptLastSea && lightRec.type == DIR_LIGHT_TYPE ? ptSunSeaGain : vec3( 1.0 ) ) * state.throughputColor * misWeight;' ],
		[ 'result = attenuatedColor * lightRec.emission * state.throughputColor * sampleColor * misWeight / lightPdf;',
			'result = attenuatedColor * lightRec.emission * ( ptLastSea && lightRec.type == DIR_LIGHT_TYPE ? ptSunSeaGain : vec3( 1.0 ) ) * state.throughputColor * sampleColor * misWeight / lightPdf;' ],
		// the disc: its own MIS (a directional light with a size is no delta light)
		[ 'float misWeight = lightRec.type == SPOT_LIGHT_TYPE || lightRec.type == DIR_LIGHT_TYPE || lightRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );',
			'float misWeight = lightRec.type == SPOT_LIGHT_TYPE || ( lightRec.type == DIR_LIGHT_TYPE && ptSunOmc <= 0.0 ) || lightRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );' ],
		// its sample: a direction in its cone (pdf 1 / solid angle; the radiance its irradiance over that)
		[ /rec\.dist = 1e10;\s*rec\.direction = light\.u;\s*rec\.pdf = 1\.0;\s*rec\.emission = light\.color \* light\.intensity;/,
			`rec.dist = 1e10;
			rec.direction = light.u;
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity;
			if ( ptSunOmc > 0.0 ) {

				float omc = ptSunOmc * ruv.y, ct = 1.0 - omc, st = sqrt( max( omc * ( 2.0 - omc ), 0.0 ) ), ph = 6.28318530718 * ruv.z;
				mat3 B = getBasisFromNormal( normalize( light.u ) );
				rec.direction = normalize( B * vec3( st * cos( ph ), st * sin( ph ), ct ) );
				rec.pdf = 1.0 / ( 6.28318530718 * ptSunOmc );
				rec.emission = light.color * light.intensity * rec.pdf;

			}` ],
		// a ray into its cone hits it
		[ 'bool didHit = false;\n		Light light = readLightInfo( lights, l );',
			`bool didHit = false;
		Light light = readLightInfo( lights, l );
		if ( light.type == DIR_LIGHT_TYPE && ptSunOmc > 0.0 ) {

			if ( 1.0 - dot( rayDirection, normalize( light.u ) ) < ptSunOmc ) {

				lightRec.dist = 1e10;
				lightRec.pdf = 1.0 / ( 6.28318530718 * ptSunOmc );
				lightRec.emission = light.color * light.intensity * lightRec.pdf;
				lightRec.direction = rayDirection;
				lightRec.type = light.type;
				return true;

			}
			return false;

		}` ],
	];
	for ( const [ from, to ] of edits ) {

		const n = typeof from === 'string' ? fs.split( from ).length - 1 : ( fs.match( new RegExp( from.source, 'g' ) ) ?? [] ).length;
		if ( n !== 1 ) throw new Error( `ptpatch (sea): ${ String( from ).slice( 0, 60 ) }… found ${ n } times` );
		fs = fs.replace( from, to );

	}
	// the surface record (after the structs, before main uses it)
	const at = 'void main() {';
	if ( fs.split( at ).length - 1 !== 1 ) throw new Error( 'ptpatch (sea): main() not found once' );
	fs = fs.replace( at, `// the sea's surface: water (see patchSea)
				int ptSeaSurface( Ray ray, SurfaceHit hit, float accumulatedRoughness, inout SurfaceRecord surf ) {

					vec3 V = - ray.direction, n = hit.faceNormal;
					// (a crest's back seen grazing: bent until the view is just above it, as a normal map's)
					for ( int k = 0; k < 4 && dot( n, V ) < 0.02; k ++ ) n = normalize( mix( n, vec3( 0.0, 1.0, 0.0 ), 0.5 ) );
					surf.volumeParticle = false;
					surf.faceNormal = n; surf.normal = n; surf.frontFace = true;
					surf.metalness = 1.0; surf.color = vec3( 0.0204 ); surf.emission = vec3( 0.0 );
					surf.ior = 1.333; surf.transmission = 0.0; surf.thinFilm = false;
					surf.attenuationColor = vec3( 1.0 ); surf.attenuationDistance = INFINITY;
					surf.clearcoatNormal = n; surf.clearcoat = 0.0; surf.clearcoatRoughness = 0.0;
					surf.sheen = 0.0; surf.sheenColor = vec3( 0.0 ); surf.sheenRoughness = 0.0;
					surf.iridescence = 0.0; surf.iridescenceIor = 1.3; surf.iridescenceThickness = 0.0;
					surf.specularColor = vec3( 1.0 ); surf.specularIntensity = 1.0;
					surf.roughness = ptOcAlpha;
					surf.filteredRoughness = applyFilteredGlossy( surf.roughness, accumulatedRoughness );
					surf.filteredClearcoatRoughness = 0.0;
					surf.eta = 1.0 / 1.333; surf.f0 = 0.0204;
					surf.normalBasis = getBasisFromNormal( n ); surf.normalInvBasis = inverse( surf.normalBasis );
					surf.clearcoatBasis = surf.normalBasis; surf.clearcoatInvBasis = surf.normalInvBasis;
					// its body, as the raster's drawn sea (src/azurea.js backdropMaterial): its colour by the light's path
					// through the water (red first), seen from the camera (its depression and distance), × ( 1 − F )
					vec3 cam = cameraWorldMatrix[ 3 ].xyz;
					vec3 P = ray.origin + ray.direction * hit.dist, vd = normalize( P - cam );
					float dep = max( - vd.y, 1e-4 ), dist = length( P.xz - cam.xz );
					float far = smoothstep( 0.0, ptSeaPhotoDep, dep );
					float cosI = clamp( dot( - vd, n ), 0.0, 1.0 );
					float c = max( dot( V, n ), 1e-3 ), g = sqrt( max( 1.333 * 1.333 - 1.0 + c * c, 0.0 ) );
					float fa = ( g - c ) / ( g + c ), fb = ( c * ( g + c ) - 1.0 ) / ( c * ( g - c ) + 1.0 );
					float fres = 0.5 * fa * fa * ( 1.0 + fb * fb );
					float path = 2.6 * cosI * ( 0.5 + 1.6 * far ) + 0.45 * smoothstep( 3.0, 40.0, dist );
					vec3 T = exp( - ptSeaExt * path * ptSeaExtScale );
					T = mix( T, T * ptSeaColor * 1.6, 0.35 );
					float lit = clamp( ptSeaColor.g * 3.0, 0.25, 1.35 );
					surf.emission = ptSeaColor * T * lit * ptSeaTint * ( 1.0 - fres );
					// the air between the eye and the sea (the marine haze, as the raster's: Koschmieder): the sea's light
					// (its body, its reflection, the disc's glitter) × its transmittance, plus the haze's own: the
					// environment's light just above the horizon in this direction (the main loop applies them)
					ptSeaAirT = exp( - 3.912 * dist / ( 1000.0 * ptSeaVis ) );
					vec3 hzd = normalize( vec3( vd.x, 0.01, vd.z ) );
					ptSeaAirL = environmentIntensity * sampleEquirectColor( envMapInfo.map, envRotation3x3 * hzd ) * ( 1.0 - ptSeaAirT );
					return HIT_SURFACE;

				}

				void main() {` );
	return fs;

}

/**
 * The denoiser's buffers (ptdenoise.js), with PT_AOV 1: four more outputs beside the colour, averaged by the
 * same blending (each its alpha the colour's), at the first non-delta surface along the camera path (through
 * glass and near-mirrors: what is seen in them):
 *   1 ptAlbedo   that surface's albedo (diffuse + a specular share, floored) times the path's throughput to it
 *   2 ptNormal   its shading normal (world) times its distance along the path (the float target: signed)
 *   3 ptDirect   what is not its reflected light: lights and sky seen directly or through delta surfaces,
 *                specular hits on the way, its own emission: added back unfiltered
 *   4 ptStats    the demodulated illumination's luminance and its square (the variance), and the share of
 *                samples that found such a surface (coverage: the filter divides depth and normal by it)
 * The rest (colour − direct) / albedo is the illumination the filter smooths.
 */
function patchAOV( fs ) {

	const edits = [
		[ 'float lightsDenom;', `float lightsDenom;
				uniform float ptIndirectMax;
				#if PT_AOV
				layout( location = 1 ) out highp vec4 ptAlbedo;
				layout( location = 2 ) out highp vec4 ptNormal;
				layout( location = 3 ) out highp vec4 ptDirect;
				layout( location = 4 ) out highp vec4 ptStats;
				#endif` ],
		[ 'gl_FragColor = vec4( 0, 0, 0, 1 );', `gl_FragColor = vec4( 0, 0, 0, 1 );
					// the first non-delta surface: not yet found; its albedo, normal, path distance; the light before it
					bool aovSet = false, aovSkip = false, aovMirror = false;
					vec3 aovAlbedo = vec3( 0.0 ), aovNormal = vec3( 0.0 ), aovPre = vec3( 0.0 ), aovPost = vec3( 0.0 ), aovEmit = vec3( 0.0 );
					float aovDist = 0.0, aovPath = 0.0;` ],
		// at a surface, before its next-event estimation: is it the first non-delta one?
		[ '// next event estimation\n', `// (the denoiser's buffers: the first surface that is not glass or a near-mirror)
						aovPath += surfaceHit.dist;
						bool aovMark = false;
						if ( ! aovSet && ! aovSkip ) {

							float dl = luminance( surf.color ) * ( 1.0 - surf.metalness ) * ( 1.0 - surf.transmission );
							// a dark dielectric mirror (the screen's black lacquer: ~4 % Fresnel over next to no diffuse): its own
							// surface is where the light is demodulated, by its specular albedo (the same over all of it), so what it
							// reflects is filtered on its plane (its normal and depth), its edges kept by the luminance weight; its
							// emission (the roll's image) stays direct. (Through it to the room the albedo was the throughput's ~4 %,
							// each sample's lobe making it vary: smeared, so it was left unfiltered: noise 7× the raster's in video)
							bool darkMirror = surf.transmission < 0.5 && surf.metalness < 0.5 && surf.roughness < 0.08 && dl < 0.1;
							bool delta = ! darkMirror && ( surf.transmission > 0.5 || ( surf.roughness < 0.08 && surf.metalness > 0.5 ) );
							// seen through other dim glass: left unfiltered (as above, its albedo varies too much per sample)
							if ( ! delta && ! darkMirror && luminance( state.throughputColor ) < 0.5 ) aovSkip = true;
							else if ( ! delta || i == bounces - 1 ) {

								vec3 spec = mix( vec3( 0.04 ), surf.color, surf.metalness ) + vec3( 0.04 * surf.clearcoat );
								vec3 alb = darkMirror ? spec : surf.color * ( 1.0 - surf.metalness ) * ( 1.0 - surf.transmission ) + spec;
								aovAlbedo = state.throughputColor * max( alb, vec3( 0.02 ) );
								aovNormal = surf.normal;
								aovDist = aovPath;
								aovPre = gl_FragColor.rgb;
								aovSet = true;
								aovMark = true;
								aovMirror = darkMirror || delta;

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
					// fireflies: the light found after the first rough surface (its own lights' and emission kept as they are),
					// one sample's capped at ptIndirectMax in luminance (Cycles' clamp indirect). One rare path (a glossy bounce
					// into a bulb, a lamp) brought ~1000x a pixel's light in one sample in 2048: a speck the bloom spread over the
					// frame for one frame. Not after a mirror-like first surface (the screen, the black lacquer): what they reflect
					// is a sharp image (the sun's glare in the screen ~7000), not noise
					if ( aovSet && ! aovMirror && ptIndirectMax > 0.0 ) {

						vec3 kept = aovPost + aovEmit, ind = max( gl_FragColor.rgb - kept, vec3( 0.0 ) );
						float li = luminance( ind );
						if ( li > ptIndirectMax ) gl_FragColor.rgb = kept + ind * ( ptIndirectMax / li );

					}
					#if PT_AOV
					{

						// direct: before the surface, plus its own emission; illumination: the rest over the albedo
						vec3 direct = aovSet ? aovPre + aovEmit : gl_FragColor.rgb;
						vec3 illum = aovSet ? max( gl_FragColor.rgb - direct, vec3( 0.0 ) ) / aovAlbedo : vec3( 0.0 );
						float l = luminance( illum );
						float a = gl_FragColor.a;
						ptAlbedo = vec4( aovSet ? aovAlbedo : vec3( 0.0 ), a );
						ptNormal = vec4( aovSet ? aovNormal * aovDist : vec3( 0.0 ), a );		// (averaged: direction and length / coverage, ptdenoise.js)
						ptDirect = vec4( direct, a );
						ptStats = vec4( l, l * l, aovSet ? 1.0 : 0.0, a );
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

		patched = patchShader( SEA_PATCH ? patchSea( mats[ 0 ].fragmentShader ) : mats[ 0 ].fragmentShader );

	} catch ( e ) {

		console.warn( `${ e.message }: the path tracer left as it is (uniform light selection)` );
		return false;

	}
	for ( const m of mats ) {

		m.fragmentShader = patched;
		Object.assign( m.uniforms, { ptLightsShareSet: { value: share }, ptCdfCount: { value: 0 }, ptCdfOffset: { value: 0 }, ptIndirectMax: { value: INDIRECT_MAX }, ptDirectMax: { value: DIRECT_MAX } }, seaUniforms() );
		m.defines.PT_AOV = 0;
		m.needsUpdate = true;

	}
	// the sea and the disc: the venue's values (scene.userData.ptSea: { uniforms, beforeSample( k ) }; ptSun: { omc })
	// copied into both materials (by value: the uniforms the programs hold are the materials' own)
	const syncSea = () => {

		const sea = pt.scene?.userData?.ptSea, sun = pt.scene?.userData?.ptSun;
		for ( const m of mats ) {

			const u = m.uniforms;
			u.ptSeaOn.value = sea ? 1 : 0;
			u.ptSunOmc.value = sun?.omc ?? 0;
			if ( sea ) for ( const [ k, v ] of Object.entries( sea.uniforms ) ) if ( u[ k ] ) u[ k ].value = v.value;

		}

	};
	pt.syncSea = syncSea;
	const renderSample = pt.renderSample.bind( pt );
	pt.renderSample = ( ...a ) => {

		// (a new sample's first tile: the venue's sea at its time; the shutter's, or held)
		const sea = pt.scene?.userData?.ptSea;
		if ( sea?.beforeSample && Math.abs( pt.samples - Math.round( pt.samples ) ) < 1e-6 ) { sea.beforeSample( Math.round( pt.samples ) ); syncSea(); }
		return renderSample( ...a );

	};
	const update = pt.updateLights.bind( pt );
	pt.updateLights = () => {

		update();
		syncSea();
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
		// the CDF into the lights' own texture, after their data (texel 6 n on: LightsInfoUniformStruct's 6 a
		// light), the square grown if it must be (three allocates a texture's storage at its first upload: a
		// larger image is a new one, the old disposed, as the library does; the next updateFrom shrinks it back
		// and this grows it again)
		for ( const S of new Set( mats.map( m => m.uniforms.lights.value ) ) ) {

			const tex = S.tex, off = 6 * n, need = off + Math.max( n, 1 ), dim = Math.ceil( Math.sqrt( need ) );
			if ( tex.image.width < dim ) {

				const old = tex.image.data, w0 = tex.image.width;
				tex.dispose();
				const d = new Float32Array( dim * dim * 4 );
				// (texel index i: the library reads it as ( i % w, i / w ): copy by index, not by row)
				d.set( old.subarray( 0, Math.min( old.length, 4 * w0 * w0 ) ) );
				Object.assign( tex.image, { data: d, width: dim, height: dim } );

			}
			const d = tex.image.data;
			for ( let i = 0; i < Math.max( n, 1 ); ++ i ) { d[ 4 * ( off + i ) ] = n ? data[ 2 * i ] : 1; d[ 4 * ( off + i ) + 1 ] = n ? data[ 2 * i + 1 ] : 1; d[ 4 * ( off + i ) + 2 ] = 0; d[ 4 * ( off + i ) + 3 ] = 0; }
			tex.needsUpdate = true;

		}
		for ( const m of mats ) { m.uniforms.ptCdfCount.value = n; m.uniforms.ptCdfOffset.value = 6 * n; }

	};
	pt.lightsShare = v => { for ( const m of mats ) m.uniforms.ptLightsShareSet.value = v; pt.reset(); };
	pt.directMax = v => { for ( const m of mats ) m.uniforms.ptDirectMax.value = v; pt.reset(); };		// (the cap above; 0: off)
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

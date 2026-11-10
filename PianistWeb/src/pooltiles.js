// The pool's mosaic and the water's materials: what makes the tiles read through the water, in the raster and in
// the path tracer. `applyPoolTiles( azurea )` is called from src/azurea.js once the pool is built (after
// patchPoolWater, src/water.js); a dev page can also call it by hand:
//   import( '/src/pooltiles.js' ).then( m => m.applyPoolTiles( __pianist.azurea ) )
//
// What was wrong (measured, Day preset, a view down into the pool):
//   raster  1. the tile texture was near-white (hsl 193, 60 %, 88-94 %): a flat pale sheet, whatever the refraction
//              did with it. A mosaic needs its joints and per-tile variation to be seen through water at all.
//           2. the floor were looked up with the *refracted* uv's own derivatives. At a shallow view they explode
//              (the ray runs near-parallel to the floor), the sampler picks the smallest mip, and the mosaic averages
//              into a wash of pale aqua. Now sampled with the derivatives of the *unrefracted* hit: the mip the
//              footprint under the water actually needs (a procedural checker through the same code read sharply,
//              which is how the cause was pinned down).
//   PT      the water was a transmission surface with `thickness` (its own volume) AND a closed body mesh (band faces
//           o i b s e, the same water) at the same place: two nested refractive volumes. Light crossed the water
//           twice (1.1 m attenuation over 2 x 1.2 m), and the body's sides bent grazing rays past the critical
//           angle: a flat blue sheet with no floor. A transmission surface with thickness *is* the volume in
//           three-gpu-pathtracer, so the body is off.

import * as THREE from 'three';
import { chainCompile } from './mirror.js';

/**
 * The pool's mosaic: 8 x 8 glass tiles a texture, aqua-blue, each tile a paler glaze at one corner fading to a
 * darker body, with a small per-tile hue and brightness so no two repeat visibly; the joints thin and pale.
 */
export function mosaicTexture( { tiles = 8, size = 512, hue = 202, sat = 72, light = 44, joint = '#d9eff3' } = {} ) {

	const c = document.createElement( 'canvas' ); c.width = c.height = size;
	const g = c.getContext( '2d' ), n = size / tiles;
	g.fillStyle = joint; g.fillRect( 0, 0, size, size );
	for ( let i = 0; i < tiles; ++ i ) for ( let j = 0; j < tiles; ++ j ) {

		const h = hue + ( ( i * 7 + j * 3 ) % 5 - 2 ) * 4, s = sat + ( ( i * 5 + j * 7 ) % 4 - 1.5 ) * 7, l = light + ( ( i * 11 + j * 5 ) % 5 - 2 ) * 8;
		const x = i * n + 1.5, y = j * n + 1.5, w = n - 3;
		const grd = g.createLinearGradient( x, y, x + w, y + w );
		grd.addColorStop( 0, `hsl(${ h }, ${ s }%, ${ Math.min( 84, l + 18 ) }%)` );
		grd.addColorStop( 0.55, `hsl(${ h }, ${ s }%, ${ l }%)` );
		grd.addColorStop( 1, `hsl( ${ h - 5 }, ${ s + 6 }%, ${ Math.max( 14, l - 20 ) }%)` );
		g.fillStyle = grd; g.fillRect( x, y, w, w );

	}
	const t = new THREE.CanvasTexture( c );
	t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set( 1 / 1.92, 1 / 1.92 );		// (twice the tiles' size: 1.92 m a texture of 8)
	t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
	return t;

}

/**
 * Give `azurea`'s pool the mosaic, a clearer water for the raster's refracted floor, and a PT water that lets the
 * floor through. Returns the new tile texture.
 */
export function applyPoolTiles( azurea, {
	attenuationDistance = 2.2, attenuationColor = '#bfeef8', tileRoughness = 0.35, tileColor = '#eaf7fa',
	// (the clear water's own colour: without it the floor showed as a dry tiled slab; at the case's old near-zero
	// absorption it was a pale sheet with no tiles at all. Measured down into the pool: Day)
	absorb = [ 1.10, 0.30, 0.20 ], deep = [ 0.09, 0.40, 0.52 ], caustics = 0.42, glare = 0.055,
} = {} ) {

	const M = azurea.materials;

	// 1. the mosaic (shared by the basin's meshes, M.tile)
	if ( M.tile ) {

		M.tile.map?.dispose();
		M.tile.map = mosaicTexture();
		if ( M.water?.userData.pool ) M.water.userData.pool.uPoolTileScale.value = 1 / 1.92;		// (the floor under it too)
		M.tile.color.set( tileColor ); M.tile.roughness = tileRoughness;
		M.tile.needsUpdate = true;

	}

	// 2. the raster: the floor through the surface, sampled at the mip of the unrefracted footprint (see the head)
	const W = M.water;
	if ( W ) {

		const U = W.userData.pool;
		if ( U ) {

			// (the water's own tile sampler: patchPoolWater bound it to the old near-white tiles at the build; the
			// mosaic just replaced that texture, so the uniform must be pointed at it too -- else the floor under the
			// water stays a flat pale sheet)
			U.uPoolTiles.value = M.tile?.map ?? U.uPoolTiles.value;
			U.uPoolAbsorb.value.setRGB( ...absorb );
			U.uPoolDeep.value.setRGB( ...deep );
			U.uPoolCaustics.value = caustics;

		}
		W.roughness = Math.max( W.roughness ?? 0, glare );		// (a little: its mirror otherwise hides the floor)
		const patch = W.onBeforeCompile;
		W.onBeforeCompile = sh => {

			patch?.( sh );
			const from = 'vec3 floorCol = texture2D( uPoolTiles, hit.xz * uPoolTileScale ).rgb;';
			if ( sh.fragmentShader.split( from ).length !== 2 ) return;		// (src/water.js's text changed: as it was)
			sh.fragmentShader = sh.fragmentShader.replace( from,
				`vec2 uvS = hit.xz * uPoolTileScale;
				vec3 floorCol = textureGrad( uPoolTiles, hit.xz * uPoolTileScale, dFdx( uvS ), dFdy( uvS ) ).rgb;` );

		};
		W.customProgramCacheKey = () => 'poolWater-mosaic';		// (a new key: the cached program would keep the old text)
		W.needsUpdate = true;

	}

	// 3. the key light's own specular on the water, scaled per preset (Night: the moon, a point light, laid a broad
	// white lamp-like highlight on the pool; the sky's reflection in it stays, the moon's own small one too)
	if ( W ) keySpecular( W, azurea.keySpec );

	// 4. the path tracer: the surface is the volume; the nested closed body made the water a flat blue sheet
	if ( azurea.waterPTBody ) azurea.waterPTBody.visible = false;
	for ( const m of [ M.waterPT, M.waterPTBody ] ) {

		if ( ! m ) continue;
		m.attenuationDistance = attenuationDistance;
		m.attenuationColor.set( attenuationColor );
		m.thickness = 0.9;			// (the water's depth: the tile is ~0.9 m below the surface on average)
		m.roughness = 0.02; m.metalness = 0;
		m.needsUpdate = true;

	}
	if ( azurea.poolWater && M.waterPT ) M.waterPT.normalMap = azurea.poolWater.texture;
	return M.tile?.map;

}

/**
 * The key light's own direct specular on `material`, scaled by the uniform `u`, and no point light's (the
 * chandelier's: an indoor lamp) — Azurea's own patch, src/azurea.js keySpecular, for the pool's water.
 */
function keySpecular( material, u ) {

	chainCompile( material, sh => {

		sh.uniforms.uKeySpec = u;
		const point = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', spot = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
			end = '#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )';
		let fs = THREE.ShaderChunk.lights_fragment_begin;
		if ( ! ( fs.includes( point ) && fs.includes( spot ) && fs.includes( end ) ) || fs.indexOf( point ) > fs.indexOf( spot ) ) {

			console.warn( 'pooltiles: three\'s lights chunk changed: the key light\'s specular left as it is' );
			return;

		}
		const snap = n => `vec3 ${ n } = reflectedLight.directSpecular;
			#ifdef USE_CLEARCOAT
			vec3 ${ n }Cc = clearcoatSpecularDirect;
			#endif
			`;
		fs = fs.replace( point, snap( 'ptS0' ) + point ).replace( spot, snap( 'ptS1' ) + spot ).replace( end, snap( 'ptS2' ) + end )
			.replace( end, `reflectedLight.directSpecular = ptS0 + uKeySpec * ( ptS2 - ptS1 );
			#ifdef USE_CLEARCOAT
			clearcoatSpecularDirect = ptS0Cc + uKeySpec * ( ptS2Cc - ptS1Cc );
			#endif
			${ end }` );
		sh.fragmentShader = sh.fragmentShader.replace( '#include <common>', '#include <common>\nuniform float uKeySpec;' ).replace( '#include <lights_fragment_begin>', fs );

	}, 'pooltiles-keyspec' );

}


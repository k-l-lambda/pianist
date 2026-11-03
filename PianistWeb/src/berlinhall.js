// The Konzerthaus Berlin's Großer Saal as the concert hall's shell: tools/hall-asset.mjs's two packs
// (public/berlinhall/{stage,house}.glb; when missing, the hall stays procedural), with their own
// PBR materials (made from the source's baked textures: albedo, ORM, normal; gold leaf metallic,
// velvet with sheen; the chandeliers' and candles' emissive).
//
// The packs' frame (metres, y up, x across with the audience's right +, z from the stage's front
// edge towards the back of the hall, y 0 at the stalls floor) -> the hall frame (hall.js: y 0 at
// the stage floor, the piano at z = -HALL.pianoAt): the stage's front strip, 0.61 m above the
// stalls and 2.6 m deep before the first riser, is the stage floor; the piano at its middle.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BERLIN = {
	apronHeight: 0.61,		// the stage's front strip above the stalls floor (m)
	apronDepth: 2.6,		// from the front edge to the first riser
	stageWidth: 17,		// between the stage's side walls (about)
	pianoAt: 1.3,			// the piano's centre behind the front edge
};

// per look (the packs' material extras): a varnish on the wooden floors and frames; gold leaf
// less than a full metal (a full metal mirrors the dark hall and reads as black)
const FINISH = {
	stageFloor: { clearcoat: 0.35, clearcoatRoughness: 0.2 },
	parquet: { clearcoat: 0.2, clearcoatRoughness: 0.35 },
	parquetDark: { clearcoat: 0.2, clearcoatRoughness: 0.35 },
	woodFrame: { clearcoat: 0.3, clearcoatRoughness: 0.3 },
	gilt: { metalness: 0.7 },
	ivoryGilt: { metalness: 0.7 },
};
// the hall's chandeliers: two rows of seven over the stalls and the stage, their candle rings
// (2.3 m across) at 10.2 m (measured in the packs' frame: x, y, z)
export const BERLIN_CHANDELIERS = [ - 4.75, 4.75 ].flatMap( x => [ - 8.8, - 4.1, 0.5, 5.2, 9.8, 14.4, 19.0 ].map( z => [ x, 10.2, z ] ) );
// emissive materials by what lights them (the source's material names): the chandeliers and the
// wall sconces with the house lights, the candelabras' candles round the stalls with `lamps`
const LAMP_GROUP = { 'kronleuchter': 'house', 'kerzenstaender_klein': 'house', 'kerzen-2-low': 'lamps' };
const LAMP_TINT = '#ffd29a';
const LAMP_EMISSIVE = { house: 14, lamps: 6 };		// emissive intensity per unit of the preset's value (bright: lit bulbs and candles saturate)

/** Attribute -> plain Float32 (the packs are quantised: normalised integers). */
function toFloat( attr ) {

	const n = attr.count, s = attr.itemSize, out = new Float32Array( n * s );
	for ( let i = 0; i < n; ++ i ) for ( let c = 0; c < s; ++ c ) out[ i * s + c ] = attr.getComponent( i, c );
	return new THREE.BufferAttribute( out, s );

}

/** The pack's material as ours: physical (clearcoat, sheen), double-sided, sharp at grazing angles. */
function hallMaterial( m, anisotropy ) {

	const look = m.userData.look ?? '', f = FINISH[ look ] ?? {};
	const p = new THREE.MeshPhysicalMaterial( {
		name: m.name, color: m.color, map: m.map, roughness: m.roughness, metalness: f.metalness ?? m.metalness, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap,
		aoMap: m.aoMap, aoMapIntensity: m.aoMapIntensity, normalMap: m.normalMap, normalScale: m.normalScale,
		emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
		clearcoat: f.clearcoat ?? 0, clearcoatRoughness: f.clearcoatRoughness ?? 0, side: THREE.DoubleSide,
	} );
	if ( m.sheen ) Object.assign( p, { sheen: m.sheen, sheenColor: m.sheenColor, sheenRoughness: m.sheenRoughness } );
	for ( const t of [ p.map, p.normalMap, p.roughnessMap, p.emissiveMap ] ) if ( t ) t.anisotropy = anisotropy;
	p.userData = { look, lamp: !! m.userData.lamp, lampGroup: m.userData.lamp ? LAMP_GROUP[ m.name ] ?? 'lamps' : null };
	if ( p.userData.lamp ) p.emissive.set( LAMP_TINT );		// candle-warm, not white
	return p;

}

/** The packs' frame -> the hall frame (`pianoZ`: the piano's spot in the hall frame). */
export function berlinToHall( pianoZ ) {

	return new THREE.Matrix4().makeTranslation( 0, - BERLIN.apronHeight, pianoZ + BERLIN.pianoAt );

}

/** The lamps' glow: the chandeliers and sconces at `house`, the candelabras at `lamps` (the preset's). */
export function setBerlinLamps( group, { house, lamps } ) {

	for ( const m of group?.userData.lamps ?? [] ) {

		const v = m.userData.lampGroup === 'house' ? house : lamps;
		m.emissiveIntensity = LAMP_EMISSIVE[ m.userData.lampGroup ] * v;

	}

}

/**
 * Load the packs into one group of merged meshes in world space (`toWorld`: hall frame -> world;
 * `pianoZ`: the piano's spot, hall frame; `anisotropy`: the textures'). Resolves to the group, or
 * null when the packs are not there.
 */
export async function loadBerlinHall( { toWorld, pianoZ, anisotropy = 8 } ) {

	const base = new URL( 'berlinhall/', new URL( import.meta.env.BASE_URL, location.href ) );
	const loader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
	let gltfs;
	try {

		gltfs = await Promise.all( [ 'stage', 'house' ].map( n => loader.loadAsync( new URL( `${ n }.glb`, base ).href ) ) );

	} catch ( e ) {

		console.warn( `Berlin hall: ${ e.message ?? e } (the packs: tools/hall-asset.mjs)` );
		return null;

	}

	const M = new THREE.Matrix4().multiplyMatrices( toWorld, berlinToHall( pianoZ ) );
	const parts = new Map();		// our material -> geometries (world)
	const ours = new Map();		// the pack's material -> ours
	for ( const g of gltfs ) {

		g.scene.updateMatrixWorld( true );
		g.scene.traverse( o => {

			if ( ! o.isMesh ) return;
			if ( ! ours.has( o.material ) ) ours.set( o.material, hallMaterial( o.material, anisotropy ) );
			const mat = ours.get( o.material );
			const geo = new THREE.BufferGeometry();
			for ( const k of [ 'position', 'normal', 'uv' ] ) geo.setAttribute( k, toFloat( o.geometry.attributes[ k ] ) );
			geo.setIndex( o.geometry.index.clone() );
			const W = new THREE.Matrix4().multiplyMatrices( M, o.matrixWorld );
			geo.applyMatrix4( W );
			if ( W.determinant() < 0 ) {		// a mirrored part: wind its triangles the other way round

				const I = geo.index.array;
				for ( let t = 0; t < I.length; t += 3 ) { const x = I[ t + 1 ]; I[ t + 1 ] = I[ t + 2 ]; I[ t + 2 ] = x; }

			}
			if ( ! parts.has( mat ) ) parts.set( mat, [] );
			parts.get( mat ).push( geo );

		} );

	}

	const group = new THREE.Group();
	group.name = 'berlinHall';
	group.userData.lamps = [ ...parts.keys() ].filter( m => m.userData.lamp );
	for ( const [ mat, geos ] of parts ) {

		const geo = mergeGeometries( geos, false );
		geos.forEach( g => g.dispose() );
		const mesh = new THREE.Mesh( geo, mat );
		mesh.castShadow = ! mat.userData.lamp;
		mesh.receiveShadow = true;
		mesh.name = `berlinHall:${ mat.name }`;
		group.add( mesh );

	}
	for ( const g of gltfs ) g.scene.traverse( o => o.geometry?.dispose() );		// (the materials' textures: now ours)
	return group;

}

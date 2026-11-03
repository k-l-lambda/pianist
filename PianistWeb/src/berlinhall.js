// The Konzerthaus Berlin's Großer Saal as the concert hall's shell: the geometry of
// tools/hall-asset.mjs's two packs (public/berlin-hall/{stage,house}.glb, local only: not in the
// repo; when missing, the hall stays procedural), with the hall's own materials where it has one.
//
// The packs' frame (metres, y up, x across with the audience's right +, z from the stage's front
// edge towards the back of the hall, y 0 at the stalls floor) -> the hall frame (hall.js: y 0 at
// the stage floor, the piano at z = -HALL.pianoAt): the stage's front strip, 0.61 m above the
// stalls and 2.6 m deep before the first riser, is the stage floor; the piano at its middle.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxProjectUV } from './geometry.js';

export const BERLIN = {
	apronHeight: 0.61,		// the stage's front strip above the stalls floor (m)
	apronDepth: 2.6,		// from the front edge to the first riser
	stageWidth: 17,		// between the stage's side walls (about)
	pianoAt: 1.3,			// the piano's centre behind the front edge
};

// the hall's material for each look of the packs (tools/hall-asset.mjs LOOKS); others: the pack's
// own (colour, roughness, metalness, sheen), double-sided
const HALL_MATERIAL = {
	ivory: 'plaster', stagePanel: 'panel', stageFloor: 'stage', stageFloorLight: 'stage',
	parquet: 'parquet', parquetDark: 'parquet', gilt: 'gilt', velvet: 'velvet', woodFrame: 'wood',
};
const TEXTURED = new Set( [ 'plaster', 'panel', 'stage', 'parquet' ] );		// need UVs (box projection)

/** Attribute -> plain Float32 (the packs are quantised: normalised integers). */
function toFloat( attr ) {

	const n = attr.count, s = attr.itemSize, out = new Float32Array( n * s );
	for ( let i = 0; i < n; ++ i ) for ( let c = 0; c < s; ++ c ) out[ i * s + c ] = attr.getComponent( i, c );
	return new THREE.BufferAttribute( out, s );

}

/** The packs' frame -> the hall frame (`pianoZ`: the piano's spot in the hall frame). */
export function berlinToHall( pianoZ ) {

	return new THREE.Matrix4().makeTranslation( 0, - BERLIN.apronHeight, pianoZ + BERLIN.pianoAt );

}

/**
 * Load the packs into one group of merged meshes in world space (`toWorld`: hall frame -> world;
 * `pianoZ`: the piano's spot, hall frame; `materials`: the hall's). Resolves to the group, or
 * null when the packs are not there.
 */
export async function loadBerlinHall( { toWorld, pianoZ, materials } ) {

	const base = new URL( 'berlin-hall/', new URL( import.meta.env.BASE_URL, location.href ) );
	const loader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
	let gltfs;
	try {

		gltfs = await Promise.all( [ 'stage', 'house' ].map( n => loader.loadAsync( new URL( `${ n }.glb`, base ).href ) ) );

	} catch ( e ) {

		console.warn( `Berlin hall: ${ e.message ?? e } (the packs are local only: tools/hall-asset.mjs)` );
		return null;

	}

	const M = new THREE.Matrix4().multiplyMatrices( toWorld, berlinToHall( pianoZ ) );
	const parts = new Map();		// material -> geometries (world)
	const own = new Map();		// the pack's material (by name) -> ours
	for ( const g of gltfs ) {

		g.scene.updateMatrixWorld( true );
		g.scene.traverse( o => {

			if ( ! o.isMesh ) return;
			const look = o.material.name, key = HALL_MATERIAL[ look ];
			let mat = key ? materials[ key ] : own.get( look );
			if ( ! mat ) {

				mat = new THREE.MeshPhysicalMaterial( { color: o.material.color, roughness: o.material.roughness, metalness: o.material.metalness, side: THREE.DoubleSide } );
				if ( o.material.sheen ) Object.assign( mat, { sheen: o.material.sheen, sheenColor: o.material.sheenColor, sheenRoughness: o.material.sheenRoughness } );
				mat.name = look;
				own.set( look, mat );

			}
			let geo = new THREE.BufferGeometry();
			geo.setAttribute( 'position', toFloat( o.geometry.attributes.position ) );
			geo.setAttribute( 'normal', toFloat( o.geometry.attributes.normal ) );
			geo.setIndex( o.geometry.index.clone() );
			const W = new THREE.Matrix4().multiplyMatrices( M, o.matrixWorld );
			geo.applyMatrix4( W );
			if ( W.determinant() < 0 ) {		// the mirrored half: wind its triangles the other way round

				const I = geo.index.array;
				for ( let t = 0; t < I.length; t += 3 ) { const x = I[ t + 1 ]; I[ t + 1 ] = I[ t + 2 ]; I[ t + 2 ] = x; }

			}
			if ( TEXTURED.has( key ) ) geo = boxProjectUV( geo, { grain: 'x', offset: [ 0, 0 ], angle: 0 } );
			if ( ! parts.has( mat ) ) parts.set( mat, [] );
			parts.get( mat ).push( geo );

		} );

	}

	const group = new THREE.Group();
	group.name = 'berlinHall';
	for ( const [ mat, geos ] of parts ) {

		const geo = mergeGeometries( geos, false );
		geos.forEach( g => g.dispose() );
		const mesh = new THREE.Mesh( geo, mat );
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.name = 'berlinHall';
		group.add( mesh );

	}
	for ( const g of gltfs ) g.scene.traverse( o => { o.geometry?.dispose(); o.material?.dispose?.(); } );
	return group;

}

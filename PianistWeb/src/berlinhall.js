// The Konzerthaus Berlin's Großer Saal as the concert hall's shell: tools/hall-asset.mjs's two packs
// (public/berlinhall/{stage,house}.glb; when missing, the hall stays procedural), with their own
// PBR materials (made from the source's baked textures: albedo, ORM, normal; gold leaf metallic,
// velvet with sheen; the chandeliers' and candles' emissive); near the piano, `-near` materials
// whose albedo is a sharper atlas on uv1.
//
// The packs' frame (metres, y up, x across with the audience's right +, z from the stage's front
// edge towards the back of the hall, y 0 at the stalls floor) -> the hall frame (hall.js: y 0 at
// the stage floor, the piano at z = -HALL.pianoAt): the stage's front strip, 0.61 m above the
// stalls and 2.6 m deep before the first riser, is the stage floor; the piano at its middle.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHANDELIER_PT_LOD, crystalInstances, crystalLayout, crystalMaterial, crystalMerged, crystalPTMaterial, frameGeometries } from './chandelier.js';

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
	bust: { clearcoat: 0.2, clearcoatRoughness: 0.15 },		// the composers' marble busts: a faint polish
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

// the stage floor's grain (tools/floor-detail.mjs: a generated maple surface, grey about 128; in
// the packs: the stage floor's materials' emissive slot, extras.floorDetail): tiled in world space
// along its boards (the packs' z: the atlas has the boards along u, the packs' z), multiplying the
// albedo on horizontal faces (not the risers' fronts)
const FLOOR_DETAIL = { tile: 0.6, strength: 1, along: [ 0, 0, 1 ], across: [ 1, 0, 0 ] };

// the floor's vents (tools/floor-grille.mjs; in the packs: a decal mesh per kind, extras.grille):
// alpha blended over the baked ones, drawn in front of the floor (polygon offset)
const GRILLE_OFFSET = { polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 4 };

/** `material` with the floor's grain detail (`tex`; `along`, `across`: world directions). */
function addFloorDetail( material, tex, along, across ) {

	const u = { uFloorDetail: { value: tex }, uFloorAlong: { value: along }, uFloorAcross: { value: across }, uFloorTile: { value: FLOOR_DETAIL.tile }, uFloorStrength: { value: FLOOR_DETAIL.strength } };
	material.userData.floorDetail = u;
	material.onBeforeCompile = shader => {

		Object.assign( shader.uniforms, u );
		shader.vertexShader = shader.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vFloorPos;\nvarying float vFloorUp;' )
			.replace( '#include <project_vertex>', '#include <project_vertex>\nvFloorPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvFloorUp = normalize( mat3( modelMatrix ) * objectNormal ).y;' );
		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', '#include <common>\nuniform sampler2D uFloorDetail;\nuniform vec3 uFloorAlong, uFloorAcross;\nuniform float uFloorTile, uFloorStrength;\nvarying vec3 vFloorPos;\nvarying float vFloorUp;' )
			.replace( '#include <map_fragment>', `#include <map_fragment>
			{
				vec2 fuv = vec2( dot( vFloorPos, uFloorAlong ), dot( vFloorPos, uFloorAcross ) ) / uFloorTile;
				float fd = texture2D( uFloorDetail, fuv ).r / 0.502;		// (about 1: 128 / 255)
				diffuseColor.rgb *= mix( 1.0, fd, uFloorStrength * smoothstep( 0.7, 0.95, abs( vFloorUp ) ) );
			}` );

	};
	material.customProgramCacheKey = () => 'berlinFloorDetail';
	material.needsUpdate = true;

}

/** Attribute -> plain Float32 (the packs are quantised: normalised integers). */
function toFloat( attr ) {

	const n = attr.count, s = attr.itemSize, out = new Float32Array( n * s );
	for ( let i = 0; i < n; ++ i ) for ( let c = 0; c < s; ++ c ) out[ i * s + c ] = attr.getComponent( i, c );
	return new THREE.BufferAttribute( out, s );

}

/** The pack's material as ours: physical (clearcoat, sheen), double-sided, sharp at grazing angles. */
function hallMaterial( m, anisotropy ) {

	const look = m.userData.look ?? '', f = FINISH[ look ] ?? {};
	const grain = m.userData.floorDetail ? m.emissiveMap : null;		// (its emissive slot carries the grain: not an emissive)
	const p = new THREE.MeshPhysicalMaterial( {
		name: m.name, color: m.color, map: m.map, roughness: m.roughness, metalness: f.metalness ?? m.metalness, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap,
		aoMap: m.aoMap, aoMapIntensity: m.aoMapIntensity, normalMap: m.normalMap, normalScale: m.normalScale,
		normalMapType: m.userData.objectNormal ? THREE.ObjectSpaceNormalMap : THREE.TangentSpaceNormalMap,		// (a bust's: its own frame)
		emissive: m.emissive, emissiveMap: grain ? null : m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
		transparent: m.transparent, depthWrite: m.depthWrite, ...( m.userData.grille ? GRILLE_OFFSET : {} ),
		clearcoat: f.clearcoat ?? 0, clearcoatRoughness: f.clearcoatRoughness ?? 0, side: m.userData.grille ? THREE.FrontSide : THREE.DoubleSide,
	} );
	if ( m.sheen ) Object.assign( p, { sheen: m.sheen, sheenColor: m.sheenColor, sheenRoughness: m.sheenRoughness } );
	for ( const t of [ p.map, p.normalMap, p.roughnessMap, p.emissiveMap ] ) if ( t ) t.anisotropy = anisotropy;
	p.userData = { look, bust: !! m.userData.objectNormal, lamp: !! m.userData.lamp, lampGroup: m.userData.lamp ? LAMP_GROUP[ m.name.replace( /-near$/, '' ) ] ?? 'lamps' : null, grille: m.userData.grille ?? null, grain };
	if ( grain ) { grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.colorSpace = THREE.NoColorSpace; grain.anisotropy = anisotropy; grain.needsUpdate = true; }
	if ( p.userData.lamp ) p.emissive.set( LAMP_TINT );		// candle-warm, not white
	return p;

}

/** The packs' frame -> the hall frame (`pianoZ`: the piano's spot in the hall frame). */
export function berlinToHall( pianoZ ) {

	return new THREE.Matrix4().makeTranslation( 0, - BERLIN.apronHeight, pianoZ + BERLIN.pianoAt );

}

// the chandeliers (src/chandelier.js): their frame's gilt, the candles' wax; the crystals' glow from their
// candles per unit of `house` (the crystal material's uLamp)
const CHANDELIER_GILT = { color: '#d6ad5e', metalness: 0.85, roughness: 0.28 };
const CRYSTAL_GLOW = 2.2;

/**
 * The procedural chandeliers at BERLIN_CHANDELIERS (`M`: the packs' frame -> the world), in `group`
 * (userData.chandeliers: { crystal, raster: [ groups ], pt: [ groups ] }). Each: its frame (gilt, wax,
 * flames: a lamp of the `house` group), its crystals instanced (raster) and merged as glass (the path
 * tracer's, shown by setBerlinChandelierMode; coarser beyond CHANDELIER_PT_LOD.near of the piano).
 */
function addChandeliers( group, M ) {

	const F = frameGeometries();
	const gilt = new THREE.MeshStandardMaterial( CHANDELIER_GILT ), wax = new THREE.MeshStandardMaterial( { color: '#f3ede1', roughness: 0.45, emissive: '#ffd9a8', emissiveIntensity: 0.15 } );
	const flame = new THREE.MeshStandardMaterial( { color: '#000000', emissive: LAMP_TINT, emissiveIntensity: LAMP_EMISSIVE.house } );
	flame.userData.lamp = true; flame.userData.lampGroup = 'house';
	group.userData.lamps.push( flame );
	const crystal = crystalMaterial(), glass = crystalPTMaterial();
	const full = crystalLayout( { seed: 7 } );
	const ptGeo = { near: crystalMerged( crystalLayout( { seed: 7, pitchK: CHANDELIER_PT_LOD.nearPitch, scaleK: 1.15 } ) ), far: crystalMerged( crystalLayout( { seed: 7, pitchK: CHANDELIER_PT_LOD.pitch, scaleK: CHANDELIER_PT_LOD.scale } ) ) };
	const C = group.userData.chandeliers = { crystal, raster: [], pt: [], tris: { raster: 0, pt: 0, ptNear: ptGeo.near.attributes.position.count / 3, ptFar: ptGeo.far.attributes.position.count / 3, frame: ( F.gilt.attributes.position.count + F.wax.attributes.position.count + F.flame.attributes.position.count ) / 3 } };
	for ( const p of BERLIN_CHANDELIERS ) {

		const at = new THREE.Vector3( ...p ).applyMatrix4( M );
		const g = new THREE.Group();
		g.name = 'berlinHall:chandelier';
		g.position.copy( at );
		for ( const [ geo, mat ] of [ [ F.gilt, gilt ], [ F.wax, wax ], [ F.flame, flame ] ] ) {

			const m = new THREE.Mesh( geo, mat );
			m.castShadow = false; m.receiveShadow = mat !== flame;
			m.userData.ptNoOccluder = true;		// (round the chandelier's own light: pathtracer.js)
			m.userData.noAO = true;
			g.add( m );

		}
		const raster = new THREE.Group(), pt = new THREE.Group();
		for ( const im of crystalInstances( full, crystal ) ) { im.castShadow = false; im.userData.noAO = true; raster.add( im ); C.tris.raster += im.count * im.geometry.attributes.position.count / 3; }
		const lod = Math.hypot( at.x, at.z ) < CHANDELIER_PT_LOD.near ? 'near' : 'far';		// (the piano: the world's origin)
		C.tris.pt += ptGeo[ lod ].attributes.position.count / 3;
		const gm = new THREE.Mesh( ptGeo[ lod ], glass );
		pt.add( gm );
		pt.visible = false;
		raster.name = 'chandelier:crystals'; pt.name = 'chandelier:crystalsPT';
		g.add( raster, pt );
		C.raster.push( raster ); C.pt.push( pt );
		group.add( g );

	}

}

/** The chandeliers' crystals for the renderer: instanced (raster) or merged glass (the path tracer). */
export function setBerlinChandelierMode( group, mode ) {

	const C = group?.userData.chandeliers;
	if ( ! C ) return;
	for ( const g of C.raster ) g.visible = mode !== 'pathtrace';
	for ( const g of C.pt ) g.visible = mode === 'pathtrace';

}

/** The lamps' glow: the chandeliers and sconces at `house`, the candelabras at `lamps` (the preset's). */
export function setBerlinLamps( group, { house, lamps } ) {

	for ( const m of group?.userData.lamps ?? [] ) {

		const v = m.userData.lampGroup === 'house' ? house : lamps;
		m.emissiveIntensity = LAMP_EMISSIVE[ m.userData.lampGroup ] * v;

	}
	const C = group?.userData.chandeliers;
	if ( C ) C.crystal.userData.u.uLamp.value = CRYSTAL_GLOW * house;

}

// ---- loading: the packs' bytes fetched as early as the page knows it needs them (prefetchBerlinHall),
// then parsed, built, their textures uploaded and their shaders compiled a frame at a time, so the
// page keeps drawing (and the progress bar moving) in between ----

const PACKS = [ 'stage', 'house' ];

/** Loading state of the packs, for the UI. phase: idle | download | build | upload | compile | ready | failed */
export const berlinStatus = { phase: 'idle', received: 0, total: 0 };

/** 0..1 through the loading (the download most of it: what takes long on a real connection). */
export function berlinProgress() {

	const s = berlinStatus;
	switch ( s.phase ) {

		case 'download': return s.total ? 0.85 * Math.min( 1, s.received / s.total ) : 0;
		case 'build': return 0.87;
		case 'upload': return 0.87 + 0.08 * ( s.uploaded ?? 0 );
		case 'compile': return 0.96;
		case 'ready': return 1;
		default: return 0;

	}

}

/** A short line for the progress bar. */
export function berlinStatusText() {

	const s = berlinStatus, mb = b => ( b / 1048576 ).toFixed( 1 );
	switch ( s.phase ) {

		case 'download': return s.total ? `Loading the hall · ${ mb( s.received ) } / ${ mb( s.total ) } MB` : `Loading the hall · ${ mb( s.received ) } MB`;
		case 'build': return 'Building the hall';
		case 'upload': return 'Preparing textures';
		case 'compile': return 'Preparing materials';
		case 'failed': return 'The hall failed to load';
		default: return '';

	}

}

let prefetch = null;

/** Start fetching the packs (safe to call repeatedly); resolves to their bytes, in PACKS' order. */
export function prefetchBerlinHall() {

	if ( prefetch ) return prefetch;
	const base = new URL( 'berlinhall/', new URL( import.meta.env.BASE_URL, location.href ) );
	berlinStatus.phase = 'download';
	const got = PACKS.map( () => 0 ), size = PACKS.map( () => 0 );
	const sum = a => a.reduce( ( x, y ) => x + y, 0 );
	prefetch = Promise.all( PACKS.map( async ( name, i ) => {

		const res = await fetch( new URL( `${ name }.glb`, base ), { priority: 'high' } );
		if ( ! res.ok ) throw new Error( `${ name }.glb: HTTP ${ res.status }` );
		// (a compressed response's length is not the body's: then no total, only the bytes so far)
		size[ i ] = res.headers.get( 'content-encoding' ) ? 0 : Number( res.headers.get( 'content-length' ) ) || 0;
		if ( size.every( v => v ) ) berlinStatus.total = sum( size );
		if ( ! res.body ) return res.arrayBuffer();
		const reader = res.body.getReader(), chunks = [];
		for ( ;; ) {

			const { done, value } = await reader.read();
			if ( done ) break;
			chunks.push( value );
			got[ i ] += value.length;
			berlinStatus.received = sum( got );

		}
		const out = new Uint8Array( got[ i ] );
		let o = 0;
		for ( const c of chunks ) { out.set( c, o ); o += c.length; }
		return out.buffer;

	} ) );
	prefetch.catch( () => { berlinStatus.phase = 'failed'; } );
	return prefetch;

}

/** Let a frame be drawn (or, in a hidden tab, where frames wait, go on after a moment). */
const nextFrame = () => new Promise( r => { const t = setTimeout( r, 100 ); requestAnimationFrame( () => { clearTimeout( t ); setTimeout( r, 0 ); } ); } );

/** Upload the group's textures to the GPU a few at a time (`renderer.initTexture`), drawing frames between. */
async function uploadTextures( group, renderer ) {

	const tex = new Set();
	group.traverse( o => {

		const m = o.material;
		if ( ! m ) return;
		for ( const k of [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap' ] ) if ( m[ k ] ) tex.add( m[ k ] );
		if ( m.userData.grain ) tex.add( m.userData.grain );

	} );
	let done = 0, t = performance.now();
	for ( const x of tex ) {

		renderer.initTexture( x );
		berlinStatus.uploaded = ++ done / tex.size;
		if ( performance.now() - t > 30 ) { await nextFrame(); t = performance.now(); }

	}

}

/**
 * Load the packs into one group of merged meshes in world space (`toWorld`: hall frame -> world;
 * `pianoZ`: the piano's spot, hall frame; `anisotropy`: the textures'; `renderer`: if given, the
 * textures are uploaded before it resolves). Resolves to the group, or null when the packs are not
 * there. Its shaders: compile them before showing it (ConcertHall.setModel).
 */
export async function loadBerlinHall( { toWorld, pianoZ, anisotropy = 8, renderer = null } ) {

	const loader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
	const base = new URL( 'berlinhall/', new URL( import.meta.env.BASE_URL, location.href ) ).href;
	const gltfs = [];
	try {

		const bufs = await prefetchBerlinHall();
		berlinStatus.phase = 'build';
		for ( const b of bufs ) { await nextFrame(); gltfs.push( await loader.parseAsync( b, base ) ); }

	} catch ( e ) {

		berlinStatus.phase = 'failed';
		console.warn( `Berlin hall: ${ e.message ?? e } (the packs: tools/hall-asset.mjs)` );
		return null;

	}

	const M = new THREE.Matrix4().multiplyMatrices( toWorld, berlinToHall( pianoZ ) );
	const parts = new Map();		// our material -> geometries (world)
	const busts = [];			// the composers' busts: each its own mesh, its node's transform kept
	const ours = new Map();		// the pack's material -> ours
	const meshes = [];
	for ( const g of gltfs ) { g.scene.updateMatrixWorld( true ); g.scene.traverse( o => { if ( o.isMesh ) meshes.push( o ); } ); }
	let t = performance.now();
	for ( const o of meshes ) {

		if ( performance.now() - t > 30 ) { await nextFrame(); t = performance.now(); }
		if ( o.material.name === 'kronleuchter' ) continue;		// (the scanned chandeliers: ours instead, src/chandelier.js)
		if ( ! ours.has( o.material ) ) ours.set( o.material, hallMaterial( o.material, anisotropy ) );
		const mat = ours.get( o.material );
		const geo = new THREE.BufferGeometry();
		// (uv1: a near material's albedo atlas, tools/hall-asset.mjs --originals)
		for ( const k of [ 'position', 'normal', 'uv', 'uv1' ] ) if ( o.geometry.attributes[ k ] ) geo.setAttribute( k, toFloat( o.geometry.attributes[ k ] ) );
		geo.setIndex( o.geometry.index.clone() );
		const W = new THREE.Matrix4().multiplyMatrices( M, o.matrixWorld );
		if ( mat.userData.bust ) { busts.push( { geo, mat, W } ); continue; }		// (its normal map is in its own frame: not merged)
		geo.applyMatrix4( W );
		if ( W.determinant() < 0 ) {		// a mirrored part: wind its triangles the other way round

			const I = geo.index.array;
			for ( let t = 0; t < I.length; t += 3 ) { const x = I[ t + 1 ]; I[ t + 1 ] = I[ t + 2 ]; I[ t + 2 ] = x; }

		}
		if ( ! parts.has( mat ) ) parts.set( mat, [] );
		parts.get( mat ).push( geo );

	}

	const along = new THREE.Vector3( ...FLOOR_DETAIL.along ).transformDirection( M ), across = new THREE.Vector3( ...FLOOR_DETAIL.across ).transformDirection( M );
	for ( const mat of parts.keys() ) if ( mat.userData.grain ) addFloorDetail( mat, mat.userData.grain, along, across );
	const group = new THREE.Group();
	group.name = 'berlinHall';
	group.userData.lamps = [ ...parts.keys() ].filter( m => m.userData.lamp );
	for ( const [ mat, geos ] of parts ) {

		const geo = mergeGeometries( geos, false );
		geos.forEach( g => g.dispose() );
		const mesh = new THREE.Mesh( geo, mat );
		mesh.castShadow = ! mat.userData.lamp && ! mat.userData.grille;
		mesh.userData.ptNoOccluder = ! mesh.castShadow;		// (the path tracer too: pathtracer.js withPTMaterials; the chandeliers round their own lights)
		mesh.receiveShadow = true;
		if ( mat.userData.grille ) { mesh.userData.noAO = true; mesh.renderOrder = 1; }		// (transparent: not in GTAO's depth; after the floor)
		mesh.name = `berlinHall:${ mat.name }`;
		group.add( mesh );

	}
	for ( const { geo, mat, W } of busts ) {

		const mesh = new THREE.Mesh( geo, mat );
		mesh.matrixAutoUpdate = false; mesh.matrix.copy( W );		// (the dequantisation and its place: a uniform scale and a turn)
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.name = `berlinHall:${ mat.name }`;
		group.add( mesh );

	}
	await nextFrame();
	addChandeliers( group, M );
	for ( const g of gltfs ) g.scene.traverse( o => o.geometry?.dispose() );		// (the materials' textures: now ours)
	if ( renderer ) { berlinStatus.phase = 'upload'; await nextFrame(); await uploadTextures( group, renderer ); }
	return group;

}

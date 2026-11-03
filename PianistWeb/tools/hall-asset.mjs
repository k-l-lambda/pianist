// Footages.local/Berlin-Hall ->
// two compact GLBs of its geometry for the concert-hall venue: `stage` (the stage, the organ end
// and the hall beside them: loaded first) and `house` (the rest), with our own materials.
// Measured in the source and used here:
//   - Berlin_Hall.gltf has the geometry but no node transforms and no materials; file.osgjs has
//     both (12 MatrixTransforms, cm, z up; a StateSet per part, its material name), its
//     non-wireframe geometries in the same order and names as the glTF's nodes.
//   - Some 0.5 % of its triangles are shards: long slivers to unrelated vertices (strips rebuilt
//     wrongly by the downloader); dropped: a triangle whose face normal disagrees with one of its
//     vertex normals (|cos| < SHARD_COS) and whose longest edge is over SHARD_EDGE x the mesh's median;
//     or one with an edge no other triangle has that is over SHARD_LOCAL x the median edge at both its
//     ends (vertices welded by position), repeated until none is left (shards in the surface's plane).
//   - Many triangles are wound against their vertex normals (the strips' alternation lost): turned
//     round (double-sided, three.js would shade their back with the normal reversed: black).
//   - Its textures are scrambled (8x8 blocks shuffled, half of them black): not used. Parts get a
//     look by material name (LOOKS below: colours and finishes after photographs of the hall).
//   - The right wing (26 meshes) and the second chandelier mirror the left / first within 1.2 mm:
//     stored once, the other half an instance under a mirror matrix (x -> -x about the hall's axis).
//   - Few triangles are near the stage (2k within 6 m), 600k at 9-12 m (seats, ornaments): every
//     part is cut into bands along the hall (BAND m) and each band simplified to an error of
//     `--error-px` screen pixels at its nearest distance from where the camera goes (CAMERA_ZONE),
//     then the bands are joined again by material (one draw call per material and pack).
// Output frame: metres, y up, x across (the audience's right +), z from the stage's front edge
// towards the back of the hall (the stage at z < 0), y 0 at the stalls floor (the stage's front
// at 0.61 m). The frame and the options are in each GLB's extras.
//
//   node tools/hall-asset.mjs [--src ../Footages.local/Berlin-Hall] [--out <src>/build] [--error-px 1]
//        [--lock-border] [--no-simplify]
//
// --no-simplify: the same output without simplification (to compare against).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsSheen, KHRMeshQuantization } from '@gltf-transform/extensions';
import { cloneDocument, getBounds, join, prune, quantize, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- options ----
const opt = { src: '../Footages.local/Berlin-Hall', out: null, errorPx: 1, lockBorder: false, simplify: true };
const argv = process.argv.slice( 2 );
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--src' ) opt.src = v();
	else if ( a === '--out' ) opt.out = v();
	else if ( a === '--error-px' ) opt.errorPx = Number( v() );
	else if ( a === '--lock-border' ) opt.lockBorder = true;
	else if ( a === '--no-simplify' ) opt.simplify = false;
	else throw new Error( `unknown argument ${ a }` );

}
const SRC = path.resolve( root, opt.src ), OUT = path.resolve( root, opt.out ?? path.join( opt.src, 'build' ) );
fs.mkdirSync( OUT, { recursive: true } );

// screen: the default view (vertical FOV 36 deg, 1080 px): metres per pixel per metre of distance
const PX_PER_M = 2 * Math.tan( 36 / 2 * Math.PI / 180 ) / 1080;
const BAND = 4;			// m, along the hall (z)
const STAGE_Z = 0.5;		// bands wholly at z < this go to the stage pack
const SHARD_COS = 0.3, SHARD_EDGE = 3, SHARD_LOCAL = 4;

// ---- the source's frame -> ours. Source world (after file.osgjs's matrices): cm, z up; the hall's
// axis at x = -35.5 cm, the stage's front edge at y = 1205 cm (its floor there 804 cm, the stalls'
// 743 cm), the stage towards +y. Ours: x_h = x - axis, y_h = z - stalls, z_h = edge - y (metres).
const AXIS_X = - 35.5, EDGE_Y = 1205, STALLS_Z = 743.4;
const FRAME = [		// column-major (glTF): source world (cm) -> ours (m)
	0.01, 0, 0, 0,
	0, 0, - 0.01, 0,
	0, 0.01, 0, 0,
	- AXIS_X * 0.01, - STALLS_Z * 0.01, EDGE_Y * 0.01, 1,
];
const MIRROR = [ - 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];		// x -> -x (the axis is at 0)
// where the phone goes: round the piano on the stage (ours), for distances (symmetric in x, so a
// mirrored part is as far as its partner)
const CAMERA_ZONE = { min: [ - 3, 1.1, - 7 ], max: [ 3, 2.6, 0 ] };

// ---- looks (sRGB colours; after photographs of the Großer Saal: ivory walls and gilt mouldings,
// red velvet seats, oak floors, white marble busts). Per the source's material names.
const LOOKS = {
	ivory: { color: '#e8dfcc', roughness: 0.8 },
	ivoryGilt: { color: '#dcc79a', roughness: 0.5, metallic: 0.35 },		// cream with much gold leaf, seen from afar
	gilt: { color: '#d4ad5c', roughness: 0.32, metallic: 1 },
	velvet: { color: '#6e1410', roughness: 0.85, sheen: '#c0392b' },
	curtain: { color: '#5a1a12', roughness: 0.9, sheen: '#9a3a2a' },
	woodFrame: { color: '#4a2e1a', roughness: 0.55 },
	stageFloor: { color: '#b98a5c', roughness: 0.45 },
	stageFloorLight: { color: '#c99c6a', roughness: 0.42 },
	stagePanel: { color: '#c6a27a', roughness: 0.5 },
	parquet: { color: '#8a5a32', roughness: 0.4 },
	parquetDark: { color: '#5e3a1f', roughness: 0.45 },
	marble: { color: '#ece8e0', roughness: 0.3 },
	stone: { color: '#ddd5c6', roughness: 0.5 },
	plinth: { color: '#b8ab99', roughness: 0.35 },
	redMarble: { color: '#7d2a1f', roughness: 0.2 },
	organ: { color: '#c9c3b8', roughness: 0.3, metallic: 0.8 },
	wax: { color: '#f1ebdc', roughness: 0.6 },
};
const LOOK_OF = {
	'1er-oberrang-waende': 'ivory', '2ter-oberrang': 'ivoryGilt', '2ter-oberrang-old': 'ivoryGilt', 'beethoven-saal_saeule': 'ivoryGilt',
	'benches': 'ivory', 'brahms-buesten': 'marble', 'haendel-buesten-low': 'marble', 'wagner-buesten': 'marble',
	'bruestung-eins': 'ivoryGilt', 'bruestung-zwei-low': 'ivoryGilt', 'buehne-platten': 'stageFloor', 'buehnen-parkett': 'stageFloorLight',
	'buehne-wand': 'stagePanel', 'buesten-sockel': 'plinth', 'grauer-sockel': 'plinth', 'kerzen-staender-sockel': 'plinth',
	'chair-01': 'woodFrame', 'chair-2': 'woodFrame', 'chair-3': 'woodFrame', 'chair-4': 'woodFrame',
	'pillow-1': 'velvet', 'pillow-2': 'velvet', 'pillow-3': 'velvet', 'pillow-4-low': 'velvet', 'curtains-low': 'curtain',
	'decke': 'ivoryGilt', 'decke-parket': 'ivory', 'parkett-waende-tueren_diff': 'ivory',
	'fisch-saeule': 'gilt', 'ornament-traeger': 'gilt', 'orgel-ornament': 'gilt', 'kerzen-staender': 'gilt', 'kerzenstaender_klein': 'gilt', 'kronleuchter': 'gilt',
	'kerzen-2-low': 'wax', 'orgel': 'organ', 'statuen': 'stone', 'saeulen-klein': 'redMarble',
	'parkett': 'parquet', 'parkett-2': 'parquetDark', 'parkett-3': 'parquetDark', 'parkett-4': 'parquetDark', 'raenge-parkett': 'parquetDark', 'raenge-parkett2': 'parquetDark',
};
const linear = hex => [ 1, 3, 5 ].map( k => parseInt( hex.slice( k, k + 2 ), 16 ) / 255 ).map( c => c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 );

// ---- small helpers ----
const mul = ( a, b ) => {		// column-major 4x4: a * b

	const o = new Array( 16 ).fill( 0 );
	for ( let c = 0; c < 4; ++ c ) for ( let r = 0; r < 4; ++ r ) for ( let k = 0; k < 4; ++ k ) o[ c * 4 + r ] += a[ k * 4 + r ] * b[ c * 4 + k ];
	return o;

};
const boxDistance = ( a, b ) => Math.hypot( ...[ 0, 1, 2 ].map( k => Math.max( 0, a.min[ k ] - b.max[ k ], b.min[ k ] - a.max[ k ] ) ) );
const tris = d => d.getRoot().listMeshes().reduce( ( s, m ) => s + m.listPrimitives().reduce( ( t, p ) => t + ( p.getIndices()?.getCount() ?? 0 ) / 3, 0 ), 0 );
const log = [];
const say = s => { console.log( s ); log.push( s ); };

// ---- file.osgjs: per non-wireframe geometry, its world matrix and material name ----
function readOsg() {

	const o = JSON.parse( fs.readFileSync( path.join( SRC, 'file.osgjs' ), 'utf8' ) );
	const byId = new Map();
	( function collect( x ) {

		if ( Array.isArray( x ) ) return x.forEach( collect );
		if ( ! x || typeof x !== 'object' ) return;
		if ( 'UniqueID' in x && Object.keys( x ).length > 1 ) byId.set( x.UniqueID, x );
		Object.values( x ).forEach( collect );

	} )( o );
	const resolve = x => ( x && Object.keys( x ).length === 1 && 'UniqueID' in x ) ? byId.get( x.UniqueID ) : x;
	const out = [];
	( function walk( x, M ) {		// OSG: row vectors, row-major arrays = glTF's column-major as stored

		if ( Array.isArray( x ) ) return x.forEach( v => walk( v, M ) );
		if ( ! x || typeof x !== 'object' ) return;
		for ( const [ k, v ] of Object.entries( x ) ) {

			if ( k === 'osg.MatrixTransform' || k === 'osg.Node' ) walk( v.Children ?? [], v.Matrix ? mul( M, v.Matrix ) : M );
			else if ( k === 'osg.Geometry' ) {

				const ud = Object.fromEntries( ( v.UserDataContainer?.Values ?? [] ).map( d => [ d.Name, d.Value ] ) );
				if ( ud.wireframe === '1' ) continue;
				const ss = resolve( v.StateSet?.[ 'osg.StateSet' ] ) ?? {};
				const mat = resolve( ( ss.AttributeList ?? [] ).find( a => a[ 'osg.Material' ] )?.[ 'osg.Material' ] ) ?? {};
				out.push( { name: v.Name, M, material: mat.Name ?? null } );

			} else if ( v && typeof v === 'object' ) walk( v, M );

		}

	} )( o, [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] );
	return out;

}

/** Turn round the triangles wound against their vertex normals; returns how many. */
function fixWinding( prim ) {

	const P = prim.getAttribute( 'POSITION' ).getArray(), N = prim.getAttribute( 'NORMAL' )?.getArray(), I = prim.getIndices().getArray();
	if ( ! N ) return 0;
	let flipped = 0;
	for ( let t = 0; t < I.length; t += 3 ) {

		const [ a, b, c ] = [ 3 * I[ t ], 3 * I[ t + 1 ], 3 * I[ t + 2 ] ];
		const u = [ P[ b ] - P[ a ], P[ b + 1 ] - P[ a + 1 ], P[ b + 2 ] - P[ a + 2 ] ], v = [ P[ c ] - P[ a ], P[ c + 1 ] - P[ a + 1 ], P[ c + 2 ] - P[ a + 2 ] ];
		const f = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ];
		const d = [ a, b, c ].reduce( ( s, k ) => s + f[ 0 ] * N[ k ] + f[ 1 ] * N[ k + 1 ] + f[ 2 ] * N[ k + 2 ], 0 );
		if ( d < 0 ) { const x = I[ t + 1 ]; I[ t + 1 ] = I[ t + 2 ]; I[ t + 2 ] = x; ++ flipped; }

	}
	prim.getIndices().setArray( I );
	return flipped;

}

/** Drop the shard triangles of `prim` (see the header); returns how many. */
function dropShards( prim ) {

	const P = prim.getAttribute( 'POSITION' ).getArray(), N = prim.getAttribute( 'NORMAL' )?.getArray(), I = prim.getIndices().getArray();
	if ( ! N ) return 0;
	const n = I.length / 3, L = new Float32Array( n ), cos = new Float32Array( n );
	for ( let t = 0; t < n; ++ t ) {

		const [ a, b, c ] = [ 3 * I[ 3 * t ], 3 * I[ 3 * t + 1 ], 3 * I[ 3 * t + 2 ] ];
		const u = [ P[ b ] - P[ a ], P[ b + 1 ] - P[ a + 1 ], P[ b + 2 ] - P[ a + 2 ] ], v = [ P[ c ] - P[ a ], P[ c + 1 ] - P[ a + 1 ], P[ c + 2 ] - P[ a + 2 ] ];
		const f = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ], fl = Math.hypot( ...f ) || 1e-12;
		cos[ t ] = Math.min( ...[ a, b, c ].map( k => Math.abs( f[ 0 ] * N[ k ] + f[ 1 ] * N[ k + 1 ] + f[ 2 ] * N[ k + 2 ] ) / fl ) );
		L[ t ] = Math.max( Math.hypot( ...u ), Math.hypot( ...v ), Math.hypot( P[ c ] - P[ b ], P[ c + 1 ] - P[ b + 1 ], P[ c + 2 ] - P[ b + 2 ] ) );

	}
	const med = Float32Array.from( L ).sort()[ n >> 1 ];
	const alive = new Uint8Array( n ).fill( 1 );
	for ( let t = 0; t < n; ++ t ) if ( cos[ t ] < SHARD_COS && L[ t ] > SHARD_EDGE * med ) alive[ t ] = 0;
	// welded vertex ids (0.1 mm)
	const ids = new Map(), vid = new Uint32Array( P.length / 3 );
	for ( let v = 0; v < vid.length; ++ v ) {

		const k = `${ Math.round( P[ 3 * v ] * 1e4 ) },${ Math.round( P[ 3 * v + 1 ] * 1e4 ) },${ Math.round( P[ 3 * v + 2 ] * 1e4 ) }`;
		if ( ! ids.has( k ) ) ids.set( k, ids.size );
		vid[ v ] = ids.get( k );

	}
	const len = ( a, b ) => Math.hypot( P[ 3 * a ] - P[ 3 * b ], P[ 3 * a + 1 ] - P[ 3 * b + 1 ], P[ 3 * a + 2 ] - P[ 3 * b + 2 ] );
	for ( let pass = 0; pass < 8; ++ pass ) {

		const edges = new Map(), inc = Array.from( { length: ids.size }, () => [] );
		for ( let t = 0; t < n; ++ t ) if ( alive[ t ] ) for ( let c = 0; c < 3; ++ c ) {

			const a = I[ 3 * t + c ], b = I[ 3 * t + ( c + 1 ) % 3 ], u = vid[ a ], v = vid[ b ];
			if ( u === v ) continue;
			const k = u < v ? u * 4294967296 + v : v * 4294967296 + u, e = edges.get( k );
			if ( e ) ++ e.n; else { const l = len( a, b ); edges.set( k, { n: 1, l } ); inc[ u ].push( l ); inc[ v ].push( l ); }

		}
		const m = inc.map( x => x.length ? x.sort( ( p, q ) => p - q )[ x.length >> 1 ] : 0 );
		let dropped = 0;
		for ( let t = 0; t < n; ++ t ) if ( alive[ t ] ) for ( let c = 0; c < 3; ++ c ) {

			const u = vid[ I[ 3 * t + c ] ], v = vid[ I[ 3 * t + ( c + 1 ) % 3 ] ];
			if ( u === v ) continue;
			const e = edges.get( u < v ? u * 4294967296 + v : v * 4294967296 + u );
			if ( e.n === 1 && e.l > SHARD_LOCAL * m[ u ] && e.l > SHARD_LOCAL * m[ v ] ) { alive[ t ] = 0; ++ dropped; break; }

		}
		if ( ! dropped ) break;

	}
	const keep = [];
	for ( let t = 0; t < n; ++ t ) if ( alive[ t ] ) keep.push( I[ 3 * t ], I[ 3 * t + 1 ], I[ 3 * t + 2 ] );
	if ( keep.length === I.length ) return 0;
	prim.getIndices().setArray( new Uint32Array( keep ) );
	return n - keep.length / 3;

}

/** The triangles of `prim` in z bands of BAND m: [ { band, primitive } ] (new, compact accessors). */
function splitByZ( doc, prim ) {

	const P = prim.getAttribute( 'POSITION' ).getArray(), N = prim.getAttribute( 'NORMAL' )?.getArray(), I = prim.getIndices().getArray();
	const groups = new Map();
	for ( let t = 0; t < I.length; t += 3 ) {

		const z = ( P[ 3 * I[ t ] + 2 ] + P[ 3 * I[ t + 1 ] + 2 ] + P[ 3 * I[ t + 2 ] + 2 ] ) / 3;
		const b = Math.floor( z / BAND );
		if ( ! groups.has( b ) ) groups.set( b, [] );
		groups.get( b ).push( t );

	}
	const buffer = doc.getRoot().listBuffers()[ 0 ];
	return [ ...groups ].map( ( [ band, ts ] ) => {

		const remap = new Map(), idx = new Uint32Array( ts.length * 3 );
		ts.forEach( ( t, j ) => { for ( let c = 0; c < 3; ++ c ) { const v = I[ t + c ]; if ( ! remap.has( v ) ) remap.set( v, remap.size ); idx[ 3 * j + c ] = remap.get( v ); } } );
		const pos = new Float32Array( remap.size * 3 ), nor = N ? new Float32Array( remap.size * 3 ) : null;
		for ( const [ v, w ] of remap ) for ( let c = 0; c < 3; ++ c ) { pos[ 3 * w + c ] = P[ 3 * v + c ]; if ( nor ) nor[ 3 * w + c ] = N[ 3 * v + c ]; }
		const p = doc.createPrimitive().setMaterial( prim.getMaterial() )
			.setAttribute( 'POSITION', doc.createAccessor().setType( 'VEC3' ).setArray( pos ).setBuffer( buffer ) )
			.setIndices( doc.createAccessor().setType( 'SCALAR' ).setArray( idx ).setBuffer( buffer ) );
		if ( nor ) p.setAttribute( 'NORMAL', doc.createAccessor().setType( 'VEC3' ).setArray( nor ).setBuffer( buffer ) );
		return { band, primitive: p };

	} );

}

// ---- main ----
const t0 = Date.now();
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions( [ EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsSheen ] ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const doc = await io.read( path.join( SRC, 'Berlin_Hall.gltf' ) );
const osg = readOsg();
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[ 0 ];
const nodes = scene.listChildren();
if ( nodes.length !== osg.length ) throw new Error( `${ nodes.length } glTF nodes, ${ osg.length } osgjs geometries` );
nodes.forEach( ( n, i ) => { if ( n.getName() !== osg[ i ].name ) throw new Error( `node ${ i }: ${ n.getName() } vs ${ osg[ i ].name }` ); } );
say( `source: ${ nodes.length } nodes, ${ tris( doc ) } triangles` );

// 1. bake each mesh into our frame (every mesh is used by one node here); no texture coordinates
for ( const [ i, node ] of nodes.entries() ) {

	const M = mul( FRAME, osg[ i ].M );
	for ( const p of node.getMesh().listPrimitives() ) {

		const P = p.getAttribute( 'POSITION' ), A = P.getArray();
		for ( let k = 0; k < A.length; k += 3 ) {

			const [ x, y, z ] = [ A[ k ], A[ k + 1 ], A[ k + 2 ] ];
			A[ k ] = M[ 0 ] * x + M[ 4 ] * y + M[ 8 ] * z + M[ 12 ]; A[ k + 1 ] = M[ 1 ] * x + M[ 5 ] * y + M[ 9 ] * z + M[ 13 ]; A[ k + 2 ] = M[ 2 ] * x + M[ 6 ] * y + M[ 10 ] * z + M[ 14 ];

		}
		P.setArray( A );
		const Nm = p.getAttribute( 'NORMAL' );
		if ( Nm ) {		// rotation * uniform scale: the rotation, renormalised

			const B = Nm.getArray();
			for ( let k = 0; k < B.length; k += 3 ) {

				const v = [ M[ 0 ] * B[ k ] + M[ 4 ] * B[ k + 1 ] + M[ 8 ] * B[ k + 2 ], M[ 1 ] * B[ k ] + M[ 5 ] * B[ k + 1 ] + M[ 9 ] * B[ k + 2 ], M[ 2 ] * B[ k ] + M[ 6 ] * B[ k + 1 ] + M[ 10 ] * B[ k + 2 ] ];
				const l = Math.hypot( ...v ) || 1; B[ k ] = v[ 0 ] / l; B[ k + 1 ] = v[ 1 ] / l; B[ k + 2 ] = v[ 2 ] / l;

			}
			Nm.setArray( B );

		}
		for ( const s of p.listSemantics() ) if ( s !== 'POSITION' && s !== 'NORMAL' ) p.setAttribute( s, null );

	}
	node.setMatrix( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] );

}
let shards = 0, flipped = 0;
for ( const node of nodes ) for ( const p of node.getMesh().listPrimitives() ) { flipped += fixWinding( p ); shards += dropShards( p ); }
say( `triangles turned round: ${ flipped }; shards dropped: ${ shards }` );

// 2. materials by look
const sheenExt = doc.createExtension( KHRMaterialsSheen );
const materials = new Map(), unknown = new Set();
for ( const [ i, node ] of nodes.entries() ) {

	const name = osg[ i ].material ?? '';
	let look = LOOK_OF[ name ];
	if ( ! look ) { unknown.add( name ); look = 'ivory'; }
	if ( ! materials.has( look ) ) {

		const L = LOOKS[ look ];
		const m = doc.createMaterial( look ).setBaseColorFactor( [ ...linear( L.color ), 1 ] ).setRoughnessFactor( L.roughness ).setMetallicFactor( L.metallic ?? 0 ).setDoubleSided( true );
		if ( L.sheen ) m.setExtension( 'KHR_materials_sheen', sheenExt.createSheen().setSheenColorFactor( linear( L.sheen ) ).setSheenRoughnessFactor( 0.5 ) );
		materials.set( look, m );

	}
	for ( const p of node.getMesh().listPrimitives() ) p.setMaterial( materials.get( look ) );

}
if ( unknown.size ) say( `  no look for ${ [ ...unknown ].join( ', ' ) }: ivory` );

// 3. the mirrored halves: dropped here, instanced again from their partners when written
const byName = new Map( nodes.map( n => [ n.getName(), n ] ) );
const partnerOf = name => name.startsWith( 'rechter-fluegel_' ) ? name.replace( 'rechter-fluegel_', 'linker-fluegel_' )
	: name.startsWith( 'kerzen-kronleuchter-hell007_' ) ? name.replace( 'kerzen-kronleuchter-hell007_', 'kerzen-kronleuchter-hell006_' ) : null;
const shared = new Set();		// nodes whose mesh also appears mirrored
for ( const node of nodes ) {

	const other = byName.get( partnerOf( node.getName() ) ?? '' );
	if ( ! other ) continue;
	const a = getBounds( node ), b = getBounds( other );
	const err = Math.max( Math.abs( a.min[ 0 ] + b.max[ 0 ] ), Math.abs( a.max[ 0 ] + b.min[ 0 ] ), ...[ 1, 2 ].flatMap( k => [ Math.abs( a.min[ k ] - b.min[ k ] ), Math.abs( a.max[ k ] - b.max[ k ] ) ] ) );
	if ( err > 0.01 ) { say( `  not mirrored: ${ node.getName() } (bounds off by ${ ( err * 1000 ).toFixed( 1 ) } mm)` ); continue; }
	shared.add( other );
	node.getMesh().dispose(); node.dispose();

}
say( `mirrored: ${ shared.size } parts stored once (the other half instanced)` );

// 4. bands, simplified by distance; grouped by pack and by whether they are mirrored too
const groups = {};
const group = name => groups[ name ] ??= ( () => { const g = doc.createNode( name ); scene.addChild( g ); return g; } )();
let before = 0, after = 0; const perLook = {};
for ( const node of scene.listChildren().filter( n => n.getMesh() ) ) {

	for ( const prim of node.getMesh().listPrimitives() ) {

		before += prim.getIndices().getCount() / 3;
		const look = prim.getMaterial().getName(); perLook[ look ] ??= [ 0, 0 ]; perLook[ look ][ 0 ] += prim.getIndices().getCount() / 3;
		weldPrimitive( prim, {} );
		for ( const { band, primitive } of splitByZ( doc, prim ) ) {

			const P = primitive.getAttribute( 'POSITION' ), lo = P.getMin( [] ), hi = P.getMax( [] );
			if ( opt.simplify ) {

				const d = Math.max( 0.3, boxDistance( { min: lo, max: hi }, CAMERA_ZONE ) );
				const ext = Math.max( ...[ 0, 1, 2 ].map( k => hi[ k ] - lo[ k ] ), 1e-3 );
				simplifyPrimitive( primitive, { simplifier: MeshoptSimplifier, ratio: 0, error: opt.errorPx * PX_PER_M * d / ext, lockBorder: opt.lockBorder } );

			}
			after += primitive.getIndices().getCount() / 3; perLook[ look ][ 1 ] += primitive.getIndices().getCount() / 3;
			const pack = P.getMax( [] )[ 2 ] < STAGE_Z ? 'stage' : 'house';
			group( `${ pack }${ shared.has( node ) ? '-mirrored' : '' }` ).addChild( doc.createNode( `${ node.getName() }#${ band }` ).setMesh( doc.createMesh().addPrimitive( primitive ) ) );

		}

	}
	node.getMesh().dispose(); node.dispose();

}
await doc.transform( prune( { keepLeaves: true } ) );
say( '  ' + Object.entries( perLook ).map( ( [ k, [ a, b ] ] ) => `${ k } ${ a } -> ${ b }` ).join( ', ' ) );
say( `bands of ${ BAND } m${ opt.simplify ? `, simplified to ${ opt.errorPx } px${ opt.lockBorder ? ' (borders locked)' : '' }` : '' }: ${ before } -> ${ after } triangles stored` );

// 5. packs: join each group by material, instance the mirrored ones, quantise, compress
const meta = { frame: 'metres, y up, x across (audience right +), z from the stage front edge to the back of the hall (stage z < 0), y 0 at the stalls floor',
	stageFloor: { front: 0.61, back: 1.68 }, cameraZone: CAMERA_ZONE,
	source: 'Footages.local/Berlin-Hall geometry; own materials;',
	options: { errorPx: opt.errorPx, lockBorder: opt.lockBorder, simplify: opt.simplify, band: BAND } };
for ( const pack of [ 'stage', 'house' ] ) {

	const d = cloneDocument( doc ), s = d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[ 0 ];
	for ( const n of s.listChildren() ) if ( n.getName() !== pack && n.getName() !== `${ pack }-mirrored` ) { n.traverse( c => c.getMesh()?.dispose() ); n.dispose(); }
	await d.transform( prune(), join( { keepNamed: false } ), prune() );
	const m = s.listChildren().find( n => n.getName() === `${ pack }-mirrored` );
	if ( m ) {

		const mirror = d.createNode( `${ pack }-mirror` ).setMatrix( MIRROR );
		for ( const c of m.listChildren() ) mirror.addChild( d.createNode( c.getName() + '-mirror' ).setMesh( c.getMesh() ).setMatrix( c.getMatrix() ) );
		s.addChild( mirror );

	}
	d.getRoot().setExtras( { ...meta, pack } );
	await d.transform( reorder( { encoder: MeshoptEncoder } ), quantize( { quantizePosition: 16, quantizeNormal: 8 } ) );
	d.createExtension( EXTMeshoptCompression ).setRequired( true ).setEncoderOptions( { method: EXTMeshoptCompression.EncoderMethod.FILTER } );
	const f = path.join( OUT, `${ pack }${ opt.simplify ? '' : '.full' }.glb` );
	await io.write( f, d );
	let draws = 0; s.traverse( x => { draws += x.getMesh()?.listPrimitives().length ?? 0; } );
	say( `${ path.relative( root, f ) }: ${ ( fs.statSync( f ).size / 1e6 ).toFixed( 2 ) } MB, ${ tris( d ) } triangles stored in ${ d.getRoot().listMeshes().length } meshes, ${ draws } draw calls` );

}
say( `done in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );
fs.writeFileSync( path.join( OUT, opt.simplify ? 'build.log' : 'build.full.log' ), log.join( '\n' ) + '\n' );

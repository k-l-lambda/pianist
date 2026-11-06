// Luminara's pack (public/luminara/luminara.glb) from its generated sources (tools/luminara-gen.mjs,
// kept outside the repo):
//   furniture (tools/luminara-3d.py's TRELLIS meshes, <slug>-trellis.glb: vertex colour): welded,
//     simplified (meshopt) to about TRIS[ slug ] triangles, sized (SIZE: its height or length, m),
//     its base at y 0 and centred, its front +z (TRELLIS's, from the photo's three-quarter view);
//     split by the vertex colour into its materials (CLASSES: brass by its hue, etc.; the colour
//     kept per vertex where the material uses it)
//   wall reliefs (MoGe-2: tools/bust-depth.py, bust-relief.py's relief/<slug>.json, -normal.png):
//     at RELIEF[ slug ] m high, the photo as albedo (levelled), the object-space normal map, and
//     its raised pattern's glow (tools/relief-glow.py's -glow.png) as its emissive map
//   textures, each on a swatch (a small quad, not drawn: src/luminara.js takes its material's map):
//     the skies outside (sky-day, -sunset, -dusk, -night: wrapped round), the floor's marble (made to tile)
// Each a node named by its slug at the origin; src/luminara.js places copies of them.
//
//   node tools/luminara-asset.mjs --generated <dir> [--out public/luminara/luminara.glb]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMaterialsSheen, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, quantize, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const TRIS = { 'sofa-low': 26000, 'tub-chair': 20000, 'side-table': 9000, 'plant': 12000, 'sideboard': 6000, 'table-lamp': 6000, 'roses': 16000,
	'gold-disc': 4000, 'clef-statue': 6000, 'gold-ribbon': 6000, 'books': 8000, 'crystal': 4000,
	// the close-ups' ornaments, a cabinet, the banquette, a planter
	'pothos': 9000, 'armillary': 6000, 'figurine': 6000, 'crystal-gem': 3000, 'gramophone': 6000, 'hourglass': 4000, 'white-flowers': 9000, 'cloche': 4000,
	'astronaut': 6000, 'crystal-note': 3000, 'loop-sculpture': 4000, 'headphones': 5000, 'diffuser': 4000, 'metronome': 4000, 'whale-tail': 4000, 'radio': 5000,
	'coral-tree': 7000, 'mushroom-lamp': 4000, 'crystal-ball': 5000, 'small-cabinet': 4000, 'lily-planter': 10000,
	// more ornaments (each once), the bench's cushions
	'books-grey': 6000, 'books-gold': 6000, 'books-flat': 3000, 'perfume': 4000, 'shell': 5000, 'gold-star': 4000, 'brass-globe': 6000, 'jewelry-box': 4000,
	'clock': 4000, 'ceramic-vase': 3000, 'candles': 4000, 'olive-vase': 7000, 'cushion-square': 6000, 'cushion-lumbar': 6000, 'cushion-velvet': 6000 };		// (the banquette: built in its place, src/luminara.js BENCH)
// [ the axis sized ('y': height, 'x': length), m ]
const SIZE = { 'sofa-low': [ 'x', 2.3 ], 'tub-chair': [ 'x', 0.95 ], 'side-table': [ 'y', 1.05 ], 'plant': [ 'y', 1.6 ], 'sideboard': [ 'x', 1.7 ], 'table-lamp': [ 'y', 0.62 ],
	'roses': [ 'y', 0.32 ], 'gold-disc': [ 'y', 0.36 ], 'clef-statue': [ 'y', 0.34 ], 'gold-ribbon': [ 'y', 0.3 ], 'books': [ 'x', 0.42 ], 'crystal': [ 'y', 0.22 ],
	'pothos': [ 'x', 0.34 ], 'armillary': [ 'y', 0.32 ], 'figurine': [ 'y', 0.24 ], 'crystal-gem': [ 'y', 0.2 ], 'gramophone': [ 'y', 0.42 ], 'hourglass': [ 'y', 0.28 ],
	'white-flowers': [ 'y', 0.34 ], 'cloche': [ 'y', 0.3 ], 'astronaut': [ 'y', 0.26 ], 'crystal-note': [ 'y', 0.24 ], 'loop-sculpture': [ 'y', 0.28 ], 'headphones': [ 'y', 0.3 ],
	'diffuser': [ 'y', 0.26 ], 'metronome': [ 'y', 0.24 ], 'whale-tail': [ 'y', 0.26 ], 'radio': [ 'x', 0.34 ], 'coral-tree': [ 'x', 0.38 ], 'mushroom-lamp': [ 'y', 0.32 ],
	'crystal-ball': [ 'y', 0.26 ], 'small-cabinet': [ 'y', 1.0 ], 'banquette': [ 'x', 1.3 ], 'lily-planter': [ 'y', 1.05 ],
	'books-grey': [ 'x', 0.4 ], 'books-gold': [ 'x', 0.32 ], 'books-flat': [ 'x', 0.34 ], 'perfume': [ 'y', 0.18 ], 'shell': [ 'y', 0.24 ], 'gold-star': [ 'y', 0.3 ],
	'brass-globe': [ 'y', 0.3 ], 'jewelry-box': [ 'x', 0.24 ], 'clock': [ 'y', 0.2 ], 'ceramic-vase': [ 'y', 0.4 ], 'candles': [ 'x', 0.36 ], 'olive-vase': [ 'x', 0.42 ],
	'cushion-square': [ 'x', 0.46 ], 'cushion-lumbar': [ 'x', 0.56 ], 'cushion-velvet': [ 'x', 0.44 ] };
const RELIEF = { curtain: 2.9 };		// (the curtain of light's pleated curtain; the clef is a light, src/luminara.js; the shelves hold real ornaments)

// materials (glTF PBR; extras.look: src/luminara.js's finish) and which vertices take each:
// `test( r, g, b )` (0..1), first match; `vertexColor`: keep the decoder's colour
const MAT = {
	brass: { color: [ 0.83, 0.62, 0.32 ], metallic: 1, roughness: 0.28, look: 'brass' },
	brassPolished: { color: [ 0.88, 0.66, 0.36 ], metallic: 1, roughness: 0.1, look: 'brassPolished' },
	lacquer: { color: [ 0.93, 0.92, 0.9 ], roughness: 0.18, look: 'lacquer' },
	boucle: { color: [ 0.9, 0.87, 0.81 ], roughness: 0.95, look: 'boucle' },
	marble: { color: [ 0.92, 0.91, 0.9 ], roughness: 0.12, look: 'marble' },
	ceramic: { color: [ 0.92, 0.91, 0.88 ], roughness: 0.6, look: 'ceramic' },
	foliage: { color: [ 1, 1, 1 ], roughness: 0.7, look: 'foliage', vertexColor: true },
	natural: { color: [ 1, 1, 1 ], roughness: 0.8, look: 'natural', vertexColor: true },		// (pampas, the trunk, roses)
	books: { color: [ 1, 1, 1 ], roughness: 0.6, look: 'books', vertexColor: true },
	fabric: { color: [ 1, 1, 1 ], roughness: 0.92, look: 'fabric', vertexColor: true },		// (cushions: their own beige)
	stone: { color: [ 0.03, 0.03, 0.035 ], roughness: 0.15, look: 'stone' },		// (black marble)
	shade: { color: [ 0.95, 0.92, 0.86 ], roughness: 0.9, look: 'shade' },		// (a lamp's shade, lit through)
	crystal: { color: [ 0.93, 0.95, 0.97 ], roughness: 0.04, look: 'crystal' },
	glass: { color: [ 0.95, 0.97, 0.98 ], roughness: 0.03, look: 'glass' },		// (clear: src/luminara.js makes it see-through)
	silver: { color: [ 0.85, 0.86, 0.88 ], metallic: 1, roughness: 0.2, look: 'silver' },
};
// triangles dropped (by their mean colour) before sizing: what TRELLIS made of the photo's backdrop
const DROP = { 'crystal-ball': ( r, g, b ) => ( r + g + b ) / 3 < 0.1 };
// a base made more of (BASE[ slug ]): the brass band at the foot `scale`× as high (the rest raised on
// it), its surface smoothed (TRELLIS's is lumpy: no clean reflection), its material `mat`
const BASE = { 'sofa-low': { scale: 2, mat: 'brassPolished', smooth: 6 } };
// each test: ( r, g, b: the mean colour, 0..1; y: height, rad: distance from the axis, both in
// fractions of its height ), measured on the TRELLIS meshes (tools/luminara-3d.py's)
const warm = ( r, g, b ) => r - b > 0.18;		// brass: well above blue (the cream boucle's: 0.10-0.16)
const CLASSES = {
	'egg-chair': [ [ 'brass', ( r, g, b, y ) => y < 0.3 && warm( r, g, b ) || y < 0.06 ], [ 'boucle', ( r, g, b ) => r - b > 0.04 ], [ 'lacquer', () => true ] ],
	'sofa': [ [ 'brass', ( r, g, b, y ) => y < 0.1 && r - b > 0.2 ], [ 'boucle', () => true ] ],
	'side-table': [ [ 'brass', ( r, g, b, y ) => y < 0.6 ], [ 'marble', ( r, g, b, y ) => y < 0.645 ], [ 'natural', ( r, g, b, y ) => y > 0.78 || r - b > 0.1 ], [ 'ceramic', () => true ] ],
	'sofa-low': [ [ 'brass', ( r, g, b, y ) => y < 0.08 && r - b > 0.18 ], [ 'boucle', () => true ] ],
	'tub-chair': [ [ 'brass', ( r, g, b, y ) => y < 0.06 && r - b > 0.18 ], [ 'boucle', () => true ] ],
	'sideboard': [ [ 'brass', ( r, g, b, y ) => y < 0.18 && r - b > 0.1 ], [ 'lacquer', () => true ] ],
	'table-lamp': [ [ 'ceramic', ( r, g, b, y ) => y < 0.36 ], [ 'brass', ( r, g, b, y ) => y < 0.56 ], [ 'shade', () => true ] ],
	'roses': [ [ 'ceramic', ( r, g, b, y ) => y < 0.42 ], [ 'natural', () => true ] ],
	'gold-disc': [ [ 'brass', () => true ] ],
	'clef-statue': [ [ 'stone', ( r, g, b, y ) => y < 0.2 ], [ 'brass', () => true ] ],
	'gold-ribbon': [ [ 'stone', ( r, g, b, y ) => y < 0.08 ], [ 'ceramic', ( r, g, b ) => r - b < 0.08 && ( r + g + b ) / 3 > 0.5 ], [ 'brass', () => true ] ],
	'books': [ [ 'brass', ( r, g, b ) => r - b > 0.3 && g > 0.5 ], [ 'books', () => true ] ],
	'crystal': [ [ 'crystal', () => true ] ],
	// the close-ups' (tests by colour: warm = brass, green = leaves, bright and grey = glass or silver; by height for the parts)
	'pothos': [ [ 'ceramic', ( r, g, b, y ) => y < 0.42 && g - r < 0.04 ], [ 'foliage', () => true ] ],
	'armillary': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'glass', () => true ] ],
	'figurine': [ [ 'ceramic', () => true ] ],
	'crystal-gem': [ [ 'silver', ( r, g, b, y ) => y < 0.22 ], [ 'crystal', () => true ] ],
	'gramophone': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'silver', () => true ] ],
	'hourglass': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'natural', ( r, g, b, y ) => y < 0.45 && r - b > 0.05 ], [ 'glass', () => true ] ],
	'white-flowers': [ [ 'glass', ( r, g, b, y ) => y < 0.38 ], [ 'foliage', ( r, g, b ) => g > r + 0.04 && g > b ], [ 'ceramic', () => true ] ],
	'cloche': [ [ 'brass', ( r, g, b ) => r - b > 0.14 ], [ 'glass', () => true ] ],
	'astronaut': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'crystal-note': [ [ 'crystal', () => true ] ],
	'loop-sculpture': [ [ 'ceramic', () => true ] ],
	'headphones': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'diffuser': [ [ 'natural', ( r, g, b, y ) => y > 0.5 ], [ 'glass', () => true ] ],
	'metronome': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'glass', () => true ] ],
	'whale-tail': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'ceramic', () => true ] ],		// (its marble block: white)
	'radio': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'coral-tree': [ [ 'brass', ( r, g, b, y ) => y < 0.15 || r - b > 0.15 ], [ 'silver', () => true ] ],
	'mushroom-lamp': [ [ 'brass', () => true ] ],
	'crystal-ball': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', ( r, g, b, y ) => y < 0.42 ], [ 'glass', () => true ] ],
	'small-cabinet': [ [ 'brass', ( r, g, b, y ) => y < 0.18 ], [ 'lacquer', () => true ] ],		// (its legs)
	'banquette': [ [ 'brass', ( r, g, b, y ) => y < 0.08 && r - b > 0.15 ], [ 'lacquer', ( r, g, b, y ) => y < 0.42 ], [ 'boucle', () => true ] ],
	'lily-planter': [ [ 'ceramic', ( r, g, b, y ) => y < 0.53 ], [ 'brass', ( r, g, b, y ) => y < 0.57 && r - b > 0.08 ], [ 'foliage', ( r, g, b ) => g > r + 0.03 ], [ 'ceramic', () => true ] ],
	'books-grey': [ [ 'stone', ( r, g, b, y ) => false ], [ 'books', () => true ] ],
	'books-gold': [ [ 'brass', ( r, g, b ) => r - b > 0.2 && ( r + g + b ) / 3 > 0.45 ], [ 'books', () => true ] ],
	'books-flat': [ [ 'books', () => true ] ],
	'perfume': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'crystal', () => true ] ],
	'shell': [ [ 'brass', ( r, g, b, y ) => y < 0.35 && r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'gold-star': [ [ 'brass', () => true ] ],
	'brass-globe': [ [ 'ceramic', ( r, g, b, y ) => y < 0.12 && r - b < 0.1 ], [ 'brass', () => true ] ],
	'jewelry-box': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'lacquer', () => true ] ],
	'clock': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'ceramic', () => true ] ],
	'ceramic-vase': [ [ 'ceramic', () => true ] ],
	'candles': [ [ 'brass', ( r, g, b, y ) => y < 0.15 ], [ 'ceramic', () => true ] ],
	'olive-vase': [ [ 'ceramic', ( r, g, b, y ) => y < 0.55 && ( r + g + b ) / 3 > 0.55 && Math.abs( g - r ) < 0.05 ], [ 'foliage', () => true ] ],
	'cushion-square': [ [ 'fabric', () => true ] ], 'cushion-lumbar': [ [ 'fabric', () => true ] ], 'cushion-velvet': [ [ 'fabric', () => true ] ],
	'plant': [ [ 'brass', ( r, g, b, y ) => y > 0.35 && y < 0.41 && warm( r, g, b ) ], [ 'ceramic', ( r, g, b, y ) => y < 0.4 ], [ 'natural', ( r, g, b, y, rad ) => y < 0.56 || rad < 0.015 && y < 0.62 ], [ 'foliage', () => true ] ],
};

const opt = { generated: null, out: path.join( root, 'public', 'luminara', 'luminara.glb' ) };
const argv = process.argv.slice( 2 );
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--generated' ) opt.generated = v();
	else if ( a === '--out' ) opt.out = path.resolve( v() );
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! opt.generated ) throw new Error( 'usage: node tools/luminara-asset.mjs --generated <dir> [--out file.glb]' );
const G = opt.generated, t0 = Date.now(), say = s => console.log( s );

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions( [ EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsSheen, EXTTextureWebP ] ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene( 'luminara' );
doc.createExtension( EXTTextureWebP ).setRequired( true );
const mats = {};
const material = name => mats[ name ] ??= ( () => {

	const m = MAT[ name ];
	return doc.createMaterial( name ).setBaseColorFactor( [ ...m.color, 1 ] ).setMetallicFactor( m.metallic ?? 0 ).setRoughnessFactor( m.roughness ).setExtras( { look: m.look } );

} )();
const acc = ( type, array ) => doc.createAccessor().setType( type ).setArray( array ).setBuffer( buffer );

/** Smooth normals (area weighted) of an indexed mesh. */
function normalsOf( pos, idx ) {

	const nor = new Float32Array( pos.length );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = 3 * idx[ t ], b = 3 * idx[ t + 1 ], c = 3 * idx[ t + 2 ];
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ], vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
		for ( const o of [ a, b, c ] ) { nor[ o ] += fx; nor[ o + 1 ] += fy; nor[ o + 2 ] += fz; }

	}
	for ( let i = 0; i < nor.length; i += 3 ) { const l = Math.hypot( nor[ i ], nor[ i + 1 ], nor[ i + 2 ] ) || 1; nor[ i ] /= l; nor[ i + 1 ] /= l; nor[ i + 2 ] /= l; }
	return nor;

}

// ---- furniture ----
const src = new NodeIO();
for ( const slug of Object.keys( TRIS ) ) {

	const file = path.join( G, `${ slug }-trellis.glb` );
	if ( ! fs.existsSync( file ) ) { say( `${ slug }: no ${ path.basename( file ) } (tools/luminara-3d.py), skipped` ); continue; }
	const sd = await src.read( file ), p0 = sd.getRoot().listMeshes()[ 0 ].listPrimitives()[ 0 ];
	const n0 = p0.getIndices().getCount() / 3;
	weldPrimitive( p0, { overwrite: false } );
	simplifyPrimitive( p0, { simplifier: MeshoptSimplifier, ratio: Math.min( 1, TRIS[ slug ] / n0 ), error: 0.004, lockBorder: false } );
	const P = p0.getAttribute( 'POSITION' ).getArray(), C = p0.getAttribute( 'COLOR_0' );
	let I = p0.getIndices().getArray();
	const nv = P.length / 3, col = new Float32Array( nv * 3 );
	for ( let i = 0; i < nv; ++ i ) { const e = C.getElement( i, [] ); col[ 3 * i ] = e[ 0 ]; col[ 3 * i + 1 ] = e[ 1 ]; col[ 3 * i + 2 ] = e[ 2 ]; }
	if ( DROP[ slug ] ) {

		const keep = [];
		for ( let t = 0; t < I.length; t += 3 ) {

			let r = 0, g = 0, b = 0;
			for ( let j = 0; j < 3; ++ j ) { const v = I[ t + j ]; r += col[ 3 * v ] / 3; g += col[ 3 * v + 1 ] / 3; b += col[ 3 * v + 2 ] / 3; }
			if ( ! DROP[ slug ]( r, g, b ) ) keep.push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

		}
		say( `  ${ slug }: ${ ( I.length - keep.length ) / 3 } triangles of backdrop dropped` );
		I = new Uint32Array( keep );

	}
	// sized, its base on y 0, centred in x and z (over the vertices its triangles use)
	const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const v of I ) for ( let d = 0; d < 3; ++ d ) { lo[ d ] = Math.min( lo[ d ], P[ 3 * v + d ] ); hi[ d ] = Math.max( hi[ d ], P[ 3 * v + d ] ); }
	const [ axis, metres ] = SIZE[ slug ], k = metres / ( hi[ 'xyz'.indexOf( axis ) ] - lo[ 'xyz'.indexOf( axis ) ] );
	const pos = new Float32Array( P.length );
	for ( let i = 0; i < P.length; i += 3 ) { pos[ i ] = ( P[ i ] - ( lo[ 0 ] + hi[ 0 ] ) / 2 ) * k; pos[ i + 1 ] = ( P[ i + 1 ] - lo[ 1 ] ) * k; pos[ i + 2 ] = ( P[ i + 2 ] - ( lo[ 2 ] + hi[ 2 ] ) / 2 ) * k; }
	let nor = normalsOf( pos, I ), height = ( hi[ 1 ] - lo[ 1 ] ) * k;
	// each triangle's class: by its vertices' mean colour (and height, as a fraction)
	const classes = CLASSES[ slug ], tris = new Map();
	for ( let t = 0; t < I.length; t += 3 ) {

		let r = 0, g = 0, b = 0, y = 0, rad = 0;
		for ( let j = 0; j < 3; ++ j ) { const v = I[ t + j ]; r += col[ 3 * v ] / 3; g += col[ 3 * v + 1 ] / 3; b += col[ 3 * v + 2 ] / 3; y += pos[ 3 * v + 1 ] / 3 / height; rad += Math.hypot( pos[ 3 * v ], pos[ 3 * v + 2 ] ) / 3 / height; }
		const name = classes.find( ( [ , test ] ) => test( r, g, b, y, rad ) )[ 0 ];
		if ( ! tris.has( name ) ) tris.set( name, [] );
		tris.get( name ).push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

	}
	if ( BASE[ slug ] && tris.has( 'brass' ) ) {		// the base: higher, smoothed, its own material

		const B = BASE[ slug ], idx = tris.get( 'brass' ), inBase = new Uint8Array( nv );
		for ( const v of idx ) inBase[ v ] = 1;
		const ys = [ ...new Set( idx ) ].map( v => pos[ 3 * v + 1 ] ).sort( ( a, b ) => a - b ), yb = ys[ Math.floor( ys.length * 0.85 ) ];		// (its top)
		for ( let v = 0; v < nv; ++ v ) { const y = pos[ 3 * v + 1 ]; pos[ 3 * v + 1 ] = y <= yb ? y * B.scale : y + yb * ( B.scale - 1 ); }
		// smoothed: its vertices to their neighbours' mean, a few times (the rest kept)
		const nb = Array.from( { length: nv }, () => [] );
		for ( let t = 0; t < I.length; t += 3 ) for ( let j = 0; j < 3; ++ j ) { const a = I[ t + j ], b = I[ t + ( j + 1 ) % 3 ]; if ( inBase[ a ] || inBase[ b ] ) { nb[ a ].push( b ); nb[ b ].push( a ); } }
		for ( let it = 0; it < B.smooth; ++ it ) {

			const nxt = pos.slice();
			for ( let v = 0; v < nv; ++ v ) {

				if ( ! inBase[ v ] || ! nb[ v ].length ) continue;
				let x = 0, y = 0, z = 0;
				for ( const u of nb[ v ] ) { x += pos[ 3 * u ]; y += pos[ 3 * u + 1 ]; z += pos[ 3 * u + 2 ]; }
				const n = nb[ v ].length;
				nxt[ 3 * v ] = 0.5 * pos[ 3 * v ] + 0.5 * x / n; nxt[ 3 * v + 1 ] = Math.max( 0, 0.5 * pos[ 3 * v + 1 ] + 0.5 * y / n ); nxt[ 3 * v + 2 ] = 0.5 * pos[ 3 * v + 2 ] + 0.5 * z / n;

			}
			pos.set( nxt );

		}
		nor = normalsOf( pos, I );
		height += yb * ( B.scale - 1 );
		tris.set( B.mat, idx ); tris.delete( 'brass' );
		say( `  ${ slug }: its base ${ ( yb * 100 ).toFixed( 1 ) } -> ${ ( yb * B.scale * 100 ).toFixed( 1 ) } cm, smoothed, ${ B.mat }` );

	}
	const posA = acc( 'VEC3', pos ), norA = acc( 'VEC3', nor ), colA = acc( 'VEC3', col );
	const mesh = doc.createMesh( slug ), parts = [];
	for ( const [ name, idx ] of tris ) {

		const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', new Uint32Array( idx ) ) ).setAttribute( 'POSITION', posA ).setAttribute( 'NORMAL', norA ).setMaterial( material( name ) );
		if ( MAT[ name ].vertexColor ) prim.setAttribute( 'COLOR_0', colA );
		mesh.addPrimitive( prim );
		parts.push( `${ name } ${ idx.length / 3 }` );

	}
	scene.addChild( doc.createNode( slug ).setMesh( mesh ).setExtras( { kind: 'furniture', size: [ ( hi[ 0 ] - lo[ 0 ] ) * k, height, ( hi[ 2 ] - lo[ 2 ] ) * k ].map( v => +v.toFixed( 3 ) ) } ) );
	say( `${ slug }: ${ n0 } -> ${ I.length / 3 } triangles, ${ ( ( hi[ 0 ] - lo[ 0 ] ) * k ).toFixed( 2 ) } x ${ height.toFixed( 2 ) } x ${ ( ( hi[ 2 ] - lo[ 2 ] ) * k ).toFixed( 2 ) } m; ${ parts.join( ', ' ) }` );

}

// ---- wall reliefs ----
const dec = ( b, T ) => { const u = Buffer.from( b, 'base64' ); return new T( u.buffer.slice( u.byteOffset, u.byteOffset + u.byteLength ) ); };
for ( const [ slug, h ] of Object.entries( RELIEF ) ) {

	const file = path.join( G, 'relief', `${ slug }.json` );
	if ( ! fs.existsSync( file ) ) { say( `${ slug }: no relief (tools/bust-depth.py, bust-relief.py), skipped` ); continue; }
	const R = JSON.parse( fs.readFileSync( file, 'utf8' ) ), k = h / R.size[ 1 ];
	const pos = dec( R.positions, Float32Array ), uv = dec( R.uvs, Float32Array ), idx = dec( R.indices, Uint32Array );
	let zmin = Infinity;
	for ( let i = 0; i < pos.length; i += 3 ) { pos[ i ] *= k; pos[ i + 1 ] *= k; pos[ i + 2 ] *= k; zmin = Math.min( zmin, pos[ i + 2 ] ); }
	for ( let i = 2; i < pos.length; i += 3 ) pos[ i ] -= zmin;		// (its back on z 0: the wall)
	for ( let i = 1; i < uv.length; i += 2 ) uv[ i ] = 1 - uv[ i ];		// (glTF: v down the image)
	// the photo as albedo: its light levelled (a broad blur divided out), to plaster white
	const photo = sharp( fs.readFileSync( path.join( G, `${ slug }-raw.jpg` ) ) ).removeAlpha().resize( 1024, 1024 );
	const { data } = await photo.clone().raw().toBuffer( { resolveWithObject: true } );
	const { data: blur } = await photo.clone().blur( 60 ).raw().toBuffer( { resolveWithObject: true } );
	const out = Buffer.alloc( data.length );
	for ( let i = 0; i < data.length; i += 3 ) {

		const l = ( blur[ i ] + blur[ i + 1 ] + blur[ i + 2 ] ) / 3 || 1;
		for ( let c = 0; c < 3; ++ c ) out[ i + c ] = Math.min( 255, Math.round( data[ i + c ] / l * 222 ) );

	}
	const albedo = await sharp( out, { raw: { width: 1024, height: 1024, channels: 3 } } ).webp( { quality: 88, effort: 5 } ).toBuffer();
	const nmap = await sharp( fs.readFileSync( path.join( G, 'relief', `${ slug }-normal.png` ) ) ).removeAlpha().resize( 1024, 1024, { fit: 'fill', kernel: 'lanczos3' } ).webp( { quality: 92, effort: 6 } ).toBuffer();
	// its self-lit pattern (tools/relief-glow.py: where it stands out of its panel), if made
	let glow = null;
	const glowFile = path.join( G, 'relief', `${ slug }-glow.png` );
	if ( fs.existsSync( glowFile ) ) glow = await sharp( fs.readFileSync( glowFile ) ).resize( 1024, 1024 ).webp( { quality: 90 } ).toBuffer();
	const mat = doc.createMaterial( `relief-${ slug }` ).setBaseColorFactor( [ 1, 1, 1, 1 ] ).setRoughnessFactor( 0.55 ).setMetallicFactor( 0 ).setDoubleSided( true )
		.setBaseColorTexture( doc.createTexture( `${ slug }-albedo` ).setImage( albedo ).setMimeType( 'image/webp' ) )
		.setNormalTexture( doc.createTexture( `${ slug }-normal` ).setImage( nmap ).setMimeType( 'image/webp' ) )
		.setExtras( { look: 'relief', objectNormal: true } );
	if ( glow ) mat.setEmissiveTexture( doc.createTexture( `${ slug }-glow` ).setImage( glow ).setMimeType( 'image/webp' ) ).setEmissiveFactor( [ 1, 1, 1 ] );
	const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', idx ) ).setAttribute( 'POSITION', acc( 'VEC3', pos ) ).setAttribute( 'NORMAL', acc( 'VEC3', normalsOf( pos, idx ) ) )
		.setAttribute( 'TEXCOORD_0', acc( 'VEC2', uv ) ).setMaterial( mat );
	simplifyPrimitive( prim, { simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.0015 / h, lockBorder: true } );
	scene.addChild( doc.createNode( slug ).setMesh( doc.createMesh( slug ).addPrimitive( prim ) ).setExtras( { kind: 'relief', size: [ R.size[ 0 ] * k, h, R.size[ 2 ] * k ].map( v => +v.toFixed( 3 ) ) } ) );
	say( `${ slug }: relief ${ ( R.size[ 0 ] * k ).toFixed( 2 ) } x ${ h } m, ${ prim.getIndices().getCount() / 3 } triangles; albedo ${ ( albedo.length / 1024 ).toFixed( 0 ) } KB, normal ${ ( nmap.length / 1024 ).toFixed( 0 ) } KB` );

}

// ---- textures, on swatches ----
/** The image made to tile: blended with itself shifted by half (the seams to the middle), by distance from the middle. */
async function tileable( buf, size ) {

	const { data } = await sharp( buf ).removeAlpha().resize( size, size ).raw().toBuffer( { resolveWithObject: true } );
	const out = Buffer.alloc( data.length ), h = size / 2;
	for ( let y = 0; y < size; ++ y ) for ( let x = 0; x < size; ++ x ) {

		const dx = Math.abs( x - h ) / h, dy = Math.abs( y - h ) / h, w = Math.min( 1, Math.max( 0, ( Math.max( dx, dy ) - 0.55 ) / 0.4 ) );		// (0 in the middle, 1 at the edge)
		const a = 3 * ( y * size + x ), b = 3 * ( ( ( y + h ) % size ) * size + ( x + h ) % size );
		for ( let c = 0; c < 3; ++ c ) out[ a + c ] = Math.round( data[ a + c ] * ( 1 - w ) + data[ b + c ] * w );

	}
	return sharp( out, { raw: { width: size, height: size, channels: 3 } } );

}
const swatch = ( slug, mat ) => {

	const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', new Uint32Array( [ 0, 1, 2 ] ) ) ).setAttribute( 'POSITION', acc( 'VEC3', new Float32Array( [ 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0 ] ) ) )
		.setAttribute( 'TEXCOORD_0', acc( 'VEC2', new Float32Array( [ 0, 0, 1, 0, 0, 1 ] ) ) ).setMaterial( mat );
	scene.addChild( doc.createNode( slug ).setMesh( doc.createMesh( slug ).addPrimitive( prim ) ).setExtras( { kind: 'swatch' } ) );

};
// the windows' outside, one per hour (src/luminara.js's presets: `outside`): the day's and the
// same city at other hours (tools/luminara-gen.mjs); the old single sky if none of them
{

	let skies = [ 'sky-day', 'sky-sunset', 'sky-dusk', 'sky-night' ].filter( k => fs.existsSync( path.join( G, `${ k }-raw.jpg` ) ) );
	if ( ! skies.length && fs.existsSync( path.join( G, 'sky-raw.jpg' ) ) ) skies = [ 'sky' ];
	for ( const k of skies ) {

		const b = await sharp( fs.readFileSync( path.join( G, `${ k }-raw.jpg` ) ) ).resize( 3072, 1024 ).webp( { quality: 80, effort: 5 } ).toBuffer();
		swatch( k, doc.createMaterial( k ).setBaseColorTexture( doc.createTexture( k ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'sky' } ) );
		say( `${ k }: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

	}

}
for ( const k of [ 'painting-1', 'painting-2', 'painting-3' ] ) if ( fs.existsSync( path.join( G, `${ k }-raw.jpg` ) ) ) {		// (the paintings: whole)

	const b = await sharp( fs.readFileSync( path.join( G, `${ k }-raw.jpg` ) ) ).resize( 1200 ).webp( { quality: 86, effort: 5 } ).toBuffer();
	swatch( k, doc.createMaterial( k ).setBaseColorTexture( doc.createTexture( k ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'painting' } ) );
	say( `${ k }: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}
if ( fs.existsSync( path.join( G, 'rug-raw.jpg' ) ) ) {		// the rug's pattern (a round rug seen from above, filling the square)

	const b = await sharp( fs.readFileSync( path.join( G, 'rug-raw.jpg' ) ) ).resize( 2048, 2048 ).webp( { quality: 88, effort: 5 } ).toBuffer();
	swatch( 'rug', doc.createMaterial( 'rug' ).setBaseColorTexture( doc.createTexture( 'rug' ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'rug' } ) );
	say( `rug: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}
if ( fs.existsSync( path.join( G, 'marble-raw.jpg' ) ) ) {

	const b = await ( await tileable( fs.readFileSync( path.join( G, 'marble-raw.jpg' ) ), 1024 ) ).webp( { quality: 86, effort: 5 } ).toBuffer();
	swatch( 'marble', doc.createMaterial( 'marble-floor' ).setBaseColorTexture( doc.createTexture( 'marble' ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'marble' } ) );
	say( `marble: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}

// ---- the baked light (tools/luminara-bake.mjs): the static shell as baked (its meshes with their
// lightmap UVs, TEXCOORD_1; node shell-<i>, in src/luminara.js's bakeTargets() order) and a lightmap
// per preset, beside the pack (lightmaps/<slug>.webp, sRGB-encoded under its scale: fetched when its preset
// is shown, not with the pack); bake-meta's extras: the shell's hash, each preset's slug, scale and file.
// src/luminara.js uses them while its procedural shell still hashes the same.
{

	const B = path.join( G, 'bake' ), metaFile = path.join( B, 'bake.json' ), shellFile = path.join( B, 'shell.json' );
	if ( fs.existsSync( metaFile ) && fs.existsSync( shellFile ) ) {

		const meta = JSON.parse( fs.readFileSync( metaFile, 'utf8' ) ), shell = JSON.parse( fs.readFileSync( shellFile, 'utf8' ) ), dummy = doc.createMaterial( 'shell' );
		const f32 = b => { const u = Buffer.from( b, 'base64' ); return new Float32Array( u.buffer.slice( u.byteOffset, u.byteOffset + u.byteLength ) ); };
		const u32 = b => { const u = Buffer.from( b, 'base64' ); return new Uint32Array( u.buffer.slice( u.byteOffset, u.byteOffset + u.byteLength ) ); };
		let tris = 0;
		for ( const m of shell.meshes ) {

			const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', u32( m.index ) ) ).setAttribute( 'POSITION', acc( 'VEC3', f32( m.position ) ) ).setAttribute( 'NORMAL', acc( 'VEC3', f32( m.normal ) ) )
				.setAttribute( 'TEXCOORD_0', acc( 'VEC2', f32( m.uv ) ) ).setAttribute( 'TEXCOORD_1', acc( 'VEC2', f32( m.uvBake ) ) ).setMaterial( dummy );
			weldPrimitive( prim, { overwrite: true } );		// (identical corners: one vertex)
			tris += prim.getIndices().getCount() / 3;
			scene.addChild( doc.createNode( `shell-${ m.i }` ).setMesh( doc.createMesh( `shell-${ m.i }` ).addPrimitive( prim ) ).setExtras( { kind: 'shell', of: m.name } ) );

		}
		const presets = {}, dir = path.join( path.dirname( opt.out ), 'lightmaps' );
		let bytes = 0;
		fs.rmSync( dir, { recursive: true, force: true } ); fs.mkdirSync( dir, { recursive: true } );
		for ( const [ name, p ] of Object.entries( meta.presets ) ) {

			if ( ! Number.isFinite( p.scale ) ) { say( `  ${ name }: its bake failed (scale ${ p.scale }): left out` ); continue; }
			const slug = path.basename( p.file, '.png' ), b = await sharp( fs.readFileSync( path.join( B, p.file ) ) ).webp( { quality: 94, smartSubsample: true, effort: 6 } ).toBuffer();
			fs.writeFileSync( path.join( dir, `${ slug }.webp` ), b );
			presets[ name ] = { slug, scale: p.scale, file: `lightmaps/${ slug }.webp` };
			bytes += b.length;

		}
		scene.addChild( doc.createNode( 'bake-meta' ).setExtras( { kind: 'bake', hash: meta.hash, size: meta.size, texels: meta.texels, presets } ) );
		say( `baked: the shell (${ shell.meshes.length } meshes, ${ tris } triangles) and ${ Object.keys( presets ).length } lightmaps of ${ meta.size } (${ ( bytes / 1024 ).toFixed( 0 ) } KB, in ${ path.relative( root, dir ) }/), hash ${ meta.hash }` );

	}

}
await doc.transform( prune( { keepAttributes: true, keepLeaves: true } ) );
await doc.transform( reorder( { encoder: MeshoptEncoder } ), quantize( { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 } )		/* (texcoords: the lightmap's UVs within a texel of 2048) */ );
doc.createExtension( EXTMeshoptCompression ).setRequired( true ).setEncoderOptions( { method: EXTMeshoptCompression.EncoderMethod.FILTER } );
doc.getRoot().setExtras( { source: 'tools/luminara-asset.mjs', generated: new Date().toISOString() } );
fs.mkdirSync( path.dirname( opt.out ), { recursive: true } );
await io.write( opt.out, doc );
say( `${ path.relative( root, opt.out ) }: ${ ( fs.statSync( opt.out ).size / 1e6 ).toFixed( 2 ) } MB in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );

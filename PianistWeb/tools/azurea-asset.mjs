// Azurea's pack (public/azurea/azurea.glb) from its generated sources (tools/azurea-gen.mjs, kept outside the
// repo, and tools/luminara-3d.py's TRELLIS meshes):
//   furniture (<slug>-trellis.glb: vertex colour): welded, simplified (meshopt) to about TRIS[ slug ] triangles,
//     sized (SIZE: its height or length, m), its base at y 0 and centred, its front +z (TRELLIS's); split by
//     its colour and height into its materials (CLASSES; the colour kept per vertex where the material uses it:
//     the leaves)
//   pictures and textures, each on a swatch (a small quad, not drawn: src/azurea.js takes its material's map):
//     the sea outside (by day, at golden hour, at night), the floor's marble (made to tile), the bar's bottle wall
// Each a node named by its slug at the origin; src/azurea.js places copies of them.
//
//   node tools/azurea-asset.mjs --generated <dir> [--out public/azurea/azurea.glb] [--only a,b]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, quantize, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const TRIS = { 'sofa': 30000, 'lounge-chair': 24000, 'bar-stool': 14000, 'plant-tall': 42000, 'plant-low': 42000 };
// [ the axis sized ('y': height, 'x': length), m ]
const SIZE = { 'sofa': [ 'x', 2.6 ], 'lounge-chair': [ 'y', 0.86 ], 'bar-stool': [ 'y', 1.02 ], 'plant-tall': [ 'y', 1.9 ], 'plant-low': [ 'x', 1.15 ] };
// each triangle's material: the first test its mean colour (0..1), its height (a fraction of the object's) and its
// radius (a fraction of the height) pass (measured: tools' splat preview; the pillows' blue b - r ~0.12, the pot white)
const blueish = ( r, g, b ) => b - r > 0.07;
const green = ( r, g, b ) => g > r + 0.05 && g > b - 0.02;
const CLASSES = {
	'sofa': [ [ 'chrome', ( r, g, b, y ) => y < 0.12 && ( r + g + b ) / 3 < 0.45 ], [ 'velvetBlue', blueish ], [ 'boucle', () => true ] ],
	'lounge-chair': [ [ 'chrome', ( r, g, b, y ) => y < 0.24 ], [ 'velvetBlue', blueish ], [ 'boucle', () => true ] ],
	'bar-stool': [ [ 'chrome', ( r, g, b, y ) => y < 0.62 ], [ 'leather', () => true ] ],
	'plant-tall': [ [ 'leaf', green ], [ 'ceramic', ( r, g, b, y ) => y < 0.34 ], [ 'leaf', () => true ] ],
	'plant-low': [ [ 'leaf', green ], [ 'ceramic', ( r, g, b, y ) => y < 0.48 ], [ 'leaf', () => true ] ],
};
// the pack's materials: extras.look (src/azurea.js makes each its own), the colour kept where vertexColor
const MAT = {
	chrome: { color: [ 0.85, 0.86, 0.88 ] }, velvetBlue: { color: [ 0.62, 0.76, 0.84 ] }, boucle: { color: [ 0.94, 0.93, 0.9 ] },
	leather: { color: [ 0.95, 0.94, 0.92 ] }, ceramic: { color: [ 0.95, 0.95, 0.94 ] }, leaf: { color: [ 1, 1, 1 ], vertexColor: true },
};

const opt = { generated: null, out: path.join( root, 'public', 'azurea', 'azurea.glb' ), only: null };
const argv = process.argv.slice( 2 );
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--generated' ) opt.generated = path.resolve( v() );
	else if ( a === '--out' ) opt.out = path.resolve( v() );
	else if ( a === '--only' ) opt.only = new Set( v().split( ',' ) );
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! opt.generated ) throw new Error( 'usage: node tools/azurea-asset.mjs --generated <dir> [--out file.glb]' );
const G = opt.generated, say = s => console.log( s ), t0 = Date.now();
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions( [ EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP ] ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene( 'azurea' );
const acc = ( type, array ) => doc.createAccessor().setType( type ).setArray( array ).setBuffer( buffer );
const mats = new Map();
const material = name => {

	if ( ! mats.has( name ) ) mats.set( name, doc.createMaterial( name ).setBaseColorFactor( [ ...MAT[ name ].color, 1 ] ).setRoughnessFactor( 0.8 ).setMetallicFactor( 0 ).setExtras( { look: name } ) );
	return mats.get( name );

};

/** Smooth vertex normals of an indexed triangle list (area-weighted). */
function normalsOf( pos, idx ) {

	const n = new Float32Array( pos.length );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ], vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		for ( const v of [ a, b, c ] ) { n[ v ] += nx; n[ v + 1 ] += ny; n[ v + 2 ] += nz; }

	}
	for ( let i = 0; i < n.length; i += 3 ) { const l = Math.hypot( n[ i ], n[ i + 1 ], n[ i + 2 ] ) || 1; n[ i ] /= l; n[ i + 1 ] /= l; n[ i + 2 ] /= l; }
	return n;

}

// ---- furniture ----
const src = new NodeIO();
for ( const slug of Object.keys( TRIS ) ) {

	if ( opt.only && ! opt.only.has( slug ) ) continue;
	const file = path.join( G, `${ slug }-trellis.glb` );
	if ( ! fs.existsSync( file ) ) { say( `${ slug }: no ${ path.basename( file ) } (tools/luminara-3d.py), skipped` ); continue; }
	const sd = await src.read( file ), p0 = sd.getRoot().listMeshes()[ 0 ].listPrimitives()[ 0 ];
	const n0 = p0.getIndices().getCount() / 3;
	weldPrimitive( p0, { overwrite: false } );
	simplifyPrimitive( p0, { simplifier: MeshoptSimplifier, ratio: Math.min( 1, TRIS[ slug ] / n0 ), error: 0.004, lockBorder: false } );
	const P = p0.getAttribute( 'POSITION' ).getArray(), C = p0.getAttribute( 'COLOR_0' ), I0 = p0.getIndices().getArray();
	const nv = P.length / 3, col = new Float32Array( nv * 3 );
	for ( let i = 0; i < nv; ++ i ) { const e = C.getElement( i, [] ); col[ 3 * i ] = e[ 0 ]; col[ 3 * i + 1 ] = e[ 1 ]; col[ 3 * i + 2 ] = e[ 2 ]; }
	// the photo's contact shadow, kept by TRELLIS as a flat plate under the piece: low triangles outside the
	// footprint of what stands above it (the body over 12 % of its height, a margin of 4 %) dropped
	let I = I0;
	{

		let y0 = Infinity, y1 = - Infinity;
		for ( const v of I ) { y0 = Math.min( y0, P[ 3 * v + 1 ] ); y1 = Math.max( y1, P[ 3 * v + 1 ] ); }
		const H = y1 - y0, fl = [ Infinity, Infinity ], fh = [ - Infinity, - Infinity ];
		for ( const v of I ) if ( P[ 3 * v + 1 ] > y0 + 0.12 * H ) { fl[ 0 ] = Math.min( fl[ 0 ], P[ 3 * v ] ); fh[ 0 ] = Math.max( fh[ 0 ], P[ 3 * v ] ); fl[ 1 ] = Math.min( fl[ 1 ], P[ 3 * v + 2 ] ); fh[ 1 ] = Math.max( fh[ 1 ], P[ 3 * v + 2 ] ); }
		const mx = 0.04 * Math.max( fh[ 0 ] - fl[ 0 ], fh[ 1 ] - fl[ 1 ] ), keep = [];
		for ( let t = 0; t < I.length; t += 3 ) {

			let cx = 0, cy = 0, cz = 0;
			for ( let j = 0; j < 3; ++ j ) { const v = I[ t + j ]; cx += P[ 3 * v ] / 3; cy += P[ 3 * v + 1 ] / 3; cz += P[ 3 * v + 2 ] / 3; }
			const outside = cx < fl[ 0 ] - mx || cx > fh[ 0 ] + mx || cz < fl[ 1 ] - mx || cz > fh[ 1 ] + mx;
			if ( ! ( cy < y0 + 0.05 * H && outside ) ) keep.push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

		}
		if ( keep.length < I.length ) say( `  ${ slug }: ${ ( I.length - keep.length ) / 3 } triangles of the contact shadow's plate dropped` );
		I = new Uint32Array( keep );

	}
	// sized, its base on y 0, centred in x and z
	const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const v of I ) for ( let d = 0; d < 3; ++ d ) { lo[ d ] = Math.min( lo[ d ], P[ 3 * v + d ] ); hi[ d ] = Math.max( hi[ d ], P[ 3 * v + d ] ); }
	const [ axis, metres ] = SIZE[ slug ], k = metres / ( hi[ 'xyz'.indexOf( axis ) ] - lo[ 'xyz'.indexOf( axis ) ] );
	const pos = new Float32Array( P.length );
	for ( let i = 0; i < P.length; i += 3 ) { pos[ i ] = ( P[ i ] - ( lo[ 0 ] + hi[ 0 ] ) / 2 ) * k; pos[ i + 1 ] = ( P[ i + 1 ] - lo[ 1 ] ) * k; pos[ i + 2 ] = ( P[ i + 2 ] - ( lo[ 2 ] + hi[ 2 ] ) / 2 ) * k; }
	const height = ( hi[ 1 ] - lo[ 1 ] ) * k, nor = normalsOf( pos, I );
	// each triangle's class
	const tris = new Map();
	for ( let t = 0; t < I.length; t += 3 ) {

		let r = 0, g = 0, b = 0, y = 0, rad = 0;
		for ( let j = 0; j < 3; ++ j ) { const v = I[ t + j ]; r += col[ 3 * v ] / 3; g += col[ 3 * v + 1 ] / 3; b += col[ 3 * v + 2 ] / 3; y += pos[ 3 * v + 1 ] / 3 / height; rad += Math.hypot( pos[ 3 * v ], pos[ 3 * v + 2 ] ) / 3 / height; }
		const name = CLASSES[ slug ].find( ( [ , test ] ) => test( r, g, b, y, rad ) )[ 0 ];
		if ( ! tris.has( name ) ) tris.set( name, [] );
		tris.get( name ).push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

	}
	const mesh = doc.createMesh( slug ), list = [];
	for ( const [ name, ix ] of tris ) {

		// its own vertices
		const map = new Map(), vp = [], vn = [], vc = [], ni = new Uint32Array( ix.length );
		ix.forEach( ( v, j ) => { if ( ! map.has( v ) ) { map.set( v, map.size ); vp.push( pos[ 3 * v ], pos[ 3 * v + 1 ], pos[ 3 * v + 2 ] ); vn.push( nor[ 3 * v ], nor[ 3 * v + 1 ], nor[ 3 * v + 2 ] ); vc.push( col[ 3 * v ], col[ 3 * v + 1 ], col[ 3 * v + 2 ] ); } ni[ j ] = map.get( v ); } );
		const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', ni ) ).setAttribute( 'POSITION', acc( 'VEC3', new Float32Array( vp ) ) ).setAttribute( 'NORMAL', acc( 'VEC3', new Float32Array( vn ) ) ).setMaterial( material( name ) );
		if ( MAT[ name ].vertexColor ) prim.setAttribute( 'COLOR_0', acc( 'VEC3', new Float32Array( vc ) ) );
		mesh.addPrimitive( prim );
		list.push( `${ name } ${ ix.length / 3 }` );

	}
	scene.addChild( doc.createNode( slug ).setMesh( mesh ).setExtras( { kind: 'furniture' } ) );
	say( `${ slug }: ${ n0 } -> ${ I.length / 3 } triangles, ${ ( ( hi[ 0 ] - lo[ 0 ] ) * k ).toFixed( 2 ) } x ${ height.toFixed( 2 ) } x ${ ( ( hi[ 2 ] - lo[ 2 ] ) * k ).toFixed( 2 ) } m; ${ list.join( ', ' ) }` );

}

// ---- pictures and textures: swatches ----
function swatch( slug, mat ) {

	const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', new Uint16Array( [ 0, 1, 2 ] ) ) )
		.setAttribute( 'POSITION', acc( 'VEC3', new Float32Array( [ 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0 ] ) ) )
		.setAttribute( 'TEXCOORD_0', acc( 'VEC2', new Float32Array( [ 0, 0, 1, 0, 0, 1 ] ) ) ).setMaterial( mat );
	scene.addChild( doc.createNode( slug ).setMesh( doc.createMesh( slug ).addPrimitive( prim ) ).setExtras( { kind: 'swatch' } ) );

}
/** A texture made to tile: blended with itself shifted by half (a cross-fade at the seams). */
async function tileable( buf, size ) {

	const raw = await sharp( buf ).resize( size, size ).removeAlpha().raw().toBuffer(), out = Buffer.alloc( raw.length ), h = size / 2;
	for ( let y = 0; y < size; ++ y ) for ( let x = 0; x < size; ++ x ) {

		const wx = Math.abs( x - h ) / h, wy = Math.abs( y - h ) / h, w = Math.max( wx, wy ) ** 2, sx = ( x + h ) % size, sy = ( y + h ) % size;
		for ( let c = 0; c < 3; ++ c ) out[ 3 * ( y * size + x ) + c ] = Math.round( raw[ 3 * ( y * size + x ) + c ] * ( 1 - w ) + raw[ 3 * ( sy * size + sx ) + c ] * w );

	}
	return sharp( out, { raw: { width: size, height: size, channels: 3 } } );

}
const picture = async ( k, look, w, h, q = 84 ) => {

	const f = path.join( G, `${ k }-raw.jpg` );
	if ( ! fs.existsSync( f ) ) { say( `${ k }: no picture, skipped` ); return; }
	const b = await sharp( fs.readFileSync( f ) ).resize( w, h, { fit: 'fill' } ).webp( { quality: q, effort: 5 } ).toBuffer();
	swatch( k, doc.createMaterial( k ).setBaseColorTexture( doc.createTexture( k ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look } ) );
	say( `${ k }: ${ w }x${ h }, ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

};
for ( const k of [ 'sea', 'sea-sunset', 'sea-night' ] ) if ( ! opt.only || opt.only.has( k ) ) await picture( k, 'sea', 3072, 1024, 82 );
if ( ! opt.only || opt.only.has( 'bottle-wall' ) ) await picture( 'bottle-wall', 'bottles', 1600, 1000, 84 );
if ( ( ! opt.only || opt.only.has( 'marble' ) ) && fs.existsSync( path.join( G, 'marble-raw.jpg' ) ) ) {

	const b = await ( await tileable( fs.readFileSync( path.join( G, 'marble-raw.jpg' ) ), 1024 ) ).webp( { quality: 86, effort: 5 } ).toBuffer();
	swatch( 'marble', doc.createMaterial( 'marble' ).setBaseColorTexture( doc.createTexture( 'marble' ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'marble' } ) );
	say( `marble: 1024 tileable, ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}

// ---- out ----
await doc.transform( prune( { keepLeaves: true, keepAttributes: true } ), reorder( { encoder: MeshoptEncoder } ), quantize( { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 } ) );
doc.createExtension( EXTMeshoptCompression ).setRequired( true ).setEncoderOptions( { method: EXTMeshoptCompression.EncoderMethod.FILTER } );
doc.createExtension( EXTTextureWebP ).setRequired( true );
fs.mkdirSync( path.dirname( opt.out ), { recursive: true } );
await io.write( opt.out, doc );
say( `${ path.relative( root, opt.out ) }: ${ ( fs.statSync( opt.out ).size / 2 ** 20 ).toFixed( 2 ) } MB in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );

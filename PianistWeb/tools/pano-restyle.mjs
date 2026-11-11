#!/usr/bin/env node
// A wide panorama (7680x2160, as tools/pano-outpaint.mjs makes it) at another hour, its layout kept, with gpt-image-2's
// edit (tools/gpt-image.mjs), which takes 3840x2160 at most: three overlapping tiles.
//   1. the middle (x 1920..5760) restyled                                      -> <stem>-4k.png
//   2. the left: [ wide 0..1920 | the restyled middle's left half ], its left half masked  -> <stem>.left-raw.png
//   3. the right: [ the restyled middle's right half | wide 5760..7680 ], its right half masked -> <stem>.right-raw.png
// so each side continues the restyled middle (the seams as pano-outpaint's); then join with
//   python3 tools/pano-join.py <stem>-4k.png <stem> <stem>.png
//
//   node tools/pano-restyle.mjs <wide.png> <stem> --scene "<the view, the same for every hour>" --hour "<this hour>" [--quality high]
//        [--sides left,right] [--keep-mid] (--keep-mid: the middle as made before, <stem>-4k.png; a side made again)
import fs from 'fs';
import sharp from 'sharp';
import { generateGPT } from './gpt-image.mjs';

const argv = process.argv.slice( 2 ), opt = { scene: '', hour: '', quality: 'high', sides: [ 'left', 'right' ], keepMid: false }, pos = [];
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--scene' ) opt.scene = v();
	else if ( a === '--hour' ) opt.hour = v();
	else if ( a === '--quality' ) opt.quality = v();
	else if ( a === '--sides' ) opt.sides = v().split( ',' );
	else if ( a === '--keep-mid' ) opt.keepMid = true;
	else pos.push( a );

}
const [ wideFile, stem ] = pos;
if ( ! wideFile || ! stem || ! opt.hour ) throw new Error( 'usage: node tools/pano-restyle.mjs <wide.png> <stem> --scene "..." --hour "..."' );
const W = 3840, H = 2160, HALF = W / 2;
const meta = await sharp( wideFile ).metadata();
if ( meta.width !== 2 * W || meta.height !== H ) throw new Error( `the panorama is ${ meta.width }x${ meta.height }, not ${ 2 * W }x${ H }` );
const tile = x => sharp( wideFile ).removeAlpha().extract( { left: x, top: 0, width: W, height: H } ).png().toBuffer();
const part = ( buf, x, w ) => sharp( buf ).removeAlpha().extract( { left: x, top: 0, width: w, height: H } ).png().toBuffer();
const fit = async buf => sharp( buf ).removeAlpha().resize( W, H, { fit: 'fill' } ).png().toBuffer();
const log = s => console.log( `[${ stem.split( '/' ).pop() }] ${ s }` );

// the middle: the same view at the hour
let t0 = Date.now();
const mid = opt.keepMid ? fs.readFileSync( `${ stem }-4k.png` ) : await fit( await generateGPT( `${ opt.scene } Repaint this image as the very same view, unchanged in its layout: every tower, island, road, canal and craft where it is, ${ opt.hour }`, { size: `${ W }x${ H }`, quality: opt.quality, refs: [ await tile( HALF ) ] } ) );
if ( ! opt.keepMid ) { fs.writeFileSync( `${ stem }-4k.png`, mid ); log( `middle: ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` ); }

// a side: the restyled middle's half kept, the day's half beside it repainted at the hour
async function side( name ) {

	const left = name === 'left';
	const day = await part( wideFile, left ? 0 : 3 * HALF, HALF ), kept = await part( mid, left ? 0 : HALF, HALF );
	const canvas = await sharp( { create: { width: W, height: H, channels: 3, background: '#000' } } )
		.composite( [ { input: left ? day : kept, left: 0, top: 0 }, { input: left ? kept : day, left: HALF, top: 0 } ] ).png().toBuffer();
	const m = Buffer.alloc( W * H * 4 );
	for ( let y = 0; y < H; ++ y ) for ( let x = 0; x < W; ++ x ) { const paint = left ? x < HALF : x >= HALF; if ( ! paint ) m[ 4 * ( y * W + x ) + 3 ] = 255; }
	const mask = await sharp( m, { raw: { width: W, height: H, channels: 4 } } ).png().toBuffer();
	fs.writeFileSync( `${ stem }.${ name }-canvas.png`, canvas );
	const other = left ? 'right' : 'left';
	const prompt = `${ opt.scene } The ${ other } half of this image is already the view ${ opt.hour.replace( /^at /, 'at ' ) } and must stay exactly as it is. ` +
		`The ${ name } half is the same city still in the afternoon: repaint the ${ name } half ${ opt.hour }, keeping its towers, islands, roads and canals where they are, ` +
		`so that it continues the ${ other } half seamlessly: the same horizon, the same light, the same colours, no seam.`;
	t0 = Date.now();
	const out = await fit( await generateGPT( prompt, { size: `${ W }x${ H }`, quality: opt.quality, refs: [ canvas ], mask } ) );
	fs.writeFileSync( `${ stem }.${ name }-raw.png`, out );
	log( `${ name }: ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );

}
for ( const s of opt.sides ) await side( s );
log( 'done; join with tools/pano-join.py' );

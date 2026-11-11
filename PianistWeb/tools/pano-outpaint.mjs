#!/usr/bin/env node
// A panorama widened by outpainting with gpt-image-2 (tools/gpt-image.mjs): for each side, a 3840x2160 canvas of the
// image's outer half (kept) and an empty half (masked, painted), then the new half joined on, crossfaded over `--feather`
// px inside the old image (the model redraws the kept half too, a little: aligned first by phase correlation). The
// image must be 3840x2160; the result is ( 1 + sides / 2 ) x as wide.
//   node tools/pano-outpaint.mjs <in.png> <out.png> [--sides left,right] [--prompt "..."] [--quality high] [--feather 256]
// The prompt gets the side ("to the right") appended; the canvases and the raw answers are kept next to <out>.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { generateGPT } from './gpt-image.mjs';

const argv = process.argv.slice( 2 ), opt = { sides: [ 'left', 'right' ], prompt: '', quality: 'high', feather: 256 };
const pos = [];
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--sides' ) opt.sides = v().split( ',' );
	else if ( a === '--prompt' ) opt.prompt = v();
	else if ( a === '--quality' ) opt.quality = v();
	else if ( a === '--feather' ) opt.feather = Number( v() );
	else pos.push( a );

}
const [ inFile, outFile ] = pos;
if ( ! inFile || ! outFile ) throw new Error( 'usage: node tools/pano-outpaint.mjs <in.png> <out.png> [--sides left,right] [--prompt "..."]' );
const W = 3840, H = 2160, HALF = W / 2;
const base = await sharp( inFile ).removeAlpha().raw().toBuffer( { resolveWithObject: true } );
if ( base.info.width !== W || base.info.height !== H ) throw new Error( `the image is ${ base.info.width }x${ base.info.height }, not ${ W }x${ H }` );
const stem = outFile.replace( /\.png$/i, '' );

// the kept half's pixels, as RGBA, on a canvas (the other half transparent), and its mask (transparent: paint)
async function canvas( side ) {

	const keep = await sharp( inFile ).removeAlpha().extract( { left: side === 'right' ? HALF : 0, top: 0, width: HALF, height: H } ).ensureAlpha().raw().toBuffer();
	const img = Buffer.alloc( W * H * 4 ), mask = Buffer.alloc( W * H * 4 );
	const x0 = side === 'right' ? 0 : HALF;		// (the kept half on the canvas: the image's right half on its left, for the right side)
	for ( let y = 0; y < H; ++ y ) for ( let x = 0; x < W; ++ x ) {

		const i = 4 * ( y * W + x ), kept = x >= x0 && x < x0 + HALF;
		if ( kept ) { keep.copy( img, i, 4 * ( y * HALF + ( x - x0 ) ), 4 * ( y * HALF + ( x - x0 ) ) + 4 ); mask[ i ] = mask[ i + 1 ] = mask[ i + 2 ] = 0; mask[ i + 3 ] = 255; }
		// (painted: transparent in both)

	}
	const raw = { raw: { width: W, height: H, channels: 4 } };
	return { img: await sharp( img, raw ).png().toBuffer(), mask: await sharp( mask, raw ).png().toBuffer(), x0 };

}

const parts = {};
for ( const side of opt.sides ) {

	const { img, mask, x0 } = await canvas( side );
	fs.writeFileSync( `${ stem }.${ side }-canvas.png`, img );
	const prompt = `${ opt.prompt } Continue the panorama seamlessly to the ${ side }: the ${ side === 'right' ? 'left' : 'right' } half of the image is the existing view and must stay exactly as it is; ` +
		`paint the empty ${ side } half as its natural continuation: the same horizon at the same height, the same light and the same style, no seam.`;
	const t0 = Date.now();
	const out = await generateGPT( prompt, { size: `${ W }x${ H }`, quality: opt.quality, refs: [ img ], mask } );
	fs.writeFileSync( `${ stem }.${ side }-raw.png`, out );
	const got = await sharp( out ).removeAlpha().resize( W, H, { fit: 'fill' } ).raw().toBuffer();
	console.log( `${ side }: ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );
	parts[ side ] = { px: got, x0 };

}
fs.writeFileSync( `${ stem }.parts.json`, JSON.stringify( { sides: opt.sides, feather: opt.feather } ) );
console.log( 'raw parts written; join with tools/pano-join.py' );

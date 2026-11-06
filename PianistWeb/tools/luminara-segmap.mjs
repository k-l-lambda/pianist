// A photo of a piece recoloured into flat part colours (seedream, image to image): its parts' map, for
// tools/luminara-parts.py (each colour a material; the photos' own shading cannot tell a cream leather
// from a cream boucle). Writes <generated>/<name>-seg.png (1024²) for each <name>-raw.jpg given.
//
//   node tools/luminara-segmap.mjs --generated <dir> <name> [...] [--force]
// The colours (SEG): the leather shell red, the boucle cushions green, the pillows blue, the metal
// inlay yellow, the pedestal magenta, the background white.

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { generate } from './bust-gen.mjs';

export const SEG = { leather: [ 255, 0, 0 ], boucle: [ 0, 255, 0 ], velvet: [ 0, 0, 255 ], inlay: [ 255, 255, 0 ], pedestal: [ 255, 0, 255 ], background: [ 255, 255, 255 ] };
const PROMPT = 'The very same piece of furniture as in the reference image, exactly the same shape, pose, framing and size in the image, nothing moved, ' +
	'redrawn as a flat colour-coded segmentation map: no shading, no texture, no highlights, no shadows, no outlines, each part filled with one solid flat colour. ' +
	'Pure red: only the smooth glossy leather outer shell that wraps round the back and the sides, its thin rounded top rim, and the thin leather plinth band under the seat. ' +
	'Pure green: all the soft fuzzy textured boucle upholstery inside the shell: the big padded back cushion (or back rest) that fills the inside of the back, behind any pillows, ' +
	'and the seat cushion. Pure blue: the throw pillows and lumbar pillows. Pure yellow: the thin metal inlay strip or line on the shell, and the thin gold ring at the foot of the base. ' +
	'Pure magenta: the round or oval metal pedestal base under the seat. Pure white: the background and the floor. Hard clean edges.';

const argv = process.argv.slice( 2 ), names = [];
let G = null, force = false;
for ( let i = 0; i < argv.length; ++ i ) {

	if ( argv[ i ] === '--generated' ) G = argv[ ++ i ];
	else if ( argv[ i ] === '--force' ) force = true;
	else names.push( argv[ i ] );

}
if ( ! G || ! names.length ) throw new Error( 'usage: node tools/luminara-segmap.mjs --generated <dir> <name> [...] [--force]' );
for ( const name of names ) {

	const out = path.join( G, `${ name }-seg.png` );
	if ( fs.existsSync( out ) && ! force ) { console.log( `${ name }: kept` ); continue; }
	const ref = await sharp( path.join( G, `${ name }-raw.jpg` ) ).resize( 1024, 1024 ).jpeg( { quality: 92 } ).toBuffer();
	const t = Date.now();
	for ( let attempt = 1; ; ++ attempt ) {

		try { await sharp( await generate( PROMPT, ref, '2048x2048' ) ).resize( 1024, 1024 ).png().toFile( out ); break; }
		catch ( e ) { if ( attempt >= 2 ) throw e; await new Promise( r => setTimeout( r, 10000 ) ); }

	}
	console.log( `${ name }: ${ ( ( Date.now() - t ) / 1000 ).toFixed( 0 ) } s` );
	await new Promise( r => setTimeout( r, 3000 ) );

}

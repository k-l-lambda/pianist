#!/usr/bin/env node
// Luminara's skies: the generated panoramas (<generated>/pano-<hour>-wide.png, 7680x2160 over the windows' 180°:
// tools/pano-outpaint.mjs for the day, tools/pano-restyle.mjs for the other hours from it; gpt-image-2) encoded as
// public/luminara/skies/<hour>.webp (src/luminara.js _loadSkies, SKY_PANO), the hours as LUMINARA_OUTSIDE names them.
//   node tools/luminara-skies.mjs --generated <dir> [--quality 86]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const argv = process.argv.slice( 2 ), opt = { generated: null, quality: 86 };
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--generated' ) opt.generated = v();
	else if ( a === '--quality' ) opt.quality = Number( v() );
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! opt.generated ) throw new Error( 'usage: node tools/luminara-skies.mjs --generated <dir> [--quality 86]' );
const out = path.join( root, 'public/luminara/skies' );
fs.mkdirSync( out, { recursive: true } );
// (the hours: src/luminara.js LUMINARA_OUTSIDE; the panoramas' names: day, sunset (golden hour), dusk (blue hour), night)
for ( const hour of [ 'day', 'sunset', 'dusk', 'night' ] ) {

	const src = path.join( opt.generated, `pano-${ hour }-wide.png` );
	if ( ! fs.existsSync( src ) ) { console.log( `${ hour }: no ${ path.basename( src ) }` ); continue; }
	const m = await sharp( src ).metadata();
	if ( m.width !== 7680 || m.height !== 2160 ) throw new Error( `${ src }: ${ m.width }x${ m.height }, not 7680x2160 (SKY_PANO)` );
	const b = await sharp( src ).removeAlpha().webp( { quality: opt.quality, effort: 5 } ).toBuffer();
	fs.writeFileSync( path.join( out, `${ hour }.webp` ), b );
	console.log( `${ hour }: ${ ( b.length / 1024 / 1024 ).toFixed( 2 ) } MB` );

}

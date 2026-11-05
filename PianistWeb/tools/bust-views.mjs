// Busts seen at a slant from the piano (VIEW_EYE, tools/bust-gen.mjs): where the line from the
// pianist's eye to a bust's head is more than LIMIT degrees off the vertical plane of its facing,
// a second photo of the same bust (seedream, image to image from its frontal photo, which is kept)
// as seen from there, turned by that angle: <generated>/busts/<slug>-view-raw.jpg (busts.json: its
// angle and prompt). tools/bust-batch.py makes its relief (<slug>-view), tools/hall-asset.mjs
// stands it turned to the eye (its facing still the wall's).
// The busts' places: <generated>/busts/relief/placements.json (tools/hall-asset.mjs writes it).
//
//   node tools/bust-views.mjs --generated <dir> [--only a,b] [--force] [--dry]
// An existing view is kept (a paid call; --force for a new one). POSTs 3 s apart.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { COMPOSERS, VIEW_EYE, generate } from './bust-gen.mjs';

export const LIMIT = 30;			// degrees
const HEAD = 0.45;				// m above a bust's base: its head (where the eye looks)

/** A bust's angle from the eye (degrees: + the eye to its right, so it is seen turned to the image's left). */
export function viewAngle( { pos, face }, eye = VIEW_EYE ) {

	const v = [ eye[ 0 ] - pos[ 0 ], eye[ 2 ] - pos[ 2 ] ], r = [ face[ 1 ], - face[ 0 ] ];
	return Math.atan2( v[ 0 ] * r[ 0 ] + v[ 1 ] * r[ 1 ], v[ 0 ] * face[ 0 ] + v[ 1 ] * face[ 1 ] ) * 180 / Math.PI;

}

export const viewPrompt = ( name, look, yaw ) => `The same white plaster portrait bust of the composer ${ name } (${ look }) as in the reference image, the very same sculpture unchanged, ` +
	`photographed from another side: a three-quarter view, the bust's face and chest turned ${ Math.round( Math.abs( yaw ) ) } degrees towards the ${ yaw > 0 ? 'left' : 'right' } edge of the image, ` +
	'camera at the height of its eyes, orthographic, centred, the whole bust and its small round socle in frame filling 85% of the height, ' +
	'matt chalk-white plaster, the same soft even studio light from the front-left, gentle shading, no harsh shadows, plain neutral mid-grey seamless background, nothing else in the image, sharp, high detail';

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {		// (run, not imported)

	const opt = { generated: null, only: null, force: false, dry: false };
	const argv = process.argv.slice( 2 );
	for ( let i = 0; i < argv.length; ++ i ) {

		const a = argv[ i ], v = () => argv[ ++ i ];
		if ( a === '--generated' ) opt.generated = v();
		else if ( a === '--only' ) opt.only = new Set( v().split( ',' ) );
		else if ( a === '--force' ) opt.force = true;
		else if ( a === '--dry' ) opt.dry = true;
		else throw new Error( `unknown argument ${ a }` );

	}
	if ( ! opt.generated ) throw new Error( 'usage: node tools/bust-views.mjs --generated <dir> [--only slug,slug] [--force] [--dry]' );
	const dir = path.join( opt.generated, 'busts' ), list = path.join( dir, 'busts.json' );
	const places = JSON.parse( fs.readFileSync( path.join( dir, 'relief', 'placements.json' ), 'utf8' ) ).busts;
	const meta = JSON.parse( fs.readFileSync( list, 'utf8' ) );
	const who = Object.fromEntries( COMPOSERS.map( c => [ c[ 0 ], c ] ) );
	for ( const [ slug, p ] of Object.entries( places ) ) {

		const yaw = viewAngle( { pos: [ p.pos[ 0 ], p.pos[ 1 ] + HEAD, p.pos[ 2 ] ], face: p.face } );
		if ( Math.abs( yaw ) <= LIMIT || ( opt.only && ! opt.only.has( slug ) ) ) continue;
		const file = path.join( dir, `${ slug }-view-raw.jpg` ), [ , name, look ] = who[ slug ], text = viewPrompt( name, look, yaw );
		if ( fs.existsSync( file ) && ! opt.force ) { console.log( `${ slug }: ${ yaw.toFixed( 0 ) } deg, kept` ); continue; }
		if ( opt.dry ) { console.log( `${ slug }: ${ yaw.toFixed( 0 ) } deg (dry)` ); continue; }
		for ( let attempt = 1; ; ++ attempt ) {

			try {

				const t = Date.now();
				fs.writeFileSync( file, await generate( text, fs.readFileSync( path.join( dir, `${ slug }-raw.jpg` ) ) ) );
				meta[ slug ].view = { yaw: +yaw.toFixed( 1 ), prompt: text, generated: new Date().toISOString() };
				console.log( `${ slug }: ${ yaw.toFixed( 0 ) } deg (${ ( ( Date.now() - t ) / 1000 ).toFixed( 0 ) } s)` );
				break;

			} catch ( e ) {

				if ( attempt >= 2 ) { console.log( `${ slug }: FAILED ${ e.message }` ); break; }
				await new Promise( r => setTimeout( r, 10000 ) );

			}

		}
		fs.writeFileSync( list, JSON.stringify( meta, null, '\t' ) + '\n' );
		await new Promise( r => setTimeout( r, 3000 ) );

	}

}

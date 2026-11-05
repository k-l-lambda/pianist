// Source images for Luminara, the white grand's round music salon (src/luminara.js), after
// Footages.local/ref/f7a6e53c-eca1-444b-ad15-ac427226500c.png: seedream (tools/bust-gen.mjs's
// generate), kept outside the repo in <generated>/ with luminara.json (the prompts).
//   kind 'object': a product photo of one piece of furniture on white, for TRELLIS (a whole mesh:
//                  tools/luminara-3d.py)
//   kind 'relief': a frontal photo of a wall relief, for MoGe-2 (a relief: tools/bust-depth.py,
//                  tools/bust-relief.py)
//   kind 'texture': a texture (the sky outside the round windows, the floor's marble)
//
//   node tools/luminara-gen.mjs --generated <dir> [--only a,b] [--force]
// An existing image is kept (a paid call; --force for a new one). POSTs 3 s apart.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from './bust-gen.mjs';

const PRODUCT = 'Studio product photograph of a single piece of furniture, the whole object in frame filling 80% of the image, ' +
	'a three-quarter view from the front-left, camera slightly above, centred, plain pure white seamless background, soft even studio light, ' +
	'soft contact shadow only, nothing else in the image, sharp, high detail, photorealistic';
const RELIEF = 'seen exactly from the front, orthographic, centred, the whole piece in frame filling 85% of the image, ' +
	'soft even light from the front-left, gentle shading that shows the relief, plain neutral mid-grey seamless background, nothing else in the image, sharp, high detail';

export const ASSETS = {
	'egg-chair': { kind: 'object', prompt: 'A modern luxury egg chair: a smooth glossy white lacquered shell with a deep rounded seat and high curved back like an open egg, ' +
		'a plush cream-white boucle seat cushion inside, standing on a short polished brass pedestal base with a round disc foot. ' + PRODUCT },
	'sofa': { kind: 'object', prompt: 'A curved modular lounge sofa, a gentle arc, low and deep, upholstered in cream-white boucle fabric, rounded soft arms and a low rounded back, ' +
		'two plush round cushions, a thin polished brass plinth along its base. ' + PRODUCT },
	'side-table': { kind: 'object', prompt: 'A small round side table: a white Carrara marble top with soft grey veins, a slim polished brass pedestal, ' +
		'a tall white ceramic vase with a few dried pampas stems on it. ' + PRODUCT },
	'plant': { kind: 'object', prompt: 'A tall indoor olive tree with a slim trunk and a rounded crown of small silver-green leaves, in a large round matt white ceramic planter with a thin brass rim. ' + PRODUCT },
	'clef': { kind: 'relief', prompt: 'A large white plaster wall relief: a tall elegant treble clef sculpted in high relief with smooth rounded edges, ' +
		'with five flowing curved staff lines sweeping across it like ribbons and a few small music notes, on a flat white plaster panel with a thin rounded border, ' +
		'a thin warm gold inlay along the clef\'s spine, modern and minimal, ' + RELIEF },
	'shelf': { kind: 'relief', prompt: 'A row of decorative objects on a shelf, as styled in a luxury white interior: three white ceramic vases of different heights with smooth curves, ' +
		'a small stack of cream hardcover books, a small brass sculpture of a music note, a white ceramic sphere, all standing in a line on an invisible shelf, ' + RELIEF },
	'sky': { kind: 'texture', size: '3840x1280', prompt: 'A wide panoramic view from a very high tower window at the blue hour: a futuristic white city of slender towers and floating platforms ' +
		'far below and in the distance, soft clouds at the horizon, a clear gradient sky from pale warm peach at the horizon to deep calm blue above, ' +
		'gentle city lights beginning to glow, serene, dreamlike, photorealistic, wide angle, level horizon in the lower third, no window frame, no people, no text' },
	'marble': { kind: 'texture', prompt: 'Seamless tileable texture of polished white Carrara marble seen straight from above, flat and evenly lit, ' +
		'soft light grey veins flowing diagonally, subtle warm undertone, no tiles, no seams, no reflections, no shadows, high detail, photographic' },
};

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {		// (run, not imported)

	const opt = { generated: null, only: null, force: false };
	const argv = process.argv.slice( 2 );
	for ( let i = 0; i < argv.length; ++ i ) {

		const a = argv[ i ], v = () => argv[ ++ i ];
		if ( a === '--generated' ) opt.generated = v();
		else if ( a === '--only' ) opt.only = new Set( v().split( ',' ) );
		else if ( a === '--force' ) opt.force = true;
		else throw new Error( `unknown argument ${ a }` );

	}
	if ( ! opt.generated ) throw new Error( 'usage: node tools/luminara-gen.mjs --generated <dir> [--only a,b] [--force]' );
	fs.mkdirSync( opt.generated, { recursive: true } );
	const list = path.join( opt.generated, 'luminara.json' );
	const meta = fs.existsSync( list ) ? JSON.parse( fs.readFileSync( list, 'utf8' ) ) : {};
	for ( const [ slug, a ] of Object.entries( ASSETS ) ) {

		if ( opt.only && ! opt.only.has( slug ) ) continue;
		const file = path.join( opt.generated, `${ slug }-raw.jpg` );
		if ( fs.existsSync( file ) && ! opt.force ) { console.log( `${ slug }: kept` ); continue; }
		for ( let attempt = 1; ; ++ attempt ) {

			try {

				const t = Date.now();
				fs.writeFileSync( file, await generate( a.prompt, null, a.size ?? '2048x2048' ) );
				meta[ slug ] = { kind: a.kind, prompt: a.prompt, size: a.size ?? '2048x2048', generated: new Date().toISOString() };
				console.log( `${ slug }: ${ ( ( Date.now() - t ) / 1000 ).toFixed( 0 ) } s` );
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

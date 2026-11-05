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
	// after the reference (Footages.local/Luminara/f7a6e53c-...png): the low lounge set, the sideboard
	// under the clef, the shelves' ornaments
	'sofa-low': { kind: 'object', prompt: 'A long low curved lounge sofa in cream-white boucle, sitting almost on the floor: a deep wide seat cushion, a low rounded back with soft vertical channel tufting that curves round into rounded arms, ' +
		'one small square cream cushion, a very thin polished brass plinth at its base, no visible legs, modern luxury, flat and close to the ground. ' + PRODUCT },
	'tub-chair': { kind: 'object', prompt: 'A low round barrel lounge armchair in cream-white boucle: a deep round seat almost on the floor, a low curved back with soft vertical channel tufting wrapping round into its arms, ' +
		'a small square cream cushion, a thin polished brass ring at its base, no visible legs, modern luxury. ' + PRODUCT },
	'sideboard': { kind: 'object', prompt: 'A long low white lacquered sideboard cabinet with rounded ends, six flush drawer fronts with thin gaps and no handles, on a slender polished brass plinth frame with short brass legs, ' +
		'modern luxury, empty top, seen from the front-left. ' + PRODUCT },
	'table-lamp': { kind: 'object', prompt: 'A small elegant table lamp: a white ceramic urn-shaped base with a thin brass neck, a cream fabric drum lampshade, modern classic. ' + PRODUCT },
	'roses': { kind: 'object', prompt: 'A small round white porcelain vase with a dense bouquet of cream-white roses and a few green leaves. ' + PRODUCT },
	'gold-disc': { kind: 'object', prompt: 'A decorative golden vinyl record disc standing upright on a small polished brass stand, a gold-plated music award ornament. ' + PRODUCT },
	'clef-statue': { kind: 'object', prompt: 'A small polished gold treble clef sculpture standing upright on a round white marble base, a decorative music ornament, about 30 cm tall. ' + PRODUCT },
	'gold-ribbon': { kind: 'object', prompt: 'A small abstract sculpture of polished gold metal: a twisted flowing ribbon loop rising from a small square white marble base, a decorative ornament, about 25 cm tall. ' + PRODUCT },
	'books': { kind: 'object', prompt: 'A neat row of seven upright hardcover books standing side by side, cream, white, black and gold spines, a small brass bookend at the end, seen from the front-left. ' + PRODUCT },
	'crystal': { kind: 'object', prompt: 'A small clear crystal glass decorative sculpture: a faceted teardrop shape on a round clear glass base, sparkling, a luxury ornament, about 20 cm tall. ' + PRODUCT },
	'rug': { kind: 'texture', prompt: 'Seamless top-down flat texture of a round luxury rug seen exactly from above, filling the whole square: a soft cream-white wool pile with a subtle tone-on-tone damask and floral arabesque pattern ' +
		'in pale ivory and light beige, faint thin gold lines in concentric rings, a narrow pale gold border ring at the edge, plain white outside the circle, evenly lit, no shadows, no perspective, high detail' },
	'plant': { kind: 'object', prompt: 'A tall indoor olive tree with a slim trunk and a rounded crown of small silver-green leaves, in a large round matt white ceramic planter with a thin brass rim. ' + PRODUCT },
	'clef': { kind: 'relief', prompt: 'A large white plaster wall relief: a tall elegant treble clef sculpted in high relief with smooth rounded edges, ' +
		'with five flowing curved staff lines sweeping across it like ribbons and a few small music notes, on a flat white plaster panel with a thin rounded border, ' +
		'a thin warm gold inlay along the clef\'s spine, modern and minimal, ' + RELIEF },
	'shelf': { kind: 'relief', prompt: 'A row of decorative objects on a shelf, as styled in a luxury white interior: three white ceramic vases of different heights with smooth curves, ' +
		'a small stack of cream hardcover books, a small brass sculpture of a music note, a white ceramic sphere, all standing in a line on an invisible shelf, ' + RELIEF },
	'sky': { kind: 'texture', size: '3840x1280', prompt: 'A wide panoramic view from a very high tower window at the blue hour: a futuristic white city of slender towers and floating platforms ' +
		'far below and in the distance, soft clouds at the horizon, a clear gradient sky from pale warm peach at the horizon to deep calm blue above, ' +
		'gentle city lights beginning to glow, serene, dreamlike, photorealistic, wide angle, level horizon in the lower third, no window frame, no people, no text' },
	// the windows' outside, one per lighting preset (src/luminara.js): the day's, as in the reference
	// (a white city of spires over the clouds), and the same city at other hours from it (`ref`:
	// image to image, so it stays the same city)
	'sky-day': { kind: 'texture', size: '3840x1280', prompt: 'A wide panoramic view from a very high window in the afternoon: a futuristic city of slender white and pale crystal spires and towers ' +
		'rising from a sea of soft white clouds, floating platforms and bridges between them, one sleek silver airship far away in the sky, a bright clear pale blue sky with a few thin wispy clouds, ' +
		'soft warm sunlight from the right, airy and serene, dreamlike, photorealistic, wide angle, level horizon in the lower third, the city across the whole width, no window frame, no people, no text' },
	'sky-sunset': { kind: 'texture', size: '3840x1280', ref: 'sky-day', prompt: 'The very same panoramic view of the same futuristic city of white spires over the clouds as in the reference image, unchanged in its layout, ' +
		'at golden hour: a low warm sun near the horizon on the right, the sky glowing amber, peach and rose to soft lilac above, the spires lit gold on one side, long soft shadows on the clouds, photorealistic, no text' },
	'sky-dusk': { kind: 'texture', size: '3840x1280', ref: 'sky-day', prompt: 'The very same panoramic view of the same futuristic city of white spires over the clouds as in the reference image, unchanged in its layout, ' +
		'at the blue hour just after sunset: a deep calm blue sky fading to a pale warm glow at the horizon, the first stars, warm city lights beginning to glow in the towers\' windows, photorealistic, no text' },
	'sky-night': { kind: 'texture', size: '3840x1280', ref: 'sky-day', prompt: 'The very same panoramic view of the same futuristic city of white spires over the clouds as in the reference image, unchanged in its layout, ' +
		'at night: a dark moonless night sky, deep navy to black, with faint stars only, NO moon anywhere, the towers lit from within with warm and cool lights, glowing windows and lines of light, the clouds below dark and faintly lit by the city, photorealistic, no text' },		// (no moon: the photo repeats round the room, one moon would show as several)
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
				const ref = a.ref ? fs.readFileSync( path.join( opt.generated, `${ a.ref }-raw.jpg` ) ) : null;		// (generated first: ASSETS' order)
				fs.writeFileSync( file, await generate( a.prompt, ref, a.size ?? '2048x2048' ) );
				meta[ slug ] = { kind: a.kind, prompt: a.prompt, ...( a.ref ? { ref: a.ref } : {} ), size: a.size ?? '2048x2048', generated: new Date().toISOString() };
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

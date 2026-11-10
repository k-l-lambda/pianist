// Source images for Azurea, the crystal grand's seaside hotel lobby (src/azurea.js), after
// Footages.local/azurea/*.png: seedream (tools/bust-gen.mjs's generate), kept outside the repo in
// <generated>/ with azurea.json (the prompts).
//   kind 'object':  a product photo of one piece on mid-grey (pale things lose their pale parts on white in
//                   the cut-out), for TRELLIS (tools/luminara-3d.py)
//   kind 'texture': a texture or a picture (the sea outside, the floor's marble, the bar's bottle wall)
//
//   node tools/azurea-gen.mjs --generated <dir> [--only a,b] [--force]
// An existing image is kept (a paid call; --force for a new one). POSTs 3 s apart.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from './bust-gen.mjs';

const PRODUCT = 'Studio product photograph of a single piece of furniture, the whole object in frame filling 80% of the image, ' +
	'a three-quarter view from the front-left, camera slightly above, centred, plain neutral mid-grey seamless background, soft even studio light, ' +
	'soft contact shadow only, nothing else in the image, sharp, high detail, photorealistic';

export const ASSETS = {
	'sofa': { kind: 'object', prompt: 'A curved modular lounge sofa for a luxury seaside hotel lobby: a long gentle arc, low and deep, upholstered in pearl-white boucle fabric, ' +
		'a low rounded continuous back, rounded soft ends, three plush throw pillows in pale glacier blue velvet, a thin polished chrome plinth along its base. ' + PRODUCT },
	'lounge-chair': { kind: 'object', prompt: 'A modern lounge armchair for a luxury seaside hotel lobby: a rounded tub shape, upholstered in pearl-white boucle, a plush seat cushion in pale glacier blue, ' +
		'low curved arms flowing into the back, standing on a slim round polished chrome swivel base. ' + PRODUCT },
	'coffee-table': { kind: 'object', prompt: 'A round low coffee table, 90 cm across: a thick polished white marble top with soft grey veins and a bevelled edge, ' +
		'on a single wide clear-glass drum pedestal with a polished chrome ring at its foot. ' + PRODUCT.replace( 'a single piece of furniture', 'a single table' ) },
	'bar-stool': { kind: 'object', prompt: 'A modern bar stool for a luxury hotel bar: a curved white leather seat with a low rounded back, a slim polished chrome stem, ' +
		'a round chrome footrest ring and a round chrome disc base. ' + PRODUCT.replace( 'a single piece of furniture', 'a single stool' ) },
	'plant-tall': { kind: 'object', prompt: 'A tall indoor plant for a hotel lobby: a lush bird of paradise (strelitzia) with large glossy green paddle leaves, about 2 m tall, ' +
		'in a tall round matte pearl-white ceramic planter. ' + PRODUCT.replace( 'a single piece of furniture', 'a single potted plant' ) },
	'plant-low': { kind: 'object', prompt: 'A wide low indoor planting for a hotel lobby: a broad round matte white planter, 90 cm across, filled with lush mixed tropical foliage, ' +
		'monstera and fern leaves spilling over its rim. ' + PRODUCT.replace( 'a single piece of furniture', 'a single planter' ) },
	// the view through the glass wall: on a curved backdrop round the lobby's back (src/azurea.js): a wide picture, the
	// horizon low (the eye 1.6 m up, a pool's deck before it)
	'sea': { kind: 'texture', size: '3840x1280', prompt: 'A very wide panoramic photograph from a seaside terrace at eye level: a calm turquoise and deep blue ocean ' +
		'stretching to the horizon, gentle distant mountains and green headlands on the left and right horizon fading blue in the haze, a clear bright blue sky with a few soft white clouds, ' +
		'bright midday sunlight, the horizon a third of the way up from the bottom, no buildings, no people, no boats, no birds, no foreground objects, no railings, photorealistic, high detail' },
	// the same view at golden hour and at night (image to image from the day's: one coastline); no sun or moon drawn
	// in them, no glitter path: src/azurea.js draws the disc and its path on the sea where the light's direction puts them
	'sea-sunset': { kind: 'texture', size: '3840x1280', ref: 'sea', prompt: 'The very same panoramic seaside view as in the reference image, unchanged in its layout: ' +
		'the same horizon line, the same mountains and headlands in the same places, now at golden hour just before sunset: a warm sky graded from pale gold and apricot at the horizon ' +
		'to soft dusky blue above, a few thin clouds lit pink and gold from below, the sea a deep calm blue with warm reflections of the sky, the mountains soft violet silhouettes in the haze, ' +
		'the sun itself just out of the picture (no sun disc visible, no bright sun reflection on the water), no buildings, no people, no boats, photorealistic, high detail' },
	'sea-night': { kind: 'texture', size: '3840x1280', ref: 'sea', prompt: 'The very same panoramic seaside view as in the reference image, unchanged in its layout: ' +
		'the same horizon line, the same mountains and headlands in the same places, now at night under a clear moonlit sky: a deep navy blue sky, darker towards the top, ' +
		'a faint glow at the horizon, a few faint stars, the sea dark blue-black with soft cool silvery moonlight on its gentle swell, the mountains dark silhouettes, ' +
		'a few tiny warm lights of a distant coastal village on one headland, the moon itself out of the picture (no moon visible, no moon path on the water), no people, no boats, photorealistic, high detail' },
	'marble': { kind: 'texture', prompt: 'Seamless tileable texture of polished pale white marble seen straight from above, flat and evenly lit, ' +
		'very soft pearl grey and faint icy blue veins, calm and subtle, no tiles, no seams, no reflections, no shadows, high detail, photographic' },
	'bottle-wall': { kind: 'texture', size: '2560x1600', prompt: 'A backlit hotel bar display wall seen exactly from the front, orthographic, filling the whole image: ' +
		'five long thin glass shelves with rows of elegant liquor bottles and crystal decanters, lit from behind by a soft glacier-blue and white glow panel, ' +
		'a pale frame, minimal and luxurious, no people, no bartender, no counter, no text, photorealistic' },
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
	if ( ! opt.generated ) throw new Error( 'usage: node tools/azurea-gen.mjs --generated <dir> [--only a,b] [--force]' );
	fs.mkdirSync( opt.generated, { recursive: true } );
	const list = path.join( opt.generated, 'azurea.json' );
	const meta = fs.existsSync( list ) ? JSON.parse( fs.readFileSync( list, 'utf8' ) ) : {};
	for ( const [ slug, a ] of Object.entries( ASSETS ) ) {

		if ( opt.only && ! opt.only.has( slug ) ) continue;
		const file = path.join( opt.generated, `${ slug }-raw.jpg` );
		if ( fs.existsSync( file ) && ! opt.force ) { console.log( `${ slug }: kept` ); continue; }
		for ( let attempt = 1; ; ++ attempt ) {

			try {

				const t = Date.now();
				const ref = a.ref ? fs.readFileSync( path.join( opt.generated, `${ a.ref }-raw.jpg` ) ) : null;		// (image to image: the ref's own photo)
				fs.writeFileSync( file, await generate( a.prompt, ref, a.size ?? '2048x2048' ) );
				meta[ slug ] = { kind: a.kind, prompt: a.prompt, ref: a.ref, size: a.size ?? '2048x2048', generated: new Date().toISOString() };
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

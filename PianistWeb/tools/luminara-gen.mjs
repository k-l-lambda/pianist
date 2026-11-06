// Source images for Luminara, the white grand's round music salon (src/luminara.js), after
// Footages.local/ref/f7a6e53c-eca1-444b-ad15-ac427226500c.png: seedream (tools/bust-gen.mjs's
// generate), kept outside the repo in <generated>/ with luminara.json (the prompts).
//   kind 'object': a product photo of one piece of furniture on white, for TRELLIS (a whole mesh:
//                  tools/luminara-3d.py)
//   kind 'relief': a frontal photo of a wall relief, for MoGe-2 (a relief: tools/bust-depth.py,
//                  tools/bust-relief.py)
//   kind 'texture': a texture (the sky outside the round windows, the floor's marble)
//   `crop: { file, box: [ x, y, w, h ] }` (any kind): no generation, the image cut from a reference
//                  (a product sheet's own views: Footages.local/Luminara/<sheet>.png), resized to 2048 on
//                  its longer side; `views`: more such crops, saved as <slug>-view1-raw.jpg, ... (TRELLIS's
//                  multi-view conditioning: tools/luminara-3d.py); a crop's `yaw` (deg, about the piece's up, its
//                  front 0): roughly where it was seen from (tools/luminara-parts.py searches near it)
//   `of: '<slug>'`: image to image of each of that asset's views (its -raw.jpg and -view<k>-raw.jpg), the one
//                  prompt for all, their crops' yaws kept: the same piece changed alike in every view
//
//   node tools/luminara-gen.mjs --generated <dir> [--only a,b] [--force]
// An existing image is kept (a paid call; --force for a new one). POSTs 3 s apart.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from './bust-gen.mjs';
import sharp from 'sharp';

const PRODUCT = 'Studio product photograph of a single piece of furniture, the whole object in frame filling 80% of the image, ' +
	'a three-quarter view from the front-left, camera slightly above, centred, plain pure white seamless background, soft even studio light, ' +
	'soft contact shadow only, nothing else in the image, sharp, high detail, photorealistic';
// white things on white lose their white parts in the cut-out (rembg: a crystal ball's books, a whale tail's marble,
// a pothos's pot): those on mid-grey
const PRODUCT_GREY = PRODUCT.replace( 'plain pure white seamless background', 'plain neutral mid-grey seamless background' );
const RELIEF = 'seen exactly from the front, orthographic, centred, the whole piece in frame filling 85% of the image, ' +
	'soft even light from the front-left, gentle shading that shows the relief, plain neutral mid-grey seamless background, nothing else in the image, sharp, high detail';

export const ASSETS = {
	'egg-chair': { kind: 'object', prompt: 'A modern luxury egg chair: a smooth glossy white lacquered shell with a deep rounded seat and high curved back like an open egg, ' +
		'a plush cream-white boucle seat cushion inside, standing on a short polished brass pedestal base with a round disc foot. ' + PRODUCT },
	'sofa': { kind: 'object', prompt: 'A curved modular lounge sofa, a gentle arc, low and deep, upholstered in cream-white boucle fabric, rounded soft arms and a low rounded back, ' +
		'two plush round cushions, a thin polished brass plinth along its base. ' + PRODUCT },
	// the sofa group's set, from their product sheets (2x2 views of 627 px: front, three-quarter, side, back): the
	// curved two-seat sofa (Footages.local/Luminara/e3600454-...) and the swivel chair (ce870b1c-...); their own views
	// as TRELLIS's input (tools/luminara-3d.py --views), the three-quarter one first
	'sofa-curve': { kind: 'object', crop: { file: '../Footages.local/Luminara/e3600454-1643-4f81-ae5e-8714ad00cac2.png', box: [ 627, 0, 627, 627 ], yaw: -45 },
		views: [ { file: '../Footages.local/Luminara/e3600454-1643-4f81-ae5e-8714ad00cac2.png', box: [ 0, 0, 627, 627 ], yaw: 0 }, { file: '../Footages.local/Luminara/e3600454-1643-4f81-ae5e-8714ad00cac2.png', box: [ 0, 627, 627, 627 ], yaw: -90 }, { file: '../Footages.local/Luminara/e3600454-1643-4f81-ae5e-8714ad00cac2.png', box: [ 627, 627, 627, 627 ], yaw: 180 } ] },
	'swivel-chair': { kind: 'object', crop: { file: '../Footages.local/Luminara/ce870b1c-db50-4bc8-b256-ebc7b550ea68.png', box: [ 627, 0, 627, 627 ], yaw: -45 },
		views: [ { file: '../Footages.local/Luminara/ce870b1c-db50-4bc8-b256-ebc7b550ea68.png', box: [ 0, 0, 627, 627 ], yaw: 0 }, { file: '../Footages.local/Luminara/ce870b1c-db50-4bc8-b256-ebc7b550ea68.png', box: [ 0, 627, 627, 627 ], yaw: -90 }, { file: '../Footages.local/Luminara/ce870b1c-db50-4bc8-b256-ebc7b550ea68.png', box: [ 627, 627, 627, 627 ], yaw: -135 } ] },
	// the same two without their pillows (each view changed alike): clean bodies for TRELLIS; the pillows their own
	// meshes, from photos of one each (placed on the seats: src/luminara.js SEAT_PILLOWS)
	'sofa-body': { kind: 'object', of: 'sofa-curve', prompt: 'The very same sofa as in the reference image, exactly the same shape, pose, camera angle, framing, size in the image, ' +
		'lighting and background, every part unchanged, but with all the throw pillows removed: nothing lies on it, the plain beige boucle seat cushion and the boucle back cushion fully visible ' +
		'where the pillows were, continuing their shape and texture. Photorealistic product photograph.' },
	'chair-body': { kind: 'object', of: 'swivel-chair', prompt: 'The very same armchair as in the reference image, exactly the same shape, pose, camera angle, framing, size in the image, ' +
		'lighting and background, every part unchanged, but with the lumbar pillow removed: nothing lies on it, the plain beige boucle seat cushion and the boucle back cushion fully visible ' +
		'where the pillow was, continuing their shape and texture. Photorealistic product photograph.' },
	'pillow-blue': { kind: 'object', prompt: 'Studio product photograph of a single square throw pillow, 45 cm, in soft dusty blue-grey velvet with a subtle sheen, plump and soft, ' +
		'standing upright, slightly leaning back, its corners soft, a fine self piping round its edge, the whole pillow in frame filling 80% of the image, a three-quarter view from the front-left, ' +
		'camera slightly above, centred, plain pure white seamless background, soft even studio light, soft contact shadow only, nothing else in the image, sharp, high detail, photorealistic' },
	'pillow-cream': { kind: 'object', prompt: 'Studio product photograph of a single square throw pillow, 45 cm, in soft ivory cream velvet with a subtle sheen, plump and soft, ' +
		'standing upright, slightly leaning back, its corners soft, a fine self piping round its edge. ' + PRODUCT_GREY.replace( 'a single piece of furniture', 'one pillow' ) },
	'pillow-lumbar': { kind: 'object', prompt: 'Studio product photograph of a single rectangular lumbar pillow, 50 x 32 cm, in soft dusty blue-grey velvet with a subtle sheen, ' +
		'a vertical seam down its middle dividing it into two soft halves, plump, standing upright on its long edge, slightly leaning back, the whole pillow in frame filling 80% of the image, ' +
		'a three-quarter view from the front-left, camera slightly above, centred, plain pure white seamless background, soft even studio light, soft contact shadow only, nothing else in the image, sharp, high detail, photorealistic' },
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
	// the shelving's ornaments, after the close-ups (Footages.local/Luminara/2197e854-..., 22a45a68-...): many, so few repeat
	'pothos': { kind: 'object', prompt: 'A small trailing pothos plant with long leafy vines hanging down over the rim, in a round white ceramic pot. ' + PRODUCT_GREY },
	'armillary': { kind: 'object', prompt: 'A decorative armillary sphere: thin polished brass rings around a clear crystal glass ball, on a slender brass stand with a round foot. ' + PRODUCT },
	'figurine': { kind: 'object', prompt: 'A small white porcelain figurine of a girl sitting and thinking, her chin on her hand, seated on a short stack of two white books. ' + PRODUCT },
	'crystal-gem': { kind: 'object', prompt: 'A faceted clear crystal ornament shaped like a large cut diamond standing on its point in a small brushed silver base. ' + PRODUCT },
	'gramophone': { kind: 'object', prompt: 'A small decorative gramophone with a large flared brushed silver horn on a round silver base. ' + PRODUCT },
	'hourglass': { kind: 'object', prompt: 'A tall hourglass with a clear glass body and fine white sand, held in a polished brass frame with round ends. ' + PRODUCT },
	'white-flowers': { kind: 'object', prompt: 'A lush bouquet of white hydrangeas and small white jasmine flowers with a few green leaves in a clear cylindrical glass vase. ' + PRODUCT },
	'cloche': { kind: 'object', prompt: 'A clear glass bell jar cloche on a round brass base, a small golden origami crane inside it. ' + PRODUCT },
	'astronaut': { kind: 'object', prompt: 'A small white glazed ceramic figurine of an astronaut with a gold visor sitting on a white cratered moon sphere. ' + PRODUCT },
	'crystal-note': { kind: 'object', prompt: 'A clear crystal glass sculpture of a music note (a quaver) standing on a small clear acrylic block. ' + PRODUCT },
	'loop-sculpture': { kind: 'object', prompt: 'An abstract smooth white ceramic sculpture of a twisted flowing loop on a small square white marble base. ' + PRODUCT },
	'headphones': { kind: 'object', prompt: 'A pair of cream-white over-ear headphones hanging on a slim brushed brass headphone stand. ' + PRODUCT },
	'diffuser': { kind: 'object', prompt: 'A reed diffuser: a clear square glass bottle of fragrance with a white label and eight thin black reed sticks. ' + PRODUCT },
	'metronome': { kind: 'object', prompt: 'A classic pyramid metronome of clear acrylic with a polished brass pendulum and base. ' + PRODUCT },
	'whale-tail': { kind: 'object', prompt: 'A polished gold sculpture of a whale tail rising from a small white marble block. ' + PRODUCT_GREY },
	'radio': { kind: 'object', prompt: 'A small retro cream-white table radio with a round brass dial and a white fabric grille, standing on two stacked white books. ' + PRODUCT },
	'coral-tree': { kind: 'object', prompt: 'A small decorative silver coral branch tree sculpture on a round brass base. ' + PRODUCT },
	'mushroom-lamp': { kind: 'object', prompt: 'A small polished brass mushroom table lamp with a dome shade and a thin stem on a round brass base. ' + PRODUCT },
	'crystal-ball': { kind: 'object', prompt: 'A clear crystal ball on a small brass ring stand resting on two stacked white books. ' + PRODUCT_GREY },
	'banquette': { kind: 'object', prompt: 'A long low built-in banquette seat, about 2.5 m long: a white lacquered base with three flush drawers and a slim polished brass plinth, a long cream-white boucle seat cushion on it and a row of four soft cream back cushions, modern luxury. ' + PRODUCT },
	'lily-planter': { kind: 'object', prompt: 'A tall slim white ceramic floor planter with a thin brass rim, white calla lilies and long green leaves rising from it, about a metre tall. ' + PRODUCT },
	// more, so that no ornament is used twice (the books too: each set its own)
	'books-grey': { kind: 'object', prompt: 'A neat row of six upright hardcover books with grey, white and silver spines, a small white marble bookend at the end. ' + PRODUCT_GREY },
	'books-gold': { kind: 'object', prompt: 'A small row of five upright hardcover books with black and cream spines with gold lettering, a brass bookend. ' + PRODUCT_GREY },
	'books-flat': { kind: 'object', prompt: 'A neat stack of three large cream and white hardcover art books lying flat. ' + PRODUCT_GREY },
	'perfume': { kind: 'object', prompt: 'A pair of faceted crystal perfume bottles with polished gold caps, one tall and one short, side by side. ' + PRODUCT },
	'shell': { kind: 'object', prompt: 'A white conch seashell standing on a slim polished brass stand. ' + PRODUCT_GREY },
	'gold-star': { kind: 'object', prompt: 'A small decorative gold compass-star ornament with eight thin points on a slim brass stem and round base. ' + PRODUCT },
	'brass-globe': { kind: 'object', prompt: 'A small brass desk globe on a curved brass meridian and a round marble base. ' + PRODUCT },
	'jewelry-box': { kind: 'object', prompt: 'A small cream lacquered jewellery box with a domed lid and thin brass trim and little brass feet. ' + PRODUCT_GREY },
	'clock': { kind: 'object', prompt: 'A small round brass table clock with a white face and slim black hands on a short brass stand. ' + PRODUCT },
	'ceramic-vase': { kind: 'object', prompt: 'A tall slender white ribbed ceramic vase with a narrow neck, empty. ' + PRODUCT_GREY },
	'candles': { kind: 'object', prompt: 'Three white pillar candles of different heights, unlit, on a round polished brass tray. ' + PRODUCT_GREY },
	'olive-vase': { kind: 'object', prompt: 'A few dried olive branches with small silver-green leaves in a round matt white ceramic vase. ' + PRODUCT_GREY },
	// paintings: futuristic cityscapes in oil, each its own (two on the walls by the doors, one on a shelf)
	'painting-1': { kind: 'texture', size: '2400x1600', prompt: 'A futuristic oil painting on canvas, impressionistic brushwork and thick impasto: a gleaming city of slender white and pale gold spires rising above a sea of soft clouds at sunrise, warm cream, gold and pale blue palette, luminous, the whole canvas filling the image edge to edge, no frame, no wall, no text' },
	'painting-2': { kind: 'texture', size: '2400x1600', prompt: 'A futuristic oil painting on canvas, loose expressive brushwork: floating white crystal towers and bridges in a pale lilac and gold evening sky, small airships, dreamy and serene, soft warm light, the whole canvas filling the image edge to edge, no frame, no wall, no text' },
	'painting-3': { kind: 'texture', size: '2304x1728', prompt: 'A small futuristic oil painting on canvas, impasto palette-knife texture: a white city of domes and spires under a big pale moon over calm water, cream, silver and soft blue palette, the whole canvas filling the image edge to edge, no frame, no wall, no text' },
	// the curtain of light's backdrop (a relief: MoGe-2, tools/bust-depth.py, bust-relief.py) and the bench's cushions (TRELLIS)
	'curtain': { kind: 'relief', size: '1440x2880', prompt: 'A tall full-length curtain panel of soft cream-white linen hanging straight down in deep even vertical pleats, pinch-pleated at the top, about twelve soft rounded folds, ' +
		'its hem just above the floor, seen exactly from the front, orthographic, centred, the whole panel in frame filling 88% of the height and 80% of the width, soft even light from the front-left, ' +
		'gentle shading that shows the folds, plain neutral mid-grey seamless background, nothing else in the image, sharp, high detail' },
	'cushion-square': { kind: 'object', prompt: 'A plump square throw cushion in soft beige boucle fabric with a thin piped edge, standing upright on its edge, gently squashed and soft. ' + PRODUCT },
	'cushion-lumbar': { kind: 'object', prompt: 'A plump rectangular lumbar cushion in soft oatmeal linen with a thin piped edge, standing upright on its long edge, gently squashed and soft. ' + PRODUCT },
	'cushion-velvet': { kind: 'object', prompt: 'A plump square throw cushion in soft cream velvet with a subtle sheen and slightly pinched corners, standing upright on its edge, gently squashed and soft. ' + PRODUCT },
	'small-cabinet': { kind: 'object', prompt: 'A small standing white lacquered cabinet with two flush doors and rounded corners, about a metre tall, on four slim tapered brass legs, modern luxury. ' + PRODUCT },
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
	// the carousel music box's horse (src/luminara.js carouselBox: the box itself built there, this horse four times round
	// its platform; the sheets Footages.local/Luminara/5d2295d4-..., e50eec08-...): white porcelain, a pale blue saddle, gilt
	'carousel-horse': { kind: 'object', prompt: 'A single small carousel horse figurine on its own, glossy white porcelain body, a pale powder blue saddle and saddle cloth, ' +
		'a gold bridle, a gold-trimmed flowing mane and tail, gold hooves, prancing with its front legs raised, seen from the side, slightly from the front-left, ' +
		'NO pole through it, NO base, NO stand, nothing under its hooves. ' + PRODUCT_GREY },
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
				if ( a.of ) {		// (each of another asset's views, changed by the one prompt)

					const src = meta[ a.of ] ?? {}, names = [ '', ...( src.views ?? [] ).map( ( _, k ) => `-view${ k + 1 }` ) ];
					for ( const sfx of names ) {

						const ref = fs.readFileSync( path.join( opt.generated, `${ a.of }${ sfx }-raw.jpg` ) );
						fs.writeFileSync( path.join( opt.generated, `${ slug }${ sfx }-raw.jpg` ), await generate( a.prompt, ref, a.size ?? '2048x2048' ) );
						console.log( `  ${ slug }${ sfx }: from ${ a.of }${ sfx }` );
						await new Promise( r => setTimeout( r, 3000 ) );

					}
					meta[ slug ] = { kind: a.kind, of: a.of, prompt: a.prompt, ...( src.crop ? { crop: src.crop } : {} ), ...( src.views ? { views: src.views } : {} ), generated: new Date().toISOString() };
					console.log( `${ slug }: ${ names.length } views from ${ a.of }, ${ ( ( Date.now() - t ) / 1000 ).toFixed( 0 ) } s` );
					break;

				}
				if ( a.crop ) {		// (a reference's own view: cut, not generated)

					const cut = ( c, out ) => sharp( path.resolve( c.file ) ).extract( { left: c.box[ 0 ], top: c.box[ 1 ], width: c.box[ 2 ], height: c.box[ 3 ] } )
						.resize( 2048, 2048, { fit: 'inside', kernel: 'lanczos3' } ).jpeg( { quality: 95 } ).toFile( out );
					await cut( a.crop, file );
					for ( const [ k, v ] of ( a.views ?? [] ).entries() ) await cut( v, path.join( opt.generated, `${ slug }-view${ k + 1 }-raw.jpg` ) );
					meta[ slug ] = { kind: a.kind, crop: a.crop, ...( a.views ? { views: a.views } : {} ), generated: new Date().toISOString() };
					console.log( `${ slug }: cut from ${ path.basename( a.crop.file ) }${ a.views ? ` (+${ a.views.length } views)` : '' }` );
					break;

				}
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

// Photos of new plaster busts for the Berlin hall's composers (seedream, the paigod image API:
// PAIGOD_API_KEY, CLAUDE_BASE_URL), one each, in one style (PROMPT): frontal and symmetric, so the
// depth (tools/bust-depth.py) makes a relief that faces the hall. Kept as sources:
// <generated>/busts/<slug>-raw.jpg, and busts.json (who, where, the prompt). Who and where: the
// Konzerthaus's own list (as on de.wikipedia "Konzerthaus Berlin", Büsten im Großen Saal: the
// stalls' walls left, back, right; the second tier's), each wall's in its order.
//
//   node tools/bust-gen.mjs --generated <dir> [--only slug,slug] [--force]
// An existing photo is kept (a paid call; --force for a new one). POSTs 3 s apart.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// [ slug, name, the look (after his best-known portraits), level, wall ]
export const COMPOSERS = [
	[ 'bach-js', 'Johann Sebastian Bach', 'as in the Haussmann portrait: a heavy middle-aged face, double chin, thick neck, stern mouth, curled baroque wig to the shoulders', 'stalls', 'left' ],
	[ 'telemann', 'Georg Philipp Telemann', 'full-bottomed baroque wig, round face', 'stalls', 'left' ],
	[ 'gluck', 'Christoph Willibald Gluck', 'powdered 18th-century wig with side rolls, broad strong face', 'stalls', 'left' ],
	[ 'mozart', 'Wolfgang Amadeus Mozart', 'powdered hair with side curls tied back, young face, jabot', 'stalls', 'left' ],
	[ 'schubert', 'Franz Schubert', 'curly hair, round spectacles, high collar and cravat', 'stalls', 'left' ],
	[ 'mendelssohn', 'Felix Mendelssohn Bartholdy', 'wavy dark hair, slim youthful face, high collar and cravat', 'stalls', 'back' ],
	[ 'wagner', 'Richard Wagner', 'as in his well-known 1871 photograph: NO moustache and smooth bare cheeks, only a narrow fringe of whiskers running under the jaw and chin like a neck beard, the chin itself clean and very prominent and jutting, large hooked nose, high bulging forehead, hair brushed back over the ears, wearing a velvet jacket with a wide soft bow', 'stalls', 'back' ],
	[ 'brahms', 'Johannes Brahms', 'long full flowing beard, swept-back hair, the older Brahms', 'stalls', 'back' ],
	[ 'schumann', 'Robert Schumann', 'clean-shaven round face, medium wavy hair, pensive', 'stalls', 'back' ],
	[ 'handel', 'Georg Friedrich Händel', 'large full-bottomed baroque wig, heavy jowls', 'stalls', 'right' ],
	[ 'bach-cpe', 'Carl Philipp Emanuel Bach', 'powdered 18th-century wig, thin face', 'stalls', 'right' ],
	[ 'haydn', 'Joseph Haydn', 'powdered wig with side rolls, long nose, kindly face', 'stalls', 'right' ],
	[ 'beethoven', 'Ludwig van Beethoven', 'wild unruly hair, stern frown, high collar and cravat', 'stalls', 'right' ],
	[ 'weber', 'Carl Maria von Weber', 'thin face, long straight hair, high collar and cravat', 'stalls', 'right' ],
	[ 'zelter', 'Carl Friedrich Zelter', 'broad face, short hair, high collar, older man', 'tier2', 'left' ],
	[ 'chopin', 'Frédéric Chopin', 'wavy side-parted hair, slender face, high collar and cravat', 'tier2', 'left' ],
	[ 'tchaikovsky', 'Pyotr Ilyich Tchaikovsky', 'short neat beard, short grey hair', 'tier2', 'left' ],
	[ 'dvorak', 'Antonín Dvořák', 'full beard, bushy hair, broad face', 'tier2', 'left' ],
	[ 'mahler', 'Gustav Mahler', 'swept-back hair, high forehead, clean-shaven, rimless spectacles', 'tier2', 'left' ],
	[ 'reger', 'Max Reger', 'round face, short hair, pince-nez spectacles', 'tier2', 'left' ],
	[ 'debussy', 'Claude Debussy', 'short beard, hair combed forward in a fringe, prominent forehead', 'tier2', 'left' ],
	[ 'janacek', 'Leoš Janáček', 'thick white moustache, mane of swept-back hair', 'tier2', 'left' ],
	[ 'stravinsky', 'Igor Stravinsky', 'slicked-back hair, round spectacles, long nose', 'tier2', 'left' ],
	[ 'shostakovich', 'Dmitri Shostakovich', 'round spectacles, combed hair, serious expression', 'tier2', 'back' ],
	[ 'eisler', 'Hanns Eisler', 'bald head, spectacles, round face', 'tier2', 'back' ],
	[ 'dessau', 'Paul Dessau', 'bald head, spectacles, lined face, older man', 'tier2', 'back' ],
	[ 'britten', 'Benjamin Britten', 'clean-shaven, wavy hair, long face', 'tier2', 'back' ],
	[ 'prokofiev', 'Sergei Prokofiev', 'high forehead, thin hair, clean-shaven', 'tier2', 'right' ],
	[ 'schoenberg', 'Arnold Schoenberg', 'bald head, intense large eyes', 'tier2', 'right' ],
	[ 'strauss-r', 'Richard Strauss', 'receding hairline, small moustache, high forehead', 'tier2', 'right' ],
	[ 'wolf-h', 'Hugo Wolf', 'full beard, moustache, intense gaze', 'tier2', 'right' ],
	[ 'bruckner', 'Anton Bruckner', 'close-cropped hair, clean-shaven, large nose, older man', 'tier2', 'right' ],
	[ 'smetana', 'Bedřich Smetana', 'side whiskers, small round spectacles', 'tier2', 'right' ],
	[ 'mussorgsky', 'Modest Mussorgsky', 'bushy beard, unkempt hair', 'tier2', 'right' ],
	[ 'liszt', 'Franz Liszt', 'long hair to the shoulders, clean-shaven, the older Liszt', 'tier2', 'right' ],
	[ 'lortzing', 'Albert Lortzing', 'curly hair, side whiskers, high collar', 'tier2', 'right' ],
];

export const prompt = ( name, look ) => `Studio photograph of a classical white plaster portrait bust of the composer ${ name } (${ look }), as in a 19th-century neoclassical concert hall: ` +
	'head and shoulders with the chest cut in a gentle curve, standing on a small round socle, matt chalk-white plaster, finely sculpted features, hair and clothing folds, ' +
	'seen exactly from the front at eye level, symmetric pose looking straight ahead, orthographic, centred, the whole bust and socle in frame filling 85% of the height, ' +
	'soft even studio light from the front-left, gentle shading that shows the relief, no harsh shadows, plain neutral mid-grey seamless background, nothing else in the image, sharp, high detail';
const MODEL = 'seedream-5.0-lite', SIZE = '2048x2048';
// where the busts are looked at from (tools/bust-views.mjs): the pianist's eye, seated at the
// keyboard (the packs' frame, tools/hall-asset.mjs; measured in the app: the piano's keyboard front
// 1.25 m up, its default place on the stage)
export const VIEW_EYE = [ - 1.0, 1.86, - 1.3 ];

/** A photo (seedream); `ref`: an image to keep to (bytes, image to image); `size`: WxH. */
export async function generate( text, ref = null, size = SIZE ) {

	const base = ( process.env.CLAUDE_BASE_URL ?? 'https://apiproxy.paigod.work' ).replace( /\/+$/, '' ), key = process.env.PAIGOD_API_KEY;
	if ( ! key ) throw new Error( 'PAIGOD_API_KEY not set' );
	const res = await fetch( `${ base }/v3/${ MODEL }`, { method: 'POST', headers: { Authorization: `Bearer ${ key }`, 'Content-Type': 'application/json' },
		body: JSON.stringify( { prompt: text, size, watermark: false, sequential_image_generation: 'disabled', ...( ref ? { image: [ 'data:image/jpeg;base64,' + ref.toString( 'base64' ) ] } : {} ) } ), signal: AbortSignal.timeout( 300000 ) } );
	const body = await res.json().catch( () => ( {} ) ), urls = body.images ?? body.image_urls ?? [];
	if ( ! res.ok || ! urls.length ) throw new Error( `HTTP ${ res.status } ${ JSON.stringify( body ).slice( 0, 300 ) }` );
	return Buffer.from( await ( await fetch( typeof urls[ 0 ] === 'string' ? urls[ 0 ] : urls[ 0 ].url, { signal: AbortSignal.timeout( 300000 ) } ) ).arrayBuffer() );

}

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
	if ( ! opt.generated ) throw new Error( 'usage: node tools/bust-gen.mjs --generated <dir> [--only slug,slug] [--force]' );
	const dir = path.join( opt.generated, 'busts' ), list = path.join( dir, 'busts.json' );
	fs.mkdirSync( dir, { recursive: true } );
	const meta = fs.existsSync( list ) ? JSON.parse( fs.readFileSync( list, 'utf8' ) ) : {};
	const order = {};
	for ( const [ slug, name, look, level, wall ] of COMPOSERS ) {

		const k = `${ level }/${ wall }`; order[ k ] = ( order[ k ] ?? 0 ) + 1;
		const file = path.join( dir, `${ slug }-raw.jpg` ), text = prompt( name, look );
		meta[ slug ] = { ...meta[ slug ], name, level, wall, order: order[ k ], prompt: text, model: MODEL, size: SIZE };
		if ( opt.only && ! opt.only.has( slug ) ) continue;
		if ( fs.existsSync( file ) && ! opt.force ) { console.log( `${ slug }: kept` ); continue; }
		for ( let attempt = 1; ; ++ attempt ) {

			try {

				const t = Date.now();
				fs.writeFileSync( file, await generate( text ) );
				meta[ slug ].generated = new Date().toISOString();
				console.log( `${ slug }: ${ name } (${ ( ( Date.now() - t ) / 1000 ).toFixed( 0 ) } s)` );
				break;

			} catch ( e ) {

				if ( attempt >= 2 ) { console.log( `${ slug }: FAILED ${ e.message }` ); break; }
				await new Promise( r => setTimeout( r, 10000 ) );

			}

		}
		fs.writeFileSync( list, JSON.stringify( meta, null, '\t' ) + '\n' );
		await new Promise( r => setTimeout( r, 3000 ) );

	}
	fs.writeFileSync( list, JSON.stringify( meta, null, '\t' ) + '\n' );

}

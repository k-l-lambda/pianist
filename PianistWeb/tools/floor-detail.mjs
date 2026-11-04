// A detail texture for the Berlin hall's stage floor (src/berlinhall.js): its baked atlas has the
// boards, the sockets and the light, at ~4 mm a texel round the piano (it needs ~1 mm there); this
// adds the wood's grain on top, tiled in world space along the boards.
//   1. a photo of plain maple boards' surface from seedream (the paigod image API: PAIGOD_API_KEY,
//      CLAUDE_BASE_URL), the prompt asking for grain only: no joints, no knots, flat light; kept
//      as a source (`floor-detail-raw.jpg` in the generated sources' dir: a new one costs a call
//      and comes out different);
//   2. detailTexture(): its luminance, the grain made horizontal (the strongest gradient's
//      direction across it), the broad light taken out (a high-pass at HIGHPASS of the width), the
//      rest scaled to a contrast of CONTRAST about mid grey (128: the shader multiplies by it / 0.5);
//      made to tile (blended with itself shifted by half, across a band at each seam); SIZE² grey
//      WebP. tools/hall-asset.mjs (--generated) packs it into the stage floor's materials.
//
//   node tools/floor-detail.mjs --generated <dir> [--seed <n>] [--force]   (a new raw image)
//   node tools/floor-detail.mjs --raw <image> --preview <out.webp>       (the texture from one)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const MODEL = 'seedream-5.0-lite';
const GEN_SIZE = '2048x2048';		// (seedream: at least ~3.7 Mpx)
const SIZE = 1024;
const HIGHPASS = 1 / 16;			// of the width: broader than this is light, not grain
const CONTRAST = 0.25;			// the detail's standard deviation, as a factor about 1 (the floor is near white: tone mapping flattens less)
const SEAM = 0.12;				// of the width: the blend band at each seam
export const DETAIL_RAW = 'floor-detail-raw.jpg';
const PROMPT = [
	'Seamless tileable texture, orthographic top-down macro photograph of the surface of a single wide plank of light maple wood,',
	'satin varnished stage floor, fine straight wood grain running horizontally across the whole image, subtle pores and fibres,',
	'pale honey colour, completely flat and evenly lit, no shadows, no reflections, no vignette,',
	'no board joints, no seams, no gaps, no knots, no nails, no text, fills the frame edge to edge, high resolution, sharp detail',
].join( ' ' );

async function generate( seed ) {

	const base = ( process.env.CLAUDE_BASE_URL ?? 'https://apiproxy.paigod.work' ).replace( /\/+$/, '' ), key = process.env.PAIGOD_API_KEY;
	if ( ! key ) throw new Error( 'PAIGOD_API_KEY not set' );
	const payload = { prompt: PROMPT, size: GEN_SIZE, watermark: false, sequential_image_generation: 'disabled', ...( seed !== null ? { seed } : {} ) };
	const res = await fetch( `${ base }/v3/${ MODEL }`, { method: 'POST', headers: { Authorization: `Bearer ${ key }`, 'Content-Type': 'application/json' }, body: JSON.stringify( payload ), signal: AbortSignal.timeout( 300000 ) } );
	const body = await res.json().catch( () => ( {} ) );
	const urls = body.images ?? body.image_urls ?? [];
	if ( ! res.ok || ! urls.length ) throw new Error( `${ MODEL }: HTTP ${ res.status } ${ JSON.stringify( body ).slice( 0, 400 ) }` );
	const url = typeof urls[ 0 ] === 'string' ? urls[ 0 ] : urls[ 0 ].url;
	return Buffer.from( await ( await fetch( url, { signal: AbortSignal.timeout( 300000 ) } ) ).arrayBuffer() );

}

/** Box blurs, three: a Gaussian of `sigma` (texels), wrapping round (the texture tiles). */
function blurWrap( a, w, h, sigma ) {

	const r = Math.max( 1, Math.round( ( Math.sqrt( 4 * sigma * sigma + 1 ) - 1 ) / 2 ) ), k = 1 / ( 2 * r + 1 ), t = new Float32Array( a.length );
	const pass = ( src, dst, horizontal ) => {

		const n = horizontal ? w : h, lines = horizontal ? h : w;
		for ( let l = 0; l < lines; ++ l ) {

			const at = i => horizontal ? l * w + ( ( i % n ) + n ) % n : ( ( ( i % n ) + n ) % n ) * w + l;
			let s = 0;
			for ( let i = - r; i <= r; ++ i ) s += src[ at( i ) ];
			for ( let i = 0; i < n; ++ i ) { dst[ at( i ) ] = s * k; s += src[ at( i + r + 1 ) ] - src[ at( i - r ) ]; }

		}

	};
	for ( let p = 0; p < 3; ++ p ) { pass( a, t, true ); pass( t, a, false ); }
	return a;

}

/** The detail texture from a generated photo (`raw`: its bytes): { webp, rotated }. */
export async function detailTexture( raw ) {

	const meta = await sharp( raw ).metadata();
	const n0 = Math.min( meta.width, meta.height ), W = 2048;
	let { data } = await sharp( raw ).extract( { left: ( meta.width - n0 ) >> 1, top: ( meta.height - n0 ) >> 1, width: n0, height: n0 } ).resize( W, W ).greyscale().raw().toBuffer( { resolveWithObject: true } );
	// the grain's direction: across it the gradient is strongest; make it horizontal
	let gx = 0, gy = 0;
	for ( let y = 1; y < W - 1; y += 2 ) for ( let x = 1; x < W - 1; x += 2 ) { const dx = data[ y * W + x + 1 ] - data[ y * W + x - 1 ], dy = data[ ( y + 1 ) * W + x ] - data[ ( y - 1 ) * W + x ]; gx += dx * dx; gy += dy * dy; }
	const rotated = gx > gy;		// grain vertical (varies along x): turn it a quarter
	if ( rotated ) data = ( await sharp( data, { raw: { width: W, height: W, channels: 1 } } ).rotate( 90 ).raw().toBuffer() );
	// the detail: luminance over its high-pass mean (a ratio about 1), to the contrast
	const L = Float32Array.from( data, v => ( v + 1 ) / 256 ), low = blurWrap( Float32Array.from( L ), W, W, HIGHPASS * W / 2.5 );
	const d = new Float32Array( W * W );
	let s2 = 0;
	for ( let i = 0; i < d.length; ++ i ) { d[ i ] = L[ i ] / low[ i ] - 1; s2 += d[ i ] * d[ i ]; }
	const g = CONTRAST / Math.sqrt( s2 / d.length );
	// tile: blend with itself shifted by half across a band at each seam (x first, then y)
	const band = Math.round( SEAM * W );
	const tileAxis = ( a, horizontal ) => {

		const o = new Float32Array( a.length );
		for ( let y = 0; y < W; ++ y ) for ( let x = 0; x < W; ++ x ) {

			const p = horizontal ? x : y, e = Math.min( p, W - 1 - p );		// distance from the seam
			const wgt = e >= band ? 1 : 0.5 - 0.5 * Math.cos( Math.PI * e / band );
			const sx = horizontal ? ( x + W / 2 ) % W : x, sy = horizontal ? y : ( y + W / 2 ) % W;
			o[ y * W + x ] = wgt * a[ y * W + x ] + ( 1 - wgt ) * a[ sy * W + sx ];

		}
		return o;

	};
	const t = tileAxis( tileAxis( d, true ), false );
	const out = Buffer.alloc( W * W );
	for ( let i = 0; i < out.length; ++ i ) out[ i ] = Math.max( 0, Math.min( 255, Math.round( 128 * ( 1 + g * t[ i ] ) ) ) );
	const webp = await sharp( out, { raw: { width: W, height: W, channels: 1 } } ).resize( SIZE, SIZE, { kernel: 'lanczos3' } ).webp( { quality: 90, effort: 6 } ).toBuffer();
	return { webp, rotated };

}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {		// (run, not imported)

	const opt = { generated: null, raw: null, preview: null, seed: null, force: false };
	const argv = process.argv.slice( 2 );
	for ( let i = 0; i < argv.length; ++ i ) {

		const a = argv[ i ], v = () => argv[ ++ i ];
		if ( a === '--generated' ) opt.generated = v();
		else if ( a === '--raw' ) opt.raw = v();
		else if ( a === '--preview' ) opt.preview = v();
		else if ( a === '--seed' ) opt.seed = Number( v() );
		else if ( a === '--force' ) opt.force = true;
		else throw new Error( `unknown argument ${ a }` );

	}
	if ( opt.generated ) {		// a new raw image (a paid call: not over the one there unless --force)

		const f = path.join( opt.generated, DETAIL_RAW );
		if ( fs.existsSync( f ) && ! opt.force ) throw new Error( `${ f } exists (--force to replace it)` );
		fs.mkdirSync( opt.generated, { recursive: true } );
		fs.writeFileSync( f, await generate( opt.seed ) );
		console.log( `${ f }: generated` );
		opt.raw ??= f;

	}
	if ( opt.preview ) {

		if ( ! opt.raw ) throw new Error( '--preview needs --raw or --generated' );
		const { webp, rotated } = await detailTexture( fs.readFileSync( opt.raw ) );
		fs.writeFileSync( opt.preview, webp );
		console.log( `${ opt.preview }: ${ SIZE }² (${ ( webp.length / 1024 ).toFixed( 0 ) } KB), grain ${ rotated ? 'turned to horizontal' : 'horizontal' }, contrast ${ CONTRAST }` );

	}
	if ( ! opt.generated && ! opt.preview ) throw new Error( 'usage: node tools/floor-detail.mjs --generated <dir> | --raw <image> --preview <out.webp>' );

}

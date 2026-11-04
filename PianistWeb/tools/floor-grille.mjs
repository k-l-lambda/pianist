// High-resolution decals for the Berlin hall's floor vents (src/berlinhall.js): round grilles,
// ~70 px in the full-size textures (the stage's 29 cm brass rosettes round the piano, the stalls'
// 15 cm dark ones). Each kind is redrawn by seedream from its crop in the original (image to image,
// the paigod API: PAIGOD_API_KEY, CLAUDE_BASE_URL), isolated on white, and kept as a source
// (`grille-<kind>-raw.jpg` in the generated sources' dir: a new one costs a call and comes out
// different). From it, grilleTextures():
//   - the grille cut out (its distance from white, the largest blob, a circle fitted to it), on a
//     square just round it, alpha a disc with a soft edge at the grille's (src/berlinhall.js makes
//     it a little larger than the baked one, to cover that one's edge);
//   - white inside it (the background through its openings) the dark below (HOLE);
//   - its colours scaled to the original's grille (mean inside half its radius: the baked light);
//   - SIZE² RGBA WebP, and a normal map (BUMP: the openings sunk, the metal's relief from its
//     brightness).
// Where they are, grilleItems() (the hall's GLB): each kind's crop matched over its original
// (blurred, at ~MATCH_R px a radius: the grille's disc and ring, not its pattern, which turns with
// the UV island), peaks over MATCH_T, each measured at full size; each through the floor triangles
// of its material whose UVs hold it (mirrored and repeated islands: all of them), horizontal ones
// only, to the hall (the packs' frame, tools/hall-asset.mjs) with its axes there.
// tools/hall-asset.mjs (--generated) packs both into the GLBs as decal meshes.
//
//   node tools/floor-grille.mjs --originals <dir> --generated <dir> [--kind stage|stalls|all] [--force]   (new raw images)
//   node tools/floor-grille.mjs --originals <dir> --generated <dir> --preview <dir>   (the textures from them)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

// the kinds: the original (its file's leading id), the reference grille's centre and radius (UV)
export const GRILLES = {
	stage: { material: 'buehnen-parkett', metalness: 0.35, file: '9f00d304', uv: [ 0.7237, 0.4747 ], r: 0.0117, prompt: 'a round floor ventilation grille set flush into a stage floor: a thin dark bronze outer ring, inside it a pale brass openwork rosette of radial petals round a small centre boss' },
	stalls: { material: 'parkett', metalness: 0.25, file: '259dc025', uv: [ 0.5775, 0.9682 ], r: 0.0060, prompt: 'a round dark bronze floor ventilation grille: a dark patinated disc with a raised rim, openwork rosette of radial spokes and petals, slightly lighter metal edges' },
};
const MODEL = 'seedream-5.0-lite', GEN_SIZE = '2048x2048', SIZE = 1024;
const HOLE = [ 22, 16, 12 ];		// the openings (white in the redraw: the background through them): the dark below
const EDGE = 0.025;				// of the radius: the alpha's soft edge
// the normal map: a height from the redraw (the openings down, the metal up by its brightness: its
// raised parts catch the light; the rim's outer edge bevelled to the floor), blurred BUMP_BLUR of
// the radius, its slope times BUMP; tangent space as glTF (+x along u, +y towards v = 0)
const BUMP = 16, BUMP_BLUR = 0.006, BUMP_RIM = 0.05;

const MATCH_R = 10, MATCH_T = 0.8;
export const grilleRaw = kind => `grille-${ kind }-raw.jpg`;
const originalOf = ( dir, g ) => path.join( dir, fs.readdirSync( dir ).find( f => f.startsWith( g.file ) ) );

/** A kind's centre made exact (its `uv`, a guess): the centroid of what differs from the floor round it, twice. */
async function centre( dir, g ) {

	const file = originalOf( dir, g );
	const m = await sharp( file ).metadata(), r = g.r * m.width, R = Math.round( 1.8 * r );
	let cx = g.uv[ 0 ] * m.width, cy = g.uv[ 1 ] * m.height;
	for ( let it = 0; it < 3; ++ it ) {

		const x0 = Math.round( cx ) - R, y0 = Math.round( cy ) - R;
		const L = await sharp( file ).extract( { left: x0, top: y0, width: 2 * R, height: 2 * R } ).greyscale().raw().toBuffer();
		const ring = []; for ( let y = 0; y < 2 * R; ++ y ) for ( let x = 0; x < 2 * R; ++ x ) if ( Math.hypot( x - R, y - R ) > 1.4 * r ) ring.push( L[ y * 2 * R + x ] );
		ring.sort( ( a, b ) => a - b );
		const floor = ring[ ring.length >> 1 ], dev = ring[ Math.floor( 0.9 * ring.length ) ] - ring[ Math.floor( 0.1 * ring.length ) ];
		let sx = 0, sy = 0, n = 0;
		for ( let y = 0; y < 2 * R; ++ y ) for ( let x = 0; x < 2 * R; ++ x ) if ( Math.hypot( x - R, y - R ) < 1.3 * r && Math.abs( L[ y * 2 * R + x ] - floor ) > Math.max( 18, dev ) ) { sx += x; sy += y; ++ n; }
		if ( n < 20 ) break;
		cx = x0 + sx / n + 0.5; cy = y0 + sy / n + 0.5;

	}
	return [ cx / m.width, cy / m.height ];

}

/** The reference crop of a kind: 2.6 radii each way round its centre, from the original. */
async function reference( dir, g ) {

	const file = originalOf( dir, g );
	const m = await sharp( file ).metadata(), R = Math.round( 2.6 * g.r * m.width );
	const cx = Math.round( g.uv[ 0 ] * m.width ), cy = Math.round( g.uv[ 1 ] * m.height );
	const crop = await sharp( file ).extract( { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R } ).removeAlpha().raw().toBuffer( { resolveWithObject: true } );
	// the grille's mean colour (inside its circle)
	let s = [ 0, 0, 0 ], n = 0;
	const rr = g.r * m.width;
	for ( let y = 0; y < 2 * R; ++ y ) for ( let x = 0; x < 2 * R; ++ x ) if ( Math.hypot( x - R, y - R ) < 0.5 * rr ) { const i = 3 * ( y * 2 * R + x ); for ( let c = 0; c < 3; ++ c ) s[ c ] += crop.data[ i + c ]; ++ n; }
	const png = await sharp( crop.data, { raw: { width: 2 * R, height: 2 * R, channels: 3 } } ).resize( 1024, 1024, { kernel: 'lanczos3' } ).png().toBuffer();
	return { png, mean: s.map( v => v / n ) };

}

async function generate( g, ref ) {

	const base = ( process.env.CLAUDE_BASE_URL ?? 'https://apiproxy.paigod.work' ).replace( /\/+$/, '' ), key = process.env.PAIGOD_API_KEY;
	if ( ! key ) throw new Error( 'PAIGOD_API_KEY not set' );
	const prompt = `Redraw the grille in this low-resolution photo as a sharp high-resolution orthographic top-down product photograph: ${ g.prompt }. ` +
		'Keep its design, proportions and colours exactly; crisp fine metal detail, flat even soft lighting, no perspective, no shadow, ' +
		'one grille centred and filling 80% of the frame, isolated on a plain pure white background, nothing else in the image.';
	const payload = { prompt, image: [ 'data:image/png;base64,' + ref.png.toString( 'base64' ) ], size: GEN_SIZE, watermark: false, sequential_image_generation: 'disabled' };
	const res = await fetch( `${ base }/v3/${ MODEL }`, { method: 'POST', headers: { Authorization: `Bearer ${ key }`, 'Content-Type': 'application/json' }, body: JSON.stringify( payload ), signal: AbortSignal.timeout( 300000 ) } );
	const body = await res.json().catch( () => ( {} ) );
	const urls = body.images ?? body.image_urls ?? [];
	if ( ! res.ok || ! urls.length ) throw new Error( `${ MODEL }: HTTP ${ res.status } ${ JSON.stringify( body ).slice( 0, 400 ) }` );
	return Buffer.from( await ( await fetch( typeof urls[ 0 ] === 'string' ? urls[ 0 ] : urls[ 0 ].url, { signal: AbortSignal.timeout( 300000 ) } ) ).arrayBuffer() );

}

/** The grille cut out of its white background: an RGBA decal, its colours at `mean`. */
async function decal( raw, mean ) {

	const { data, info } = await sharp( raw ).removeAlpha().raw().toBuffer( { resolveWithObject: true } ), w = info.width, h = info.height;
	// not white: max distance of a channel from 255 over a threshold; the largest blob (flood fill)
	const fg = new Uint8Array( w * h );
	for ( let i = 0; i < w * h; ++ i ) fg[ i ] = 255 - Math.min( data[ 3 * i ], data[ 3 * i + 1 ], data[ 3 * i + 2 ] ) > 28 ? 1 : 0;
	const label = new Int32Array( w * h ).fill( - 1 );
	let best = - 1, bestN = 0;
	for ( let s = 0; s < w * h; ++ s ) {

		if ( ! fg[ s ] || label[ s ] >= 0 ) continue;
		const st = [ s ]; label[ s ] = s; let n = 0;
		while ( st.length ) { const i = st.pop(); ++ n; const x = i % w, y = ( i / w ) | 0;
			for ( const j of [ x > 0 ? i - 1 : - 1, x < w - 1 ? i + 1 : - 1, y > 0 ? i - w : - 1, y < h - 1 ? i + w : - 1 ] ) if ( j >= 0 && fg[ j ] && label[ j ] < 0 ) { label[ j ] = s; st.push( j ); } }
		if ( n > bestN ) { bestN = n; best = s; }

	}
	// the circle: the blob's centroid, its radius from the farthest boundary (robust: 98th percentile of distances)
	let sx = 0, sy = 0;
	for ( let i = 0; i < w * h; ++ i ) if ( label[ i ] === best ) { sx += i % w; sy += ( i / w ) | 0; }
	const cx = sx / bestN, cy = sy / bestN, ds = [];
	for ( let i = 0; i < w * h; i += 3 ) if ( label[ i ] === best ) ds.push( Math.hypot( i % w - cx, ( ( i / w ) | 0 ) - cy ) );
	ds.sort( ( a, b ) => a - b );
	const r = ds[ Math.floor( 0.98 * ( ds.length - 1 ) ) ], R = r;
	// the openings: white inside the circle -> the dark below (soft: by how white); the height:
	// an opening 0, the metal 0.5 + its brightness / 2 (before the openings are darkened)
	const height = new Float32Array( w * h );
	for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) {

		if ( Math.hypot( x - cx, y - cy ) > r ) continue;
		const i = 3 * ( y * w + x ), lo = Math.min( data[ i ], data[ i + 1 ], data[ i + 2 ] ), t = Math.min( 1, Math.max( 0, ( lo - 170 ) / 60 ) );
		const lum = ( 0.2126 * data[ i ] + 0.7152 * data[ i + 1 ] + 0.0722 * data[ i + 2 ] ) / 255;
		height[ y * w + x ] = ( 1 - t ) * ( 0.5 + 0.5 * Math.min( 1, lum / 0.8 ) );
		for ( let c = 0; c < 3; ++ c ) data[ i + c ] = Math.round( data[ i + c ] * ( 1 - t ) + HOLE[ c ] * t );

	}
	// colours: mean inside 0.9 r, scaled to the original grille's
	let m = [ 0, 0, 0 ], k = 0;
	for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) if ( Math.hypot( x - cx, y - cy ) < 0.5 * r ) { const i = 3 * ( y * w + x ); for ( let c = 0; c < 3; ++ c ) m[ c ] += data[ i + c ]; ++ k; }
	const gain = m.map( ( v, c ) => mean[ c ] / ( v / k ) );
	const out = Buffer.alloc( SIZE * SIZE * 4 );
	for ( let y = 0; y < SIZE; ++ y ) for ( let x = 0; x < SIZE; ++ x ) {

		const px = cx + ( ( x + 0.5 ) / SIZE * 2 - 1 ) * R, py = cy + ( ( y + 0.5 ) / SIZE * 2 - 1 ) * R;
		const X = Math.min( w - 1, Math.max( 0, Math.round( px ) ) ), Y = Math.min( h - 1, Math.max( 0, Math.round( py ) ) ), i = 3 * ( Y * w + X ), o = 4 * ( y * SIZE + x );
		for ( let c = 0; c < 3; ++ c ) out[ o + c ] = Math.min( 255, Math.round( data[ i + c ] * gain[ c ] ) );
		const d = Math.hypot( px - cx, py - cy ) / R;		// 1 at the decal's edge
		out[ o + 3 ] = Math.round( 255 * Math.min( 1, Math.max( 0, ( 1 - d ) / EDGE ) ) );

	}
	// the normal map, at SIZE: the height sampled as the colours, the rim bevelled, blurred, Sobel
	const H = new Float32Array( SIZE * SIZE );
	for ( let y = 0; y < SIZE; ++ y ) for ( let x = 0; x < SIZE; ++ x ) {

		const px = cx + ( ( x + 0.5 ) / SIZE * 2 - 1 ) * R, py = cy + ( ( y + 0.5 ) / SIZE * 2 - 1 ) * R;
		const X = Math.min( w - 1, Math.max( 0, Math.round( px ) ) ), Y = Math.min( h - 1, Math.max( 0, Math.round( py ) ) ), d = Math.hypot( px - cx, py - cy ) / R;
		H[ y * SIZE + x ] = height[ Y * w + X ] * Math.min( 1, Math.max( 0, ( 1 - d ) / BUMP_RIM ) );

	}
	const blurred = await sharp( Buffer.from( Uint8Array.from( H, v => Math.round( 255 * v ) ) ), { raw: { width: SIZE, height: SIZE, channels: 1 } } ).blur( Math.max( 0.3, BUMP_BLUR * SIZE / 2 ) ).extractChannel( 0 ).raw().toBuffer();		// (one channel: sharp would give three)
	const hb = ( x, y ) => blurred[ Math.min( SIZE - 1, Math.max( 0, y ) ) * SIZE + Math.min( SIZE - 1, Math.max( 0, x ) ) ] / 255;
	const nor = Buffer.alloc( SIZE * SIZE * 3 );
	for ( let y = 0; y < SIZE; ++ y ) for ( let x = 0; x < SIZE; ++ x ) {

		const gx = ( hb( x + 1, y - 1 ) + 2 * hb( x + 1, y ) + hb( x + 1, y + 1 ) - hb( x - 1, y - 1 ) - 2 * hb( x - 1, y ) - hb( x - 1, y + 1 ) ) / 8;
		const gy = ( hb( x - 1, y + 1 ) + 2 * hb( x, y + 1 ) + hb( x + 1, y + 1 ) - hb( x - 1, y - 1 ) - 2 * hb( x, y - 1 ) - hb( x + 1, y - 1 ) ) / 8;
		let nx = - BUMP * gx, ny = BUMP * gy, nz = 1;		// (image y down = v up: +y towards the image's top)
		const l = Math.hypot( nx, ny, nz ); nx /= l; ny /= l; nz /= l;
		const o = 3 * ( y * SIZE + x );
		nor[ o ] = Math.round( 127.5 * ( nx + 1 ) ); nor[ o + 1 ] = Math.round( 127.5 * ( ny + 1 ) ); nor[ o + 2 ] = Math.round( 127.5 * ( nz + 1 ) );

	}
	return { png: await sharp( out, { raw: { width: SIZE, height: SIZE, channels: 4 } } ).webp( { quality: 90, alphaQuality: 90, effort: 6 } ).toBuffer(),
		normal: await sharp( nor, { raw: { width: SIZE, height: SIZE, channels: 3 } } ).webp( { quality: 92, effort: 6 } ).toBuffer(), gain, circle: { cx, cy, r, w, h } };

}

/** The grilles of a kind in its original: [ [ u, v ] ] (normalised), by normalised cross-correlation. */
async function find( dir, g ) {

	const file = originalOf( dir, g );
	const m = await sharp( file ).metadata(), k = MATCH_R / ( g.r * m.width ), w = Math.round( m.width * k ), h = Math.round( m.height * k );
	const L = Float32Array.from( await sharp( file ).resize( w, h ).greyscale().blur( 1.2 ).raw().toBuffer() );
	const T = Math.ceil( 1.5 * MATCH_R ), N = ( 2 * T + 1 ) ** 2, tx = Math.round( g.uv[ 0 ] * w ), ty = Math.round( g.uv[ 1 ] * h );
	const tpl = new Float32Array( N );
	let tm = 0; for ( let j = - T, q = 0; j <= T; ++ j ) for ( let i = - T; i <= T; ++ i, ++ q ) { tpl[ q ] = L[ ( ty + j ) * w + tx + i ]; tm += tpl[ q ]; }
	tm /= N; let tn = 0; for ( let q = 0; q < N; ++ q ) { tpl[ q ] -= tm; tn += tpl[ q ] ** 2; } tn = Math.sqrt( tn );
	// integral images for the patches' means and variances
	const S = new Float64Array( ( w + 1 ) * ( h + 1 ) ), S2 = new Float64Array( ( w + 1 ) * ( h + 1 ) );
	for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) { const v = L[ y * w + x ], o = ( y + 1 ) * ( w + 1 ) + x + 1; S[ o ] = v + S[ o - 1 ] + S[ o - w - 1 ] - S[ o - w - 2 ]; S2[ o ] = v * v + S2[ o - 1 ] + S2[ o - w - 1 ] - S2[ o - w - 2 ]; }
	const box = ( A, x0, y0, x1, y1 ) => A[ y1 * ( w + 1 ) + x1 ] - A[ y0 * ( w + 1 ) + x1 ] - A[ y1 * ( w + 1 ) + x0 ] + A[ y0 * ( w + 1 ) + x0 ];
	const C = new Float32Array( w * h );
	for ( let y = T; y < h - T; ++ y ) for ( let x = T; x < w - T; ++ x ) {

		const s1 = box( S, x - T, y - T, x + T + 1, y + T + 1 ), s2 = box( S2, x - T, y - T, x + T + 1, y + T + 1 ), sd = Math.sqrt( Math.max( 1e-6, s2 - s1 * s1 / N ) );
		if ( sd < 1e-3 * N ) continue;
		let c = 0; for ( let j = - T, q = 0; j <= T; ++ j ) { const row = ( y + j ) * w + x; for ( let i = - T; i <= T; ++ i, ++ q ) c += tpl[ q ] * L[ row + i ]; }
		C[ y * w + x ] = c / ( tn * sd );

	}
	const out = [];
	for ( let y = 1; y < h - 1; ++ y ) for ( let x = 1; x < w - 1; ++ x ) {

		const c = C[ y * w + x ];
		if ( c < MATCH_T ) continue;
		let peak = true;
		for ( let j = - MATCH_R; j <= MATCH_R && peak; ++ j ) for ( let i = - MATCH_R; i <= MATCH_R; ++ i ) { const yy = y + j, xx = x + i; if ( ( i || j ) && yy >= 0 && yy < h && xx >= 0 && xx < w && C[ yy * w + xx ] > c ) { peak = false; break; } }
		if ( ! peak ) continue;
		// sub-pixel: a parabola each way
		const fx = ( C[ y * w + x - 1 ] - C[ y * w + x + 1 ] ) / ( 2 * ( C[ y * w + x - 1 ] - 2 * c + C[ y * w + x + 1 ] ) || 1 ), fy = ( C[ ( y - 1 ) * w + x ] - C[ ( y + 1 ) * w + x ] ) / ( 2 * ( C[ ( y - 1 ) * w + x ] - 2 * c + C[ ( y + 1 ) * w + x ] ) || 1 );
		out.push( [ ( x + 0.5 + Math.max( - 0.5, Math.min( 0.5, fx ) ) ) / w, ( y + 0.5 + Math.max( - 0.5, Math.min( 0.5, fy ) ) ) / h, +c.toFixed( 3 ) ] );

	}
	return out;

}

/**
 * A grille's exact place and size in its original, from a guess (`u`, `v`, radius `r` px): the
 * centroid of what differs from the floor round it (three times), and its extents along u and v
 * (a baked grille is an ellipse where the UVs stretch). [ u, v, ru, rv ] (normalised), or null.
 */
function measure( L, W, H, u, v, r ) {

	let cx = u * W, cy = v * H;
	const R = Math.ceil( 1.8 * r ), xs = [], ys = [];
	for ( let it = 0; it < 4; ++ it ) {

		const x0 = Math.round( cx ) - R, y0 = Math.round( cy ) - R;
		if ( x0 < 0 || y0 < 0 || x0 + 2 * R > W || y0 + 2 * R > H ) return null;
		const ring = [];
		for ( let y = 0; y < 2 * R; ++ y ) for ( let x = 0; x < 2 * R; ++ x ) if ( Math.hypot( x - R, y - R ) > 1.4 * r ) ring.push( L[ ( y0 + y ) * W + x0 + x ] );
		ring.sort( ( a, b ) => a - b );
		const floor = ring[ ring.length >> 1 ], dev = Math.max( 18, ring[ Math.floor( 0.9 * ring.length ) ] - ring[ Math.floor( 0.1 * ring.length ) ] );
		let sx = 0, sy = 0, n = 0; xs.length = ys.length = 0;
		for ( let y = 0; y < 2 * R; ++ y ) for ( let x = 0; x < 2 * R; ++ x ) {

			if ( Math.hypot( x - R, y - R ) >= 1.3 * r || Math.abs( L[ ( y0 + y ) * W + x0 + x ] - floor ) <= dev ) continue;
			sx += x; sy += y; ++ n; xs.push( x0 + x + 0.5 ); ys.push( y0 + y + 0.5 );

		}
		if ( n < 30 ) return null;
		cx = x0 + sx / n + 0.5; cy = y0 + sy / n + 0.5;

	}
	const ext = a => { a.sort( ( p, q ) => p - q ); return ( a[ Math.floor( 0.995 * ( a.length - 1 ) ) ] - a[ Math.floor( 0.005 * ( a.length - 1 ) ) ] ) / 2; };
	return [ cx / W, cy / H, ext( xs ) / W, ext( ys ) / H ];

}

/**
 * The hall places of the grilles found (`found`: [ u, v, ru, rv ]): per one, through each floor
 * triangle of its material whose UVs hold its centre, [ x, y, z, ax, az, bx, bz ] in the packs'
 * frame: its centre, and where its texture's +u and +v half-axes go (the decal is mapped as the
 * baked grille is: stretch, mirroring and turn as its UV island's).
 */
async function place( g, found, doc ) {

	// the source's frame -> the packs' (tools/hall-asset.mjs FRAME)
	const ours = ( x, y, z ) => [ ( x + 35.5 ) / 100, ( z - 743.4 ) / 100, ( 1205 - y ) / 100 ];
	const items = [];
	for ( const n of doc.getRoot().listScenes()[ 0 ].listChildren() ) {

		const p = n.getMesh()?.listPrimitives()[ 0 ];
		if ( ! p || p.getMaterial()?.getName() !== g.material ) continue;
		const t = n.getTranslation(), P = p.getAttribute( 'POSITION' ).getArray(), U = p.getAttribute( 'TEXCOORD_0' ).getArray(), I = p.getIndices().getArray();
		for ( let k = 0; k < I.length; k += 3 ) {

			const v = [ I[ k ], I[ k + 1 ], I[ k + 2 ] ], u = v.map( i => [ U[ 2 * i ], U[ 2 * i + 1 ] ] );
			const d = ( u[ 1 ][ 0 ] - u[ 0 ][ 0 ] ) * ( u[ 2 ][ 1 ] - u[ 0 ][ 1 ] ) - ( u[ 2 ][ 0 ] - u[ 0 ][ 0 ] ) * ( u[ 1 ][ 1 ] - u[ 0 ][ 1 ] );
			if ( Math.abs( d ) < 1e-12 ) continue;
			const q = v.map( i => ours( P[ 3 * i ] + t[ 0 ], P[ 3 * i + 1 ] + t[ 1 ], P[ 3 * i + 2 ] + t[ 2 ] ) );
			const e1 = [ 0, 1, 2 ].map( c => q[ 1 ][ c ] - q[ 0 ][ c ] ), e2 = [ 0, 1, 2 ].map( c => q[ 2 ][ c ] - q[ 0 ][ c ] );
			const nrm = [ e1[ 1 ] * e2[ 2 ] - e1[ 2 ] * e2[ 1 ], e1[ 2 ] * e2[ 0 ] - e1[ 0 ] * e2[ 2 ], e1[ 0 ] * e2[ 1 ] - e1[ 1 ] * e2[ 0 ] ], area = Math.hypot( ...nrm ) / 2;
			if ( area < 1e-8 || Math.abs( nrm[ 1 ] ) / ( 2 * area ) < 0.98 ) continue;		// floors only
			// world = q0 + J (uv - u0): J's columns, d(world)/du and d(world)/dv
			const du1 = u[ 1 ][ 0 ] - u[ 0 ][ 0 ], dv1 = u[ 1 ][ 1 ] - u[ 0 ][ 1 ], du2 = u[ 2 ][ 0 ] - u[ 0 ][ 0 ], dv2 = u[ 2 ][ 1 ] - u[ 0 ][ 1 ];
			const Ju = [ 0, 1, 2 ].map( c => ( e1[ c ] * dv2 - e2[ c ] * dv1 ) / d ), Jv = [ 0, 1, 2 ].map( c => ( e2[ c ] * du1 - e1[ c ] * du2 ) / d );
			for ( const [ pu, pv, ru, rv ] of found ) {

				const a = ( ( u[ 1 ][ 0 ] - pu ) * ( u[ 2 ][ 1 ] - pv ) - ( u[ 2 ][ 0 ] - pu ) * ( u[ 1 ][ 1 ] - pv ) ) / d, b = ( ( u[ 2 ][ 0 ] - pu ) * ( u[ 0 ][ 1 ] - pv ) - ( u[ 0 ][ 0 ] - pu ) * ( u[ 2 ][ 1 ] - pv ) ) / d, c = 1 - a - b;
				if ( a < - 1e-4 || b < - 1e-4 || c < - 1e-4 ) continue;
				const x = a * q[ 0 ][ 0 ] + b * q[ 1 ][ 0 ] + c * q[ 2 ][ 0 ], y = a * q[ 0 ][ 1 ] + b * q[ 1 ][ 1 ] + c * q[ 2 ][ 1 ], z = a * q[ 0 ][ 2 ] + b * q[ 1 ][ 2 ] + c * q[ 2 ][ 2 ];
				if ( items.some( s => Math.hypot( s[ 0 ] - x, s[ 2 ] - z ) < 0.02 ) ) continue;		// (on a shared edge: twice)
				const f = v => +v.toFixed( 4 );
				items.push( [ f( x ), f( y ), f( z ), f( Ju[ 0 ] * ru ), f( Ju[ 2 ] * ru ), f( Jv[ 0 ] * rv ), f( Jv[ 2 ] * rv ) ] );

			}

		}

	}
	return items;

}

/** A kind's decal textures from the originals (`dir`) and its kept redraw (`raw`): { color, normal } (WebP). */
export async function grilleTextures( dir, kind, raw ) {

	const g = { ...GRILLES[ kind ] };
	g.uv = await centre( dir, g );
	const ref = await reference( dir, g ), D = await decal( raw, ref.mean );
	return { color: D.png, normal: D.normal, note: `circle r ${ D.circle.r.toFixed( 0 ) } px of ${ D.circle.w }, colour gain ${ D.gain.map( v => v.toFixed( 2 ) ).join( ',' ) }` };

}

/** A kind's grilles in the hall (`doc`: the source GLB, read): [ [ x, y, z, ax, az, bx, bz ] ] in the packs' frame. */
export async function grilleItems( dir, kind, doc ) {

	const g = { ...GRILLES[ kind ] };
	g.uv = await centre( dir, g );
	const full = await sharp( originalOf( dir, g ) ).greyscale().raw().toBuffer( { resolveWithObject: true } ), W = full.info.width, H = full.info.height;
	const peaks = await find( dir, g ), found = [];
	for ( const [ u, v ] of peaks ) { const m = measure( full.data, W, H, u, v, g.r * W ); if ( m ) found.push( m ); }
	return { items: await place( g, found, doc ), note: `${ found.length } of ${ peaks.length } matches measured` };

}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {		// (run, not imported)

	const opt = { originals: null, generated: null, kind: 'all', preview: null, force: false };
	const argv = process.argv.slice( 2 );
	for ( let i = 0; i < argv.length; ++ i ) {

		const a = argv[ i ], v = () => argv[ ++ i ];
		if ( a === '--originals' ) opt.originals = v();
		else if ( a === '--generated' ) opt.generated = v();
		else if ( a === '--kind' ) opt.kind = v();
		else if ( a === '--preview' ) opt.preview = v();
		else if ( a === '--force' ) opt.force = true;
		else throw new Error( `unknown argument ${ a }` );

	}
	if ( ! opt.originals || ! opt.generated ) throw new Error( 'usage: node tools/floor-grille.mjs --originals <dir> --generated <dir> [--kind stage|stalls|all] [--force] [--preview <dir>]' );
	for ( const kind of opt.kind === 'all' ? Object.keys( GRILLES ) : [ opt.kind ] ) {

		const f = path.join( opt.generated, grilleRaw( kind ) );
		if ( opt.preview ) {		// the textures from the kept redraw

			const T = await grilleTextures( opt.originals, kind, fs.readFileSync( f ) );
			fs.mkdirSync( opt.preview, { recursive: true } );
			fs.writeFileSync( path.join( opt.preview, `grille-${ kind }.webp` ), T.color ); fs.writeFileSync( path.join( opt.preview, `grille-${ kind }-normal.webp` ), T.normal );
			console.log( `${ kind }: ${ T.note } -> ${ opt.preview }` );
			continue;

		}
		if ( fs.existsSync( f ) && ! opt.force ) throw new Error( `${ f } exists (--force to replace it)` );		// (a paid call)
		const g = { ...GRILLES[ kind ] };
		g.uv = await centre( opt.originals, g );
		fs.mkdirSync( opt.generated, { recursive: true } );
		fs.writeFileSync( f, await generate( g, await reference( opt.originals, g ) ) );
		console.log( `${ f }: generated` );
		await new Promise( r => setTimeout( r, 3000 ) );		// (POSTs 3 s apart)

	}

}

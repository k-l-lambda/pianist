// The Konzerthaus Berlin's Großer Saal (a textured GLB, `--src`) -> public/berlinhall/: two compact
// GLBs for the concert-hall venue: `stage` (the stage, the organ end and the hall beside
// them: loaded first) and `house` (the rest), with PBR materials made from the source's textures.
// Measured in the source and used here:
//   - 97 nodes (translations only), cm, z up; one material per part, named as the hall's surfaces
//     (`buehne-wand`, `pillow-2`, ...), each with one baked colour texture (2048², JPEG, lighting
//     and occlusion baked in); the chandeliers and candles have an emissive texture too.
//   - The geometry is clean (15 triangles of 920k wound against their normals: turned round); the
//     wings mirror each other in position but not in UVs (each its own part of the atlas): stored
//     both, no instancing.
// Materials: from each baked texture (in its UV islands only, so nothing bleeds across a seam)
//   - albedo: the texture with its broad baked lighting divided out (the luminance blurred over
//     LIGHT_SIGMA of the texture, relative to its islands' mean, to the power DELIGHT), then scaled
//     to the look's luminance (LOOKS: after photographs of the Großer Saal);
//   - ORM: occlusion from the same baked light where it is darker than the mean (half of it, to
//     the power AO); roughness the look's, less on fine bright detail; metalness: gold-coloured
//     texels of the gilt looks (hue 28-58°, saturation over ~0.5, bright) are gold leaf (metallic 1, rougher
//     in its dark creases), the rest the look's;
//   - normal: the fine detail of the texture (a high-pass of its luminance) as a height, at the
//     look's strength (plaster flat, ornaments deep).
// Velvet and curtains get KHR_materials_sheen. All WebP (EXT_texture_webp).
// Size: geometry cut into bands along the hall (BAND m), each simplified to an error of
// `--error-px` screen pixels at its nearest distance from where the camera goes (CAMERA_ZONE);
// each texture per pack at the size that gives `--texel` screen pixels per texel (PERCENTILE of
// its triangles, by UV area) at that distance, at most `--max-texture` (the stage pack) or
// `--house-texture` (the house): the stage's own sharp, the house's smaller. Normals and ORM at
// half the albedo's size.
// Output frame: metres, y up, x across (the audience's right +), z from the stage's front edge
// towards the back of the hall (the stage at z < 0), y 0 at the stalls floor (the stage's front
// at 0.61 m). The frame and the options are in each GLB's extras.
//
//   node tools/hall-asset.mjs --src <Berlin_Hall_textured_preview.glb> [--out public/berlinhall]
//        [--error-px 1] [--texel 2] [--max-texture 2048] [--house-texture 1024] [--lock-border] [--no-simplify]
//
// --no-simplify: the same output without simplification (to compare against).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMaterialsSheen, KHRMeshQuantization } from '@gltf-transform/extensions';
import { cloneDocument, join, prune, quantize, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- options ----
const opt = { src: null, out: 'public/berlinhall', errorPx: 1, texel: 2, maxTexture: 2048, houseTexture: 1024, lockBorder: false, simplify: true };
const argv = process.argv.slice( 2 );
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--src' ) opt.src = v();
	else if ( a === '--out' ) opt.out = v();
	else if ( a === '--error-px' ) opt.errorPx = Number( v() );
	else if ( a === '--texel' ) opt.texel = Number( v() );
	else if ( a === '--max-texture' ) opt.maxTexture = Number( v() );
	else if ( a === '--house-texture' ) opt.houseTexture = Number( v() );
	else if ( a === '--lock-border' ) opt.lockBorder = true;
	else if ( a === '--no-simplify' ) opt.simplify = false;
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! opt.src ) throw new Error( 'usage: node tools/hall-asset.mjs --src <the textured GLB> [--out public/berlinhall] ...' );
const SRC = path.resolve( opt.src ), OUT = path.resolve( root, opt.out );
fs.mkdirSync( OUT, { recursive: true } );

// screen: the default view (vertical FOV 36 deg, 1080 px): metres per pixel per metre of distance
const PX_PER_M = 2 * Math.tan( 36 / 2 * Math.PI / 180 ) / 1080;
const BAND = 4;			// m, along the hall (z)
const STAGE_Z = 0.5;		// bands wholly at z < this go to the stage pack
const MIN_TEXTURE = 128;
const PERCENTILE = 0.75;		// of a texture's triangles (by UV area) that get their density
// materials from the baked textures
const LIGHT_SIGMA = 1 / 48;		// of the texture's width: the scale of the baked lighting taken out
const DELIGHT = 0.75;				// how much of it (1: all)
const AO = 0.5;					// the part of the darkening kept as occlusion
const DETAIL_SIGMA = 1 / 400;		// of the width: the fine detail (normals, roughness)

// ---- the source's frame -> ours. Source world: cm, z up; the hall's axis at x = -35.5 cm, the
// stage's front edge at y = 1205 cm (its floor there 804 cm, the stalls' 743 cm), the stage
// towards +y. Ours: x_h = x - axis, y_h = z - stalls, z_h = edge - y (metres).
const AXIS_X = - 35.5, EDGE_Y = 1205, STALLS_Z = 743.4;
const FRAME = [		// column-major (glTF): source world (cm) -> ours (m)
	0.01, 0, 0, 0,
	0, 0, - 0.01, 0,
	0, 0.01, 0, 0,
	- AXIS_X * 0.01, - STALLS_Z * 0.01, EDGE_Y * 0.01, 1,
];
// where the phone goes: round the piano on the stage (ours), for distances
const CAMERA_ZONE = { min: [ - 3, 1.1, - 7 ], max: [ 3, 2.6, 0 ] };

// ---- looks (sRGB colours: the albedo's mean; after photographs of the Großer Saal: ivory walls
// and gilt mouldings, red velvet seats, oak floors, white marble busts). `normal`: the relief's
// strength; `gold`: gold-coloured texels are gold leaf.
const LOOKS = {
	ivory: { color: '#e8dfcc', roughness: 0.8, normal: 0.6 },
	ivoryGilt: { color: '#dcc79a', roughness: 0.6, normal: 1.6, gold: true },
	gilt: { color: '#d4ad5c', roughness: 0.45, normal: 2, gold: true },
	velvet: { color: '#6e1410', roughness: 0.85, normal: 1.2, sheen: '#c0392b' },
	curtain: { color: '#5a1a12', roughness: 0.9, normal: 1.4, sheen: '#9a3a2a' },
	woodFrame: { color: '#4a2e1a', roughness: 0.5, normal: 1 },
	stageFloor: { color: '#b98a5c', roughness: 0.45, normal: 0.6 },
	stagePanel: { color: '#c6a27a', roughness: 0.5, normal: 0.6 },
	parquet: { color: '#8a5a32', roughness: 0.4, normal: 0.6 },
	parquetDark: { color: '#5e3a1f', roughness: 0.45, normal: 0.6 },
	marble: { color: '#ece8e0', roughness: 0.3, normal: 0.8 },
	stone: { color: '#ddd5c6', roughness: 0.55, normal: 1.4 },
	plinth: { color: '#b8ab99', roughness: 0.35, normal: 0.6 },
	redMarble: { color: '#7d2a1f', roughness: 0.2, normal: 0.4 },
	organ: { color: '#c9c3b8', roughness: 0.3, metallic: 0.8, normal: 0.8 },
	wax: { color: '#f1ebdc', roughness: 0.6, normal: 0.4 },
};
const LOOK_OF = {
	'1er-oberrang-waende': 'ivory', '2ter-oberrang': 'ivoryGilt', '2ter-oberrang-old': 'ivoryGilt', 'beethoven-saal_saeule': 'ivoryGilt',
	'benches': 'ivory', 'brahms-buesten': 'marble', 'haendel-buesten-low': 'marble', 'wagner-buesten': 'marble',
	'bruestung-eins': 'ivoryGilt', 'bruestung-zwei-low': 'ivoryGilt', 'buehne-platten': 'stageFloor', 'buehnen-parkett': 'stageFloor',
	'buehne-wand': 'stagePanel', 'buesten-sockel': 'plinth', 'grauer-sockel': 'plinth', 'kerzen-staender-sockel': 'plinth',
	'chair-01': 'woodFrame', 'chair-2': 'woodFrame', 'chair-3': 'woodFrame', 'chair-4': 'woodFrame',
	'pillow-1': 'velvet', 'pillow-2': 'velvet', 'pillow-3': 'velvet', 'pillow-4-low': 'velvet', 'curtains-low': 'curtain',
	'decke': 'ivoryGilt', 'decke-parket': 'ivory', 'parkett-waende-tueren_diff': 'ivory',
	'fisch-saeule': 'gilt', 'ornament-traeger': 'gilt', 'orgel-ornament': 'gilt', 'kerzen-staender': 'gilt', 'kerzenstaender_klein': 'gilt', 'kronleuchter': 'gilt',
	'kerzen-2-low': 'wax', 'orgel': 'organ', 'statuen': 'stone', 'saeulen-klein': 'redMarble',
	'parkett': 'parquet', 'parkett-2': 'parquetDark', 'parkett-3': 'parquetDark', 'parkett-4': 'parquetDark', 'raenge-parkett': 'parquetDark', 'raenge-parkett2': 'parquetDark',
};

// ---- small helpers ----
const TO_LINEAR = Float32Array.from( { length: 256 }, ( _, i ) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4; } );
const toSrgb = v => { v = Math.min( 1, Math.max( 0, v ) ); return Math.round( 255 * ( v <= 0.0031308 ? 12.92 * v : 1.055 * v ** ( 1 / 2.4 ) - 0.055 ) ); };
const linear = hex => [ 1, 3, 5 ].map( k => TO_LINEAR[ parseInt( hex.slice( k, k + 2 ), 16 ) ] );
const luma = ( r, g, b ) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = ( a, b, x ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };
const mul = ( a, b ) => {		// column-major 4x4: a * b

	const o = new Array( 16 ).fill( 0 );
	for ( let c = 0; c < 4; ++ c ) for ( let r = 0; r < 4; ++ r ) for ( let k = 0; k < 4; ++ k ) o[ c * 4 + r ] += a[ k * 4 + r ] * b[ c * 4 + k ];
	return o;

};
const boxDistance = ( a, b ) => Math.hypot( ...[ 0, 1, 2 ].map( k => Math.max( 0, a.min[ k ] - b.max[ k ], b.min[ k ] - a.max[ k ] ) ) );
const tris = d => d.getRoot().listMeshes().reduce( ( s, m ) => s + m.listPrimitives().reduce( ( t, p ) => t + ( p.getIndices()?.getCount() ?? 0 ) / 3, 0 ), 0 );
const log = [];
const say = s => { console.log( s ); log.push( s ); };

// ---- images: separable box blurs (three make a Gaussian), masks of UV islands ----
function boxPass( src, dst, w, h, r, horizontal ) {

	const n = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w, next = horizontal ? w : 1, k = 1 / ( 2 * r + 1 );
	for ( let l = 0; l < lines; ++ l ) {

		const o = l * next;
		let s = 0;
		for ( let i = - r; i <= r; ++ i ) s += src[ o + Math.min( n - 1, Math.max( 0, i ) ) * step ];
		for ( let i = 0; i < n; ++ i ) {

			dst[ o + i * step ] = s * k;
			s += src[ o + Math.min( n - 1, i + r + 1 ) * step ] - src[ o + Math.max( 0, i - r ) * step ];

		}

	}

}
function blur( a, w, h, sigma ) {		// in place

	const r = Math.max( 1, Math.round( ( Math.sqrt( 4 * sigma * sigma + 1 ) - 1 ) / 2 ) ), t = new Float32Array( a.length );
	for ( let p = 0; p < 3; ++ p ) { boxPass( a, t, w, h, r, true ); boxPass( t, a, w, h, r, false ); }
	return a;

}
/** A blur of `a` over the mask `m` only (normalised convolution: nothing from outside the islands). */
function maskedBlur( a, m, w, h, sigma ) {

	const am = new Float32Array( a.length ), mm = Float32Array.from( m );
	for ( let i = 0; i < a.length; ++ i ) am[ i ] = a[ i ] * m[ i ];
	blur( am, w, h, sigma ); blur( mm, w, h, sigma );
	for ( let i = 0; i < a.length; ++ i ) am[ i ] = mm[ i ] > 1e-3 ? am[ i ] / mm[ i ] : a[ i ];
	return am;

}
/** The texels the triangles cover (UVs in [0, 1], v down the image as glTF), dilated by 2. */
function rasterMask( uv, w, h ) {

	let m = new Uint8Array( w * h );
	for ( let t = 0; t < uv.length; t += 6 ) {

		const x0 = uv[ t ] * w, y0 = uv[ t + 1 ] * h, x1 = uv[ t + 2 ] * w, y1 = uv[ t + 3 ] * h, x2 = uv[ t + 4 ] * w, y2 = uv[ t + 5 ] * h;
		const d = ( x1 - x0 ) * ( y2 - y0 ) - ( x2 - x0 ) * ( y1 - y0 );
		const ax = Math.max( 0, Math.floor( Math.min( x0, x1, x2 ) ) ), bx = Math.min( w - 1, Math.ceil( Math.max( x0, x1, x2 ) ) );
		const ay = Math.max( 0, Math.floor( Math.min( y0, y1, y2 ) ) ), by = Math.min( h - 1, Math.ceil( Math.max( y0, y1, y2 ) ) );
		if ( Math.abs( d ) < 1e-9 ) { for ( let y = ay; y <= by; ++ y ) for ( let x = ax; x <= bx; ++ x ) m[ y * w + x ] = 1; continue; }
		for ( let y = ay; y <= by; ++ y ) for ( let x = ax; x <= bx; ++ x ) {

			const px = x + 0.5, py = y + 0.5;
			const a = ( ( x1 - px ) * ( y2 - py ) - ( x2 - px ) * ( y1 - py ) ) / d, b = ( ( x2 - px ) * ( y0 - py ) - ( x0 - px ) * ( y2 - py ) ) / d;
			if ( a >= - 0.02 && b >= - 0.02 && 1 - a - b >= - 0.02 ) m[ y * w + x ] = 1;

		}

	}
	for ( let p = 0; p < 2; ++ p ) {		// dilate (the edge texels a sampler still reads)

		const o = m.slice();
		for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) if ( ! m[ y * w + x ] && ( ( x > 0 && m[ y * w + x - 1 ] ) || ( x < w - 1 && m[ y * w + x + 1 ] ) || ( y > 0 && m[ ( y - 1 ) * w + x ] ) || ( y < h - 1 && m[ ( y + 1 ) * w + x ] ) ) ) o[ y * w + x ] = 1;
		m = o;

	}
	return m;

}

/** Gold leaf in an sRGB texel (0-255): 0..1. */
function goldness( r, g, b ) {

	const mx = Math.max( r, g, b ), mn = Math.min( r, g, b ), s = mx > 0 ? ( mx - mn ) / mx : 0, v = mx / 255;
	if ( mx === mn ) return 0;
	let hue = mx === r ? ( g - b ) / ( mx - mn ) : mx === g ? 2 + ( b - r ) / ( mx - mn ) : 4 + ( r - g ) / ( mx - mn );
	hue = ( hue * 60 + 360 ) % 360;
	return smooth( 0.42, 0.58, s ) * smooth( 0.3, 0.5, v ) * smooth( 24, 32, hue ) * ( 1 - smooth( 54, 62, hue ) );		// (cream plaster: s < 0.4)

}

/**
 * The PBR maps of one baked texture (`image`: its encoded bytes; `uv`: its triangles' UVs, 6 per
 * triangle; `look`): full-size Buffers of RGB (albedo, sRGB), ORM and normal (linear), and stats.
 */
async function derive( image, uv, look ) {

	const { data, info } = await sharp( image ).removeAlpha().raw().toBuffer( { resolveWithObject: true } );
	const w = info.width, h = info.height, n = w * h, L = LOOKS[ look ];
	const mask = rasterMask( uv, w, h );
	let covered = 0; for ( let i = 0; i < n; ++ i ) covered += mask[ i ];
	const lin = new Float32Array( 3 * n ), Y = new Float32Array( n ), M = new Float32Array( n );
	for ( let i = 0; i < n; ++ i ) {

		lin[ 3 * i ] = TO_LINEAR[ data[ 3 * i ] ]; lin[ 3 * i + 1 ] = TO_LINEAR[ data[ 3 * i + 1 ] ]; lin[ 3 * i + 2 ] = TO_LINEAR[ data[ 3 * i + 2 ] ];
		Y[ i ] = luma( lin[ 3 * i ], lin[ 3 * i + 1 ], lin[ 3 * i + 2 ] ); M[ i ] = mask[ i ];

	}
	// the baked light: luminance over the islands, at a low resolution (a block mean), blurred
	const f = Math.max( 1, Math.round( w / 512 ) ), lw = Math.ceil( w / f ), lh = Math.ceil( h / f );
	const lY = new Float32Array( lw * lh ), lM = new Float32Array( lw * lh );
	for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) { const i = y * w + x, j = Math.floor( y / f ) * lw + Math.floor( x / f ); lY[ j ] += Y[ i ] * M[ i ]; lM[ j ] += M[ i ]; }
	for ( let j = 0; j < lY.length; ++ j ) { lY[ j ] = lM[ j ] > 0 ? lY[ j ] / lM[ j ] : 0; lM[ j ] = lM[ j ] > 0 ? 1 : 0; }
	const light = maskedBlur( lY, lM, lw, lh, LIGHT_SIGMA * lw );
	let sum = 0, cnt = 0; for ( let i = 0; i < n; ++ i ) if ( mask[ i ] ) { sum += Y[ i ]; ++ cnt; }
	const mean = cnt ? sum / cnt : 1;
	const shadeAt = ( x, y ) => {		// bilinear in the low-res light, relative to the mean

		const fx = Math.min( lw - 1, Math.max( 0, ( x + 0.5 ) / f - 0.5 ) ), fy = Math.min( lh - 1, Math.max( 0, ( y + 0.5 ) / f - 0.5 ) );
		const x0 = Math.floor( fx ), y0 = Math.floor( fy ), x1 = Math.min( lw - 1, x0 + 1 ), y1 = Math.min( lh - 1, y0 + 1 ), ax = fx - x0, ay = fy - y0;
		const v = ( light[ y0 * lw + x0 ] * ( 1 - ax ) + light[ y0 * lw + x1 ] * ax ) * ( 1 - ay ) + ( light[ y1 * lw + x0 ] * ( 1 - ax ) + light[ y1 * lw + x1 ] * ax ) * ay;
		return Math.min( 4, Math.max( 0.25, v / mean ) );

	};
	// albedo: delit, then at the look's mean luminance
	const shade = new Float32Array( n );
	for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) shade[ y * w + x ] = shadeAt( x, y );
	const alb = new Float32Array( 3 * n );
	let aSum = 0;
	for ( let i = 0; i < n; ++ i ) {

		const s = shade[ i ] ** DELIGHT;
		alb[ 3 * i ] = lin[ 3 * i ] / s; alb[ 3 * i + 1 ] = lin[ 3 * i + 1 ] / s; alb[ 3 * i + 2 ] = lin[ 3 * i + 2 ] / s;
		if ( mask[ i ] ) aSum += luma( alb[ 3 * i ], alb[ 3 * i + 1 ], alb[ 3 * i + 2 ] );

	}
	const target = luma( ...linear( L.color ) ), gain = Math.min( 3, Math.max( 0.5, target / Math.max( 1e-4, aSum / Math.max( 1, cnt ) ) ) );
	// metalness (gold leaf), roughness, from the source's colours and the fine detail
	const metal = new Float32Array( n );
	let gold = 0;
	if ( L.gold ) for ( let i = 0; i < n; ++ i ) { metal[ i ] = mask[ i ] ? goldness( data[ 3 * i ], data[ 3 * i + 1 ], data[ 3 * i + 2 ] ) : 0; gold += metal[ i ]; }
	const H = new Float32Array( n );
	for ( let i = 0; i < n; ++ i ) H[ i ] = Math.sqrt( luma( alb[ 3 * i ], alb[ 3 * i + 1 ], alb[ 3 * i + 2 ] ) );
	const Hs = maskedBlur( H, M, w, h, DETAIL_SIGMA * w );
	const rgb = Buffer.alloc( 3 * n ), orm = Buffer.alloc( 3 * n ), nor = Buffer.alloc( 3 * n );
	const k = L.normal * w / 96;		// slope per unit of high-pass per texel, at 96 texels a width
	for ( let y = 0; y < h; ++ y ) for ( let x = 0; x < w; ++ x ) {

		const i = y * w + x, g = metal[ i ];
		let r = alb[ 3 * i ] * gain, gg = alb[ 3 * i + 1 ] * gain, b = alb[ 3 * i + 2 ] * gain;
		if ( g > 0 ) {		// gold leaf: a metal's albedo is its reflectance (bright)

			const lum = luma( r, gg, b ), up = 1 + g * ( Math.max( 1, 0.55 / Math.max( 1e-3, lum ) ) - 1 );
			r *= up; gg *= up; b *= up;

		}
		rgb[ 3 * i ] = toSrgb( r ); rgb[ 3 * i + 1 ] = toSrgb( gg ); rgb[ 3 * i + 2 ] = toSrgb( b );
		if ( ! mask[ i ] ) { orm[ 3 * i ] = 255; orm[ 3 * i + 1 ] = Math.round( 255 * L.roughness ); orm[ 3 * i + 2 ] = Math.round( 255 * ( L.metallic ?? 0 ) ); nor[ 3 * i ] = 128; nor[ 3 * i + 1 ] = 128; nor[ 3 * i + 2 ] = 255; continue; }
		const hp = H[ i ] - Hs[ i ];
		const ao = Math.min( 1, shade[ i ] ) ** ( AO * DELIGHT );
		const rough = Math.min( 1, Math.max( 0.05, ( 1 - g ) * L.roughness + g * ( 0.28 + 0.4 * ( 1 - Math.min( 1, Math.sqrt( Y[ i ] ) / 0.7 ) ) ) - 0.6 * Math.max( 0, hp ) ) );
		orm[ 3 * i ] = Math.round( 255 * ao ); orm[ 3 * i + 1 ] = Math.round( 255 * rough ); orm[ 3 * i + 2 ] = Math.round( 255 * Math.max( g, L.metallic ?? 0 ) );
		// normal: the high-pass as a height (bright up); glTF: +x along u, +y towards v = 0 (image up)
		const at = ( dx, dy ) => { const xx = Math.min( w - 1, Math.max( 0, x + dx ) ), yy = Math.min( h - 1, Math.max( 0, y + dy ) ), j = yy * w + xx; return mask[ j ] ? H[ j ] - Hs[ j ] : hp; };
		const gx = ( at( 1, - 1 ) + 2 * at( 1, 0 ) + at( 1, 1 ) - at( - 1, - 1 ) - 2 * at( - 1, 0 ) - at( - 1, 1 ) ) / 8;
		const gy = ( at( - 1, 1 ) + 2 * at( 0, 1 ) + at( 1, 1 ) - at( - 1, - 1 ) - 2 * at( 0, - 1 ) - at( 1, - 1 ) ) / 8;
		let nx = - k * gx, ny = k * gy, nz = 1;
		const l = Math.hypot( nx, ny, nz ); nx /= l; ny /= l; nz /= l;
		nor[ 3 * i ] = Math.round( 127.5 * ( nx + 1 ) ); nor[ 3 * i + 1 ] = Math.round( 127.5 * ( ny + 1 ) ); nor[ 3 * i + 2 ] = Math.round( 127.5 * ( nz + 1 ) );

	}
	return { w, h, rgb, orm, nor, stats: { coverage: covered / n, gain, gold: cnt ? gold / cnt : 0 } };

}

const encode = ( raw, w, h, size, quality, smooth = true ) => sharp( raw, { raw: { width: w, height: h, channels: 3 } } )
	.resize( size, size, { kernel: smooth ? 'lanczos3' : 'cubic' } ).webp( { quality, effort: 5 } ).toBuffer();

/** The triangles of `prim` in z bands of BAND m: [ { band, primitive } ] (new, compact accessors). */
function splitByZ( doc, prim ) {

	const P = prim.getAttribute( 'POSITION' ).getArray(), I = prim.getIndices().getArray();
	const semantics = prim.listSemantics(), arrays = semantics.map( s => prim.getAttribute( s ) );
	const groups = new Map();
	for ( let t = 0; t < I.length; t += 3 ) {

		const z = ( P[ 3 * I[ t ] + 2 ] + P[ 3 * I[ t + 1 ] + 2 ] + P[ 3 * I[ t + 2 ] + 2 ] ) / 3;
		const b = Math.floor( z / BAND );
		if ( ! groups.has( b ) ) groups.set( b, [] );
		groups.get( b ).push( t );

	}
	const buffer = doc.getRoot().listBuffers()[ 0 ];
	return [ ...groups ].map( ( [ band, ts ] ) => {

		const remap = new Map(), idx = new Uint32Array( ts.length * 3 );
		ts.forEach( ( t, j ) => { for ( let c = 0; c < 3; ++ c ) { const v = I[ t + c ]; if ( ! remap.has( v ) ) remap.set( v, remap.size ); idx[ 3 * j + c ] = remap.get( v ); } } );
		const p = doc.createPrimitive().setMaterial( prim.getMaterial() )
			.setIndices( doc.createAccessor().setType( 'SCALAR' ).setArray( idx ).setBuffer( buffer ) );
		semantics.forEach( ( s, k ) => {

			const a = arrays[ k ], src = a.getArray(), e = a.getElementSize(), out = new Float32Array( remap.size * e );
			for ( const [ v, wv ] of remap ) for ( let c = 0; c < e; ++ c ) out[ e * wv + c ] = src[ e * v + c ];
			p.setAttribute( s, doc.createAccessor().setType( a.getType() ).setArray( out ).setBuffer( buffer ) );

		} );
		return { band, primitive: p };

	} );

}

// ---- main ----
const t0 = Date.now();
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions( [ EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsSheen, EXTTextureWebP ] ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const doc = await io.read( SRC );
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[ 0 ];
const nodes = scene.listChildren();
say( `source: ${ path.basename( SRC ) }, ${ nodes.length } nodes, ${ tris( doc ) } triangles, ${ doc.getRoot().listTextures().length } textures` );

// 1. bake each node into our frame (each mesh is one node's here); positions, normals, UVs
const seen = new Set();
for ( const node of nodes ) {

	if ( seen.has( node.getMesh() ) ) node.setMesh( node.getMesh().clone() );
	seen.add( node.getMesh() );
	const M = mul( FRAME, node.getWorldMatrix() );
	for ( const p of node.getMesh().listPrimitives() ) {

		const P = p.getAttribute( 'POSITION' ), A = P.getArray().slice();
		for ( let k = 0; k < A.length; k += 3 ) {

			const [ x, y, z ] = [ A[ k ], A[ k + 1 ], A[ k + 2 ] ];
			A[ k ] = M[ 0 ] * x + M[ 4 ] * y + M[ 8 ] * z + M[ 12 ]; A[ k + 1 ] = M[ 1 ] * x + M[ 5 ] * y + M[ 9 ] * z + M[ 13 ]; A[ k + 2 ] = M[ 2 ] * x + M[ 6 ] * y + M[ 10 ] * z + M[ 14 ];

		}
		P.setArray( A );
		const Nm = p.getAttribute( 'NORMAL' );
		if ( Nm ) {		// rotation * uniform scale: the rotation, renormalised

			const B = Nm.getArray().slice();
			for ( let k = 0; k < B.length; k += 3 ) {

				const v = [ M[ 0 ] * B[ k ] + M[ 4 ] * B[ k + 1 ] + M[ 8 ] * B[ k + 2 ], M[ 1 ] * B[ k ] + M[ 5 ] * B[ k + 1 ] + M[ 9 ] * B[ k + 2 ], M[ 2 ] * B[ k ] + M[ 6 ] * B[ k + 1 ] + M[ 10 ] * B[ k + 2 ] ];
				const l = Math.hypot( ...v ) || 1; B[ k ] = v[ 0 ] / l; B[ k + 1 ] = v[ 1 ] / l; B[ k + 2 ] = v[ 2 ] / l;

			}
			Nm.setArray( B );

		}
		for ( const s of p.listSemantics() ) if ( ! [ 'POSITION', 'NORMAL', 'TEXCOORD_0' ].includes( s ) ) p.setAttribute( s, null );

	}
	node.setTranslation( [ 0, 0, 0 ] ).setRotation( [ 0, 0, 0, 1 ] ).setScale( [ 1, 1, 1 ] );

}
// (the few triangles wound against their vertex normals: turned round, as double-sided three.js
// shades a triangle's back with the normal reversed)
let flipped = 0;
for ( const node of nodes ) for ( const p of node.getMesh().listPrimitives() ) {

	const P = p.getAttribute( 'POSITION' ).getArray(), N = p.getAttribute( 'NORMAL' )?.getArray(), I = p.getIndices().getArray();
	if ( ! N ) continue;
	for ( let t = 0; t < I.length; t += 3 ) {

		const [ a, b, c ] = [ 3 * I[ t ], 3 * I[ t + 1 ], 3 * I[ t + 2 ] ];
		const u = [ P[ b ] - P[ a ], P[ b + 1 ] - P[ a + 1 ], P[ b + 2 ] - P[ a + 2 ] ], v = [ P[ c ] - P[ a ], P[ c + 1 ] - P[ a + 1 ], P[ c + 2 ] - P[ a + 2 ] ];
		const f = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ];
		if ( [ a, b, c ].reduce( ( s, k ) => s + f[ 0 ] * N[ k ] + f[ 1 ] * N[ k + 1 ] + f[ 2 ] * N[ k + 2 ], 0 ) < 0 ) { const x = I[ t + 1 ]; I[ t + 1 ] = I[ t + 2 ]; I[ t + 2 ] = x; ++ flipped; }

	}
	p.getIndices().setArray( I );

}
say( `triangles turned round: ${ flipped }` );

// 2. per material: its look, its triangles' UVs (for the islands), the texel density each pack
// needs (screen pixels per texel at --texel, at each triangle's band's distance)
const mats = new Map();		// source material -> { look, uv: [], need: { stage: [ [ texels, weight ] ], house: [] } }
const unknown = new Set();
for ( const node of nodes ) for ( const p of node.getMesh().listPrimitives() ) {

	const m = p.getMaterial();
	if ( ! mats.has( m ) ) {

		let look = LOOK_OF[ m.getName() ];
		if ( ! look ) { unknown.add( m.getName() ); look = 'ivory'; }
		mats.set( m, { look, uv: [], need: { stage: [], house: [] } } );

	}
	const e = mats.get( m ), P = p.getAttribute( 'POSITION' ).getArray(), U = p.getAttribute( 'TEXCOORD_0' ).getArray(), I = p.getIndices().getArray();
	for ( let t = 0; t < I.length; t += 3 ) {

		const [ a, b, c ] = [ I[ t ], I[ t + 1 ], I[ t + 2 ] ];
		e.uv.push( U[ 2 * a ], U[ 2 * a + 1 ], U[ 2 * b ], U[ 2 * b + 1 ], U[ 2 * c ], U[ 2 * c + 1 ] );
		const u = [ 0, 1, 2 ].map( k => P[ 3 * b + k ] - P[ 3 * a + k ] ), v = [ 0, 1, 2 ].map( k => P[ 3 * c + k ] - P[ 3 * a + k ] );
		const area = Math.hypot( u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ) / 2;
		const uvArea = Math.abs( ( U[ 2 * b ] - U[ 2 * a ] ) * ( U[ 2 * c + 1 ] - U[ 2 * a + 1 ] ) - ( U[ 2 * c ] - U[ 2 * a ] ) * ( U[ 2 * b + 1 ] - U[ 2 * a + 1 ] ) ) / 2;
		if ( area < 1e-8 || uvArea < 1e-10 ) continue;
		const zs = [ a, b, c ].map( k => P[ 3 * k + 2 ] ), lo = [ 0, 1, 2 ].map( k => Math.min( P[ 3 * a + k ], P[ 3 * b + k ], P[ 3 * c + k ] ) ), hi = [ 0, 1, 2 ].map( k => Math.max( P[ 3 * a + k ], P[ 3 * b + k ], P[ 3 * c + k ] ) );
		const d = Math.max( 1.5, boxDistance( { min: lo, max: hi }, CAMERA_ZONE ) );
		const texels = Math.sqrt( area / uvArea ) / ( PX_PER_M * d ) / opt.texel;		// texels a UV unit needs
		// a triangle's pack: as its band's (the band's max z, below: about it)
		const pack = Math.max( ...zs ) < STAGE_Z ? 'stage' : 'house';
		e.need[ pack ].push( [ texels, uvArea ] );

	}

}
if ( unknown.size ) say( `  no look for ${ [ ...unknown ].join( ', ' ) }: ivory` );
const sizeFor = ( need, full, cap ) => {		// the PERCENTILE by UV area, a power of two

	if ( ! need.length ) return 0;
	need.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
	const total = need.reduce( ( s, x ) => s + x[ 1 ], 0 );
	let acc = 0, v = need[ need.length - 1 ][ 0 ];
	for ( const [ t, w ] of need ) { acc += w; if ( acc >= PERCENTILE * total ) { v = t; break; } }
	const p2 = 2 ** Math.round( Math.log2( Math.max( 1, v ) ) );
	return Math.min( full, cap, Math.max( MIN_TEXTURE, p2 ) );

};

// 3. materials: the PBR maps per source texture, encoded at each pack's size
const sheenExt = doc.createExtension( KHRMaterialsSheen );
doc.createExtension( EXTTextureWebP ).setRequired( true );
const packTex = { stage: new Map(), house: new Map() };		// source material -> { base, orm, normal, emissive } (Textures)
const texLog = [], used = new Set();		// the source's textures, dropped once all are read
let texBytes = { stage: 0, house: 0 }, gpu = { stage: 0, house: 0 };
for ( const [ m, e ] of mats ) {

	const tex = m.getBaseColorTexture(), L = LOOKS[ e.look ];
	if ( ! tex ) continue;
	const D = await derive( tex.getImage(), e.uv, e.look );
	const emissive = m.getEmissiveTexture();
	const sizes = {};
	for ( const pack of [ 'stage', 'house' ] ) {

		const s = sizeFor( e.need[ pack ], D.w, pack === 'stage' ? opt.maxTexture : opt.houseTexture );
		if ( ! s ) continue;
		sizes[ pack ] = s;
		const half = Math.max( MIN_TEXTURE, s / 2 );
		const img = async ( buf, size, q, name ) => {

			const b = await encode( buf, D.w, D.h, size, q );
			texBytes[ pack ] += b.length; gpu[ pack ] += size * size * 4 * 4 / 3;
			return doc.createTexture( `${ m.getName() }-${ name }-${ pack }` ).setImage( b ).setMimeType( 'image/webp' );

		};
		const t = { base: await img( D.rgb, s, 85, 'base' ), orm: await img( D.orm, half, 90, 'orm' ), normal: await img( D.nor, half, 92, 'normal' ) };
		if ( emissive ) {

			const { data, info } = await sharp( emissive.getImage() ).removeAlpha().raw().toBuffer( { resolveWithObject: true } );
			const b = await sharp( data, { raw: { width: info.width, height: info.height, channels: 3 } } ).resize( half, half ).webp( { quality: 85 } ).toBuffer();
			texBytes[ pack ] += b.length; gpu[ pack ] += half * half * 4 * 4 / 3;
			t.emissive = doc.createTexture( `${ m.getName() }-emissive-${ pack }` ).setImage( b ).setMimeType( 'image/webp' );

		}
		packTex[ pack ].set( m, t );

	}
	texLog.push( `${ m.getName() } (${ e.look }): stage ${ sizes.stage ?? '-' }, house ${ sizes.house ?? '-' }; gain ${ D.stats.gain.toFixed( 2 ) }, gold ${ ( 100 * D.stats.gold ).toFixed( 0 ) } %, islands ${ ( 100 * D.stats.coverage ).toFixed( 0 ) } %` );
	// the material's own settings (the textures are set per pack below)
	m.setBaseColorFactor( [ 1, 1, 1, 1 ] ).setRoughnessFactor( 1 ).setMetallicFactor( 1 ).setDoubleSided( true ).setAlphaMode( 'OPAQUE' );
	m.setExtras( { look: e.look, lamp: !! emissive } );
	if ( L.sheen ) m.setExtension( 'KHR_materials_sheen', sheenExt.createSheen().setSheenColorFactor( linear( L.sheen ) ).setSheenRoughnessFactor( 0.5 ) );
	m.setBaseColorTexture( null ).setEmissiveTexture( null ).setMetallicRoughnessTexture( null ).setOcclusionTexture( null ).setNormalTexture( null );
	if ( ! emissive ) m.setEmissiveFactor( [ 0, 0, 0 ] );
	used.add( tex ); if ( emissive ) used.add( emissive );
	console.log( '  ' + texLog[ texLog.length - 1 ] );

}
log.push( ...texLog.map( s => '  ' + s ) );
for ( const t of used ) t.dispose();

// 4. bands, simplified by distance (UVs kept: a seam is a border the simplifier keeps); grouped by pack
const groups = {};
const group = name => groups[ name ] ??= ( () => { const g = doc.createNode( name ); scene.addChild( g ); return g; } )();
let before = 0, after = 0; const perLook = {};
for ( const node of scene.listChildren().filter( n => n.getMesh() ) ) {

	for ( const prim of node.getMesh().listPrimitives() ) {

		before += prim.getIndices().getCount() / 3;
		const look = mats.get( prim.getMaterial() ).look; perLook[ look ] ??= [ 0, 0 ]; perLook[ look ][ 0 ] += prim.getIndices().getCount() / 3;
		weldPrimitive( prim, {} );
		for ( const { band, primitive } of splitByZ( doc, prim ) ) {

			const P = primitive.getAttribute( 'POSITION' ), lo = P.getMin( [] ), hi = P.getMax( [] );
			if ( opt.simplify ) {

				const d = Math.max( 0.3, boxDistance( { min: lo, max: hi }, CAMERA_ZONE ) );
				const ext = Math.max( ...[ 0, 1, 2 ].map( k => hi[ k ] - lo[ k ] ), 1e-3 );
				simplifyPrimitive( primitive, { simplifier: MeshoptSimplifier, ratio: 0, error: opt.errorPx * PX_PER_M * d / ext, lockBorder: opt.lockBorder } );

			}
			after += primitive.getIndices().getCount() / 3; perLook[ look ][ 1 ] += primitive.getIndices().getCount() / 3;
			const pack = P.getMax( [] )[ 2 ] < STAGE_Z ? 'stage' : 'house';
			group( pack ).addChild( doc.createNode( `${ node.getName() }#${ band }` ).setMesh( doc.createMesh().addPrimitive( primitive ) ) );

		}

	}
	node.getMesh().dispose(); node.dispose();

}
await doc.transform( prune( { keepLeaves: true, keepAttributes: true, propertyTypes: [ PropertyType.NODE, PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.ACCESSOR ] } ) );		// (the packs' textures wait unattached)
say( '  ' + Object.entries( perLook ).map( ( [ k, [ a, b ] ] ) => `${ k } ${ a } -> ${ b }` ).join( ', ' ) );
say( `bands of ${ BAND } m${ opt.simplify ? `, simplified to ${ opt.errorPx } px${ opt.lockBorder ? ' (borders locked)' : '' }` : '' }: ${ before } -> ${ after } triangles stored` );

// 5. packs: each its own textures, joined by material, quantised, compressed
const meta = { frame: 'metres, y up, x across (audience right +), z from the stage front edge to the back of the hall (stage z < 0), y 0 at the stalls floor',
	stageFloor: { front: 0.61, back: 1.68 }, cameraZone: CAMERA_ZONE,
	source: `${ path.basename( SRC ) }: geometry and baked textures; PBR maps derived (tools/hall-asset.mjs)`,
	options: { errorPx: opt.errorPx, texel: opt.texel, maxTexture: opt.maxTexture, houseTexture: opt.houseTexture, percentile: PERCENTILE, lockBorder: opt.lockBorder, simplify: opt.simplify, band: BAND } };
for ( const pack of [ 'stage', 'house' ] ) {

	for ( const [ m, t ] of packTex[ pack ] ) {		// this pack's textures on the (shared) materials, then cloned

		m.setBaseColorTexture( t.base ).setMetallicRoughnessTexture( t.orm ).setOcclusionTexture( t.orm ).setNormalTexture( t.normal ).setEmissiveTexture( t.emissive ?? null );

	}
	const d = cloneDocument( doc ), s = d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[ 0 ];
	for ( const n of s.listChildren() ) if ( n.getName() !== pack ) { n.traverse( c => c.getMesh()?.dispose() ); n.dispose(); }
	await d.transform( prune( { keepAttributes: true } ), join( { keepNamed: false } ), prune( { keepAttributes: true } ) );		// (prune drops UVs no texture uses: keep)
	d.getRoot().setExtras( { ...meta, pack } );
	await d.transform( reorder( { encoder: MeshoptEncoder } ), quantize( { quantizePosition: 16, quantizeNormal: 8, quantizeTexcoord: 14 } ) );
	d.createExtension( EXTMeshoptCompression ).setRequired( true ).setEncoderOptions( { method: EXTMeshoptCompression.EncoderMethod.FILTER } );
	const f = path.join( OUT, `${ pack }${ opt.simplify ? '' : '.full' }.glb` );
	await io.write( f, d );
	let draws = 0; s.traverse( x => { draws += x.getMesh()?.listPrimitives().length ?? 0; } );
	say( `${ path.relative( root, f ) }: ${ ( fs.statSync( f ).size / 1e6 ).toFixed( 2 ) } MB (textures ${ ( texBytes[ pack ] / 1e6 ).toFixed( 2 ) } MB, ~${ ( gpu[ pack ] / 1e6 ).toFixed( 0 ) } MB on the GPU), ${ tris( d ) } triangles in ${ d.getRoot().listMeshes().length } meshes, ${ draws } draw calls, ${ d.getRoot().listTextures().length } textures` );

}
say( `done in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );
fs.writeFileSync( path.join( OUT, opt.simplify ? 'build.log' : 'build.full.log' ), log.join( '\n' ) + '\n' );

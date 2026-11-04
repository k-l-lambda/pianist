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
//   - albedo: the texture with part of its broad baked lighting divided out (the luminance blurred
//     over LIGHT_SIGMA of the texture, relative to its islands' mean, to the power DELIGHT), then
//     nudged towards the look's luminance (LOOKS: after photographs of the Großer Saal);
//   - ORM: occlusion: the part of the baked darkening taken out of the albedo (AO); roughness the look's, less on fine bright detail; metalness: gold-coloured
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
// Near the camera (`--originals`: the source's textures at full size, 2-6.5k): the triangles
// within `--near` m of where the camera goes get their own material, whose albedo is a compact
// atlas of just their UV islands (TEXCOORD_1), cut from the originals at the density each needs
// (1 screen pixel a texel at its nearest; a big island in NEAR_TILE pieces), scaled down together to fit `--near-budget` megatexels,
// each at most its original's; an island that would gain less than NEAR_GAIN x the texture it has
// now stays as it was. A near material lives in the pack most of its near triangles are in. The
// busts beside the stage (NEAR_FIXED): out to 9 m, at a fixed density, outside the budget. Its ORM, normal and emissive stay the pack's (TEXCOORD_0: they are
// smooth); a base texture only near triangles used shrinks to what the far ones need.
// With `--generated` (the generated sources: tools/floor-detail.mjs, tools/floor-grille.mjs; needs
// --originals): the floor's vents as decal meshes (a quad each, mapped as its baked grille, in the
// pack most of them are in; their own colour and normal maps, alpha blended: extras.grille), and
// the stage floor's grain (its texture in the stage floor's materials' emissive slot, their
// emissive factor 0: extras.floorDetail; src/berlinhall.js multiplies the albedo by it).
// Output frame: metres, y up, x across (the audience's right +), z from the stage's front edge
// towards the back of the hall (the stage at z < 0), y 0 at the stalls floor (the stage's front
// at 0.61 m). The frame and the options are in each GLB's extras.
//
//   node tools/hall-asset.mjs --src <Berlin_Hall_textured_preview.glb> [--out public/berlinhall]
//        [--error-px 1] [--texel 2] [--max-texture 2048] [--house-texture 1024] [--lock-border] [--no-simplify]
//        [--originals <dir of the full-size textures>] [--near 4] [--near-budget 8]
//        [--generated <dir of the generated sources>] [--log <file>]
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
import { detailTexture, DETAIL_RAW } from './floor-detail.mjs';
import { GRILLES, grilleItems, grilleRaw, grilleTextures } from './floor-grille.mjs';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- options ----
const opt = { src: null, out: 'public/berlinhall', errorPx: 1, texel: 2, maxTexture: 2048, houseTexture: 1024, lockBorder: false, simplify: true, originals: null, near: 4, nearBudget: 8, generated: null, log: null };
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
	else if ( a === '--originals' ) opt.originals = path.resolve( v() );
	else if ( a === '--near' ) opt.near = Number( v() );
	else if ( a === '--near-budget' ) opt.nearBudget = Number( v() );
	else if ( a === '--generated' ) opt.generated = path.resolve( v() );
	else if ( a === '--log' ) opt.log = path.resolve( v() );
	else throw new Error( `unknown argument ${ a }` );

}
if ( opt.generated && ! opt.originals ) throw new Error( '--generated needs --originals (the grilles are found in them)' );
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
const DELIGHT = 0;				// how much of it (1: all; the rest stays: the hall's light and shade, as in its renders)
const AO = 1;					// the part of the darkening taken out kept as occlusion
const DETAIL_SIGMA = 1 / 400;		// of the width: the fine detail (normals, roughness)
const NEAR_GAIN = 1.3;			// a near island's density over the stage pack's own, at least
const NEAR_PAD = 4;				// atlas texels round each near island (filtering, mips)
const NEAR_TILE = 1 / 8;			// near islands cut at this grid in UV (each piece at its own nearest's density)
// faces: the busts beside the stage are looked at closer than their distance says (the eye goes to
// them, the view zooms): near islands out to `within` m, at a fixed density (texels per UV unit:
// as a texture of that size), outside the budget
const NEAR_FIXED = Object.fromEntries( [ 'wagner-buesten', 'brahms-buesten', 'haendel-buesten-low' ].map( n => [ n, { within: 9, density: 1024 } ] ) );
const NEAR_EDGE = 1.2;			// m: near triangles longer than this split (the stalls floor: a few big ones), red-green
const MATCH = 0.97;				// an original: its thumbnail's correlation with the source's texture

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
	// (part of the way only: the source's own tones are the hall's, the looks a nudge)
	const target = luma( ...linear( L.color ) ), gain = Math.min( 1.6, Math.max( 0.7, ( target / Math.max( 1e-4, aSum / Math.max( 1, cnt ) ) ) ** 0.35 ) );
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

/** The originals (`dir`) for the materials' baked textures (`mats`: material -> ...): material -> { file, w, h }. */
async function matchOriginals( dir, mats ) {

	const thumb = async input => {		// 48² grey, zero mean, unit length

		const { data } = await sharp( input ).removeAlpha().resize( 48, 48, { fit: 'fill' } ).greyscale().raw().toBuffer( { resolveWithObject: true } );
		const a = Float32Array.from( data ), m = a.reduce( ( s, v ) => s + v, 0 ) / a.length;
		let l = 0; for ( let i = 0; i < a.length; ++ i ) { a[ i ] -= m; l += a[ i ] * a[ i ]; }
		l = Math.sqrt( l ) || 1; for ( let i = 0; i < a.length; ++ i ) a[ i ] /= l;
		return a;

	};
	const files = fs.readdirSync( dir ).filter( f => /\.(jpe?g|png|webp)$/i.test( f ) );
	const cands = [];
	for ( const f of files ) cands.push( { file: path.join( dir, f ), t: await thumb( path.join( dir, f ) ), meta: await sharp( path.join( dir, f ) ).metadata() } );
	const out = new Map();
	for ( const m of mats.keys() ) {

		const tex = m.getBaseColorTexture();
		if ( ! tex ) continue;
		const t = await thumb( Buffer.from( tex.getImage() ) );
		let best = null, bc = - 2;
		for ( const c of cands ) { let d = 0; for ( let i = 0; i < t.length; ++ i ) d += t[ i ] * c.t[ i ]; if ( d > bc ) { bc = d; best = c; } }
		if ( bc >= MATCH ) out.set( m, { file: best.file, w: best.meta.width, h: best.meta.height } );

	}
	return out;

}

/**
 * The near islands of one material (`islands`: { u0, v0, u1, v1, dens }, dens in texels per UV
 * unit) packed on shelves into an atlas cut from its original (`o`: file, w, h): sets each
 * island's source rect (sx, sy, sw, sh: original pixels) and atlas rect (dx, dy, dw, dh); resolves
 * to the atlas (raw RGB, the original's colours: each texel the mean of its footprint) and its size.
 */
async function packNear( o, islands ) {

	for ( const s of islands ) {

		const k = o.w / s.dens;		// original pixels per atlas texel (>= 1)
		s.sx = Math.max( 0, Math.floor( s.u0 * o.w - NEAR_PAD * k ) ); s.sy = Math.max( 0, Math.floor( s.v0 * o.h - NEAR_PAD * k ) );
		s.sw = Math.max( 1, Math.min( o.w, Math.ceil( s.u1 * o.w + NEAR_PAD * k ) ) - s.sx ); s.sh = Math.max( 1, Math.min( o.h, Math.ceil( s.v1 * o.h + NEAR_PAD * k ) ) - s.sy );
		s.dw = Math.max( 2, Math.round( s.sw / k ) ); s.dh = Math.max( 2, Math.round( s.sh / k ) );

	}
	const area = islands.reduce( ( a, s ) => a + s.dw * s.dh, 0 );
	const W = Math.ceil( Math.max( Math.sqrt( area * 1.12 ), ...islands.map( s => s.dw ) ) / 4 ) * 4;
	let x = 0, y = 0, row = 0;
	for ( const s of [ ...islands ].sort( ( a, b ) => b.dh - a.dh ) ) {

		if ( x + s.dw > W ) { x = 0; y += row; row = 0; }
		s.dx = x; s.dy = y; x += s.dw; row = Math.max( row, s.dh );

	}
	const H = Math.ceil( ( y + row ) / 4 ) * 4;
	if ( W > 16383 || H > 16383 ) throw new Error( `near atlas ${ W }x${ H }: over WebP's 16383` );
	const src = await sharp( o.file ).removeAlpha().raw().toBuffer( { resolveWithObject: true } ), S = src.data, sw0 = src.info.width, sh0 = src.info.height;
	const out = Buffer.alloc( W * H * 3 );
	for ( const s of islands ) {

		const fx = s.sw / s.dw, fy = s.sh / s.dh;
		for ( let j = 0; j < s.dh; ++ j ) {

			const y0 = Math.floor( s.sy + j * fy ), y1 = Math.max( y0 + 1, Math.min( sh0, Math.ceil( s.sy + ( j + 1 ) * fy ) ) );
			for ( let i = 0; i < s.dw; ++ i ) {

				const x0 = Math.floor( s.sx + i * fx ), x1 = Math.max( x0 + 1, Math.min( sw0, Math.ceil( s.sx + ( i + 1 ) * fx ) ) );
				let r = 0, g = 0, b = 0, c = 0;
				for ( let yy = y0; yy < y1; ++ yy ) for ( let xx = x0; xx < x1; ++ xx ) { const q = 3 * ( yy * sw0 + xx ); r += S[ q ]; g += S[ q + 1 ]; b += S[ q + 2 ]; ++ c; }
				const d = 3 * ( ( s.dy + j ) * W + s.dx + i );
				out[ d ] = r / c; out[ d + 1 ] = g / c; out[ d + 2 ] = b / c;

			}

		}

	}
	return { data: out, w: W, h: H };

}

/** The albedo of source colours (raw sRGB, `n` texels), as derive() makes it (gain, gold leaf); needs DELIGHT 0. */
function albedoOf( data, n, look, gain ) {

	if ( DELIGHT !== 0 ) throw new Error( 'near atlases: made with DELIGHT 0 only (no baked light taken out of them)' );
	const L = LOOKS[ look ], rgb = Buffer.alloc( 3 * n );
	for ( let i = 0; i < n; ++ i ) {

		let r = TO_LINEAR[ data[ 3 * i ] ] * gain, g = TO_LINEAR[ data[ 3 * i + 1 ] ] * gain, b = TO_LINEAR[ data[ 3 * i + 2 ] ] * gain;
		const m = L.gold ? goldness( data[ 3 * i ], data[ 3 * i + 1 ], data[ 3 * i + 2 ] ) : 0;
		if ( m > 0 ) { const up = 1 + m * ( Math.max( 1, 0.55 / Math.max( 1e-3, luma( r, g, b ) ) ) - 1 ); r *= up; g *= up; b *= up; }
		rgb[ 3 * i ] = toSrgb( r ); rgb[ 3 * i + 1 ] = toSrgb( g ); rgb[ 3 * i + 2 ] = toSrgb( b );

	}
	return rgb;

}

/**
 * A new primitive of some triangles of `prim` (compact accessors), with TEXCOORD_1 from
 * `uv1( vertex, triangle )` if given; `split( triangle )`: a vertex is shared only among triangles
 * of the same value (the near islands: a vertex on a tile's edge, once per island).
 */
function subPrimitive( doc, prim, triangles, uv1, split = () => 0 ) {

	const I = prim.getIndices().getArray(), semantics = prim.listSemantics(), buffer = doc.getRoot().listBuffers()[ 0 ];
	const remap = new Map(), src = [], idx = new Uint32Array( triangles.length * 3 ), owner = [];
	triangles.forEach( ( t, j ) => { for ( let c = 0; c < 3; ++ c ) {

		const v = I[ 3 * t + c ], key = v * 65536 + split( t );
		if ( ! remap.has( key ) ) { remap.set( key, remap.size ); src.push( v ); owner.push( t ); }
		idx[ 3 * j + c ] = remap.get( key );

	} } );
	const p = doc.createPrimitive().setMaterial( prim.getMaterial() ).setIndices( doc.createAccessor().setType( 'SCALAR' ).setArray( idx ).setBuffer( buffer ) );
	for ( const sem of semantics ) {

		const a = prim.getAttribute( sem ), from = a.getArray(), e = a.getElementSize(), out = new Float32Array( remap.size * e );
		src.forEach( ( v, w ) => { for ( let c = 0; c < e; ++ c ) out[ e * w + c ] = from[ e * v + c ]; } );
		p.setAttribute( sem, doc.createAccessor().setType( a.getType() ).setArray( out ).setBuffer( buffer ) );

	}
	if ( uv1 ) {

		const out = new Float32Array( remap.size * 2 );
		src.forEach( ( v, w ) => { const q = uv1( v, owner[ w ] ); out[ 2 * w ] = q[ 0 ]; out[ 2 * w + 1 ] = q[ 1 ]; } );
		p.setAttribute( 'TEXCOORD_1', doc.createAccessor().setType( 'VEC2' ).setArray( out ).setBuffer( buffer ) );

	}
	return p;

}

/**
 * Split the triangles of `prim` that `red( t, P, I )` picks 1:4 (edge midpoints; attributes
 * interpolated), once; red-green: a neighbour with two split edges is split 1:4 too, one with
 * one split edge 1:2, so no edge has a T-junction (a neighbour across a UV seam: its own
 * midpoint, at the same place). Returns how many triangles were split 1:4.
 */
function refine( prim, red ) {

	const I = prim.getIndices().getArray(), P = prim.getAttribute( 'POSITION' ).getArray(), n = I.length / 3;
	const ek = ( a, b ) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
	const isRed = new Uint8Array( n ), marked = new Set();
	for ( let t = 0; t < n; ++ t ) if ( red( t, P, I ) ) { isRed[ t ] = 1; for ( let c = 0; c < 3; ++ c ) marked.add( ek( I[ 3 * t + c ], I[ 3 * t + ( c + 1 ) % 3 ] ) ); }
	for ( let changed = true; changed; ) {

		changed = false;
		for ( let t = 0; t < n; ++ t ) {

			if ( isRed[ t ] ) continue;
			let m = 0; for ( let c = 0; c < 3; ++ c ) m += marked.has( ek( I[ 3 * t + c ], I[ 3 * t + ( c + 1 ) % 3 ] ) );
			if ( m >= 2 ) { isRed[ t ] = 1; changed = true; for ( let c = 0; c < 3; ++ c ) marked.add( ek( I[ 3 * t + c ], I[ 3 * t + ( c + 1 ) % 3 ] ) ); }

		}

	}
	if ( ! marked.size ) return 0;
	const sems = prim.listSemantics(), A = sems.map( s => prim.getAttribute( s ) ), es = A.map( a => a.getElementSize() );
	const data = A.map( a => Array.from( a.getArray() ) );
	let count = A[ 0 ].getCount();
	const mids = new Map();
	const mid = ( a, b ) => {

		const key = ek( a, b );
		if ( mids.has( key ) ) return mids.get( key );
		A.forEach( ( _, j ) => { for ( let c = 0; c < es[ j ]; ++ c ) data[ j ].push( ( data[ j ][ es[ j ] * a + c ] + data[ j ][ es[ j ] * b + c ] ) / 2 ); } );
		mids.set( key, count );
		return count ++;

	};
	const out = [];
	let reds = 0;
	for ( let t = 0; t < n; ++ t ) {

		const v = [ I[ 3 * t ], I[ 3 * t + 1 ], I[ 3 * t + 2 ] ];
		if ( isRed[ t ] ) {

			const [ a, b, c ] = v, ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
			out.push( a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca ); ++ reds;
			continue;

		}
		const e = [ 0, 1, 2 ].findIndex( c => marked.has( ek( v[ c ], v[ ( c + 1 ) % 3 ] ) ) );
		if ( e < 0 ) { out.push( ...v ); continue; }
		const a = v[ e ], b = v[ ( e + 1 ) % 3 ], c = v[ ( e + 2 ) % 3 ], m = mid( a, b );		// green: 1:2 from the opposite vertex
		out.push( a, m, c, m, b, c );

	}
	A.forEach( ( a, j ) => a.setArray( new Float32Array( data[ j ] ) ) );
	prim.getIndices().setArray( new Uint32Array( out ) );
	return reds;

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
for ( const node of nodes ) for ( const p of node.getMesh().listPrimitives() ) weldPrimitive( p, {} );		// (once: steps 2 and 4 index the same triangles)
// (near atlases: the near triangles longer than NEAR_EDGE split until they are not, so a big
// island can be cut in tiles; those primitives are not simplified afterwards: the simplifier
// sees positions only, and on a flat floor it would join triangles of different UV mappings)
const refined = new Set();
if ( opt.originals ) {

	let before = 0, after = 0;
	const longNear = ( t, P, I ) => {

		const v = [ I[ 3 * t ], I[ 3 * t + 1 ], I[ 3 * t + 2 ] ], lo = [ 0, 1, 2 ].map( k => Math.min( ...v.map( i => P[ 3 * i + k ] ) ) ), hi = [ 0, 1, 2 ].map( k => Math.max( ...v.map( i => P[ 3 * i + k ] ) ) );
		if ( boxDistance( { min: lo, max: hi }, CAMERA_ZONE ) >= opt.near ) return false;
		let l = 0; for ( let c = 0; c < 3; ++ c ) { const a = v[ c ], b = v[ ( c + 1 ) % 3 ]; l = Math.max( l, Math.hypot( P[ 3 * a ] - P[ 3 * b ], P[ 3 * a + 1 ] - P[ 3 * b + 1 ], P[ 3 * a + 2 ] - P[ 3 * b + 2 ] ) ); }
		return l > NEAR_EDGE;

	};
	for ( const node of nodes ) for ( const p of node.getMesh().listPrimitives() ) {

		const n0 = p.getIndices().getCount() / 3;
		for ( let level = 0; level < 8 && refine( p, longNear ); ++ level ) refined.add( p );
		if ( refined.has( p ) ) { before += n0; after += p.getIndices().getCount() / 3; }

	}
	say( `near triangles longer than ${ NEAR_EDGE } m: split in ${ refined.size } parts, ${ before } -> ${ after } triangles` );

}

// 2. per material: its look, its triangles' UVs (for the islands); per triangle the texel
// density it needs (screen pixels per texel at --texel, at its distance), its pack, and whether
// it is near the camera
const mats = new Map();		// source material -> { look, uv: [], prims: [], islands: [] }
const tri = new Map();		// primitive -> { texels, uvArea, pack (0 stage, 1 house), island (-1: none), dist }
const unknown = new Set();
for ( const node of nodes ) for ( const p of node.getMesh().listPrimitives() ) {

	const m = p.getMaterial();
	if ( ! mats.has( m ) ) {

		let look = LOOK_OF[ m.getName() ];
		if ( ! look ) { unknown.add( m.getName() ); look = 'ivory'; }
		mats.set( m, { look, uv: [], prims: [], islands: [] } );

	}
	const e = mats.get( m ), P = p.getAttribute( 'POSITION' ).getArray(), U = p.getAttribute( 'TEXCOORD_0' ).getArray(), I = p.getIndices().getArray();
	const n = I.length / 3, T = { texels: new Float32Array( n ), uvArea: new Float32Array( n ), pack: new Uint8Array( n ), island: new Int32Array( n ).fill( - 1 ), dist: new Float32Array( n ) };
	tri.set( p, T ); e.prims.push( p );
	for ( let t = 0; t < n; ++ t ) {

		const [ a, b, c ] = [ I[ 3 * t ], I[ 3 * t + 1 ], I[ 3 * t + 2 ] ];
		e.uv.push( U[ 2 * a ], U[ 2 * a + 1 ], U[ 2 * b ], U[ 2 * b + 1 ], U[ 2 * c ], U[ 2 * c + 1 ] );
		const zs = [ a, b, c ].map( k => P[ 3 * k + 2 ] ), lo = [ 0, 1, 2 ].map( k => Math.min( P[ 3 * a + k ], P[ 3 * b + k ], P[ 3 * c + k ] ) ), hi = [ 0, 1, 2 ].map( k => Math.max( P[ 3 * a + k ], P[ 3 * b + k ], P[ 3 * c + k ] ) );
		// a triangle's pack: as its band's (the band's max z, below: about it)
		T.pack[ t ] = Math.max( ...zs ) < STAGE_Z ? 0 : 1;
		T.dist[ t ] = boxDistance( { min: lo, max: hi }, CAMERA_ZONE );
		const u = [ 0, 1, 2 ].map( k => P[ 3 * b + k ] - P[ 3 * a + k ] ), v = [ 0, 1, 2 ].map( k => P[ 3 * c + k ] - P[ 3 * a + k ] );
		const area = Math.hypot( u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ) / 2;
		const uvArea = Math.abs( ( U[ 2 * b ] - U[ 2 * a ] ) * ( U[ 2 * c + 1 ] - U[ 2 * a + 1 ] ) - ( U[ 2 * c ] - U[ 2 * a ] ) * ( U[ 2 * b + 1 ] - U[ 2 * a + 1 ] ) ) / 2;
		if ( area < 1e-8 || uvArea < 1e-10 ) continue;
		T.texels[ t ] = Math.sqrt( area / uvArea ) / ( PX_PER_M * Math.max( 1.5, T.dist[ t ] ) );		// texels a UV unit needs, at 1 px a texel
		T.uvArea[ t ] = uvArea;

	}

}
if ( unknown.size ) say( `  no look for ${ [ ...unknown ].join( ', ' ) }: ivory` );
/** [ texels at --texel, weight ] of a material's triangles in `pack`; `which`: 'all', 'far' (not in a near island). */
const needOf = ( e, pack, which ) => {

	const out = [];
	for ( const p of e.prims ) {

		const T = tri.get( p );
		for ( let t = 0; t < T.pack.length; ++ t ) {

			if ( ! T.uvArea[ t ] ) continue;
			const near = T.island[ t ] >= 0;
			if ( which === 'far' && near ) continue;
			if ( ( near ? e.nearPack : T.pack[ t ] ) !== pack ) continue;		// near triangles: their near material's pack
			out.push( [ T.texels[ t ] / opt.texel, T.uvArea[ t ] ] );

		}

	}
	return out;

};
const sizeFor = ( need, full, cap ) => {		// the PERCENTILE by UV area, a power of two

	if ( ! need.length ) return 0;
	need.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
	const total = need.reduce( ( s, x ) => s + x[ 1 ], 0 );
	let acc = 0, v = need[ need.length - 1 ][ 0 ];
	for ( const [ t, w ] of need ) { acc += w; if ( acc >= PERCENTILE * total ) { v = t; break; } }
	const p2 = 2 ** Math.round( Math.log2( Math.max( 1, v ) ) );
	return Math.min( full, cap, Math.max( MIN_TEXTURE, p2 ) );

};

// 2b. near islands: per material with an original, the near triangles' UV islands (connected
// through shared vertices; repeats of one island, as the chairs', counted once), each at the
// density its nearest triangle needs (at most the original's), all scaled to --near-budget
let nearTexels = 0;
const originals = opt.originals ? await matchOriginals( opt.originals, mats ) : new Map();
if ( opt.originals ) say( `originals: ${ originals.size } of ${ [ ...mats.keys() ].filter( m => m.getBaseColorTexture() ).length } textures matched in ${ path.basename( opt.originals ) }` );
for ( const [ m, e ] of mats ) {

	const o = originals.get( m );
	if ( ! o ) continue;
	e.original = o;
	e.base = ( await sharp( Buffer.from( m.getBaseColorTexture().getImage() ) ).metadata() ).width;
	const fixed = NEAR_FIXED[ m.getName() ], within = fixed?.within ?? opt.near;
	const byKey = new Map();
	for ( const p of e.prims ) {

		const T = tri.get( p ), I = p.getIndices().getArray(), U = p.getAttribute( 'TEXCOORD_0' ).getArray();
		const parent = new Int32Array( p.getAttribute( 'POSITION' ).getCount() ).map( ( _, i ) => i );
		const find = x => { while ( parent[ x ] !== x ) x = parent[ x ] = parent[ parent[ x ] ]; return x; };
		const near = [];
		for ( let t = 0; t < T.pack.length; ++ t ) if ( T.dist[ t ] < within && T.uvArea[ t ] ) {

			near.push( t );
			const a = find( I[ 3 * t ] ), b = find( I[ 3 * t + 1 ] ), c = find( I[ 3 * t + 2 ] );
			parent[ b ] = a; parent[ find( c ) ] = a;

		}
		const groups = new Map();		// (root, UV tile of its centre) -> triangles: a big island (the stalls floor) in pieces
		for ( const t of near ) {

			const [ a, b, c ] = [ I[ 3 * t ], I[ 3 * t + 1 ], I[ 3 * t + 2 ] ];
			const tu = Math.floor( ( U[ 2 * a ] + U[ 2 * b ] + U[ 2 * c ] ) / 3 / NEAR_TILE ), tv = Math.floor( ( U[ 2 * a + 1 ] + U[ 2 * b + 1 ] + U[ 2 * c + 1 ] ) / 3 / NEAR_TILE );
			const k = `${ find( a ) }/${ tu },${ tv }`;
			if ( ! groups.has( k ) ) groups.set( k, [] );
			groups.get( k ).push( t );

		}
		for ( const ts of groups.values() ) {

			let u0 = 1, v0 = 1, u1 = 0, v1 = 0, dens = 0;
			for ( const t of ts ) {

				for ( let c = 0; c < 3; ++ c ) { const v = I[ 3 * t + c ], uu = Math.min( 1, Math.max( 0, U[ 2 * v ] ) ), vv = Math.min( 1, Math.max( 0, U[ 2 * v + 1 ] ) ); u0 = Math.min( u0, uu ); v0 = Math.min( v0, vv ); u1 = Math.max( u1, uu ); v1 = Math.max( v1, vv ); }
				dens = Math.max( dens, T.texels[ t ] );

			}
			const key = [ u0, v0, u1, v1 ].map( x => Math.round( x * 8192 ) ).join( ',' ) + '/' + ts.length;
			let s = byKey.get( key );
			if ( ! s ) { s = { u0, v0, u1, v1, ideal: dens, cap: o.w, fixed: fixed ? Math.min( fixed.density, o.w ) : 0, tris: [] }; byKey.set( key, s ); e.islands.push( s ); }
			s.ideal = Math.max( s.ideal, dens );
			s.tris.push( [ p, ts ] );

		}

	}
	// its near material's pack: where most of its near triangles are (the atlas, and ORM and
	// normal maps it shares with the far triangles: not both packs')
	let inStage = 0, all = 0;
	for ( const s of e.islands ) for ( const [ p, ts ] of s.tris ) for ( const t of ts ) { ++ all; inStage += tri.get( p ).pack[ t ] === 0; }
	e.nearPack = inStage * 2 >= all ? 0 : 1;

}
// the budget: one scale on what each island needs, each at most its original's density (so one
// at its cap keeps it while the rest share the budget); an island gaining too little over the
// texture it has now stays as it was, and the rest share the budget again
for ( const e of mats.values() ) for ( const s of e.islands ) if ( s.fixed ) s.dens = s.fixed;		// (the faces: as they are)
const texelsAt = ( list, k ) => list.reduce( ( a, s ) => a + ( s.u1 - s.u0 ) * ( s.v1 - s.v0 ) * Math.min( s.ideal * k, s.cap ) ** 2, 0 );
for ( let pass = 0; pass < 4; ++ pass ) {

	const list = [ ...mats.values() ].flatMap( e => e.islands ).filter( s => ! s.fixed );
	if ( ! list.length ) break;
	let lo = 0, hi = 1;
	if ( texelsAt( list, hi ) > opt.nearBudget * 1e6 ) for ( let i = 0; i < 40; ++ i ) { const k = ( lo + hi ) / 2; if ( texelsAt( list, k ) > opt.nearBudget * 1e6 ) hi = k; else lo = k; }
	for ( const e of mats.values() ) {

		if ( ! e.islands.length ) continue;
		const ref = sizeFor( needOf( e, e.nearPack, 'all' ), e.base, e.nearPack ? opt.houseTexture : opt.maxTexture ) || e.base;		// (no near islands yet: all its triangles)
		e.islands = e.islands.filter( s => { if ( s.fixed ) return true; s.dens = Math.min( s.ideal * hi, s.cap ); return s.dens >= NEAR_GAIN * ref; } );

	}

}
for ( const e of mats.values() ) e.islands.forEach( ( s, k ) => { for ( const [ p, ts ] of s.tris ) for ( const t of ts ) tri.get( p ).island[ t ] = k; } );

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

		// (the base colour for the far triangles only, where near ones have their atlas; the
		// ORM and normal maps for all)
		const pk = pack === 'stage' ? 0 : 1, cap = pack === 'stage' ? opt.maxTexture : opt.houseTexture;
		const s = sizeFor( needOf( e, pk, 'all' ), D.w, cap );
		if ( ! s ) continue;
		const sb = e.islands.length ? sizeFor( needOf( e, pk, 'far' ), D.w, cap ) : s;
		sizes[ pack ] = sb === s ? `${ s }` : `${ sb || '-' }/${ s }`;
		const half = Math.max( MIN_TEXTURE, s / 2 );
		const img = async ( buf, size, q, name ) => {

			const b = await encode( buf, D.w, D.h, size, q );
			texBytes[ pack ] += b.length; gpu[ pack ] += size * size * 4 * 4 / 3;
			return doc.createTexture( `${ m.getName() }-${ name }-${ pack }` ).setImage( b ).setMimeType( 'image/webp' );

		};
		const t = { base: sb ? await img( D.rgb, sb, 85, 'base' ) : null, orm: await img( D.orm, half, 90, 'orm' ), normal: await img( D.nor, half, 92, 'normal' ) };
		if ( emissive ) {

			const { data, info } = await sharp( emissive.getImage() ).removeAlpha().raw().toBuffer( { resolveWithObject: true } );
			const b = await sharp( data, { raw: { width: info.width, height: info.height, channels: 3 } } ).resize( half, half ).webp( { quality: 85 } ).toBuffer();
			texBytes[ pack ] += b.length; gpu[ pack ] += half * half * 4 * 4 / 3;
			t.emissive = doc.createTexture( `${ m.getName() }-emissive-${ pack }` ).setImage( b ).setMimeType( 'image/webp' );

		}
		packTex[ pack ].set( m, t );

	}
	// its near atlas (the stage pack's): the near islands from the original, the same albedo
	let nearNote = '';
	if ( e.islands.length ) {

		const A = await packNear( e.original, e.islands );
		const b = await sharp( albedoOf( A.data, A.w * A.h, e.look, D.stats.gain ), { raw: { width: A.w, height: A.h, channels: 3 } } ).webp( { quality: 85, effort: 5 } ).toBuffer();
		const np = e.nearPack ? 'house' : 'stage';
		texBytes[ np ] += b.length; gpu[ np ] += A.w * A.h * 4 * 4 / 3; nearTexels += A.w * A.h;
		e.nearTexture = doc.createTexture( `${ m.getName() }-near` ).setImage( b ).setMimeType( 'image/webp' );
		e.nearSize = [ A.w, A.h ];
		const d = e.islands.map( s => s.dens ).sort( ( x, y ) => x - y );
		nearNote = `; near (${ np }) ${ A.w }x${ A.h }: ${ e.islands.length } islands at ${ Math.round( d[ 0 ] ) }-${ Math.round( d[ d.length - 1 ] ) } texels/UV (original ${ e.original.w }), ${ ( b.length / 1e6 ).toFixed( 2 ) } MB`;

	}
	texLog.push( `${ m.getName() } (${ e.look }): stage ${ sizes.stage ?? '-' }, house ${ sizes.house ?? '-' }; gain ${ D.stats.gain.toFixed( 2 ) }, gold ${ ( 100 * D.stats.gold ).toFixed( 0 ) } %, islands ${ ( 100 * D.stats.coverage ).toFixed( 0 ) } %${ nearNote }` );
	// the material's own settings (the textures are set per pack below)
	m.setBaseColorFactor( [ 1, 1, 1, 1 ] ).setRoughnessFactor( 1 ).setMetallicFactor( 1 ).setDoubleSided( true ).setAlphaMode( 'OPAQUE' );
	m.setExtras( { look: e.look, lamp: !! emissive } );
	if ( L.sheen ) m.setExtension( 'KHR_materials_sheen', sheenExt.createSheen().setSheenColorFactor( linear( L.sheen ) ).setSheenRoughnessFactor( 0.5 ) );
	m.setBaseColorTexture( null ).setEmissiveTexture( null ).setMetallicRoughnessTexture( null ).setOcclusionTexture( null ).setNormalTexture( null );
	if ( ! emissive ) m.setEmissiveFactor( [ 0, 0, 0 ] );
	if ( e.nearTexture ) e.nearMaterial = m.clone().setName( `${ m.getName() }-near` ).setExtras( { look: e.look, lamp: !! emissive, near: true } );
	used.add( tex ); if ( emissive ) used.add( emissive );
	console.log( '  ' + texLog[ texLog.length - 1 ] );

}
log.push( ...texLog.map( s => '  ' + s ) );
for ( const t of used ) t.dispose();
if ( opt.originals ) say( `near atlases (within ${ opt.near } m, ${ opt.nearBudget } Mtexel budget): ${ ( nearTexels / 1e6 ).toFixed( 2 ) } Mtexels, ${ [ ...mats.values() ].filter( e => e.nearTexture ).length } materials` );

// 4. bands, simplified by distance (UVs kept: a seam is a border the simplifier keeps); grouped by pack
const groups = {};
const group = name => groups[ name ] ??= ( () => { const g = doc.createNode( name ); scene.addChild( g ); return g; } )();
let before = 0, after = 0; const perLook = {};
for ( const node of scene.listChildren().filter( n => n.getMesh() ) ) {

	for ( const prim of node.getMesh().listPrimitives() ) {

		before += prim.getIndices().getCount() / 3;
		const e = mats.get( prim.getMaterial() ), look = e.look; perLook[ look ] ??= [ 0, 0 ]; perLook[ look ][ 0 ] += prim.getIndices().getCount() / 3;
		// the near triangles: their own primitive, the near material, TEXCOORD_1 into its atlas;
		// in its pack, not simplified (they are close)
		const T = tri.get( prim );
		let far = prim;
		if ( e.nearTexture && T.island.some( k => k >= 0 ) ) {

			const nearTris = [], farTris = [];
			for ( let t = 0; t < T.island.length; ++ t ) ( T.island[ t ] >= 0 ? nearTris : farTris ).push( t );
			const U = prim.getAttribute( 'TEXCOORD_0' ).getArray(), [ W, H ] = e.nearSize, ow = e.original.w, oh = e.original.h;
			const np = subPrimitive( doc, prim, nearTris, ( v, t ) => {

				const s = e.islands[ T.island[ t ] ];
				return [ ( s.dx + ( U[ 2 * v ] * ow - s.sx ) * s.dw / s.sw ) / W, ( s.dy + ( U[ 2 * v + 1 ] * oh - s.sy ) * s.dh / s.sh ) / H ];

			}, t => T.island[ t ] ).setMaterial( e.nearMaterial );
			after += nearTris.length; perLook[ look ][ 1 ] += nearTris.length;
			group( e.nearPack ? 'house' : 'stage' ).addChild( doc.createNode( `${ node.getName() }#near` ).setMesh( doc.createMesh().addPrimitive( np ) ) );
			far = farTris.length ? subPrimitive( doc, prim, farTris ) : null;

		}
		if ( ! far ) continue;
		for ( const { band, primitive } of splitByZ( doc, far ) ) {

			const P = primitive.getAttribute( 'POSITION' ), lo = P.getMin( [] ), hi = P.getMax( [] );
			if ( opt.simplify && ! refined.has( prim ) ) {

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

// 4b. the generated parts: the vents' decals, the stage floor's grain
const grains = [];		// the stage floor's materials (the grain on them in step 5)
if ( opt.generated ) {

	const buffer = doc.getRoot().listBuffers()[ 0 ], src = await new NodeIO().registerExtensions( [ EXTTextureWebP ] ).read( SRC );
	for ( const kind of Object.keys( GRILLES ) ) {

		const raw = path.join( opt.generated, grilleRaw( kind ) );
		if ( ! fs.existsSync( raw ) ) { say( `  no ${ grilleRaw( kind ) }: no ${ kind } grilles` ); continue; }
		const [ T, { items, note } ] = [ await grilleTextures( opt.originals, kind, fs.readFileSync( raw ) ), await grilleItems( opt.originals, kind, src ) ];
		// a quad each: centre c, the decal's +u and +v half-axes a, b (a little larger: PAD), lifted
		const PAD = 1.05, LIFT = 0.0015, n = items.length;
		const pos = new Float32Array( 12 * n ), nor = new Float32Array( 12 * n ), uv = new Float32Array( 8 * n ), idx = new Uint32Array( 6 * n );
		items.forEach( ( [ x, y, z, ax, az, bx, bz ], i ) => {

			[ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ].forEach( ( [ su, sv ], k ) => {

				const fu = ( 2 * su - 1 ) * PAD, fv = ( 2 * sv - 1 ) * PAD, o = 3 * ( 4 * i + k );
				pos[ o ] = x + fu * ax + fv * bx; pos[ o + 1 ] = y + LIFT; pos[ o + 2 ] = z + fu * az + fv * bz;
				nor[ o + 1 ] = 1; uv[ 2 * ( 4 * i + k ) ] = su; uv[ 2 * ( 4 * i + k ) + 1 ] = sv;

			} );
			// corners c - a - b, c + a - b, c + a + b, c - a + b: (q, q+1, q+2)'s normal is along a x b;
			// up where (a x b)·y > 0 (counter-clockwise from above), else the other way round
			const up = az * bx - ax * bz > 0, q = 4 * i;
			idx.set( up ? [ q, q + 1, q + 2, q, q + 2, q + 3 ] : [ q, q + 2, q + 1, q, q + 3, q + 2 ], 6 * i );

		} );
		const g = GRILLES[ kind ];
		const mat = doc.createMaterial( `grille-${ kind }` ).setBaseColorFactor( [ 1, 1, 1, 1 ] ).setRoughnessFactor( 0.45 ).setMetallicFactor( g.metalness ?? 0.3 ).setAlphaMode( 'BLEND' )
			.setBaseColorTexture( doc.createTexture( `grille-${ kind }` ).setImage( T.color ).setMimeType( 'image/webp' ) )
			.setNormalTexture( doc.createTexture( `grille-${ kind }-normal` ).setImage( T.normal ).setMimeType( 'image/webp' ) )
			.setExtras( { look: 'grille', grille: kind } );
		const prim = doc.createPrimitive().setMaterial( mat ).setIndices( doc.createAccessor().setType( 'SCALAR' ).setArray( idx ).setBuffer( buffer ) )
			.setAttribute( 'POSITION', doc.createAccessor().setType( 'VEC3' ).setArray( pos ).setBuffer( buffer ) )
			.setAttribute( 'NORMAL', doc.createAccessor().setType( 'VEC3' ).setArray( nor ).setBuffer( buffer ) )
			.setAttribute( 'TEXCOORD_0', doc.createAccessor().setType( 'VEC2' ).setArray( uv ).setBuffer( buffer ) );
		const pack = items.filter( i => i[ 2 ] < STAGE_Z ).length * 2 >= n ? 'stage' : 'house';
		group( pack ).addChild( doc.createNode( `grilles-${ kind }` ).setMesh( doc.createMesh( `grilles-${ kind }` ).addPrimitive( prim ) ) );
		texBytes[ pack ] += T.color.length + T.normal.length; gpu[ pack ] += 2 * 1024 * 1024 * 4 * 4 / 3;
		say( `  grilles ${ kind }: ${ n } decals (${ note }) in the ${ pack } pack; ${ T.note }; ${ ( ( T.color.length + T.normal.length ) / 1024 ).toFixed( 0 ) } KB` );

	}
	const raw = path.join( opt.generated, DETAIL_RAW );
	if ( fs.existsSync( raw ) ) {

		const D = await detailTexture( fs.readFileSync( raw ) ), tex = doc.createTexture( 'floor-detail' ).setImage( D.webp ).setMimeType( 'image/webp' );
		for ( const [ m, e ] of mats ) if ( e.look === 'stageFloor' ) { grains.push( m ); if ( e.nearMaterial ) grains.push( e.nearMaterial ); }
		for ( const m of grains ) m.setExtras( { ...m.getExtras(), floorDetail: true } );
		grains.tex = tex;
		say( `  floor grain: ${ ( D.webp.length / 1024 ).toFixed( 0 ) } KB on ${ grains.map( m => m.getName() ).join( ', ' ) }` );

	} else say( `  no ${ DETAIL_RAW }: no floor grain` );

}

// 5. packs: each its own textures, joined by material, quantised, compressed
const meta = { frame: 'metres, y up, x across (audience right +), z from the stage front edge to the back of the hall (stage z < 0), y 0 at the stalls floor',
	stageFloor: { front: 0.61, back: 1.68 }, cameraZone: CAMERA_ZONE,
	source: `${ path.basename( SRC ) }: geometry and baked textures; PBR maps derived (tools/hall-asset.mjs)${ opt.generated ? '; floor grilles and grain from generated sources (tools/floor-grille.mjs, tools/floor-detail.mjs)' : '' }`,
	options: { errorPx: opt.errorPx, texel: opt.texel, maxTexture: opt.maxTexture, houseTexture: opt.houseTexture, percentile: PERCENTILE, near: opt.originals ? { within: opt.near, budget: opt.nearBudget, gain: NEAR_GAIN } : null, lockBorder: opt.lockBorder, simplify: opt.simplify, band: BAND } };
for ( const pack of [ 'stage', 'house' ] ) {

	for ( const [ m, t ] of packTex[ pack ] ) {		// this pack's textures on the (shared) materials, then cloned

		m.setBaseColorTexture( t.base ).setMetallicRoughnessTexture( t.orm ).setOcclusionTexture( t.orm ).setNormalTexture( t.normal ).setEmissiveTexture( t.emissive ?? null );
		const e = mats.get( m );
		if ( e?.nearMaterial && pack === ( e.nearPack ? 'house' : 'stage' ) ) {		// its atlas on TEXCOORD_1, the rest its pack's

			e.nearMaterial.setBaseColorTexture( e.nearTexture ).setMetallicRoughnessTexture( t.orm ).setOcclusionTexture( t.orm ).setNormalTexture( t.normal ).setEmissiveTexture( t.emissive ?? null );
			e.nearMaterial.getBaseColorTextureInfo().setTexCoord( 1 );

		}

	}
	// the stage floor's grain: in its materials' emissive slot (their emissive black: it only rides)
	for ( const m of grains ) m.setEmissiveTexture( grains.tex ).setEmissiveFactor( [ 0, 0, 0 ] );
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
if ( opt.log ) fs.writeFileSync( opt.log, log.join( '\n' ) + '\n' );		// (not in OUT: that is served)

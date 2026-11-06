// Luminara's pack (public/luminara/luminara.glb) from its generated sources (tools/luminara-gen.mjs,
// kept outside the repo):
//   furniture (tools/luminara-3d.py's TRELLIS meshes, <slug>-trellis.glb: vertex colour): welded,
//     simplified (meshopt) to about TRIS[ slug ] triangles, sized (SIZE: its height or length, m),
//     its base at y 0 and centred, its front +z (TRELLIS's, from the photo's three-quarter view);
//     split by the vertex colour into its materials (CLASSES: brass by its hue, etc.; the colour
//     kept per vertex where the material uses it)
//   wall reliefs (MoGe-2: tools/bust-depth.py, bust-relief.py's relief/<slug>.json, -normal.png):
//     at RELIEF[ slug ] m high, the photo as albedo (levelled), the object-space normal map, and
//     its raised pattern's glow (tools/relief-glow.py's -glow.png) as its emissive map
//   textures, each on a swatch (a small quad, not drawn: src/luminara.js takes its material's map):
//     the skies outside (sky-day, -sunset, -dusk, -night: wrapped round), the floor's marble (made to tile)
// Each a node named by its slug at the origin; src/luminara.js places copies of them.
//
//   node tools/luminara-asset.mjs --generated <dir> [--out public/luminara/luminara.glb]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMaterialsSheen, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, quantize, reorder, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const TRIS = { 'carousel-horse': 6000, 'sofa-low': 26000, 'tub-chair': 20000, 'sofa-body': 36000, 'chair-body': 30000, 'pillow-blue': 5000, 'pillow-cream': 5000, 'pillow-lumbar': 5000, 'side-table': 9000, 'plant': 12000, 'sideboard': 6000, 'table-lamp': 6000, 'roses': 16000,
	'gold-disc': 4000, 'clef-statue': 6000, 'gold-ribbon': 6000, 'books': 8000, 'crystal': 4000,
	// the close-ups' ornaments, a cabinet, the banquette, a planter
	'pothos': 9000, 'armillary': 6000, 'figurine': 6000, 'crystal-gem': 3000, 'gramophone': 6000, 'hourglass': 4000, 'white-flowers': 9000, 'cloche': 4000,
	'astronaut': 6000, 'crystal-note': 3000, 'loop-sculpture': 4000, 'headphones': 5000, 'diffuser': 4000, 'metronome': 4000, 'whale-tail': 4000, 'radio': 5000,
	'coral-tree': 7000, 'mushroom-lamp': 4000, 'crystal-ball': 5000, 'small-cabinet': 4000, 'lily-planter': 10000,
	// more ornaments (each once), the bench's cushions
	'books-grey': 6000, 'books-gold': 6000, 'books-flat': 3000, 'perfume': 4000, 'shell': 5000, 'gold-star': 4000, 'brass-globe': 6000, 'jewelry-box': 4000,
	'clock': 4000, 'ceramic-vase': 3000, 'candles': 4000, 'olive-vase': 7000, 'cushion-square': 6000, 'cushion-lumbar': 6000, 'cushion-velvet': 6000 };		// (the banquette: built in its place, src/luminara.js BENCH)
// [ the axis sized ('y': height, 'x': length), m ]
const SIZE = { 'carousel-horse': [ 'y', 0.1 ], 'sofa-low': [ 'x', 2.3 ],		// (the horse: src/luminara.js carouselBox sizes it again, 0.078 m)
	 'tub-chair': [ 'x', 0.95 ],
	'sofa-body': [ 'x', 1.8 ], 'chair-body': [ 'x', 0.86 ],		// (the sofa 1.8: its seat at 0.50, near the chair's 0.43; at 2.0 it was 0.55)
	 'pillow-blue': [ 'x', 0.45 ], 'pillow-cream': [ 'x', 0.45 ], 'pillow-lumbar': [ 'x', 0.5 ],		// (the same, pillow-free; its pillows apart)
	 'side-table': [ 'y', 1.05 ], 'plant': [ 'y', 1.6 ], 'sideboard': [ 'x', 1.7 ], 'table-lamp': [ 'y', 0.62 ],
	'roses': [ 'y', 0.32 ], 'gold-disc': [ 'y', 0.36 ], 'clef-statue': [ 'y', 0.34 ], 'gold-ribbon': [ 'y', 0.3 ], 'books': [ 'x', 0.42 ], 'crystal': [ 'y', 0.22 ],
	'pothos': [ 'x', 0.34 ], 'armillary': [ 'y', 0.32 ], 'figurine': [ 'y', 0.24 ], 'crystal-gem': [ 'y', 0.2 ], 'gramophone': [ 'y', 0.42 ], 'hourglass': [ 'y', 0.28 ],
	'white-flowers': [ 'y', 0.34 ], 'cloche': [ 'y', 0.3 ], 'astronaut': [ 'y', 0.26 ], 'crystal-note': [ 'y', 0.24 ], 'loop-sculpture': [ 'y', 0.28 ], 'headphones': [ 'y', 0.3 ],
	'diffuser': [ 'y', 0.26 ], 'metronome': [ 'y', 0.24 ], 'whale-tail': [ 'y', 0.26 ], 'radio': [ 'x', 0.34 ], 'coral-tree': [ 'x', 0.38 ], 'mushroom-lamp': [ 'y', 0.32 ],
	'crystal-ball': [ 'y', 0.26 ], 'small-cabinet': [ 'y', 1.0 ], 'banquette': [ 'x', 1.3 ], 'lily-planter': [ 'y', 1.05 ],
	'books-grey': [ 'x', 0.4 ], 'books-gold': [ 'x', 0.32 ], 'books-flat': [ 'x', 0.34 ], 'perfume': [ 'y', 0.18 ], 'shell': [ 'y', 0.24 ], 'gold-star': [ 'y', 0.3 ],
	'brass-globe': [ 'y', 0.3 ], 'jewelry-box': [ 'x', 0.24 ], 'clock': [ 'y', 0.2 ], 'ceramic-vase': [ 'y', 0.4 ], 'candles': [ 'x', 0.36 ], 'olive-vase': [ 'x', 0.42 ],
	'cushion-square': [ 'x', 0.46 ], 'cushion-lumbar': [ 'x', 0.56 ], 'cushion-velvet': [ 'x', 0.44 ] };
const RELIEF = { curtain: 2.9 };		// (the curtain of light's pleated curtain; the clef is a light, src/luminara.js; the shelves hold real ornaments)

// materials (glTF PBR; extras.look: src/luminara.js's finish) and which vertices take each:
// `test( r, g, b )` (0..1), first match; `vertexColor`: keep the decoder's colour
const MAT = {
	brass: { color: [ 0.83, 0.62, 0.32 ], metallic: 1, roughness: 0.28, look: 'brass' },
	brassPolished: { color: [ 0.88, 0.66, 0.36 ], metallic: 1, roughness: 0.1, look: 'brassPolished' },
	lacquer: { color: [ 0.93, 0.92, 0.9 ], roughness: 0.18, look: 'lacquer' },
	boucle: { color: [ 0.9, 0.87, 0.81 ], roughness: 0.95, look: 'boucle' },
	marble: { color: [ 0.92, 0.91, 0.9 ], roughness: 0.12, look: 'marble' },
	ceramic: { color: [ 0.92, 0.91, 0.88 ], roughness: 0.6, look: 'ceramic' },
	foliage: { color: [ 1, 1, 1 ], roughness: 0.7, look: 'foliage', vertexColor: true },
	natural: { color: [ 1, 1, 1 ], roughness: 0.8, look: 'natural', vertexColor: true },		// (pampas, the trunk, roses)
	books: { color: [ 1, 1, 1 ], roughness: 0.6, look: 'books', vertexColor: true },
	fabric: { color: [ 1, 1, 1 ], roughness: 0.92, look: 'fabric', vertexColor: true },		// (cushions: their own beige)
	stone: { color: [ 0.03, 0.03, 0.035 ], roughness: 0.15, look: 'stone' },		// (black marble)
	shade: { color: [ 0.95, 0.92, 0.86 ], roughness: 0.9, look: 'shade' },		// (a lamp's shade, lit through)
	crystal: { color: [ 0.93, 0.95, 0.97 ], roughness: 0.04, look: 'crystal' },
	glass: { color: [ 0.95, 0.97, 0.98 ], roughness: 0.03, look: 'glass' },		// (clear: src/luminara.js makes it see-through)
	silver: { color: [ 0.85, 0.86, 0.88 ], metallic: 1, roughness: 0.2, look: 'silver' },
	// the sofa group's set (its sheets: Footages.local/Luminara/e3600454-..., ce870b1c-..., d048f4be-...): a smooth ivory
	// leather shell, beige boucle cushions, dusty blue velvet pillows, a champagne-gold inlay and floor ring, a satin
	// champagne pedestal
	leatherShell: { color: [ 0.93, 0.9, 0.85 ], roughness: 0.4, look: 'leatherShell' },
	boucleFabric: { color: [ 1, 1, 1 ], roughness: 0.95, look: 'boucleFabric', vertexColor: true },		// (its shading in the decoder's colour, normalised)
	velvetBlue: { color: [ 0.47, 0.55, 0.64 ], roughness: 0.8, look: 'velvetBlue' },
	goldInlay: { color: [ 0.9, 0.76, 0.5 ], metallic: 1, roughness: 0.12, look: 'goldInlay' },
	champagne: { color: [ 0.62, 0.5, 0.38 ], metallic: 1, roughness: 0.32, look: 'champagne' },
	tableMarble: { color: [ 0.95, 0.93, 0.9 ], roughness: 0.08, look: 'tableMarble' },
	velvetCream: { color: [ 0.93, 0.89, 0.82 ], roughness: 0.8, look: 'velvetCream' },
	// the carousel music box's horse (Footages.local/Luminara/5d2295d4-..., e50eec08-...)
	porcelain: { color: [ 0.95, 0.93, 0.9 ], roughness: 0.2, look: 'porcelain' },
	enamelBlue: { color: [ 0.72, 0.8, 0.88 ], roughness: 0.3, look: 'enamelBlue' },
	gilt: { color: [ 0.89, 0.75, 0.48 ], metallic: 1, roughness: 0.16, look: 'gilt' },		// (the floor's marble map on its top: its UVs in metres / the tile)
};
// triangles dropped (by their mean colour) before sizing: what TRELLIS made of the photo's backdrop
const DROP = { 'crystal-ball': ( r, g, b ) => ( r + g + b ) / 3 < 0.1 };
// a base made more of (BASE[ slug ]): the brass band at the foot `scale`× as high (the rest raised on
// it), its surface smoothed (TRELLIS's is lumpy: no clean reflection), its material `mat`
// `from`: the classes that make the base (brass by default); `mat` absent: its classes kept (a pedestal and its ring)
const BASE = { 'sofa-low': { scale: 2, mat: 'brassPolished', smooth: 6 },
};
// the bodies by hand rules (ruledBody), in their own frame (u = |x| / half width, v = y / height, s = z / half depth with
// the front +, dw = the depth in from the outline seen from above / width), measured on their TRELLIS meshes; the
// sheets' parts: the floor ring (polished gold), the pedestal (satin champagne), the leather shell (its outside, the
// arms' inner faces, the rim, the plinth band under the seat), the boucle seat and back cushions (inside the shell's
// rim, and the seat cushion's front between the arms above the plinth's seam). The inlay: a tube on a guide set by
// hand from the sheets' side views (inlayTube). Symmetric: the rules use |x|, the half kept is mirrored
const RULED = {
	'sofa-body': { keep: - 1,
		classify: f => f.v < 0.024 ? 'goldInlay@base' : f.v < 0.12 ? 'champagne'
			: f.v > 0.215 && f.v < 0.63 && f.s > 0.70 && f.u < 0.76 && f.n[ 2 ] > 0.4 ? 'boucleFabric'		// (the seat cushion's front)
			: f.v > 0.215 && f.dw > 0.05 ? 'boucleFabric'		// (inside the shell's rim: the seat's top, the back cushion)
			: 'leatherShell',
		// (the guide at the measuring size, 2.0 m: scaled with the body)
		extra: b => ( { goldInlay: inlayTube( b, scaleGuide( { side: [ [ 0.335, 0.17 ], [ 0.32, 0.24 ], [ 0.29, 0.31 ], [ 0.24, 0.39 ], [ 0.17, 0.443 ], [ 0.09, 0.465 ], [ 0.0, 0.488 ], [ - 0.15, 0.509 ], [ - 0.31, 0.535 ], [ - 0.44, 0.56 ] ],
			back: [ [ 0.86, 0.585 ], [ 0.7, 0.59 ], [ 0.5, 0.59 ], [ 0.3, 0.59 ], [ 0.1, 0.59 ], [ 0, 0.59 ] ] }, b.W / 2.0 ) ) } ) },
	'chair-body': { keep: - 1,
		classify: f => f.v < 0.031 ? 'goldInlay@base' : f.v < 0.105 ? 'champagne'
			: f.v > 0.21 && f.v < 0.56 && f.s > 0.74 && f.u < 0.72 && f.n[ 2 ] > 0.4 ? 'boucleFabric'		// (the seat cushion's front)
			: f.v > 0.86 && f.u < 0.6 ? 'boucleFabric'		// (the back cushion above the shell's rim, at the middle)
			: f.v > 0.21 && f.dw > 0.11 ? 'boucleFabric'
			: 'leatherShell',
		extra: b => ( { goldInlay: inlayTube( b, scaleGuide( { side: [ [ 0.26, 0.15 ], [ 0.24, 0.23 ], [ 0.21, 0.31 ], [ 0.17, 0.38 ], [ 0.12, 0.43 ], [ 0.05, 0.462 ], [ - 0.05, 0.483 ], [ - 0.17, 0.509 ], [ - 0.27, 0.535 ] ],
			back: [ [ 0.3, 0.55 ], [ 0.2, 0.56 ], [ 0.1, 0.565 ], [ 0, 0.565 ] ] }, b.W / 0.86 ) ) } ) },
};
/** A guide set at one size, at another: its metres scaled. */
const scaleGuide = ( g, k ) => ( { side: g.side.map( ( [ a, b ] ) => [ a * k, b * k ] ), back: g.back.map( ( [ a, b ] ) => [ a * k, b * k ] ) } );
// each test: ( r, g, b: the mean colour, 0..1; y: height, rad: distance from the axis, both in
// fractions of its height ), measured on the TRELLIS meshes (tools/luminara-3d.py's)
const warm = ( r, g, b ) => r - b > 0.18;		// brass: well above blue (the cream boucle's: 0.10-0.16)
const CLASSES = {
	'egg-chair': [ [ 'brass', ( r, g, b, y ) => y < 0.3 && warm( r, g, b ) || y < 0.06 ], [ 'boucle', ( r, g, b ) => r - b > 0.04 ], [ 'lacquer', () => true ] ],
	'sofa': [ [ 'brass', ( r, g, b, y ) => y < 0.1 && r - b > 0.2 ], [ 'boucle', () => true ] ],
	'side-table': [ [ 'brass', ( r, g, b, y ) => y < 0.6 ], [ 'marble', ( r, g, b, y ) => y < 0.645 ], [ 'natural', ( r, g, b, y ) => y > 0.78 || r - b > 0.1 ], [ 'ceramic', () => true ] ],
	'sofa-low': [ [ 'brass', ( r, g, b, y ) => y < 0.08 && r - b > 0.18 ], [ 'boucle', () => true ] ],
	'tub-chair': [ [ 'brass', ( r, g, b, y ) => y < 0.06 && r - b > 0.18 ], [ 'boucle', () => true ] ],
	'sideboard': [ [ 'brass', ( r, g, b, y ) => y < 0.18 && r - b > 0.1 ], [ 'lacquer', () => true ] ],
	'table-lamp': [ [ 'ceramic', ( r, g, b, y ) => y < 0.36 ], [ 'brass', ( r, g, b, y ) => y < 0.56 ], [ 'shade', () => true ] ],
	'roses': [ [ 'ceramic', ( r, g, b, y ) => y < 0.42 ], [ 'natural', () => true ] ],
	'gold-disc': [ [ 'brass', () => true ] ],
	'clef-statue': [ [ 'stone', ( r, g, b, y ) => y < 0.2 ], [ 'brass', () => true ] ],
	'gold-ribbon': [ [ 'stone', ( r, g, b, y ) => y < 0.08 ], [ 'ceramic', ( r, g, b ) => r - b < 0.08 && ( r + g + b ) / 3 > 0.5 ], [ 'brass', () => true ] ],
	'books': [ [ 'brass', ( r, g, b ) => r - b > 0.3 && g > 0.5 ], [ 'books', () => true ] ],
	'crystal': [ [ 'crystal', () => true ] ],
	// the close-ups' (tests by colour: warm = brass, green = leaves, bright and grey = glass or silver; by height for the parts)
	'pothos': [ [ 'ceramic', ( r, g, b, y ) => y < 0.42 && g - r < 0.04 ], [ 'foliage', () => true ] ],
	'armillary': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'glass', () => true ] ],
	'figurine': [ [ 'ceramic', () => true ] ],
	'crystal-gem': [ [ 'silver', ( r, g, b, y ) => y < 0.22 ], [ 'crystal', () => true ] ],
	'gramophone': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'silver', () => true ] ],
	'hourglass': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'natural', ( r, g, b, y ) => y < 0.45 && r - b > 0.05 ], [ 'glass', () => true ] ],
	'white-flowers': [ [ 'glass', ( r, g, b, y ) => y < 0.38 ], [ 'foliage', ( r, g, b ) => g > r + 0.04 && g > b ], [ 'ceramic', () => true ] ],
	'cloche': [ [ 'brass', ( r, g, b ) => r - b > 0.14 ], [ 'glass', () => true ] ],
	'astronaut': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'crystal-note': [ [ 'crystal', () => true ] ],
	'loop-sculpture': [ [ 'ceramic', () => true ] ],
	'headphones': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'diffuser': [ [ 'natural', ( r, g, b, y ) => y > 0.5 ], [ 'glass', () => true ] ],
	'metronome': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'glass', () => true ] ],
	'whale-tail': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'ceramic', () => true ] ],		// (its marble block: white)
	'radio': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'coral-tree': [ [ 'brass', ( r, g, b, y ) => y < 0.15 || r - b > 0.15 ], [ 'silver', () => true ] ],
	'mushroom-lamp': [ [ 'brass', () => true ] ],
	'crystal-ball': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'ceramic', ( r, g, b, y ) => y < 0.42 ], [ 'glass', () => true ] ],
	'small-cabinet': [ [ 'brass', ( r, g, b, y ) => y < 0.18 ], [ 'lacquer', () => true ] ],		// (its legs)
	'banquette': [ [ 'brass', ( r, g, b, y ) => y < 0.08 && r - b > 0.15 ], [ 'lacquer', ( r, g, b, y ) => y < 0.42 ], [ 'boucle', () => true ] ],
	'lily-planter': [ [ 'ceramic', ( r, g, b, y ) => y < 0.53 ], [ 'brass', ( r, g, b, y ) => y < 0.57 && r - b > 0.08 ], [ 'foliage', ( r, g, b ) => g > r + 0.03 ], [ 'ceramic', () => true ] ],
	'books-grey': [ [ 'stone', ( r, g, b, y ) => false ], [ 'books', () => true ] ],
	'books-gold': [ [ 'brass', ( r, g, b ) => r - b > 0.2 && ( r + g + b ) / 3 > 0.45 ], [ 'books', () => true ] ],
	'books-flat': [ [ 'books', () => true ] ],
	'perfume': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'crystal', () => true ] ],
	'shell': [ [ 'brass', ( r, g, b, y ) => y < 0.35 && r - b > 0.15 ], [ 'ceramic', () => true ] ],
	'gold-star': [ [ 'brass', () => true ] ],
	'brass-globe': [ [ 'ceramic', ( r, g, b, y ) => y < 0.12 && r - b < 0.1 ], [ 'brass', () => true ] ],
	'jewelry-box': [ [ 'brass', ( r, g, b ) => r - b > 0.15 ], [ 'lacquer', () => true ] ],
	'clock': [ [ 'brass', ( r, g, b ) => r - b > 0.12 ], [ 'ceramic', () => true ] ],
	'ceramic-vase': [ [ 'ceramic', () => true ] ],
	'candles': [ [ 'brass', ( r, g, b, y ) => y < 0.15 ], [ 'ceramic', () => true ] ],
	'olive-vase': [ [ 'ceramic', ( r, g, b, y ) => y < 0.55 && ( r + g + b ) / 3 > 0.55 && Math.abs( g - r ) < 0.05 ], [ 'foliage', () => true ] ],
	// the carousel's horse: gilt (warm, saturated), its saddle pale blue (blue over red), the rest white porcelain
	'carousel-horse': [ [ 'gilt', ( r, g, b ) => r - b > 0.08 && r > 0.4 ], [ 'enamelBlue', ( r, g, b ) => b - r > 0.04 ], [ 'porcelain', () => true ] ],		// (measured: gilt 4.8 %, blue 7.4 % of the faces)
	'pillow-blue': [ [ 'velvetBlue', () => true ] ], 'pillow-lumbar': [ [ 'velvetBlue', () => true ] ], 'pillow-cream': [ [ 'velvetCream', () => true ] ],
	'cushion-square': [ [ 'fabric', () => true ] ], 'cushion-lumbar': [ [ 'fabric', () => true ] ], 'cushion-velvet': [ [ 'fabric', () => true ] ],
	'plant': [ [ 'brass', ( r, g, b, y ) => y > 0.35 && y < 0.41 && warm( r, g, b ) ], [ 'ceramic', ( r, g, b, y ) => y < 0.4 ], [ 'natural', ( r, g, b, y, rad ) => y < 0.56 || rad < 0.015 && y < 0.62 ], [ 'foliage', () => true ] ],
};

const opt = { generated: null, out: path.join( root, 'public', 'luminara', 'luminara.glb' ) };
const argv = process.argv.slice( 2 );
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--generated' ) opt.generated = v();
	else if ( a === '--out' ) opt.out = path.resolve( v() );
	else if ( a === '--only' ) opt.only = new Set( v().split( ',' ) );		// (only these furniture slugs: a quick look, with --out elsewhere)
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! opt.generated ) throw new Error( 'usage: node tools/luminara-asset.mjs --generated <dir> [--out file.glb]' );
const G = opt.generated, t0 = Date.now(), say = s => console.log( s );

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions( [ EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsSheen, EXTTextureWebP ] ).registerDependencies( { 'meshopt.encoder': MeshoptEncoder } );
const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene( 'luminara' );
doc.createExtension( EXTTextureWebP ).setRequired( true );
const mats = {};
const material = name => mats[ name ] ??= ( () => {

	const m = MAT[ name ];
	return doc.createMaterial( name ).setBaseColorFactor( [ ...m.color, 1 ] ).setMetallicFactor( m.metallic ?? 0 ).setRoughnessFactor( m.roughness ).setExtras( { look: m.look } );

} )();
const acc = ( type, array ) => doc.createAccessor().setType( type ).setArray( array ).setBuffer( buffer );

/** Smooth normals (area weighted) of an indexed mesh. */
function normalsOf( pos, idx ) {

	const nor = new Float32Array( pos.length );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = 3 * idx[ t ], b = 3 * idx[ t + 1 ], c = 3 * idx[ t + 2 ];
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ], vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
		for ( const o of [ a, b, c ] ) { nor[ o ] += fx; nor[ o + 1 ] += fy; nor[ o + 2 ] += fz; }

	}
	for ( let i = 0; i < nor.length; i += 3 ) { const l = Math.hypot( nor[ i ], nor[ i + 1 ], nor[ i + 2 ] ) || 1; nor[ i ] /= l; nor[ i + 1 ] /= l; nor[ i + 2 ] /= l; }
	return nor;

}

/**
 * A labelled mesh (tools/luminara-parts.py: the part in the colour's alpha) simplified part by part: each triangle's
 * part (its corners' most), the vertices on a seam between parts duplicated (one per part), then simplified with its
 * borders locked, so no triangle spans two parts and the seams stay where they were (both sides' copies: one
 * position, no crack). Simplified across them, a part's edge turned to a saw.
 */
function splitSimplify( prim, ratio ) {

	const P = prim.getAttribute( 'POSITION' ), C = prim.getAttribute( 'COLOR_0' ), I = prim.getIndices().getArray();
	const nv = P.getCount(), pos = new Float32Array( P.getArray() ), col = new Float32Array( nv * 4 ), part = new Uint8Array( nv );
	for ( let i = 0; i < nv; ++ i ) { const e = C.getElement( i, [] ); col.set( [ e[ 0 ], e[ 1 ], e[ 2 ], e[ 3 ] ?? 0 ], 4 * i ); part[ i ] = Math.round( ( e[ 3 ] ?? 0 ) * 255 ); }
	const nt = I.length / 3, tp = new Uint8Array( nt );
	for ( let t = 0; t < nt; ++ t ) { const a = part[ I[ 3 * t ] ], b = part[ I[ 3 * t + 1 ] ], c = part[ I[ 3 * t + 2 ] ]; tp[ t ] = a === b || a === c ? a : b === c ? b : a; }
	// a vertex per ( vertex, part ) it is used by
	const key = new Map(), outPos = [], outCol = [], idx = new Uint32Array( I.length );
	for ( let t = 0; t < nt; ++ t ) for ( let j = 0; j < 3; ++ j ) {

		const v = I[ 3 * t + j ], k = v * 8 + tp[ t ];
		let w = key.get( k );
		if ( w === undefined ) { w = outPos.length / 3; key.set( k, w ); outPos.push( pos[ 3 * v ], pos[ 3 * v + 1 ], pos[ 3 * v + 2 ] ); outCol.push( col[ 4 * v ], col[ 4 * v + 1 ], col[ 4 * v + 2 ], tp[ t ] / 255 ); }
		idx[ 3 * t + j ] = w;

	}
	const P2 = new Float32Array( outPos );
	const [ simp ] = MeshoptSimplifier.simplify( idx, P2, 3, Math.max( 3, Math.round( idx.length * ratio / 3 ) * 3 ), 0.004, [ 'LockBorder' ] );
	// the vertices still used, compacted
	const remap = new Int32Array( P2.length / 3 ).fill( - 1 ), fp = [], fc = [], fi = new Uint32Array( simp.length );
	for ( let i = 0; i < simp.length; ++ i ) {

		const v = simp[ i ];
		if ( remap[ v ] < 0 ) { remap[ v ] = fp.length / 3; fp.push( P2[ 3 * v ], P2[ 3 * v + 1 ], P2[ 3 * v + 2 ] ); fc.push( outCol[ 4 * v ], outCol[ 4 * v + 1 ], outCol[ 4 * v + 2 ], outCol[ 4 * v + 3 ] ); }
		fi[ i ] = remap[ v ];

	}
	P.setArray( new Float32Array( fp ) );
	C.setArray( new Float32Array( fc ) ).setNormalized( false );
	prim.getIndices().setArray( fi );
	for ( const s of prim.listSemantics() ) if ( ! [ 'POSITION', 'COLOR_0' ].includes( s ) ) prim.setAttribute( s, null );		// (normals: made again)

}

// ---- bodies by hand-set rules (RULED[ slug ]): the sofa group's set. TRELLIS's mesh (its pillow-free body: tools/luminara-gen.mjs
// sofa-body, chair-body) sized and centred; one half kept (`keep`: the better one, -1 or +1 in x) and mirrored, so
// it is symmetric; each triangle's class by `classify( f )`, hand rules on the triangle in the body's own frame
// ( f.x, f.y, f.z m; f.u = |x| / half width, f.v = y / height, f.s = z / half depth (+ the front); f.n its normal
// with x as |x|'s side, f.r the colour's mean ); each class simplified apart, its borders locked (its seams where the
// rules put them), the half then mirrored back (both sides the same, the seam at x 0 shared). No vertex colour or
// photo segmentation decides a material here. `extra( body )`: more geometry per half (the inlay's tube), mirrored too ----
function ruledBody( slug, P, I, C, R ) {

	const [ axis, metres ] = SIZE[ slug ];
	const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const v of I ) for ( let d = 0; d < 3; ++ d ) { lo[ d ] = Math.min( lo[ d ], P[ 3 * v + d ] ); hi[ d ] = Math.max( hi[ d ], P[ 3 * v + d ] ); }
	const k = metres / ( hi[ 'xyz'.indexOf( axis ) ] - lo[ 'xyz'.indexOf( axis ) ] );
	const pos = new Float32Array( P.length );
	for ( let i = 0; i < P.length; i += 3 ) { pos[ i ] = ( P[ i ] - ( lo[ 0 ] + hi[ 0 ] ) / 2 ) * k; pos[ i + 1 ] = ( P[ i + 1 ] - lo[ 1 ] ) * k; pos[ i + 2 ] = ( P[ i + 2 ] - ( lo[ 2 ] + hi[ 2 ] ) / 2 ) * k; }
	const W = ( hi[ 0 ] - lo[ 0 ] ) * k, H = ( hi[ 1 ] - lo[ 1 ] ) * k, D = ( hi[ 2 ] - lo[ 2 ] ) * k;
	const depth = footprintDepth( pos, W, D );		// (each vertex's distance in from the body's outline seen from above, m)
	// the half kept: triangles whose centre is on its side, their other corners onto x 0
	const side = R.keep, half = [];
	for ( let t = 0; t < I.length; t += 3 ) { const cx = ( pos[ 3 * I[ t ] ] + pos[ 3 * I[ t + 1 ] ] + pos[ 3 * I[ t + 2 ] ] ) / 3; if ( cx * side >= 0 ) half.push( I[ t ], I[ t + 1 ], I[ t + 2 ] ); }
	for ( const v of half ) if ( pos[ 3 * v ] * side < 0 ) pos[ 3 * v ] = 0;
	// its open border near the middle (the cut: edges of one triangle only, within 3 cm of x 0) onto x 0: else the half's
	// jagged edge and its mirror leave a crack down the middle
	{

		const count = new Map(), key = ( a, b ) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
		for ( let t = 0; t < half.length; t += 3 ) for ( let j = 0; j < 3; ++ j ) { const e = key( half[ t + j ], half[ t + ( j + 1 ) % 3 ] ); count.set( e, ( count.get( e ) ?? 0 ) + 1 ); }
		for ( const [ e, n ] of count ) if ( n === 1 ) for ( const v of [ Math.floor( e / 4294967296 ), e % 4294967296 ] ) if ( Math.abs( pos[ 3 * v ] ) < 0.03 ) pos[ 3 * v ] = 0;

	}
	const tri = new Uint32Array( half );
	// each triangle classed (its centre, its normal: x as away from the middle; TRELLIS's winding is mixed, so its sign is not kept)
	const cls = [], names = [];
	for ( let t = 0; t < tri.length; t += 3 ) {

		const a = 3 * tri[ t ], b = 3 * tri[ t + 1 ], c = 3 * tri[ t + 2 ];
		const x = ( pos[ a ] + pos[ b ] + pos[ c ] ) / 3, y = ( pos[ a + 1 ] + pos[ b + 1 ] + pos[ c + 1 ] ) / 3, z = ( pos[ a + 2 ] + pos[ b + 2 ] + pos[ c + 2 ] ) / 3;
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ], vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot( nx, ny, nz ) || 1; nx /= nl; ny /= nl; nz /= nl;
		const r = [ 0, 1, 2 ].map( j => ( C[ 3 * tri[ t ] + j ] + C[ 3 * tri[ t + 1 ] + j ] + C[ 3 * tri[ t + 2 ] + j ] ) / 3 );
		const dm = ( depth[ tri[ t ] ] + depth[ tri[ t + 1 ] ] + depth[ tri[ t + 2 ] ] ) / 3;
		const f = { x, y, z, u: Math.abs( x ) / ( W / 2 ), v: y / H, s: z / ( D / 2 ), dw: dm / W, n: [ nx * side, ny, nz ], r, W, H, D };
		const name = R.classify( f );
		let id = names.indexOf( name ); if ( id < 0 ) { id = names.length; names.push( name ); }
		cls.push( id );

	}
	// each class apart: its vertices duplicated at its borders, simplified with them locked (the x 0 seam: a border too)
	const target = TRIS[ slug ] / 2, total = tri.length / 3, out = new Map();
	for ( const [ id, name ] of names.entries() ) {

		const map = new Map(), vp = [], vc = [], ix = [];
		for ( let t = 0, q = 0; t < tri.length; t += 3, ++ q ) if ( cls[ q ] === id ) for ( let j = 0; j < 3; ++ j ) {

			const v = tri[ t + j ]; let w = map.get( v );
			if ( w === undefined ) { w = vp.length / 3; map.set( v, w ); vp.push( pos[ 3 * v ], pos[ 3 * v + 1 ], pos[ 3 * v + 2 ] ); vc.push( C[ 3 * v ], C[ 3 * v + 1 ], C[ 3 * v + 2 ] ); }
			ix.push( w );

		}
		const n = ix.length / 3, want = Math.max( 4, Math.round( target * n / total ) ), fp = new Float32Array( vp );
		const [ simp ] = n > want ? MeshoptSimplifier.simplify( new Uint32Array( ix ), fp, 3, want * 3, 0.004, [ 'LockBorder' ] ) : [ new Uint32Array( ix ) ];
		out.set( name, { pos: fp, col: new Float32Array( vc ), idx: simp } );

	}
	for ( const [ name, g ] of Object.entries( R.extra?.( { W, H, D, pos, tri, side } ) ?? {} ) ) {		// (procedural parts: the inlay's tube)

		const o = out.get( name );
		if ( ! o ) { out.set( name, g ); continue; }
		const base = o.pos.length / 3;
		out.set( name, { pos: Float32Array.from( [ ...o.pos, ...g.pos ] ), col: Float32Array.from( [ ...o.col, ...g.col ] ), idx: Uint32Array.from( [ ...o.idx, ...Array.from( g.idx, i => i + base ) ] ) } );

	}
	// mirrored: the half and its mirror (x -x, the winding reversed), the seam's vertices (x 0) shared
	const res = new Map();
	for ( const [ name, g ] of out ) {

		const n = g.pos.length / 3, mi = new Int32Array( n ), mp = Array.from( g.pos ), mc = Array.from( g.col );
		for ( let v = 0; v < n; ++ v ) { if ( Math.abs( g.pos[ 3 * v ] ) < 1e-6 ) mi[ v ] = v; else { mi[ v ] = mp.length / 3; mp.push( - g.pos[ 3 * v ], g.pos[ 3 * v + 1 ], g.pos[ 3 * v + 2 ] ); mc.push( g.col[ 3 * v ], g.col[ 3 * v + 1 ], g.col[ 3 * v + 2 ] ); } }
		const idx = Array.from( g.idx );
		for ( let t = 0; t < g.idx.length; t += 3 ) idx.push( mi[ g.idx[ t ] ], mi[ g.idx[ t + 2 ] ], mi[ g.idx[ t + 1 ] ] );
		res.set( name, { pos: new Float32Array( mp ), col: new Float32Array( mc ), idx: new Uint32Array( idx ) } );

	}
	if ( process.env.LUMINARA_RULED_DUMP ) {		// (a look at the classes without the app: tools' splat previews)

		const dump = {};
		for ( const [ name, g ] of res ) dump[ name ] = { pos: Buffer.from( g.pos.buffer ).toString( 'base64' ), idx: Buffer.from( g.idx.buffer ).toString( 'base64' ) };
		fs.writeFileSync( path.join( process.env.LUMINARA_RULED_DUMP, `${ slug }-ruled.json` ), JSON.stringify( dump ) );

	}
	return { parts: res, size: [ W, H, D ] };

}

/** Each vertex's distance in from the outline seen from above (1 cm grid: occupancy closed and filled, a chamfer distance), m. */
function footprintDepth( pos, W, D ) {

	const cell = 0.01, nx = Math.ceil( W / cell ) + 12, nz = Math.ceil( D / cell ) + 12, ox = - W / 2 - 6 * cell, oz = - D / 2 - 6 * cell;
	let g = new Uint8Array( nx * nz );
	const ij = new Int32Array( pos.length / 3 );
	for ( let v = 0; v < pos.length / 3; ++ v ) { const i = Math.floor( ( pos[ 3 * v ] - ox ) / cell ), j = Math.floor( ( pos[ 3 * v + 2 ] - oz ) / cell ); ij[ v ] = j * nx + i; g[ j * nx + i ] = 1; }
	const morph = ( src, dilate ) => { const o = new Uint8Array( src.length ); for ( let j = 1; j < nz - 1; ++ j ) for ( let i = 1; i < nx - 1; ++ i ) { let a = dilate ? 0 : 1; for ( let dj = - 1; dj <= 1; ++ dj ) for ( let di = - 1; di <= 1; ++ di ) { const q = src[ ( j + dj ) * nx + i + di ]; a = dilate ? a | q : a & q; } o[ j * nx + i ] = a; } return o; };
	for ( let k = 0; k < 3; ++ k ) g = morph( g, true );
	for ( let k = 0; k < 3; ++ k ) g = morph( g, false );
	// holes filled: the outside flooded from the border
	const out = new Uint8Array( g.length ), stack = [ 0 ]; out[ 0 ] = 1;
	while ( stack.length ) { const q = stack.pop(), i = q % nx, j = ( q / nx ) | 0; for ( const [ di, dj ] of [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ] ) { const a = i + di, b = j + dj; if ( a < 0 || b < 0 || a >= nx || b >= nz ) continue; const r = b * nx + a; if ( ! out[ r ] && ! g[ r ] ) { out[ r ] = 1; stack.push( r ); } } }
	// chamfer 3-4 distance from the outside
	const d = new Float32Array( g.length ).map( ( _, q ) => out[ q ] ? 0 : 1e9 );
	for ( let j = 1; j < nz; ++ j ) for ( let i = 1; i < nx - 1; ++ i ) { const q = j * nx + i; d[ q ] = Math.min( d[ q ], d[ q - 1 ] + 3, d[ q - nx ] + 3, d[ q - nx - 1 ] + 4, d[ q - nx + 1 ] + 4 ); }
	for ( let j = nz - 2; j >= 0; -- j ) for ( let i = nx - 2; i > 0; -- i ) { const q = j * nx + i; d[ q ] = Math.min( d[ q ], d[ q + 1 ] + 3, d[ q + nx ] + 3, d[ q + nx + 1 ] + 4, d[ q + nx - 1 ] + 4 ); }
	return Float32Array.from( ij, q => d[ q ] / 3 * cell );

}

/**
 * A gold inlay as a thin tube on the shell (the half kept, mirrored with it): a hand-placed guide, in metres in the
 * body's frame, `side`: [ [ z, y ], ... ] on its side face (each onto its outermost point there, max |x|), then `back`:
 * [ [ |x|, y ], ... ] across its back (each onto its backmost point, min z), front to back to the middle. The line
 * smoothed, resampled every 8 mm, swept with a tube of radius `r`, its centre `sink` in from the surface.
 */
function inlayTube( { pos, tri, side: keep }, guide, { r = 0.004, sink = - 0.001, tol = 0.02 } = {} ) {

	const used = new Uint8Array( pos.length / 3 ); for ( const v of tri ) used[ v ] = 1;
	const pts = [];
	const onto = ( test, score ) => { let best = - Infinity, b = - 1; for ( let v = 0; v < used.length; ++ v ) if ( used[ v ] && test( v ) ) { const sc = score( v ); if ( sc > best ) { best = sc; b = v; } } return b; };
	for ( const [ z, y ] of guide.side ) { const v = onto( v => Math.abs( pos[ 3 * v + 2 ] - z ) < tol && Math.abs( pos[ 3 * v + 1 ] - y ) < tol, v => pos[ 3 * v ] * keep ); if ( v >= 0 ) pts.push( [ pos[ 3 * v ], pos[ 3 * v + 1 ], pos[ 3 * v + 2 ] ] ); }
	for ( const [ ax, y ] of guide.back ) { const v = onto( v => Math.abs( pos[ 3 * v ] * keep - ax ) < tol && Math.abs( pos[ 3 * v + 1 ] - y ) < tol, v => - pos[ 3 * v + 2 ] ); if ( v >= 0 ) pts.push( [ ax === 0 ? 0 : pos[ 3 * v ], pos[ 3 * v + 1 ], pos[ 3 * v + 2 ] ] ); }
	// smoothed (a moving mean, its ends kept), resampled by length
	let sm = pts;
	for ( let it = 0; it < 3; ++ it ) sm = sm.map( ( p, i ) => i === 0 || i === sm.length - 1 ? p : [ 0, 1, 2 ].map( d => ( sm[ i - 1 ][ d ] + 2 * p[ d ] + sm[ i + 1 ][ d ] ) / 4 ) );
	const line = [ sm[ 0 ] ];
	for ( let i = 1; i < sm.length; ++ i ) { const a = sm[ i - 1 ], b = sm[ i ], L = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ), n = Math.max( 1, Math.ceil( L / 0.008 ) ); for ( let k = 1; k <= n; ++ k ) line.push( [ 0, 1, 2 ].map( d => a[ d ] + ( b[ d ] - a[ d ] ) * k / n ) ); }
	// the tube: its centre `sink` in (towards the body's middle line at its height), rings of 8
	const P = [], Iv = [], SEGS = 8;
	for ( let i = 0; i < line.length; ++ i ) {

		const p = line[ i ], q = line[ Math.min( line.length - 1, i + 1 ) ], o = line[ Math.max( 0, i - 1 ) ];
		const t = [ q[ 0 ] - o[ 0 ], q[ 1 ] - o[ 1 ], q[ 2 ] - o[ 2 ] ], tl = Math.hypot( ...t ) || 1; t[ 0 ] /= tl; t[ 1 ] /= tl; t[ 2 ] /= tl;
		const out = [ p[ 0 ], 0, p[ 2 ] ], ol = Math.hypot( out[ 0 ], out[ 2 ] ) || 1; out[ 0 ] /= ol; out[ 2 ] /= ol;
		const c = [ p[ 0 ] - out[ 0 ] * sink, p[ 1 ], p[ 2 ] - out[ 2 ] * sink ];
		// a frame round the tangent
		let a = [ out[ 1 ] * t[ 2 ] - out[ 2 ] * t[ 1 ], out[ 2 ] * t[ 0 ] - out[ 0 ] * t[ 2 ], out[ 0 ] * t[ 1 ] - out[ 1 ] * t[ 0 ] ]; const al = Math.hypot( ...a ) || 1; a = a.map( x => x / al );
		const b = [ t[ 1 ] * a[ 2 ] - t[ 2 ] * a[ 1 ], t[ 2 ] * a[ 0 ] - t[ 0 ] * a[ 2 ], t[ 0 ] * a[ 1 ] - t[ 1 ] * a[ 0 ] ];
		for ( let k = 0; k < SEGS; ++ k ) { const w = 2 * Math.PI * k / SEGS, cs = Math.cos( w ) * r, sn = Math.sin( w ) * r; P.push( c[ 0 ] + a[ 0 ] * cs + b[ 0 ] * sn, c[ 1 ] + a[ 1 ] * cs + b[ 1 ] * sn, c[ 2 ] + a[ 2 ] * cs + b[ 2 ] * sn ); }
		if ( i ) for ( let k = 0; k < SEGS; ++ k ) { const a0 = ( i - 1 ) * SEGS + k, a1 = ( i - 1 ) * SEGS + ( k + 1 ) % SEGS, b0 = i * SEGS + k, b1 = i * SEGS + ( k + 1 ) % SEGS; Iv.push( a0, b0, a1, a1, b0, b1 ); }

	}
	return { pos: new Float32Array( P ), col: new Float32Array( P.length ).fill( 1 ), idx: new Uint32Array( Iv ) };

}

// ---- furniture ----
const src = new NodeIO();
for ( const slug of Object.keys( TRIS ) ) {

	if ( opt.only && ! opt.only.has( slug ) ) continue;
	// (its parts labelled, if they are: tools/luminara-parts.py, the part in the colour's alpha)
	const partsFile = path.join( G, `${ slug }-parts.glb` ), file = fs.existsSync( partsFile ) ? partsFile : path.join( G, `${ slug }-trellis.glb` );
	if ( ! fs.existsSync( file ) ) { say( `${ slug }: no ${ path.basename( file ) } (tools/luminara-3d.py), skipped` ); continue; }
	const sd = await src.read( file ), p0 = sd.getRoot().listMeshes()[ 0 ].listPrimitives()[ 0 ];
	const n0 = p0.getIndices().getCount() / 3;
	weldPrimitive( p0, { overwrite: false } );
	if ( RULED[ slug ] ) {		// (by hand rules, at full resolution: ruledBody)

		const P = p0.getAttribute( 'POSITION' ).getArray(), Ca = p0.getAttribute( 'COLOR_0' ), nvv = P.length / 3, C = new Float32Array( nvv * 3 );
		for ( let i = 0; i < nvv; ++ i ) { const e = Ca.getElement( i, [] ); C[ 3 * i ] = e[ 0 ]; C[ 3 * i + 1 ] = e[ 1 ]; C[ 3 * i + 2 ] = e[ 2 ]; }
		const { parts, size } = ruledBody( slug, P, p0.getIndices().getArray(), C, RULED[ slug ] );
		const mesh = doc.createMesh( slug ), list = [];
		for ( const [ name, g ] of parts ) {

			const mname = name.split( '@' )[ 0 ];		// (goldInlay@base: the ring, the inlay's material, kept apart)
			const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', g.idx ) ).setAttribute( 'POSITION', acc( 'VEC3', g.pos ) ).setAttribute( 'NORMAL', acc( 'VEC3', normalsOf( g.pos, g.idx ) ) ).setMaterial( material( mname ) );
			if ( MAT[ mname ].vertexColor ) prim.setAttribute( 'COLOR_0', acc( 'VEC3', g.col ) );
			mesh.addPrimitive( prim );
			list.push( `${ name } ${ g.idx.length / 3 }` );

		}
		scene.addChild( doc.createNode( slug ).setMesh( mesh ).setExtras( { kind: 'furniture', size: size.map( v => +v.toFixed( 3 ) ), ...( RULED[ slug ].extras?.( size ) ?? {} ) } ) );
		say( `${ slug }: ${ n0 } triangles, by its rules, mirrored (its ${ RULED[ slug ].keep < 0 ? '-x' : '+x' } half), ${ size.map( v => v.toFixed( 2 ) ).join( ' x ' ) } m; ${ list.join( ', ' ) }` );
		continue;

	}
	if ( file === partsFile ) splitSimplify( p0, Math.min( 1, TRIS[ slug ] / n0 ) );		// (its parts apart: their seams kept)
	else simplifyPrimitive( p0, { simplifier: MeshoptSimplifier, ratio: Math.min( 1, TRIS[ slug ] / n0 ), error: 0.004, lockBorder: false } );
	const P = p0.getAttribute( 'POSITION' ).getArray(), C = p0.getAttribute( 'COLOR_0' );
	let I = p0.getIndices().getArray();
	const nv = P.length / 3, col = new Float32Array( nv * 3 ), part = new Uint8Array( nv );
	const labelled = file === partsFile;		// (the alpha: a part id, 0..6, a normalised byte as the colour: e[ 3 ] = id / 255)
	for ( let i = 0; i < nv; ++ i ) { const e = C.getElement( i, [] ); col[ 3 * i ] = e[ 0 ]; col[ 3 * i + 1 ] = e[ 1 ]; col[ 3 * i + 2 ] = e[ 2 ]; if ( labelled ) part[ i ] = Math.round( ( e[ 3 ] ?? 0 ) * 255 ); }
	if ( DROP[ slug ] ) {

		const keep = [];
		for ( let t = 0; t < I.length; t += 3 ) {

			let r = 0, g = 0, b = 0;
			for ( let j = 0; j < 3; ++ j ) { const v = I[ t + j ]; r += col[ 3 * v ] / 3; g += col[ 3 * v + 1 ] / 3; b += col[ 3 * v + 2 ] / 3; }
			if ( ! DROP[ slug ]( r, g, b ) ) keep.push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

		}
		say( `  ${ slug }: ${ ( I.length - keep.length ) / 3 } triangles of backdrop dropped` );
		I = new Uint32Array( keep );

	}
	// sized, its base on y 0, centred in x and z (over the vertices its triangles use)
	const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const v of I ) for ( let d = 0; d < 3; ++ d ) { lo[ d ] = Math.min( lo[ d ], P[ 3 * v + d ] ); hi[ d ] = Math.max( hi[ d ], P[ 3 * v + d ] ); }
	const [ axis, metres ] = SIZE[ slug ], k = metres / ( hi[ 'xyz'.indexOf( axis ) ] - lo[ 'xyz'.indexOf( axis ) ] );
	const pos = new Float32Array( P.length );
	for ( let i = 0; i < P.length; i += 3 ) { pos[ i ] = ( P[ i ] - ( lo[ 0 ] + hi[ 0 ] ) / 2 ) * k; pos[ i + 1 ] = ( P[ i + 1 ] - lo[ 1 ] ) * k; pos[ i + 2 ] = ( P[ i + 2 ] - ( lo[ 2 ] + hi[ 2 ] ) / 2 ) * k; }
	let nor = normalsOf( pos, I ), height = ( hi[ 1 ] - lo[ 1 ] ) * k;
	// each triangle's class: by its vertices' mean colour (and height, as a fraction)
	const classes = CLASSES[ slug ], tris = new Map();
	for ( let t = 0; t < I.length; t += 3 ) {

		let r = 0, g = 0, b = 0, y = 0, rad = 0;
		// (its part: the most of its corners')
		const pa = part[ I[ t ] ], pb = part[ I[ t + 1 ] ], pc = part[ I[ t + 2 ] ], tp = pa === pb || pa === pc ? pa : pb === pc ? pb : pa;
		for ( let j = 0; j < 3; ++ j ) { const v = I[ t + j ]; r += col[ 3 * v ] / 3; g += col[ 3 * v + 1 ] / 3; b += col[ 3 * v + 2 ] / 3; y += pos[ 3 * v + 1 ] / 3 / height; rad += Math.hypot( pos[ 3 * v ], pos[ 3 * v + 2 ] ) / 3 / height; }
		const name = classes.find( ( [ , test ] ) => test( r, g, b, y, rad, tp ) )[ 0 ];
		if ( ! tris.has( name ) ) tris.set( name, [] );
		tris.get( name ).push( I[ t ], I[ t + 1 ], I[ t + 2 ] );

	}
	const baseOf = BASE[ slug ]?.from ?? [ 'brass' ];
	if ( BASE[ slug ] && baseOf.some( k => tris.has( k ) ) ) {		// the base: higher, smoothed, its own material (or its classes' own)

		const B = BASE[ slug ], idx = baseOf.flatMap( k => tris.get( k ) ?? [] ), inBase = new Uint8Array( nv );
		for ( const v of idx ) inBase[ v ] = 1;
		const ys = [ ...new Set( idx ) ].map( v => pos[ 3 * v + 1 ] ).sort( ( a, b ) => a - b ), yb = ys[ Math.floor( ys.length * 0.85 ) ];		// (its top)
		for ( let v = 0; v < nv; ++ v ) { const y = pos[ 3 * v + 1 ]; pos[ 3 * v + 1 ] = y <= yb ? y * B.scale : y + yb * ( B.scale - 1 ); }
		// smoothed: its vertices to their neighbours' mean, a few times (the rest kept)
		const nb = Array.from( { length: nv }, () => [] );
		for ( let t = 0; t < I.length; t += 3 ) for ( let j = 0; j < 3; ++ j ) { const a = I[ t + j ], b = I[ t + ( j + 1 ) % 3 ]; if ( inBase[ a ] || inBase[ b ] ) { nb[ a ].push( b ); nb[ b ].push( a ); } }
		for ( let it = 0; it < B.smooth; ++ it ) {

			const nxt = pos.slice();
			for ( let v = 0; v < nv; ++ v ) {

				if ( ! inBase[ v ] || ! nb[ v ].length ) continue;
				let x = 0, y = 0, z = 0;
				for ( const u of nb[ v ] ) { x += pos[ 3 * u ]; y += pos[ 3 * u + 1 ]; z += pos[ 3 * u + 2 ]; }
				const n = nb[ v ].length;
				nxt[ 3 * v ] = 0.5 * pos[ 3 * v ] + 0.5 * x / n; nxt[ 3 * v + 1 ] = Math.max( 0, 0.5 * pos[ 3 * v + 1 ] + 0.5 * y / n ); nxt[ 3 * v + 2 ] = 0.5 * pos[ 3 * v + 2 ] + 0.5 * z / n;

			}
			pos.set( nxt );

		}
		nor = normalsOf( pos, I );
		height += yb * ( B.scale - 1 );
		if ( B.mat ) { tris.set( B.mat, idx ); for ( const k of baseOf ) if ( k !== B.mat ) tris.delete( k ); }
		say( `  ${ slug }: its base ${ ( yb * 100 ).toFixed( 1 ) } -> ${ ( yb * B.scale * 100 ).toFixed( 1 ) } cm, smoothed, ${ B.mat ?? baseOf.join( ' + ' ) }` );

	}
	const posA = acc( 'VEC3', pos ), norA = acc( 'VEC3', nor ), colA = acc( 'VEC3', col );
	const mesh = doc.createMesh( slug ), parts = [];
	for ( const [ name, idx ] of tris ) {

		const mname = name.split( '@' )[ 0 ];		// (a class kept apart, the same material: goldInlay@base)
		const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', new Uint32Array( idx ) ) ).setAttribute( 'POSITION', posA ).setAttribute( 'NORMAL', norA ).setMaterial( material( mname ) );
		if ( MAT[ mname ].vertexColor ) prim.setAttribute( 'COLOR_0', colA );
		mesh.addPrimitive( prim );
		parts.push( `${ name } ${ idx.length / 3 }` );

	}
	scene.addChild( doc.createNode( slug ).setMesh( mesh ).setExtras( { kind: 'furniture', size: [ ( hi[ 0 ] - lo[ 0 ] ) * k, height, ( hi[ 2 ] - lo[ 2 ] ) * k ].map( v => +v.toFixed( 3 ) ) } ) );
	say( `${ slug }: ${ n0 } -> ${ I.length / 3 } triangles, ${ ( ( hi[ 0 ] - lo[ 0 ] ) * k ).toFixed( 2 ) } x ${ height.toFixed( 2 ) } x ${ ( ( hi[ 2 ] - lo[ 2 ] ) * k ).toFixed( 2 ) } m; ${ parts.join( ', ' ) }` );

}

// ---- the sofa group's coffee table (Footages.local/Luminara/d048f4be-...): round, 0.95 m across, 0.32 m high (its sheet's
// is lower, about 0.24: by the 0.45 m seats it read too low; the drum made taller, the top as thin), turned:
// a polished Calacatta top (inset a little in) inside a thin champagne-gold rim, a cream leather drum flaring out under
// the rim and in again to its foot, a satin champagne pedestal set back under it, a polished gold ring at the floor.
// Lathe profiles ( r, y ), each part its own material ----
{

	const SEG = 128, R = 0.475, H = 0.32, tile = 1.8;		// (tile: the floor's marble repeat, src/luminara.js LUMINARA.floorTile)
	const lathe = ( prof, uvTop = false ) => {		// prof: [ [ r, y ], ... ] from the outside down; a ring of quads per segment

		const pos = [], uv = [], idx = [];
		for ( let i = 0; i <= SEG; ++ i ) {

			const a = 2 * Math.PI * i / SEG, c = Math.cos( a ), sn = Math.sin( a );
			for ( const [ r, y ] of prof ) { pos.push( r * sn, y, r * c ); uv.push( uvTop ? r * sn / tile + 0.5 : i / SEG, uvTop ? r * c / tile + 0.5 : y / H ); }

		}
		const n = prof.length;
		for ( let i = 0; i < SEG; ++ i ) for ( let j = 0; j < n - 1; ++ j ) { const a = i * n + j, b = a + n; idx.push( a, b, a + 1, b, b + 1, a + 1 ); }
		return { pos: new Float32Array( pos ), uv: new Float32Array( uv ), idx: new Uint32Array( idx ) };

	};
	// the top: a disc (its centre a profile point at r 0), its edge down to the rim's inside
	const yTop = H - 0.004, rTop = R - 0.012;
	const top = lathe( [ [ 0, yTop ], [ 0.5 * rTop, yTop ], [ rTop, yTop ], [ rTop, yTop - 0.018 ] ], true );
	const rim = lathe( [ [ R - 0.012, H - 0.0035 ], [ R - 0.009, H ], [ R - 0.002, H - 0.001 ], [ R, H - 0.006 ], [ R, H - 0.016 ], [ R - 0.004, H - 0.02 ] ] );
	// the drum: under the rim, its widest just below (a soft shoulder), in to its foot
	const yFoot = 0.052, body = [];
	for ( let i = 0; i <= 14; ++ i ) {

		const t = i / 14, y = ( H - 0.02 ) - t * ( H - 0.02 - yFoot );
		const r = ( R - 0.006 ) + 0.006 * Math.sin( Math.PI * Math.min( 1, t * 3 ) ) - 0.11 * t ** 1.8;		// (from 0.469 to ~0.36 at the foot: the taper lower on the taller drum)
		body.push( [ r, y ] );

	}
	body.push( [ body[ body.length - 1 ][ 0 ] - 0.02, yFoot - 0.004 ], [ 0.3, yFoot - 0.006 ] );		// (its underside, in to the pedestal)
	const drum = lathe( body );
	const pedestal = lathe( [ [ 0.3, yFoot - 0.006 ], [ 0.302, 0.03 ], [ 0.305, 0.018 ] ] );
	const ring = lathe( [ [ 0.305, 0.018 ], [ 0.312, 0.016 ], [ 0.314, 0.006 ], [ 0.31, 0 ], [ 0, 0 ] ] );
	const mesh = doc.createMesh( 'coffee-table' ), parts = [];
	for ( const [ g, mat, withUv ] of [ [ top, 'tableMarble', true ], [ rim, 'goldInlay' ], [ drum, 'leatherShell' ], [ pedestal, 'champagne' ], [ ring, 'goldInlay' ] ] ) {

		const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', g.idx ) ).setAttribute( 'POSITION', acc( 'VEC3', g.pos ) ).setAttribute( 'NORMAL', acc( 'VEC3', normalsOf( g.pos, g.idx ) ) ).setMaterial( material( mat ) );
		if ( withUv ) prim.setAttribute( 'TEXCOORD_0', acc( 'VEC2', g.uv ) );
		mesh.addPrimitive( prim );
		parts.push( `${ mat } ${ g.idx.length / 3 }` );

	}
	scene.addChild( doc.createNode( 'coffee-table' ).setMesh( mesh ).setExtras( { kind: 'furniture', size: [ 2 * R, H, 2 * R ], top: yTop } ) );
	say( `coffee-table: built, ${ 2 * R } x ${ H } m; ${ parts.join( ', ' ) }` );

}

// ---- wall reliefs ----
const dec = ( b, T ) => { const u = Buffer.from( b, 'base64' ); return new T( u.buffer.slice( u.byteOffset, u.byteOffset + u.byteLength ) ); };
for ( const [ slug, h ] of Object.entries( RELIEF ) ) {

	const file = path.join( G, 'relief', `${ slug }.json` );
	if ( ! fs.existsSync( file ) ) { say( `${ slug }: no relief (tools/bust-depth.py, bust-relief.py), skipped` ); continue; }
	const R = JSON.parse( fs.readFileSync( file, 'utf8' ) ), k = h / R.size[ 1 ];
	const pos = dec( R.positions, Float32Array ), uv = dec( R.uvs, Float32Array ), idx = dec( R.indices, Uint32Array );
	let zmin = Infinity;
	for ( let i = 0; i < pos.length; i += 3 ) { pos[ i ] *= k; pos[ i + 1 ] *= k; pos[ i + 2 ] *= k; zmin = Math.min( zmin, pos[ i + 2 ] ); }
	for ( let i = 2; i < pos.length; i += 3 ) pos[ i ] -= zmin;		// (its back on z 0: the wall)
	for ( let i = 1; i < uv.length; i += 2 ) uv[ i ] = 1 - uv[ i ];		// (glTF: v down the image)
	// the photo as albedo: its light levelled (a broad blur divided out), to plaster white
	const photo = sharp( fs.readFileSync( path.join( G, `${ slug }-raw.jpg` ) ) ).removeAlpha().resize( 1024, 1024 );
	const { data } = await photo.clone().raw().toBuffer( { resolveWithObject: true } );
	const { data: blur } = await photo.clone().blur( 60 ).raw().toBuffer( { resolveWithObject: true } );
	const out = Buffer.alloc( data.length );
	for ( let i = 0; i < data.length; i += 3 ) {

		const l = ( blur[ i ] + blur[ i + 1 ] + blur[ i + 2 ] ) / 3 || 1;
		for ( let c = 0; c < 3; ++ c ) out[ i + c ] = Math.min( 255, Math.round( data[ i + c ] / l * 222 ) );

	}
	const albedo = await sharp( out, { raw: { width: 1024, height: 1024, channels: 3 } } ).webp( { quality: 88, effort: 5 } ).toBuffer();
	const nmap = await sharp( fs.readFileSync( path.join( G, 'relief', `${ slug }-normal.png` ) ) ).removeAlpha().resize( 1024, 1024, { fit: 'fill', kernel: 'lanczos3' } ).webp( { quality: 92, effort: 6 } ).toBuffer();
	// its self-lit pattern (tools/relief-glow.py: where it stands out of its panel), if made
	let glow = null;
	const glowFile = path.join( G, 'relief', `${ slug }-glow.png` );
	if ( fs.existsSync( glowFile ) ) glow = await sharp( fs.readFileSync( glowFile ) ).resize( 1024, 1024 ).webp( { quality: 90 } ).toBuffer();
	const mat = doc.createMaterial( `relief-${ slug }` ).setBaseColorFactor( [ 1, 1, 1, 1 ] ).setRoughnessFactor( 0.55 ).setMetallicFactor( 0 ).setDoubleSided( true )
		.setBaseColorTexture( doc.createTexture( `${ slug }-albedo` ).setImage( albedo ).setMimeType( 'image/webp' ) )
		.setNormalTexture( doc.createTexture( `${ slug }-normal` ).setImage( nmap ).setMimeType( 'image/webp' ) )
		.setExtras( { look: 'relief', objectNormal: true } );
	if ( glow ) mat.setEmissiveTexture( doc.createTexture( `${ slug }-glow` ).setImage( glow ).setMimeType( 'image/webp' ) ).setEmissiveFactor( [ 1, 1, 1 ] );
	const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', idx ) ).setAttribute( 'POSITION', acc( 'VEC3', pos ) ).setAttribute( 'NORMAL', acc( 'VEC3', normalsOf( pos, idx ) ) )
		.setAttribute( 'TEXCOORD_0', acc( 'VEC2', uv ) ).setMaterial( mat );
	simplifyPrimitive( prim, { simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.0015 / h, lockBorder: true } );
	scene.addChild( doc.createNode( slug ).setMesh( doc.createMesh( slug ).addPrimitive( prim ) ).setExtras( { kind: 'relief', size: [ R.size[ 0 ] * k, h, R.size[ 2 ] * k ].map( v => +v.toFixed( 3 ) ) } ) );
	say( `${ slug }: relief ${ ( R.size[ 0 ] * k ).toFixed( 2 ) } x ${ h } m, ${ prim.getIndices().getCount() / 3 } triangles; albedo ${ ( albedo.length / 1024 ).toFixed( 0 ) } KB, normal ${ ( nmap.length / 1024 ).toFixed( 0 ) } KB` );

}

// ---- textures, on swatches ----
/** The image made to tile: blended with itself shifted by half (the seams to the middle), by distance from the middle. */
async function tileable( buf, size ) {

	const { data } = await sharp( buf ).removeAlpha().resize( size, size ).raw().toBuffer( { resolveWithObject: true } );
	const out = Buffer.alloc( data.length ), h = size / 2;
	for ( let y = 0; y < size; ++ y ) for ( let x = 0; x < size; ++ x ) {

		const dx = Math.abs( x - h ) / h, dy = Math.abs( y - h ) / h, w = Math.min( 1, Math.max( 0, ( Math.max( dx, dy ) - 0.55 ) / 0.4 ) );		// (0 in the middle, 1 at the edge)
		const a = 3 * ( y * size + x ), b = 3 * ( ( ( y + h ) % size ) * size + ( x + h ) % size );
		for ( let c = 0; c < 3; ++ c ) out[ a + c ] = Math.round( data[ a + c ] * ( 1 - w ) + data[ b + c ] * w );

	}
	return sharp( out, { raw: { width: size, height: size, channels: 3 } } );

}
const swatch = ( slug, mat ) => {

	const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', new Uint32Array( [ 0, 1, 2 ] ) ) ).setAttribute( 'POSITION', acc( 'VEC3', new Float32Array( [ 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0 ] ) ) )
		.setAttribute( 'TEXCOORD_0', acc( 'VEC2', new Float32Array( [ 0, 0, 1, 0, 0, 1 ] ) ) ).setMaterial( mat );
	scene.addChild( doc.createNode( slug ).setMesh( doc.createMesh( slug ).addPrimitive( prim ) ).setExtras( { kind: 'swatch' } ) );

};
// the windows' outside, one per hour (src/luminara.js's presets: `outside`): the day's and the
// same city at other hours (tools/luminara-gen.mjs); the old single sky if none of them
{

	let skies = [ 'sky-day', 'sky-sunset', 'sky-dusk', 'sky-night' ].filter( k => fs.existsSync( path.join( G, `${ k }-raw.jpg` ) ) );
	if ( ! skies.length && fs.existsSync( path.join( G, 'sky-raw.jpg' ) ) ) skies = [ 'sky' ];
	for ( const k of skies ) {

		const b = await sharp( fs.readFileSync( path.join( G, `${ k }-raw.jpg` ) ) ).resize( 3072, 1024 ).webp( { quality: 80, effort: 5 } ).toBuffer();
		swatch( k, doc.createMaterial( k ).setBaseColorTexture( doc.createTexture( k ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'sky' } ) );
		say( `${ k }: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

	}

}
for ( const k of [ 'painting-1', 'painting-2', 'painting-3' ] ) if ( fs.existsSync( path.join( G, `${ k }-raw.jpg` ) ) ) {		// (the paintings: whole)

	const b = await sharp( fs.readFileSync( path.join( G, `${ k }-raw.jpg` ) ) ).resize( 1200 ).webp( { quality: 86, effort: 5 } ).toBuffer();
	swatch( k, doc.createMaterial( k ).setBaseColorTexture( doc.createTexture( k ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'painting' } ) );
	say( `${ k }: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}
if ( fs.existsSync( path.join( G, 'rug-raw.jpg' ) ) ) {		// the rug's pattern (a round rug seen from above, filling the square)

	const b = await sharp( fs.readFileSync( path.join( G, 'rug-raw.jpg' ) ) ).resize( 2048, 2048 ).webp( { quality: 88, effort: 5 } ).toBuffer();
	swatch( 'rug', doc.createMaterial( 'rug' ).setBaseColorTexture( doc.createTexture( 'rug' ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'rug' } ) );
	say( `rug: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}
if ( fs.existsSync( path.join( G, 'marble-raw.jpg' ) ) ) {

	const b = await ( await tileable( fs.readFileSync( path.join( G, 'marble-raw.jpg' ) ), 1024 ) ).webp( { quality: 86, effort: 5 } ).toBuffer();
	swatch( 'marble', doc.createMaterial( 'marble-floor' ).setBaseColorTexture( doc.createTexture( 'marble' ).setImage( b ).setMimeType( 'image/webp' ) ).setExtras( { look: 'marble' } ) );
	say( `marble: ${ ( b.length / 1024 ).toFixed( 0 ) } KB` );

}

// ---- the baked light (tools/luminara-bake.mjs): the static shell as baked (its meshes with their
// lightmap UVs, TEXCOORD_1; node shell-<i>, in src/luminara.js's bakeTargets() order) and a lightmap
// per preset, beside the pack (lightmaps/<slug>.webp, sRGB-encoded under its scale: fetched when its preset
// is shown, not with the pack); bake-meta's extras: the shell's hash, each preset's slug, scale and file.
// src/luminara.js uses them while its procedural shell still hashes the same.
{

	const B = path.join( G, 'bake' ), metaFile = path.join( B, 'bake.json' ), shellFile = path.join( B, 'shell.json' );
	if ( fs.existsSync( metaFile ) && fs.existsSync( shellFile ) ) {

		const meta = JSON.parse( fs.readFileSync( metaFile, 'utf8' ) ), shell = JSON.parse( fs.readFileSync( shellFile, 'utf8' ) ), dummy = doc.createMaterial( 'shell' );
		const f32 = b => { const u = Buffer.from( b, 'base64' ); return new Float32Array( u.buffer.slice( u.byteOffset, u.byteOffset + u.byteLength ) ); };
		const u32 = b => { const u = Buffer.from( b, 'base64' ); return new Uint32Array( u.buffer.slice( u.byteOffset, u.byteOffset + u.byteLength ) ); };
		let tris = 0;
		for ( const m of shell.meshes ) {

			const prim = doc.createPrimitive().setIndices( acc( 'SCALAR', u32( m.index ) ) ).setAttribute( 'POSITION', acc( 'VEC3', f32( m.position ) ) ).setAttribute( 'NORMAL', acc( 'VEC3', f32( m.normal ) ) )
				.setAttribute( 'TEXCOORD_0', acc( 'VEC2', f32( m.uv ) ) ).setAttribute( 'TEXCOORD_1', acc( 'VEC2', f32( m.uvBake ) ) ).setMaterial( dummy );
			weldPrimitive( prim, { overwrite: true } );		// (identical corners: one vertex)
			tris += prim.getIndices().getCount() / 3;
			scene.addChild( doc.createNode( `shell-${ m.i }` ).setMesh( doc.createMesh( `shell-${ m.i }` ).addPrimitive( prim ) ).setExtras( { kind: 'shell', of: m.name } ) );

		}
		const presets = {}, dir = path.join( path.dirname( opt.out ), 'lightmaps' ), written = new Set();
		let bytes = 0;
		fs.mkdirSync( dir, { recursive: true } );		// (overwritten in place, stale ones removed below: the directory itself removed, a running vite stopped serving it)
		for ( const [ name, p ] of Object.entries( meta.presets ) ) {

			if ( ! Number.isFinite( p.scale ) ) { say( `  ${ name }: its bake failed (scale ${ p.scale }): left out` ); continue; }
			const slug = path.basename( p.file, '.png' ), b = await sharp( fs.readFileSync( path.join( B, p.file ) ) ).webp( { quality: 94, smartSubsample: true, effort: 6 } ).toBuffer();
			fs.writeFileSync( path.join( dir, `${ slug }.webp` ), b );
			written.add( `${ slug }.webp` );
			presets[ name ] = { slug, scale: p.scale, file: `lightmaps/${ slug }.webp` };
			bytes += b.length;

		}
		for ( const f of fs.readdirSync( dir ) ) if ( ! written.has( f ) ) fs.rmSync( path.join( dir, f ) );		// (presets no longer baked)
		scene.addChild( doc.createNode( 'bake-meta' ).setExtras( { kind: 'bake', hash: meta.hash, size: meta.size, texels: meta.texels, presets } ) );
		say( `baked: the shell (${ shell.meshes.length } meshes, ${ tris } triangles) and ${ Object.keys( presets ).length } lightmaps of ${ meta.size } (${ ( bytes / 1024 ).toFixed( 0 ) } KB, in ${ path.relative( root, dir ) }/), hash ${ meta.hash }` );

	}

}
await doc.transform( prune( { keepAttributes: true, keepLeaves: true } ) );
await doc.transform( reorder( { encoder: MeshoptEncoder } ), quantize( { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 } )		/* (texcoords: the lightmap's UVs within a texel of 2048) */ );
doc.createExtension( EXTMeshoptCompression ).setRequired( true ).setEncoderOptions( { method: EXTMeshoptCompression.EncoderMethod.FILTER } );
doc.getRoot().setExtras( { source: 'tools/luminara-asset.mjs', generated: new Date().toISOString() } );
fs.mkdirSync( path.dirname( opt.out ), { recursive: true } );
await io.write( opt.out, doc );
say( `${ path.relative( root, opt.out ) }: ${ ( fs.statSync( opt.out ).size / 1e6 ).toFixed( 2 ) } MB in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s` );

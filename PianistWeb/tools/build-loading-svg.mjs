// Loading animation artwork: an abstract grand piano seen from above (one continuous body
// line, the keyboard reduced to its black keys, two crossing string families) and streamlines
// flowing off the bentside. Writes into public/loading/:
//   base.svg            static drawing (all lines, dim)
//   mask-*.svg          the line groups as masks; index.html slides an amber light through
//                       them on composited layers, so it keeps moving while the main thread
//                       is busy building the scene
//   preview.svg         self-contained animated version of the same design
// Run: node tools/build-loading-svg.mjs

import fs from 'node:fs';
import path from 'node:path';

const out = path.join( path.dirname( new URL( import.meta.url ).pathname ), '../public/loading' );
fs.mkdirSync( out, { recursive: true } );

const W = 400, H = 280;
const IVORY = '#e9e4da', AMBER = '#d9b26f';

// ---- geometry ------------------------------------------------------------------------------
const body = 'M112 214 L112 78 C112 44 132 30 160 30 C190 30 204 46 216 70 C236 110 262 134 282 156 C294 170 298 184 298 200 L298 214';

// black keys of an 88-key keyboard across x 110..302 (52 white keys from A0)
const blackKeys = [];
{

	const x0 = 110, w = 192 / 52, letters = 'ABCDEFG';
	for ( let i = 0; i < 51; ++ i ) if ( 'CDFGA'.includes( letters[ i % 7 ] ) ) blackKeys.push( x0 + ( i + 1 ) * w );

}

// keyboard: the white-key band with the black keys cut out (even-odd). It is not drawn in the
// base art; only the light passing over it shows the keys, the black keys as gaps.
// ---- played keys: a random two thirds of the white keys (A0..C8, x 110..302) and of the black
// keys. Each lights up as a whole (uniform brightness); the motion comes from staggering them in
// time, white keys left -> right and black keys right -> left, within the keyboard phase.
const CYCLE = 5.35;									// s, whole loop
const KEY_PHASE = [ 0.0, 0.34 ];					// key start times, fraction of the cycle
const litKeys = ( () => {

	const x0 = 110, w = 192 / 52, letters = 'ABCDEFG', gap = 0.22, half = 1.15;
	let seed = 7;
	const rand = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	const pick = ( n, k ) => new Set( Array.from( { length: n }, ( _, i ) => [ rand(), i ] ).sort( ( p, q ) => p[ 0 ] - q[ 0 ] ).slice( 0, k ).map( p => p[ 1 ] ) );
	const blackAfter = i => i >= 0 && i < 51 && 'CDFGA'.includes( letters[ i % 7 ] );		// black key at the right edge of white key i
	const start = ( x, reverse ) => {

		const u = ( x - 110 ) / 192;
		return KEY_PHASE[ 0 ] + ( reverse ? 1 - u : u ) * ( KEY_PHASE[ 1 ] - KEY_PHASE[ 0 ] );

	};
	const keys = [];
	const white = pick( 52, Math.round( 52 * 2 / 3 ) );
	for ( let i = 0; i < 52; ++ i ) {

		if ( ! white.has( i ) ) continue;
		// outline notched around the neighbouring black keys
		const xa = x0 + i * w + ( i > 0 ? gap : 0 ), xb = x0 + ( i + 1 ) * w - ( i < 51 ? gap : 0 );
		const notchL = blackAfter( i - 1 ), notchR = blackAfter( i );
		const tl = notchL ? x0 + i * w + half : xa, tr = notchR ? x0 + ( i + 1 ) * w - half : xb;
		const pts = [ [ tl, 214 ], [ tr, 214 ] ];
		if ( notchR ) pts.push( [ tr, 229 ], [ xb, 229 ] );
		pts.push( [ xb, 238 ], [ xa, 238 ] );
		if ( notchL ) pts.push( [ xa, 229 ], [ tl, 229 ] );
		keys.push( { pts, start: start( ( xa + xb ) / 2, false ) } );

	}

	// black keys inset a little so a dark gap stays around them
	const black = pick( blackKeys.length, Math.round( blackKeys.length * 2 / 3 ) );
	blackKeys.forEach( ( x, i ) => {

		if ( ! black.has( i ) ) return;
		const a = x - half + 0.25, b = x + half - 0.25;
		keys.push( { pts: [ [ a, 214 ], [ b, 214 ], [ b, 228.5 ], [ a, 228.5 ] ], start: start( x, true ) } );

	} );
	return keys;

} )();
const f2 = v => v.toFixed( 2 );
const keyPath = k => 'M' + k.pts.map( p => f2( p[ 0 ] ) + ' ' + f2( p[ 1 ] ) ).join( ' L' ) + ' Z';
// each key's flash: quick rise, slower fade (fraction of the cycle)
const KEY_FLASH = `0% { opacity: 0 } 1.5% { opacity: 1 } 10%, 100% { opacity: 0 }`;

// overstrung strings: trebles rising to the bentside, basses crossing towards the tail
const strings = [
	'M200 204 L196 52', 'M220 204 L215 78', 'M240 204 L235 108', 'M260 204 L256 132', 'M280 204 L277 153',
	'M122 204 L168 40', 'M136 204 L186 44', 'M150 204 L203 60',
].join( ' ' );

// streamlines off the bentside, continuing to the right edge
const flowPaths = [
	'M168 20 C204 22 220 46 232 66 C254 104 282 130 306 152 C326 170 352 180 400 182',
	'M190 12 C226 16 242 40 256 62 C278 98 306 122 330 140 C350 154 372 160 400 160',
	'M214 6 C246 10 262 32 278 54 C300 86 326 106 350 120 C368 130 384 134 400 134',
];

// ---- body outline as a filled ribbon: thick and bright on the left (lit side), thin and dim
// on the right. SVG strokes can't vary in width, so the path is sampled and offset both ways.
function samplePath( d, step = 1 ) {

	const tok = d.match( /[MLC]|-?[\d.]+/g );
	const pts = [];
	let i = 0, cur = [ 0, 0 ], cmd;
	const num = () => parseFloat( tok[ i ++ ] );
	while ( i < tok.length ) {

		if ( /[MLC]/.test( tok[ i ] ) ) cmd = tok[ i ++ ];
		if ( cmd === 'M' ) {

			cur = [ num(), num() ];
			pts.push( cur );

		} else if ( cmd === 'L' ) {

			const p = [ num(), num() ];
			const n = Math.max( 1, Math.ceil( Math.hypot( p[ 0 ] - cur[ 0 ], p[ 1 ] - cur[ 1 ] ) / step ) );
			for ( let k = 1; k <= n; ++ k ) pts.push( [ cur[ 0 ] + ( p[ 0 ] - cur[ 0 ] ) * k / n, cur[ 1 ] + ( p[ 1 ] - cur[ 1 ] ) * k / n ] );
			cur = p;

		} else {

			const c1 = [ num(), num() ], c2 = [ num(), num() ], p = [ num(), num() ];
			for ( let k = 1; k <= 40; ++ k ) {

				const t = k / 40, u = 1 - t;
				pts.push( [ 0, 1 ].map( j => u * u * u * cur[ j ] + 3 * u * u * t * c1[ j ] + 3 * u * t * t * c2[ j ] + t * t * t * p[ j ] ) );

			}

			cur = p;

		}

	}

	return pts;

}

function ribbon( d, width ) {

	const P = samplePath( d );
	const L = [], R = [];
	for ( let k = 0; k < P.length; ++ k ) {

		const a = P[ Math.max( 0, k - 1 ) ], b = P[ Math.min( P.length - 1, k + 1 ) ];
		let tx = b[ 0 ] - a[ 0 ], ty = b[ 1 ] - a[ 1 ];
		const n = Math.hypot( tx, ty ) || 1;
		tx /= n; ty /= n;
		const w = width( P[ k ] ) / 2;
		L.push( [ P[ k ][ 0 ] - ty * w, P[ k ][ 1 ] + tx * w ] );
		R.push( [ P[ k ][ 0 ] + ty * w, P[ k ][ 1 ] - tx * w ] );

	}

	const f = p => p.map( v => v.toFixed( 2 ) ).join( ' ' );
	return 'M' + L.map( f ).join( ' L' ) + ' L' + R.reverse().map( f ).join( ' L' ) + ' Z';

}

// width: 5.2 on the bass side (x 112) tapering to 0 at the treble end (x 298)
const bodyWidth = ( [ x ] ) => 5.2 * Math.pow( 1 - Math.min( 1, Math.max( 0, ( x - 112 ) / 186 ) ), 1.1 );
const bodyRibbon = ribbon( body, bodyWidth );
const bodyFill = ( fill, opacity = 1 ) => `<path d="${ bodyRibbon }" fill="${ fill }" fill-opacity="${ opacity }"/>`;
const bodyGradient = `<linearGradient id="lit" gradientUnits="userSpaceOnUse" x1="112" y1="0" x2="298" y2="0"><stop offset="0" stop-color="${ IVORY }" stop-opacity=".8"/><stop offset=".55" stop-color="${ IVORY }" stop-opacity=".42"/><stop offset="1" stop-color="${ IVORY }" stop-opacity=".22"/></linearGradient>`;

// streamlines: from a point where they leave the piano, widening to the right (0 -> 1.9)
const flowWidth = ( [ x ] ) => 1.9 * Math.pow( Math.min( 1, Math.max( 0, ( x - 168 ) / 232 ) ), 1.3 );
const flowRibbon = flowPaths.map( d => ribbon( d, flowWidth ) ).join( ' ' );
const flowFill = ( fill, opacity = 1 ) => `<path d="${ flowRibbon }" fill="${ fill }" fill-opacity="${ opacity }"/>`;

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" width="${ W }" height="${ H }">${ inner }</svg>\n`;
const stroke = ( d, color, width, opacity = 1, cap = 'round' ) =>
	`<path d="${ d }" fill="none" stroke="${ color }" stroke-width="${ width }" stroke-opacity="${ opacity }" stroke-linecap="${ cap }" stroke-linejoin="round"/>`;

const baseInner = [
	flowFill( IVORY, 0.2 ),
	stroke( strings, IVORY, 0.8, 0.22 ),
	`<defs>${ bodyGradient }</defs>`,
	bodyFill( 'url(#lit)' ),
].join( '' );

fs.writeFileSync( path.join( out, 'base.svg' ), svg( baseInner ) );
// masks: opaque white strokes, a little wider than the drawn lines so the light reads as a glow
fs.writeFileSync( path.join( out, 'mask-strings.svg' ), svg( stroke( strings, '#fff', 1.6 ) ) );
for ( const old of [ 'mask-keys.svg', 'mask-black.svg' ] ) fs.rmSync( path.join( out, old ), { force: true } );

// timing + key outlines for the screen's power-on animation (pianoroll.js draws the same
// artwork into a canvas texture: base.svg, mask-strings.svg, mask-flow.svg and these keys)
fs.writeFileSync( path.join( out, 'anim.json' ), JSON.stringify( {
	width: W, height: H, cycle: CYCLE,
	keys: litKeys.map( k => ( { start: +k.start.toFixed( 4 ), pts: k.pts.map( p => p.map( v => +v.toFixed( 2 ) ) ) } ) ),
} ) );

// ---- the played keys, written into index.html between markers: one element per key, only its
// opacity animates (composited), positioned in % of the 400 x 280 artwork and cut with clip-path
{

	const html = path.join( out, '../../index.html' );
	const pct = ( v, of ) => ( 100 * v / of ).toFixed( 3 ) + '%';
	const items = litKeys.map( k => {

		const xs = k.pts.map( p => p[ 0 ] ), ys = k.pts.map( p => p[ 1 ] );
		const x0 = Math.min( ...xs ), x1 = Math.max( ...xs ), y0 = Math.min( ...ys ), y1 = Math.max( ...ys );
		const clip = k.pts.map( p => pct( p[ 0 ] - x0, x1 - x0 ) + ' ' + pct( p[ 1 ] - y0, y1 - y0 ) ).join( ',' );
		return `<b style="left:${ pct( x0, W ) };top:${ pct( y0, H ) };width:${ pct( x1 - x0, W ) };height:${ pct( y1 - y0, H ) };clip-path:polygon(${ clip });animation-delay:${ ( k.start * CYCLE ).toFixed( 3 ) }s"></b>`;

	} );
	const src = fs.readFileSync( html, 'utf8' );
	const re = /(<!-- keys:begin[^>]*-->)[\s\S]*?(<!-- keys:end -->)/;
	if ( ! re.test( src ) ) throw new Error( 'index.html: keys markers not found' );
	fs.writeFileSync( html, src.replace( re, `$1\n\t\t\t\t${ items.join( '\n\t\t\t\t' ) }\n\t\t\t\t$2` ) );

}
fs.writeFileSync( path.join( out, 'mask-flow.svg' ), svg( flowFill( '#fff' ) + bodyFill( '#fff' ) ) );

// ---- self-contained animated preview (same timing as index.html) ------------------------------
const preview = svg( `
<style>
	@keyframes key { ${ KEY_FLASH } }
	.key { opacity: 0; animation: key ${ CYCLE }s linear infinite backwards }
	@keyframes strings { 0%, 14% { transform: translateY(170px); opacity: 0 } 20%, 50% { opacity: 1 } 56%, 100% { transform: translateY(-40px); opacity: 0 } }
	@keyframes flow { 0%, 39% { transform: translateX(20px); opacity: 0 } 45%, 75% { opacity: 1 } 81%, 100% { transform: translateX(340px); opacity: 0 } }
	@keyframes breathe { 0%, 100% { opacity: .82 } 50% { opacity: 1 } }
	.s, .f { animation: ${ CYCLE }s cubic-bezier(.4,0,.6,1) infinite }
	.s { animation-name: strings } .f { animation-name: flow }
	.b { animation: breathe ${ CYCLE }s ease-in-out infinite }
</style>
<defs>
	<linearGradient id="gh" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${ AMBER }" stop-opacity="0"/><stop offset=".5" stop-color="${ AMBER }"/><stop offset="1" stop-color="${ AMBER }" stop-opacity="0"/></linearGradient>
	<linearGradient id="gv" x1="0" x2="0" y1="1" y2="0"><stop offset="0" stop-color="${ AMBER }" stop-opacity="0"/><stop offset=".5" stop-color="${ AMBER }"/><stop offset="1" stop-color="${ AMBER }" stop-opacity="0"/></linearGradient>
	<mask id="ms" maskUnits="userSpaceOnUse">${ stroke( strings, '#fff', 1.6 ) }</mask>
	<mask id="mf" maskUnits="userSpaceOnUse">${ flowFill( '#fff' ) }${ bodyFill( '#fff' ) }</mask>
</defs>
<rect width="${ W }" height="${ H }" fill="#0e0e0f"/>
<g class="b">${ baseInner }</g>
${ litKeys.map( k => `<path class="key" d="${ keyPath( k ) }" fill="${ AMBER }" style="animation-delay:${ ( k.start * CYCLE ).toFixed( 3 ) }s"/>` ).join( '' ) }
<g mask="url(#ms)"><rect class="s" x="100" y="0" width="200" height="120" fill="url(#gv)"/></g>
<g mask="url(#mf)"><rect class="f" x="0" y="0" width="160" height="${ H }" fill="url(#gh)"/></g>
` );
fs.writeFileSync( path.join( out, 'preview.svg' ), preview );
console.log( 'wrote', fs.readdirSync( out ).join( ', ' ) );

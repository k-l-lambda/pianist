// Adjustable piano bench (duet size), after the usual concert model: four square tapered legs and
// aprons in the piano's lacquer, a storage box with a height knob each side, a tufted leather
// cushion on top (buttons in a diamond pattern), the scissor lift between frame and box.
// Dimensions in metres; local frame: x across (the keyboard's width), y up from the floor, z
// towards the player's back (the keyboard at -z), its centre at the origin.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const W = 0.76, D = 0.36;			// cushion

// Tileable normal map of leather grain: pebbles (cells of a jittered grid, domed, with creases
// between), a few per centimetre at the cushion's UV repeat
let _grain = null;
function leatherGrain() {

	if ( _grain ) return _grain;
	const N = 256, G = 24, pts = [];
	let seed = 7;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( let j = 0; j < G; ++ j ) for ( let i = 0; i < G; ++ i ) pts.push( [ ( i + rnd() ) / G, ( j + rnd() ) / G ] );
	const h = new Float32Array( N * N );
	for ( let y = 0; y < N; ++ y ) for ( let x = 0; x < N; ++ x ) {

		const u = x / N, v = y / N, ci = Math.floor( u * G ), cj = Math.floor( v * G );
		let d1 = 9, d2 = 9;
		for ( let dj = - 1; dj <= 1; ++ dj ) for ( let di = - 1; di <= 1; ++ di ) {

			const p = pts[ ( ( cj + dj + G ) % G ) * G + ( ci + di + G ) % G ];
			let dx = Math.abs( u - p[ 0 ] ), dy = Math.abs( v - p[ 1 ] );
			dx = Math.min( dx, 1 - dx ); dy = Math.min( dy, 1 - dy );
			const d = Math.hypot( dx, dy );
			if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;

		}

		h[ y * N + x ] = Math.min( 1, ( d2 - d1 ) * G * 1.6 );		// 0 in the creases, up on the pebbles

	}

	const data = new Uint8Array( 4 * N * N ), at = ( x, y ) => h[ ( ( y + N ) % N ) * N + ( x + N ) % N ];
	for ( let y = 0; y < N; ++ y ) for ( let x = 0; x < N; ++ x ) {

		const dx = ( at( x + 1, y ) - at( x - 1, y ) ) * 1.5, dy = ( at( x, y + 1 ) - at( x, y - 1 ) ) * 1.5, l = Math.hypot( dx, dy, 1 ), k = 4 * ( y * N + x );
		data[ k ] = Math.round( 255 * ( 0.5 - 0.5 * dx / l ) );
		data[ k + 1 ] = Math.round( 255 * ( 0.5 - 0.5 * dy / l ) );
		data[ k + 2 ] = Math.round( 255 * ( 0.5 + 0.5 / l ) );
		data[ k + 3 ] = 255;

	}

	_grain = new THREE.DataTexture( data, N, N );
	_grain.wrapS = _grain.wrapT = THREE.RepeatWrapping;
	_grain.repeat.set( 12, 6 );
	_grain.magFilter = THREE.LinearFilter;
	_grain.minFilter = THREE.LinearMipmapLinearFilter;
	_grain.generateMipmaps = true;
	_grain.needsUpdate = true;
	return _grain;

}
const FRAME_TOP = 0.36;				// legs and aprons
const BOX_BOTTOM = 0.405, BOX_TOP = 0.475;	// the storage box, lifted on the scissors
const SEAT = 0.53;					// top of the cushion

/**
 * @param {THREE.Material} lacquer the piano's case material (legs, aprons, box)
 * @param {{ dark: boolean }} opts dark: a black piano (black leather, black knobs); else white
 */
export function buildBench( lacquer, { dark = true } = {} ) {

	const group = new THREE.Group();
	group.name = 'bench';
	// leather: a grained base under a glossy finish (the coat follows the grain too). Black hide
	// diffuses very little: nearly black, the shine all from the coat; no sheen (its grey rim
	// made the black read as grey under the top light)
	const grain = leatherGrain();
	const leather = new THREE.MeshPhysicalMaterial( {
		// (black: the base's own broad specular cut down too, or under the top light it is a grey haze)
		color: dark ? '#040405' : '#bdb8ae', roughness: dark ? 0.55 : 0.5, specularIntensity: dark ? 0.25 : 1, normalMap: grain, normalScale: new THREE.Vector2( 0.4, 0.4 ),
		clearcoat: 1, clearcoatRoughness: dark ? 0.12 : 0.2, clearcoatNormalMap: grain, clearcoatNormalScale: new THREE.Vector2( 0.08, 0.08 ),
	} );
	const button = new THREE.MeshPhysicalMaterial( { color: dark ? '#060607' : '#ddd8cf', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 } );		// covered in the same leather
	const knobMat = new THREE.MeshPhysicalMaterial( { color: dark ? '#111112' : '#e9dfc9', roughness: 0.4 } );
	const metal = new THREE.MeshStandardMaterial( { color: '#1b1b1d', metalness: 0.8, roughness: 0.45 } );
	const rubber = new THREE.MeshStandardMaterial( { color: '#111111', roughness: 0.9 } );

	const mesh = ( geo, mat ) => {

		const m = new THREE.Mesh( geo, mat );
		m.castShadow = m.receiveShadow = true;
		group.add( m );
		return m;

	};
	const rbox = ( w, h, d, r, x, y, z ) => new RoundedBoxGeometry( w, h, d, 2, r ).translate( x, y, z ).toNonIndexed();

	// legs: square, tapering towards the floor, set in from the box's corners
	const lacq = [];
	const lx = W / 2 - 0.06, lz = D / 2 - 0.045;
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const leg = new THREE.CylinderGeometry( 0.024 * Math.SQRT2, 0.019 * Math.SQRT2, FRAME_TOP, 4, 1 ).rotateY( Math.PI / 4 ).translate( sx * lx, FRAME_TOP / 2, sz * lz );
		lacq.push( leg.toNonIndexed() );
		mesh( new THREE.CylinderGeometry( 0.016, 0.016, 0.008, 12 ).translate( sx * lx, 0.004, sz * lz ), rubber );

	}

	// aprons between the legs, a rail across inside
	lacq.push( rbox( 2 * lx + 0.03, 0.075, 0.022, 0.006, 0, FRAME_TOP - 0.0375, lz ) );
	lacq.push( rbox( 2 * lx + 0.03, 0.075, 0.022, 0.006, 0, FRAME_TOP - 0.0375, - lz ) );
	for ( const sx of [ - 1, 1 ] ) lacq.push( rbox( 0.022, 0.075, 2 * lz, 0.006, sx * lx, FRAME_TOP - 0.0375, 0 ) );
	// the box, slightly wider than the frame, its sides wrapping the knobs' axle
	lacq.push( rbox( W - 0.01, BOX_TOP - BOX_BOTTOM, D - 0.01, 0.01, 0, ( BOX_TOP + BOX_BOTTOM ) / 2, 0 ) );
	mesh( mergeGeometries( lacq ), lacquer );

	// scissor lift: two crossed bars at each end, under the box
	const bars = [];
	for ( const sx of [ - 1, 1 ] ) for ( const t of [ - 1, 1 ] ) {

		const len = Math.hypot( 0.2, BOX_BOTTOM - FRAME_TOP );
		const bar = new THREE.BoxGeometry( 0.012, len, 0.006 ).rotateX( t * Math.atan2( 0.2, BOX_BOTTOM - FRAME_TOP ) )
			.translate( sx * ( lx - 0.06 ), ( FRAME_TOP + BOX_BOTTOM ) / 2, t * 0.004 );
		bars.push( bar.toNonIndexed() );

	}

	mesh( mergeGeometries( bars ), metal );

	// cushion: a rounded slab, its top tufted (pulled down at the buttons, in two staggered rows)
	const cushion = new RoundedBoxGeometry( W, SEAT - BOX_TOP, D, 4, 0.022 );
	const tufts = [];
	for ( let r = 0; r < 2; ++ r ) for ( let k = 0; k < 5 - r; ++ k ) tufts.push( [ - W / 2 + W * ( k + 1 + r * 0.5 ) / ( 6 ), ( r ? 0.07 : - 0.07 ) ] );
	{

		// enough vertices on the top for the dimples: subdivide by re-tessellating a plane there
		const top = new THREE.PlaneGeometry( W - 0.044, D - 0.044, 48, 24 ).rotateX( - Math.PI / 2 );
		const pos = top.attributes.position;
		for ( let i = 0; i < pos.count; ++ i ) {

			const x = pos.getX( i ), z = pos.getZ( i );
			let dip = 0;
			for ( const [ bx, bz ] of tufts ) dip = Math.max( dip, Math.exp( - ( ( x - bx ) ** 2 + ( z - bz ) ** 2 ) / ( 2 * 0.022 ** 2 ) ) );
			// a little crown in the middle of the seat, pulled down at the buttons
			const crown = 0.006 * ( 1 - ( 2 * x / W ) ** 4 ) * ( 1 - ( 2 * z / D ) ** 4 );
			pos.setY( i, SEAT - BOX_TOP + crown - 0.012 * dip );		// level with the box's top at its edges

		}

		top.computeVertexNormals();
		cushion.translate( 0, ( SEAT - BOX_TOP ) / 2, 0 );
		// the rounded slab without its flat top (the tufted surface replaces it: left in, it showed
		// through the dimples as flat discs)
		const slab = cushion.toNonIndexed(), sp = slab.attributes.position, keep = [], ht = SEAT - BOX_TOP;
		const inTop = k => sp.getY( k ) > ht - 1e-4 && Math.abs( sp.getX( k ) ) < W / 2 - 0.022 + 1e-4 && Math.abs( sp.getZ( k ) ) < D / 2 - 0.022 + 1e-4;
		for ( let k = 0; k < sp.count; k += 3 ) if ( ! ( inTop( k ) && inTop( k + 1 ) && inTop( k + 2 ) ) ) keep.push( k, k + 1, k + 2 );
		const side = new THREE.BufferGeometry();
		for ( const name of Object.keys( slab.attributes ) ) {

			const a = slab.attributes[ name ], arr = new Float32Array( keep.length * a.itemSize );
			keep.forEach( ( k, j ) => { for ( let c = 0; c < a.itemSize; ++ c ) arr[ j * a.itemSize + c ] = a.array[ k * a.itemSize + c ]; } );
			side.setAttribute( name, new THREE.BufferAttribute( arr, a.itemSize ) );

		}

		mesh( mergeGeometries( [ side, top.toNonIndexed() ] ).translate( 0, BOX_TOP, 0 ), leather );
		const btn = [];
		for ( const [ bx, bz ] of tufts ) btn.push( new THREE.SphereGeometry( 0.0075, 10, 6 ).scale( 1, 0.6, 1 ).translate( bx, SEAT - 0.016, bz ).toNonIndexed() );
		mesh( mergeGeometries( btn ), button );

	}

	// the height knobs, one each end of the box: ribbed discs on short axles
	for ( const sx of [ - 1, 1 ] ) {

		const knob = new THREE.CylinderGeometry( 0.032, 0.032, 0.03, 24, 1 );
		const p = knob.attributes.position;
		for ( let i = 0; i < p.count; ++ i ) {

			const a = Math.atan2( p.getZ( i ), p.getX( i ) ), rr = Math.hypot( p.getX( i ), p.getZ( i ) );
			if ( rr > 0.03 ) {

				const k = 1 + 0.06 * Math.cos( 12 * a );
				p.setX( i, p.getX( i ) * k );
				p.setZ( i, p.getZ( i ) * k );

			}

		}

		knob.computeVertexNormals();
		knob.rotateZ( Math.PI / 2 ).translate( sx * ( W / 2 + 0.012 ), ( BOX_TOP + BOX_BOTTOM ) / 2, 0.02 );
		mesh( knob, knobMat );
		mesh( new THREE.CylinderGeometry( 0.015, 0.018, 0.012, 16 ).rotateZ( Math.PI / 2 ).translate( sx * ( W / 2 - 0.004 ), ( BOX_TOP + BOX_BOTTOM ) / 2, 0.02 ), knobMat );

	}

	return group;

}

export const BENCH = { width: W, depth: D, seat: SEAT };

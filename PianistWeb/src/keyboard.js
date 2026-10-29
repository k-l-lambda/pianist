// 88-key keyboard. Proportions follow the Unity project
// (Pianist Mobile/Assets/Resources/Meshes/key*.prefab, Scripts/Pianist/Piano.cs):
// white key pitch 2.35 units, black key 1.0 wide / 1.2 high starting 5.2 behind the white front,
// white visible 15 long.
// 1 Unity unit ≈ 1 cm; here everything is in meters.

import * as THREE from 'three';
import { merge } from './geometry.js';

export const PITCH_MIN = 21;
export const PITCH_MAX = 108;

export const WHITE_PITCH = 0.02350;			// center-to-center of white keys
const WHITE_GAP = 0.0010;
const WHITE_HEIGHT = 0.0220;
const WHITE_FRONT_LEN = 0.0500;				// full-width front (head) part
export const WHITE_VISIBLE = 0.1500;		// key front to fallboard
export const WHITE_TOTAL = 0.2155;			// including the part under the name rail (Unity: 21.55)
// black key, after Unity key_b.prefab (heights h measured from the white key top)
const BLACK_WIDTH = 0.0100;					// at the base (x ±0.5)
const BLACK_TOP_WIDTH = 0.0090;				// top face (x ±0.45): sides lean in -> trapezoid front
const BLACK_HEIGHT = 0.0120;				// above white key top
const BLACK_FRONT = 0.0520;					// front face foot, behind the white key front (z 5.2)
const BLACK_SHOULDER = 0.00911;				// top of the straight slanted front face (y 0.911)
const BLACK_FRONT_SLOPE = Math.atan2( 0.00646, 0.00911 );	// ≈ 35° from vertical (z 5.2 -> 5.846)
const BLACK_TOP_FRONT = 0.06066;			// front of the top face at the center (z 6.066)
const BLACK_ARCH_RX = 0.0026;				// front-view arch: flat top only ±1.9 mm wide
const BLACK_ARCH_RD = 0.00334;				// arch corners reach back to z 6.4
const BLACK_RAISED_END = 0.1475;			// raised part ends under the name-rail felt (z 14.75)
const BLACK_ROOT_STEP = 0.1875;				// root narrows to ±3.56 here (z 18.75)
const WHITE_NOTCH_GAP = 0.0009;				// white tail notch to black key side
// Key pivot as in the Unity prefabs (KeyGroup.prefab: each key transform sits at
// (0, -0.42, 20.31) relative to its mesh; PianoController.AngleMax = -2.6°):
// the key rotates about an axis near its root, 203.1 mm behind the front edge
// and 4.2 mm below the white key top.
const PIVOT_BACK = 0.2031;
const PIVOT_BELOW_TOP = 0.0042;
const ANGLE_MAX = 2.6 * Math.PI / 180;		// ≈ 9.2 mm front-edge dip

// black key offsets (in white key units, from the C center) – Piano.cs GroupKeyPositions
const GROUP_POSITIONS = [ 0, 0.38, 1, 1.62, 2, 3, 3.37, 4, 4.50, 5, 5.63, 6 ];
const BLACK_STEPS = new Set( [ 1, 3, 6, 8, 10 ] );

export const isBlack = pitch => BLACK_STEPS.has( pitch % 12 );

/** Key center x in white-key units; boundary E4|F4 is the keyboard median. */
export function pitchPosition( pitch ) {

	return Math.floor( pitch / 12 ) * 7 + GROUP_POSITIONS[ pitch % 12 ] - 37.5;

}

export const pitchX = pitch => pitchPosition( pitch ) * WHITE_PITCH;

export const KEYBOARD_HALF_WIDTH = ( pitchX( PITCH_MAX ) - pitchX( PITCH_MIN ) ) / 2 + WHITE_PITCH / 2;

function whiteKeyShape( pitch ) {

	const half = WHITE_PITCH / 2 - WHITE_GAP / 2;
	const cx = pitchX( pitch );
	let left = - half, right = half;
	// rear (tail) part is narrowed by neighbouring black keys
	const cut = BLACK_WIDTH / 2 + WHITE_NOTCH_GAP;
	if ( pitch > PITCH_MIN && isBlack( pitch - 1 ) ) left = pitchX( pitch - 1 ) - cx + cut;
	if ( pitch < PITCH_MAX && isBlack( pitch + 1 ) ) right = pitchX( pitch + 1 ) - cx - cut;

	// shape in (x, -z) so that +y of the shape points towards the back of the key
	const s = new THREE.Shape();
	s.moveTo( - half, 0 );
	s.lineTo( half, 0 );
	s.lineTo( half, WHITE_FRONT_LEN );
	s.lineTo( right, WHITE_FRONT_LEN );
	s.lineTo( right, WHITE_TOTAL );
	s.lineTo( left, WHITE_TOTAL );
	s.lineTo( left, WHITE_FRONT_LEN );
	s.lineTo( - half, WHITE_FRONT_LEN );
	s.lineTo( - half, 0 );
	return s;

}

function whiteKeyGeometry( pitch ) {

	const bevel = 0.0009;
	const geo = new THREE.ExtrudeGeometry( whiteKeyShape( pitch ), {
		depth: WHITE_HEIGHT - 2 * bevel,
		bevelEnabled: true,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: - bevel,
		bevelSegments: 3,
		curveSegments: 1,
	} );
	// shape (x, y, z) -> world (x, z, -y): rotate -90° about x
	geo.rotateX( - Math.PI / 2 );
	geo.translate( 0, bevel, 0 );		// key bottom at y = 0, top at WHITE_HEIGHT

	// uv: position on the whole keyboard, for the baked occlusion map (see bakeKeyAO)
	const pos = geo.attributes.position;
	const uv = new Float32Array( pos.count * 2 );
	const cx = pitchX( pitch );
	for ( let i = 0; i < pos.count; ++ i ) {

		uv[ 2 * i ] = ( cx + pos.getX( i ) + KEYBOARD_HALF_WIDTH ) / ( 2 * KEYBOARD_HALF_WIDTH );
		uv[ 2 * i + 1 ] = - pos.getZ( i ) / AO_DEPTH;

	}

	geo.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
	return geo;

}

// --- occlusion of the white keys by the black keys, the fallboard and the cheeks ------------
const AO_DEPTH = WHITE_VISIBLE;

const KEY_AO_GLSL = /* glsl */`
	precision highp float;
	varying vec2 vUv;
	uniform float halfWidth;
	uniform float depth;
	uniform float blackX[ 36 ];
	uniform vec3 blackMin;		// relative to a black key centre, y from the white key top
	uniform vec3 blackMax;
	uniform float wallZ;		// fallboard / name rail front and its height above the keys
	uniform float wallH;
	uniform float cheekH;

	float slab( vec3 o, vec3 d, vec3 bmin, vec3 bmax ) {
		vec3 inv = 1.0 / d;
		vec3 t0 = ( bmin - o ) * inv, t1 = ( bmax - o ) * inv;
		vec3 tn = min( t0, t1 ), tf = max( t0, t1 );
		float a = max( max( tn.x, tn.y ), tn.z ), b = min( min( tf.x, tf.y ), tf.z );
		return ( b > max( a, 0.0 ) ) ? 1.0 : 0.0;
	}

	void main() {
		// point on the white key top: x across the keyboard, z towards the back (negative)
		vec3 p = vec3( ( vUv.x * 2.0 - 1.0 ) * halfWidth, 0.0002, - vUv.y * depth );
		float vis = 0.0;
		const int N = 64;
		for ( int i = 0; i < N; ++ i ) {
			// cosine-weighted hemisphere (Hammersley)
			float u1 = ( float( i ) + 0.5 ) / float( N );
			float u2 = fract( float( i ) * 0.618034 );
			float r = sqrt( u1 ), phi = 6.2831853 * u2;
			vec3 d = vec3( r * cos( phi ), sqrt( 1.0 - u1 ), r * sin( phi ) );
			d += sign( d ) * 1e-5;
			float hit = 0.0;
			for ( int k = 0; k < 36; ++ k ) {
				float bx = blackX[ k ];
				if ( abs( bx - p.x ) > 0.09 ) continue;
				hit = max( hit, slab( p, d, blackMin + vec3( bx, 0.0, 0.0 ), blackMax + vec3( bx, 0.0, 0.0 ) ) );
			}
			// fallboard: a wall wallH high across the back
			if ( d.z < 0.0 ) {
				float t = ( wallZ - p.z ) / d.z;
				if ( p.y + d.y * t < wallH ) hit = 1.0;
			}
			// cheeks / arms at the keyboard ends
			if ( abs( d.x ) > 1e-4 ) {
				float t = ( sign( d.x ) * halfWidth - p.x ) / d.x;
				if ( t > 0.0 && p.y + d.y * t < cheekH ) hit = 1.0;
			}
			vis += 1.0 - hit;
		}
		gl_FragColor = vec4( vis / float( N ), 0.0, 0.0, 1.0 );
	}
`;

/** Bake the white-key occlusion map (uv = position on the keyboard, see whiteKeyGeometry). */
export function bakeKeyAO( baker ) {

	const xs = [];
	for ( let p = PITCH_MIN; p <= PITCH_MAX; ++ p ) if ( isBlack( p ) ) xs.push( pitchX( p ) );
	return baker.bakeShader( 'keyAO', KEY_AO_GLSL, {
		halfWidth: KEYBOARD_HALF_WIDTH,
		depth: AO_DEPTH,
		blackX: xs,
		blackMin: new THREE.Vector3( - BLACK_WIDTH / 2, 0, - BLACK_RAISED_END ),
		blackMax: new THREE.Vector3( BLACK_WIDTH / 2, BLACK_HEIGHT, - BLACK_FRONT ),
		wallZ: - WHITE_VISIBLE,
		wallH: 0.05,
		cheekH: 0.035,
	}, { width: 4096, height: 256 } );

}

// deterministic per-key manufacturing tolerance (sub-millimetre), as in a real action
function keyJitter( pitch, k ) {

	const v = Math.sin( pitch * 12.9898 + k * 78.233 ) * 43758.5453;
	return ( v - Math.floor( v ) ) * 2 - 1;

}

let blackGeoCache = null;

/**
 * Black key as a loft of plan-view rings stacked in height, in the same key-local frame as the
 * white keys (white bottom y = 0, key front z = 0, keys extend towards -z):
 *  - front face leans back ~35° up to the shoulder, then rolls over into the top face
 *  - sides lean in from 10 mm to 9 mm (trapezoid seen from the front)
 *  - the front corners round off more and more towards the top, so the top edge of the
 *    front face is an arch (sides end at the shoulder, the middle reaches the top)
 *  - the top face drops 1 mm towards the back; behind the name rail the key steps down
 */
function blackKeyGeometry() {

	if ( blackGeoCache ) return blackGeoCache;

	const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;
	const H = BLACK_HEIGHT;
	const tanS = Math.tan( BLACK_FRONT_SLOPE );
	const hw = h => lerp( BLACK_WIDTH / 2, BLACK_TOP_WIDTH / 2, clamp( h / H, 0, 1 ) );
	const chamfer = 0.0005;
	const lower = h => ( { h, hw: hw( h ), df: BLACK_FRONT + Math.max( h, 0 ) * tanS, rx: chamfer, rd: chamfer } );

	// front roll-over: quadratic Bézier in (d, h), tangent to the slope at the shoulder, flat at the top
	const dS = BLACK_FRONT + BLACK_SHOULDER * tanS;
	const P0 = [ dS, BLACK_SHOULDER ], P1 = [ dS + ( H - BLACK_SHOULDER ) * tanS, H ], P2 = [ BLACK_TOP_FRONT, H ];
	const roll = [];
	const N = 8;
	for ( let k = 1; k <= N; ++ k ) {

		const t = k / N, u = 1 - t;
		const d = u * u * P0[ 0 ] + 2 * u * t * P1[ 0 ] + t * t * P2[ 0 ];
		const h = u * u * P0[ 1 ] + 2 * u * t * P1[ 1 ] + t * t * P2[ 1 ];
		const a = Math.pow( t, 1.5 );
		roll.push( { h, hw: hw( h ), df: d, rx: lerp( chamfer, BLACK_ARCH_RX, a ), rd: lerp( chamfer, BLACK_ARCH_RD, a ) } );

	}

	const CS = 6;
	const yOf = ( d, h ) => WHITE_HEIGHT + h - clamp( ( d - 0.064 ) / ( BLACK_RAISED_END - 0.064 ), 0, 1 ) * 0.001 * clamp( h / H, 0, 1 );

	// plan outline: back-right -> right side -> front (with rounded corners) -> left side -> back-left
	function ringPoints( r ) {

		const pts = [ [ r.hw, BLACK_RAISED_END ] ];
		for ( let k = 0; k <= CS; ++ k ) {

			const a = k / CS * Math.PI / 2;
			pts.push( [ r.hw - r.rx + r.rx * Math.cos( a ), r.df + r.rd - r.rd * Math.sin( a ) ] );

		}

		for ( let k = 0; k <= CS; ++ k ) {

			const a = Math.PI / 2 + k / CS * Math.PI / 2;
			pts.push( [ - ( r.hw - r.rx ) + r.rx * Math.cos( a ), r.df + r.rd - r.rd * Math.sin( a ) ] );

		}

		pts.push( [ - r.hw, BLACK_RAISED_END ] );
		return pts.map( ( [ x, d ] ) => new THREE.Vector3( x, yOf( d, r.h ), - d ) );

	}

	// smooth strip between rings (one geometry per strip keeps creases between strips)
	function strip( rings ) {

		const rows = rings.map( ringPoints );
		const n = rows[ 0 ].length;
		const pos = [], idx = [];
		rows.forEach( row => row.forEach( p => pos.push( p.x, p.y, p.z ) ) );
		for ( let i = 0; i + 1 < rows.length; ++ i ) {

			for ( let j = 0; j + 1 < n; ++ j ) {

				const a = i * n + j, b = i * n + j + 1, c = ( i + 1 ) * n + j + 1, d = ( i + 1 ) * n + j;
				idx.push( a, d, c, a, c, b );

			}

		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
		geo.setIndex( idx );
		geo.computeVertexNormals();
		return { geo, rows };

	}

	const base = strip( [ lower( - 0.018 ), lower( 0 ) ] );			// below the white key top
	const body = strip( [ lower( 0 ), lower( BLACK_SHOULDER / 2 ), lower( BLACK_SHOULDER ), ...roll ] );

	// top face: fan over the last ring
	const topRow = body.rows[ body.rows.length - 1 ];
	const c = topRow.reduce( ( s, p ) => s.add( p ), new THREE.Vector3() ).divideScalar( topRow.length );
	const capPos = [];
	for ( let j = 0; j < topRow.length; ++ j ) {

		const p = topRow[ j ], q = topRow[ ( j + 1 ) % topRow.length ];
		capPos.push( c.x, c.y, c.z, q.x, q.y, q.z, p.x, p.y, p.z );

	}

	const cap = new THREE.BufferGeometry();
	cap.setAttribute( 'position', new THREE.Float32BufferAttribute( capPos, 3 ) );
	cap.computeVertexNormals();

	// back face of the raised part
	const backPos = [];
	const allRows = [ ...base.rows, ...body.rows ];
	for ( let i = 0; i + 1 < allRows.length; ++ i ) {

		const a = allRows[ i ].at( - 1 ), b = allRows[ i ][ 0 ], cc = allRows[ i + 1 ][ 0 ], d = allRows[ i + 1 ].at( - 1 );
		backPos.push( a.x, a.y, a.z, cc.x, cc.y, cc.z, b.x, b.y, b.z, a.x, a.y, a.z, d.x, d.y, d.z, cc.x, cc.y, cc.z );

	}

	const back = new THREE.BufferGeometry();
	back.setAttribute( 'position', new THREE.Float32BufferAttribute( backPos, 3 ) );
	back.computeVertexNormals();

	// root under the name rail: steps down to the white key top, then narrows (hidden)
	const box = ( x, d0, d1, y0, y1 ) => new THREE.BoxGeometry( 2 * x, y1 - y0, d1 - d0 ).translate( 0, ( y0 + y1 ) / 2, - ( d0 + d1 ) / 2 );
	const yb = WHITE_HEIGHT - 0.018;
	const rear = box( BLACK_WIDTH / 2, BLACK_RAISED_END, BLACK_ROOT_STEP, yb, WHITE_HEIGHT );
	const tail = box( 0.00356, BLACK_ROOT_STEP, WHITE_TOTAL, yb, WHITE_HEIGHT );

	blackGeoCache = merge( [ base.geo, body.geo, cap, back, rear, tail ] );
	return blackGeoCache;

}

export class Keyboard {

	/**
	 * @param {object} materials { white, black }
	 * Local frame: key fronts at z = 0, keys extend to -z, key bottoms at y = 0.
	 */
	constructor( materials ) {

		this.group = new THREE.Group();
		this.group.name = 'keyboard';
		this.keys = new Map();			// pitch -> { pivot, mesh, depth, target }
		this.pickables = [];

		for ( let pitch = PITCH_MIN; pitch <= PITCH_MAX; ++ pitch ) {

			const black = isBlack( pitch );
			const pivot = new THREE.Group();
			const pivotY = WHITE_HEIGHT - PIVOT_BELOW_TOP;
			// up to ±0.3 mm sideways / in depth, ±0.25 mm in height, small yaw and roll
			pivot.position.set(
				pitchX( pitch ) + 0.0003 * keyJitter( pitch, 0 ),
				pivotY + 0.00025 * keyJitter( pitch, 1 ),
				- PIVOT_BACK + 0.0003 * keyJitter( pitch, 2 ) );
			pivot.rotation.y = 0.0015 * keyJitter( pitch, 3 );
			pivot.rotation.z = 0.004 * keyJitter( pitch, 4 );

			let mesh;
			if ( black ) {

				mesh = new THREE.Mesh( blackKeyGeometry(), materials.black );
				mesh.position.set( 0, - pivotY, PIVOT_BACK );

			} else {

				mesh = new THREE.Mesh( whiteKeyGeometry( pitch ), materials.white );
				mesh.position.set( 0, - pivotY, PIVOT_BACK );

			}

			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.userData.pitch = pitch;
			pivot.add( mesh );
			this.group.add( pivot );
			this.pickables.push( mesh );
			this.keys.set( pitch, { pivot, mesh, depth: 0, target: 0 } );

		}

		this.maxAngle = ANGLE_MAX;
		this.changed = false;

	}

	press( pitch, velocity = 1 ) {

		const key = this.keys.get( pitch );
		if ( ! key ) return;
		// keys always reach the key bed; velocity (0..1, MIDI velocity / 127) sets how fast:
		// ~100 ms to the bottom for pp, ~20 ms for ff
		key.target = 1;
		key.rate = THREE.MathUtils.lerp( 12, 110, THREE.MathUtils.clamp( velocity, 0, 1 ) );

	}

	release( pitch ) {

		const key = this.keys.get( pitch );
		if ( key ) key.target = 0;

	}

	/** Returns true while any key is moving. */
	update( dt ) {

		let moving = false;
		for ( const key of this.keys.values() ) {

			if ( key.depth === key.target ) continue;
			const rate = key.target > key.depth ? ( key.rate ?? 60 ) : 22;
			key.depth += ( key.target - key.depth ) * Math.min( 1, dt * rate );
			if ( Math.abs( key.target - key.depth ) < 1e-3 ) key.depth = key.target;
			key.pivot.rotation.x = key.depth * this.maxAngle;
			moving = true;

		}

		return moving;

	}

	dispose() {

		for ( const key of this.keys.values() ) {

			if ( key.mesh.geometry !== blackGeoCache ) key.mesh.geometry.dispose();

		}

	}

}

// 88-key keyboard. Proportions follow the Unity project
// (Pianist Mobile/Assets/Resources/Meshes/key*.prefab, Scripts/Pianist/Piano.cs):
// white key pitch 2.35 units, black key 1.0 wide / 9.55 long / 1.2 high, white visible 15 long.
// 1 Unity unit ≈ 1 cm; here everything is in meters.

import * as THREE from 'three';

export const PITCH_MIN = 21;
export const PITCH_MAX = 108;

export const WHITE_PITCH = 0.02350;			// center-to-center of white keys
const WHITE_GAP = 0.0010;
const WHITE_HEIGHT = 0.0220;
const WHITE_FRONT_LEN = 0.0500;				// full-width front (head) part
export const WHITE_VISIBLE = 0.1500;		// key front to fallboard
export const WHITE_TOTAL = 0.2400;			// including the part under the name rail
const BLACK_WIDTH_BOTTOM = 0.0118;
const BLACK_WIDTH_TOP = 0.0092;
const BLACK_HEIGHT = 0.0120;				// above white key top
const BLACK_FRONT = WHITE_FRONT_LEN + 0.0020;
export const KEY_DEPRESS = 0.0100;			// front-edge travel when fully pressed
const PIVOT_BACK = 0.36;					// pivot distance behind key front (balance rail)

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
	const cut = BLACK_WIDTH_BOTTOM / 2 + WHITE_GAP / 2;
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
	return geo;

}

let blackGeoCache = null;
function blackKeyGeometry() {

	if ( blackGeoCache ) return blackGeoCache;

	// side profile in (z, y): z from 0 (front) towards the back (negative world z)
	const len = WHITE_VISIBLE - BLACK_FRONT + 0.07;		// continues under the name rail
	const top = WHITE_HEIGHT + BLACK_HEIGHT;
	const s = new THREE.Shape();
	s.moveTo( 0, 0.004 );
	s.lineTo( 0.0005, top - 0.006 );
	s.quadraticCurveTo( 0.0008, top, 0.0045, top );		// front top rounding
	s.lineTo( len, top );
	s.lineTo( len, 0.004 );
	s.lineTo( 0, 0.004 );

	const bevel = 0.0008;
	const geo = new THREE.ExtrudeGeometry( s, {
		depth: BLACK_WIDTH_BOTTOM - 2 * bevel,
		bevelEnabled: true,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: - bevel,
		bevelSegments: 3,
		curveSegments: 6,
	} );
	// shape (sx=z_back, sy=y, ez=width) -> world (x=ez, y=sy, z=-sx): rotate +90° about y
	geo.rotateY( Math.PI / 2 );
	geo.translate( - BLACK_WIDTH_BOTTOM / 2 + bevel, 0, 0 );

	// taper: narrower at the top
	const pos = geo.attributes.position;
	for ( let i = 0; i < pos.count; ++ i ) {

		const y = pos.getY( i );
		const t = THREE.MathUtils.clamp( ( y - 0.004 ) / ( top - 0.004 ), 0, 1 );
		const w = THREE.MathUtils.lerp( 1, BLACK_WIDTH_TOP / BLACK_WIDTH_BOTTOM, t * t );
		pos.setX( i, pos.getX( i ) * w );

	}

	geo.computeVertexNormals();
	blackGeoCache = geo;
	return geo;

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
			pivot.position.set( pitchX( pitch ), 0, - PIVOT_BACK );

			let mesh;
			if ( black ) {

				mesh = new THREE.Mesh( blackKeyGeometry(), materials.black );
				mesh.position.set( 0, 0, PIVOT_BACK - BLACK_FRONT );

			} else {

				mesh = new THREE.Mesh( whiteKeyGeometry( pitch ), materials.white );
				mesh.position.set( 0, 0, PIVOT_BACK );

			}

			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.userData.pitch = pitch;
			pivot.add( mesh );
			this.group.add( pivot );
			this.pickables.push( mesh );
			this.keys.set( pitch, { pivot, mesh, depth: 0, target: 0 } );

		}

		this.maxAngle = Math.atan2( KEY_DEPRESS, PIVOT_BACK );
		this.changed = false;

	}

	press( pitch, velocity = 1 ) {

		const key = this.keys.get( pitch );
		if ( key ) key.target = Math.min( 1, 0.75 + 0.25 * velocity );

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
			const rate = key.target > key.depth ? 60 : 22;
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

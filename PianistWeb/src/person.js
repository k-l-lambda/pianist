// The person holding the phone in handheld mode: a flattened, stylised figure standing behind
// the camera, seen only in reflections (glossy screen, lacquer, glass) and, in path tracing,
// as real geometry. After the reference silhouette (Footages.local/186e889d-...png): dark crew-
// neck sweater, short dark hair, one hand in the trouser pocket, the other arm raised forward
// holding the phone at chest-to-eye height.
//
// The phone is placed exactly at the camera; the body stands behind it, turned with the camera's
// heading and kept upright, and the right arm is solved each frame (two-bone IK) so the hand
// reaches the phone. Everything sits behind the camera's near plane, so it never appears in
// the direct view.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const EYE_HEIGHT = 1.64;		// standing eye height of a ~1.75 m person
const REACH_BACK = 0.36;		// eyes behind the phone (horizontal)
const UPPER_ARM = 0.30, FOREARM = 0.27;
const FLAT = 0.6;				// depth squash: flattened figure

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3( 0, 1, 0 );

function mat( color, roughness, extra = {} ) {

	return new THREE.MeshPhysicalMaterial( { color, roughness, metalness: 0, ...extra } );

}

// a segment mesh (unit length along +y, centred) that can be stretched between two points
function limb( radius, material ) {

	const g = new THREE.CapsuleGeometry( radius, 1, 4, 10 );
	const m = new THREE.Mesh( g, material );
	m.userData.radius = radius;
	return m;

}

function placeLimb( m, a, b ) {

	_v.subVectors( b, a );
	const len = _v.length();
	m.position.addVectors( a, b ).multiplyScalar( 0.5 );
	m.quaternion.setFromUnitVectors( _up, _v.normalize() );
	// capsule body is 1 long plus two radius caps; scale the straight part only (approx.)
	m.scale.set( 1, Math.max( 0.01, len - m.userData.radius ) , 1 );

}

export class Person {

	constructor() {

		const sweater = mat( '#141414', 0.95, { sheen: 0.5, sheenColor: new THREE.Color( '#3a3a3a' ), sheenRoughness: 0.8 } );
		const trousers = mat( '#101010', 0.9 );
		const skin = mat( '#7a5a48', 0.55, { sheen: 0.3, sheenColor: new THREE.Color( '#b08a70' ) } );
		const hair = mat( '#0b0a09', 0.7 );
		const phone = mat( '#0c0c0e', 0.25, { clearcoat: 1, clearcoatRoughness: 0.08 } );

		const root = new THREE.Group();				// at the eyes, turned with the camera heading
		root.name = 'person';
		this.root = root;
		const body = new THREE.Group();				// flattened in depth
		body.scale.z = FLAT;
		root.add( body );

		const add = ( geo, m, pos, parent = body ) => {

			const mesh = new THREE.Mesh( geo, m );
			mesh.position.set( ...pos );
			mesh.castShadow = false;		// behind the camera; would force shadow re-renders every frame
			mesh.receiveShadow = true;
			parent.add( mesh );
			return mesh;

		};

		// head and hair (eyes at the root origin, +z = behind, -z = forward)
		const head = add( new THREE.SphereGeometry( 0.095, 24, 18 ), skin, [ 0, 0.02, 0.02 ] );
		head.scale.set( 0.82, 1.12, 0.95 );
		const hairCap = add( new THREE.SphereGeometry( 0.1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55 ), hair, [ 0, 0.05, 0.03 ] );
		hairCap.scale.set( 0.88, 1.05, 1.0 );
		hairCap.rotation.x = - 0.25;
		add( new THREE.CylinderGeometry( 0.05, 0.058, 0.12, 16 ), skin, [ 0, - 0.12, 0.03 ] );

		// torso (crew-neck sweater), shoulders at y ~ -0.20 below the eyes
		add( new RoundedBoxGeometry( 0.44, 0.62, 0.26, 4, 0.08 ), sweater, [ 0, - 0.50, 0.04 ] );
		add( new RoundedBoxGeometry( 0.40, 0.14, 0.24, 4, 0.06 ), sweater, [ 0, - 0.24, 0.04 ] );
		// hips and legs down to the floor
		add( new RoundedBoxGeometry( 0.38, 0.22, 0.24, 4, 0.06 ), trousers, [ 0, - 0.86, 0.04 ] );
		for ( const sx of [ - 1, 1 ] ) add( new RoundedBoxGeometry( 0.16, 0.86, 0.18, 3, 0.06 ), trousers, [ sx * 0.1, - 1.36, 0.05 ] );

		// left arm hanging, hand in the pocket
		const sL = new THREE.Vector3( - 0.23, - 0.27, 0.04 );
		const eL = new THREE.Vector3( - 0.26, - 0.56, 0.06 );
		const hL = new THREE.Vector3( - 0.2, - 0.82, 0.0 );
		const upL = limb( 0.052, sweater ), foL = limb( 0.046, sweater );
		placeLimb( upL, sL, eL );
		placeLimb( foL, eL, hL );
		body.add( upL, foL );

		// right arm: solved every frame (in root space) to reach the phone
		this.shoulder = new THREE.Vector3( 0.23, - 0.27, 0.0 );
		this.upper = limb( 0.052, sweater );
		this.fore = limb( 0.045, sweater );
		this.hand = new THREE.Mesh( new THREE.SphereGeometry( 0.045, 16, 12 ), skin );
		this.hand.scale.set( 0.9, 1.25, 0.7 );
		for ( const m of [ this.upper, this.fore, this.hand ] ) {

			m.receiveShadow = true;
			root.add( m );

		}

		// the phone: back (camera side) faces the scene; placed at the camera each frame
		this.phone = new THREE.Mesh( new RoundedBoxGeometry( 0.075, 0.155, 0.009, 3, 0.006 ), phone );
		this.phone.receiveShadow = true;

		this.group = new THREE.Group();
		this.group.name = 'handheldPerson';
		this.group.add( root, this.phone );

	}

	/**
	 * Pose the figure for a camera (phone) at `position` with orientation `quaternion`.
	 * Returns nothing; the group is updated in place.
	 */
	update( position, quaternion ) {

		// phone: at the lens, slightly behind it so the camera is never inside the phone body
		this.phone.quaternion.copy( quaternion );
		this.phone.position.copy( position ).add( _w.set( 0, - 0.06, 0.006 ).applyQuaternion( quaternion ) );

		// heading of the camera (yaw only); the body stays upright
		_v.set( 0, 0, - 1 ).applyQuaternion( quaternion );
		const yaw = Math.atan2( - _v.x, - _v.z );
		const root = this.root;
		root.rotation.set( 0, yaw, 0 );

		// eyes behind the phone and a little above it; never above standing eye height
		// (higher shots are taken with the arm raised, not by a taller person)
		const back = _w.set( Math.sin( yaw ), 0, Math.cos( yaw ) );
		root.position.copy( position ).addScaledVector( back, REACH_BACK );
		root.position.y = Math.min( position.y + 0.12, EYE_HEIGHT );
		root.updateMatrixWorld( true );

		// right arm IK in root space: shoulder -> elbow -> hand (at the phone's lower half)
		const target = this.phone.localToWorld( _v.set( 0.02, - 0.03, 0.02 ) );
		root.worldToLocal( target );
		const s = this.shoulder;
		const d = target.clone().sub( s );
		const dist = Math.min( d.length(), UPPER_ARM + FOREARM - 1e-3 );
		d.normalize();
		// elbow bends down and outward
		const a = ( UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + dist * dist ) / ( 2 * dist );
		const h = Math.sqrt( Math.max( 0, UPPER_ARM * UPPER_ARM - a * a ) );
		const hint = new THREE.Vector3( 0.6, - 1, 0.3 ).normalize();
		const perp = hint.sub( d.clone().multiplyScalar( hint.dot( d ) ) ).normalize();
		const elbow = s.clone().addScaledVector( d, a ).addScaledVector( perp, h );
		const hand = s.clone().addScaledVector( d, dist );
		placeLimb( this.upper, s, elbow );
		placeLimb( this.fore, elbow, hand );
		this.hand.position.copy( hand );
		this.hand.quaternion.setFromUnitVectors( _up, _w.subVectors( hand, elbow ).normalize() );

	}

}

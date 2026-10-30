// The person holding the phone in handheld mode: a flat cut-out of the reference mirror selfie
// (Footages.local/186e889d-...png; public/person/cutout.png, made by tools/build-person-cutout.py)
// standing behind the camera. It is seen only in reflections (the black screen, lacquer, glass)
// and, in path tracing, as real geometry: a dark figure against the lit room behind it, as a
// person shows up in a black screen. The card is unlit-looking only because the photo is dark;
// it is an ordinary diffuse surface lit by the room.
//
// The raised forearm, the hand and the phone are modelled (cut out of the picture): they reach
// forward from the elbow on the card to the camera, so the arm stands out from the body in the
// reflection as in the photo.
//
// The card stands upright on the floor, turned with the camera's heading, a little behind the
// camera, placed sideways so that the phone in the picture is in line with the camera. Shots
// lower or higher than the picture's phone (1.52 m) are a person holding it lower or raising
// the arm; the figure doesn't move up or down.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const URL = import.meta.env.BASE_URL + 'person/';
const BEHIND = 0.3;				// m, card plane behind the camera (between the phone and the face)

const ELBOW_FORWARD = 0.06;		// m, elbow in front of the card
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _up = new THREE.Vector3( 0, 1, 0 );

function mat( color, roughness, extra = {} ) {

	return new THREE.MeshPhysicalMaterial( { color, roughness, metalness: 0, ...extra } );

}

// a capsule between two points (end to end, caps included); `taper` < 1 narrows it towards b
function limb( radius, material, taper = 1 ) {

	const m = new THREE.Mesh( new THREE.BufferGeometry(), material );
	m.userData = { radius, taper, length: - 1 };
	return m;

}

function placeLimb( m, a, b ) {

	_w.subVectors( b, a );
	const len = _w.length(), { radius, taper } = m.userData;
	// rebuilt when the length changes (cheap): scaling would squash the round ends
	if ( Math.abs( len - m.userData.length ) > 0.004 ) {

		m.geometry.dispose();
		const g = new THREE.CapsuleGeometry( radius, Math.max( 0.001, len - 2 * radius ), 6, 14 );
		if ( taper !== 1 ) {

			const p = g.attributes.position;
			for ( let i = 0; i < p.count; ++ i ) {

				const k = THREE.MathUtils.lerp( 1, taper, THREE.MathUtils.clamp( p.getY( i ) / len + 0.5, 0, 1 ) );
				p.setX( i, p.getX( i ) * k );
				p.setZ( i, p.getZ( i ) * k );

			}

			g.computeVertexNormals();

		}

		m.geometry = g;
		m.userData.length = len;

	}

	m.position.addVectors( a, b ).multiplyScalar( 0.5 );
	m.quaternion.setFromUnitVectors( _up, _w.normalize() );

}

export class Person {

	constructor() {

		this.info = null;
		this.material = new THREE.MeshStandardMaterial( { color: '#ffffff', roughness: 0.95, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide } );
		this.card = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ), this.material );
		this.card.castShadow = false;		// behind the camera; would force shadow re-renders every frame
		this.card.receiveShadow = true;
		this.card.visible = false;			// until the picture has loaded
		this.root = new THREE.Group();		// at the camera's floor point, turned with its heading
		this.root.add( this.card );
		this.group = new THREE.Group();
		this.group.name = 'handheldPerson';
		this.group.add( this.root );

		// the raised arm; albedo from cutout.json (the photo's colours corrected the same way)
		const skin = this.skin = mat( '#7c6a5d', 0.6, { sheen: 0.3, sheenColor: new THREE.Color( '#8a7464' ) } );
		const sleeve = this.sleeve = mat( '#34363a', 0.95, { sheen: 0.5, sheenColor: new THREE.Color( '#3a3a3c' ), sheenRoughness: 0.8 } );
		this.forearm = limb( 0.036, skin, 0.72 );			// thicker below the elbow, slim at the wrist
		this.cuff = limb( 0.044, sleeve, 0.9 );			// sleeve pushed up, bunched at the elbow
		this.phone = new THREE.Mesh( new RoundedBoxGeometry( 0.075, 0.155, 0.009, 3, 0.006 ), mat( '#0a0a0c', 0.55 ) );		// matte back: dark, as in the photo
		// right hand, in phone space (x = the person's right, +z = towards the person, the lens at
		// the top of the back, -z): as in the photo, the palm against the right edge, four
		// fingers wrapped round the back below the lens, the thumb across the screen side
		this.hand = new THREE.Group();
		const palm = new THREE.Mesh( new RoundedBoxGeometry( 0.032, 0.085, 0.05, 3, 0.014 ), skin );
		palm.position.set( 0.05, - 0.035, 0.012 );
		palm.rotation.z = - 0.12;
		this.hand.add( palm );
		const joints = [ [ - 0.004, 0.058 ], [ - 0.025, 0.064 ], [ - 0.046, 0.06 ], [ - 0.065, 0.05 ] ];
		for ( const [ y, length ] of joints ) {

			const f = limb( 0.0085, skin, 0.85 );
			placeLimb( f, new THREE.Vector3( 0.048, y, - 0.012 ), new THREE.Vector3( 0.048 - length, y + 0.006, - 0.0135 ) );
			this.hand.add( f );

		}

		const thumb = limb( 0.0105, skin, 0.85 );
		placeLimb( thumb, new THREE.Vector3( 0.05, - 0.07, 0.022 ), new THREE.Vector3( 0.0, - 0.02, 0.012 ) );
		this.hand.add( thumb );
		this.phone.add( this.hand );
		for ( const m of [ this.forearm, this.cuff, this.phone, ...this.hand.children ] ) {

			m.castShadow = false;
			m.receiveShadow = true;

		}

		this.group.add( this.forearm, this.cuff, this.phone );

		Promise.all( [
			fetch( URL + 'cutout.json' ).then( r => r.json() ),
			new THREE.TextureLoader().loadAsync( URL + 'cutout.png' ),
		] ).then( ( [ info, map ] ) => {

			map.colorSpace = THREE.SRGBColorSpace;
			map.anisotropy = 4;
			this.material.map = map;
			this.material.needsUpdate = true;
			this.info = info;
			this.skin.color.set( info.skin );
			this.sleeve.color.set( info.sleeve );
			// card faces forward (-z of the root), origin at the phone
			this.card.geometry.dispose();
			this.card.geometry = new THREE.PlaneGeometry( info.width, info.height )
				.translate( info.width / 2 - info.phone[ 0 ], info.height / 2 - info.phone[ 1 ], 0 )
				.rotateY( Math.PI );
			this.card.visible = true;

		} ).catch( e => console.warn( 'person cut-out failed to load', e ) );

	}

	/** Place the figure for a camera (phone) at `position` with orientation `quaternion`. */
	update( position, quaternion ) {

		// heading of the camera (yaw only); the figure stays upright
		_v.set( 0, 0, - 1 ).applyQuaternion( quaternion );
		const yaw = Math.atan2( - _v.x, - _v.z );
		const root = this.root;
		root.rotation.set( 0, yaw, 0 );
		// feet on the floor (y = 0): the card's origin is at the phone
		root.position.set( position.x + Math.sin( yaw ) * BEHIND, this.info ? this.info.phone[ 1 ] : position.y, position.z + Math.cos( yaw ) * BEHIND );
		root.updateMatrixWorld( true );

		// phone at the lens (slightly behind it, so the camera is never inside the phone body)
		this.phone.quaternion.copy( quaternion );
		this.phone.position.copy( position ).add( _w.set( 0, - 0.06, 0.006 ).applyQuaternion( quaternion ) );
		this.phone.updateMatrixWorld( true );
		if ( ! this.info ) return;

		// forearm: from the elbow (on the card, a little forward; raised for high shots) to the wrist
		const { elbow, phone } = this.info;
		const wrist = this.phone.localToWorld( _v.set( 0.058, - 0.085, 0.03 ) );
		const local = root.worldToLocal( wrist.clone() );
		_e.set( - ( elbow[ 0 ] - phone[ 0 ] ), Math.max( elbow[ 1 ] - phone[ 1 ], local.y - 0.3 ), - ELBOW_FORWARD );
		root.localToWorld( _e );
		placeLimb( this.forearm, _e, wrist );
		const elbowPt = _e.clone(), cuffEnd = _w.subVectors( wrist, _e ).normalize().multiplyScalar( 0.11 ).add( _e ).clone();
		placeLimb( this.cuff, elbowPt.addScaledVector( _w.subVectors( cuffEnd, elbowPt ).normalize(), - 0.03 ), cuffEnd );

	}

}

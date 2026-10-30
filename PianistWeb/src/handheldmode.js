// Handheld camera mode: the user still drives the camera with the mouse / touch (OrbitControls),
// but what renders is a phone held by a person standing there.
//  - hand shake from the model fitted to a real handheld video (handheld.js, shakeAt): about
//    0.2° while the camera holds still, 3x that while it moves or pans
//  - left drag turns the view in place (the orbit centre is kept just ahead of the lens)
//  - walking: when the camera travels, a vertical dip per step, sideways sway per stride, a
//    little roll and nod, fading in with speed
//  - height capped at what a person can reach holding a phone (1.85 m; standing eye height of a
//    1.75 m person is 1.64 m, higher means the arm is raised)
//  - arrow keys walk (up/down forward/back along the heading, left/right sidestep; Shift
//    faster); right-drag panning is off. The camera and its orbit target move together and
//    stay inside the room
//  - wheel / middle drag change the field of view (zoom by focal length) instead of dollying
//  - a person model (person.js) behind the camera, seen in glossy reflections: the mirror probe
//    is re-captured from just in front of the camera (throttled) while the camera moves
// In path tracing the shake is paused (it would restart the accumulation every frame); the
// person is still placed, and the scene is rebuilt once the camera has settled.

import * as THREE from 'three';
import { HandheldCamera } from './handheld.js';
import { Person } from './person.js';
import params from '../../CameraTrack/handheld_params.json';

const MAX_HEIGHT = 1.85, MIN_HEIGHT = 0.3;
const FOV_RANGE = [ 12, 70 ];
const STEP_HZ = 1.8;							// walking cadence (steps per second)
const BOB = 0.008, SWAY = 0.006;				// m, at full walking speed (phone held, so damped)
const ROLL = 0.35, NOD = 0.25;					// deg
const TURN_RADIUS = 0.01;						// orbit centre kept just ahead of the lens: drag turns in place
const D = THREE.MathUtils.DEG2RAD;
const WALK_SPEED = 0.7, RUN_SPEED = 1.2;		// m/s
const WALK_EASE = 0.3;							// s to reach speed / to stop
const WALL_MARGIN = 0.3;						// m kept from the walls
const KEYS = { ArrowUp: [ 0, 1 ], ArrowDown: [ 0, - 1 ], ArrowLeft: [ - 1, 0 ], ArrowRight: [ 1, 0 ] };

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _o = new THREE.Vector3();

export class HandheldMode {

	/**
	 * @param ctx { camera, controls, scene, renderer, isPathTracing(), specularCapture(position),
	 *              bounds() -> { minX, maxX, minZ, maxZ } (room floor) }
	 */
	constructor( ctx ) {

		this.ctx = ctx;
		this.enabled = false;
		this.intensity = 1;			// shake gain
		this.walk = 1;				// walking motion gain
		this.showPerson = true;
		this.shaker = new HandheldCamera( params, { seed: 11 } );
		this.person = new Person();
		this.intended = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), valid: false };
		this.lastPos = new THREE.Vector3();
		this.lastQuat = new THREE.Quaternion();
		this.speed = 0;				// smoothed camera speed (m/s)
		this.turn = 0;				// smoothed turn rate (rad/s)
		this.stepPhase = 0;
		this.probeAt = new THREE.Vector3( 1e9, 0, 0 );
		this.probeTime = 0;
		this.settle = 0;
		this.rebuild = false;
		this.time = 0;
		this.pressed = new Set();
		this.shift = false;
		this.walkVel = new THREE.Vector3();

		this._onWheel = this._onWheel.bind( this );
		this._onDown = this._onDown.bind( this );
		this._onMove = this._onMove.bind( this );
		this._onUp = this._onUp.bind( this );
		this._onKey = this._onKey.bind( this );

	}

	setEnabled( on ) {

		if ( on === this.enabled ) return;
		const { camera, controls, scene, renderer } = this.ctx;
		this.enabled = on;
		const el = renderer.domElement;
		if ( on ) {

			this.savedFov = camera.fov;
			this.savedMiddle = controls.mouseButtons.MIDDLE;
			this.savedPan = controls.enablePan;
			this.savedMinDistance = controls.minDistance;
			this.savedTargetDistance = camera.position.distanceTo( controls.target );
			controls.minDistance = 0;
			controls.target.copy( camera.position ).add( _v.set( 0, 0, - TURN_RADIUS ).applyQuaternion( camera.quaternion ) );
			controls.update();
			controls.enableZoom = false;
			controls.enablePan = false;
			controls.mouseButtons.MIDDLE = null;
			window.addEventListener( 'keydown', this._onKey, { capture: true } );
			window.addEventListener( 'keyup', this._onKey, { capture: true } );
			window.addEventListener( 'blur', this._onKey );
			el.addEventListener( 'wheel', this._onWheel, { passive: false, capture: true } );
			el.addEventListener( 'pointerdown', this._onDown, { capture: true } );
			if ( this.showPerson ) scene.add( this.person.group );
			this.intended.valid = false;
			this.probeAt.set( 1e9, 0, 0 );

		} else {

			// back to the intended (un-shaken) pose; from now on the controls own the camera
			if ( this.intended.valid ) {

				camera.position.copy( this.intended.position );
				camera.quaternion.copy( this.intended.quaternion );

			}

			this.intended.valid = false;
			// put the orbit centre back at a comfortable distance in front of the camera
			controls.minDistance = this.savedMinDistance ?? controls.minDistance;
			controls.target.copy( camera.position ).add( _v.set( 0, 0, - ( this.savedTargetDistance ?? 1.5 ) ).applyQuaternion( camera.quaternion ) );
			camera.fov = this.savedFov ?? camera.fov;
			camera.updateProjectionMatrix();
			controls.enableZoom = true;
			controls.enablePan = this.savedPan ?? true;
			window.removeEventListener( 'keydown', this._onKey, { capture: true } );
			window.removeEventListener( 'keyup', this._onKey, { capture: true } );
			window.removeEventListener( 'blur', this._onKey );
			this.pressed.clear();
			this.walkVel.set( 0, 0, 0 );
			controls.mouseButtons.MIDDLE = this.savedMiddle ?? THREE.MOUSE.DOLLY;
			el.removeEventListener( 'wheel', this._onWheel, { capture: true } );
			el.removeEventListener( 'pointerdown', this._onDown, { capture: true } );
			scene.remove( this.person.group );
			this.rebuild = true;
			controls.dispatchEvent( { type: 'change' } );

		}

	}

	setShowPerson( on ) {

		this.showPerson = on;
		if ( ! this.enabled ) return;
		if ( on ) this.ctx.scene.add( this.person.group ); else this.ctx.scene.remove( this.person.group );
		this.probeAt.set( 1e9, 0, 0 );
		this.rebuild = true;

	}

	/** True once after the person moved / appeared in path-tracing mode: rebuild the PT scene. */
	consumeRebuild() {

		const r = this.rebuild;
		this.rebuild = false;
		return r;

	}

	// ---- per frame ----------------------------------------------------------------------------

	/** Put the camera back on the intended (un-shaken) pose before the controls move it. */
	restore() {

		if ( ! this.enabled || ! this.intended.valid ) return;
		this.ctx.camera.position.copy( this.intended.position );
		this.ctx.camera.quaternion.copy( this.intended.quaternion );

	}

	/** After controls.update(): cap the height, remember the intent, add shake + walking. */
	apply( dt ) {

		if ( ! this.enabled ) return;
		const { camera, controls } = this.ctx;
		const pt = this.ctx.isPathTracing();

		// arrow-key walking: camera and orbit target move together, eased, inside the room
		{

			let ix = 0, iz = 0;
			for ( const k of this.pressed ) {

				ix += KEYS[ k ][ 0 ];
				iz += KEYS[ k ][ 1 ];

			}

			_v.set( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
			_v.y = 0;
			if ( _v.lengthSq() < 1e-6 ) _v.set( 0, 0, - 1 );
			_v.normalize();								// forward on the floor
			const right = _o.set( - _v.z, 0, _v.x );
			const want = _v.multiplyScalar( iz ).addScaledVector( right, ix );
			if ( want.lengthSq() > 0 ) want.normalize().multiplyScalar( this.shift ? RUN_SPEED : WALK_SPEED );
			this.walkVel.lerp( want, 1 - Math.exp( - dt / ( WALK_EASE / 3 ) ) );
			if ( this.walkVel.lengthSq() > 1e-8 ) {

				const step = _v.copy( this.walkVel ).multiplyScalar( dt );
				const b = this.ctx.bounds?.();
				if ( b ) {

					const p = camera.position;
					step.x = THREE.MathUtils.clamp( p.x + step.x, b.minX + WALL_MARGIN, b.maxX - WALL_MARGIN ) - p.x;
					step.z = THREE.MathUtils.clamp( p.z + step.z, b.minZ + WALL_MARGIN, b.maxZ - WALL_MARGIN ) - p.z;

				}

				camera.position.add( step );
				controls.target.add( step );

			}

		}

		// height a person can hold the phone at (the orbit centre moves with it)
		const yc = THREE.MathUtils.clamp( camera.position.y, MIN_HEIGHT, MAX_HEIGHT );
		if ( yc !== camera.position.y ) {

			controls.target.y += yc - camera.position.y;
			camera.position.y = yc;

		}

		// keep the orbit centre just ahead of the lens, so dragging turns the view in place
		controls.target.copy( camera.position ).add( _v.set( 0, 0, - TURN_RADIUS ).applyQuaternion( camera.quaternion ) );

		const I = this.intended;
		if ( ! I.valid ) {

			this.lastPos.copy( camera.position );
			this.lastQuat.copy( camera.quaternion );

		}

		I.position.copy( camera.position );
		I.quaternion.copy( camera.quaternion );
		I.valid = true;

		// operator activity: travel speed and turn rate, smoothed
		const k = 1 - Math.exp( - dt / 0.25 );
		const v = dt > 0 ? camera.position.distanceTo( this.lastPos ) / dt : 0;
		const w = dt > 0 ? 2 * Math.acos( Math.min( 1, Math.abs( camera.quaternion.dot( this.lastQuat ) ) ) ) / dt : 0;
		this.speed += ( v - this.speed ) * k;
		this.turn += ( w - this.turn ) * k;
		this.lastPos.copy( camera.position );
		this.lastQuat.copy( camera.quaternion );
		const moving = Math.min( 1, THREE.MathUtils.smoothstep( this.speed, 0.03, 0.25 ) + THREE.MathUtils.smoothstep( this.turn, 0.07, 0.4 ) );
		const walking = THREE.MathUtils.smoothstep( this.speed, 0.04, 0.35 ) * this.walk;

		if ( ! pt ) {

			this.time += dt;
			// hand shake (camera axes). At gain 1 the synthesised noise (which includes the slow
			// 0.6-1 Hz sway) is ~1° RMS; here ~0.2° holding still, 3x that moving
			const g = this.intensity * ( 0.18 + 0.36 * moving );
			const { rotation, offset } = this.shaker.shakeAt( this.time, g, _q, _o );

			// walking: steps advance with speed; dip per step, sway per stride
			this.stepPhase += dt * 2 * Math.PI * STEP_HZ * ( 0.6 + 0.4 * walking ) * ( walking > 0.01 ? 1 : 0 );
			const step = this.stepPhase, stride = this.stepPhase / 2;
			offset.x += SWAY * walking * Math.sin( stride );
			offset.y += BOB * walking * ( Math.cos( step ) - 1 ) / 2;		// dips by up to BOB
			_e.set( NOD * D * walking * Math.cos( step ), 0, ROLL * D * walking * Math.sin( stride ) );
			rotation.multiply( _q2.setFromEuler( _e ) );

			camera.position.add( offset.applyQuaternion( I.quaternion ) );
			camera.quaternion.copy( I.quaternion ).multiply( rotation );

		}

		// the person holding the phone
		if ( this.showPerson ) {

			this.person.update( camera.position, camera.quaternion );
			this.person.group.updateMatrixWorld( true );

		}

		// reflections: re-capture the mirror probe from just in front of the camera
		this.probeTime += dt;
		const movedFar = I.position.distanceTo( this.probeAt ) > 0.03;
		if ( this.showPerson && ! pt && movedFar && this.probeTime > 0.25 ) {

			const ahead = 0.3;
			_v.set( 0, 0, - ahead ).applyQuaternion( I.quaternion ).add( I.position );
			this.ctx.specularCapture( _v );
			this.probeAt.copy( I.position );
			this.probeTime = 0;

		}

		// path tracing: rebuild the scene (with the person) once the camera has settled
		if ( pt && this.showPerson ) {

			if ( moving > 0.05 ) this.settle = 0;
			else if ( this.settle >= 0 && ( this.settle += dt ) > 0.35 ) {

				this.rebuild = true;
				this.settle = - 1;		// done until the next move

			}

		}

	}

	// ---- keys ------------------------------------------------------------------------------------

	_onKey( e ) {

		if ( e.type === 'blur' ) {

			this.pressed.clear();
			this.shift = false;
			return;

		}

		this.shift = e.shiftKey;
		if ( ! KEYS[ e.key ] || e.target?.closest?.( '.lil-gui' ) ) return;
		e.preventDefault();
		if ( e.type === 'keydown' ) this.pressed.add( e.key ); else this.pressed.delete( e.key );

	}

	// ---- FOV zoom ------------------------------------------------------------------------------

	_zoom( factor ) {

		const { camera, controls } = this.ctx;
		camera.fov = THREE.MathUtils.clamp( camera.fov * factor, FOV_RANGE[ 0 ], FOV_RANGE[ 1 ] );
		camera.updateProjectionMatrix();
		controls.dispatchEvent( { type: 'change' } );

	}

	_onWheel( e ) {

		e.preventDefault();
		e.stopImmediatePropagation();
		this._zoom( Math.exp( e.deltaY * 0.0012 ) );

	}

	_onDown( e ) {

		if ( e.button !== 1 ) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		this.dragY = e.clientY;
		window.addEventListener( 'pointermove', this._onMove );
		window.addEventListener( 'pointerup', this._onUp );

	}

	_onMove( e ) {

		this._zoom( Math.exp( ( e.clientY - this.dragY ) * 0.004 ) );
		this.dragY = e.clientY;

	}

	_onUp() {

		window.removeEventListener( 'pointermove', this._onMove );
		window.removeEventListener( 'pointerup', this._onUp );

	}

}

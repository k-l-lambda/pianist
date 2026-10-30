// Handheld camera mode: the user still drives the camera with the mouse / touch (OrbitControls),
// but what renders is a phone held by a person standing there.
//  - hand shake from the model fitted to a real handheld video (handheld.js, shakeAt), limited
//    to 2.5 Hz (above that the measurement is noise), at 6% of the video's level (0.18° held
//    still); 3x while walking, 1.5x while turning
//  - left drag turns the view in place (the orbit centre is kept just ahead of the lens)
//  - walking = body + arm. The body bobs once per step and sways once per stride; steps keep a
//    roughly fixed length, so the cadence follows the walking speed (0.55 m steps: 1.3 steps/s
//    at 0.7 m/s, 2.2 at 1.2); the body's bob grows with speed. The arm holding the phone
//    carries that to the camera as a damped spring (0.35 Hz, ζ 0.7): it soaks up most of the
//    step bob (~40% gets through at 0.7 m/s, ~25% at 1.2) and lags it; the slower stride sway
//    passes more. The hand's own shake comes on top
//  - height capped at what a person can reach holding a phone (1.85 m; standing eye height of a
//    1.75 m person is 1.64 m, higher means the arm is raised)
//  - arrow keys walk (up/down forward/back along the heading, left/right sidestep; Shift
//    faster); right-drag panning is off. The camera and its orbit target move together and
//    stay inside the room
//  - wheel / middle drag change the field of view (zoom by focal length) instead of dollying
//  - a person (person.js, a cut-out of the reference photo) behind the camera, seen in glossy
//    reflections: the mirror probe is re-captured as the camera moves (on a flat screen from the
//    camera's mirror image, an exact planar reflection; elsewhere from just ahead of the camera). On
//    leaving the mode the person stays where it stood, to be inspected
// In path tracing the shake is paused (it would restart the accumulation every frame); the
// person is still placed, and the scene is rebuilt once the camera has settled.

import * as THREE from 'three';
import { HandheldCamera } from './handheld.js';
import { Person } from './person.js';
import params from '../../CameraTrack/handheld_params.json';

const MAX_HEIGHT = 1.85, MIN_HEIGHT = 0.3;
const FOV_RANGE = [ 12, 70 ];
const STEP_LENGTH = 0.55;						// m: cadence = speed / step length
const MAX_CADENCE = 2.6;						// steps / s
const BODY_BOB = 0.04, BODY_SWAY = 0.03;		// m peak to peak at a brisk walk (1.2 / 1.0 m/s and up): the
												// body's (head / shoulders') gait motion; less when slower
const ARM_HZ = 0.35, ARM_ZETA = 0.7;			// the arm as a spring-damper between body and phone
const ROLL = 0.3, NOD = 0.2;					// deg, the body's sway roll and step nod, as passed on
const TURN_RADIUS = 0.01;
const SHAKE_CUTOFF = 2.5;						// Hz
// shake gain: the 2.5 Hz-limited generator gives 0.91° RMS at gain 1. The video (CameraTrack)
// held still at 0.18° below 3 Hz (gain 0.2) and, walking about, 3x that (0.57°). Played back at
// 6% of that (0.011° holding still): the full level reads as far too shaky on screen
const HOLD_GAIN = 0.2 * 0.06, WALK_FACTOR = 3, TURN_FACTOR = 1.5;
const D = THREE.MathUtils.DEG2RAD;
const WALK_SPEED = 0.7, RUN_SPEED = 1.2;		// m/s
const WALK_EASE = 0.3;							// s to reach speed / to stop
const WALL_MARGIN = 0.3;						// m kept from the walls
const KEYS = { ArrowUp: [ 0, 1 ], ArrowDown: [ 0, - 1 ], ArrowLeft: [ - 1, 0 ], ArrowRight: [ 1, 0 ] };

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _o = new THREE.Vector3();

export class HandheldMode {

	/**
	 * @param ctx { camera, controls, scene, renderer, isPathTracing(), specularCapture(eye, ahead), specularRestore(),
	 *              bounds() -> { minX, maxX, minZ, maxZ } (room floor) }
	 */
	constructor( ctx ) {

		this.ctx = ctx;
		this.enabled = false;
		this.intensity = 1;			// shake gain
		this.walk = 1;				// walking motion gain
		this.showPerson = true;
		// spectra cut above 2.5 Hz: beyond that the video's measurement is a flat noise floor
		// (tracking jitter, blur, rolling shutter), not hand motion
		this.shaker = new HandheldCamera( params, { seed: 11, cutoff: SHAKE_CUTOFF } );
		this.person = new Person();
		this.intended = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), valid: false };
		this.lastPos = new THREE.Vector3();
		this.lastQuat = new THREE.Quaternion();
		this.speed = 0;				// smoothed camera speed (m/s)
		this.turn = 0;				// smoothed turn rate (rad/s)
		this.stepPhase = 0;
		this.arm = { x: 0, y: 0, vx: 0, vy: 0 };	// phone relative to the body's mean path (m, m/s)
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
			if ( this.showPerson ) scene.add( this.person.group ); else this._removePerson();
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
			// the person stays where it stood, for inspection; reflections back to the room's own
			this.ctx.specularRestore?.();
			this.rebuild = true;
			controls.dispatchEvent( { type: 'change' } );

		}

	}

	setShowPerson( on ) {

		this.showPerson = on;
		if ( ! on ) {

			this._removePerson();
			this.ctx.specularRestore?.();

		}
		if ( ! this.enabled ) return;
		if ( on ) this.ctx.scene.add( this.person.group );
		this.probeAt.set( 1e9, 0, 0 );
		this.rebuild = true;

	}

	_removePerson() {

		this.ctx.scene.remove( this.person.group );

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
			// hand shake (camera axes), at the levels measured in the video: walking raises it to 3x,
			// turning the view alone to 1.5x
			const walkAct = THREE.MathUtils.smoothstep( this.speed, 0.04, 0.35 );
			const turnAct = THREE.MathUtils.smoothstep( this.turn, 0.07, 0.4 );
			const g = this.intensity * HOLD_GAIN * Math.max( 1 + ( WALK_FACTOR - 1 ) * walkAct, 1 + ( TURN_FACTOR - 1 ) * turnAct );
			const { rotation, offset } = this.shaker.shakeAt( this.time, g, _q, _o );

			// walking: the body's gait at a cadence set by the speed (fixed step length), filtered by
			// the arm (spring-damper), in world axes: vertical, and sideways across the heading
			const cadence = Math.min( this.speed / STEP_LENGTH, MAX_CADENCE );
			const w = 2 * Math.PI * cadence;
			this.stepPhase += dt * w;
			const step = this.stepPhase, stride = step / 2;
			const av = BODY_BOB / 2 * walking * Math.min( 1, this.speed / 1.2 ), al = BODY_SWAY / 2 * walking * Math.min( 1, this.speed / 1.0 );
			const by = av * Math.cos( step ), bvy = - av * w * Math.sin( step );
			const bx = al * Math.sin( stride ), bvx = al * w / 2 * Math.cos( stride );
			const arm = this.arm, w0 = 2 * Math.PI * ARM_HZ, n = Math.ceil( dt / 0.004 ), h = dt / n;
			for ( let i = 0; i < n; ++ i ) {

				arm.vx += h * ( w0 * w0 * ( bx - arm.x ) + 2 * ARM_ZETA * w0 * ( bvx - arm.vx ) );
				arm.vy += h * ( w0 * w0 * ( by - arm.y ) + 2 * ARM_ZETA * w0 * ( bvy - arm.vy ) );
				arm.x += h * arm.vx;
				arm.y += h * arm.vy;

			}

			_e.set( NOD * D * walking * Math.cos( step ), 0, ROLL * D * walking * Math.sin( stride ) );
			rotation.multiply( _q2.setFromEuler( _e ) );

			camera.position.add( offset.applyQuaternion( I.quaternion ) );
			_v.set( 0, 0, - 1 ).applyQuaternion( I.quaternion ).setY( 0 );
			if ( _v.lengthSq() < 1e-6 ) _v.set( 0, 0, - 1 );
			_v.normalize();
			camera.position.x += - _v.z * arm.x;					// right of the heading
			camera.position.z += _v.x * arm.x;
			camera.position.y += arm.y;
			camera.quaternion.copy( I.quaternion ).multiply( rotation );

		}

		// the person holding the phone (placed from the intended pose: shake moves the hand, not
		// the whole figure)
		if ( this.showPerson ) this.person.update( I.position, I.quaternion );

		// reflections: re-capture the mirror probe for the camera's position (a flat screen: from
		// the camera's mirror image, exact; otherwise from just in front of the camera). Only the
		// position matters, so turning needs no capture
		this.probeTime += dt;
		const movedFar = I.position.distanceTo( this.probeAt ) > 0.01;
		if ( this.showPerson && ! pt && movedFar && this.probeTime > 1 / 30 ) {

			_v.set( 0, 0, - 0.3 ).applyQuaternion( I.quaternion ).add( I.position );
			this.ctx.specularCapture( I.position, _v );
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

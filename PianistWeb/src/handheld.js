// Handheld camera simulation: turns a rough camera path into the motion of a phone held in
// the hand, using a shake model fitted to a real handheld video (CameraTrack/analyze.py ->
// handheld_params.json).
//
//   intended path  ->  operator follow-through  ->  + hand shake  ->  camera pose
//
// 1. Intended path: centripetal Catmull–Rom splines through keyframes { t, position, target }.
// 2. Operator: the hand follows the intent through a critically damped 2nd-order filter
//    (smooth starts/stops, a little lag behind sudden direction changes).
// 3. Shake: per-axis coloured noise with the measured power spectra, synthesised once by
//    inverse FFT of random-phase spectra and looped. Rotation shake is a small rotation about
//    the phone's own axes (tilt / pan / roll), as the wrist moves it, with the measured
//    pan -> roll coupling. Part of the translation follows the rotation through the fitted
//    lever arm (the phone swings about the wrist / elbow), the rest is independent hand drift.
//    Shake grows with how fast the operator is moving.
//
// Shake axes follow the analysis (OpenCV camera: x right, y down, z forward) and are mapped to
// three.js camera axes (x right, y up, looking down -z) when applied.
//
// Everything is deterministic for a given seed.

import * as THREE from 'three';

// ---------------------------------------------------------------------------------------
function mulberry32( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

function gaussian( rand ) {

	const u = Math.max( rand(), 1e-12 ), v = rand();
	return Math.sqrt( - 2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );

}

// in-place radix-2 complex FFT (inverse when inv = true, unnormalised)
function fft( re, im, inv ) {

	const n = re.length;
	for ( let i = 1, j = 0; i < n; ++ i ) {

		let bit = n >> 1;
		for ( ; j & bit; bit >>= 1 ) j ^= bit;
		j ^= bit;
		if ( i < j ) {

			[ re[ i ], re[ j ] ] = [ re[ j ], re[ i ] ];
			[ im[ i ], im[ j ] ] = [ im[ j ], im[ i ] ];

		}

	}

	for ( let len = 2; len <= n; len <<= 1 ) {

		const ang = ( inv ? 2 : - 2 ) * Math.PI / len;
		const wr = Math.cos( ang ), wi = Math.sin( ang );
		for ( let i = 0; i < n; i += len ) {

			let cr = 1, ci = 0;
			for ( let k = 0; k < len / 2; ++ k ) {

				const ar = re[ i + k ], ai = im[ i + k ];
				const br = re[ i + k + len / 2 ] * cr - im[ i + k + len / 2 ] * ci;
				const bi = re[ i + k + len / 2 ] * ci + im[ i + k + len / 2 ] * cr;
				re[ i + k ] = ar + br; im[ i + k ] = ai + bi;
				re[ i + k + len / 2 ] = ar - br; im[ i + k + len / 2 ] = ai - bi;
				const t = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = t;

			}

		}

	}

}

/**
 * Log-log interpolation of a PSD given on `freqs`; flat below the grid, falling as 1/f⁴ above it
 * (the measurement stops at the 15 Hz Nyquist limit; a slower roll-off would put energy where
 * 30 fps rendering aliases it back into the visible band).
 */
function psdAt( freqs, psd, f ) {

	if ( f <= freqs[ 0 ] ) return psd[ 0 ];
	const n = freqs.length;
	if ( f >= freqs[ n - 1 ] ) return psd[ n - 1 ] * ( freqs[ n - 1 ] / f ) ** 4;
	let i = 1;
	while ( freqs[ i ] < f ) ++ i;
	const t = Math.log( f / freqs[ i - 1 ] ) / Math.log( freqs[ i ] / freqs[ i - 1 ] );
	return Math.exp( Math.log( psd[ i - 1 ] ) * ( 1 - t ) + Math.log( psd[ i ] ) * t );

}

/**
 * Stationary Gaussian noise with a one-sided PSD (units²/Hz), as a looping buffer.
 * Frequencies below `fLow` are removed (that part belongs to the intended motion).
 */
function shapedNoise( rand, freqs, psd, { rate = 120, seconds = 68.27, fLow = 0.2, fHigh = Infinity } = {} ) {

	const n = 1 << Math.ceil( Math.log2( rate * seconds ) );
	const re = new Float64Array( n ), im = new Float64Array( n );
	const df = rate / n;
	for ( let k = 1; k < n / 2; ++ k ) {

		const f = k * df;
		if ( f < fLow ) continue;
		// one-sided PSD S: the ±f bin pair must carry variance S df. With independent real and
		// imaginary parts of variance a², the pair gives a sinusoid of variance 4a², so a = √(S df) / 2
		// above fHigh the measured spectrum is a flat floor (tracking noise, motion blur, rolling
		// shutter), not hand motion: roll it off as 1/f^4
		const roll = f > fHigh ? ( fHigh / f ) ** 2 : 1;
		const a = Math.sqrt( psdAt( freqs, psd, f ) * df ) / 2 * roll;
		const gr = gaussian( rand ) * a, gi = gaussian( rand ) * a;
		re[ k ] = gr; im[ k ] = gi;
		re[ n - k ] = gr; im[ n - k ] = - gi;

	}

	fft( re, im, true );
	return { data: re, rate };

}

function sampleLoop( buf, t ) {

	const x = t * buf.rate, n = buf.data.length;
	const i = Math.floor( x ), f = x - i;
	const a = buf.data[ ( ( i % n ) + n ) % n ], b = buf.data[ ( ( ( i + 1 ) % n ) + n ) % n ];
	return a + ( b - a ) * f;

}

const _rv = new THREE.Vector3();

// ---------------------------------------------------------------------------------------
export class HandheldCamera {

	/**
	 * @param params   handheld_params.json (fitted from video)
	 * @param options  { seed, intensity (overall shake gain), followTime (s), moveGain }
	 */
	constructor( params, { seed = 1, intensity = 1, followTime = 0.22, moveGain = 3, cutoff = Infinity } = {} ) {

		this.params = params;
		this.intensity = intensity;
		this.followTime = followTime;
		this.moveGain = moveGain;		// shake while moving / shake while holding still (measured ~3)
		this.cutoff = cutoff;			// Hz, roll-off of the measured spectra (Infinity = as measured)
		this.setSeed( seed );
		this.keys = [];
		this._pos = new THREE.Vector3();
		this._target = new THREE.Vector3();

	}

	setSeed( seed ) {

		const p = this.params, rand = mulberry32( seed );
		const F = p.psd_freq_hz;
		const fLow = 0.6 * p.split_hz;
		const R = p.rot_psd_deg2_per_hz;
		// rotation shake (deg). Roll = independent part + rho * (sigma_roll / sigma_pan) * pan.
		const rho = p.rot_cross_corr ? p.rot_cross_corr[ 1 ][ 2 ] : 0;
		const rmsOf = psd => Math.sqrt( psd.reduce( ( a, v, i ) => a + v * ( i ? F[ i ] - F[ i - 1 ] : F[ 0 ] ), 0 ) );
		this.rollFromPan = rho * rmsOf( R.roll ) / rmsOf( R.pan );
		this.rot = [
			shapedNoise( rand, F, R.tilt, { fLow, fHigh: this.cutoff } ),
			shapedNoise( rand, F, R.pan, { fLow, fHigh: this.cutoff } ),
			shapedNoise( rand, F, R.roll.map( v => v * ( 1 - rho * rho ) ), { fLow, fHigh: this.cutoff } ),
		];
		// translation shake not explained by the lever arm (mm): measured minus coupled part.
		// lever (m/rad): right = lever.pan * pan, down = lever.tilt * tilt
		const lever = p.lever_arm_m;
		this.leverMmPerDeg = { pan: lever.pan * 1000 * Math.PI / 180, tilt: lever.tilt * 1000 * Math.PI / 180 };
		const couple = { x: [ 'pan', this.leverMmPerDeg.pan ], y: [ 'tilt', this.leverMmPerDeg.tilt ] };
		this.trans = [ 'x', 'y', 'z' ].map( k => {

			const tot = p.pos_psd_mm2_per_hz[ k ];
			const c = couple[ k ];
			const own = c ? tot.map( ( v, i ) => Math.max( 0.15 * v, v - ( c[ 1 ] ** 2 ) * R[ c[ 0 ] ][ i ] ) ) : tot;
			return shapedNoise( rand, F, own, { fLow, fHigh: this.cutoff } );

		} );
		this.reset();

	}

	/**
	 * keys: [ { t, position: [x,y,z] | Vector3, target: [x,y,z] | Vector3, roll?: deg } ],
	 * sorted by t. `roll` is the intended horizon tilt (handheld shots are rarely level).
	 */
	setPath( keys ) {

		const v = a => ( a.isVector3 ? a.clone() : new THREE.Vector3( ...a ) );
		this.keys = keys.map( k => ( { t: k.t, position: v( k.position ), target: v( k.target ), roll: k.roll ?? 0 } ) );
		const ts = this.keys.map( k => k.t );
		const curve = pts => {

			const c = new THREE.CatmullRomCurve3( pts, false, 'centripetal' );
			// map time -> curve parameter piecewise-linearly between keys
			return t => {

				const n = ts.length;
				if ( n === 1 ) return pts[ 0 ].clone();
				let i = 0;
				while ( i < n - 2 && t > ts[ i + 1 ] ) ++ i;
				const u = THREE.MathUtils.clamp( ( t - ts[ i ] ) / ( ts[ i + 1 ] - ts[ i ] ), 0, 1 );
				return c.getPoint( ( i + u ) / ( n - 1 ) );

			};

		};

		this.posAt = curve( this.keys.map( k => k.position ) );
		this.targetAt = curve( this.keys.map( k => k.target ) );
		const rollCurve = curve( this.keys.map( k => new THREE.Vector3( k.roll, 0, 0 ) ) );
		this.rollAt = t => rollCurve( t ).x;

		// normalise the speed-dependent gain so its RMS over this path is 1: the fitted spectra
		// are averages over a shot that mixes holds and moves
		this._gainNorm = 1;
		const dt = 1 / 30;
		let sum = 0, n = 0;
		this.reset();
		for ( let t = 0; t <= this.duration; t += dt ) {

			this._advance( t );
			sum += this._rawGain() ** 2;
			++ n;

		}

		this._gainNorm = n ? 1 / Math.sqrt( sum / n ) : 1;
		this.reset();

	}

	get duration() {

		return this.keys.length ? this.keys[ this.keys.length - 1 ].t : 0;

	}

	reset() {

		this._t = null;
		this._vel = new THREE.Vector3();
		this._tvel = new THREE.Vector3();

	}

	// critically damped follower (one step), ω = 2 / followTime
	_follow( x, v, goal, dt ) {

		const w = 2 / this.followTime;
		const a = new THREE.Vector3().subVectors( goal, x ).multiplyScalar( w * w ).addScaledVector( v, - 2 * w );
		v.addScaledVector( a, dt );
		x.addScaledVector( v, dt );

	}

	// operator activity in [0, 1]: walking / reaching (camera speed) or panning (rate at which
	// the aim point sweeps across the view); shake grows from 1x (holding) to moveGain x
	_rawGain() {

		const dist = Math.max( 0.2, this._pos.distanceTo( this._target ) );
		const panRate = this._tvel.length() / dist;							// rad/s, approx.
		// dead zones: below ~3 cm/s and ~4°/s the operator is holding the shot
		const ramp = ( x, a, b ) => THREE.MathUtils.clamp( ( x - a ) / ( b - a ), 0, 1 );
		const activity = Math.min( 1, ramp( this._vel.length(), 0.03, 0.10 ) + ramp( panRate * 180 / Math.PI, 4, 12 ) );
		return 1 + ( this.moveGain - 1 ) * activity;

	}

	_advance( t ) {

		if ( this._t === null || t < this._t || t - this._t > 1 ) {

			this._pos.copy( this.posAt( t ) );
			this._target.copy( this.targetAt( t ) );
			this._vel.set( 0, 0, 0 );
			this._tvel.set( 0, 0, 0 );
			this._t = t;

		}

		// sub-step the follower at ≤ 1/240 s
		const steps = Math.max( 1, Math.ceil( ( t - this._t ) * 240 ) );
		const dt = ( t - this._t ) / steps;
		for ( let i = 1; i <= steps; ++ i ) {

			const ti = this._t + dt * i;
			this._follow( this._pos, this._vel, this.posAt( ti ), dt );
			this._follow( this._target, this._tvel, this.targetAt( ti ), dt );

		}

		this._t = t;

	}

	/**
	 * Hand shake at time t with gain g, relative to the intended pose, in three.js camera axes:
	 * `rotation` to post-multiply onto the camera quaternion, `offset` (metres) in camera space.
	 * Usable on its own, e.g. on top of an interactively driven camera.
	 */
	shakeAt( t, g = this.intensity, rotation = new THREE.Quaternion(), offset = new THREE.Vector3() ) {

		const D = THREE.MathUtils.DEG2RAD;
		// rotation about the phone's own axes (OpenCV axes; deg)
		const tilt = sampleLoop( this.rot[ 0 ], t ) * g;
		const pan = sampleLoop( this.rot[ 1 ], t ) * g;
		const roll = sampleLoop( this.rot[ 2 ], t ) * g + this.rollFromPan * pan;
		// OpenCV (x right, y down, z forward) -> three.js camera (x right, y up, z backward)
		_rv.set( tilt, - pan, - roll ).multiplyScalar( D );
		const angle = _rv.length();
		if ( angle > 0 ) rotation.setFromAxisAngle( _rv.divideScalar( angle ), angle );
		else rotation.identity();

		// translation (mm, OpenCV axes): lever-arm part follows the rotation, plus independent drift
		const right = sampleLoop( this.trans[ 0 ], t ) * g + this.leverMmPerDeg.pan * pan;
		const down = sampleLoop( this.trans[ 1 ], t ) * g + this.leverMmPerDeg.tilt * tilt;
		const forward = sampleLoop( this.trans[ 2 ], t ) * g;
		offset.set( right, - down, - forward ).multiplyScalar( 0.001 );
		return { rotation, offset };

	}

	/**
	 * Camera pose at time t (seconds). Call with increasing t for the follow filter; a jump
	 * backwards restarts it. Writes into `camera` (position + quaternion) if given.
	 */
	update( t, camera = null ) {

		if ( ! this.keys.length ) return null;
		this._advance( t );

		// shake gain rises with operator speed (stepping, swinging the arm)
		const g = this.intensity * this._rawGain() * this._gainNorm;

		// intended orientation: look at the target, with the intended horizon tilt
		const m = new THREE.Matrix4().lookAt( this._pos, this._target, new THREE.Vector3( 0, 1, 0 ) );
		const D = THREE.MathUtils.DEG2RAD;
		const base = new THREE.Quaternion().setFromRotationMatrix( m )
			.multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), this.rollAt( t ) * D ) );

		const { rotation, offset } = this.shakeAt( t, g );
		const q = base.clone().multiply( rotation );
		const pos = this._pos.clone().add( offset.applyQuaternion( base ) );

		if ( camera ) {

			camera.position.copy( pos );
			camera.quaternion.copy( q );

		}

		return { position: pos, quaternion: q };

	}

}

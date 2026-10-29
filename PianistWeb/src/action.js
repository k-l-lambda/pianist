// Piano action driven by key presses.
//
// Hammer: a press throws it to the string (accelerating; faster for louder notes) and it
// springs straight back to rest after the blow, independent of how long the key is held.
// Damper: lifts off the string while the key is down (or the sustain pedal is held, or the
// sostenuto pedal caught it lifted) and falls back onto it when all of these are released.
// Pedals: each pedal lever rotates down when pressed. The soft (left) pedal shifts the
// keyboard together with the hammers sideways (una corda); the strings stay, so each hammer
// moves off one string of its unison and strikes two of the three.

const REBOUND_TIME = 0.09;		// string contact -> back at rest
const DAMPER_LIFT_TIME = 0.03;
const DAMPER_FALL_TIME = 0.06;
const DAMPER_DELAY = 0.012;		// dampers start lifting partway into the key stroke
const PEDAL_TIME = 0.06;
const PEDAL_ANGLE = 0.09;		// lever rotation when fully down (~5°)

export class PianoAction {

	/**
	 * @param hammers Map pitch -> { node, strike }  (node.rotation.x = strike at the string)
	 * @param dampers Map pitch -> { node, axis, lift } (node.position[axis] offset when lifted)
	 * @param pedals { soft, sostenuto, sustain } -> pivot nodes rotating about x
	 * @param softShift node(s) the soft pedal shifts along x by `softShiftAmount`
	 *        (the keyboard, and the hammers where they are modelled)
	 */
	constructor( { hammers = new Map(), dampers = new Map(), pedals = {}, softShift = [], softShiftAmount = 0.003 } = {} ) {

		this.hammers = new Map();
		for ( const [ pitch, h ] of hammers ) {

			this.hammers.set( pitch, { ...h, angle: 0, phase: 'rest', t: 0, dur: 1, from: 0, to: 0 } );

		}

		this.dampers = new Map();
		for ( const [ pitch, d ] of dampers ) {

			this.dampers.set( pitch, { ...d, base: d.node.position[ d.axis ], amount: 0, held: false, delay: 0 } );

		}

		this.sustain = false;
		this.sostenuto = false;
		this.pedalNodes = pedals;
		this.pedalState = { soft: 0, sostenuto: 0, sustain: 0 };
		this.pedalDown = { soft: false, sostenuto: false, sustain: false };
		this.softShift = ( Array.isArray( softShift ) ? softShift : [ softShift ] ).filter( Boolean ).map( node => ( { node, base: node.position.x } ) );
		this.softShiftAmount = softShiftAmount;

	}

	setPedal( name, on ) {

		this.pedalDown[ name ] = on;
		if ( name === 'sustain' ) this.sustain = on;
		if ( name === 'sostenuto' ) {

			this.sostenuto = on;
			// catches only the dampers that are lifted by their keys right now
			for ( const d of this.dampers.values() ) d.latched = on && d.held;

		}

	}

	_ease( x ) {

		return x * x * ( 3 - 2 * x );

	}

	_go( st, phase, to, dur ) {

		st.phase = phase;
		st.from = st.angle;
		st.to = to;
		st.t = 0;
		st.dur = dur;

	}

	press( pitch, velocity = 0.8 ) {

		const h = this.hammers.get( pitch );
		// key travel + hammer flight: ~70 ms soft, ~25 ms loud; restarts from wherever it is
		if ( h ) this._go( h, 'fly', h.strike, 0.07 - 0.045 * velocity );

		const d = this.dampers.get( pitch );
		if ( d ) {

			d.held = true;
			d.delay = DAMPER_DELAY;

		}

	}

	release( pitch ) {

		const d = this.dampers.get( pitch );
		if ( d ) d.held = false;

	}

	setSustain( on ) {

		this.setPedal( 'sustain', on );

	}

	/** Returns true while anything is moving. */
	update( dt ) {

		let moving = false;

		for ( const st of this.hammers.values() ) {

			if ( st.phase === 'rest' ) continue;
			moving = true;
			st.t = Math.min( st.t + dt, st.dur );
			const u = st.t / st.dur;
			// fly: accelerating into the string; rebound: fast off the string, easing to rest
			const e = st.phase === 'fly' ? u * u : 1 - ( 1 - u ) * ( 1 - u );
			st.angle = st.from + ( st.to - st.from ) * e;
			st.node.rotation.x = st.angle;

			if ( st.t >= st.dur ) {

				if ( st.phase === 'fly' ) this._go( st, 'rebound', 0, REBOUND_TIME );
				else st.phase = 'rest';

			}

		}

		for ( const d of this.dampers.values() ) {

			const up = d.held || this.sustain || d.latched;
			if ( up && d.delay > 0 ) {

				d.delay -= dt;
				moving = true;
				continue;

			}

			const target = up ? 1 : 0;
			if ( d.amount === target ) continue;
			moving = true;
			const step = dt / ( up ? DAMPER_LIFT_TIME : DAMPER_FALL_TIME );
			d.amount = up ? Math.min( 1, d.amount + step ) : Math.max( 0, d.amount - step );
			const e = d.amount * d.amount * ( 3 - 2 * d.amount );
			d.node.position[ d.axis ] = d.base + d.lift * e;

		}

		// pedals, and what the soft pedal moves
		for ( const name of [ 'soft', 'sostenuto', 'sustain' ] ) {

			const target = this.pedalDown[ name ] ? 1 : 0;
			const v = this.pedalState[ name ];
			if ( v === target ) continue;
			moving = true;
			const step = dt / PEDAL_TIME;
			this.pedalState[ name ] = target > v ? Math.min( 1, v + step ) : Math.max( 0, v - step );
			const e = this._ease( this.pedalState[ name ] );
			const node = this.pedalNodes[ name ];
			if ( node ) node.rotation.x = PEDAL_ANGLE * e;
			if ( name === 'soft' ) for ( const s of this.softShift ) s.node.position.x = s.base + this.softShiftAmount * e;

		}

		return moving;

	}

}

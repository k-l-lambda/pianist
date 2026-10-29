// Piano action driven by key presses.
//
// Hammer: a press throws it to the string (accelerating; faster for louder notes) and it
// springs straight back to rest after the blow, independent of how long the key is held.
// Damper: lifts off the string while the key is down (or the sustain pedal is held) and
// falls back onto it when both are released.

const REBOUND_TIME = 0.09;		// string contact -> back at rest
const DAMPER_LIFT_TIME = 0.03;
const DAMPER_FALL_TIME = 0.06;
const DAMPER_DELAY = 0.012;		// dampers start lifting partway into the key stroke

export class PianoAction {

	/**
	 * @param hammers Map pitch -> { node, strike }  (node.rotation.x = strike at the string)
	 * @param dampers Map pitch -> { node, axis, lift } (node.position[axis] offset when lifted)
	 */
	constructor( { hammers = new Map(), dampers = new Map() } = {} ) {

		this.hammers = new Map();
		for ( const [ pitch, h ] of hammers ) {

			this.hammers.set( pitch, { ...h, angle: 0, phase: 'rest', t: 0, dur: 1, from: 0, to: 0 } );

		}

		this.dampers = new Map();
		for ( const [ pitch, d ] of dampers ) {

			this.dampers.set( pitch, { ...d, base: d.node.position[ d.axis ], amount: 0, held: false, delay: 0 } );

		}

		this.sustain = false;

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

		this.sustain = on;

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

			const up = d.held || this.sustain;
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

		return moving;

	}

}

// Upright hammer motion driven by key presses:
// a press throws the hammer to its string (accelerating, faster for louder notes), it rebounds
// and is caught at the check while the key stays down, and falls back to rest on release.
// Pressing again from the check position repeats the blow.

const CHECK = 0.55;			// caught at this fraction of the strike angle
const REBOUND_TIME = 0.05;
const RETURN_TIME = 0.14;

export class HammerAction {

	/** @param hammers Map pitch -> { node, strike } (strike = rotation.x at the string) */
	constructor( hammers ) {

		this.hammers = new Map();
		for ( const [ pitch, h ] of hammers ) {

			this.hammers.set( pitch, { ...h, angle: 0, phase: 'rest', held: false, t: 0, dur: 1, from: 0, to: 0 } );

		}

	}

	_go( st, phase, to, dur ) {

		st.phase = phase;
		st.from = st.angle;
		st.to = to;
		st.t = 0;
		st.dur = dur;

	}

	press( pitch, velocity = 0.8 ) {

		const st = this.hammers.get( pitch );
		if ( ! st ) return;
		st.held = true;
		// key travel + hammer flight: ~70 ms soft, ~25 ms loud
		this._go( st, 'fly', st.strike, 0.07 - 0.045 * velocity );

	}

	release( pitch ) {

		const st = this.hammers.get( pitch );
		if ( ! st ) return;
		st.held = false;
		if ( st.phase === 'check' ) this._go( st, 'return', 0, RETURN_TIME );

	}

	/** Returns true while any hammer is moving. */
	update( dt ) {

		let moving = false;
		for ( const st of this.hammers.values() ) {

			if ( st.phase === 'rest' || st.phase === 'check' ) continue;
			moving = true;
			st.t = Math.min( st.t + dt, st.dur );
			const u = st.t / st.dur;
			// fly: accelerating; rebound: decelerating; return: smooth
			const e = st.phase === 'fly' ? u * u : st.phase === 'rebound' ? 1 - ( 1 - u ) * ( 1 - u ) : u * u * ( 3 - 2 * u );
			st.angle = st.from + ( st.to - st.from ) * e;
			st.node.rotation.x = st.angle;

			if ( st.t >= st.dur ) {

				if ( st.phase === 'fly' ) this._go( st, 'rebound', st.strike * CHECK, REBOUND_TIME );
				else if ( st.phase === 'rebound' ) {

					if ( st.held ) st.phase = 'check';
					else this._go( st, 'return', 0, RETURN_TIME );

				} else st.phase = 'rest';

			}

		}

		return moving;

	}

}

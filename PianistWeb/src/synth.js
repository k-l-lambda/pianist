// Small additive piano-like synth (WebAudio) so pressing keys makes a sound.

export class Synth {

	constructor() {

		this.ctx = null;
		this.voices = new Map();
		this.volume = 0.5;
		this.sustain = false;

	}

	_ensure() {

		if ( ! this.ctx ) {

			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = this.volume;
			const comp = this.ctx.createDynamicsCompressor();
			this.master.connect( comp ).connect( this.ctx.destination );

		}

		if ( this.ctx.state === 'suspended' ) this.ctx.resume();
		return this.ctx;

	}

	setVolume( v ) {

		this.volume = v;
		if ( this.master ) this.master.gain.value = v;

	}

	noteOn( pitch, velocity = 0.8 ) {

		const ctx = this._ensure();
		this.noteOff( pitch, true );

		const f0 = 440 * Math.pow( 2, ( pitch - 69 ) / 12 );
		const t = ctx.currentTime;
		const out = ctx.createGain();
		// lower notes ring longer
		const decay = 1.5 + 6 * Math.pow( 1 - ( pitch - 21 ) / 87, 1.5 );
		out.gain.setValueAtTime( 0, t );
		out.gain.linearRampToValueAtTime( 0.25 * velocity, t + 0.004 );
		out.gain.setTargetAtTime( 0.0, t + 0.004, decay / 4 );

		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime( Math.min( 18000, f0 * ( 6 + 14 * velocity ) ), t );
		filter.frequency.setTargetAtTime( f0 * 3, t, decay / 6 );
		filter.connect( out ).connect( this.master );

		const B = 0.0004;	// string inharmonicity
		const oscs = [];
		for ( let n = 1; n <= 8; ++ n ) {

			const f = f0 * n * Math.sqrt( 1 + B * n * n );
			if ( f > 16000 ) break;
			const osc = ctx.createOscillator();
			osc.frequency.value = f * ( 1 + ( Math.random() - 0.5 ) * 0.0008 );
			const g = ctx.createGain();
			g.gain.value = 1 / Math.pow( n, 1.3 );
			g.gain.setTargetAtTime( 0, t, decay / ( 2 + n ) );
			osc.connect( g ).connect( filter );
			osc.start( t );
			oscs.push( osc );

		}

		this.voices.set( pitch, { out, oscs } );

	}

	noteOff( pitch, immediate = false ) {

		const v = this.voices.get( pitch );
		if ( ! v || ( this.sustain && ! immediate ) ) return;
		const t = this.ctx.currentTime;
		v.out.gain.cancelScheduledValues( t );
		v.out.gain.setTargetAtTime( 0, t, immediate ? 0.01 : 0.08 );
		v.oscs.forEach( o => o.stop( t + 0.6 ) );
		this.voices.delete( pitch );

	}

}

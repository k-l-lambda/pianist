// Piano sound for live playing. Uses the FluidSynth grand piano (soundfont.js) once it has
// loaded, and a small additive WebAudio synth before that or if it can't load.
// Pedal semantics are handled here for live notes: `sustain` and `latched` (sostenuto)
// defer noteOff, `soft` makes notes quieter (and darker on the additive synth).

import { FluidPiano } from './soundfont.js';

export class Synth {

	constructor() {

		this.ctx = null;
		this.voices = new Map();
		this.volume = 0.5;
		this.sustain = false;
		this.soft = false;				// soft pedal: quieter, darker
		this.latched = new Set();		// notes held by the sostenuto pedal
		this.fluid = null;

	}

	/** The shared AudioContext and output (created on first use). */
	context() {

		if ( ! this.ctx ) {

			this.ctx = new AudioContext();
			this.master = this.ctx.createGain();
			this.master.gain.value = this.volume;
			const comp = this.ctx.createDynamicsCompressor();
			this.master.connect( comp ).connect( this.ctx.destination );
			this.fluid = new FluidPiano( this.ctx, this.master );

		}

		return this.ctx;

	}

	/** Start loading the soundfont piano (safe to call repeatedly). */
	load() {

		this.context();
		return this.fluid.load();

	}

	/** Resume audio output; call from a user gesture. */
	resume() {

		const ctx = this.context();
		if ( ctx.state === 'suspended' ) return ctx.resume();
		return Promise.resolve();

	}

	get fluidReady() {

		return !! this.fluid?.ready;

	}

	_ensure() {

		this.context();
		if ( this.ctx.state === 'suspended' ) this.ctx.resume();
		if ( ! this.fluid.loading ) this.fluid.load();
		return this.ctx;

	}

	setVolume( v ) {

		this.volume = v;
		if ( this.master ) this.master.gain.value = v;

	}

	noteOn( pitch, velocity = 0.8 ) {

		const ctx = this._ensure();
		this.noteOff( pitch, true );
		if ( this.soft ) velocity *= 0.7;

		if ( this.fluid.ready ) {

			this.fluid.noteOn( pitch, Math.max( 1, Math.min( 127, Math.round( velocity * 127 ) ) ) );
			this.voices.set( pitch, { fluid: true } );
			return;

		}

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
		filter.frequency.setValueAtTime( Math.min( 18000, f0 * ( 6 + 14 * velocity ) * ( this.soft ? 0.6 : 1 ) ), t );
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
		if ( ! v || ( ( this.sustain || this.latched.has( pitch ) ) && ! immediate ) ) return;
		this.voices.delete( pitch );
		if ( v.fluid ) {

			this.fluid.noteOff( pitch );
			return;

		}

		const t = this.ctx.currentTime;
		v.out.gain.cancelScheduledValues( t );
		v.out.gain.setTargetAtTime( 0, t, immediate ? 0.01 : 0.08 );
		v.oscs.forEach( o => o.stop( t + 0.6 ) );

	}

}

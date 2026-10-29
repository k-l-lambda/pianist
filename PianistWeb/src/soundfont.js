// FluidSynth (js-synthesizer, WASM in an AudioWorklet) playing the grand piano extracted
// from the GM SoundFont (tools/extract-piano.mjs -> public/soundfont/piano.sf3).
//
// Two kinds of input use it:
//  - live notes (mouse, computer keyboard, Web MIDI) on LIVE_CHANNEL, immediately;
//  - MIDI file playback through FluidSynth's sequencer, scheduled ahead with sample
//    accurate timing (sendEventAt with a relative delay, 1 tick = 1 ms), on the file's
//    own channels, so the file's pedals don't affect live notes and vice versa.

import { AudioWorkletNodeSynthesizer } from 'js-synthesizer';

const BASE = import.meta.env.BASE_URL;
const SOUNDFONT_URL = BASE + 'soundfont/piano.sf3';
const LIBFLUIDSYNTH_URL = BASE + 'fluid/libfluidsynth-with-libsndfile.js';
const WORKLET_URL = BASE + 'fluid/js-synthesizer.worklet.js';

export const LIVE_CHANNEL = 15;

export class FluidPiano {

	constructor( ctx, destination ) {

		this.ctx = ctx;
		this.destination = destination;
		this.synth = null;
		this.seq = null;
		this.sfont = null;
		this.ready = false;
		this.error = null;
		this.loading = null;

	}

	load() {

		if ( this.loading ) return this.loading;
		this.loading = ( async () => {

			const { ctx } = this;
			// libfluidsynth must be loaded into the worklet scope before the processor script
			await ctx.audioWorklet.addModule( LIBFLUIDSYNTH_URL );
			await ctx.audioWorklet.addModule( WORKLET_URL );

			const synth = new AudioWorkletNodeSynthesizer();
			synth.init( ctx.sampleRate );
			const node = synth.createAudioNode( ctx, { initialGain: 1.8 } );		// before any other call
			node.connect( this.destination );

			const res = await fetch( SOUNDFONT_URL );
			if ( ! res.ok ) throw new Error( `${ SOUNDFONT_URL }: HTTP ${ res.status }` );
			this.sfont = await synth.loadSFont( await res.arrayBuffer() );

			// every channel plays the piano, including GM channel 10 (drums)
			for ( let ch = 0; ch < 16; ++ ch ) {

				synth.midiSetChannelType( ch, false );
				synth.midiProgramSelect( ch, this.sfont, 0, 0 );

			}

			const seq = await synth.createSequencer();
			await seq.registerSynthesizer( synth );
			seq.setTimeScale( 1000 );

			this.synth = synth;
			this.seq = seq;
			this.node = node;
			this.ready = true;

		} )().catch( err => {

			this.error = err;
			console.warn( 'FluidSynth piano unavailable, using the built-in synth:', err );

		} );
		return this.loading;

	}

	// ---- live -----------------------------------------------------------------------------
	noteOn( pitch, vel127 ) {

		this.synth.midiNoteOn( LIVE_CHANNEL, pitch, vel127 );

	}

	noteOff( pitch ) {

		this.synth.midiNoteOff( LIVE_CHANNEL, pitch );

	}

	// ---- scheduled (MIDI file) --------------------------------------------------------------
	/** Send a channel event `delayMs` from now. */
	scheduleAt( event, delayMs ) {

		this.seq.sendEventAt( event, Math.max( 0, delayMs ), false );

	}

	/** Drop everything scheduled and silence the given channels, resetting their pedals. */
	silence( channels ) {

		if ( ! this.ready ) return;
		this.seq.removeAllEvents();
		for ( const ch of channels ) {

			if ( ch === LIVE_CHANNEL ) continue;
			// lift the hold pedals first: a discarded pedal-up would leave the channel stuck
			this.synth.midiControl( ch, 64, 0 );
			this.synth.midiControl( ch, 66, 0 );
			this.synth.midiControl( ch, 67, 0 );
			this.synth.midiAllSoundsOff( ch );

		}

		this.resetChannels();

	}

	/**
	 * Put every file channel back to a plain piano: program/bank, volume, expression,
	 * modulation, pan and pitch bend. The player only sends notes and pedals, but this also
	 * clears anything left by an earlier session.
	 */
	resetChannels() {

		if ( ! this.ready ) return;
		const s = this.synth;
		for ( let ch = 0; ch < 16; ++ ch ) {

			if ( ch === LIVE_CHANNEL ) continue;
			s.midiSetChannelType( ch, false );
			s.midiProgramSelect( ch, this.sfont, 0, 0 );
			s.midiControl( ch, 1, 0 );			// modulation
			s.midiControl( ch, 7, 100 );		// volume
			s.midiControl( ch, 10, 64 );		// pan
			s.midiControl( ch, 11, 127 );		// expression
			s.midiPitchBend( ch, 8192 );

		}

	}

	setGain( g ) {

		this.synth?.setGain( g );

	}

}

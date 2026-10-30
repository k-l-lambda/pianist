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

// ---- soundfont download: started at page load, streamed with progress, retried, cached ----
// Bump SOUNDFONT_VERSION whenever piano.sf3 changes, so cached copies are replaced.
const SOUNDFONT_VERSION = '1';
const CACHE_NAME = 'pianist-soundfont';
const CACHE_KEY = SOUNDFONT_URL + '?v=' + SOUNDFONT_VERSION;

/** Loading state of the piano sound, for the UI. phase: idle | download | decode | ready | failed */
export const soundfontStatus = { phase: 'idle', received: 0, total: 0, fromCache: false, error: null };

let prefetch = null;

async function openCache() {

	try {

		return 'caches' in self ? await caches.open( CACHE_NAME ) : null;

	} catch {

		return null;		// e.g. insecure context, private mode

	}

}

async function download() {

	const res = await fetch( SOUNDFONT_URL, { cache: 'no-cache' } );
	if ( ! res.ok ) throw new Error( `${ SOUNDFONT_URL }: HTTP ${ res.status }` );
	soundfontStatus.total = Number( res.headers.get( 'content-length' ) ) || 0;
	if ( ! res.body ) return res.arrayBuffer();
	const reader = res.body.getReader();
	const chunks = [];
	soundfontStatus.received = 0;
	for ( ;; ) {

		const { done, value } = await reader.read();
		if ( done ) break;
		chunks.push( value );
		soundfontStatus.received += value.length;

	}

	const out = new Uint8Array( soundfontStatus.received );
	let o = 0;
	for ( const c of chunks ) {

		out.set( c, o );
		o += c.length;

	}

	return out.buffer;

}

/**
 * Fetch piano.sf3 once per page (safe to call repeatedly). Served from the Cache API when a
 * previous visit stored it; otherwise downloaded (one retry) and then stored.
 */
export function prefetchSoundfont() {

	if ( prefetch ) return prefetch;
	prefetch = ( async () => {

		soundfontStatus.phase = 'download';
		const cache = await openCache();
		const hit = cache && await cache.match( CACHE_KEY );
		if ( hit ) {

			soundfontStatus.fromCache = true;
			const buf = await hit.arrayBuffer();
			soundfontStatus.received = soundfontStatus.total = buf.byteLength;
			return buf;

		}

		let buf, lastErr;
		for ( let attempt = 0; attempt < 2 && ! buf; ++ attempt ) {

			try {

				buf = await download();

			} catch ( err ) {

				lastErr = err;
				if ( attempt === 0 ) await new Promise( r => setTimeout( r, 1500 ) );

			}

		}

		if ( ! buf ) throw lastErr;
		if ( cache ) {

			// store a copy; drop older versions of the file
			cache.put( CACHE_KEY, new Response( buf.slice( 0 ), { headers: { 'content-type': 'application/octet-stream' } } ) ).catch( () => {} );
			cache.keys().then( keys => keys.forEach( k => k.url.endsWith( CACHE_KEY.split( '/' ).pop() ) || cache.delete( k ) ) ).catch( () => {} );

		}

		return buf;

	} )();
	prefetch.catch( err => {

		soundfontStatus.phase = 'failed';
		soundfontStatus.error = String( err );

	} );
	return prefetch;

}

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

			const buf = await prefetchSoundfont();
			soundfontStatus.phase = 'decode';
			this.sfont = await synth.loadSFont( buf );

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
			soundfontStatus.phase = 'ready';

		} )().catch( err => {

			this.error = err;
			soundfontStatus.phase = 'failed';
			soundfontStatus.error = String( err );
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

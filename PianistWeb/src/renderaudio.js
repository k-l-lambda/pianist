// Offline render mode, sound (see rendermode.js): every sound the page makes is logged at its
// simulated time while the frames are rendered, then rendered again offline and mixed:
//  - piano: each call into the live FluidSynth (live notes, the boot chime, MIDI file events
//    scheduled through its sequencer, pedals, fades, silencing) is logged; the log is replayed
//    sample-accurately into a second FluidSynth (the same libfluidsynth WASM build and soundfont,
//    on the main thread, same settings as soundfont.js);
//  - recordings (scene script audio: speech) are logged with their start, offset, volume and stop;
//  - both are mixed in an OfflineAudioContext through the same output as live (master gain at the
//    volume setting -> DynamicsCompressor with its defaults), and returned as a WAV file.
// The room simulation (tools/render-audio.mjs, tools/spatialise.py) uses the same replay through
// roomAPI: the two as dry stems before the output (piano without FluidSynth's reverb and chorus),
// and its mix back through the same output.

import { clock } from './rendermode.js';

const BASE = import.meta.env.BASE_URL;

export class AudioLog {

	constructor() {

		this.events = [];		// { t (ms), seq, type, ch, key, vel, cc, value }
		this.pending = [];		// sequencer events not yet due: dropped by removeAllEvents
		this.clips = [];		// { t, buffer, name, volume, from, stopAt }
		this.seq = 0;

	}

	_push( list, t, e ) {

		list.push( { t, seq: this.seq ++, ...e } );

	}

	/** Log everything sent to the live FluidPiano (soundfont.js), still passing it through. */
	attach( fluid ) {

		const s = fluid.synth, q = fluid.seq;
		const wrap = ( obj, name, toEvent ) => {

			const orig = obj[ name ].bind( obj );
			obj[ name ] = ( ...args ) => {

				const e = toEvent( ...args );
				if ( e ) this._push( this.events, clock.now(), e );
				return orig( ...args );

			};

		};
		wrap( s, 'midiNoteOn', ( ch, key, vel ) => ( { type: 'on', ch, key, vel } ) );
		wrap( s, 'midiNoteOff', ( ch, key ) => ( { type: 'off', ch, key } ) );
		wrap( s, 'midiControl', ( ch, cc, value ) => ( { type: 'cc', ch, cc, value } ) );
		wrap( s, 'midiPitchBend', ( ch, value ) => ( { type: 'bend', ch, value } ) );
		wrap( s, 'midiAllSoundsOff', ch => ( { type: 'soundsoff', ch } ) );
		wrap( s, 'midiAllNotesOff', ch => ( { type: 'notesoff', ch } ) );
		const send = q.sendEventAt.bind( q ), clear = q.removeAllEvents.bind( q );
		q.sendEventAt = ( event, tick, isAbsolute ) => {

			// soundfont.js sends relative ticks of 1 ms
			const t = isAbsolute ? tick : clock.now() + tick;
			const e = event.type === 'noteon' ? { type: 'on', ch: event.channel, key: event.key, vel: event.vel }
				: event.type === 'noteoff' ? { type: 'off', ch: event.channel, key: event.key }
					: event.type === 'controlchange' ? { type: 'cc', ch: event.channel, cc: event.control, value: event.value }
						: null;
			if ( e ) this._push( this.pending, t, e );
			else console.warn( 'render audio: sequencer event not logged:', event );
			return send( event, tick, isAbsolute );

		};
		q.removeAllEvents = () => {

			const now = clock.now();
			this.pending = this.pending.filter( e => e.t <= now );
			return clear();

		};

	}

	/** A recording started now; returns its handle ({ playing, stop() }) on the render clock. */
	clip( buffer, { volume = 1, from = 0, name = '' } = {} ) {

		const c = { t: clock.now(), buffer, name, volume, from: Math.max( 0, from ), stopAt: Infinity };
		this.clips.push( c );
		const end = c.t + 1000 * Math.max( 0, buffer.duration - c.from );
		return {
			get playing() { return clock.now() < Math.min( end, c.stopAt ); },
			stop: () => c.stopAt = Math.min( c.stopAt, clock.now() ),
		};

	}

	sorted() {

		return [ ...this.events, ...this.pending ].sort( ( a, b ) => a.t - b.t || a.seq - b.seq );

	}

	summary() {

		return {
			events: this.events.length + this.pending.length,
			clips: this.clips.map( c => ( { t: c.t / 1000, name: c.name, volume: c.volume, from: c.from, stop: Number.isFinite( c.stopAt ) ? c.stopAt / 1000 : null } ) ),
		};

	}

}

// the main-thread FluidSynth: libfluidsynth as a classic script (it defines the global Module)
let fluidModule = null;
function loadFluid() {

	fluidModule ??= new Promise( ( ok, fail ) => {

		const s = document.createElement( 'script' );
		s.src = BASE + 'fluid/libfluidsynth-with-libsndfile.js';
		s.onload = ok;
		s.onerror = () => fail( new Error( 'libfluidsynth failed to load' ) );
		document.head.appendChild( s );

	} ).then( () => import( 'js-synthesizer' ) ).then( async JS => {

		await JS.Synthesizer.waitForWasmInitialized();
		return JS;

	} );
	return fluidModule;

}

/**
 * Replay the piano log into a FluidSynth on the main thread: { L, R, total } (Float32Arrays of
 * [0, to] s). `fx: false`: without FluidSynth's reverb and chorus (on, at its defaults, in live use).
 */
async function replayPiano( log, { to, sampleRate, fx = true } ) {

	const JS = await loadFluid();
	const synth = new JS.Synthesizer();
	// as soundfont.js (createAudioNode)
	synth.init( sampleRate, fx ? { initialGain: 1.8 } : { initialGain: 1.8, reverbActive: false, chorusActive: false } );
	const sf = await ( await fetch( BASE + 'soundfont/piano.sf3' ) ).arrayBuffer();
	const sfont = await synth.loadSFont( sf );
	for ( let ch = 0; ch < 16; ++ ch ) {

		synth.midiSetChannelType( ch, false );
		synth.midiProgramSelect( ch, sfont, 0, 0 );

	}

	const total = Math.ceil( to * sampleRate );
	const L = new Float32Array( total ), R = new Float32Array( total );
	const BLOCK = 4096, bl = new Float32Array( BLOCK ), br = new Float32Array( BLOCK );
	let pos = 0;
	const renderTo = end => {

		while ( pos < end ) {

			const n = Math.min( BLOCK, end - pos );
			const a = n === BLOCK ? bl : bl.subarray( 0, n ), b = n === BLOCK ? br : br.subarray( 0, n );
			synth.render( [ a, b ] );
			L.set( a, pos );
			R.set( b, pos );
			pos += n;

		}

	};
	for ( const e of log.sorted() ) {

		const at = Math.round( e.t / 1000 * sampleRate );
		if ( at >= total ) break;
		renderTo( Math.max( pos, at ) );
		switch ( e.type ) {

			case 'on': synth.midiNoteOn( e.ch, e.key, e.vel ); break;
			case 'off': synth.midiNoteOff( e.ch, e.key ); break;
			case 'cc': synth.midiControl( e.ch, e.cc, e.value ); break;
			case 'bend': synth.midiPitchBend( e.ch, e.value ); break;
			case 'soundsoff': synth.midiAllSoundsOff( e.ch ); break;
			case 'notesoff': synth.midiAllNotesOff( e.ch ); break;

		}

	}

	renderTo( total );
	synth.close();
	return { L, R, total };

}

/**
 * Render [from, to] s of the logged sound as a 16-bit stereo WAV (ArrayBuffer). Sound before
 * `from` is rendered too (notes ring on), then cut.
 */
export async function renderAudio( log, { from, to, sampleRate, volume } ) {

	const { L, R, total } = await replayPiano( log, { to, sampleRate } );

	// mix through the live output chain
	const ctx = new OfflineAudioContext( 2, total, sampleRate );
	const master = ctx.createGain();
	master.gain.value = volume;
	master.connect( ctx.createDynamicsCompressor() ).connect( ctx.destination );
	const piano = ctx.createBuffer( 2, total, sampleRate );
	piano.copyToChannel( L, 0 );
	piano.copyToChannel( R, 1 );
	const ps = ctx.createBufferSource();
	ps.buffer = piano;
	ps.connect( master );
	ps.start( 0 );
	for ( const c of log.clips ) {

		const t = c.t / 1000;
		if ( t >= to ) continue;
		const src = ctx.createBufferSource(), gain = ctx.createGain();
		src.buffer = c.buffer;
		gain.gain.value = c.volume;
		src.connect( gain ).connect( master );
		src.start( t, c.from );
		if ( Number.isFinite( c.stopAt ) ) src.stop( c.stopAt / 1000 );

	}

	const out = await ctx.startRendering();
	return wav( out, Math.round( from * sampleRate ) );

}

/**
 * The dry stems of [0, to] s, before the output: { piano: [ L, R ], speech: mono } (Float32Arrays
 * at `sampleRate`); `fx` as replayPiano. Recordings at their volume, downmixed to mono.
 */
export async function renderStems( log, { to, sampleRate, fx = false } ) {

	const { L, R, total } = await replayPiano( log, { to, sampleRate, fx } );
	const ctx = new OfflineAudioContext( 1, total, sampleRate );
	for ( const c of log.clips ) {

		const t = c.t / 1000;
		if ( t >= to ) continue;
		const src = ctx.createBufferSource(), gain = ctx.createGain();
		src.buffer = c.buffer;
		gain.gain.value = c.volume;
		src.connect( gain ).connect( ctx.destination );
		src.start( t, c.from );
		if ( Number.isFinite( c.stopAt ) ) src.stop( c.stopAt / 1000 );

	}

	return { piano: [ L, R ], speech: ( await ctx.startRendering() ).getChannelData( 0 ) };

}

/**
 * A stereo mix ([ L, R ] Float32Arrays from 0 s) through the live output (master gain at
 * `volume` -> DynamicsCompressor with its defaults), cut at `from` s: { wav (16-bit), peak }.
 */
export async function master( [ L, R ], { from, sampleRate, volume } ) {

	const ctx = new OfflineAudioContext( 2, L.length, sampleRate );
	const gain = ctx.createGain();
	gain.gain.value = volume;
	gain.connect( ctx.createDynamicsCompressor() ).connect( ctx.destination );
	const buffer = ctx.createBuffer( 2, L.length, sampleRate );
	buffer.copyToChannel( L, 0 );
	buffer.copyToChannel( R, 1 );
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	src.connect( gain );
	src.start( 0 );
	const out = await ctx.startRendering();
	return wav( out, Math.round( from * sampleRate ) );

}

/** Float32Arrays (channels of the same length) as a 32-bit float WAV (ArrayBuffer). */
export function floatWav( channels, sampleRate ) {

	const n = channels[ 0 ].length, chs = channels.length;
	const data = new DataView( new ArrayBuffer( 44 + n * chs * 4 ) );
	const str = ( o, s ) => [ ...s ].forEach( ( c, i ) => data.setUint8( o + i, c.charCodeAt( 0 ) ) );
	str( 0, 'RIFF' );
	data.setUint32( 4, 36 + n * chs * 4, true );
	str( 8, 'WAVE' );
	str( 12, 'fmt ' );
	data.setUint32( 16, 16, true );
	data.setUint16( 20, 3, true );		// IEEE float
	data.setUint16( 22, chs, true );
	data.setUint32( 24, sampleRate, true );
	data.setUint32( 28, sampleRate * chs * 4, true );
	data.setUint16( 32, chs * 4, true );
	data.setUint16( 34, 32, true );
	str( 36, 'data' );
	data.setUint32( 40, n * chs * 4, true );
	let o = 44;
	for ( let i = 0; i < n; ++ i ) for ( let c = 0; c < chs; ++ c ) {

		data.setFloat32( o, channels[ c ][ i ], true );
		o += 4;

	}

	return data.buffer;

}

/** A float WAV (ArrayBuffer, as floatWav writes) back as Float32Array channels. */
export function readFloatWav( buffer ) {

	const d = new DataView( buffer );
	let o = 12, fmt = null;
	while ( o + 8 <= d.byteLength ) {

		const id = String.fromCharCode( d.getUint8( o ), d.getUint8( o + 1 ), d.getUint8( o + 2 ), d.getUint8( o + 3 ) ), size = d.getUint32( o + 4, true );
		if ( id === 'fmt ' ) fmt = { format: d.getUint16( o + 8, true ), chs: d.getUint16( o + 10, true ), bits: d.getUint16( o + 22, true ) };
		else if ( id === 'data' ) {

			if ( ! fmt || fmt.format !== 3 || fmt.bits !== 32 ) throw new Error( 'readFloatWav: 32-bit float WAV expected' );
			const n = Math.floor( size / ( 4 * fmt.chs ) );
			const out = Array.from( { length: fmt.chs }, () => new Float32Array( n ) );
			for ( let i = 0, p = o + 8; i < n; ++ i ) for ( let c = 0; c < fmt.chs; ++ c, p += 4 ) out[ c ][ i ] = d.getFloat32( p, true );
			return out;

		}

		o += 8 + size + ( size & 1 );

	}

	throw new Error( 'readFloatWav: no data chunk' );

}

function wav( buffer, start ) {

	const n = Math.max( 0, buffer.length - start ), chs = buffer.numberOfChannels, sr = buffer.sampleRate;
	const data = new DataView( new ArrayBuffer( 44 + n * chs * 2 ) );
	const str = ( o, s ) => [ ...s ].forEach( ( c, i ) => data.setUint8( o + i, c.charCodeAt( 0 ) ) );
	str( 0, 'RIFF' );
	data.setUint32( 4, 36 + n * chs * 2, true );
	str( 8, 'WAVE' );
	str( 12, 'fmt ' );
	data.setUint32( 16, 16, true );
	data.setUint16( 20, 1, true );
	data.setUint16( 22, chs, true );
	data.setUint32( 24, sr, true );
	data.setUint32( 28, sr * chs * 2, true );
	data.setUint16( 32, chs * 2, true );
	data.setUint16( 34, 16, true );
	str( 36, 'data' );
	data.setUint32( 40, n * chs * 2, true );
	const ch = Array.from( { length: chs }, ( _, c ) => buffer.getChannelData( c ) );
	let o = 44, peak = 0;
	for ( let i = start; i < buffer.length; ++ i ) for ( let c = 0; c < chs; ++ c ) {

		const v = ch[ c ][ i ];
		peak = Math.max( peak, Math.abs( v ) );
		data.setInt16( o, Math.max( - 32768, Math.min( 32767, Math.round( v * 32767 ) ) ), true );
		o += 2;

	}

	return { wav: data.buffer, peak };

}

/**
 * The room simulation's side of window.__render (tools/render-audio.mjs). Data goes as base64 in
 * chunks (page.evaluate passes strings):
 *  - stems( to, fx ): the dry stems as float WAVs, piano (stereo) then speech (mono), into one
 *    buffer -> { piano, speech } (base64 lengths), read with roomChunk( i, size );
 *  - mixBegin(), mixChunk( s ), mixMaster(): a float stereo WAV from 0 s through the live output,
 *    cut at `from` -> { length, peak }, the 16-bit WAV read with roomChunk.
 */
export function roomAPI( log, { from, sampleRate, volume } ) {

	const b64 = buffer => {

		const bytes = new Uint8Array( buffer ), parts = [];
		for ( let i = 0; i < bytes.length; i += 0x8000 ) parts.push( String.fromCharCode( ...bytes.subarray( i, i + 0x8000 ) ) );
		return btoa( parts.join( '' ) );

	};
	let out = '', input = [];
	return {
		async stems( to, fx = false ) {

			const { piano, speech } = await renderStems( log, { to, sampleRate, fx } );
			const p = b64( floatWav( piano, sampleRate ) ), s = b64( floatWav( [ speech ], sampleRate ) );
			out = p + s;
			return { piano: p.length, speech: s.length, sampleRate };

		},
		roomChunk: ( i, size ) => out.slice( i, i + size ),
		mixBegin: () => void ( input = [] ),
		mixChunk: s => void input.push( s ),
		async mixMaster() {

			const bin = atob( input.join( '' ) ), bytes = new Uint8Array( bin.length );
			for ( let i = 0; i < bin.length; ++ i ) bytes[ i ] = bin.charCodeAt( i );
			input = [];
			const [ L, R = L ] = readFloatWav( bytes.buffer );
			const { wav: w, peak } = await master( [ L, R ], { from, sampleRate, volume: volume() } );
			out = b64( w );
			return { length: out.length, peak };

		},
	};

}

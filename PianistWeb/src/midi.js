// MIDI file player, after klstudio's midi-player (MIDI parsing + a look-ahead scheduler
// feeding FluidSynth's sequencer with absolute timing).
//
// The file is parsed with @k-l-lambda/music-widgets (MIDI parser + its tempo-mapped track
// merge, giving every event an absolute time in ms). A short interval timer walks the events:
//  - sound: events inside the look-ahead window go to FluidSynth's sequencer with their
//    exact delay, so audio timing doesn't depend on frame rate. Until the soundfont has
//    loaded, notes go to the built-in synth at visual time instead.
//  - animation: the same events are replayed into the scene at their time (setTimeout), as
//    key/hammer/damper presses and pedal (CC64 sustain, CC66 sostenuto, CC67 soft) moves.
// Tempo scales file time; seeking or stopping releases every note and pedal the file holds.
//
// Everything plays as the piano: program and bank changes are ignored, and of the
// controllers only the three pedals are used (volume, expression, modulation, pitch bend
// etc. would otherwise detune or silence the piano, and stay set for the next file).

// Import the parser from source: the package's browser bundle also boots the legacy
// MIDI.js audio player as a side effect.
import * as MIDI from '@k-l-lambda/music-widgets/source/inc/MIDI/index.ts';
import { midiToSequence, fixOverlapNotes } from '@k-l-lambda/music-widgets/source/inc/MidiSequence.ts';

const LOOKAHEAD = 150;		// ms of file time scheduled ahead
const TICK = 25;			// scheduler period, ms
const PEDALS = { 64: 'sustain', 66: 'sostenuto', 67: 'soft' };
const PEDAL_CC = { sustain: 64, sostenuto: 66, soft: 67 };
const SOFT_VELOCITY = 0.7;	// soft pedal emulation for the soundfont (fluidsynth ignores CC67)

/** Parse a Standard MIDI File into time-ordered channel events: [{ time (ms), d: event }]. */
export function parseMidiEvents( buffer ) {

	const data = MIDI.parseMidiData( buffer );
	// merged, tempo-mapped sequence: [ { event, ticksToEvent }, deltaMs ]. (The library's
	// trimSequence would also drop same-tick controller events with different numbers,
	// e.g. a sustain-up and a soft-down together, so de-duplicate here instead.)
	const seq = fixOverlapNotes( midiToSequence( data ) );
	const kinds = new Set( [ 'noteOn', 'noteOff', 'controller' ] );
	const events = [];
	const seen = new Set();
	let time = 0, lastTime = - 1;
	for ( const [ { event }, delta ] of seq ) {

		time += delta;
		if ( time !== lastTime ) {

			seen.clear();
			lastTime = time;

		}

		if ( event.type !== 'channel' || ! kinds.has( event.subtype ) ) continue;
		if ( event.subtype === 'controller' && ! PEDALS[ event.controllerType ] ) continue;
		const key = `${ event.subtype }|${ event.channel }|${ event.noteNumber ?? event.controllerType ?? '' }|${ event.value ?? '' }`;
		if ( seen.has( key ) ) continue;
		seen.add( key );
		events.push( { time, d: event } );

	}

	return { events, duration: time };

}

export class MidiFilePlayer {

	/**
	 * @param synth  Synth (synth.fluid: FluidPiano once loaded)
	 * @param hooks  { noteOn( pitch, velocity01, { sound } ), noteOff( pitch, { sound } ),
	 *                 pedal( name, on ), onEnd() }
	 */
	constructor( synth, hooks ) {

		this.synth = synth;
		this.hooks = hooks;
		this.events = [];
		this.duration = 0;
		this.name = null;
		this.playing = false;
		this.rate = 1;
		this._pos = 0;				// file ms when not playing
		this._anchorWall = 0;		// performance.now() at file time _anchorFile
		this._anchorFile = 0;
		this._cursor = 0;
		this._timer = null;
		this._timeouts = new Set();
		this._held = new Map();		// pitch -> count of overlapping file notes
		this._pedalChannels = { sustain: new Set(), sostenuto: new Set(), soft: new Set() };
		this._softAhead = new Set();	// soft-pedal state at scheduling (look-ahead) time
		this._channels = new Set();

	}

	get position() {

		return this.playing ? this._anchorFile + ( performance.now() - this._anchorWall ) * this.rate : this._pos;

	}

	load( buffer, name = null ) {

		this.stop();
		// clean piano state on every channel (whatever an earlier file or instrument left set)
		this._fluid?.resetChannels();
		const { events, duration } = parseMidiEvents( buffer );
		this.events = events;
		this.duration = duration;
		this.name = name;
		this._channels = new Set( events.map( e => e.d.channel ) );
		this._pos = 0;
		this._cursor = 0;
		return { duration, notes: events.filter( e => e.d.subtype === 'noteOn' ).length };

	}

	play() {

		if ( this.playing || ! this.events.length ) return;
		if ( this._pos >= this.duration ) this._pos = 0;
		this._restorePedals( this._pos );
		this._cursor = this._indexAt( this._pos );
		this._anchorFile = this._pos;
		this._anchorWall = performance.now();
		this.playing = true;
		this._tick();
		this._timer = setInterval( () => this._tick(), TICK );

	}

	pause() {

		if ( ! this.playing ) return;
		this._pos = this.position;
		this._halt();

	}

	stop() {

		this._halt();
		this._pos = 0;
		this._cursor = 0;

	}

	seek( time ) {

		const was = this.playing;
		this._halt();
		this._pos = Math.max( 0, Math.min( time, this.duration ) );
		this._cursor = this._indexAt( this._pos );
		if ( was ) this.play();

	}

	setRate( rate ) {

		if ( this.playing ) {

			this._anchorFile = this.position;
			this._anchorWall = performance.now();

		}

		this.rate = rate;

	}

	// ---- internals ------------------------------------------------------------------------
	get _fluid() {

		return this.synth.fluidReady ? this.synth.fluid : null;

	}

	_indexAt( time ) {

		let lo = 0, hi = this.events.length;
		while ( lo < hi ) {

			const mid = ( lo + hi ) >> 1;
			if ( this.events[ mid ].time < time ) lo = mid + 1; else hi = mid;

		}

		return lo;

	}

	_tick() {

		const now = performance.now();
		const pos = this._anchorFile + ( now - this._anchorWall ) * this.rate;
		const horizon = pos + LOOKAHEAD * this.rate;
		const fluid = this._fluid;

		for ( ; this._cursor < this.events.length && this.events[ this._cursor ].time <= horizon; ++ this._cursor ) {

			const e = this.events[ this._cursor ];
			const delay = Math.max( 0, ( e.time - pos ) / this.rate );
			if ( fluid ) this._sound( fluid, e.d, delay );
			const id = setTimeout( () => {

				this._timeouts.delete( id );
				this._visual( e.d, ! fluid );

			}, delay );
			this._timeouts.add( id );

		}

		if ( pos > this.duration + 500 ) {

			// natural end: let the tails ring, just lift the file's pedals
			this._halt( { silence: false } );
			this._pos = this.duration;
			this.hooks.onEnd?.();

		}

	}

	_sound( fluid, d, delay ) {

		switch ( d.subtype ) {

			case 'noteOn': {

				const soft = this._softAhead.has( d.channel );
				const vel = Math.max( 1, Math.round( d.velocity * ( soft ? SOFT_VELOCITY : 1 ) ) );
				fluid.scheduleAt( { type: 'noteon', channel: d.channel, key: d.noteNumber, vel }, delay );
				break;

			}

			case 'noteOff':
				fluid.scheduleAt( { type: 'noteoff', channel: d.channel, key: d.noteNumber }, delay );
				break;

			case 'controller':
				if ( d.controllerType === PEDAL_CC.soft ) {

					if ( d.value >= 64 ) this._softAhead.add( d.channel ); else this._softAhead.delete( d.channel );
					break;

				}

				fluid.scheduleAt( { type: 'controlchange', channel: d.channel, control: d.controllerType, value: d.value }, delay );
				break;

		}

	}

	_visual( d, sound ) {

		const p = d.noteNumber;
		switch ( d.subtype ) {

			case 'noteOn':
				this._held.set( p, ( this._held.get( p ) ?? 0 ) + 1 );
				this.hooks.noteOn( p, d.velocity / 127, { sound } );
				break;

			case 'noteOff': {

				const n = ( this._held.get( p ) ?? 0 ) - 1;
				if ( n > 0 ) this._held.set( p, n );
				else {

					this._held.delete( p );
					this.hooks.noteOff( p, { sound } );

				}

				break;

			}

			case 'controller': {

				const name = PEDALS[ d.controllerType ];
				if ( name ) this._setPedal( name, d.channel, d.value >= 64 );
				break;

			}

		}

	}

	_setPedal( name, channel, on ) {

		const set = this._pedalChannels[ name ];
		const was = set.size > 0;
		if ( on ) set.add( channel ); else set.delete( channel );
		if ( was !== set.size > 0 ) this.hooks.pedal( name, set.size > 0 );

	}

	// pedal state at `time`, from the last CC64/66/67 per channel before it
	_restorePedals( time ) {

		const state = new Map();
		for ( const e of this.events ) {

			if ( e.time >= time ) break;
			const name = PEDALS[ e.d.controllerType ];
			if ( e.d.subtype === 'controller' && name ) state.set( name + ':' + e.d.channel, { name, channel: e.d.channel, value: e.d.value } );

		}

		this._softAhead = new Set();
		const fluid = this._fluid;
		for ( const { name, channel, value } of state.values() ) {

			this._setPedal( name, channel, value >= 64 );
			if ( name === 'soft' ) {

				if ( value >= 64 ) this._softAhead.add( channel );

			} else if ( fluid ) fluid.synth.midiControl( channel, PEDAL_CC[ name ], value );

		}

	}

	_halt( { silence = true } = {} ) {

		if ( this._timer ) clearInterval( this._timer );
		this._timer = null;
		const was = this.playing;
		this.playing = false;
		for ( const id of this._timeouts ) clearTimeout( id );
		this._timeouts.clear();

		const fluid = this._fluid;
		if ( fluid && was ) {

			if ( silence ) fluid.silence( this._channels );
			else for ( const ch of this._channels ) for ( const cc of [ 64, 66, 67 ] ) fluid.synth.midiControl( ch, cc, 0 );

		}

		// release what the file holds in the scene (and any built-in-synth voice it started)
		for ( const p of this._held.keys() ) {

			const v = this.synth.voices.get( p );
			this.hooks.noteOff( p, { sound: !! v && ! v.fluid } );

		}

		this._held.clear();
		for ( const name of Object.keys( this._pedalChannels ) ) {

			if ( this._pedalChannels[ name ].size ) this.hooks.pedal( name, false );
			this._pedalChannels[ name ].clear();

		}

		this._softAhead = new Set();

	}

}

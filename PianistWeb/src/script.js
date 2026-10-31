// Scene scripts: a YAML file describing a timed sequence of camera moves, screen power, MIDI
// playback, handheld camera settings and any scene parameter from the GUI. Picked from the GUI
// (together with the MIDI files it names) or loaded from public/scripts/ (?script=name.yaml).
//
//   title: Evening etude
//   midi:                          # aliases -> files: picked alongside, else from the site's midi/
//                                  # folder (sub-paths too: yin/01.mid); ./ or ../ = from the script
//     etude: beyer05.mid
//   timeline:
//     - at: 0                      # seconds, or "1:05.5"; `after: 2` (or at: +2) = 2 s after
//                                  # the previous event started; `gap: 0.5` = 0.5 s after the
//                                  # previous gap event, and everything timed after it, has
//                                  # *finished* (MIDI / audio / boot / camera move / tween)
//       set:                       # GUI controls by "Folder/Label" (or label / property name);
//         Lighting/Preset: Golden hour    # numbers can tween: give `duration` (and `ease`)
//       camera: { position: [ 0.6, 1.3, 1.6 ], target: [ 0, 0.9, -0.2 ], fov: 36 }   # a cut
//       handheld: { enabled: true, shake: 0.6, walk: 1, person: true }
//     - at: 1
//       screen: on                 # on | off
//     - at: 2
//       camera:                    # a move from wherever the camera is, through the keys
//         duration: 6
//         ease: inOutSine          # linear | inOutSine | inOutCubic | in | out
//         path:
//           - { position: [ 0.3, 1.25, 1.1 ], target: [ 0, 0.9, -0.2 ] }
//           - { position: [ 0, 1.2, 0.6 ], target: [ 0, 0.85, -0.2 ], fov: 30 }
//     - at: 3
//       midi: etude                # alias or file; or { play: etude, from: 0, tempo: 1 },
//                                  # or stop | pause | resume
//     - at: 6
//       midi: { play: yin/premiere-01.mid, roll: voice, subtitle: 下午好 }   # roll mode for
//                                  # this file: music (default) | voice (speech played by the
//                                  # piano: falls 6x faster, green, no particles); `subtitle`
//                                  # shows at the top of the screen while it plays
//     - at: 9
//     - gap: 0                     # after a user recording: its speech end (trailing silence
//       midi: { play: yin/a.mid, roll: voice, think: 1.6 }  # excluded) + 0.6 s listening, then
//                                  # `think` s thinking, then the voice's first note sounds (its
//                                  # MIDI starts earlier by its lead-in, so the roll comes in)
//       midi: { stop: 2 }          # fade the file out over 2 s, then stop; { pause: 0.15 } the
//                                  # same, but paused: the roll stays frozen where it was
//     - gap: 0.4
//       audio: user/hello.opus     # an audio file (site's audio/ folder, ./ = from the script);
//                                  # or { play: name, volume: 0.8, from: 0 } | stop
//   audio:                         # optional aliases, like midi:
//     - after: 1.6
//       play:                      # notes played by hand on the piano (live: sound, keys, the
//         - { note: F2, at: 0, dur: 0.1, vel: 0.7 }    # red rising roll); `note` a name (F2,
//         - { note: G#2, at: 0.6, dur: 0.4 }           # G#2 / Ab2) or a MIDI number; `at` the
//                                  # onset, `dur` key-down (s, from the event); vel 0..1 (0.7)
//
// Several actions may share one event; it has finished when all of them have (`screen: on` when
// the power-on animation and chime are done). The script ends when every event has fired and
// finished; `loop: true` starts it over.
// Camera moves drive the orbit target and position before the controls update, so the handheld
// mode, when on, adds its shake and walking on top.

import * as THREE from 'three';
import { parse } from 'yaml';
import { parseMidiEvents } from './midi.js';

// note name (C4 = 60; F2, G#2, Ab2, A#2) or MIDI number -> MIDI number
const STEPS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function notePitch( v, where ) {

	if ( typeof v === 'number' && Number.isInteger( v ) && v >= 0 && v <= 127 ) return v;
	const m = String( v ).trim().match( /^([A-Ga-g])([#b♯♭]?)(-?\d)$/ );
	if ( ! m ) throw new Error( `${ where }: bad note "${ v }"` );
	const acc = m[ 2 ] === '#' || m[ 2 ] === '♯' ? 1 : m[ 2 ] === 'b' || m[ 2 ] === '♭' ? - 1 : 0;
	return 12 * ( Number( m[ 3 ] ) + 1 ) + STEPS[ m[ 1 ].toLowerCase() ] + acc;

}

// the assistant's state on the screen (setStatus): listening while a user recording plays, up to
// LISTEN_TAIL after its speech ends (trailing silence excluded); thinking for a midi event's
// `think`; speaking while a voice MIDI sounds
const LISTEN_TAIL = 0.6;			// s after the user's speech ends
const SPEECH_FLOOR = 0.01;			// 20 ms RMS below this x the clip's peak RMS (-40 dB) is silence

const EASE = {
	linear: t => t,
	inOutSine: t => 0.5 - 0.5 * Math.cos( Math.PI * t ),
	inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - ( - 2 * t + 2 ) ** 3 / 2,
	in: t => t * t,
	out: t => 1 - ( 1 - t ) * ( 1 - t ),
};

const HANDHELD = { enabled: 'Handheld camera/Handheld', shake: 'Handheld camera/Shake', walk: 'Handheld camera/Walking motion', drift: 'Handheld camera/Operator drift', bursts: 'Handheld camera/Operator bursts', person: 'Handheld camera/Person (reflections)' };

const vec = ( a, what ) => {

	if ( ! Array.isArray( a ) || a.length !== 3 || ! a.every( Number.isFinite ) ) throw new Error( `${ what }: expected [x, y, z]` );
	return new THREE.Vector3( ...a );

};

function parseTime( v, prev ) {

	if ( v === undefined ) return prev;
	if ( typeof v === 'number' ) return v;
	const s = String( v ).trim();
	if ( s.startsWith( '+' ) ) return prev + Number( s.slice( 1 ) );
	const m = s.match( /^(\d+):(\d+(?:\.\d+)?)$/ );
	if ( m ) return Number( m[ 1 ] ) * 60 + Number( m[ 2 ] );
	const n = Number( s );
	if ( ! Number.isFinite( n ) ) throw new Error( `bad time "${ v }"` );
	return n;

}

export class ScriptPlayer {

	/**
	 * @param ctx { camera, controls, gui, setScreenPower(on), noteOn(pitch, vel), noteOff(pitch) (live,
	 *              as played on the keyboard), screenBusy() (power-on / -off still
	 *              animating), setRollMode('music' | 'voice'), setSubtitle(text), midi: { load(buffer, name), play(),
	 *              pause(), resume(), stop(), fadeOut(s, { pause }) -> Promise, seek(s), playing },
	 *              audio: { decode(arrayBuffer) -> Promise<AudioBuffer>, play(buffer, { volume, from })
	 *              -> { stop(), playing } }, setStatus(status, level) (assistant state icon) }
	 */
	constructor( ctx ) {

		this.ctx = ctx;
		this.script = null;
		this.playing = false;
		this.time = 0;
		this.onState = null;		// ( text ) => void, for the GUI
		this._midiBuffers = new Map();
		this._audioBuffers = new Map();
		this._audioSpeech = new Map();		// file -> { end (s, speech end), env (20 ms RMS / peak) }
		this._midiLead = new Map();			// file -> s before its first note
		this._sounds = [];			// playing audio handles
		this._held = new Set();			// pitches a `play` event holds down

	}

	get title() {

		return this.script?.title ?? '';

	}

	/**
	 * Load a script. MIDI names are looked up among `files` (other picked files) first; then a
	 * bare name is fetched from `midiURL` (the site's midi/ folder), a path relative to `baseURL`
	 * (where the script came from).
	 */
	async load( text, { name = 'script', files = [], baseURL = null, midiURL = null, audioURL = null } = {} ) {

		// YAML reads an unquoted `at: +2` as the number 2: keep the sign as a string
		const doc = parse( text.replace( /^(\s*(?:-\s+)?at:\s*)\+(\d[\d.]*)\s*$/gm, '$1"+$2"' ) );
		if ( ! doc || ! Array.isArray( doc.timeline ) ) throw new Error( 'a script needs a `timeline:` list' );
		const aliases = doc.midi ?? {}, audioAliases = doc.audio ?? {};
		const events = [];
		// with `gap:` (relative to the previous event's end) events run in file order and are timed
		// as they go; without it every time is known up front and events are sorted by it
		const chained = doc.timeline.some( e => e.gap !== undefined );
		let t = 0;
		for ( const [ i, e ] of doc.timeline.entries() ) {

			let when;
			if ( e.gap !== undefined ) when = { gap: Number( e.gap ) };
			else if ( e.after !== undefined ) when = { after: Number( e.after ) };
			else if ( e.at !== undefined && ! /^\s*\+/.test( String( e.at ) ) ) when = { at: parseTime( e.at, 0 ) };
			else when = { after: e.at === undefined ? 0 : parseTime( e.at, 0 ) };
			t = when.at ?? t + ( when.after ?? 0 );
			if ( Object.values( when ).some( v => ! Number.isFinite( v ) ) ) throw new Error( `timeline[${ i }]: bad at / after / gap` );
			events.push( Object.assign( this._compile( e, t, i ), { when } ) );

		}

		if ( ! chained ) events.sort( ( a, b ) => a.at - b.at );

		// MIDI: fetch / read everything up front
		const wanted = new Set( events.filter( e => e.midi?.play ).map( e => aliases[ e.midi.play ] ?? e.midi.play ) );
		const byName = new Map( files.map( f => [ f.name.toLowerCase(), f ] ) );
		this._midiBuffers.clear();
		for ( const file of wanted ) {

			const base = file.split( /[\\/]/ ).pop().toLowerCase();
			let buffer;
			// names and sub-paths (yin/01.mid) are in the site's midi/ folder; ./ or ../ paths are
			// relative to the script; full URLs as they are
			const from = /^\.\.?\//.test( file ) || /^[a-z]+:/i.test( file ) ? baseURL : midiURL ?? baseURL;
			if ( byName.has( base ) ) buffer = await byName.get( base ).arrayBuffer();
			else if ( from ) {

				const res = await fetch( new URL( file, from ) );
				if ( ! res.ok ) throw new Error( `MIDI "${ file }": ${ res.status }` );
				buffer = await res.arrayBuffer();
				// a missing file can come back as the site's HTML page (dev server / SPA fallback)
				if ( new TextDecoder().decode( new Uint8Array( buffer, 0, 4 ) ) !== 'MThd' ) throw new Error( `MIDI "${ file }": not a MIDI file (${ res.url })` );

			} else throw new Error( `MIDI "${ file }" not found: pick it together with the script` );
			this._midiBuffers.set( file, buffer );
			try {

				const first = parseMidiEvents( buffer.slice( 0 ) ).events.find( e => e.d.subtype === 'noteOn' && e.d.velocity > 0 );
				this._midiLead.set( file, first ? first.time / 1000 : 0 );

			} catch {

				this._midiLead.set( file, 0 );

			}

		}

		// audio: fetch and decode everything up front
		this._audioBuffers.clear();
		for ( const file of new Set( events.filter( e => e.audio?.play ).map( e => audioAliases[ e.audio.play ] ?? e.audio.play ) ) ) {

			const base = file.split( /[\\/]/ ).pop().toLowerCase();
			let data;
			const from = /^\.\.?\//.test( file ) || /^[a-z]+:/i.test( file ) ? baseURL : audioURL ?? baseURL;
			if ( byName.has( base ) ) data = await byName.get( base ).arrayBuffer();
			else if ( from ) {

				const res = await fetch( new URL( file, from ) );
				if ( ! res.ok ) throw new Error( `audio "${ file }": ${ res.status }` );
				if ( /text\/html/.test( res.headers.get( 'content-type' ) ?? '' ) ) throw new Error( `audio "${ file }": not found (${ res.url })` );
				data = await res.arrayBuffer();

			} else throw new Error( `audio "${ file }" not found: pick it together with the script` );
			try {

				const buffer = await this.ctx.audio.decode( data );
				this._audioBuffers.set( file, buffer );
				this._audioSpeech.set( file, speechOf( buffer ) );

			} catch ( err ) {

				throw new Error( `audio "${ file }": cannot decode (${ err.message })` );

			}

		}

		this.stop();
		this.script = { title: doc.title ?? name, loop: !! doc.loop, aliases, audioAliases, events, chained };
		this._state( `${ events.length } events` );
		return this.script;

	}

	_compile( e, at, i ) {

		const where = `timeline[${ i }]`;
		const out = { at, end: at, src: e };
		if ( e.camera ) {

			const c = e.camera;
			if ( c.path || c.duration ) {

				const keys = c.path ?? [ c ];
				out.camera = {
					move: true,
					duration: Math.max( 0.01, Number( c.duration ?? 3 ) ),
					ease: EASE[ c.ease ?? 'inOutSine' ] ?? EASE.inOutSine,
					keys: keys.map( ( k, j ) => ( {
						position: vec( k.position, `${ where }.camera.path[${ j }].position` ),
						target: vec( k.target, `${ where }.camera.path[${ j }].target` ),
						fov: k.fov,
					} ) ),
				};
				out.end = at + out.camera.duration;

			} else out.camera = { position: vec( c.position, `${ where }.camera.position` ), target: vec( c.target, `${ where }.camera.target` ), fov: c.fov };

		}

		if ( e.screen !== undefined ) out.screen = e.screen === true || e.screen === 'on';
		if ( e.midi !== undefined ) {

			const m = e.midi;
			if ( typeof m === 'string' && [ 'stop', 'pause', 'resume' ].includes( m ) ) out.midi = { action: m };
			else if ( typeof m === 'object' && ( m.stop !== undefined || m.pause !== undefined ) ) {

				const v = m.stop ?? m.pause;
				out.midi = { action: m.stop !== undefined ? 'stop' : 'pause', fade: Math.max( 0, Number( v === true ? 0 : v ) || 0 ) };

			}
			else if ( typeof m === 'string' ) out.midi = { play: m, from: 0 };
			else out.midi = { play: m.play, from: Number( m.from ?? 0 ), tempo: m.tempo, roll: m.roll, subtitle: m.subtitle, think: Math.max( 0, Number( m.think ?? 0 ) || 0 ) };
			if ( out.midi.roll !== undefined && ! [ 'music', 'voice' ].includes( out.midi.roll ) ) throw new Error( `${ where }.midi.roll: music | voice` );

		}

		if ( e.audio !== undefined ) {

			const a = e.audio;
			if ( a === 'stop' ) out.audio = { action: 'stop' };
			else if ( typeof a === 'string' ) out.audio = { play: a, volume: 1, from: 0 };
			else out.audio = { play: a.play, volume: Number( a.volume ?? 1 ), from: Number( a.from ?? 0 ) };
			if ( out.audio.play !== undefined && ! out.audio.play ) throw new Error( `${ where }.audio: give a file` );

		}

		if ( e.play !== undefined ) {

			const list = Array.isArray( e.play ) ? e.play : [ e.play ];
			out.play = list.map( ( n, j ) => {

				const w = `${ where }.play[${ j }]`;
				const at = Number( n.at ?? 0 ), dur = Number( n.dur ?? 0.2 ), vel = Number( n.vel ?? 0.7 );
				if ( ! ( at >= 0 ) || ! ( dur > 0 ) || ! ( vel > 0 && vel <= 1 ) ) throw new Error( `${ w }: at >= 0, dur > 0, 0 < vel <= 1` );
				return { pitch: notePitch( n.note, w ), at, dur, vel };

			} );
			out.end = Math.max( out.end, at + Math.max( ...out.play.map( n => n.at + n.dur ) ) );

		}

		const set = { ...( e.set ?? {} ) };
		for ( const [ k, path ] of Object.entries( HANDHELD ) ) if ( e.handheld?.[ k ] !== undefined ) set[ path ] = e.handheld[ k ];
		if ( out.midi?.tempo !== undefined ) set[ 'MIDI player/Tempo' ] = out.midi.tempo;
		if ( Object.keys( set ).length ) {

			out.set = set;
			out.setDuration = Number( e.duration ?? 0 );
			out.setEase = EASE[ e.ease ?? 'inOutSine' ] ?? EASE.inOutSine;
			out.end = Math.max( out.end, at + out.setDuration );

		}

		return out;

	}

	// ---- playback ---------------------------------------------------------------------------

	play() {

		if ( ! this.script ) return;
		this.stop();
		this.playing = true;
		this.time = 0;
		this._next = 0;
		this._moves = [];			// running camera moves / parameter tweens
		this._tweens = [];
		this._midiStarted = false;
		this._prevStart = 0;
		this._segment = [];			// busy() of the events since the last gap event
		this._busy = [];			// busy() of every fired event
		this._midiToken = 0;
		this._voiceToken = - 1;			// token of the playing voice MIDI
		this._voiceOnset = 0;			// its first note, s of file time
		this._voiceThinks = false;		// it came after a thinking pause (its lead-in still thinks)
		this._pending = [];				// deferred actions { at, run, think }
		this._listens = [];				// { until, start, from, env } of user recordings
		this.ctx.setStatus?.( 'idle' );
		this._state( 'playing' );

	}

	stop() {

		if ( ! this.playing ) return;
		this.playing = false;
		if ( this._midiStarted ) this.ctx.midi.stop();
		for ( const h of this._sounds ) h.stop();
		this._sounds = [];
		for ( const p of this._held ) this.ctx.noteOff?.( p );		// let go of played notes
		this._held.clear();
		this.ctx.setRollMode?.( 'music' );
		this.ctx.setSubtitle?.( '' );
		this.ctx.setStatus?.( null );
		this._pending = [];
		this._listens = [];
		this._moves = [];
		this._tweens = [];
		this._state( 'stopped' );

	}

	/** Per frame, after the handheld pose is restored and before controls.update(). */
	update( dt ) {

		if ( ! this.playing ) return;
		this.time += dt;
		const { events } = this.script;
		for ( ; ; ) {

			const e = events[ this._next ];
			if ( ! e ) break;
			const w = e.when;
			if ( ! this.script.chained ) {

				if ( e.at > this.time ) break;

			} else if ( w.gap !== undefined ) {

				// the previous line (and whatever was timed off it) has to finish; then `gap` more
				if ( this._segment.some( b => b() ) ) break;
				if ( this._prevEnd === undefined ) this._prevEnd = this.time;
				if ( this.time < this._prevEnd + w.gap ) break;

			} else if ( this.time < ( w.at ?? this._prevStart + w.after ) ) break;
			++ this._next;
			this._prevStart = this.time;
			this._prevEnd = undefined;
			const busy = this._fire( e );
			if ( w.gap !== undefined ) this._segment = [ busy ]; else this._segment.push( busy );
			this._busy.push( busy );

		}

		// camera move: the newest running one wins
		this._moves = this._moves.filter( m => this.time < m.t0 + m.duration );
		const m = this._moves[ this._moves.length - 1 ];
		if ( m ) {

			const u = m.ease( THREE.MathUtils.clamp( ( this.time - m.t0 ) / m.duration, 0, 1 ) );
			this._pose( m.position.getPointAt( u ), m.target.getPointAt( u ), m.fov( u ) );

		}

		// parameter tweens (numbers); heavy handlers (relight) at most 4x per second
		for ( const tw of this._tweens ) {

			const u = tw.ease( THREE.MathUtils.clamp( ( this.time - tw.t0 ) / tw.duration, 0, 1 ) );
			tw.controller.setValue( tw.from + ( tw.to - tw.from ) * u );
			if ( u >= 1 || this.time - tw.finished > 0.25 ) {

				tw.controller._callOnFinishChange();
				tw.finished = this.time;

			}

			tw.done = u >= 1;

		}

		this._tweens = this._tweens.filter( tw => ! tw.done );

		this._sounds = this._sounds.filter( h => h.playing );

		// deferred actions (a voice reply after its thinking time)
		if ( this._pending.length ) {

			const due = this._pending.filter( p => this.time >= p.at ).sort( ( a, b ) => a.at - b.at );
			this._pending = this._pending.filter( p => this.time < p.at );
			for ( const p of due ) p.run();

		}

		this._updateStatus();

		// end: everything fired and finished
		if ( this._next >= events.length && ! this._moves.length && ! this._tweens.length && ! this._busy.some( b => b() ) ) {

			if ( this.script.loop ) this.play();
			else {

				this.playing = false;
				this.ctx.setRollMode?.( 'music' );
				this.ctx.setStatus?.( null );
				this._state( 'finished' );

			}

		}

	}

	/** Run an event's actions; returns busy(): true until all of them have finished. */
	_fire( e ) {

		const t0 = this.time, parts = [];
		if ( e.set ) {

			this._set( e.set, e.setDuration, e.setEase );
			if ( e.setDuration > 0 ) parts.push( () => this.time < t0 + e.setDuration );

		}
		if ( e.camera ) {

			const c = e.camera, { camera, controls } = this.ctx;
			if ( c.move ) {

				const start = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
				// the orbit target in handheld mode sits 1 cm ahead of the lens: use a point at the
				// distance of the first key's target instead, along the current view
				const ahead = c.keys[ 0 ].target.distanceTo( c.keys[ 0 ].position );
				start.target = new THREE.Vector3( 0, 0, - ahead ).applyQuaternion( camera.quaternion ).add( camera.position );
				const keys = [ start, ...c.keys ];
				const fovs = [];
				let f = start.fov;
				for ( const k of keys ) fovs.push( f = k.fov ?? f );
				const curve = pts => pts.length > 2 ? new THREE.CatmullRomCurve3( pts, false, 'centripetal' ) : new THREE.LineCurve3( pts[ 0 ], pts[ 1 ] );
				const move = {
					t0, duration: c.duration, ease: c.ease,
					position: curve( keys.map( k => k.position ) ),
					target: curve( keys.map( k => k.target ) ),
					fov: u => {

						const x = u * ( fovs.length - 1 ), i = Math.min( Math.floor( x ), fovs.length - 2 );
						return THREE.MathUtils.lerp( fovs[ i ], fovs[ i + 1 ], x - i );

					},
				};
				this._moves = [ move ];		// a newer move replaces the running one
				parts.push( () => this._moves.includes( move ) );

			} else {

				this._moves = [];
				this._pose( c.position, c.target, c.fov );

			}

		}

		if ( e.screen !== undefined ) {

			this.ctx.setScreenPower( e.screen );
			// a frame for the animation / chime to start; at most 10 s (the roll is hidden while path tracing)
			if ( this.ctx.screenBusy ) parts.push( () => this.time < t0 + 0.1 || ( this.time < t0 + 10 && this.ctx.screenBusy() ) );

		}

		if ( e.midi ) {

			const m = e.midi, midi = this.ctx.midi;
			if ( m.action === 'stop' || m.action === 'pause' ) {

				const pause = m.action === 'pause';
				if ( m.fade > 0 && midi.fadeOut ) {

					let fading = true;
					midi.fadeOut( m.fade, { pause } ).finally( () => fading = false );
					parts.push( () => fading );

				} else if ( pause ) midi.pause(); else midi.stop();

			}
			else if ( m.action === 'resume' ) midi.resume();
			else {

				const file = this.script.aliases[ m.play ] ?? m.play;
				const st = { starting: true, token: - 1 };
				const start = () => {

					this.ctx.setRollMode?.( m.roll ?? 'music' );
					this.ctx.setSubtitle?.( m.subtitle ?? '' );
					midi.load( this._midiBuffers.get( file ).slice( 0 ), file.split( /[\\/]/ ).pop() );
					if ( m.from ) midi.seek( m.from * 1000 );
					Promise.resolve( midi.play() ).finally( () => st.starting = false );
					this._midiStarted = true;
					st.token = ++ this._midiToken;		// a later file ends this one
					if ( m.roll === 'voice' ) {

						this._voiceToken = st.token;
						this._voiceOnset = Math.max( 0, ( this._midiLead.get( file ) ?? 0 ) - ( m.from || 0 ) );
						this._voiceThinks = m.think > 0;

					}

				};
				if ( m.think > 0 ) {

					// think, then the first note sounds: the file starts earlier by its lead-in, so
					// its first bars fall in while the icon still shows thinking
					const lead = Math.max( 0, ( this._midiLead.get( file ) ?? 0 ) - ( m.from || 0 ) );
					this._pending.push( { at: t0 + Math.max( 0, m.think - lead ), run: start } );
					this._pending.push( { at: t0 + m.think, run: () => {}, think: true } );

				} else start();
				parts.push( () => st.starting || this._pending.some( p => p.run === start ) || ( this._midiToken === st.token && midi.playing ) );

			}

		}

		if ( e.audio ) {

			if ( e.audio.action === 'stop' ) {

				for ( const h of this._sounds ) h.stop();
				this._sounds = [];

			} else {

				const file = this.script.audioAliases[ e.audio.play ] ?? e.audio.play;
				const h = this.ctx.audio.play( this._audioBuffers.get( file ), { volume: e.audio.volume, from: e.audio.from, name: file } );
				this._sounds.push( h );
				// finished when the speech ends (its trailing silence does not count)
				const sp = this._audioSpeech.get( file ), from = e.audio.from || 0;
				const end = t0 + Math.max( 0, ( sp?.end ?? this._audioBuffers.get( file ).duration ) - from );
				this._listens.push( { start: t0, until: end + LISTEN_TAIL, from, env: sp?.env, h } );
				parts.push( () => h.playing && this.time < end );

			}

		}

		if ( e.play ) {

			// played by hand: each note on at t0 + at, off at + dur (live: sound, keys, red roll)
			for ( const n of e.play ) {

				this._pending.push( { at: t0 + n.at, run: () => {

					if ( this._held.has( n.pitch ) ) this.ctx.noteOff?.( n.pitch );		// a repeat
					this.ctx.noteOn?.( n.pitch, n.vel );
					this._held.add( n.pitch );

				} } );
				this._pending.push( { at: t0 + n.at + n.dur, run: () => {

					if ( ! this._held.has( n.pitch ) ) return;
					this.ctx.noteOff?.( n.pitch );
					this._held.delete( n.pitch );

				} } );

			}

			const last = t0 + Math.max( ...e.play.map( n => n.at + n.dur ) );
			parts.push( () => this.time < last );

		}

		return () => parts.some( p => p() );

	}

	/** The assistant's state for the screen icon: thinking > speaking > listening > idle. */
	_updateStatus() {

		if ( ! this.ctx.setStatus ) return;
		const midi = this.ctx.midi, t = this.time;
		this._listens = this._listens.filter( l => t < l.until );
		let status = 'idle', level = 0;
		const voicing = this._midiToken === this._voiceToken && midi.playing && ( midi.position ?? Infinity ) >= this._voiceOnset * 1000;
		if ( this._pending.some( p => p.think ) || ( this._voiceThinks && this._midiToken === this._voiceToken && midi.playing && ! voicing ) ) status = 'thinking';
		else if ( voicing ) status = 'speaking';
		else if ( this._listens.length ) {

			status = 'listening';
			for ( const l of this._listens ) {

				if ( ! l.env || ! l.h.playing ) continue;
				const i = Math.floor( ( t - l.start + l.from ) / 0.02 );
				if ( i >= 0 && i < l.env.length ) level = Math.max( level, l.env[ i ] );

			}

		}

		this.ctx.setStatus( status, level );

	}

	_pose( position, target, fov ) {

		const { camera, controls } = this.ctx;
		camera.position.copy( position );
		controls.target.copy( target );
		camera.lookAt( target );
		if ( fov !== undefined && fov !== camera.fov ) {

			camera.fov = fov;
			camera.updateProjectionMatrix();

		}

	}

	// ---- scene parameters (GUI controllers) ---------------------------------------------------

	_controller( key ) {

		const all = this.ctx.gui.controllersRecursive();
		const pathOf = c => {

			const parts = [ c._name ];
			for ( let g = c.parent; g && g.parent; g = g.parent ) parts.unshift( g._title );
			return parts.join( '/' );

		};

		const k = key.toLowerCase();
		const hit = all.find( c => pathOf( c ).toLowerCase() === k )
			?? all.find( c => c._name.toLowerCase() === k )
			?? all.find( c => c.property.toLowerCase() === k );
		if ( ! hit ) throw new Error( `no scene parameter "${ key }"` );
		return hit;

	}

	_set( values, duration, ease ) {

		for ( const [ key, value ] of Object.entries( values ) ) {

			let c;
			try {

				c = this._controller( key );

			} catch ( err ) {

				console.warn( 'script:', err.message );
				continue;

			}

			this._tweens = this._tweens.filter( tw => tw.controller !== c );
			if ( duration > 0 && typeof value === 'number' && typeof c.getValue() === 'number' ) {

				this._tweens.push( { controller: c, from: c.getValue(), to: value, t0: this.time, duration, ease, finished: this.time } );

			} else {

				c.setValue( value );
				c._callOnFinishChange();

			}

		}

	}

	_state( text ) {

		this.onState?.( text );

	}

}

/**
 * Where the speech in a recording ends: the last 20 ms frame whose RMS is above SPEECH_FLOOR x the
 * loudest frame's (falls back to the clip's end). Also the RMS envelope, 0..1 against its 95th
 * percentile frame, for the listening icon.
 */
function speechOf( buffer ) {

	const sr = buffer.sampleRate, hop = Math.round( sr * 0.02 ), n = Math.floor( buffer.length / hop );
	const ch = Array.from( { length: buffer.numberOfChannels }, ( _, c ) => buffer.getChannelData( c ) );
	const rms = new Float32Array( n );
	for ( let i = 0; i < n; ++ i ) {

		let s2 = 0;
		for ( const d of ch ) for ( let k = i * hop; k < ( i + 1 ) * hop; ++ k ) s2 += d[ k ] * d[ k ];
		rms[ i ] = Math.sqrt( s2 / ( hop * ch.length ) );

	}

	const peak = rms.reduce( ( a, b ) => Math.max( a, b ), 0 );
	let last = - 1;
	for ( let i = n - 1; i >= 0; -- i ) if ( rms[ i ] > SPEECH_FLOOR * peak ) {

		last = i;
		break;

	}

	const sorted = [ ...rms ].sort( ( a, b ) => a - b ), ref = sorted[ Math.floor( n * 0.95 ) ] || 1;
	const env = rms.map( v => Math.min( 1, v / ref ) );
	return { end: last >= 0 && peak > 0 ? ( last + 1 ) * hop / sr : buffer.duration, env, duration: buffer.duration };

}

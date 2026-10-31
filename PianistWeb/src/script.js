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
//                                  # piano: falls 2x faster, green, no particles); `subtitle`
//                                  # shows at the top of the screen while it plays
//     - at: 9
//       midi: { stop: 2 }          # fade the file out over 2 s, then stop; { pause: 0.15 } the
//                                  # same, but paused: the roll stays frozen where it was
//     - gap: 0.4
//       audio: user/hello.opus     # an audio file (site's audio/ folder, ./ = from the script);
//                                  # or { play: name, volume: 0.8, from: 0 } | stop
//   audio:                         # optional aliases, like midi:
//
// Several actions may share one event; it has finished when all of them have (`screen: on` when
// the power-on animation and chime are done). The script ends when every event has fired and
// finished; `loop: true` starts it over.
// Camera moves drive the orbit target and position before the controls update, so the handheld
// mode, when on, adds its shake and walking on top.

import * as THREE from 'three';
import { parse } from 'yaml';

const EASE = {
	linear: t => t,
	inOutSine: t => 0.5 - 0.5 * Math.cos( Math.PI * t ),
	inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - ( - 2 * t + 2 ) ** 3 / 2,
	in: t => t * t,
	out: t => 1 - ( 1 - t ) * ( 1 - t ),
};

const HANDHELD = { enabled: 'Handheld camera/Handheld', shake: 'Handheld camera/Shake', walk: 'Handheld camera/Walking motion', person: 'Handheld camera/Person (reflections)' };

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
	 * @param ctx { camera, controls, gui, setScreenPower(on), screenBusy() (power-on / -off still
	 *              animating), setRollMode('music' | 'voice'), setSubtitle(text), midi: { load(buffer, name), play(),
	 *              pause(), resume(), stop(), fadeOut(s, { pause }) -> Promise, seek(s), playing },
	 *              audio: { decode(arrayBuffer) -> Promise<AudioBuffer>, play(buffer, { volume, from })
	 *              -> { stop(), playing } } }
	 */
	constructor( ctx ) {

		this.ctx = ctx;
		this.script = null;
		this.playing = false;
		this.time = 0;
		this.onState = null;		// ( text ) => void, for the GUI
		this._midiBuffers = new Map();
		this._audioBuffers = new Map();
		this._sounds = [];			// playing audio handles

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

				this._audioBuffers.set( file, await this.ctx.audio.decode( data ) );

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
			else out.midi = { play: m.play, from: Number( m.from ?? 0 ), tempo: m.tempo, roll: m.roll, subtitle: m.subtitle };
			if ( out.midi.roll !== undefined && ! [ 'music', 'voice' ].includes( out.midi.roll ) ) throw new Error( `${ where }.midi.roll: music | voice` );

		}

		if ( e.audio !== undefined ) {

			const a = e.audio;
			if ( a === 'stop' ) out.audio = { action: 'stop' };
			else if ( typeof a === 'string' ) out.audio = { play: a, volume: 1, from: 0 };
			else out.audio = { play: a.play, volume: Number( a.volume ?? 1 ), from: Number( a.from ?? 0 ) };
			if ( out.audio.play !== undefined && ! out.audio.play ) throw new Error( `${ where }.audio: give a file` );

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
		this._state( 'playing' );

	}

	stop() {

		if ( ! this.playing ) return;
		this.playing = false;
		if ( this._midiStarted ) this.ctx.midi.stop();
		for ( const h of this._sounds ) h.stop();
		this._sounds = [];
		this.ctx.setRollMode?.( 'music' );
		this.ctx.setSubtitle?.( '' );
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

		// end: everything fired and finished
		if ( this._next >= events.length && ! this._moves.length && ! this._tweens.length && ! this._busy.some( b => b() ) ) {

			if ( this.script.loop ) this.play();
			else {

				this.playing = false;
				this.ctx.setRollMode?.( 'music' );
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
				this.ctx.setRollMode?.( m.roll ?? 'music' );
				this.ctx.setSubtitle?.( m.subtitle ?? '' );
				midi.load( this._midiBuffers.get( file ).slice( 0 ), file.split( /[\\/]/ ).pop() );
				if ( m.from ) midi.seek( m.from * 1000 );
				let starting = true;
				Promise.resolve( midi.play() ).finally( () => starting = false );
				this._midiStarted = true;
				const token = ++ this._midiToken;		// a later file ends this one
				parts.push( () => starting || ( this._midiToken === token && midi.playing ) );

			}

		}

		if ( e.audio ) {

			if ( e.audio.action === 'stop' ) {

				for ( const h of this._sounds ) h.stop();
				this._sounds = [];

			} else {

				const file = this.script.audioAliases[ e.audio.play ] ?? e.audio.play;
				const h = this.ctx.audio.play( this._audioBuffers.get( file ), { volume: e.audio.volume, from: e.audio.from } );
				this._sounds.push( h );
				parts.push( () => h.playing );

			}

		}

		return () => parts.some( p => p() );

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

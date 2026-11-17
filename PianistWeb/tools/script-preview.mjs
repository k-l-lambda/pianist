#!/usr/bin/env node
// A scene script as a top-down animated plan (SVG, SMIL: open it in a browser and it plays): the venue's
// floor-level plan as a wireframe (the floor map's level edges, and what of the venue's model stands near
// the floor: seat rows, risers, rails, walls' feet, the stage doors), the piano and its bench as outlines,
// the user (the camera) as a dot with its view wedge and target, the path walked so far, the doors as they
// open, and the dialogue as subtitles typed character by character as the lines are actually spoken, a
// colour per speaker; small print: the time, the lighting preset and its fades, the screen, the doors, and
// the script's own comment on each camera move. An HTML page beside it plays, pauses and scrubs it.
//
//   node tools/script-preview.mjs <script.yaml> [--out preview.svg] [--fps 15] [--query "style=grand-black"]
//        [--url http://localhost:5184/] [--from 0] [--to <s>] [--dialogs ../Footages.local/dialogs]
//        [--width 1400] [--margin 1.5] [--no-align] [--work dir] [--reuse]
//
// How: the page itself runs the script (#?render=…, the offline render mode's simulated clock, frames stepped
// without drawing, src/main.js __render.step({ draw: false })), so the timing is the player's own (gaps wait for
// the lines to end, thinking pauses, fades); every frame the intended camera pose is sampled (handheld: its
// un-shaken pose, HandheldMode.intended), its fov, the target, the doors, the preset (and a fade's target), the
// screen. ScriptPlayer._fire, its midi.load / setSubtitle and audio.play are wrapped from outside to log what
// starts when. The plan is taken from the page once: the Berlin hall's triangles whose centroid stands
// 0.04-1.2 m above the floor under it (hall.floorHeight), projected and filled into a 2.5 cm grid; the piano's
// and the bench's triangles into a 1 cm grid; the doors' hinges and leaves; the corridors (stageDoors.floorAt).
// tools/script-preview-geom.py (python3 + OpenCV) traces them, and the floor map's level edges
// (public/berlinhall/floor.bin), into outlines.
//
// The subtitles: a user recording's text is its id's line in the dialogue files (--dialogs/*.md: `[id: name]`
// then `Role: text`, the recording's file name the id); a voice MIDI's is its `subtitle:`. Each character's
// time (tools/script-preview-align.py, faster-whisper word timestamps, the words' characters matched to the
// text's): a recording from the recording itself; a talking-piano MIDI from the TTS line it was fitted to
// (<dialogs>/<prefix>-tts/<id>.wav for midi <prefix>-<id>.mid), its speech mapped linearly onto the MIDI's
// notes (first note on .. last note off; the file was fitted to the line sped up), else spread over the MIDI's
// note activity. Results are cached in --work (default <out>.work/). PREVIEW_WHISPER_PY: the python with
// faster-whisper (default ~/work/talking-midi/.venv/bin/python); PREVIEW_PY: python3 with OpenCV.
//
// GPU and browser as tools/render-video.mjs (PLAYWRIGHT_CORE, CHROME, __EGL_VENDOR_LIBRARY_FILENAMES); without
// --url a vite is started on a free port and stopped at the end.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

// ---- arguments ----
const argv = process.argv.slice( 2 );
const opt = { fps: 15, from: 0, to: null, out: null, url: null, query: 'style=grand-black', dialogs: path.join( root, '..', 'Footages.local', 'dialogs' ), width: 1400, margin: 1.5, align: true, work: null };
let script = null;
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], val = () => {

		if ( i + 1 >= argv.length ) throw new Error( `${ a }: missing value` );
		return argv[ ++ i ];

	};
	if ( a === '--fps' ) opt.fps = Number( val() );
	else if ( a === '--from' ) opt.from = Number( val() );
	else if ( a === '--to' ) opt.to = Number( val() );
	else if ( a === '--out' ) opt.out = val();
	else if ( a === '--url' ) opt.url = val();
	else if ( a === '--query' ) opt.query = val();
	else if ( a === '--dialogs' ) opt.dialogs = val();
	else if ( a === '--width' ) opt.width = Number( val() );
	else if ( a === '--margin' ) opt.margin = Number( val() );
	else if ( a === '--work' ) opt.work = val();
	else if ( a === '--no-align' ) opt.align = false;
	else if ( a === '--reuse' ) opt.reuse = true;
	else if ( a === '-h' || a === '--help' ) {

		console.log( fs.readFileSync( fileURLToPath( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 40 ).join( '\n' ) );
		process.exit( 0 );

	} else if ( ! a.startsWith( '--' ) && ! script ) script = a;
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! script ) throw new Error( 'usage: node tools/script-preview.mjs <script.yaml> [--out preview.svg]' );
opt.out ??= path.basename( script ).replace( /\.ya?ml$/i, '' ) + '-preview.svg';
opt.out = path.resolve( opt.out );
opt.work = path.resolve( opt.work ?? opt.out.replace( /\.svg$/i, '' ) + '.work' );
fs.mkdirSync( opt.work, { recursive: true } );
const reuseOK = opt.reuse && fs.existsSync( path.join( opt.work, 'data.json' ) );
const scriptFile = /[/:]/.test( script ) ? path.resolve( root, script.replace( /^\//, '' ) ) : path.join( root, 'public', 'scripts', script );

// ---- dev server ----
let vite = null;
const reachable = async url => {

	try { return ( await fetch( url ) ).ok; } catch { return false; }

};
const freePort = () => new Promise( ( ok, fail ) => {

	const s = net.createServer();
	s.listen( 0, '127.0.0.1', () => { const p = s.address().port; s.close( () => ok( p ) ); } );
	s.on( 'error', fail );

} );
if ( ! opt.url && ! reuseOK ) {

	const port = await freePort();
	opt.url = `http://localhost:${ port }/`;
	console.log( `starting vite on :${ port }` );
	vite = spawn( 'npx', [ 'vite', '--port', String( port ), '--strictPort' ], { cwd: root, stdio: 'ignore', detached: true } );
	for ( let i = 0; ! await reachable( opt.url ); ++ i ) {

		if ( i > 120 ) throw new Error( 'vite did not start' );
		await new Promise( r => setTimeout( r, 500 ) );

	}

}
const stopVite = () => {

	if ( vite ) try { process.kill( - vite.pid ); } catch { /* gone */ }
	vite = null;

};
process.on( 'exit', stopVite );
process.on( 'SIGINT', () => process.exit( 130 ) );

// ---- the page: plan, samples, events ----
const require = createRequire( import.meta.url );
const { chromium } = require( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );
const browser = reuseOK ? null : await chromium.launch( {
	executablePath: process.env.CHROME ?? path.join( os.homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ),
	headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json' },
	args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required' ],
} );
let data;
const dataFile = path.join( opt.work, 'data.json' );
if ( reuseOK ) { data = JSON.parse( fs.readFileSync( dataFile, 'utf8' ) ); console.log( `reusing ${ dataFile } (--reuse: the page's samples and plan from the last run)` ); }
else try {

	const page = await browser.newPage( { viewport: { width: 180, height: 360 }, deviceScaleFactor: 1 } );
	await page.addInitScript( () => {

		const WS = window.WebSocket;
		window.WebSocket = function ( url, protocols ) {

			if ( [ protocols ].flat().some( p => p === 'vite-hmr' || p === 'vite-ping' ) ) return Object.assign( new EventTarget(), { readyState: 0, send() {}, close() {} } );
			return new WS( url, protocols );

		};
		Object.assign( window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } );

	} );
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	const hash = new URLSearchParams( { render: script, fps: opt.fps, from: opt.from, ss: 1, sub: 1 } );
	if ( opt.to !== null ) hash.set( 'to', opt.to );
	const base = new URL( opt.url );
	if ( opt.query ) base.search = opt.query;
	await page.goto( new URL( '#?' + hash, base ).href, { waitUntil: 'commit' } );
	await page.waitForFunction( () => window.__render, null, { timeout: 180000 } );
	await page.evaluate( () => window.__render.ready );
	// the log: what starts when (script time), from outside the player
	await page.evaluate( () => {

		const SP = window.__pianist.scriptPlayer, log = window.__spLog = [];
		const fire = SP._fire.bind( SP );
		SP._fire = e => { log.push( { type: 'event', i: SP._next - 1, t: SP.time } ); return fire( e ); };
		let sub = '';
		const setSub = SP.ctx.setSubtitle?.bind( SP.ctx );
		SP.ctx.setSubtitle = s => { sub = s ?? ''; return setSub?.( s ); };
		const midi = SP.ctx.midi, load = midi.load.bind( midi );
		midi.load = ( buf, name ) => { log.push( { type: 'midi', t: SP.time, name, subtitle: sub } ); window.__spMidi = name; sub = ''; return load( buf, name ); };
		const audio = SP.ctx.audio, play = audio.play.bind( audio );
		audio.play = ( buf, o = {} ) => {

			const sp = SP._audioSpeech?.get( o.name );
			log.push( { type: 'audio', t: SP.time, name: o.name, from: o.from || 0, duration: buf?.duration ?? null, speechEnd: sp?.end ?? null } );
			return play( buf, o );

		};

	} );
	const samples = [];
	const sample = () => page.evaluate( () => {

		const P = window.__pianist, H = P.venue, SP = P.scriptPlayer, hh = P.handheld;
		const I = hh.enabled && hh.intended?.valid ? hh.intended : null;
		const pos = I ? I.position : P.camera.position, q = I ? I.quaternion : P.camera.quaternion;
		const d = new pos.constructor( 0, 0, - 1 ).applyQuaternion( q );
		const fade = SP._tweens?.find( tw => tw.preset );
		const doors = H.stageDoors ? Object.fromEntries( H.stageDoors.names.map( n => [ n, +H.stageDoors.get( n ).toFixed( 3 ) ] ) ) : {};
		return { t: SP.time, x: pos.x, z: pos.z, dx: d.x, dz: d.z, fov: P.camera.fov, tx: P.controls.target.x, tz: P.controls.target.z,
			preset: H.preset ?? '', fade: fade ? { to: fade.preset, u: Math.min( 1, Math.max( 0, ( SP.time - fade.t0 ) / fade.duration ) ) } : null,
			screen: !! P.roll?.power, doors, midi: P.midiPlayer?.playing ? ( window.__spMidi ?? '' ) : '' };

	} );
	// the plan, once the script's first frame has set the venue up
	let s = await page.evaluate( () => window.__render.step( { draw: false } ) );
	samples.push( await sample() );
	const plan = await page.evaluate( async () => {

		const P = window.__pianist, H = P.venue, THREE_V = P.camera.position.constructor;
		const out = { venue: H === P.hall && H.berlinShown ? 'berlin' : 'other' };
		const fl = await ( await fetch( 'berlinhall/floor.json' ) ).json();
		out.floor = fl;
		// near-floor occupancy: 2.5 cm grid over the floor map's extent
		const res = 0.025, W = Math.round( fl.nx * fl.res / res ), Hh = Math.round( fl.nz * fl.res / res );
		const cv = new OffscreenCanvas( W, Hh ), g = cv.getContext( '2d' );
		g.fillStyle = '#000'; g.fillRect( 0, 0, W, Hh ); g.fillStyle = '#fff';
		const v = [ new THREE_V(), new THREE_V(), new THREE_V() ];
		let kept = 0;
		const meshRoot = H.berlin ?? H.group;
		meshRoot.updateMatrixWorld( true );
		const SEAT = /chair|seat|stuhl|pillow/i;
		meshRoot.traverse( o => {

			if ( ! o.isMesh || o.isInstancedMesh || ! o.visible || SEAT.test( o.name ) ) return;		// (the seats: a layer of their own, below)
			const p = o.geometry.attributes.position; if ( ! p ) return; const idx = o.geometry.index, n = idx ? idx.count : p.count;
			g.beginPath();
			for ( let t = 0; t < n; t += 3 ) {

				for ( let k = 0; k < 3; ++ k ) v[ k ].fromBufferAttribute( p, idx ? idx.getX( t + k ) : t + k ).applyMatrix4( o.matrixWorld );
				const cx = ( v[ 0 ].x + v[ 1 ].x + v[ 2 ].x ) / 3, cz = ( v[ 0 ].z + v[ 1 ].z + v[ 2 ].z ) / 3, cy = ( v[ 0 ].y + v[ 1 ].y + v[ 2 ].y ) / 3;
				const f = H.floorHeight?.( cx, cz );
				if ( f === null || f === undefined ) continue;
				const h = cy - f;
				if ( h < 0.04 || h > 1.2 ) continue;
				// (each triangle wound one way: a closed mesh's top and bottom faces cancelled in the nonzero fill)
				const [ a, b, c ] = ( v[ 1 ].x - v[ 0 ].x ) * ( v[ 2 ].z - v[ 0 ].z ) - ( v[ 2 ].x - v[ 0 ].x ) * ( v[ 1 ].z - v[ 0 ].z ) < 0 ? [ v[ 0 ], v[ 2 ], v[ 1 ] ] : v;
				g.moveTo( ( a.x - fl.minX ) / res, ( a.z - fl.minZ ) / res );
				g.lineTo( ( b.x - fl.minX ) / res, ( b.z - fl.minZ ) / res );
				g.lineTo( ( c.x - fl.minX ) / res, ( c.z - fl.minZ ) / res );
				g.closePath();
				++ kept;

			}
			g.fill();

		} );
		const blob = async c => { const b = await c.convertToBlob( { type: 'image/png' } ); const a = new Uint8Array( await b.arrayBuffer() ); let s = ''; for ( let i = 0; i < a.length; i += 0x8000 ) s += String.fromCharCode( ...a.subarray( i, i + 0x8000 ) ); return btoa( s ); };
		out.occ = { res, W, H: Hh, minX: fl.minX, minZ: fl.minZ, kept, png: await blob( cv ) };
		// the seats: their cushions on a 1 cm grid, the seat cushion (0.45-0.75 m over the floor: one square per seat,
		// apart) and the back cushion (0.75-1.2 m: a bar, which way it faces); the chairs' frames left out (in any band
		// a row's frames and seats touch: they ran together into strips). No cushion meshes: the seat band of all
		const CUSH = /pillow|cushion/i;
		{

			let seats = [];
			meshRoot.traverse( o => { if ( o.isMesh && ! o.isInstancedMesh && o.visible && SEAT.test( o.name ) && o.geometry.attributes.position ) seats.push( o ); } );
			const cush = seats.filter( o => CUSH.test( o.name ) );
			if ( cush.length ) seats = cush;
			const sb = { x0: 1e9, x1: - 1e9, z0: 1e9, z1: - 1e9 };
			for ( const o of seats ) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4( o.matrixWorld ); sb.x0 = Math.min( sb.x0, b.min.x ); sb.x1 = Math.max( sb.x1, b.max.x ); sb.z0 = Math.min( sb.z0, b.min.z ); sb.z1 = Math.max( sb.z1, b.max.z ); }
			if ( seats.length ) {

				const sr = 0.01, SW = Math.ceil( ( sb.x1 - sb.x0 ) / sr ) + 2, SH = Math.ceil( ( sb.z1 - sb.z0 ) / sr ) + 2;
				const layer = async ( h0, h1 ) => {

					const sc = new OffscreenCanvas( SW, SH ), sg = sc.getContext( '2d' );
					sg.fillStyle = '#000'; sg.fillRect( 0, 0, SW, SH ); sg.fillStyle = '#fff';
					for ( const o of seats ) {

						const p = o.geometry.attributes.position, idx = o.geometry.index, m = idx ? idx.count : p.count;
						sg.beginPath();
						for ( let t = 0; t < m; t += 3 ) {

							for ( let k = 0; k < 3; ++ k ) v[ k ].fromBufferAttribute( p, idx ? idx.getX( t + k ) : t + k ).applyMatrix4( o.matrixWorld );
							const cx = ( v[ 0 ].x + v[ 1 ].x + v[ 2 ].x ) / 3, cz = ( v[ 0 ].z + v[ 1 ].z + v[ 2 ].z ) / 3, cy = ( v[ 0 ].y + v[ 1 ].y + v[ 2 ].y ) / 3;
							const f = H.floorHeight?.( cx, cz );
							if ( f === null || f === undefined || cy - f < h0 || cy - f > h1 ) continue;
							const [ a, b, c ] = ( v[ 1 ].x - v[ 0 ].x ) * ( v[ 2 ].z - v[ 0 ].z ) - ( v[ 2 ].x - v[ 0 ].x ) * ( v[ 1 ].z - v[ 0 ].z ) < 0 ? [ v[ 0 ], v[ 2 ], v[ 1 ] ] : v;
							sg.moveTo( ( a.x - sb.x0 ) / sr, ( a.z - sb.z0 ) / sr ); sg.lineTo( ( b.x - sb.x0 ) / sr, ( b.z - sb.z0 ) / sr ); sg.lineTo( ( c.x - sb.x0 ) / sr, ( c.z - sb.z0 ) / sr ); sg.closePath();

						}
						sg.fill();

					}
					return blob( sc );

				};
				out.seats = { res: sr, minX: sb.x0, minZ: sb.z0, W: SW, H: SH, cushions: !! cush.length, seat: await layer( ...( cush.length ? [ 0.45, 0.75 ] : [ 0.3, 0.9 ] ) ), back: cush.length ? await layer( 0.75, 1.2 ) : null };

			}

		}
		// the piano and its bench: 1 cm grid over their box
		const piano = P.piano.group, bench = piano.getObjectByName( 'bench' );
		piano.updateMatrixWorld( true );
		const box = new P.camera.position.constructor(), bb = { x0: 1e9, x1: - 1e9, z0: 1e9, z1: - 1e9 };
		piano.traverse( o => {

			if ( ! o.isMesh || ! o.visible ) return;
			const p = o.geometry.attributes.position; if ( ! p ) return;
			for ( let i = 0; i < p.count; i += 7 ) { box.fromBufferAttribute( p, i ).applyMatrix4( o.matrixWorld ); bb.x0 = Math.min( bb.x0, box.x ); bb.x1 = Math.max( bb.x1, box.x ); bb.z0 = Math.min( bb.z0, box.z ); bb.z1 = Math.max( bb.z1, box.z ); }

		} );
		const pr = 0.01, pad = 0.1;
		bb.x0 -= pad; bb.z0 -= pad; bb.x1 += pad; bb.z1 += pad;
		const PW = Math.ceil( ( bb.x1 - bb.x0 ) / pr ), PH = Math.ceil( ( bb.z1 - bb.z0 ) / pr );
		const mk = () => { const c = new OffscreenCanvas( PW, PH ), x = c.getContext( '2d' ); x.fillStyle = '#000'; x.fillRect( 0, 0, PW, PH ); x.fillStyle = '#fff'; return [ c, x ]; };
		const [ caseCv, caseG ] = mk(), [ benchCv, benchG ] = mk();
		const isBench = o => { for ( let q = o; q; q = q.parent ) if ( q === bench ) return true; return false; };
		piano.traverse( o => {

			if ( ! o.isMesh || ! o.visible ) return;
			const x = isBench( o ) ? benchG : caseG, p = o.geometry.attributes.position; if ( ! p ) return; const idx = o.geometry.index, n = idx ? idx.count : p.count;
			x.beginPath();
			for ( let t = 0; t < n; t += 3 ) {

				for ( let k = 0; k < 3; ++ k ) v[ k ].fromBufferAttribute( p, idx ? idx.getX( t + k ) : t + k ).applyMatrix4( o.matrixWorld );
				if ( ( v[ 0 ].y + v[ 1 ].y + v[ 2 ].y ) / 3 > 1.02 ) continue;		// (the open lid and the desk above the rim: the outline is the case's)
				const [ a, b, c ] = ( v[ 1 ].x - v[ 0 ].x ) * ( v[ 2 ].z - v[ 0 ].z ) - ( v[ 2 ].x - v[ 0 ].x ) * ( v[ 1 ].z - v[ 0 ].z ) < 0 ? [ v[ 0 ], v[ 2 ], v[ 1 ] ] : v;
				x.moveTo( ( a.x - bb.x0 ) / pr, ( a.z - bb.z0 ) / pr );
				x.lineTo( ( b.x - bb.x0 ) / pr, ( b.z - bb.z0 ) / pr );
				x.lineTo( ( c.x - bb.x0 ) / pr, ( c.z - bb.z0 ) / pr );
				x.closePath();

			}
			x.fill();

		} );
		out.piano = { res: pr, minX: bb.x0, minZ: bb.z0, W: PW, H: PH, case: await blob( caseCv ), bench: await blob( benchCv ) };
		// the keyboard's front edge (which side the player sits)
		const kb = P.piano.keyboard?.group;
		if ( kb ) {

			let x0 = 1e9, x1 = - 1e9, z0 = 1e9, z1 = - 1e9;
			kb.updateMatrixWorld( true );
			kb.traverse( o => {

				if ( ! o.isMesh ) return;
				const p = o.geometry.attributes.position; if ( ! p ) return;
				for ( let i = 0; i < p.count; i += 5 ) { box.fromBufferAttribute( p, i ).applyMatrix4( o.matrixWorld ); x0 = Math.min( x0, box.x ); x1 = Math.max( x1, box.x ); z0 = Math.min( z0, box.z ); z1 = Math.max( z1, box.z ); }

			} );
			const b = bench ? new THREE_V().setFromMatrixPosition( bench.matrixWorld ) : null;
			out.keyboard = { x0, x1, z0, z1, bench: b ? [ b.x, b.z ] : null };

		}
		// the doors: hinge, the leaf's far edge closed and fully open
		out.doors = [];
		const SD = H.stageDoors;
		if ( SD ) for ( const name of SD.names ) {

			const d = SD.doors[ name ], was = SD.get( name ), hinge = new THREE_V().setFromMatrixPosition( d.pivot.matrixWorld );
			const far = () => {

				let best = null, bd = - 1;
				d.pivot.updateMatrixWorld( true );
				d.pivot.traverse( o => {

					if ( ! o.isMesh ) return;
					const p = o.geometry.attributes.position; if ( ! p ) return;
					for ( let i = 0; i < p.count; i += 3 ) { box.fromBufferAttribute( p, i ).applyMatrix4( o.matrixWorld ); const dd = ( box.x - hinge.x ) ** 2 + ( box.z - hinge.z ) ** 2; if ( dd > bd ) { bd = dd; best = [ box.x, box.z ]; } }

				} );
				return best;

			};
			SD.set( name, 0 ); const e0 = far(); SD.set( name, 1 ); const e1 = far(); SD.set( name, was );
			out.doors.push( { name, hinge: [ hinge.x, hinge.z ], edge0: e0, edge1: e1 } );

		}
		// the corridors behind them (not on the floor map): the floor map's grid
		if ( SD ) {

			const rows = [];
			for ( let j = 0; j < fl.nz; ++ j ) {

				let r = '';
				for ( let i = 0; i < fl.nx; ++ i ) r += SD.floorAt( fl.minX + ( i + 0.5 ) * fl.res, fl.minZ + ( j + 0.5 ) * fl.res ) !== null ? '1' : '0';
				rows.push( r );

			}
			out.corridor = rows;

		}
		return out;

	} );
	console.log( `plan: ${ plan.venue }, ${ plan.occ.kept } near-floor triangles, seats ${ plan.seats ? ( plan.seats.cushions ? 'by cushion' : 'by band' ) : 'none' }, piano ${ plan.piano.W }x${ plan.piano.H } cm, ${ plan.doors.length } door(s)` );
	// the timeline, frame by frame (not drawn)
	const t0 = Date.now();
	let endAt = null;
	for ( let f = 1; ; ++ f ) {

		s = await page.evaluate( () => window.__render.step( { draw: false } ) );
		samples.push( await sample() );
		if ( f % ( opt.fps * 10 ) === 0 ) process.stdout.write( `\r${ s.time.toFixed( 1 ) } s  ` );
		if ( opt.to !== null && s.time >= opt.to - 1e-6 ) break;
		if ( opt.to === null && ! s.state ) {

			endAt ??= s.time + 2;
			if ( s.time >= endAt ) break;

		}

	}
	console.log( `\n${ samples.length } samples (${ samples[ 0 ].t.toFixed( 2 ) }-${ samples.at( -1 ).t.toFixed( 2 ) } s) in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s` );
	const log = await page.evaluate( () => window.__spLog );
	data = { script, plan, samples, log };
	fs.writeFileSync( dataFile, JSON.stringify( data ) );

} finally {

	await browser?.close();
	stopVite();

}

// ---- outlines (python3 + OpenCV) ----
const PY = process.env.PREVIEW_PY ?? 'python3';
const WPY = process.env.PREVIEW_WHISPER_PY ?? path.join( os.homedir(), 'work/talking-midi/.venv/bin/python' );
const planFile = path.join( opt.work, 'plan.json' );
// the view: the region the user moved in, with the piano, plus a margin
let bx0 = Infinity, bx1 = - Infinity, bz0 = Infinity, bz1 = - Infinity;
for ( const p of data.samples ) { bx0 = Math.min( bx0, p.x ); bx1 = Math.max( bx1, p.x ); bz0 = Math.min( bz0, p.z ); bz1 = Math.max( bz1, p.z ); }
{ const pp = data.plan.piano; bx0 = Math.min( bx0, pp.minX ); bz0 = Math.min( bz0, pp.minZ ); bx1 = Math.max( bx1, pp.minX + pp.W * pp.res ); bz1 = Math.max( bz1, pp.minZ + pp.H * pp.res ); }
bx0 -= opt.margin; bx1 += opt.margin; bz0 -= opt.margin; bz1 += opt.margin;
fs.writeFileSync( planFile, JSON.stringify( { ...data.plan, view: [ bx0, bx1, bz0, bz1 ], floorBin: path.join( root, 'public', 'berlinhall', 'floor.bin' ) } ) );
const geomFile = path.join( opt.work, 'geom.json' );
let r = spawnSync( PY, [ path.join( root, 'tools', 'script-preview-geom.py' ), planFile, geomFile ], { stdio: 'inherit' } );
if ( r.status !== 0 ) throw new Error( 'script-preview-geom.py failed' );
const geom = JSON.parse( fs.readFileSync( geomFile, 'utf8' ) );

// ---- the lines: who says what, when ----
const dialogLines = new Map();		// id -> { role, text }
for ( const f of fs.existsSync( opt.dialogs ) ? fs.readdirSync( opt.dialogs ).filter( f => f.endsWith( '.md' ) ) : [] ) {

	const lines = fs.readFileSync( path.join( opt.dialogs, f ), 'utf8' ).split( '\n' );
	for ( let i = 0; i < lines.length; ++ i ) {

		const m = lines[ i ].match( /^\[id:\s*([^\]]+)\]/ );
		if ( ! m ) continue;
		for ( let j = i + 1; j < Math.min( lines.length, i + 4 ); ++ j ) {

			const l = lines[ j ].match( /^\s*([A-Za-z一-鿿]+)\s*[:：]\s*(.+)$/ );
			if ( l ) { if ( ! dialogLines.has( m[ 1 ].trim() ) || f.includes( path.basename( script ).split( /[-.]/ )[ 0 ] ) ) dialogLines.set( m[ 1 ].trim(), { role: l[ 1 ].toLowerCase(), text: l[ 2 ].trim() } ); break; }

		}

	}

}
const findFile = ( dir, name ) => {

	for ( const e of fs.readdirSync( dir, { withFileTypes: true } ) ) {

		const p = path.join( dir, e.name );
		if ( e.isDirectory() ) { const q = findFile( p, name ); if ( q ) return q; } else if ( e.name === name ) return p;

	}
	return null;

};
const ttsFor = midiName => {

	const id = midiName.replace( /\.midi?$/i, '' );
	for ( const d of fs.existsSync( opt.dialogs ) ? fs.readdirSync( opt.dialogs ).filter( d => d.endsWith( '-tts' ) ) : [] ) {

		const pre = d.slice( 0, - 4 ) + '-';
		if ( id.startsWith( pre ) && fs.existsSync( path.join( opt.dialogs, d, id.slice( pre.length ) + '.wav' ) ) ) return path.join( opt.dialogs, d, id.slice( pre.length ) + '.wav' );

	}
	return null;

};
const utterances = [];
for ( const e of data.log ) {

	if ( e.type === 'audio' ) {

		const id = path.basename( e.name ).replace( /\.\w+$/, '' ), d = dialogLines.get( id );
		if ( ! d ) { console.warn( `no dialogue line for recording ${ e.name }` ); continue; }
		utterances.push( { id, kind: 'audio', role: d.role, text: d.text, start: e.t, from: e.from, file: path.join( root, 'public', 'audio', e.name ) } );

	} else if ( e.type === 'midi' && e.subtitle ) {

		const file = findFile( path.join( root, 'public', 'midi' ), e.name );
		utterances.push( { id: e.name.replace( /\.midi?$/i, '' ), kind: 'midi', role: 'assistant', text: e.subtitle, start: e.t, file, tts: ttsFor( e.name ) } );

	}

}
const alignIn = path.join( opt.work, 'utterances.json' ), alignOut = path.join( opt.work, 'aligned.json' );
fs.writeFileSync( alignIn, JSON.stringify( utterances, null, 1 ) );
r = spawnSync( WPY, [ path.join( root, 'tools', 'script-preview-align.py' ), alignIn, alignOut, '--cache', path.join( opt.work, 'whisper-cache.json' ), ...( opt.align ? [] : [ '--no-whisper' ] ) ], { stdio: 'inherit' } );
if ( r.status !== 0 ) throw new Error( 'script-preview-align.py failed' );
const aligned = JSON.parse( fs.readFileSync( alignOut, 'utf8' ) );

// ---- the camera hints: the script's own comments on its camera moves ----
const hints = new Map();		// timeline index -> comment
{

	const lines = fs.readFileSync( scriptFile, 'utf8' ).split( '\n' );
	let inT = false, idx = - 1, pending = [], indent = null;
	for ( const l of lines ) {

		if ( /^timeline:\s*$/.test( l ) ) { inT = true; continue; }
		if ( ! inT ) continue;
		if ( /^\S/.test( l ) ) break;
		const item = l.match( /^(\s*)-\s/ );
		if ( item && ( indent === null || item[ 1 ].length === indent ) ) {

			indent = item[ 1 ].length;
			++ idx;
			const c = l.match( /#\s*(.+)$/ );
			const text = [ ...pending, c ? c[ 1 ] : '' ].filter( Boolean ).join( ' ' ).trim();
			if ( text ) hints.set( idx, text );
			pending = [];

		} else if ( /^\s*#/.test( l ) && ( indent === null || l.match( /^(\s*)/ )[ 1 ].length <= indent ) ) pending.push( l.replace( /^\s*#\s*/, '' ) );
		else if ( /^\s*#/.test( l ) ) { /* deeper comment */ }

	}

}

// ---- the SVG ----
const S = data.samples, T0 = S[ 0 ].t, T1 = S.at( -1 ).t, DUR = Math.max( 0.1, T1 - T0 );
const kt = t => Math.min( 1, Math.max( 0, ( t - T0 ) / DUR ) );
const begin = t => `${ Math.max( 0, t - T0 ).toFixed( 3 ) }s`;
// (the longer side of the region at --width px; the canvas takes the region's own proportions)
const PX = opt.width / Math.max( bx1 - bx0, bz1 - bz0 ), PLAN_H = Math.round( ( bz1 - bz0 ) * PX );
const SUB_H = 210, W = Math.max( 900, Math.round( ( bx1 - bx0 ) * PX ) ), H = PLAN_H + SUB_H;
const X = x => ( ( x - bx0 ) * PX ).toFixed( 1 ), Y = z => ( ( z - bz0 ) * PX ).toFixed( 1 );
const poly = pts => pts.map( ( [ x, z ], i ) => `${ i ? 'L' : 'M' }${ X( x ) } ${ Y( z ) }` ).join( '' ) + 'Z';
const esc = s => String( s ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );

// keyframes: Douglas-Peucker over time on several channels at once (each with its tolerance)
function simplify( ts, chans, tols ) {

	const n = ts.length, keep = new Uint8Array( n );
	keep[ 0 ] = keep[ n - 1 ] = 1;
	const stack = [ [ 0, n - 1 ] ];
	while ( stack.length ) {

		const [ a, b ] = stack.pop();
		let worst = 1, wi = - 1;
		for ( let i = a + 1; i < b; ++ i ) {

			const u = ( ts[ i ] - ts[ a ] ) / ( ts[ b ] - ts[ a ] || 1 );
			for ( let c = 0; c < chans.length; ++ c ) {

				const e = Math.abs( chans[ c ][ a ] + ( chans[ c ][ b ] - chans[ c ][ a ] ) * u - chans[ c ][ i ] ) / tols[ c ];
				if ( e > worst ) { worst = e; wi = i; }

			}

		}
		if ( wi >= 0 ) { keep[ wi ] = 1; stack.push( [ a, wi ], [ wi, b ] ); }

	}
	return [ ...keep.keys() ].filter( i => keep[ i ] );

}

const ts = S.map( p => p.t );
// the camera: position (px), heading (deg, unwrapped), half the horizontal view (portrait 1:2), the target
const cx = S.map( p => ( p.x - bx0 ) * PX ), cy = S.map( p => ( p.z - bz0 ) * PX );
const ang = [];
for ( const p of S ) {

	let a = Math.atan2( p.dz, p.dx ) * 180 / Math.PI;
	if ( ang.length ) { const prev = ang.at( -1 ); while ( a - prev > 180 ) a -= 360; while ( a - prev < - 180 ) a += 360; }
	ang.push( a );

}
const half = S.map( p => Math.atan( Math.tan( p.fov * Math.PI / 360 ) * 0.5 ) * 180 / Math.PI );
const tgx = S.map( p => ( p.tx - bx0 ) * PX ), tgy = S.map( p => ( p.tz - bz0 ) * PX );
const camKeys = simplify( ts, [ cx, cy, ang, half ], [ 0.6, 0.6, 0.8, 0.4 ] );
const keyTimes = ks => ks.map( i => kt( ts[ i ] ).toFixed( 4 ) ).join( ';' );
const WEDGE = 2.6 * PX;
const wedge = h => {

	const r = h * Math.PI / 180, x = WEDGE * Math.cos( r ), y = WEDGE * Math.sin( r );
	return `M0 0L${ x.toFixed( 1 ) } ${ ( - y ).toFixed( 1 ) }A${ WEDGE.toFixed( 1 ) } ${ WEDGE.toFixed( 1 ) } 0 0 1 ${ x.toFixed( 1 ) } ${ y.toFixed( 1 ) }Z`;

};
// the path walked so far: the whole path, drawn as far as it has been walked (its dash offset)
const pathKeys = simplify( ts, [ cx, cy ], [ 0.5, 0.5 ] );
const cum = [ 0 ];
for ( let k = 1; k < pathKeys.length; ++ k ) cum.push( cum[ k - 1 ] + Math.hypot( cx[ pathKeys[ k ] ] - cx[ pathKeys[ k - 1 ] ], cy[ pathKeys[ k ] ] - cy[ pathKeys[ k - 1 ] ] ) );
const L = Math.max( 1, cum.at( -1 ) );
const trailD = pathKeys.map( ( i, k ) => `${ k ? 'L' : 'M' }${ cx[ i ].toFixed( 1 ) } ${ cy[ i ].toFixed( 1 ) }` ).join( '' );
const tgtKeys = simplify( ts, [ tgx, tgy ], [ 2, 2 ] );

// doors: the leaf's angle from closed (deg, about the hinge)
const doorSvg = [];
for ( const d of geom.doors ?? [] ) {

	const a0 = Math.atan2( d.edge0[ 1 ] - d.hinge[ 1 ], d.edge0[ 0 ] - d.hinge[ 0 ] ), a1 = Math.atan2( d.edge1[ 1 ] - d.hinge[ 1 ], d.edge1[ 0 ] - d.hinge[ 0 ] );
	let sweep = ( a1 - a0 ) * 180 / Math.PI;
	while ( sweep > 180 ) sweep -= 360; while ( sweep < - 180 ) sweep += 360;
	const len = Math.hypot( d.edge0[ 0 ] - d.hinge[ 0 ], d.edge0[ 1 ] - d.hinge[ 1 ] ) * PX;
	const op = S.map( p => p.doors?.[ d.name ] ?? 0 ), ks = simplify( ts, [ op ], [ 0.01 ] );
	const vals = ks.map( i => ( op[ i ] * sweep ).toFixed( 2 ) ).join( ';' );
	const hx = X( d.hinge[ 0 ] ), hy = Y( d.hinge[ 1 ] );
	const ex = ( len * Math.cos( sweep * Math.PI / 180 ) ).toFixed( 1 ), ey = ( len * Math.sin( sweep * Math.PI / 180 ) ).toFixed( 1 );
	doorSvg.push( `<g transform="translate(${ hx } ${ hy }) rotate(${ ( a0 * 180 / Math.PI ).toFixed( 2 ) })"><path d="M${ len.toFixed( 1 ) } 0A${ len.toFixed( 1 ) } ${ len.toFixed( 1 ) } 0 0 ${ sweep > 0 ? 1 : 0 } ${ ex } ${ ey }" class="doorarc"/>` +
		`<g><line x1="0" y1="0" x2="${ len.toFixed( 1 ) }" y2="0" class="door"/>` +
		( op.some( v => v ) ? `<animateTransform attributeName="transform" type="rotate" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ vals }" keyTimes="${ keyTimes( ks ) }"/>` : '' ) + '</g></g>' );

}

// small print: piecewise-constant strings over time
function segments( fn ) {

	const out = [];
	for ( const p of S ) {

		const v = fn( p );
		if ( out.length && out.at( -1 ).v === v ) out.at( -1 ).t1 = p.t; else out.push( { v, t0: p.t, t1: p.t } );

	}
	for ( let i = 0; i < out.length - 1; ++ i ) out[ i ].t1 = out[ i + 1 ].t0;
	out.at( -1 ).t1 = T1 + 1;
	return out;

}
const vis = ( t0, t1 ) => `<set attributeName="visibility" to="visible" begin="${ begin( t0 ) }" end="${ begin( t1 ) }"/>`;
const label = ( segs, x, y, cls ) => segs.filter( s => s.v ).map( s => `<text x="${ x }" y="${ y }" class="${ cls }" visibility="hidden">${ esc( s.v ) }${ vis( s.t0, s.t1 ) }</text>` ).join( '' );
const fmt = t => `${ String( Math.floor( t / 60 ) ).padStart( 2, '0' ) }:${ String( Math.floor( t % 60 ) ).padStart( 2, '0' ) }`;
const lightSeg = segments( p => p.fade ? `灯光 ${ p.preset } → ${ p.fade.to } ${ Math.round( p.fade.u * 10 ) * 10 }%` : `灯光 ${ p.preset }` );
const screenSeg = segments( p => `屏幕 ${ p.screen ? '开' : '关' }` );
const doorSeg = segments( p => Object.entries( p.doors ?? {} ).filter( ( [ , v ] ) => v > 0 ).map( ( [ n, v ] ) => `门 ${ n } ${ v >= 0.999 ? '开' : `${ Math.round( v * 100 ) }%` }` ).join( '  ' ) || '门 关' );
const midiSeg = segments( p => p.midi && ! /^berlinhall-|voice/i.test( p.midi ) ? `♪ ${ p.midi.replace( /\.midi?$/i, '' ) }` : '' );
const timeSeg = [];
for ( let t = Math.floor( T0 ); t <= T1; ++ t ) timeSeg.push( { v: fmt( t ), t0: Math.max( T0, t ), t1: t + 1 } );
// camera hints: the comment of each camera event, for its move (at least 1.6 s)
const camHints = [];
{

	const evs = data.log.filter( e => e.type === 'event' );
	const doc = fs.readFileSync( scriptFile, 'utf8' );
	for ( let k = 0; k < evs.length; ++ k ) {

		const h = hints.get( evs[ k ].i );
		if ( ! h ) continue;
		// (one at a time: until the next comment, at most 6 s)
		const next = evs.slice( k + 1 ).find( e => hints.has( e.i ) && e.t > evs[ k ].t + 0.05 );
		camHints.push( { v: h.length > 110 ? h.slice( 0, 108 ) + '…' : h, t0: evs[ k ].t, t1: Math.min( next ? next.t : Infinity, evs[ k ].t + 6 ) } );

	}
	void doc;

}

// subtitles: two slots of two lines; a line typed out character by character, moved up a line when the next begins
const ROLE = { assistant: [ '小音', '#1f7fd1' ], user: [ '用户', '#e0701c' ], vendor: [ '店员', '#b0359c' ] };
const FONT = 30, LINE_H = 40, CHARS = Math.max( 10, Math.floor( ( W - 130 ) / ( FONT * 1.02 ) ) );
const subs = aligned.filter( u => u.chars?.length ).map( u => ( { ...u, t0: u.chars[ 0 ].t - 0.05, t1: u.chars.at( -1 ).t } ) ).sort( ( a, b ) => a.t0 - b.t0 );
const HOLD = 1.6, FADE = 0.4;
// shown from its first character to HOLD s after its last; at most two at once (a third ends the oldest)
for ( const u of subs ) u.end = u.t1 + HOLD;
for ( let i = 0; i < subs.length; ++ i ) {

	const on = subs.slice( 0, i ).filter( v => v.end > subs[ i ].t0 );
	if ( on.length >= 2 ) on.sort( ( a, b ) => a.t0 - b.t0 )[ 0 ].end = subs[ i ].t0;

}
// its slot over time: the newest at the bottom (slot 0), the one before it above (slot 1)
const changes = [ ...new Set( subs.flatMap( u => [ u.t0, u.end ] ) ) ].sort( ( a, b ) => a - b );
for ( const u of subs ) u.slots = [];
for ( const t of changes ) {

	const on = subs.filter( u => u.t0 <= t + 1e-6 && u.end > t + 1e-6 ).sort( ( a, b ) => b.t0 - a.t0 );
	on.forEach( ( u, k ) => { if ( u.slots.at( -1 )?.slot !== k ) u.slots.push( { t, slot: Math.min( k, 1 ) } ); } );

}
const SLOT_H = 2 * LINE_H + 16;
const slotTop = slot => PLAN_H + 12 + ( 1 - slot ) * SLOT_H;
const subsOut = subs.map( u => {

	const [ who, col ] = ROLE[ u.role ] ?? [ u.role, '#444' ];
	const lines = [];
	for ( let i = 0; i < u.chars.length; i += CHARS ) lines.push( u.chars.slice( i, i + CHARS ) );
	const sl = u.slots.length ? u.slots : [ { t: u.t0, slot: 0 } ];
	const moveSlot = sl.length > 1 ? `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ [ sl[ 0 ], ...sl ].map( x => `0 ${ slotTop( x.slot ) }` ).join( ';' ) }" keyTimes="0;${ sl.map( x => kt( x.t ).toFixed( 4 ) ).join( ';' ) }"/>` : '';
	let s = `<g transform="translate(0 ${ slotTop( sl[ 0 ].slot ) })">${ moveSlot }<g opacity="0"><set attributeName="opacity" to="1" begin="${ begin( u.t0 ) }"/><animate attributeName="opacity" from="1" to="0" begin="${ begin( u.end ) }" dur="${ FADE }s" fill="freeze"/>`;
	s += `<text x="20" y="${ LINE_H - 6 }" class="who" fill="${ col }">${ esc( who ) }</text>`;
	lines.forEach( ( cs, k ) => {

		const next = lines[ k + 1 ]?.[ 0 ].t, after = lines[ k + 2 ]?.[ 0 ].t;
		// typed on the lower line, then up a line while the next is typed, then gone
		const moves = next !== undefined ? `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="0 0;0 ${ - LINE_H }" keyTimes="0;${ kt( next ).toFixed( 4 ) }"/>` : '';
		// (display, not visibility: the characters' own visibility would show through a hidden line)
		const gone = after !== undefined ? `<set attributeName="display" to="none" begin="${ begin( after ) }"/>` : '';
		s += `<text x="${ k || lines.length > 1 ? 100 : 100 }" y="${ 2 * LINE_H - 6 }" class="line" fill="${ col }">${ moves }${ gone }`;
		for ( const c of cs ) s += `<tspan visibility="hidden">${ esc( c.c ) }<set attributeName="visibility" to="visible" begin="${ begin( c.t ) }"/></tspan>`;
		s += '</text>';

	} );
	return s + '</g></g>';

} ).join( '\n' );

// the plan's layers
const g2 = geom;
const levelFill = ( g2.levels ?? [] ).map( l => `<path d="${ l.polys.map( poly ).join( '' ) }" fill="${ l.fill }" fill-rule="evenodd"/>` ).join( '' );
const edges = ( g2.edges ?? [] ).map( pts => `M${ pts.map( ( [ x, z ] ) => `${ X( x ) } ${ Y( z ) }` ).join( 'L' ) }` ).join( '' );
const occ = ( g2.occ ?? [] ).map( poly ).join( '' );
const seatsD = ( g2.seats ?? [] ).map( poly ).join( '' ), backsD = ( g2.seatBacks ?? [] ).map( poly ).join( '' );
const corr = ( g2.corridor ?? [] ).map( poly ).join( '' );
const pianoD = ( g2.piano?.case ?? [] ).map( poly ).join( '' ), benchD = ( g2.piano?.bench ?? [] ).map( poly ).join( '' );
const kb = data.plan.keyboard;
// labels: stage / stalls / doors, a scale bar, the north (+z down the page: the audience's right)
const scaleM = PX > 80 ? 1 : PX > 30 ? 2 : 5;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ W } ${ H }" width="${ W }" height="${ H }" font-family="'Noto Sans CJK SC','PingFang SC','Microsoft YaHei',sans-serif">
<title>${ esc( path.basename( script ) ) } — top-down preview</title>
<style>
.edge{fill:none;stroke:#7d7466;stroke-width:1.2}
.occ{fill:#d9d2c4;stroke:#8e8574;stroke-width:0.7}
.seat{fill:#d8c39c;stroke:#7a6646;stroke-width:0.7}
.seatback{fill:#8c7350;stroke:none}
.corr{fill:#ece4d6;stroke:#9a8f7c;stroke-width:1;stroke-dasharray:4 3}
.piano{fill:#2b2b2e;stroke:#000;stroke-width:1.2}
.bench{fill:#55555a;stroke:#000;stroke-width:1}
.door{stroke:#8a4b1c;stroke-width:4;stroke-linecap:round}
.doorarc{fill:none;stroke:#8a4b1c;stroke-width:0.8;stroke-dasharray:3 3}
.trail{fill:none;stroke:#d14b3f;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.ghost{fill:none;stroke:#d14b3f;stroke-opacity:0.18;stroke-width:1.4;stroke-dasharray:5 4}
.wedge{fill:#ffcf3f;fill-opacity:0.38;stroke:#c99a10;stroke-width:1}
.small{font-size:15px;fill:#333}
.hint{font-size:15px;fill:#5a4a8a;font-style:italic}
.tc{font-size:24px;fill:#fff;font-weight:700;text-anchor:middle;font-family:'DejaVu Sans Mono',Menlo,monospace}
.who{font-size:24px;font-weight:700}
.line{font-size:${ FONT }px}
.lab{font-size:16px;fill:#6b6252;letter-spacing:2px}
</style>
<rect width="${ W }" height="${ H }" fill="#f6f3ec"/>
<clipPath id="plan"><rect width="${ W }" height="${ PLAN_H }"/></clipPath>
<g clip-path="url(#plan)">
<g>${ levelFill }</g>
<path d="${ corr }" class="corr"/>
<path d="${ occ }" class="occ" fill-rule="evenodd"/>
<path d="${ seatsD }" class="seat"/>
<path d="${ backsD }" class="seatback"/>
<path d="${ edges }" class="edge"/>
${ doorSvg.join( '\n' ) }
<path d="${ pianoD }" class="piano" fill-rule="evenodd"/>
<path d="${ benchD }" class="bench" fill-rule="evenodd"/>
${ kb ? `<line x1="${ X( kb.x0 ) }" y1="${ Y( kb.z1 ) }" x2="${ X( kb.x1 ) }" y2="${ Y( kb.z1 ) }" stroke="#f2f2f2" stroke-width="3"/>` : '' }
${ ( g2.labels ?? [] ).map( l => `<text x="${ X( l.x ) }" y="${ Y( l.z ) }" class="lab" text-anchor="middle">${ esc( l.text ) }</text>` ).join( '' ) }
<path d="${ trailD }" class="ghost"/>
<path d="${ trailD }" class="trail" stroke-dasharray="${ L.toFixed( 1 ) } ${ ( L + 10 ).toFixed( 1 ) }" stroke-dashoffset="${ L.toFixed( 1 ) }"><animate attributeName="stroke-dashoffset" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ cum.map( c => ( L - c ).toFixed( 1 ) ).join( ';' ) }" keyTimes="${ keyTimes( pathKeys ) }"/></path>
<g><animateTransform attributeName="transform" type="translate" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ tgtKeys.map( i => `${ tgx[ i ].toFixed( 1 ) } ${ tgy[ i ].toFixed( 1 ) }` ).join( ';' ) }" keyTimes="${ keyTimes( tgtKeys ) }"/><circle r="9" fill="none" stroke="#ffb000" stroke-width="2.5"/><path d="M-6 -6L6 6M-6 6L6 -6" stroke="#ffb000" stroke-width="2.5"/></g>
<g><animateTransform attributeName="transform" type="translate" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ camKeys.map( i => `${ cx[ i ].toFixed( 1 ) } ${ cy[ i ].toFixed( 1 ) }` ).join( ';' ) }" keyTimes="${ keyTimes( camKeys ) }"/>
<g><animateTransform attributeName="transform" type="rotate" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ camKeys.map( i => ang[ i ].toFixed( 1 ) ).join( ';' ) }" keyTimes="${ keyTimes( camKeys ) }"/>
<path class="wedge" d="${ wedge( half[ 0 ] ) }"><animate attributeName="d" dur="${ DUR.toFixed( 3 ) }s" fill="freeze" values="${ camKeys.map( i => wedge( half[ i ] ) ).join( ';' ) }" keyTimes="${ keyTimes( camKeys ) }"/></path>
<path d="M14 0L4 -6L4 6Z" fill="#d14b3f"/></g>
<circle r="7" fill="#d14b3f" stroke="#fff" stroke-width="2"/></g>
</g>
<rect x="0" y="0" width="${ W }" height="44" fill="#f6f3ec" fill-opacity="0.85"/>
<rect x="8" y="6" width="92" height="32" rx="5" fill="#222"/>
<g>${ label( timeSeg, 54, 31, 'tc' ) }</g>
<g>${ label( lightSeg, 120, 28, 'small' ) }${ label( screenSeg, 470, 28, 'small' ) }${ label( doorSeg, 560, 28, 'small' ) }${ label( midiSeg, 800, 28, 'small' ) }</g>
<g>${ camHints.map( h => `<text x="16" y="${ PLAN_H - 14 }" class="hint" visibility="hidden">${ esc( h.v ) }${ vis( h.t0, h.t1 ) }</text>` ).join( '' ) }</g>
<g transform="translate(${ W - 30 - scaleM * PX } ${ PLAN_H - 22 })"><path d="M0 0H${ ( scaleM * PX ).toFixed( 1 ) }M0 -5V5M${ ( scaleM * PX ).toFixed( 1 ) } -5V5" stroke="#333" stroke-width="2"/><text x="${ ( scaleM * PX / 2 ).toFixed( 1 ) }" y="-8" class="small" text-anchor="middle">${ scaleM } m</text></g>
<line x1="0" y1="${ PLAN_H }" x2="${ W }" y2="${ PLAN_H }" stroke="#b9b0a0"/>
<rect x="0" y="${ PLAN_H + 1 }" width="${ W }" height="${ SUB_H - 1 }" fill="#fbfaf6"/>
${ subsOut }
</svg>
`;
fs.mkdirSync( path.dirname( opt.out ), { recursive: true } );
fs.writeFileSync( opt.out, svg );
// the player page: play / pause / scrub (SVG setCurrentTime)
const html = `<!doctype html><meta charset="utf-8"><title>${ esc( path.basename( script ) ) } preview</title>
<style>body{margin:0;background:#222;color:#eee;font:14px sans-serif}#bar{display:flex;gap:10px;align-items:center;padding:8px}#t{flex:1}object{display:block;width:100%;height:calc(100vh - 44px)}</style>
<div id="bar"><button id="p">⏸</button><input id="t" type="range" min="0" max="${ DUR.toFixed( 2 ) }" step="0.05" value="0"><span id="c">0.0 s</span></div>
<object id="o" type="image/svg+xml" data="${ esc( path.basename( opt.out ) ) }"></object>
<script>
const o=document.getElementById('o'),p=document.getElementById('p'),t=document.getElementById('t'),c=document.getElementById('c');let svg=null,drag=false;
o.addEventListener('load',()=>{svg=o.contentDocument.documentElement;tick();});
p.onclick=()=>{if(!svg)return;if(svg.animationsPaused()){svg.unpauseAnimations();p.textContent='⏸';}else{svg.pauseAnimations();p.textContent='▶';}};
t.oninput=()=>{drag=true;if(svg)svg.setCurrentTime(+t.value);c.textContent=(+t.value).toFixed(1)+' s';};t.onchange=()=>{drag=false;};
function tick(){if(svg&&!drag){const s=svg.getCurrentTime();t.value=s;c.textContent=s.toFixed(1)+' s';}requestAnimationFrame(tick);}
</script>`;
fs.writeFileSync( opt.out.replace( /\.svg$/i, '.html' ), html );
console.log( `wrote ${ opt.out } (${ ( fs.statSync( opt.out ).size / 1024 ).toFixed( 0 ) } KB, ${ DUR.toFixed( 1 ) } s, ${ subs.length } lines) and ${ path.basename( opt.out.replace( /\.svg$/i, '.html' ) ) }` );

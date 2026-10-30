import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { TextureBaker } from './textures.js';
import { makeMaterials, STYLES, applyGlass } from './materials.js';
import { buildUpright } from './upright.js';
import { buildGrand } from './grand.js';
import { Room, LIGHT_PRESETS } from './room.js';
import { GIProbe } from './gi.js';
import { PathTracer } from './pathtracer.js';
import { KeyShadow } from './keyshadow.js';
import { Synth } from './synth.js';
import { prefetchSoundfont, soundfontStatus } from './soundfont.js';
import { MidiFilePlayer } from './midi.js';
import { PITCH_MIN, PITCH_MAX } from './keyboard.js';

// start downloading the piano sound right away, in parallel with building the scene
prefetchSoundfont();

const params = new URLSearchParams( location.search );

const settings = {
	style: params.get( 'style' ) ?? 'upright-oak',
	mode: params.get( 'mode' ) ?? 'realtime',		// 'realtime' | 'pathtrace'
	// global illumination / high quality: off favours frame rate (see applyQuality)
	gi: params.has( 'gi' ) ? params.get( 'gi' ) !== '0' : false,
	preset: 'Sunlit afternoon',
	exposure: Number( params.get( 'exposure' ) ?? 1.7 ),
	toneMapping: 'AgX',
	ao: true,
	aoRadius: 0.25,
	bloom: 0.12,
	giBounces: 2,
	ptBounces: 8,
	lidAngle: 34,
	volume: 0.5,
};

// ---------------------------------------------------------------------------
// renderer

const renderer = new THREE.WebGLRenderer( { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has( 'capture' ) } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
// shadow maps are re-rendered only when something moved or the lighting changed (see frame)
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = params.get( 'shadow' ) === 'vsm' ? THREE.VSMShadowMap : THREE.PCFShadowMap;
document.body.appendChild( renderer.domElement );

const TONE = { AgX: THREE.AgXToneMapping, ACES: THREE.ACESFilmicToneMapping, Neutral: THREE.NeutralToneMapping };

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 36, window.innerWidth / window.innerHeight, 0.03, 60 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.35;
controls.maxDistance = 5.0;
controls.maxPolarAngle = Math.PI * 0.53;

const baker = new TextureBaker( renderer );
const room = new Room( scene, baker );
const probe = new GIProbe( renderer, scene );
const keyShadow = new KeyShadow( renderer );
renderer.debug.onShaderError = ( gl, program, vs, fs ) => {

	const log = gl.getProgramInfoLog( program ) + '\n' + gl.getShaderInfoLog( vs ) + '\n' + gl.getShaderInfoLog( fs );
	console.error( 'Shader build failed:', log );
	if ( keyShadow.enabled ) {

		console.warn( 'Disabling the keyboard shadow map on this GPU' );
		keyShadow.broken = true;
		keyShadow.setEnabled( false );

	}

};
const pathTracer = new PathTracer( renderer );
const synth = new Synth();

// ---------------------------------------------------------------------------
// post-processing

const composerTarget = new THREE.WebGLRenderTarget( 1, 1, { type: THREE.HalfFloatType, samples: 4 } );
const composer = new EffectComposer( renderer, composerTarget );
const renderPass = new RenderPass( scene, camera );
const gtaoPass = new GTAOPass( scene, camera, 1, 1 );
gtaoPass.output = GTAOPass.OUTPUT.Default;
const bloomPass = new UnrealBloomPass( new THREE.Vector2( 1, 1 ), settings.bloom, 0.6, 0.92 );
const outputPass = new OutputPass();
composer.addPass( renderPass );
composer.addPass( gtaoPass );
composer.addPass( bloomPass );
composer.addPass( outputPass );

function applyAO() {

	gtaoPass.enabled = settings.ao && settings.gi;
	gtaoPass.updateGtaoMaterial( { radius: settings.aoRadius, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 16 } );
	gtaoPass.updatePdMaterial( { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 } );
	gtaoPass.blendIntensity = 1.0;

}

pathTracer.rasterCallback = () => composer.render();

// ---------------------------------------------------------------------------
// piano

let piano = null;

function disposeGroup( group ) {

	group.traverse( o => o.geometry?.dispose() );

}

function setStyle( id ) {

	const style = STYLES.find( s => s.id === id ) ?? STYLES[ 0 ];
	settings.style = style.id;

	if ( piano ) {

		scene.remove( piano.group );
		piano.keyboard.dispose();
		disposeGroup( piano.group );

	}

	const M = makeMaterials( baker, style.id );
	piano = style.type === 'grand' ? buildGrand( M, { lidAngle: settings.lidAngle } ) : buildUpright( M, { renderer } );
	piano.style = style;
	piano.pedalMeshes = [];
	piano.group.traverse( o => o.userData.pedal && piano.pedalMeshes.push( o ) );
	for ( const [ name, holds ] of Object.entries( pedalHolds ) ) if ( holds.size ) piano.action?.setPedal( name, true );
	// back of the piano against the back wall
	piano.group.position.set( 0, 0, room.backWallZ + piano.depth + 0.03 );
	piano.materials = M;
	applyGlass( M.glass, settings.gi || settings.mode === 'pathtrace' );
	scene.add( piano.group );
	keyShadow.attach( piano, [ M.keyWhite, M.keyBlack ], settings.gi && ! keyShadow.broken );
	scene.updateMatrixWorld( true );

	const off = piano.group.position;
	camera.position.copy( piano.camera.position ).add( off );
	controls.target.copy( piano.camera.target ).add( off );
	controls.update();

	probe.position.set( 0, 1.1, off.z + 0.9 );
	room.lampTarget = off;
	refreshLighting();

}

// ---------------------------------------------------------------------------
// lighting / GI

let ptDirty = true;
let shadowsDirty = true;

/**
 * Global illumination off (default): device pixel ratio 1, no GTAO and bloom, plain PCF sun
 * shadows from a 2048 map without the keyboard's own shadow map, single-bounce probe, alpha
 * glass instead of transmission. On: full quality (pixel ratio up to 2, GTAO, bloom, PCSS
 * contact-hardening shadows, keyboard shadow map, 2-bounce probe GI, transmissive glass).
 */
function applyQuality( relight = true ) {

	const hq = settings.gi;
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, hq ? 2 : 1 ) );
	composer.setPixelRatio( renderer.getPixelRatio() );
	resize();
	applyAO();
	bloomPass.enabled = hq && settings.bloom > 0;
	// full resolution: the strings and pins behind the glass must stay sharp
	renderer.transmissionResolutionScale = 1.0;
	room.setQuality( hq );
	keyShadow.setEnabled( hq && ! keyShadow.broken );
	if ( piano ) applyGlass( piano.materials.glass, hq || room.mode === 'pathtrace' );
	shadowsDirty = true;
	if ( relight ) refreshLighting();

}
let probeEnv = null;

// raster: prefiltered room probe; path tracer: the sky itself (light enters through the window)
function setLightingMode( mode ) {

	room.setMode( mode );
	if ( piano ) applyGlass( piano.materials.glass, mode === 'pathtrace' || settings.gi );
	shadowsDirty = true;
	scene.environment = mode === 'pathtrace' ? room.sky : probeEnv;
	scene.environmentIntensity = mode === 'pathtrace' ? 1 : probe.intensity;

}

// mirror-like piano surfaces (screen, lacquer, glass) reflect the probe without sun and sky
// (see gi.js); the window itself then appears once, as the window light's sharp reflection
function applySpecularEnv() {

	if ( ! piano?.materials || ! probe.specular ) return;
	for ( const mat of Object.values( piano.materials ) ) {

		if ( ! mat?.isMeshStandardMaterial || mat.roughnessMap || mat.roughness > 0.2 ) continue;
		if ( ! mat.envMap ) mat.needsUpdate = true;
		mat.envMap = probe.specular;

	}

}

function refreshLighting() {

	room.updateLights();
	renderer.toneMappingExposure = settings.exposure * room.light.exposure;
	renderer.toneMapping = TONE[ settings.toneMapping ];
	probe.bounces = settings.gi ? settings.giBounces : 1;
	renderer.shadowMap.needsUpdate = true;
	shadowsDirty = true;
	probeEnv = probe.update( piano ? [ piano.group ] : [], { lights: [ room.sun ], objects: [ room.foliage ].filter( Boolean ) } );
	applySpecularEnv();
	if ( settings.mode === 'pathtrace' ) setLightingMode( 'pathtrace' );
	ptDirty = true;

}

function setMode( mode ) {

	settings.mode = mode;
	setLightingMode( mode === 'pathtrace' ? 'pathtrace' : 'raster' );
	if ( mode !== 'pathtrace' ) refreshLighting();
	ptDirty = true;

}

// ---------------------------------------------------------------------------
// input: mouse on keys, computer keyboard, Web MIDI

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerPitch = null;
const keysDown = new Set();

// `sound: false` animates only (MIDI file playback schedules its own sound)
function noteOn( pitch, velocity = 0.8, { sound = true } = {} ) {

	if ( pitch < PITCH_MIN || pitch > PITCH_MAX ) {

		if ( sound ) synth.noteOn( pitch, velocity );
		return;

	}

	piano.keyboard.press( pitch, velocity );
	piano.action?.press( pitch, velocity );
	if ( sound ) synth.noteOn( pitch, velocity );

}

function noteOff( pitch, { sound = true } = {} ) {

	if ( pitch >= PITCH_MIN && pitch <= PITCH_MAX ) {

		piano.keyboard.release( pitch );
		piano.action?.release( pitch );

	}

	if ( sound ) synth.noteOff( pitch );

}

// pedals: soft (left), sostenuto (middle), sustain (right). Several sources (keyboard,
// pointer, MIDI) may hold one; it is down while any of them is.
const pedalHolds = { soft: new Set(), sostenuto: new Set(), sustain: new Set() };
let pointerPedal = null;

function pedal( name, source, on ) {

	const holds = pedalHolds[ name ];
	const was = holds.size > 0;
	if ( on ) holds.add( source ); else holds.delete( source );
	const now = holds.size > 0;
	if ( was !== now ) applyPedal( name, now );

}

function applyPedal( name, on ) {

	piano.action?.setPedal( name, on );
	if ( name === 'sustain' ) synth.sustain = on;
	if ( name === 'soft' ) synth.soft = on;
	if ( name === 'sostenuto' ) {

		synth.latched.clear();
		if ( on ) for ( const [ p, k ] of piano.keyboard.keys ) if ( k.target > 0 ) synth.latched.add( p );

	}

	// releasing a pedal damps every note whose key is up and that nothing else holds
	if ( ! on && name !== 'soft' ) {

		for ( const p of [ ...synth.voices.keys() ] ) if ( ! piano.keyboard.keys.get( p )?.target ) synth.noteOff( p );

	}

}

function pick( event ) {

	const rect = renderer.domElement.getBoundingClientRect();
	pointer.set( ( event.clientX - rect.left ) / rect.width * 2 - 1, - ( event.clientY - rect.top ) / rect.height * 2 + 1 );
	raycaster.setFromCamera( pointer, camera );
	const hit = raycaster.intersectObjects( [ ...piano.keyboard.pickables, ...piano.pedalMeshes ], false )[ 0 ];
	return hit ? hit.object.userData : null;

}

renderer.domElement.addEventListener( 'pointerdown', event => {

	const hit = pick( event );
	if ( ! hit ) return;
	controls.enabled = false;
	if ( hit.pedal ) {

		pointerPedal = hit.pedal;
		pedal( hit.pedal, 'pointer', true );
		return;

	}

	pointerPitch = hit.pitch;
	noteOn( hit.pitch, 0.8 );

}, { capture: true } );

renderer.domElement.addEventListener( 'pointermove', event => {

	if ( pointerPitch === null ) return;
	const pitch = pick( event )?.pitch ?? null;
	if ( pitch !== null && pitch !== pointerPitch ) {

		noteOff( pointerPitch );
		pointerPitch = pitch;
		noteOn( pitch, 0.7 );

	}

} );

window.addEventListener( 'pointerup', () => {

	if ( pointerPitch !== null ) noteOff( pointerPitch );
	if ( pointerPedal !== null ) pedal( pointerPedal, 'pointer', false );
	pointerPitch = null;
	pointerPedal = null;
	controls.enabled = true;

} );

// two rows mapped like a tracker keyboard, starting at C4
const KEYMAP = 'awsedftgyhujkolp;\'';
let octaveShift = 0;

window.addEventListener( 'keydown', event => {

	if ( event.repeat || event.target.closest?.( '.lil-gui' ) ) return;
	const k = event.key.toLowerCase();
	if ( k === 'z' ) { octaveShift = Math.max( - 3, octaveShift - 1 ); return; }
	if ( k === 'x' ) { octaveShift = Math.min( 3, octaveShift + 1 ); return; }
	if ( k === ' ' ) { pedal( 'sustain', 'key', true ); event.preventDefault(); return; }
	if ( k === 'q' ) { pedal( 'soft', 'key', true ); return; }
	if ( k === 'r' ) { pedal( 'sostenuto', 'key', true ); return; }
	const i = KEYMAP.indexOf( k );
	if ( i < 0 ) return;
	const pitch = 60 + i + 12 * octaveShift;
	keysDown.add( k + ':' + pitch );
	noteOn( pitch, 0.8 );

} );

window.addEventListener( 'keyup', event => {

	const k = event.key.toLowerCase();
	const pedalKeys = { ' ': 'sustain', q: 'soft', r: 'sostenuto' };
	if ( pedalKeys[ k ] ) {

		pedal( pedalKeys[ k ], 'key', false );
		return;

	}

	for ( const entry of [ ...keysDown ] ) {

		const [ key, pitch ] = entry.split( ':' );
		if ( key === k ) {

			noteOff( Number( pitch ) );
			keysDown.delete( entry );

		}

	}

} );

navigator.requestMIDIAccess?.().then( access => {

	const bind = input => input.onmidimessage = ( { data: [ status, a, b ] } ) => {

		const cmd = status & 0xf0;
		if ( cmd === 0x90 && b > 0 ) noteOn( a, b / 127 );
		else if ( cmd === 0x80 || ( cmd === 0x90 && b === 0 ) ) noteOff( a );
		else if ( cmd === 0xb0 && a === 64 ) pedal( 'sustain', 'midi', b >= 64 );
		else if ( cmd === 0xb0 && a === 66 ) pedal( 'sostenuto', 'midi', b >= 64 );
		else if ( cmd === 0xb0 && a === 67 ) pedal( 'soft', 'midi', b >= 64 );

	};
	access.inputs.forEach( bind );
	access.onstatechange = e => e.port.type === 'input' && e.port.state === 'connected' && bind( e.port );

} ).catch( () => {} );

// ---------------------------------------------------------------------------
// GUI

const gui = new GUI( { title: 'Pianist' } );
gui.add( settings, 'style', Object.fromEntries( STYLES.map( s => [ s.name, s.id ] ) ) ).name( 'Piano' ).onChange( setStyle );
gui.add( settings, 'gi' ).name( 'Global illumination' ).onChange( () => applyQuality() );
gui.add( settings, 'mode', { 'Real-time (probe GI + GTAO)': 'realtime', 'Path traced': 'pathtrace' } ).name( 'Renderer' ).onChange( setMode );

const fLight = gui.addFolder( 'Lighting' );
fLight.add( settings, 'preset', Object.keys( LIGHT_PRESETS ) ).name( 'Preset' ).onChange( name => {

	Object.assign( room.light, LIGHT_PRESETS[ name ] );
	fLight.controllersRecursive().forEach( c => c.updateDisplay() );
	refreshLighting();

} );
const relight = () => refreshLighting();
fLight.add( room.light, 'sunAzimuth', 0, 180, 1 ).name( 'Sun azimuth' ).onFinishChange( relight );
fLight.add( room.light, 'sunElevation', 2, 70, 0.5 ).name( 'Sun elevation' ).onFinishChange( relight );
fLight.add( room.light, 'sunIntensity', 0, 20, 0.1 ).name( 'Sun intensity' ).onFinishChange( relight );
fLight.addColor( room.light, 'sunColor' ).name( 'Sun color' ).onFinishChange( relight );
fLight.add( room.light, 'sunSoftness', 0, 1, 0.01 ).name( 'Sun softness' ).onFinishChange( relight );
fLight.add( room.light, 'sky', 0, 4, 0.01 ).name( 'Sky' ).onFinishChange( relight );
fLight.addColor( room.light, 'skyColor' ).name( 'Sky color' ).onFinishChange( relight );
fLight.add( room.light, 'lamp', 0, 200, 1 ).name( 'Lamp' ).onFinishChange( relight );

const fRoom = gui.addFolder( 'Room' ).close();
const rebuildRoom = () => {

	room.rebuild();
	refreshLighting();

};
fRoom.add( room.params, 'width', 3.5, 10, 0.1 ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'depth', 3.5, 10, 0.1 ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'height', 2.4, 5, 0.05 ).onFinishChange( rebuildRoom );
fRoom.addColor( room.params, 'wallColor' ).name( 'Wall color' ).onFinishChange( rebuildRoom );
fRoom.addColor( room.params, 'floorColor' ).name( 'Floor color' ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'windowWall', [ 'right', 'left', 'front' ] ).name( 'Window wall' ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'windowOffset', - 3, 3, 0.05 ).name( 'Window offset' ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'windowWidth', 0.5, 3, 0.05 ).name( 'Window width' ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'windowHeight', 0.5, 3, 0.05 ).name( 'Window height' ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'windowSill', 0, 2, 0.05 ).name( 'Window sill' ).onFinishChange( rebuildRoom );
fRoom.add( room.params, 'foliage' ).name( 'Foliage shadow' ).onChange( relight );

const fRender = gui.addFolder( 'Rendering' ).close();
fRender.add( settings, 'exposure', 0.1, 4, 0.01 ).name( 'Exposure' ).onChange( () => renderer.toneMappingExposure = settings.exposure * room.light.exposure );
fRender.add( settings, 'toneMapping', Object.keys( TONE ) ).name( 'Tone mapping' ).onChange( v => {

	renderer.toneMapping = TONE[ v ];
	outputPass.needsUpdate = true;

} );
fRender.add( settings, 'giBounces', 1, 4, 1 ).name( 'Probe GI bounces' ).onFinishChange( relight );
fRender.add( settings, 'ao' ).name( 'GTAO' ).onChange( applyAO );
fRender.add( settings, 'aoRadius', 0.02, 1, 0.01 ).name( 'AO radius' ).onChange( applyAO );
fRender.add( settings, 'bloom', 0, 1, 0.01 ).name( 'Bloom' ).onChange( v => {

	bloomPass.strength = v;
	bloomPass.enabled = settings.gi && v > 0;

} );
fRender.add( settings, 'ptBounces', 2, 16, 1 ).name( 'PT bounces' ).onChange( v => {

	pathTracer.pt.bounces = v;
	pathTracer.pt.reset();

} );

const fGrand = gui.addFolder( 'Grand' ).close();
fGrand.add( settings, 'lidAngle', 0, 45, 1 ).name( 'Lid angle' ).onFinishChange( () => piano.style.type === 'grand' && setStyle( settings.style ) );

gui.add( settings, 'volume', 0, 1, 0.01 ).name( 'Volume' ).onChange( v => synth.setVolume( v ) );

// ---------------------------------------------------------------------------
// MIDI file player: open / drop a .mid file; playback animates keys, hammers, dampers and pedals

const midiPlayer = new MidiFilePlayer( synth, {
	noteOn: ( pitch, velocity, opts ) => noteOn( pitch, velocity, opts ),
	noteOff: ( pitch, opts ) => noteOff( pitch, opts ),
	pedal: ( name, on ) => pedal( name, 'midi-file', on ),
	onEnd: () => midiUI.updateDisplay(),
} );

const midiState = {
	file: '(none)',
	position: 0,
	tempo: 1,
	open: () => fileInput.click(),
	toggle: () => midiPlayer.playing ? midiPlayer.pause() : playMidi(),
	stop: () => midiPlayer.stop(),
};

async function playMidi() {

	await synth.resume();
	midiPlayer.play();

}

async function loadMidiFile( file ) {

	if ( ! file ) return;
	try {

		const { duration, notes } = midiPlayer.load( await file.arrayBuffer(), file.name );
		midiState.file = file.name;
		midiState.position = 0;
		positionCtrl.max( Math.max( 1, duration / 1000 ) );
		console.log( `MIDI: ${ file.name }, ${ notes } notes, ${ ( duration / 1000 ).toFixed( 1 ) } s` );
		await playMidi();

	} catch ( err ) {

		midiState.file = `error: ${ err.message }`;
		console.warn( 'MIDI load failed:', err );

	}

	fMidi.controllersRecursive().forEach( c => c.updateDisplay() );

}

const fileInput = Object.assign( document.createElement( 'input' ), { type: 'file', accept: '.mid,.midi,audio/midi' } );
fileInput.style.display = 'none';
document.body.appendChild( fileInput );
fileInput.addEventListener( 'change', () => {

	loadMidiFile( fileInput.files[ 0 ] );
	fileInput.value = '';

} );

const fMidi = gui.addFolder( 'MIDI player' );
fMidi.add( midiState, 'open' ).name( 'Open MIDI file…' );
fMidi.add( midiState, 'file' ).name( 'File' ).disable();
const midiUI = fMidi.add( midiState, 'toggle' ).name( 'Play / pause' );
fMidi.add( midiState, 'stop' ).name( 'Stop' );
let seeking = false;
const positionCtrl = fMidi.add( midiState, 'position', 0, 1, 0.1 ).name( 'Position (s)' )
	.onChange( () => seeking = true )
	.onFinishChange( v => {

		seeking = false;
		midiPlayer.seek( v * 1000 );

	} );
fMidi.add( midiState, 'tempo', 0.25, 2, 0.05 ).name( 'Tempo' ).onChange( v => midiPlayer.setRate( v ) );

function updateMidiUI() {

	if ( seeking || ! midiPlayer.duration ) return;
	const t = Math.round( Math.min( midiPlayer.position, midiPlayer.duration ) / 100 ) / 10;
	if ( t !== midiState.position ) {

		midiState.position = t;
		positionCtrl.updateDisplay();

	}

}

// drop a MIDI file anywhere on the page
const dropOverlay = document.getElementById( 'drop' );
let dragDepth = 0;
const hasFiles = e => [ ...( e.dataTransfer?.types ?? [] ) ].includes( 'Files' );
window.addEventListener( 'dragenter', e => {

	if ( ! hasFiles( e ) ) return;
	e.preventDefault();
	if ( ++ dragDepth === 1 ) dropOverlay.classList.add( 'show' );

} );
window.addEventListener( 'dragover', e => hasFiles( e ) && e.preventDefault() );
window.addEventListener( 'dragleave', e => {

	if ( ! hasFiles( e ) ) return;
	if ( -- dragDepth <= 0 ) {

		dragDepth = 0;
		dropOverlay.classList.remove( 'show' );

	}

} );
window.addEventListener( 'drop', e => {

	if ( ! hasFiles( e ) ) return;
	e.preventDefault();
	dragDepth = 0;
	dropOverlay.classList.remove( 'show' );
	const file = [ ...e.dataTransfer.files ].find( f => /\.midi?$/i.test( f.name ) || /midi/.test( f.type ) );
	if ( file ) loadMidiFile( file );

} );

// start fetching the soundfont piano right away (audio starts on the first gesture)
synth.load();

// ---------------------------------------------------------------------------
// loop

const hud = document.getElementById( 'hud' );

function pianoStatus() {

	const st = soundfontStatus;
	switch ( st.phase ) {

		case 'download': return st.total ? `piano sound ${ Math.floor( 100 * st.received / st.total ) }%` : 'piano sound loading…';
		case 'decode': return 'piano sound decoding…';
		case 'ready': return 'piano ready';
		case 'failed': return 'piano sound failed, using synth';
		default: return 'piano sound loading…';

	}

}
const timer = new THREE.Timer();
let cameraMoving = false;
let fps = 60;
let keysMoving = false;

controls.addEventListener( 'change', () => {

	cameraMoving = true;
	pathTracer.updateCamera();

} );

function resize() {

	const w = window.innerWidth, h = window.innerHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize( w, h );
	composer.setSize( w, h );
	ptDirty = true;

}

window.addEventListener( 'resize', resize );

function frame() {

	updateMidiUI();

	timer.update();
	const raw = timer.getDelta();
	const dt = Math.min( raw, 0.05 );
	if ( raw > 0 ) fps += ( 1 / raw - fps ) * 0.05;
	cameraMoving = false;
	controls.update();
	keysMoving = piano.keyboard.update( dt );
	if ( piano.action?.update( dt ) ) keysMoving = true;
	// re-render shadow maps only when something moved or the lighting changed
	if ( keysMoving || shadowsDirty ) {

		renderer.shadowMap.needsUpdate = true;
		// the keyboard's own sun shadow map (high quality only; same angular sun size as room.js)
		if ( settings.gi && room.mode !== 'pathtrace' ) keyShadow.update( scene, room.sun, 0.0045 * ( 0.4 + 1.6 * room.light.sunSoftness ) );
		shadowsDirty = false;

	}

	if ( settings.mode === 'pathtrace' ) {

		if ( keysMoving ) {

			// keys can't be refit into the BVH cheaply; show the raster view while they move
			if ( room.mode !== 'raster' ) setLightingMode( 'raster' );
			composer.render();
			ptDirty = true;

		} else {

			if ( room.mode !== 'pathtrace' ) setLightingMode( 'pathtrace' );
			if ( ptDirty ) {

				pathTracer.setScene( scene, camera );
				ptDirty = false;

			}

			pathTracer.render();

		}

		hud.textContent = `Path tracing · ${ Math.floor( pathTracer.samples ) } spp · ${ pianoStatus() } · drag to orbit · keys A–' play · Z/X octave · pedals Q/R/Space`;

	} else {

		composer.render();
		hud.textContent = `Real-time${ settings.gi ? ' · GI' : '' } · ${ Math.round( fps ) } fps · ${ pianoStatus() } · drag to orbit · click keys or A–' to play · Z/X octave · pedals: click, or Q soft / R sostenuto / Space sustain`;

	}

	requestAnimationFrame( frame );

}

// ---------------------------------------------------------------------------
// boot

applyQuality( false );
setStyle( settings.style );
setMode( settings.mode );
document.getElementById( 'loading' ).classList.add( 'hidden' );
window.__pianist = { scene, camera, renderer, room, settings, setStyle, setMode, pathTracer, controls, noteOn, noteOff, pedal, composer, synth, midiPlayer, get piano() { return piano; } };
requestAnimationFrame( frame );

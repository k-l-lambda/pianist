import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { TextureBaker } from './textures.js';
import { makeMaterials, STYLES } from './materials.js';
import { buildUpright } from './upright.js';
import { buildGrand } from './grand.js';
import { Room, LIGHT_PRESETS } from './room.js';
import { GIProbe } from './gi.js';
import { PathTracer } from './pathtracer.js';
import { Synth } from './synth.js';
import { PITCH_MIN, PITCH_MAX } from './keyboard.js';

const params = new URLSearchParams( location.search );

const settings = {
	style: params.get( 'style' ) ?? 'upright-oak',
	mode: params.get( 'mode' ) ?? 'realtime',		// 'realtime' | 'pathtrace'
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

	gtaoPass.enabled = settings.ao;
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
	piano = style.type === 'grand' ? buildGrand( M, { lidAngle: settings.lidAngle } ) : buildUpright( M );
	piano.style = style;
	// back of the piano against the back wall
	piano.group.position.set( 0, 0, room.backWallZ + piano.depth + 0.03 );
	scene.add( piano.group );
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
let probeEnv = null;

// raster: prefiltered room probe; path tracer: the sky itself (light enters through the window)
function setLightingMode( mode ) {

	room.setMode( mode );
	scene.environment = mode === 'pathtrace' ? room.sky : probeEnv;
	scene.environmentIntensity = mode === 'pathtrace' ? 1 : probe.intensity;

}

function refreshLighting() {

	room.updateLights();
	renderer.toneMappingExposure = settings.exposure * room.light.exposure;
	renderer.toneMapping = TONE[ settings.toneMapping ];
	probe.bounces = settings.giBounces;
	renderer.shadowMap.needsUpdate = true;
	probeEnv = probe.update( piano ? [ piano.group ] : [] );
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

function noteOn( pitch, velocity = 0.8 ) {

	if ( pitch < PITCH_MIN || pitch > PITCH_MAX ) return;
	piano.keyboard.press( pitch, velocity );
	piano.action?.press( pitch, velocity );
	synth.noteOn( pitch, velocity );

}

function noteOff( pitch ) {

	piano.keyboard.release( pitch );
	piano.action?.release( pitch );
	synth.noteOff( pitch );

}

// sustain pedal: lifts every damper; on release, notes whose keys are up are damped
function setSustain( on ) {

	synth.sustain = on;
	piano.action?.setSustain( on );
	if ( ! on ) for ( const p of [ ...synth.voices.keys() ] ) if ( ! piano.keyboard.keys.get( p )?.target ) synth.noteOff( p );

}

function pickKey( event ) {

	const rect = renderer.domElement.getBoundingClientRect();
	pointer.set( ( event.clientX - rect.left ) / rect.width * 2 - 1, - ( event.clientY - rect.top ) / rect.height * 2 + 1 );
	raycaster.setFromCamera( pointer, camera );
	const hit = raycaster.intersectObjects( piano.keyboard.pickables, false )[ 0 ];
	return hit ? hit.object.userData.pitch : null;

}

renderer.domElement.addEventListener( 'pointerdown', event => {

	const pitch = pickKey( event );
	if ( pitch === null ) return;
	controls.enabled = false;
	pointerPitch = pitch;
	noteOn( pitch, 0.8 );

}, { capture: true } );

renderer.domElement.addEventListener( 'pointermove', event => {

	if ( pointerPitch === null ) return;
	const pitch = pickKey( event );
	if ( pitch !== null && pitch !== pointerPitch ) {

		noteOff( pointerPitch );
		pointerPitch = pitch;
		noteOn( pitch, 0.7 );

	}

} );

window.addEventListener( 'pointerup', () => {

	if ( pointerPitch !== null ) noteOff( pointerPitch );
	pointerPitch = null;
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
	if ( k === ' ' ) { setSustain( true ); event.preventDefault(); return; }
	const i = KEYMAP.indexOf( k );
	if ( i < 0 ) return;
	const pitch = 60 + i + 12 * octaveShift;
	keysDown.add( k + ':' + pitch );
	noteOn( pitch, 0.8 );

} );

window.addEventListener( 'keyup', event => {

	const k = event.key.toLowerCase();
	if ( k === ' ' ) {

		setSustain( false );
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
		else if ( cmd === 0xb0 && a === 64 ) setSustain( b >= 64 );

	};
	access.inputs.forEach( bind );
	access.onstatechange = e => e.port.type === 'input' && e.port.state === 'connected' && bind( e.port );

} ).catch( () => {} );

// ---------------------------------------------------------------------------
// GUI

const gui = new GUI( { title: 'Pianist' } );
gui.add( settings, 'style', Object.fromEntries( STYLES.map( s => [ s.name, s.id ] ) ) ).name( 'Piano' ).onChange( setStyle );
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
fRender.add( settings, 'bloom', 0, 1, 0.01 ).name( 'Bloom' ).onChange( v => bloomPass.strength = v );
fRender.add( settings, 'ptBounces', 2, 16, 1 ).name( 'PT bounces' ).onChange( v => {

	pathTracer.pt.bounces = v;
	pathTracer.pt.reset();

} );

const fGrand = gui.addFolder( 'Grand' ).close();
fGrand.add( settings, 'lidAngle', 0, 45, 1 ).name( 'Lid angle' ).onFinishChange( () => piano.style.type === 'grand' && setStyle( settings.style ) );

gui.add( settings, 'volume', 0, 1, 0.01 ).name( 'Volume' ).onChange( v => synth.setVolume( v ) );

// ---------------------------------------------------------------------------
// loop

const hud = document.getElementById( 'hud' );
const timer = new THREE.Timer();
let cameraMoving = false;
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

	timer.update();
	const dt = Math.min( timer.getDelta(), 0.05 );
	cameraMoving = false;
	controls.update();
	keysMoving = piano.keyboard.update( dt );
	if ( piano.action?.update( dt ) ) keysMoving = true;

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

		hud.textContent = `Path tracing · ${ Math.floor( pathTracer.samples ) } spp · drag to orbit · keys A–' play · Z/X octave`;

	} else {

		composer.render();
		hud.textContent = `Real-time · drag to orbit · click keys or A–' to play · Z/X octave · Space sustain`;

	}

	requestAnimationFrame( frame );

}

// ---------------------------------------------------------------------------
// boot

resize();
applyAO();
setStyle( settings.style );
setMode( settings.mode );
document.getElementById( 'loading' ).classList.add( 'hidden' );
window.__pianist = { scene, camera, renderer, room, settings, setStyle, setMode, pathTracer, controls, noteOn, noteOff, get piano() { return piano; } };
requestAnimationFrame( frame );

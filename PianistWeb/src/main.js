import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import GUI from 'lil-gui';

import { TextureBaker } from './textures.js';
import { makeMaterials, STYLES, applyGlass } from './materials.js';
import { buildUpright } from './upright.js';
import { buildGrand } from './grand.js';
import { Room } from './room.js';
import { ConcertHall } from './hall.js';
import { Luminara, prefetchLuminara } from './luminara.js';
import { berlinProgress, berlinStatus, berlinStatusText, prefetchBerlinHall } from './berlinhall.js';
import { GIProbe } from './gi.js';
import { PathTracer } from './pathtracer.js';
import { KeyShadow } from './keyshadow.js';
import { HandheldMode } from './handheldmode.js';
import { Synth } from './synth.js';
import { prefetchSoundfont, soundfontStatus } from './soundfont.js';
import { MidiFilePlayer } from './midi.js';
import { ScriptPlayer } from './script.js';
import { PianoRoll, excludeFromGTAO } from './pianoroll.js';
import { PITCH_MIN, PITCH_MAX } from './keyboard.js';
import { RENDER, RENDER_OPTS, clock } from './rendermode.js';
import { AudioLog, renderAudio, roomAPI } from './renderaudio.js';

// start downloading the piano sound right away, in parallel with building the scene
prefetchSoundfont();

// let the loading screen paint before the (blocking) scene build starts
await new Promise( r => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

// scene parameters from the URL: the query (?gi&style=grand-black) and/or the hash, which wins:
//   #?gi&grand-black&pathtrace&handheld&screen&script=path/to/scene.yaml
// Bare words in the hash: a piano style id, `realtime` / `pathtrace`, or a flag (gi, handheld,
// screen, loading, capture). key=value: style, mode, gi=0|1, exposure, tone=AgX|ACES|Neutral,
// shadow=vsm, preset, shake, hall=procedural, venue=room|hall|luminara (a grand's, over its style's), script (a name in public/scripts/, a path from the
// site root, or a URL), at (start the script that far in: 95, 1:35, 1:35.5; the part before runs
// silently at once). Changing the hash reloads the scene with the new parameters.
const params = new URLSearchParams( location.search );
for ( const [ key, value ] of new URLSearchParams( location.hash.replace( /^#\??/, '' ) ) ) {

	if ( value === '' && STYLES.some( s => s.id === key ) ) params.set( 'style', key );
	else if ( value === '' && ( key === 'realtime' || key === 'pathtrace' ) ) params.set( 'mode', key );
	else params.set( key, value );

}

window.addEventListener( 'hashchange', () => location.reload() );

const settings = {
	style: params.get( 'style' ) ?? 'upright-oak',
	mode: params.get( 'mode' ) ?? 'realtime',		// 'realtime' | 'pathtrace'
	// global illumination / high quality: off favours frame rate (see applyQuality)
	gi: params.has( 'gi' ) ? params.get( 'gi' ) !== '0' : RENDER,		// offline render (rendermode.js): on
	exposure: Number( params.get( 'exposure' ) ?? 1.7 ),
	toneMapping: params.get( 'tone' ) ?? 'AgX',		// AgX | ACES | Neutral (else the venue preset's)
	ao: true,
	aoRadius: 0.25,
	bloom: 0.12,
	giBounces: 2,
	ptBounces: 8,
	lidAngle: 34,
	volume: 0.5,
};

// the venue of a style: the uprights in the room, each grand in its own (the black in the
// concert hall, the white in Luminara; ?venue= for another)
const venueOf = style => style.type === 'grand' ? params.get( 'venue' ) ?? style.venue ?? 'hall' : 'room';
// fetch its packs now, while the scene builds
{

	const style = STYLES.find( s => s.id === settings.style );
	if ( style && venueOf( style ) === 'hall' && params.get( 'hall' ) !== 'procedural' && ! RENDER ) prefetchBerlinHall();
	if ( style && venueOf( style ) === 'luminara' ) prefetchLuminara();

}

// ---------------------------------------------------------------------------
// renderer

const renderer = new THREE.WebGLRenderer( { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has( 'capture' ) || RENDER } );
renderer.setPixelRatio( RENDER ? RENDER_OPTS.pixelRatio : Math.min( window.devicePixelRatio, 2 ) );
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
// venues, by the piano's type: uprights in the room, grands in the concert hall
const room = new Room( scene, baker );
const hall = new ConcertHall( scene, baker );
const luminara = new Luminara( scene, baker );
const venues = { room, hall, luminara };
let venue = room;
room.activate();
const probe = new GIProbe( renderer, scene );
const keyShadow = new KeyShadow( renderer );
// offline render: false while frames only advance the timeline (render-audio.mjs, the skip to
// --from): state is updated (script, MIDI, recordings, camera, person, keys, roll), nothing drawn
let drawFrames = true;

const MIRROR_GAIN = 2.5;
const MIRROR_SIZE = 1024;		// mirror cube face (px): at 256 the reflection shows the texels as steps
// Offline render: the screen mirror is read at least this rough (from the blurred PMREM levels),
// so the person shows as a soft ghost rather than a sharp, pixel-stepped outline. Environment
// lookups only (the sun's highlight keeps the lacquer's own roughness). 0.11: fainter; from about
// 0.17 the person is gone
const MIRROR_BLUR = 0.08;
function blurMirror( mat ) {

	if ( mat.userData.mirrorBlur ) return;
	mat.userData.mirrorBlur = true;
	mat.onBeforeCompile = shader => {

		const chunk = THREE.ShaderChunk.lights_fragment_maps
			.replace( 'getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )', `getIBLRadiance( geometryViewDir, geometryNormal, max( material.roughness, ${ MIRROR_BLUR.toFixed( 3 ) } ) )` )
			.replace( 'material.clearcoatRoughness )', `max( material.clearcoatRoughness, ${ MIRROR_BLUR.toFixed( 3 ) } ) )` );
		shader.fragmentShader = shader.fragmentShader.replace( '#include <lights_fragment_maps>', chunk );

	};
	mat.customProgramCacheKey = () => 'mirrorBlur';
	mat.needsUpdate = true;

}
// the piano's centre (what the phone focuses on), measured once per piano
const _subject = new THREE.Vector3(), _subjectBox = new THREE.Box3();
let _subjectOf = null;
function pianoCentre() {

	if ( ! piano ) return null;
	if ( _subjectOf !== piano.group ) {

		_subjectBox.setFromObject( piano.group ).getCenter( _subject );
		_subjectOf = piano.group;

	}

	return _subject;

}

const screenPlane = new THREE.Plane(), _n = new THREE.Vector3(), _x = new THREE.Vector3( 1, 0, 0 );
// handheld camera mode (handheldmode.js): shake, walking, height cap, FOV zoom, person in reflections
const handheld = new HandheldMode( {
	camera, controls, scene, renderer,
	isPathTracing: () => settings.mode === 'pathtrace',
	specularCapture: ( eye, ahead ) => {

		if ( ! drawFrames ) return;		// offline render, not drawing: no mirror to capture
		const opts = { lights: venue.specularOff, objects: venue.probeHidden };
		const panel = piano?.roll?.screen && piano.materials?.panel;
		if ( panel ) {

			// a flat screen: exact planar reflection of the person, on the screen only. Lit by the
			// sun as well (sunlit walls and floor belong in a mirror), and brighter than the black
			// panel's 4-8 % reflectance: under AgX that would sink into the shadow toe (a wall at
			// 92/255 came out at 4/255), and the room should read in the screen, the person dark
			// against it
			const R = piano.roll;
			piano.group.updateMatrixWorld();
			screenPlane.setFromNormalAndCoplanarPoint( _n.crossVectors( _x, R.up ).normalize(), R.origin ).applyMatrix4( piano.group.matrixWorld );
			panel.envMap = probe.updateMirror( eye, screenPlane, [ piano.group ], { objects: opts.objects, size: MIRROR_SIZE } );
			panel.envMapIntensity = MIRROR_GAIN;
			if ( RENDER ) blurMirror( panel );

		} else probe.updateSpecular( ahead, piano ? [ piano.group ] : [], opts );

	},
	specularRestore: () => {

		if ( piano?.materials?.panel ) piano.materials.panel.envMapIntensity = 1;
		applySpecularEnv();

	},
	subject: () => pianoCentre(),
	defocus: ( duration, amount ) => startDefocus( duration, amount ),
	bounds: () => venue.bounds(),
} );
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
const audioLog = RENDER ? new AudioLog() : null;		// offline render: the sound track's events

// ---------------------------------------------------------------------------
// post-processing

const composerTarget = new THREE.WebGLRenderTarget( 1, 1, { type: THREE.HalfFloatType, samples: 4 } );
const composer = new EffectComposer( renderer, composerTarget );
const renderPass = new RenderPass( scene, camera );
const gtaoPass = new GTAOPass( scene, camera, 1, 1 );
excludeFromGTAO( gtaoPass );		// the additive MIDI roll must not occlude
gtaoPass.output = GTAOPass.OUTPUT.Default;
const bloomPass = new UnrealBloomPass( new THREE.Vector2( 1, 1 ), settings.bloom, 0.6, 0.92 );
const outputPass = new OutputPass();
composer.addPass( renderPass );
composer.addPass( gtaoPass );
// HDR sanitising before bloom and depth of field: the sun's glare in the glossy screen reaches
// ~7000 in the half-float buffer; summed in the bloom's blur that overflowed (Inf, then NaN) and
// the bloom's mips spread it into large black rectangles (offline render, 琴伤 ~72 s). Non-finite
// values to 0, the rest capped at 4096: the glare keeps its halo (256 visibly shrank it), and the
// bloom's sum of five mips stays under half float's 65504
// (and the venue preset's saturation, in linear light before the tone mapping: ACES warms and
// saturates the Berlin hall's gilt and ivory beyond its renders)
const hdrClamp = new ShaderPass( {
	uniforms: { tDiffuse: { value: null }, uMax: { value: 4096 }, uSaturation: { value: 1 } },
	vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
	fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax; uniform float uSaturation; varying vec2 vUv;
		void main() {
			vec4 c = texture2D( tDiffuse, vUv );
			c = mix( c, vec4( 0.0 ), vec4( notEqual( c, c ) ) );		// NaN
			vec3 rgb = clamp( c.rgb, 0.0, uMax );		// Inf, too bright
			rgb = max( mix( vec3( dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), rgb, uSaturation ), 0.0 );
			gl_FragColor = vec4( rgb, clamp( c.a, 0.0, 1.0 ) );
		}`,
} );
composer.addPass( hdrClamp );
composer.addPass( bloomPass );
// depth of field, only for a lens that loses focus for a moment (scripts: `defocus`); off otherwise
const bokehPass = new BokehPass( scene, camera, { focus: 1, aperture: 0.03, maxblur: 0 } );
bokehPass.enabled = false;
composer.addPass( bokehPass );
composer.addPass( outputPass );

// Focus hunting, like a phone camera's autofocus on a quick move: the focus pulled in front of
// the subject, nearly back, out again, then sharp. `amount` scales the blur (1: DOF_MAXBLUR, in
// screen units). Timed on `clock` (the render clock offline)
const DOF_MAXBLUR = 0.02;
const DOF_KEYS = [ [ 0, 0 ], [ 0.16, 1 ], [ 0.36, 0.35 ], [ 0.56, 0.75 ], [ 1, 0 ] ];		// [ u, blur ]
const defocus = { t0: - 1, duration: 1, amount: 1 };
function startDefocus( duration = 0.9, amount = 1 ) {

	Object.assign( defocus, { t0: clock.now() / 1000, duration: Math.max( 0.1, duration ), amount } );

}

function updateDefocus() {

	let k = 0;
	const u = defocus.t0 < 0 ? 1 : ( clock.now() / 1000 - defocus.t0 ) / defocus.duration;
	if ( u > 0 && u < 1 ) {

		let i = 1;
		while ( DOF_KEYS[ i ][ 0 ] < u ) ++ i;
		const [ u0, a ] = DOF_KEYS[ i - 1 ], [ u1, b ] = DOF_KEYS[ i ];
		k = a + ( b - a ) * THREE.MathUtils.smoothstep( u, u0, u1 );

	}

	k *= defocus.amount;
	bokehPass.enabled = k > 0.002;
	if ( ! bokehPass.enabled ) return;
	// the subject: the piano, along the view (not the orbit target: in handheld mode that sits
	// just in front of the phone)
	_dof.copy( pianoCentre() ?? controls.target );
	const d = THREE.MathUtils.clamp( _dof.sub( camera.position ).dot( camera.getWorldDirection( _dofDir ) ), 0.3, 5 );
	const U = bokehPass.uniforms;
	U.focus.value = d * ( 1 - 0.6 * Math.min( 1, k ) );
	U.maxblur.value = DOF_MAXBLUR * k;
	U.aspect.value = camera.aspect;

}

const _dof = new THREE.Vector3(), _dofDir = new THREE.Vector3();

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
	// its venue, and its place in it
	switchVenue( venues[ venueOf( style ) ] ?? hall );
	venue.place( piano );
	piano.materials = M;
	applyGlass( M.glass, settings.gi || settings.mode === 'pathtrace' );
	scene.add( piano.group );
	keyShadow.attach( piano, [ M.keyWhite, M.keyBlack ], settings.gi && ! keyShadow.broken );
	roll.attach( piano );
	scene.updateMatrixWorld( true );

	const off = piano.group.position;
	camera.position.copy( piano.camera.position ).add( off );
	controls.target.copy( piano.camera.target ).add( off );
	controls.update();

	probe.position.copy( venue.probePoint( piano ) );
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
	// offline render: the render scale, whatever the quality and the display
	renderer.setPixelRatio( RENDER ? RENDER_OPTS.pixelRatio : Math.min( window.devicePixelRatio, hq ? 2 : 1 ) );
	composer.setPixelRatio( renderer.getPixelRatio() );
	resize();
	applyAO();
	applyBloom();
	// full resolution: the strings and pins behind the glass must stay sharp
	renderer.transmissionResolutionScale = 1.0;
	room.setQuality( hq );
	hall.setQuality( hq );
	luminara.setQuality( hq );
	keyShadow.setEnabled( hq && ! keyShadow.broken );
	if ( piano ) applyGlass( piano.materials.glass, hq || venue.mode === 'pathtrace' );
	shadowsDirty = true;
	if ( relight ) refreshLighting();

}
let probeEnv = null;

// raster: prefiltered room probe; path tracer: the venue's environment (the room: the sky, light
// enters through the window; the hall: none)
function setLightingMode( mode ) {

	room.setMode( mode );
	hall.setMode( mode );
	luminara.setMode( mode );
	if ( piano ) applyGlass( piano.materials.glass, mode === 'pathtrace' || settings.gi );
	shadowsDirty = true;
	scene.environment = mode === 'pathtrace' ? venue.environment : probeEnv;
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

let toneChosen = params.has( 'tone' );		// tone mapping set by hand (?tone= or the GUI)
let bloomChosen = false;		// bloom strength set by hand (the GUI)
/** Bloom: in full quality at the GUI's strength, or wherever the venue's preset asks for it (the
 * Berlin hall's lit chandeliers: also in real time), at its strength and threshold. */
function applyBloom() {

	const own = ! bloomChosen && venue?.light.bloom !== undefined;
	bloomPass.strength = own ? venue.light.bloom : settings.bloom;
	bloomPass.threshold = venue?.light.bloomThreshold ?? 0.92;
	bloomPass.enabled = ( settings.gi || own ) && bloomPass.strength > 0;

}
function refreshLighting() {

	venue.updateLights();
	renderer.toneMappingExposure = settings.exposure * venue.light.exposure;
	renderer.toneMapping = TONE[ toneChosen ? settings.toneMapping : venue.light.tone ?? settings.toneMapping ];		// (a venue's preset may ask for one)
	hdrClamp.uniforms.uSaturation.value = venue.light.saturation ?? 1;
	applyBloom();
	probe.bounces = settings.gi ? settings.giBounces : 1;
	renderer.shadowMap.needsUpdate = true;
	shadowsDirty = true;
	probeEnv = probe.update( piano ? [ piano.group ] : [], { lights: venue.specularOff, objects: venue.probeHidden } );
	// the venue's ambient level (the hall's Spotlight: the dark round the light stays dark)
	probe.intensity = venue.light.env ?? 1;
	if ( settings.mode !== 'pathtrace' ) scene.environmentIntensity = probe.intensity;
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
// `live`: played by the user (mouse, computer keys, MIDI keyboard), not the MIDI file
function noteOn( pitch, velocity = 0.8, { sound = true, live = true } = {} ) {

	if ( live ) roll.liveOn( pitch, velocity );

	if ( pitch < PITCH_MIN || pitch > PITCH_MAX ) {

		if ( sound ) synth.noteOn( pitch, velocity );
		return;

	}

	piano.keyboard.press( pitch, velocity );
	piano.action?.press( pitch, velocity );
	if ( sound ) synth.noteOn( pitch, velocity );

}

function noteOff( pitch, { sound = true, live = true } = {} ) {

	if ( live ) roll.liveOff( pitch );

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
	if ( event.key === '`' ) { setScreenPower( ! roll.power ); return; }
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

// screen power: the piano roll (file notes falling, played notes rising in red) only shows
// while the screen is on. Toggled by the power icon (bottom left) or the ` key.
const powerButton = document.getElementById( 'power' );
// power-on chime (public/midi/open.mid) with the boot animation, which plays in the chime's length
// less BOOT_SHORTER (the roll fades in under the chime's tail): sound only, its own player, so no
// keys move and no roll shows
const BOOT_SHORTER = 1.7;		// s: 5.0 s chime -> 3.3 s artwork
const bootSound = new MidiFilePlayer( synth, {
	noteOn: ( pitch, velocity, { sound } ) => sound && synth.noteOn( pitch, velocity ),
	noteOff: ( pitch, { sound } ) => sound && synth.noteOff( pitch ),
	pedal: () => {},
} );
fetch( new URL( 'midi/open.mid', new URL( import.meta.env.BASE_URL, location.href ) ) )
	.then( r => r.ok ? r.arrayBuffer() : Promise.reject( new Error( r.status ) ) )
	.then( buffer => roll.bootLength = Math.max( 1, bootSound.load( buffer, 'open.mid' ).duration / 1000 - BOOT_SHORTER ) )
	.catch( err => console.warn( 'power-on sound unavailable:', err ) );

/** `instant`: on at once, without the boot animation and chime (a script started mid-way). */
function setScreenPower( on, { instant = false } = {} ) {

	if ( instant ) {

		bootSound.stop();
		roll.setPower( on );
		roll.bootT = - 1;
		roll.bootMesh.visible = false;
		roll.powerLevel = on ? 1 : 0;
		powerButton?.setAttribute( 'aria-pressed', String( on ) );
		return;

	}

	if ( on && ! roll.power ) {

		bootSound.stop();
		if ( RENDER ) bootSound.play(); else synth.resume().then( () => bootSound.play() );

	} else if ( ! on && roll.power ) bootSound.stop();
	roll.setPower( on );
	powerButton?.setAttribute( 'aria-pressed', String( on ) );

}

powerButton?.addEventListener( 'click', () => {

	setScreenPower( ! roll.power );
	powerButton.blur();		// keep Space etc. for the piano

} );

const gui = new GUI( { title: 'Pianist' } );

// Watermark: bottom right, its right and bottom edges `right` / `bottom` px in from the view's
// (and left of the Pianist panel while that reaches down to it). On the page an <img> over the
// canvas; offline renders draw it into each frame (startRender: frame()), where the render can
// set its own (render-video.mjs --watermark "opacity=0.12,x=0.75,bottom=64" | off)
const WATERMARK = { src: 'klstudio.png', opacity: 0.06, right: 60, bottom: 60, height: 96 };
function parseWatermark( spec ) {

	const out = {};
	for ( const kv of ( spec ?? '' ).split( ',' ) ) {

		const [ k, v ] = kv.split( '=' ).map( x => x?.trim() );
		if ( k && v !== undefined && [ 'opacity', 'right', 'bottom', 'height', 'x' ].includes( k ) && Number.isFinite( Number( v ) ) ) out[ k ] = Number( v );

	}

	return out;

}

if ( ! RENDER ) {

	const img = Object.assign( document.createElement( 'img' ), { src: new URL( WATERMARK.src, new URL( import.meta.env.BASE_URL, location.href ) ).href, alt: '', draggable: false } );
	img.setAttribute( 'aria-hidden', 'true' );
	Object.assign( img.style, { position: 'fixed', bottom: `${ WATERMARK.bottom }px`, height: `${ WATERMARK.height }px`, width: 'auto', opacity: String( WATERMARK.opacity ), pointerEvents: 'none', userSelect: 'none', zIndex: '5' } );
	document.body.appendChild( img );
	// keep clear of the panel (top right) when it is tall enough to reach the mark
	const place = () => {

		const r = gui.domElement.getBoundingClientRect();
		const top = innerHeight - WATERMARK.bottom - WATERMARK.height;
		const blocked = r.width > 0 && r.bottom > top - 8;
		img.style.right = `${ WATERMARK.right + ( blocked ? innerWidth - r.left : 0 ) }px`;

	};
	place();
	new ResizeObserver( place ).observe( gui.domElement );
	addEventListener( 'resize', place );

}
gui.add( settings, 'style', Object.fromEntries( STYLES.map( s => [ s.name, s.id ] ) ) ).name( 'Piano' ).onChange( setStyle );
gui.add( settings, 'gi' ).name( 'Global illumination' ).onChange( () => applyQuality() );
const fHand = gui.addFolder( 'Handheld camera' );
// Ctrl held while switching it off: the person stays in the scene, to be inspected
let ctrlHeld = false;
for ( const type of [ 'keydown', 'keyup', 'pointerdown' ] ) addEventListener( type, e => ctrlHeld = e.ctrlKey, true );
addEventListener( 'blur', () => ctrlHeld = false );
fHand.add( { on: false }, 'on' ).name( 'Handheld' ).onChange( v => handheld.setEnabled( v, { keepPerson: ctrlHeld } ) );
fHand.add( handheld, 'intensity', 0, 3, 0.05 ).name( 'Shake' );
fHand.add( handheld, 'walk', 0, 2, 0.05 ).name( 'Walking motion' );
fHand.add( handheld, 'drift', 0, 2, 0.05 ).name( 'Operator drift' );
fHand.add( handheld, 'bursts' ).name( 'Operator bursts' );
fHand.add( handheld, 'focusHunt', 0, 2, 0.05 ).name( 'Focus hunting' );
fHand.add( handheld, 'showPerson' ).name( 'Person (reflections)' ).onChange( v => handheld.setShowPerson( v ) );
gui.add( settings, 'mode', { 'Real-time (probe GI + GTAO)': 'realtime', 'Path traced': 'pathtrace' } ).name( 'Renderer' ).onChange( setMode );

// lighting: the venue's own presets and controls (rebuilt when the venue changes)
const fLight = gui.addFolder( 'Lighting' );
const relight = () => refreshLighting();
function buildLightFolder() {

	for ( const c of [ ...fLight.controllers ] ) c.destroy();
	fLight.add( venue, 'preset', Object.keys( venue.presets ) ).name( 'Preset' ).onChange( name => {

		Object.assign( venue.light, { tone: undefined, saturation: undefined, bloom: undefined, bloomThreshold: undefined }, venue.presets[ name ] );
		fLight.controllersRecursive().forEach( c => c.updateDisplay() );
		refreshLighting();

	} );
	for ( const [ key, a, b, c, d ] of venue.lightControls() ) {

		if ( a === 'color' ) fLight.addColor( venue.light, key ).name( b ).onFinishChange( relight );
		else fLight.add( venue.light, key, a, b, c ).name( d ).onFinishChange( relight );

	}

}

buildLightFolder();

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

// the hall's viewpoints
const fHall = gui.addFolder( 'Hall' ).close().hide();
const hallView = { view: 'At the piano' };
// the shell: procedural, or the Konzerthaus Berlin's Großer Saal (local packs: src/berlinhall.js)
// (the Berlin hall by default: loaded when the hall is first entered; ?hall=procedural for the other)
const setHallModel = name => hall.setModel( name );
// the Berlin hall's shaders compiled before it shows (with the lights it brings, into the composer's
// target: its programs are keyed on the target's colour space and tone mapping)
hall.precompile = async object => {

	const was = renderer.getRenderTarget();
	renderer.setRenderTarget( composerTarget );
	const ready = renderer.compileAsync( object, camera, scene );
	renderer.setRenderTarget( was );
	await ready;

};
hall.onModel = () => {		// the shell shown changed (or Berlin finished loading): its presets and lights

	if ( venue === hall ) buildLightFolder();
	if ( piano ) refreshLighting();
	shadowsDirty = true;
	ptDirty = true;

};
fHall.add( hall, 'model', { 'Konzerthaus Berlin': 'berlin', 'Procedural': 'procedural' } ).name( 'Model' ).onChange( setHallModel );
if ( params.get( 'hall' ) === 'procedural' ) hall.model = 'procedural';
fHall.add( hallView, 'view', [ 'At the piano', ...Object.keys( hall.views() ) ] ).name( 'View' ).onChange( name => {

	const off = piano.group.position;
	const v = name === 'At the piano' ? { position: piano.camera.position.clone().add( off ), target: piano.camera.target.clone().add( off ) } : hall.views()[ name ];
	camera.position.copy( v.position );
	controls.target.copy( v.target );
	controls.update();

} );

// Luminara's viewpoints; its pack (furniture, reliefs, sky, marble) shows when loaded: the probe again
const fLuminara = gui.addFolder( 'Luminara' ).close().hide();
const luminaraView = { view: 'At the piano' };
fLuminara.add( luminaraView, 'view', [ 'At the piano', ...Object.keys( luminara.views() ) ] ).name( 'View' ).onChange( name => {

	const off = piano.group.position;
	const v = name === 'At the piano' ? { position: piano.camera.position.clone().add( off ), target: piano.camera.target.clone().add( off ) } : luminara.views()[ name ];
	camera.position.copy( v.position );
	controls.target.copy( v.target );
	controls.update();

} );
luminara.onLoad = () => {

	if ( venue === luminara && piano ) refreshLighting();
	shadowsDirty = true;
	ptDirty = true;

};

/** The venue for the piano's type: its geometry and lights in the scene, its lighting controls. */
function switchVenue( v ) {

	if ( v === venue && v.active ) return;
	venue.deactivate();
	venue = v;
	venue.activate();
	controls.maxDistance = venue.view.maxDistance;
	controls.maxPolarAngle = venue.view.maxPolarAngle;
	buildLightFolder();
	fRoom.show( venue === room );
	fHall.show( venue === hall );
	fLuminara.show( venue === luminara );
	hallView.view = luminaraView.view = 'At the piano';
	fLuminara.controllersRecursive().forEach( c => c.updateDisplay() );
	fHall.controllersRecursive().forEach( c => c.updateDisplay() );
	ptDirty = true;
	shadowsDirty = true;

}

const fRender = gui.addFolder( 'Rendering' ).close();
fRender.add( settings, 'exposure', 0.1, 4, 0.01 ).name( 'Exposure' ).onChange( () => renderer.toneMappingExposure = settings.exposure * venue.light.exposure );
fRender.add( settings, 'toneMapping', Object.keys( TONE ) ).name( 'Tone mapping' ).onChange( v => {

	toneChosen = true;		// from now on the GUI's, over the venues' presets
	renderer.toneMapping = TONE[ v ];
	outputPass.needsUpdate = true;

} );
fRender.add( settings, 'giBounces', 1, 4, 1 ).name( 'Probe GI bounces' ).onFinishChange( relight );
fRender.add( settings, 'ao' ).name( 'GTAO' ).onChange( applyAO );
fRender.add( settings, 'aoRadius', 0.02, 1, 0.01 ).name( 'AO radius' ).onChange( applyAO );
fRender.add( settings, 'bloom', 0, 1, 0.01 ).name( 'Bloom' ).onChange( v => {

	bloomChosen = true;
	applyBloom();

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
	noteOn: ( pitch, velocity, opts ) => noteOn( pitch, velocity, { ...opts, live: false } ),
	noteOff: ( pitch, opts ) => noteOff( pitch, { ...opts, live: false } ),
	pedal: ( name, on ) => pedal( name, 'midi-file', on ),
	onEnd: () => midiUI.updateDisplay(),
} );

// falling-notes roll drawn while a MIDI file is loaded (raster only; hidden while path tracing)
const roll = new PianoRoll();

const midiState = {
	file: '(none)',
	position: 0,
	tempo: 1,
	open: () => fileInput.click(),
	toggle: () => midiPlayer.playing ? midiPlayer.pause() : playMidi(),
	stop: () => midiPlayer.stop(),
};

async function playMidi() {

	if ( ! RENDER ) await synth.resume();		// offline render: at once, on the render clock
	midiPlayer.play();

}

// load into the player and the GUI (also used by scene scripts)
function loadMidiBuffer( buffer, name ) {

	const { duration, notes } = midiPlayer.load( buffer, name );
	midiState.file = name;
	midiState.position = 0;
	positionCtrl.max( Math.max( 1, duration / 1000 ) );
	console.log( `MIDI: ${ name }, ${ notes } notes, ${ ( duration / 1000 ).toFixed( 1 ) } s` );
	fMidi.controllersRecursive().forEach( c => c.updateDisplay() );

}

async function loadMidiFile( file ) {

	if ( ! file ) return;
	try {

		roll.setMode( 'music' );
		roll.setSubtitle( '' );
		loadMidiBuffer( await file.arrayBuffer(), file.name );
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
fMidi.add( roll, 'enabled' ).name( 'Piano roll' );
fMidi.addColor( { color: '#' + roll.musicColor.getHexString() }, 'color' ).name( 'Roll colour' ).onChange( v => roll.setColor( v ) );
fMidi.add( roll, 'lookahead', 0.8, 6, 0.1 ).name( 'Look-ahead (s)' );
fMidi.add( roll, 'particles' ).name( 'Particles' );

// ---------------------------------------------------------------------------
// scene scripts (script.js): a YAML timeline of camera moves, screen power, MIDI and scene
// parameters. Pick the .yaml together with the MIDI files it names, drop them on the page, or
// load one shipped in public/scripts/ with ?script=name.yaml

const scriptPlayer = new ScriptPlayer( {
	camera, controls, gui, setScreenPower,
	setRollMode: mode => roll.setMode( mode ),
	setSubtitle: text => roll.setSubtitle( text ),
	setStatus: ( status, level ) => roll.setStatus( status, level ),
	defocus: ( duration, amount ) => startDefocus( duration, amount ),
	// notes played by hand in a script: like the keyboard (sound, keys, the red rising roll)
	noteOn: ( pitch, velocity ) => noteOn( pitch, velocity, { sound: true, live: true } ),
	noteOff: pitch => noteOff( pitch, { sound: true, live: true } ),
	// power-on: the boot animation and the chime; power-off: the fade
	screenBusy: () => roll.bootT >= 0 || bootSound.playing || ( roll.power ? roll.powerLevel < 1 : roll.powerLevel > 0 ),
	midi: {
		load: loadMidiBuffer,
		play: () => playMidi(),
		pause: () => midiPlayer.pause(),
		resume: () => playMidi(),
		stop: () => midiPlayer.stop(),
		fadeOut: fadeOutMidi,
		seek: ms => midiPlayer.seek( ms ),
		get playing() { return midiPlayer.playing; },
		get position() { return midiPlayer.position; },
	},
	// speech and other recordings, through the same output (volume slider, limiter) as the piano
	audio: {
		decode: data => synth.context().decodeAudioData( data ),
		play: ( buffer, { volume = 1, from = 0, name, position, facing } = {} ) => {

			// offline render: logged for the sound track, `playing` on the render clock (with the
			// voice's place and facing, for the room simulation)
			if ( RENDER ) return audioLog.clip( buffer, { volume, from, name, position, facing } );
			const ctx = synth.context();
			synth.resume();
			const src = ctx.createBufferSource(), gain = ctx.createGain();
			src.buffer = buffer;
			gain.gain.value = volume;
			src.connect( gain ).connect( synth.master );
			const h = { playing: true, stop: () => { try { src.stop(); } catch { /* not started */ } h.playing = false; } };
			src.onended = () => { h.playing = false; gain.disconnect(); };
			src.start( 0, Math.max( 0, from ) );
			return h;

		},
	},
} );

// fade the MIDI file out with channel volume (CC7, every file channel), then stop (or pause:
// the roll stays where it was). Volume goes back to 100 once the sound is off. The built-in
// synth (before the soundfont is in) stops at once.
function fadeOutMidi( seconds, { pause = false } = {} ) {

	const fluid = synth.fluidReady ? synth.fluid : null;
	const end = () => pause ? midiPlayer.pause() : midiPlayer.stop();
	if ( ! fluid || ! midiPlayer.playing || ! ( seconds > 0 ) ) {

		end();
		return Promise.resolve();

	}

	const channels = [ ...midiPlayer._channels ];
	const t0 = clock.now();
	return new Promise( done => {

		const step = () => {

			const u = Math.min( 1, ( clock.now() - t0 ) / ( seconds * 1000 ) );
			const v = Math.round( 100 * ( 1 - u ) ** 2 );		// eases out (perceived loudness)
			for ( const ch of channels ) fluid.synth.midiControl( ch, 7, v );
			if ( u < 1 && midiPlayer.playing ) return clock.setTimeout( step, 20 );
			end();
			for ( const ch of channels ) fluid.synth.midiControl( ch, 7, 100 );
			done();

		};
		step();

	} );

}
const scriptState = {
	file: '(none)',
	state: '',
	open: () => scriptInput.click(),
	toggle: async () => {

		if ( scriptPlayer.playing ) return scriptPlayer.stop();
		await synth.resume();
		scriptPlayer.play();

	},
};
scriptPlayer.onState = text => {

	scriptState.state = text;
	fScript.controllersRecursive().forEach( c => c.updateDisplay() );

};

async function loadScriptFile( file, others = [] ) {

	try {

		await scriptPlayer.load( await file.text(), { name: file.name, files: others.filter( f => f !== file ), midiURL: new URL( 'midi/', new URL( import.meta.env.BASE_URL, location.href ) ), audioURL: new URL( 'audio/', new URL( import.meta.env.BASE_URL, location.href ) ) } );
		scriptState.file = scriptPlayer.title;
		await synth.resume();
		scriptPlayer.play();

	} catch ( err ) {

		scriptState.file = file.name;
		scriptState.state = `error: ${ err.message }`;
		console.warn( 'script load failed:', err );

	}

	fScript.controllersRecursive().forEach( c => c.updateDisplay() );

}

const scriptInput = Object.assign( document.createElement( 'input' ), { type: 'file', multiple: true, accept: '.yaml,.yml,.mid,.midi,.opus,.ogg,.mp3,.m4a,.wav' } );
scriptInput.style.display = 'none';
document.body.appendChild( scriptInput );
scriptInput.addEventListener( 'change', () => {

	const files = [ ...scriptInput.files ];
	const yaml = files.find( f => /\.ya?ml$/i.test( f.name ) );
	if ( yaml ) loadScriptFile( yaml, files );
	scriptInput.value = '';

} );

const fScript = gui.addFolder( 'Script' );
fScript.add( scriptState, 'open' ).name( 'Open script… (+ MIDI)' );
fScript.add( scriptState, 'file' ).name( 'Script' ).disable();
fScript.add( scriptState, 'toggle' ).name( 'Play / stop' );
fScript.add( scriptState, 'state' ).name( 'State' ).disable();

// A script opened from the URL plays as soon as audio can start. Browsers allow that only after a
// click on the page (resume() then never settles), so after a moment a Play button asks for one.
/** "95", "1:35" or "1:35.5" -> s. */
function parseClock( text ) {

	const p = String( text ).split( ':' ).map( Number );
	const s = p.reduce( ( a, v ) => a * 60 + v, 0 );
	return Number.isFinite( s ) && s > 0 ? s : 0;

}

function startWhenAudible() {

	const ctx = synth.context();
	const overlay = document.getElementById( 'start' );
	// #?script=…&at=95 (or 1:35): start that far into the timeline
	const at = params.has( 'at' ) ? parseClock( params.get( 'at' ) ) : 0;
	const go = () => {

		overlay.classList.remove( 'show' );
		scriptPlayer.playFrom( at );

	};
	if ( ctx.state === 'running' ) return go();
	let started = false;
	ctx.resume().then( () => {

		if ( ! started ) {

			started = true;
			go();

		}

	} );
	setTimeout( () => {

		if ( started ) return;
		overlay.querySelector( 'span' ).textContent = scriptPlayer.title ? `Play · ${ scriptPlayer.title }` : 'Play';
		overlay.classList.add( 'show' );
		overlay.querySelector( 'button' ).onclick = () => {

			if ( started ) return;
			started = true;
			synth.resume();		// inside the click: allowed now
			go();

		};

	}, 300 );

}

if ( params.has( 'script' ) && ! RENDER ) {

	// a bare name is one of public/scripts/; a path is from the site root; or a full URL
	const name = params.get( 'script' ), base = new URL( import.meta.env.BASE_URL, location.href );
	const url = new URL( /[/:]/.test( name ) ? name.replace( /^\//, '' ) : 'scripts/' + name, base );
	fetch( url ).then( r => {

		if ( ! r.ok ) throw new Error( `${ url }: ${ r.status }` );
		return r.text();

	} ).then( async text => {

		await scriptPlayer.load( text, { name, baseURL: url, midiURL: new URL( 'midi/', base ), audioURL: new URL( 'audio/', base ) } );
		scriptState.file = scriptPlayer.title;
		fScript.controllersRecursive().forEach( c => c.updateDisplay() );
		startWhenAudible();

	} ).catch( err => {

		scriptState.state = `error: ${ err.message }`;
		console.warn( 'script load failed:', err );

	} ).finally( () => fScript.controllersRecursive().forEach( c => c.updateDisplay() ) );

}

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
	const files = [ ...e.dataTransfer.files ];
	const yaml = files.find( f => /\.ya?ml$/i.test( f.name ) );
	if ( yaml ) return loadScriptFile( yaml, files );
	const file = files.find( f => /\.midi?$/i.test( f.name ) || /midi/.test( f.type ) );
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

// the hall's loading bar (its packs: download, build, textures, shaders), over the loading screen
// or the scene; its own frames, so it moves while the loading screen hides the render loop's
const hallBar = document.getElementById( 'hallbar' ), hallBarFill = hallBar.querySelector( 'i' ), hallBarText = hallBar.querySelector( 'span' );
( function updateHallBar() {

	const on = [ 'download', 'build', 'upload', 'compile' ].includes( berlinStatus.phase ) || berlinStatus.phase === 'failed' && hall.model === 'berlin' && venue === hall;
	hallBar.classList.toggle( 'show', on );
	if ( on ) {

		const f = berlinProgress();
		hallBarFill.style.transform = `scaleX(${ f.toFixed( 4 ) })`;
		hallBar.setAttribute( 'aria-valuenow', String( Math.round( 100 * f ) ) );
		hallBarText.textContent = berlinStatusText();

	}
	if ( berlinStatus.phase !== 'ready' ) requestAnimationFrame( updateHallBar );
	else hallBar.classList.remove( 'show' );

} )();

function frame() {

	updateMidiUI();

	timer.update();
	const raw = timer.getDelta();
	const dt = Math.min( raw, 0.05 );
	if ( raw > 0 ) fps += ( 1 / raw - fps ) * 0.05;
	frameBody( dt );
	requestAnimationFrame( frame );

}

// one frame of `dt` s: in real time from frame(), in an offline render from __render.step()
function frameBody( dt, scripted = false ) {

	cameraMoving = false;
	// offline render: restored and updated in sub-steps by startRender() (restoring again here
	// would put the camera back where it was before the script's move this frame)
	if ( ! scripted ) {

		handheld.restore();
		scriptPlayer.update( dt );

	}
	controls.update();
	handheld.apply( dt );
	updateDefocus();
	if ( handheld.consumeRebuild() ) ptDirty = true;
	keysMoving = piano.keyboard.update( dt );
	roll.update( midiPlayer, dt, camera, renderer, venue.mode !== 'pathtrace' );
	if ( piano.action?.update( dt ) ) keysMoving = true;
	// re-render shadow maps only when something moved or the lighting changed (offline render:
	// every frame)
	if ( ! drawFrames ) return;		// (in render mode shadows and the mirror are redone every drawn frame)
	if ( keysMoving || shadowsDirty || RENDER ) {

		renderer.shadowMap.needsUpdate = true;
		// the keyboard's own shadow map from the venue's key light (high quality only)
		if ( settings.gi && venue.mode !== 'pathtrace' ) keyShadow.update( scene, venue.keyLight, venue.keyLightRadius() );
		shadowsDirty = false;

	}

	if ( settings.mode === 'pathtrace' ) {

		if ( keysMoving ) {

			// keys can't be refit into the BVH cheaply; show the raster view while they move
			if ( venue.mode !== 'raster' ) setLightingMode( 'raster' );
			composer.render();
			ptDirty = true;

		} else {

			if ( venue.mode !== 'pathtrace' ) setLightingMode( 'pathtrace' );
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

}

// ---------------------------------------------------------------------------
// boot

applyQuality( false );
setStyle( settings.style );
setMode( settings.mode );
// (the piano shows at once; the Berlin hall, still loading, after it: its bar over the scene meanwhile)
if ( ! params.has( 'loading' ) ) document.getElementById( 'loading' ).classList.add( 'hidden' );		// ?loading keeps it (design preview)
// URL flags applied once the scene exists (a script may change them again)
const flag = k => params.has( k ) && params.get( k ) !== '0';
if ( params.has( 'preset' ) ) gui.controllersRecursive().find( c => c.property === 'preset' )?.setValue( params.get( 'preset' ) );
if ( params.has( 'shake' ) ) gui.controllersRecursive().find( c => c.object === handheld && c.property === 'intensity' )?.setValue( Number( params.get( 'shake' ) ) );
if ( flag( 'handheld' ) ) gui.controllersRecursive().find( c => c._name === 'Handheld' )?.setValue( true );
if ( flag( 'screen' ) ) setScreenPower( true );
window.__pianist = { scene, camera, renderer, room, hall, luminara, get venue() { return venue; }, settings, setStyle, setMode, pathTracer, controls, noteOn, noteOff, pedal, roll, composer, handheld, probe, setScreenPower, scriptPlayer, synth, midiPlayer, bokehPass, get piano() { return piano; } };
if ( RENDER ) startRender(); else requestAnimationFrame( frame );

// ---------------------------------------------------------------------------
// offline render (rendermode.js, driven by tools/render-video.mjs): no 2D UI, no animation
// frames; `__render.step()` advances the render clock by one frame (timers due in it fire: the
// MIDI player's scheduler, fades) and draws the scene at that time. Frame k shows time k / fps.

function startRender() {

	const o = RENDER_OPTS, dt = 1 / o.fps;
	document.head.appendChild( Object.assign( document.createElement( 'style' ), {
		textContent: '.lil-gui, #hud, #power, #start, #drop, #loading, #hallbar { display: none !important; }',
	} ) );
	let frameNo = 0;		// frames drawn so far (time of the next: frameNo / fps)
	let out = null;		// 2D canvas for frame()
	// the watermark on every frame (frame()): WATERMARK, or the render's own (#?wm=…, the driver's
	// --watermark); px at 1080 lines, scaled for other sizes
	const wm = o.watermark === 'off' ? null : { ...WATERMARK, ...parseWatermark( o.watermark ) };
	const mark = new Image();
	// The script player runs in sub-steps of at most SCRIPT_STEP s with the clock: it sees time
	// only when it is updated, so with one update per frame every event (and everything timed off
	// it with after: / gap:) fired up to a frame late, and the delays added up along the script
	// (at 1 fps the user's first line came 4.6 s late, at 25 fps still 0.04 s per event). The
	// rest of the frame (camera shake, roll, keys) is updated once with the frame's dt
	const SCRIPT_STEP = 0.005;
	const step = () => {

		handheld.restore();		// the script's camera moves work on the intended pose
		if ( frameNo > 0 ) {

			const end = 1000 * frameNo * dt;
			const n = Math.max( 1, Math.ceil( ( end - clock.now() ) / ( 1000 * SCRIPT_STEP ) - 1e-9 ) );
			for ( let i = 1; i <= n; ++ i ) {

				const t = i === n ? end : clock.now() + ( end - clock.now() ) / ( n - i + 1 );
				const sdt = ( t - clock.now() ) / 1000;
				clock.advance( t - clock.now() );		// no drift: the last sub-step ends on the frame
				scriptPlayer.update( sdt );

			}

		} else scriptPlayer.update( 0 );
		frameBody( frameNo > 0 ? dt : 0, true );
		frameNo ++;

	};
	const ready = ( async () => {

		await synth.load();
		if ( ! synth.fluidReady ) throw new Error( 'soundfont piano failed to load' );
		audioLog.attach( synth.fluid );
		// script: a bare name is one of public/scripts/
		const base = new URL( import.meta.env.BASE_URL, location.href );
		const url = new URL( /[/:]/.test( o.script ) ? o.script.replace( /^\//, '' ) : 'scripts/' + o.script, base );
		const res = await fetch( url );
		if ( ! res.ok ) throw new Error( `${ url }: ${ res.status }` );
		await scriptPlayer.load( await res.text(), { name: o.script, baseURL: url, midiURL: new URL( 'midi/', base ), audioURL: new URL( 'audio/', base ) } );
		// art and textures that load on their own: the person cut-out, the boot artwork, the chime
		const until = async ( ok, what ) => {

			for ( let i = 0; ! ok(); ++ i ) {

				if ( i > 600 ) throw new Error( `render: ${ what } did not load` );
				await new Promise( r => setTimeout( r, 50 ) );

			}

		};
		await hall.loading;		// ?hall=berlin: the packs
		await luminara.loading;		// its pack
		await until( () => handheld.person.info, 'the person cut-out' );
		await until( () => roll.bootAnim?.ready, 'the boot artwork' );
		await until( () => roll.bootLength !== null, 'the power-on chime' );
		await document.fonts?.ready;
		if ( wm ) {

			mark.src = new URL( wm.src, base ).href;
			await mark.decode().catch( () => console.warn( `watermark ${ wm.src } did not load` ) );

		}
		scriptPlayer.play();
		// skip to `from`: the frames before it are simulated (and drawn) but not captured
		// (yielding now and then: thousands of frames in one task lost the WebGL context, and a
		// MIDI file's start, which settles in a promise, stayed pending)
		// (not drawn: only the timeline moves, a few seconds instead of minutes on the GPU)
		drawFrames = false;
		while ( frameNo < Math.round( o.from * o.fps ) ) {

			step();
			if ( frameNo % 50 === 0 ) await new Promise( r => setTimeout( r, 0 ) );

		}

		drawFrames = true;
		return { fps: o.fps, from: o.from, to: o.to, width: renderer.domElement.width, height: renderer.domElement.height, sampleRate: synth.context().sampleRate };

	} )();
	window.__render = {
		ready,
		// { draw: false }: advance without drawing (the sound track's pass needs the timeline only)
		step( { draw = true } = {} ) {

			const t0 = performance.now();
			drawFrames = draw;
			step();
			drawFrames = true;
			return { frame: frameNo - 1, time: ( frameNo - 1 ) * dt, ms: performance.now() - t0, state: scriptPlayer.playing };

		},
		// the frame just drawn, read from the WebGL canvas itself (preserveDrawingBuffer) and scaled
		// to the output size, as PNG base64. Not a compositor screenshot: that sometimes caught a
		// frame before the canvas had been composited, and showed the page background (#111)
		// instead, in blocks or the whole frame
		frame( width, height ) {

			const src = renderer.domElement;
			out ??= document.createElement( 'canvas' );
			if ( out.width !== width || out.height !== height ) Object.assign( out, { width, height } );
			const g = out.getContext( '2d' );
			g.imageSmoothingEnabled = true;
			g.imageSmoothingQuality = 'high';
			g.drawImage( src, 0, 0, width, height );
			if ( wm && mark.complete && mark.naturalWidth ) {

				const k = height / 1080, h = wm.height * k, w = h * mark.naturalWidth / mark.naturalHeight;
				// `x`: the centre at that fraction of the width; else `right` px from the right edge
				const x = wm.x !== undefined ? width * wm.x - w / 2 : width - wm.right * k - w;
				g.globalAlpha = wm.opacity;
				g.drawImage( mark, x, height - wm.bottom * k - h, w, h );
				g.globalAlpha = 1;

			}

			return out.toDataURL( 'image/png' ).slice( 22 );

		},
		audioSummary: () => audioLog.summary(),
		// the sound track of [from, to] s as WAV, in base64 chunks (page.evaluate returns strings)
		async audio( to = o.to ) {

			const { wav, peak } = await renderAudio( audioLog, { from: o.from, to, sampleRate: synth.context().sampleRate, volume: synth.volume } );
			const bytes = new Uint8Array( wav ), parts = [];
			for ( let i = 0; i < bytes.length; i += 0x8000 ) parts.push( String.fromCharCode( ...bytes.subarray( i, i + 0x8000 ) ) );
			this._wav = btoa( parts.join( '' ) );
			return { length: this._wav.length, peak };

		},
		wavChunk: ( i, size ) => window.__render._wav.slice( i, i + size ),
		// dry stems for the room simulation, and its mix (tools/render-audio.mjs)
		...roomAPI( audioLog, { from: o.from, sampleRate: synth.context().sampleRate, volume: () => synth.volume } ),
	};

}

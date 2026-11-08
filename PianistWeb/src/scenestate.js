// A scene's state as JSON (the GUI's "Path tracing / Download scene state"), and the scene set from one
// again: what the path tracer needs to render the same picture offline (tools/render-pt.mjs).
//
//   piano       its style and the grand's lid angle
//   venue       which, its model (the hall's), its geometry's parameters (the room's), the lighting
//               preset and every value in it (the GUI's lighting controls)
//   render      exposure, tone mapping, GI, AO, bloom, the path tracer's bounces and samples
//   camera      position, orientation, target, fov, zoom (the view as drawn: the handheld camera's
//               shake in it), and the view's size (the path tracer's image)
//   time        what moves on its own (Luminara's sky: clouds, stars, the moon's light; its carousel):
//               the moment, frozen when the state is applied
//   screen      the piano's screen on or off; its roll's mode ('music' | 'voice'), and the MIDI file it shows
//               (embedded: base64), at the moment saved and whether it was playing (applied held still: the
//               bars where they were, the keys glowing as they sounded; frozenSounding)
//
// Not in it: notes or pedals held, a MIDI file's place, a script's.

export const SCENE_STATE_VERSION = 1;

/** Plain JSON values of an object's own fields (a colour string, a number, a boolean, a string). */
const plain = o => Object.fromEntries( Object.entries( o ).filter( ( [ , v ] ) => v === null || [ 'number', 'string', 'boolean' ].includes( typeof v ) ) );

/**
 * `ctx`: { settings, camera, controls, renderer, venue(), venues: { room, hall, luminara }, piano(), roll,
 * handheld, setStyle( id ), setScreenPower( on, opts ), applyQuality(), applyAO(), applyBloom(),
 * refreshLighting(), chosen: { tone(), bloom(), set( tone, bloom ) }, updateGUI() }.
 */
export function captureState( ctx ) {

	const { settings: S, camera: c, controls, renderer } = ctx, venue = ctx.venue(), size = renderer.getSize( c.position.clone().set( 0, 0, 0 ) );
	const name = Object.keys( ctx.venues ).find( k => ctx.venues[ k ] === venue );
	return {
		version: SCENE_STATE_VERSION,
		saved: new Date().toISOString(),
		piano: { style: S.style, lidAngle: S.lidAngle },
		venue: {
			name,
			model: name === 'hall' ? venue.model : undefined,
			params: name === 'room' ? plain( venue.params ) : undefined,
			preset: venue.preset,
			light: plain( venue.light ),
		},
		render: { exposure: S.exposure, toneMapping: S.toneMapping, toneChosen: ctx.chosen.tone(), bloom: S.bloom, bloomChosen: ctx.chosen.bloom(), gi: S.gi, giBounces: S.giBounces, ao: S.ao, aoRadius: S.aoRadius, ptBounces: S.ptBounces, ptSamples: S.ptSamples, ptDof: S.ptDof, ptFStop: S.ptFStop, ptAutoFocus: S.ptAutoFocus, ptFocus: S.ptFocus, ptDenoise: S.ptDenoise },
		camera: {
			position: c.position.toArray(), quaternion: c.quaternion.toArray(), target: controls.target.toArray(),
			fov: c.fov, zoom: c.zoom, near: c.near, far: c.far,
			width: Math.round( size.x ), height: Math.round( size.y ),
		},
		time: name === 'luminara' ? { sky: venue.skyU?.uTime.value ?? 0 } : undefined,
		screen: captureScreen( ctx ),
		handheld: { enabled: !! ctx.handheld.enabled },
	};

}

/**
 * Set the scene from `state` (captureState's). Resolves once the venue's assets for it are in (the
 * Berlin hall's packs, Luminara's pack and lightmap). The camera as saved, the handheld camera off (its
 * shake is in the saved view), the venue's moment frozen.
 */
export async function applyState( ctx, state ) {

	if ( ! state || state.version !== SCENE_STATE_VERSION ) throw new Error( `scene state: version ${ state?.version } (expected ${ SCENE_STATE_VERSION })` );
	const S = ctx.settings, R = state.render ?? {};
	// the piano and its venue (its geometry rebuilt from its parameters first: the room's size, its window)
	const hall = ctx.venues.hall, room = ctx.venues.room;
	if ( state.venue?.name === 'hall' && state.venue.model && hall.model !== state.venue.model ) hall.model = state.venue.model;
	if ( state.venue?.name === 'room' && state.venue.params ) { Object.assign( room.params, state.venue.params ); room.rebuild?.(); }
	S.lidAngle = state.piano?.lidAngle ?? S.lidAngle;
	if ( state.piano?.style && ( state.piano.style !== S.style || ! ctx.piano() || ctx.piano().style.type === 'grand' && ctx.piano().lidAngle !== S.lidAngle ) ) ctx.setStyle( state.piano.style );
	const venue = ctx.venue();
	// its assets (the hall's packs: the model shown; Luminara's pack and the preset's lightmap)
	if ( venue === hall ) { if ( hall.model !== ( state.venue?.model ?? hall.model ) ) hall.setModel( state.venue.model ); await hall.loading; }
	if ( venue === ctx.venues.luminara ) { if ( ! venue._loadTried ) venue.load(); await venue.loading; }
	// the lighting: the preset, then the values as they were (the GUI's changes over it)
	if ( state.venue?.preset && venue.presets?.[ state.venue.preset ] ) {

		venue.preset = state.venue.preset;
		Object.assign( venue.light, { tone: undefined, saturation: undefined, bloom: undefined, bloomThreshold: undefined }, venue.presets[ state.venue.preset ] );

	}
	Object.assign( venue.light, state.venue?.light ?? {} );
	if ( venue === ctx.venues.luminara ) await venue._needBake?.( venue.preset );
	// the rendering
	for ( const k of [ 'exposure', 'toneMapping', 'bloom', 'gi', 'giBounces', 'ao', 'aoRadius', 'ptBounces', 'ptSamples', 'ptDof', 'ptFStop', 'ptAutoFocus', 'ptFocus', 'ptDenoise' ] ) if ( R[ k ] !== undefined ) S[ k ] = R[ k ];
	ctx.chosen.set( !! R.toneChosen, !! R.bloomChosen );
	ctx.applyQuality();		// (GI, the pixel ratio, AO, bloom, the venues' quality; relights)
	ctx.refreshLighting();
	// the moment (Luminara's sky and carousel), frozen
	if ( venue === ctx.venues.luminara && state.time?.sky !== undefined ) venue.frozenTime = state.time.sky;
	// the screen; the handheld camera off (the view below has its shake already)
	ctx.setScreenPower( !! state.screen?.on, { instant: true } );
	applyScreen( ctx, state.screen );
	if ( ctx.handheld.enabled ) ctx.handheld.setEnabled( false );
	// the camera: as saved (its orientation after the controls': a handheld roll kept)
	const C = state.camera, c = ctx.camera;
	if ( C ) {

		c.fov = C.fov; c.zoom = C.zoom ?? 1; c.near = C.near ?? c.near; c.far = C.far ?? c.far;
		c.position.fromArray( C.position );
		ctx.controls.target.fromArray( C.target );
		ctx.controls.update();
		c.quaternion.fromArray( C.quaternion );
		c.updateProjectionMatrix();
		c.updateMatrixWorld();

	}
	ctx.updateGUI();

}

// ---- the screen's roll: its file, embedded ----

const toBase64 = bytes => { let s = ''; for ( let i = 0; i < bytes.length; i += 0x8000 ) s += String.fromCharCode.apply( null, bytes.subarray( i, i + 0x8000 ) ); return btoa( s ); };
const fromBase64 = b64 => Uint8Array.from( atob( b64 ), c => c.charCodeAt( 0 ) );

function captureScreen( ctx ) {

	const P = ctx.midiPlayer, screen = { on: !! ctx.roll.power, mode: ctx.roll.mode };
	if ( P?.bytes?.length ) screen.midi = { name: P.name, data: toBase64( P.bytes ), position: P.position, playing: P.playing || P.frozenSounding };
	return screen;

}

/** The roll as saved: its mode, its file at the moment (held still; drawn as sounding if it was playing). */
function applyScreen( ctx, screen ) {

	if ( ! screen ) return;
	const P = ctx.midiPlayer;
	if ( screen.mode ) ctx.roll.setMode( screen.mode );
	if ( ! screen.midi?.data || ! P ) return;
	P.stop();
	const bytes = fromBase64( screen.midi.data );
	ctx.loadMidi( bytes.buffer, screen.midi.name ?? 'state.mid' );
	ctx.roll.setSubtitle( '' );
	P.seek( screen.midi.position ?? 0 );
	P.frozenSounding = !! screen.midi.playing;
	// the roll in full at once, at its next update (no fade in, no ghost of the file before: it was on the screen already)
	ctx.roll.instantIn = true;

}

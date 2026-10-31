// MIDI roll: notes of the loaded MIDI file fall as glowing bars onto the keys they play, with
// sparks rising where they meet the keyboard and the played keys tinted in the roll colour.
//
// Everything follows the player's clock (MidiFilePlayer.position, file ms: tempo, pause, seek
// and stop are honoured). The roll lives on a plane given by the piano (`piano.roll`): the
// upright's tilted black screen, or a vertical sheet above the grand's fallboard. Plane coords:
// x along the keyboard (keyboard.js pitchX), y up the plane from the key backs (the hit line),
// z towards the player.
//
// Cheap by construction: one instanced draw for the bars, one for the hit flares, one Points draw
// for the particles (simulated in the vertex shader from spawn time/seed; the CPU only writes
// newly spawned particles into a ring buffer), and per-key glow quads that are hidden when idle.
// All buffers are preallocated, nothing is allocated per frame. Additive and depth-tested, not
// depth-writing; flagged `noAO` so GTAO's depth/normal pass skips it (excludeFromGTAO).

import * as THREE from 'three';
import { PITCH_MIN, PITCH_MAX, WHITE_PITCH, pitchX, isBlack } from './keyboard.js';

const MAX_BARS = 2048;				// voice-mode MIDI (talking piano) shows ~600-900 short bars at once
const MAX_PARTICLES = 8192;
const PARTICLE_LIFE = 1.5;			// s
const WHITE_TOP = 0.0222, BLACK_TOP = 0.0345;	// key-mesh local heights of the key tops
const LIFT = 0.0025;				// roll plane offset towards the player (above the screen surface)
const MAX_LIVE = 256;				// live (played) note bars
const POWER_FADE = 0.35;			// s, screen on / off fade
const BOOT_FADE = 0.6;				// s, boot animation -> roll crossfade
// roll modes: 'music' (default) and 'voice', for speech fitted to piano (talking MIDI: dense short
// notes): falls 2x faster, green, no particles. Set by scene scripts only (no GUI).
const VOICE_SPEED = 2;
const VOICE_COLOR = '#19e07a';
// subtitle band at the top of the screen (voice MIDI): what the piano is saying, appearing as it
// is said. Sizes in metres on the screen; the bars fade in below the band while it shows.
const SUB_MARGIN = 0.010;			// above the text (from the screen's top edge)
const SUB_FONT = 0.022;				// character height
const SUB_LINE = SUB_FONT * 1.32;	// line pitch
const SUB_PAD = 0.010;				// below the last line, then a short fade into the roll
const SUB_FADE_IN = 0.25, SUB_FADE_OUT = 0.45;	// s
const SUB_LEAD = 0.12;				// s, text runs this far ahead of the sound
const SUB_PX = 4800;				// px per metre on the canvas

// ---- power-on animation: the loading-screen artwork (tools/build-loading-svg.mjs) drawn into a
// canvas texture on the screen. Timing mirrors the CSS in index.html.
const BASE = import.meta.env.BASE_URL + 'loading/';
const AMBER = '#d9b26f';

function bezier( x1, y1, x2, y2 ) {

	// CSS cubic-bezier timing function
	const a = ( p1, p2 ) => 1 - 3 * p2 + 3 * p1, b = ( p1, p2 ) => 3 * p2 - 6 * p1, c = p1 => 3 * p1;
	const at = ( t, p1, p2 ) => ( ( a( p1, p2 ) * t + b( p1, p2 ) ) * t + c( p1 ) ) * t;
	const slope = ( t, p1, p2 ) => 3 * a( p1, p2 ) * t * t + 2 * b( p1, p2 ) * t + c( p1 );
	return x => {

		let t = x;
		for ( let i = 0; i < 6; ++ i ) {

			const d = slope( t, x1, x2 );
			if ( Math.abs( d ) < 1e-6 ) break;
			t -= ( at( t, x1, x2 ) - x ) / d;

		}

		return at( Math.min( 1, Math.max( 0, t ) ), y1, y2 );

	};

}

const EASE = bezier( .4, 0, .6, 1 );

// value of a keyframed property at cycle fraction u: frames [[u, value], ...], eased per interval
function keyed( frames, u ) {

	if ( u <= frames[ 0 ][ 0 ] ) return frames[ 0 ][ 1 ];
	for ( let i = 1; i < frames.length; ++ i ) {

		const [ u0, v0 ] = frames[ i - 1 ], [ u1, v1 ] = frames[ i ];
		if ( u <= u1 ) return v0 + ( v1 - v0 ) * EASE( ( u - u0 ) / ( u1 - u0 ) );

	}

	return frames[ frames.length - 1 ][ 1 ];

}

// light sweeps (artwork units, 400 x 280): strings rise 14..56%, streamlines 39..81%
const SWEEP_STRINGS = { y: [ [ 0, 170 ], [ .14, 170 ], [ .56, - 40 ], [ 1, - 40 ] ], a: [ [ 0, 0 ], [ .14, 0 ], [ .20, 1 ], [ .50, 1 ], [ .56, 0 ], [ 1, 0 ] ] };
const SWEEP_FLOW = { x: [ [ 0, 20 ], [ .39, 20 ], [ .81, 340 ], [ 1, 340 ] ], a: [ [ 0, 0 ], [ .39, 0 ], [ .45, 1 ], [ .75, 1 ], [ .81, 0 ], [ 1, 0 ] ] };

class BootAnimation {

	constructor() {

		this.canvas = document.createElement( 'canvas' );
		this.ctx = this.canvas.getContext( '2d' );
		this.scratch = document.createElement( 'canvas' );
		this.sctx = this.scratch.getContext( '2d' );
		this.texture = new THREE.CanvasTexture( this.canvas );
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.ready = false;
		this.load();

	}

	async load() {

		try {

			const img = src => new Promise( ( ok, fail ) => {

				const i = new Image();
				i.onload = () => ok( i );
				i.onerror = fail;
				i.src = BASE + src;

			} );
			const [ anim, base, strings, flow ] = await Promise.all( [ fetch( BASE + 'anim.json' ).then( r => r.json() ), img( 'base.svg' ), img( 'mask-strings.svg' ), img( 'mask-flow.svg' ) ] );
			Object.assign( this, { anim, base, strings, flow } );
			this.cycle = anim.cycle;
			this.ready = true;

		} catch ( err ) {

			console.warn( 'boot animation unavailable:', err );

		}

	}

	/** Size the canvas to the screen's aspect ratio. */
	resize( aspect ) {

		const w = 2048, h = Math.max( 64, Math.round( w / aspect ) );
		this.canvas.width = this.scratch.width = w;
		this.canvas.height = this.scratch.height = h;
		// artwork fitted to 88% of the screen height, centred
		const ah = h * 0.88, aw = ah * 400 / 280;
		this.fit = { x: ( w - aw ) / 2, y: ( h - ah ) / 2, s: ah / 280 };

	}

	/** Draw the frame at time t (s) into the texture. */
	draw( t ) {

		const { ctx, sctx, canvas, fit } = this;
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		ctx.fillStyle = '#000';
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		if ( ! this.ready || ! fit ) {

			this.texture.needsUpdate = true;
			return;

		}

		const u = ( t / this.cycle ) % 1;
		const aw = 400 * fit.s, ah = 280 * fit.s;
		const X = x => fit.x + x * fit.s, Y = y => fit.y + y * fit.s;

		// base drawing, breathing
		ctx.globalAlpha = 0.91 - 0.09 * Math.cos( 2 * Math.PI * u );
		ctx.drawImage( this.base, fit.x, fit.y, aw, ah );
		ctx.globalAlpha = 1;

		// a light sweep: gradient band clipped to a line mask
		const sweep = ( mask, a, grad ) => {

			if ( a <= 0.001 ) return;
			sctx.globalCompositeOperation = 'source-over';
			sctx.clearRect( 0, 0, canvas.width, canvas.height );
			sctx.drawImage( mask, fit.x, fit.y, aw, ah );
			sctx.globalCompositeOperation = 'source-in';
			grad( sctx );
			ctx.globalAlpha = a;
			ctx.drawImage( this.scratch, 0, 0 );
			ctx.globalAlpha = 1;

		};

		const band = ( g, x0, y0, x1, y1 ) => {

			g.addColorStop( 0, 'rgba(217,178,111,0)' );
			g.addColorStop( 0.5, AMBER );
			g.addColorStop( 1, 'rgba(217,178,111,0)' );
			return g;

		};

		const sy = keyed( SWEEP_STRINGS.y, u );
		sweep( this.strings, keyed( SWEEP_STRINGS.a, u ), g => {

			g.fillStyle = band( g.createLinearGradient( 0, Y( sy + 120 ), 0, Y( sy ) ) );
			g.fillRect( X( 100 ), Y( sy ), 200 * fit.s, 120 * fit.s );

		} );
		const fx = keyed( SWEEP_FLOW.x, u );
		sweep( this.flow, keyed( SWEEP_FLOW.a, u ), g => {

			g.fillStyle = band( g.createLinearGradient( X( fx ), 0, X( fx + 160 ), 0 ) );
			g.fillRect( X( fx ), fit.y, 160 * fit.s, ah );

		} );

		// played keys: each flashes as a whole (rise 1.5% of the cycle, fade by 10%)
		ctx.fillStyle = AMBER;
		for ( const k of this.anim.keys ) {

			const d = u - k.start;
			if ( d < 0 || d > 0.1 ) continue;
			ctx.globalAlpha = d < 0.015 ? d / 0.015 : 1 - ( d - 0.015 ) / 0.085;
			ctx.beginPath();
			k.pts.forEach( ( p, i ) => ( i ? ctx.lineTo( X( p[ 0 ] ), Y( p[ 1 ] ) ) : ctx.moveTo( X( p[ 0 ] ), Y( p[ 1 ] ) ) ) );
			ctx.closePath();
			ctx.fill();

		}

		ctx.globalAlpha = 1;

		// the streamlines end at the artwork's right edge: on a wide screen let them fade out
		// instead of stopping in the middle of the display
		const fade = ctx.createLinearGradient( X( 320 ), 0, X( 400 ), 0 );
		fade.addColorStop( 0, 'rgba(0,0,0,0)' );
		fade.addColorStop( 1, 'rgba(0,0,0,1)' );
		ctx.globalCompositeOperation = 'destination-out';
		ctx.fillStyle = fade;
		ctx.fillRect( X( 320 ), 0, X( 400 ) - X( 320 ) + 1, canvas.height );
		ctx.globalCompositeOperation = 'source-over';
		this.texture.needsUpdate = true;

	}

}

// subtitle band: black (opaque, fading out at the bottom) behind text revealed per line up to
// uReveal (u), with a soft edge about a character wide
const SUB_FS = /* glsl */`
	uniform sampler2D map;
	uniform float uOpacity;
	uniform vec2 uReveal;
	uniform float uSplit;
	uniform float uSoft;
	uniform float uFadeV;
	varying vec2 vUv;
	void main() {
		float edge = vUv.y > uSplit ? uReveal.x : uReveal.y;		// line 1 is the upper one
		float shown = 1.0 - smoothstep( edge - uSoft, edge, vUv.x );
		vec4 t = texture2D( map, vUv );
		float bg = 0.9 * smoothstep( 0.0, uFadeV, vUv.y );
		float a = t.a * shown;
		vec3 col = t.rgb * a;
		float alpha = a + bg * ( 1.0 - a );
		gl_FragColor = vec4( col / max( alpha, 1e-4 ), alpha * uOpacity );
	}
`;

// ---------------------------------------------------------------------------------------------
const BAR_VS = /* glsl */`
	attribute vec2 corner;
	attribute vec4 aRect;			// x0, y0, x1, y1 (plane coords, m)
	attribute vec2 aInfo;			// velocity 0..1, sounding (1 while the note plays)
	uniform float uGlow;
	varying vec2 vP;				// position relative to the rect centre (m)
	varying vec2 vHalf;
	varying vec2 vInfo;
	varying float vY;
	void main() {
		vec2 c = 0.5 * ( aRect.xy + aRect.zw );
		vHalf = 0.5 * ( aRect.zw - aRect.xy );
		vec2 p = c + ( corner * 2.0 - 1.0 ) * ( vHalf + uGlow );
		vP = p - c;
		vInfo = aInfo;
		vY = p.y;
		gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 0.0, 1.0 );
	}
`;

const BAR_FS = /* glsl */`
	uniform vec3 uColor;
	uniform float uGlow;
	uniform float uHeight;
	uniform float uIntensity;
	varying vec2 vP;
	varying vec2 vHalf;
	varying vec2 vInfo;
	varying float vY;
	float sdRoundBox( vec2 p, vec2 b, float r ) {
		vec2 q = abs( p ) - b + r;
		return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
	}
	void main() {
		float r = min( vHalf.x * 0.55, vHalf.y );
		float d = sdRoundBox( vP, vHalf, r );
		float aa = fwidth( d );
		float core = 1.0 - smoothstep( - aa, aa, d );
		// halo fading to exactly zero at the quad edge (no visible box)
		float glow = exp( - max( d, 0.0 ) / ( 0.3 * uGlow ) ) * ( 1.0 - core ) * ( 1.0 - smoothstep( 0.45 * uGlow, 0.95 * uGlow, d ) );
		// solid fill with a faint lighter edge; brighter while the note sounds. Opacity (additive:
		// brightness) follows the velocity: ~0.22 at pp (0.3), ~0.58 at mf (0.6), ~0.89 at ff (0.9)
		float rim = smoothstep( - 0.0025, 0.0, d ) * core;
		float opacity = 0.04 + 0.96 * pow( clamp( vInfo.x, 0.0, 1.0 ), 1.3 );
		float lit = 0.85 + 0.3 * vInfo.y;
		vec3 col = ( uColor * core * lit * ( 1.0 + 0.12 * rim ) + uColor * glow * ( 0.38 + 0.4 * vInfo.y ) * 0.15 ) * opacity;		// halo at 15%
		// fade in at the top of the plane, clip below the hit line
		col *= smoothstep( uHeight, uHeight - 0.04, vY ) * step( 0.0, vY );
		gl_FragColor = vec4( col * uIntensity, 1.0 );
	}
`;

// soft flare where a sounding note meets the keys
const FLARE_VS = /* glsl */`
	attribute vec2 corner;
	attribute vec3 aFlare;			// x, half width, strength
	varying vec2 vUv;
	varying float vS;
	void main() {
		vUv = corner * 2.0 - 1.0;
		vS = aFlare.z;
		vec2 p = vec2( aFlare.x + vUv.x * ( aFlare.y + 0.026 ), vUv.y * 0.03 );
		gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 0.0005, 1.0 );
	}
`;

const FLARE_FS = /* glsl */`
	uniform vec3 uColor;
	uniform float uIntensity;
	varying vec2 vUv;
	varying float vS;
	void main() {
		float f = exp( - dot( vUv * vec2( 4.4, 5.2 ), vUv * vec2( 4.4, 5.2 ) ) );		// outer halo at half the reach
		float core = exp( - dot( vUv * vec2( 4.0, 9.0 ), vUv * vec2( 4.0, 9.0 ) ) );
		vec3 col = mix( uColor, vec3( 1.0 ), 0.65 ) * core * 2.6 + uColor * f * 1.1 * 0.15;		// outer halo at 15%
		gl_FragColor = vec4( col * vS * uIntensity, 1.0 );
	}
`;

// sparks: rise from the hit line with a turbulent swirl; a few larger dim "smoke" puffs
const PART_VS = /* glsl */`
	attribute vec4 aSpawn;			// t0, seed, kind (0 spark / 1 smoke), strength
	uniform float uTime;
	uniform float uLife;
	uniform float uScale;			// px per metre at unit distance
	varying float vA;
	varying float vKind;
	varying float vAge;
	float h( float n ) { return fract( sin( n ) * 43758.5453 ); }
	void main() {
		float age = uTime - aSpawn.x;
		float s = aSpawn.y, kind = aSpawn.z;
		float life = uLife * ( 0.55 + 0.6 * h( s * 3.1 ) ) * ( kind > 0.5 ? 1.6 : 1.0 );
		vKind = kind;
		vAge = age / life;
		if ( age < 0.0 || age > life ) {
			gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
			gl_PointSize = 0.0;
			vA = 0.0;
			return;
		}
		// 70% of the sparks ride one of three strands per note: same rise / swirl for the whole
		// strand and a phase that follows the spawn time, so they trace travelling wavy ribbons;
		// the rest scatter on their own
		float strand = step( 0.3, h( s * 8.9 ) );
		float k = position.x * 977.0 + floor( h( s * 3.7 ) * 3.0 ) * 13.0;
		float rise = mix( mix( 0.06, 0.15, h( s * 7.7 ) ), mix( 0.075, 0.12, h( k * 1.7 ) ), strand ) * ( kind > 0.5 ? 0.5 : 1.0 );
		float y = 0.003 + rise * age + 0.025 * age * age;
		float w = mix( mix( 4.0, 9.0, h( s * 1.9 ) ), mix( 4.5, 7.0, h( k * 3.3 ) ), strand );
		float amp = mix( mix( 0.005, 0.02, h( s * 5.3 ) ), mix( 0.011, 0.022, h( k * 2.9 ) ), strand ) * smoothstep( 0.0, 0.45, age );
		float phase = mix( s * 40.0, h( k * 4.1 ) * 6.28 + aSpawn.x * 3.5, strand );
		float strandOff = ( floor( h( s * 3.7 ) * 3.0 ) - 1.0 ) * 0.3 * position.y;		// position.y: key width
		float spread = mix( ( h( s * 2.3 ) - 0.5 ) * position.y, strandOff + ( h( s * 2.3 ) - 0.5 ) * 0.0015, strand );
		float x = position.x + spread + amp * sin( w * age + phase ) + 0.005 * sin( 2.3 * age + phase * 0.37 ) * age;
		float z = 0.002 + 0.03 * h( s * 4.1 ) * age;
		vec4 mv = modelViewMatrix * vec4( x, y, z, 1.0 );
		gl_Position = projectionMatrix * mv;
		float size = kind > 0.5 ? 0.015 : mix( 0.0014, 0.003, h( s * 6.7 ) );		// glow puffs at half the reach
		gl_PointSize = max( 1.0, size * uScale / - mv.z );
		vA = aSpawn.w * smoothstep( 0.0, 0.06, age ) * pow( 1.0 - age / life, 1.4 ) * ( kind > 0.5 ? 0.06 : 1.0 );
	}
`;

const PART_FS = /* glsl */`
	uniform vec3 uColor;
	uniform float uIntensity;
	varying float vA;
	varying float vKind;
	varying float vAge;
	void main() {
		vec2 c = gl_PointCoord * 2.0 - 1.0;
		float r2 = dot( c, c );
		if ( r2 > 1.0 ) discard;
		float fall = vKind > 0.5 ? ( 1.0 - r2 ) * ( 1.0 - r2 ) : exp( - r2 * 3.0 );
		// sparks start white-hot and cool to the roll colour
		vec3 col = vKind > 0.5 ? uColor * 0.35 : mix( mix( uColor, vec3( 1.0, 0.97, 0.92 ), 0.75 ), uColor, smoothstep( 0.15, 0.85, vAge ) ) * 3.0;
		gl_FragColor = vec4( col * fall * vA * uIntensity, 1.0 );
	}
`;

function quadCorners( geo ) {

	geo.setAttribute( 'corner', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 1 ], 2 ) );
	geo.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	return geo;

}

/** GTAO's depth/normal pass draws every visible mesh; make it skip objects flagged userData.noAO. */
export function excludeFromGTAO( gtaoPass ) {

	const base = gtaoPass._overrideVisibility.bind( gtaoPass );
	gtaoPass._overrideVisibility = function () {

		base();
		const cache = this._visibilityCache;
		this.scene.traverse( o => {

			if ( o.userData.noAO && o.visible ) {

				o.visible = false;
				cache.push( o );

			}

		} );

	};

}

export class PianoRoll {

	constructor() {

		this.enabled = true;
		this.particles = true;
		this.lookahead = 2.5;			// s of file time visible above the hit line
		this.mode = 'music';			// 'music' | 'voice' (see setMode)
		this.musicColor = new THREE.Color( '#1a5cff' );
		this.voiceColor = new THREE.Color( VOICE_COLOR );
		this.color = this.musicColor.clone();		// the colour in use; uniforms share this object
		this.liveColor = new THREE.Color( '#ff2a36' );	// notes played on the keyboard, rising
		this.intensity = 1.0;
		this.power = false;				// screen on/off: the roll only shows while on
		this.powerLevel = 0;			// faded 0..1
		this.bootT = - 1;				// time into the power-on animation (artwork s), -1 = not booting
		this.bootLength = null;			// s the artwork's cycle is played in (the power-on chime's length)

		this.group = new THREE.Group();
		this.group.name = 'pianoRoll';
		this.group.matrixAutoUpdate = false;
		this.group.userData.noAO = true;

		const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };

		// bars
		{

			const geo = quadCorners( new THREE.InstancedBufferGeometry() );
			this.rect = new THREE.InstancedBufferAttribute( new Float32Array( MAX_BARS * 4 ), 4 ).setUsage( THREE.DynamicDrawUsage );
			this.info = new THREE.InstancedBufferAttribute( new Float32Array( MAX_BARS * 2 ), 2 ).setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( 'aRect', this.rect );
			geo.setAttribute( 'aInfo', this.info );
			geo.instanceCount = 0;
			this.barUniforms = { uColor: { value: this.color }, uGlow: { value: 0.006 }, uHeight: { value: 0.3 }, uIntensity: { value: 1 } };
			this.bars = new THREE.Mesh( geo, new THREE.ShaderMaterial( { vertexShader: BAR_VS, fragmentShader: BAR_FS, uniforms: this.barUniforms, ...common } ) );
			this.bars.frustumCulled = false;
			this.bars.renderOrder = 10;
			this.bars.userData.noAO = true;
			this.group.add( this.bars );

		}

		// live bars: same shader, own instances and colour, rising from the hit line
		{

			const geo = quadCorners( new THREE.InstancedBufferGeometry() );
			this.liveRect = new THREE.InstancedBufferAttribute( new Float32Array( MAX_LIVE * 4 ), 4 ).setUsage( THREE.DynamicDrawUsage );
			this.liveInfo = new THREE.InstancedBufferAttribute( new Float32Array( MAX_LIVE * 2 ), 2 ).setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( 'aRect', this.liveRect );
			geo.setAttribute( 'aInfo', this.liveInfo );
			geo.instanceCount = 0;
			this.liveUniforms = { uColor: { value: this.liveColor }, uGlow: this.barUniforms.uGlow, uHeight: this.barUniforms.uHeight, uIntensity: { value: 1 } };
			this.liveBars = new THREE.Mesh( geo, new THREE.ShaderMaterial( { vertexShader: BAR_VS, fragmentShader: BAR_FS, uniforms: this.liveUniforms, ...common } ) );
			this.liveBars.frustumCulled = false;
			this.liveBars.renderOrder = 10;
			this.liveBars.userData.noAO = true;
			this.group.add( this.liveBars );
			this.liveNotes = [];
			this.liveTime = 0;

		}

		// subtitle band (screens): normal blending, so its black covers the additive bars behind
		// it. The text is a canvas texture; the shader reveals it left to right per line
		{

			this.subCanvas = document.createElement( 'canvas' );
			this.subTexture = new THREE.CanvasTexture( this.subCanvas );
			this.subTexture.colorSpace = THREE.SRGBColorSpace;
			this.subTexture.anisotropy = 4;
			this.subUniforms = {
				map: { value: this.subTexture }, uOpacity: { value: 0 },
				uReveal: { value: new THREE.Vector2() },		// per line: u of the reveal edge
				uSplit: { value: 0.5 }, uSoft: { value: 0.01 }, uFadeV: { value: 0.12 },
			};
			this.subMesh = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ).translate( 0, - 0.5, - 0.0004 ), new THREE.ShaderMaterial( {
				vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
				fragmentShader: SUB_FS, uniforms: this.subUniforms, transparent: true, depthWrite: false, toneMapped: false,
			} ) );
			this.subMesh.frustumCulled = false;
			this.subMesh.renderOrder = 11;
			this.subMesh.visible = false;
			this.subMesh.userData.noAO = true;
			this.group.add( this.subMesh );
			this.subText = '';
			this.subLines = [];			// [{ text, x0, edges: [px after each character] }]
			this.subState = null;		// null | 'pending' (MIDI starting) | 'on' | 'out'
			this.subLevel = 0;
			this.subBand = 0;			// m, current band height
			this.subTiming = null;		// { events, curve: file ms -> characters said }

		}

		// power-on animation plane (screens only)
		{

			this.bootAnim = new BootAnimation();
			this.bootMesh = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ).translate( 0, 0.5, - 0.0006 ), new THREE.MeshBasicMaterial( {
				map: this.bootAnim.texture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
			} ) );
			this.bootMesh.frustumCulled = false;
			this.bootMesh.renderOrder = 9;
			this.bootMesh.visible = false;
			this.bootMesh.userData.noAO = true;
			this.group.add( this.bootMesh );

		}

		// hit flares
		{

			const geo = quadCorners( new THREE.InstancedBufferGeometry() );
			this.flare = new THREE.InstancedBufferAttribute( new Float32Array( 128 * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( 'aFlare', this.flare );
			geo.instanceCount = 0;
			this.flareUniforms = { uColor: { value: this.color }, uIntensity: { value: 1 } };
			this.flares = new THREE.Mesh( geo, new THREE.ShaderMaterial( { vertexShader: FLARE_VS, fragmentShader: FLARE_FS, uniforms: this.flareUniforms, ...common } ) );
			this.flares.frustumCulled = false;
			this.flares.renderOrder = 11;
			this.flares.userData.noAO = true;
			this.group.add( this.flares );

		}

		// particles (ring buffer)
		{

			const geo = new THREE.BufferGeometry();
			this.pPos = new THREE.BufferAttribute( new Float32Array( MAX_PARTICLES * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage );
			this.pSpawn = new THREE.BufferAttribute( new Float32Array( MAX_PARTICLES * 4 ).fill( - 1e6 ), 4 ).setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( 'position', this.pPos );
			geo.setAttribute( 'aSpawn', this.pSpawn );
			this.partUniforms = { uColor: { value: this.color }, uTime: { value: 0 }, uLife: { value: PARTICLE_LIFE }, uScale: { value: 1000 }, uIntensity: { value: 1 } };
			this.points = new THREE.Points( geo, new THREE.ShaderMaterial( { vertexShader: PART_VS, fragmentShader: PART_FS, uniforms: this.partUniforms, ...common } ) );
			this.points.frustumCulled = false;
			this.points.renderOrder = 12;
			this.group.add( this.points );
			this.pNext = 0;
			this.pDirtyFrom = - 1;
			this.pDirtyCount = 0;
			this.seed = 1;

		}

		// octave guides (faint lines at every C)
		{

			const pts = [];
			for ( let p = 24; p <= PITCH_MAX; p += 12 ) {

				const x = pitchX( p ) - WHITE_PITCH / 2;
				pts.push( x, 0, - 0.0005, x, 1, - 0.0005 );

			}

			const geo = new THREE.BufferGeometry();
			geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pts, 3 ) );
			this.guides = new THREE.LineSegments( geo, new THREE.LineBasicMaterial( { color: 0xffffff, transparent: true, opacity: 0.035, depthWrite: false, toneMapped: false } ) );
			this.guides.frustumCulled = false;
			this.group.add( this.guides );

		}

		// per-key glow: shared vertical alpha gradient (bright at the key back)
		{

			const n = 32, data = new Uint8Array( n * 4 );
			for ( let i = 0; i < n; ++ i ) data.set( [ 255, Math.round( 255 * ( 0.25 + 0.75 * Math.pow( i / ( n - 1 ), 1.5 ) ) ), 255, 255 ], i * 4 );
			this.keyGradient = new THREE.DataTexture( data, 1, n );
			this.keyGradient.needsUpdate = true;
			this.keyGlows = new Map();

		}

		this.notes = null;
		this.events = null;
		this.playing = new Float32Array( 128 );	// per pitch: velocity of the sounding note (0 = idle)
		this.prevPos = 0;
		this.time = 0;

	}

	// ---- piano / file ----------------------------------------------------------------------
	/** Mount on a piano (its `roll` plane) and add glow quads to its keys. */
	attach( piano ) {

		this.group.removeFromParent();
		for ( const g of this.keyGlows.values() ) {

			g.removeFromParent();
			g.material.dispose();

		}

		this.keyGlows.clear();
		const R = piano.roll;
		if ( ! R ) return;
		const normal = new THREE.Vector3().crossVectors( new THREE.Vector3( 1, 0, 0 ), R.up ).normalize();
		this.group.matrix.makeBasis( new THREE.Vector3( 1, 0, 0 ), R.up, normal )
			.setPosition( R.origin.clone().addScaledVector( normal, LIFT ) );
		this.height = R.height;
		this.barUniforms.uHeight.value = R.height;
		this.screen = !! R.screen;
		this.bootMesh.scale.set( R.width ?? 1.3, R.height, 1 );
		this.subMesh.position.y = R.height;
		this._drawSubtitle();
		this.bootAnim.resize( ( R.width ?? 1.3 ) / R.height );
		this.bootT = - 1;
		this.bootMesh.visible = false;
		this.liveNotes.length = 0;
		this.guides.scale.y = R.height;
		this.guides.matrixAutoUpdate = true;
		piano.group.add( this.group );

		const whiteGeo = new THREE.PlaneGeometry( WHITE_PITCH * 0.9, 0.148 ).rotateX( - Math.PI / 2 ).translate( 0, WHITE_TOP, - 0.076 );
		const blackGeo = new THREE.PlaneGeometry( 0.0088, 0.086 ).rotateX( - Math.PI / 2 ).translate( 0, BLACK_TOP, - 0.104 );
		for ( const [ pitch, key ] of piano.keyboard.keys ) {

			const m = new THREE.Mesh( isBlack( pitch ) ? blackGeo : whiteGeo, new THREE.MeshBasicMaterial( {
				color: this.color, alphaMap: this.keyGradient, transparent: true, opacity: 0, depthWrite: false,
				blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2,
			} ) );
			m.visible = false;
			m.userData.noAO = true;
			m.userData.level = 0;
			m.raycast = () => {};
			key.mesh.add( m );
			this.keyGlows.set( pitch, m );

		}

		this.piano = piano;

	}

	/** (Re)build the note list from the player's events: [{ on, off (ms), pitch, vel, x, w }] sorted by on. */
	_build( events ) {

		const notes = [];
		const open = new Map();
		for ( const e of events ) {

			const d = e.d, p = d.noteNumber;
			if ( p < PITCH_MIN || p > PITCH_MAX ) continue;
			const off = d.subtype === 'noteOff' || ( d.subtype === 'noteOn' && d.velocity === 0 );
			if ( d.subtype === 'noteOn' && ! off ) {

				const n = { on: e.time, off: Infinity, pitch: p, vel: d.velocity / 127, x: pitchX( p ), w: isBlack( p ) ? 0.0098 : WHITE_PITCH * 0.74 };
				notes.push( n );
				if ( ! open.has( p ) ) open.set( p, [] );
				open.get( p ).push( n );

			} else if ( off && open.get( p )?.length ) {

				open.get( p ).shift().off = e.time;

			}

		}

		const end = events.length ? events[ events.length - 1 ].time : 0;
		for ( const n of notes ) if ( n.off === Infinity ) n.off = Math.max( end, n.on + 500 );
		notes.sort( ( a, b ) => a.on - b.on );
		this.notes = notes;
		this.maxDur = notes.reduce( ( m, n ) => Math.max( m, n.off - n.on ), 0 );
		this.events = events;

	}

	/** Screen power: the roll (file and live notes) only shows while on. */
	setPower( on ) {

		this.power = on;
		// screens play the loading artwork as their power-on animation
		this.bootT = on && this.screen ? 0 : - 1;
		if ( ! on ) this.bootMesh.visible = false;
		if ( ! on ) for ( const n of this.liveNotes ) if ( n.off === null ) n.off = this.liveTime;

	}

	/** A note played on the keyboard (not from the file): a red bar rising from the hit line. */
	liveOn( pitch, velocity = 0.8 ) {

		if ( ! this.power || pitch < PITCH_MIN || pitch > PITCH_MAX ) return;
		this.liveOff( pitch );
		if ( this.liveNotes.length >= MAX_LIVE ) this.liveNotes.shift();
		this.liveNotes.push( { pitch, vel: velocity, on: this.liveTime, off: null, x: pitchX( pitch ), w: isBlack( pitch ) ? 0.0098 : WHITE_PITCH * 0.74 } );

	}

	liveOff( pitch ) {

		for ( const n of this.liveNotes ) if ( n.pitch === pitch && n.off === null ) n.off = this.liveTime;

	}

	/**
	 * Show `text` at the top of the screen while the next MIDI file plays, appearing as it is
	 * said (timed by when its notes sound), fading out after it ends; '' / null clears it.
	 */
	setSubtitle( text ) {

		this.subText = ( text ?? '' ).trim();
		this.subState = this.subText ? 'pending' : null;
		this.subWait = 0;
		this.subTiming = null;
		if ( ! this.subText ) this.subLevel = 0;
		this._drawSubtitle();

	}

	_drawSubtitle() {

		const W = this.piano?.roll?.width ?? 1.3, c = this.subCanvas, g = c.getContext( '2d' );
		const font = px => `500 ${ Math.round( px ) }px "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif`;
		const fpx = SUB_FONT * SUB_PX, w = Math.round( W * SUB_PX );
		g.font = font( fpx );
		// one line, or two balanced ones (broken after punctuation near the middle)
		const t = this.subText;
		let lines = t ? [ t ] : [];
		if ( t && g.measureText( t ).width > w * 0.86 ) {

			const mid = t.length / 2;
			let cut = Math.round( mid ), best = Infinity;
			for ( let i = 1; i < t.length; ++ i ) if ( /[，。！？、；：,.!?;:]/.test( t[ i - 1 ] ) && Math.abs( i - mid ) < best ) best = Math.abs( i - ( cut = i ) );
			lines = [ t.slice( 0, cut ), t.slice( cut ) ];

		}

		const band = SUB_MARGIN + Math.max( 1, lines.length ) * SUB_LINE + SUB_PAD;
		const h = Math.round( band * SUB_PX );
		if ( c.width !== w || c.height !== h ) {

			c.width = w;
			c.height = h;

		}

		g.clearRect( 0, 0, w, h );
		g.font = font( fpx );
		g.textAlign = 'left';
		g.textBaseline = 'middle';
		g.fillStyle = '#e8fff2';
		g.shadowColor = 'rgba(25,224,122,0.45)';
		g.shadowBlur = fpx * 0.3;
		this.subLines = lines.map( ( line, i ) => {

			const chars = [ ...line ], edges = [];
			let x = 0;
			for ( const ch of chars ) edges.push( x += g.measureText( ch ).width );
			const x0 = ( w - x ) / 2, y = ( SUB_MARGIN + ( i + 0.5 ) * SUB_LINE ) * SUB_PX;
			let cx = x0;
			chars.forEach( ( ch, k ) => {

				g.fillText( ch, cx, y );
				cx = x0 + edges[ k ];

			} );
			return { chars, x0, edges };

		} );
		g.shadowBlur = 0;
		this.subTexture.needsUpdate = true;
		this.subBand = band;
		this.subMesh.scale.set( W, band, 1 );
		const U = this.subUniforms;
		U.uSplit.value = 1 - ( SUB_MARGIN + SUB_LINE ) / band;
		U.uSoft.value = fpx / w;
		U.uFadeV.value = SUB_PAD * 0.8 / band;
		U.uReveal.value.set( 0, 0 );

	}

	// when the words are said: the voice MIDI's sounding frames (20 ms; summed squared
	// velocity over a floor), mapped to the line's characters (punctuation takes no time)
	_subtitleTiming() {

		const notes = this.notes ?? [], frame = 20;
		const end = notes.reduce( ( a, n ) => Math.max( a, n.on ), 0 ) + frame;
		const energy = new Float32Array( Math.ceil( end / frame ) + 1 );
		for ( const n of notes ) energy[ Math.floor( n.on / frame ) ] += n.vel * n.vel;
		const sorted = [ ...energy ].filter( v => v > 0 ).sort( ( a, b ) => a - b );
		const floor = 0.08 * ( sorted[ Math.floor( sorted.length * 0.9 ) ] ?? 0 );
		const said = [];		// cumulative voiced time (ms) at the end of each frame
		let acc = 0;
		for ( const e of energy ) said.push( acc += e > floor ? frame : 0 );
		const weights = this.subLines.flatMap( l => l.chars.map( ch => /[\s，。！？、；：,.!?;:《》「」“”"'()（）…—-]/.test( ch ) ? 0 : 1 ) );
		const total = weights.reduce( ( a, b ) => a + b, 0 ) || 1;
		return { events: this.events, said, frame, voiced: acc || 1, weights, total };

	}

	_updateSubtitle( player, dt, level ) {

		if ( this.subState === 'pending' ) {

			if ( player.playing ) this.subState = 'on';
			else if ( ( this.subWait += dt ) > 2 ) this.subState = 'out';		// never started

		} else if ( this.subState === 'on' && ! player.playing ) this.subState = 'out';
		const up = this.subState === 'pending' || this.subState === 'on';
		this.subLevel = up ? Math.min( 1, this.subLevel + dt / SUB_FADE_IN ) : Math.max( 0, this.subLevel - dt / SUB_FADE_OUT );
		if ( this.subState === 'out' && this.subLevel === 0 ) this.subState = null;
		this.subMesh.visible = this.screen && this.subLevel > 0;
		this.subUniforms.uOpacity.value = this.subLevel * level;
		this.barUniforms.uHeight.value = this.height - ( this.subBand + 0.002 ) * THREE.MathUtils.smoothstep( this.subLevel, 0, 1 );
		if ( ! this.subMesh.visible || ! this.subLines.length ) return;

		// how much has been said: characters in proportion to voiced time so far
		if ( this.subTiming?.events !== this.events && this.notes ) this.subTiming = this._subtitleTiming();
		const T = this.subTiming;
		let n;		// characters shown (fractional)
		if ( this.subState === 'out' ) n = Infinity;
		else if ( ! T ) n = 0;
		else {

			const i = Math.max( 0, Math.min( T.said.length - 1, Math.floor( ( player.position + SUB_LEAD * 1000 ) / T.frame ) ) );
			let k = T.said[ i ] / T.voiced * T.total;
			// spread over the weighted characters; zero-weight ones (punctuation) ride along
			n = 0;
			for ( const wgt of T.weights ) {

				if ( k <= 0 ) break;
				if ( wgt === 0 ) {

					n += 1;
					continue;

				}

				const take = Math.min( 1, k );
				n += take;
				k -= take;

			}

		}

		const w = this.subCanvas.width, U = this.subUniforms.uReveal.value;
		const reveal = [ 0, 0 ];
		let left = n;
		this.subLines.forEach( ( l, i ) => {

			const m = Math.min( left, l.chars.length );
			left -= m;
			const whole = Math.floor( m ), frac = m - whole;
			const a = whole > 0 ? l.edges[ whole - 1 ] : 0, b = l.edges[ Math.min( whole, l.edges.length - 1 ) ] ?? a;
			// the soft edge spans about a character: push it so a whole character is crisp
			const px = m >= l.chars.length ? w : l.x0 + a + ( b - a ) * frac + ( m > 0 ? this.subUniforms.uSoft.value * w * 0.5 : 0 );
			reveal[ i ] = px / w;

		} );
		U.set( reveal[ 0 ], this.subLines.length > 1 ? reveal[ 1 ] : reveal[ 0 ] );

	}

	/** The music-mode colour (GUI). */
	setColor( c ) {

		this.musicColor.set( c );
		this._applyColor();

	}

	/**
	 * 'music' (default) or 'voice': speech played by the piano (dense short notes) falls 2x faster,
	 * green, without particles. Live (played) bars are unchanged.
	 */
	setMode( mode ) {

		this.mode = mode === 'voice' ? 'voice' : 'music';
		this._applyColor();

	}

	_applyColor() {

		this.color.copy( this.mode === 'voice' ? this.voiceColor : this.musicColor );
		for ( const g of this.keyGlows.values() ) g.material.color.copy( this.color );

	}

	get _speedFactor() {

		return this.mode === 'voice' ? VOICE_SPEED : 1;

	}

	// ---- per frame ----------------------------------------------------------------------------
	/**
	 * @param player  MidiFilePlayer
	 * @param dt      frame time (s), drives the particle clock
	 * @param camera, renderer  for the particle size scale
	 * @param show    roll allowed this frame (enabled, raster mode)
	 */
	update( player, dt, camera, renderer, show ) {

		if ( player.events !== this.events ) this._build( player.events );
		const target = this.power ? 1 : 0;
		this.powerLevel = target > this.powerLevel ? Math.min( 1, this.powerLevel + dt / POWER_FADE ) : Math.max( 0, this.powerLevel - dt / POWER_FADE );
		const active = show && this.enabled && this.piano && this.powerLevel > 0;
		this.group.visible = !! active;
		this.liveTime += dt;
		if ( ! active ) {

			this._fadeKeys( dt, true );
			if ( ! this.power ) this.liveNotes.length = 0;
			return;

		}

		// power-on animation, then crossfade to the roll
		let rollLevel = 1;
		if ( this.bootT >= 0 ) {

			const cycle = this.bootAnim.cycle ?? 5.35;
			this.bootT += dt * ( this.bootLength ? cycle / this.bootLength : 1 );
			const end = cycle + BOOT_FADE;
			if ( this.bootT >= end ) {

				this.bootT = - 1;
				this.bootMesh.visible = false;

			} else {

				this.bootAnim.draw( Math.min( this.bootT, cycle - 1e-3 ) );
				this.bootMesh.visible = true;
				this.bootMesh.material.opacity = this.powerLevel * ( 1 - THREE.MathUtils.smoothstep( this.bootT, cycle - 0.1, end ) );
				rollLevel = THREE.MathUtils.smoothstep( this.bootT, cycle - 0.2, end );

			}

		}

		const level = this.powerLevel * rollLevel;
		this.barUniforms.uIntensity.value = this.flareUniforms.uIntensity.value = this.partUniforms.uIntensity.value = this.liveUniforms.uIntensity.value = level;
		this.guides.material.opacity = 0.035 * level;
		this._updateSubtitle( player, dt, level );
		this._updateLive();

		this.time += dt;
		if ( ! this.notes || this.notes.length === 0 ) {

			this.bars.geometry.instanceCount = this.flares.geometry.instanceCount = 0;
			this._flushParticles();
			this.partUniforms.uTime.value = this.time;
			this._fadeKeys( dt, true );
			return;

		}

		const pos = player.position;
		const lookahead = this.lookahead / this._speedFactor;			// s of file time on the plane
		const speed = this.height / ( lookahead * 1000 );		// plane metres per file ms
		const notes = this.notes;

		// first note that may still be visible: on >= pos - maxDur
		let lo = 0, hi = notes.length;
		const from = pos - this.maxDur;
		while ( lo < hi ) {

			const mid = ( lo + hi ) >> 1;
			if ( notes[ mid ].on < from ) lo = mid + 1; else hi = mid;

		}

		this.playing.fill( 0 );
		const rect = this.rect.array, info = this.info.array, flare = this.flare.array;
		let nb = 0, nf = 0;
		const horizon = pos + lookahead * 1000;
		const emit = this.particles && this.mode !== 'voice' && player.playing;
		const burstFrom = this.prevPos < pos && pos - this.prevPos < 250 ? this.prevPos : pos;
		for ( let i = lo; i < notes.length; ++ i ) {

			const n = notes[ i ];
			if ( n.on > horizon ) break;
			if ( n.off < pos ) continue;
			const y0 = Math.max( 0, ( n.on - pos ) * speed ), y1 = Math.min( this.height + 0.05, ( n.off - pos ) * speed );
			if ( y1 <= y0 ) continue;
			const sounding = player.playing && n.on <= pos;		// paused: frozen, nothing sounds
			if ( nb < MAX_BARS ) {

				rect[ nb * 4 ] = n.x - n.w / 2;
				rect[ nb * 4 + 1 ] = y0;
				rect[ nb * 4 + 2 ] = n.x + n.w / 2;
				rect[ nb * 4 + 3 ] = y1;
				info[ nb * 2 ] = n.vel;
				info[ nb * 2 + 1 ] = sounding ? 1 : 0;
				++ nb;

			}

			if ( sounding ) {

				this.playing[ n.pitch ] = Math.max( this.playing[ n.pitch ], 0.35 + 0.65 * n.vel );
				if ( nf < 128 ) {

					const fresh = Math.max( 0, 1 - ( pos - n.on ) / 400 );		// brighter right after the strike
					flare[ nf * 3 ] = n.x;
					flare[ nf * 3 + 1 ] = n.w / 2;
					flare[ nf * 3 + 2 ] = ( 0.55 + 0.45 * n.vel ) * ( 0.7 + 0.8 * fresh );
					++ nf;

				}

				if ( emit ) {

					// a burst on the strike, then a steady stream while it sounds
					let count = dt * ( 140 + 180 * n.vel );
					if ( n.on > burstFrom ) count += 30 + 50 * n.vel;
					this._spawn( n.x, n.w, count, 0.6 + 0.4 * n.vel );

				}

			}

		}

		this.prevPos = pos;
		this.rect.needsUpdate = this.info.needsUpdate = true;
		this.rect.clearUpdateRanges();
		this.info.clearUpdateRanges();
		this.rect.addUpdateRange( 0, nb * 4 );
		this.info.addUpdateRange( 0, nb * 2 );
		this.bars.geometry.instanceCount = nb;
		this.flare.needsUpdate = true;
		this.flare.clearUpdateRanges();
		this.flare.addUpdateRange( 0, nf * 3 );
		this.flares.geometry.instanceCount = nf;

		this._flushParticles();
		this.partUniforms.uTime.value = this.time;
		this.partUniforms.uScale.value = renderer.domElement.height / ( 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 ) );
		this._fadeKeys( dt, false );

	}

	// live bars: bottom pinned to the hit line while the key is held, then the bar rises at the
	// file notes' falling speed and leaves through the top
	_updateLive() {

		const speed = this.height / this.lookahead;		// m/s
		const t = this.liveTime, rect = this.liveRect.array, info = this.liveInfo.array;
		let n = 0, keep = 0;
		for ( const note of this.liveNotes ) {

			const y1 = ( t - note.on ) * speed;
			const y0 = note.off === null ? 0 : ( t - note.off ) * speed;
			if ( y0 > this.height + 0.05 ) continue;		// gone through the top
			this.liveNotes[ keep ++ ] = note;
			if ( y1 - y0 < 1e-4 ) continue;
			rect[ n * 4 ] = note.x - note.w / 2;
			rect[ n * 4 + 1 ] = y0;
			rect[ n * 4 + 2 ] = note.x + note.w / 2;
			rect[ n * 4 + 3 ] = Math.min( y1, this.height + 0.05 );
			info[ n * 2 ] = note.vel;
			info[ n * 2 + 1 ] = note.off === null ? 1 : 0;
			++ n;

		}

		this.liveNotes.length = keep;
		this.liveRect.needsUpdate = this.liveInfo.needsUpdate = true;
		this.liveRect.clearUpdateRanges();
		this.liveInfo.clearUpdateRanges();
		this.liveRect.addUpdateRange( 0, n * 4 );
		this.liveInfo.addUpdateRange( 0, n * 2 );
		this.liveBars.geometry.instanceCount = n;

	}

	_rand() {

		this.seed = ( this.seed * 16807 ) % 2147483647;
		return this.seed / 2147483647;

	}

	_spawn( x, w, count, strength ) {

		let n = Math.floor( count ) + ( this._rand() < count % 1 ? 1 : 0 );
		const pos = this.pPos.array, sp = this.pSpawn.array;
		while ( n -- > 0 ) {

			const i = this.pNext;
			pos[ i * 3 ] = x;					// key centre; the shader spreads the sparks
			pos[ i * 3 + 1 ] = w;
			sp[ i * 4 ] = this.time - this._rand() * 0.016;
			sp[ i * 4 + 1 ] = this._rand() * 100;
			sp[ i * 4 + 2 ] = this._rand() < 0.12 ? 1 : 0;
			sp[ i * 4 + 3 ] = strength;
			if ( this.pDirtyCount === 0 ) this.pDirtyFrom = i;
			++ this.pDirtyCount;
			this.pNext = ( i + 1 ) % MAX_PARTICLES;

		}

	}

	_flushParticles() {

		if ( ! this.pDirtyCount ) return;
		const from = this.pDirtyFrom, count = Math.min( this.pDirtyCount, MAX_PARTICLES );
		for ( const [ attr, k ] of [ [ this.pPos, 3 ], [ this.pSpawn, 4 ] ] ) {

			attr.clearUpdateRanges();
			const first = Math.min( count, MAX_PARTICLES - from );
			attr.addUpdateRange( from * k, first * k );
			if ( count > first ) attr.addUpdateRange( 0, ( count - first ) * k );
			attr.needsUpdate = true;

		}

		this.pDirtyCount = 0;

	}

	// key tint follows the sounding notes: quick attack, slower release
	_fadeKeys( dt, off ) {

		for ( const [ pitch, g ] of this.keyGlows ) {

			const target = off ? 0 : this.playing[ pitch ];
			let l = g.userData.level;
			if ( l === target ) continue;
			l += ( target - l ) * Math.min( 1, dt * ( target > l ? 30 : 7 ) );
			if ( Math.abs( target - l ) < 0.01 ) l = target;
			g.userData.level = l;
			g.material.opacity = l * 0.85 * this.intensity * this.powerLevel * ( this.bootT >= 0 ? 0 : 1 );
			g.visible = l > 0;

		}

	}

}

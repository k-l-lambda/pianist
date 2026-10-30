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

const MAX_BARS = 768;
const MAX_PARTICLES = 8192;
const PARTICLE_LIFE = 1.5;			// s
const WHITE_TOP = 0.0222, BLACK_TOP = 0.0345;	// key-mesh local heights of the key tops
const LIFT = 0.0025;				// roll plane offset towards the player (above the screen surface)

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
		// solid fill with a faint lighter edge; brighter while the note sounds
		float rim = smoothstep( - 0.0025, 0.0, d ) * core;
		float lit = 0.8 + 0.2 * vInfo.x + 0.3 * vInfo.y;
		vec3 col = uColor * core * lit * ( 1.0 + 0.12 * rim ) + uColor * glow * ( 0.38 + 0.4 * vInfo.y );
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
		float f = exp( - dot( vUv * vec2( 2.2, 2.6 ), vUv * vec2( 2.2, 2.6 ) ) );
		float core = exp( - dot( vUv * vec2( 4.0, 9.0 ), vUv * vec2( 4.0, 9.0 ) ) );
		vec3 col = mix( uColor, vec3( 1.0 ), 0.65 ) * core * 2.6 + uColor * f * 1.1;
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
		float size = kind > 0.5 ? 0.03 : mix( 0.0014, 0.003, h( s * 6.7 ) );
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
		vec3 col = vKind > 0.5 ? uColor * 0.7 : mix( mix( uColor, vec3( 1.0, 0.97, 0.92 ), 0.75 ), uColor, smoothstep( 0.15, 0.85, vAge ) ) * 3.0;
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
		this.color = new THREE.Color( '#1a5cff' );
		this.intensity = 1.0;

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
			this.barUniforms = { uColor: { value: this.color }, uGlow: { value: 0.012 }, uHeight: { value: 0.3 }, uIntensity: { value: 1 } };
			this.bars = new THREE.Mesh( geo, new THREE.ShaderMaterial( { vertexShader: BAR_VS, fragmentShader: BAR_FS, uniforms: this.barUniforms, ...common } ) );
			this.bars.frustumCulled = false;
			this.bars.renderOrder = 10;
			this.bars.userData.noAO = true;
			this.group.add( this.bars );

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

	setColor( c ) {

		this.color.set( c );
		for ( const g of this.keyGlows.values() ) g.material.color.copy( this.color );

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
		const active = show && this.enabled && this.notes && this.notes.length > 0 && this.piano;
		this.group.visible = !! active;
		if ( ! active ) {

			this._fadeKeys( dt, true );
			return;

		}

		this.time += dt;
		const pos = player.position;
		const speed = this.height / ( this.lookahead * 1000 );		// plane metres per file ms
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
		const horizon = pos + this.lookahead * 1000;
		const emit = this.particles && player.playing;
		const burstFrom = this.prevPos < pos && pos - this.prevPos < 250 ? this.prevPos : pos;
		for ( let i = lo; i < notes.length; ++ i ) {

			const n = notes[ i ];
			if ( n.on > horizon ) break;
			if ( n.off < pos ) continue;
			const y0 = Math.max( 0, ( n.on - pos ) * speed ), y1 = Math.min( this.height + 0.05, ( n.off - pos ) * speed );
			if ( y1 <= y0 ) continue;
			const sounding = n.on <= pos;
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
			g.material.opacity = l * 0.85 * this.intensity;
			g.visible = l > 0;

		}

	}

}

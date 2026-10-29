// Procedural PBR textures baked on the GPU into render targets.
// Every generator outputs { map, roughnessMap, normalMap } (and alphaMap for foliage).

import * as THREE from 'three';

const NOISE_GLSL = /* glsl */`
	// tileable value noise: lattice coordinates wrap at period
	float hash12( vec2 p ) {
		vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
		p3 += dot( p3, p3.yzx + 33.33 );
		return fract( ( p3.x + p3.y ) * p3.z );
	}

	float vnoise( vec2 p, vec2 period ) {
		vec2 i = floor( p );
		vec2 f = fract( p );
		vec2 u = f * f * ( 3.0 - 2.0 * f );
		float a = hash12( mod( i, period ) );
		float b = hash12( mod( i + vec2( 1.0, 0.0 ), period ) );
		float c = hash12( mod( i + vec2( 0.0, 1.0 ), period ) );
		float d = hash12( mod( i + vec2( 1.0, 1.0 ), period ) );
		return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
	}

	float fbm( vec2 p, vec2 period, int octaves ) {
		float sum = 0.0, amp = 0.5;
		for ( int i = 0; i < 8; ++ i ) {
			if ( i >= octaves ) break;
			sum += amp * vnoise( p, period );
			p *= 2.0; period *= 2.0; amp *= 0.5;
		}
		return sum;
	}
`;

// ---------------------------------------------------------------------------
// Wood: planks along v, grain along u. Texture covers `lengthMeters` along grain.
const WOOD_GLSL = /* glsl */`
	uniform vec3 colBase;
	uniform vec3 colDark;
	uniform vec3 colLate;
	uniform vec3 colGray;
	uniform float weathering;		// 0 = finished wood, 1 = raw weathered
	uniform float crackAmount;
	uniform float planks;			// number of planks across v
	uniform float ringScale;		// ring density
	uniform float roughBase;
	uniform float seed;

	struct WoodSample { vec3 albedo; float rough; float height; };

	WoodSample wood( vec2 uv ) {
		WoodSample s;
		const float TAU = 6.2831853;
		// Tile: u along the grain (~1.5 m), v across (~0.75 m) split into edge-glued boards.
		// All noise periods are integers in tile units, so the texture wraps in both axes.

		float pv = uv.y * planks;
		float plank = floor( pv );
		float pf = fract( pv );
		float pr = hash12( vec2( plank, seed ) );
		float pr2 = hash12( vec2( plank + 17.0, seed + 3.0 ) );

		// grain meander: the fibres wander a few degrees either side instead of running
		// parallel to the texture axis; q is the across-grain coordinate that follows them
		float meander = 0.10 * sin( TAU * ( uv.x + pr ) ) + 0.05 * sin( TAU * ( 2.0 * uv.x + pr2 ) )
			+ 0.25 * ( fbm( vec2( uv.x * 3.0, plank * 7.13 ), vec2( 3.0, 100000.0 ), 4 ) - 0.5 );
		float q = pf + meander;
		float qp = q + plank * 3.17;		// decorrelate boards

		// growth rings of a flat-sawn board: contours of the distance to the pith; where the
		// cut dips towards the pith they close into cathedral arcs
		float c = 0.3 + 0.4 * pr2;
		float arc = 0.12 * ( 0.5 - 0.5 * cos( TAU * ( uv.x + pr * 0.7 ) ) );
		float dist = sqrt( ( q - c ) * ( q - c ) + arc * arc );
		float warp = fbm( vec2( uv.x * 4.0, pv * 2.0 ), vec2( 4.0, planks * 2.0 ), 4 );
		float ring = dist * ringScale + warp * 1.5;
		ring += ( vnoise( vec2( uv.x * 24.0, qp * 30.0 ), vec2( 24.0, 100000.0 ) ) - 0.5 ) * 0.6;

		// knots
		float knot = 0.0;
		for ( int k = 0; k < 2; ++ k ) {
			float kr = hash12( vec2( plank * 3.0 + float( k ), seed + 11.0 ) );
			if ( kr > 0.6 ) {
				vec2 kc = vec2( hash12( vec2( plank, float( k ) + seed ) ), 0.2 + 0.6 * hash12( vec2( float( k ), plank + seed ) ) );
				vec2 d = vec2( ( fract( uv.x - kc.x + 0.5 ) - 0.5 ) * 1.5, ( pf - kc.y ) * 0.25 );
				float r = length( d * vec2( 0.6, 1.0 ) );
				knot = max( knot, smoothstep( 0.012, 0.004, r ) );
				ring += 4.0 * exp( - r / 0.02 );
			}
		}

		// latewood bands, each ring with its own strength so they don't read as even stripes
		float rf = fract( ring );
		float band = smoothstep( 0.35, 0.85, rf ) * ( 1.0 - smoothstep( 0.9, 1.0, rf ) );
		float late = band * ( 0.35 + 0.65 * hash12( vec2( floor( ring ), plank + seed ) ) );

		// non-directional variation: broad blotches (~25 cm) and smaller clouds (~6 cm)
		float mottle = fbm( vec2( uv.x * 6.0, uv.y * 3.0 ), vec2( 6.0, 3.0 ), 5 );
		float mottle2 = fbm( vec2( uv.x * 24.0, uv.y * 12.0 ), vec2( 24.0, 12.0 ), 3 );

		// fibres and open pores, following the meandering grain
		float fiber = fbm( vec2( uv.x * 30.0, qp * 50.0 ), vec2( 30.0, 100000.0 ), 3 );
		float pores = smoothstep( 0.62, 0.8, vnoise( vec2( uv.x * 400.0, qp * 350.0 ), vec2( 400.0, 100000.0 ) ) ) * ( 1.0 - late );

		// checks along the grain, only in some areas
		float crackLine = abs( fbm( vec2( uv.x * 8.0, qp * 12.0 ), vec2( 8.0, 100000.0 ), 4 ) - 0.5 );
		float crackGate = smoothstep( 0.62, 0.75, fbm( vec2( uv.x * 2.0, uv.y * 2.0 + 4.0 ), vec2( 2.0, 2.0 ), 3 ) );
		float crack = smoothstep( 0.010, 0.0, crackLine ) * crackGate * crackAmount;

		// faint glue line between boards
		float seam = smoothstep( 0.006, 0.0, min( pf, 1.0 - pf ) ) * step( 1.5, planks );

		vec3 col = mix( colBase, colDark, clamp( 0.25 + ( fiber - 0.5 ) * 0.4 + ( mottle - 0.5 ) * 0.8 + ( pr - 0.5 ) * 0.25, 0.0, 1.0 ) );
		col = mix( col, colLate, late * mix( 0.4, 0.2, weathering ) );
		col *= 0.95 + 0.1 * mottle2;
		col = mix( col, colLate * 0.7, pores * 0.5 );
		// weathering patina, patchy rather than striped
		col = mix( col, colGray, weathering * ( 0.25 + 0.35 * mottle ) * ( 1.0 - 0.6 * late ) );
		col = mix( col, colLate * 0.55, knot * 0.8 );
		col = mix( col, colLate * 0.35, max( crack, seam * 0.4 ) );
		col *= 0.95 + 0.1 * pr2;
		s.albedo = col;

		s.rough = clamp( roughBase + 0.1 * ( mottle - 0.5 ) + 0.08 * fiber + weathering * 0.12 * ( 1.0 - late ) + crack * 0.3, 0.05, 1.0 );

		// height: brushed earlywood slightly lower, pores and checks recessed
		float h = 0.5;
		h += weathering * ( late * 0.08 - 0.02 * ( 1.0 - late ) );
		h += ( fiber - 0.5 ) * 0.03 + ( mottle2 - 0.5 ) * 0.06;
		h -= pores * 0.04 + crack * 0.8 + seam * 0.4;
		s.height = h;

		return s;
	}
`;

const FLOOR_GLSL = /* glsl */`
	uniform vec3 colBase;
	uniform vec3 colDark;
	uniform vec3 colLate;
	uniform float rows;
	uniform float seed;

	struct WoodSample { vec3 albedo; float rough; float height; };

	WoodSample wood( vec2 uv ) {
		WoodSample s;
		float rv = uv.y * rows;
		float row = floor( rv );
		float rf = fract( rv );
		float off = hash12( vec2( row, seed ) );
		float pu = uv.x * 2.0 + off;			// 2 boards per row per tile
		float board = floor( pu );
		float bf = fract( pu );
		float br = hash12( vec2( row * 7.0 + mod( board, 2.0 ), seed + 1.0 ) );

		float warp = fbm( vec2( pu * 3.0, rf + row ), vec2( 6.0, 1000.0 ), 4 );
		float ring = sqrt( pow( rf - 0.5 + br - 0.5, 2.0 ) * 3.0 + pow( warp * 1.4, 2.0 ) ) * 14.0;
		ring += fbm( vec2( pu * 40.0, rf * 5.0 + row ), vec2( 80.0, 1000.0 ), 3 ) * 0.5;
		float late = smoothstep( 0.6, 0.9, fract( ring ) );
		float fiber = fbm( vec2( pu * 25.0, rv * 60.0 ), vec2( 50.0, 1000.0 ), 4 );

		float seamV = smoothstep( 0.02, 0.0, min( rf, 1.0 - rf ) );
		float seamU = smoothstep( 0.004, 0.0, min( bf, 1.0 - bf ) );
		float seam = max( seamV, seamU );

		vec3 col = mix( colBase, colDark, fiber * 0.6 + ( br - 0.5 ) * 0.6 );
		col = mix( col, colLate, late * 0.5 );
		col = mix( col, colLate * 0.3, seam );
		s.albedo = col;

		float wear = fbm( uv * 6.0, vec2( 6.0 ), 4 );
		s.rough = clamp( 0.32 + 0.25 * wear + 0.1 * fiber + seam * 0.4, 0.05, 1.0 );
		s.height = 0.5 + late * 0.08 + ( fiber - 0.5 ) * 0.06 - seam * 0.6;
		return s;
	}
`;

const PLASTER_GLSL = /* glsl */`
	uniform vec3 colBase;
	uniform vec3 colStain;
	uniform float seed;

	struct WoodSample { vec3 albedo; float rough; float height; };

	WoodSample wood( vec2 uv ) {
		WoodSample s;
		float big = fbm( uv * 3.0 + seed, vec2( 3.0 ), 5 );
		float mid = fbm( uv * 24.0, vec2( 24.0 ), 4 );
		float fine = vnoise( uv * 400.0, vec2( 400.0 ) );
		float trowel = fbm( vec2( uv.x * 10.0 + mid * 1.5, uv.y * 6.0 ), vec2( 10.0, 6.0 ), 4 );

		vec3 col = mix( colBase, colStain, smoothstep( 0.4, 0.75, big ) * 0.6 );
		col *= 0.93 + 0.1 * mid + 0.04 * fine;
		s.albedo = col;
		s.rough = 0.82 + 0.1 * mid;
		s.height = 0.5 + 0.25 * smoothstep( 0.45, 0.6, trowel ) + 0.1 * mid + 0.05 * fine;
		return s;
	}
`;

// uniform-only "solid" material with subtle noise (for lacquer, felt, etc.)
const FELT_GLSL = /* glsl */`
	uniform vec3 colBase;
	uniform float seed;

	struct WoodSample { vec3 albedo; float rough; float height; };

	WoodSample wood( vec2 uv ) {
		WoodSample s;
		float fine = fbm( uv * 300.0, vec2( 300.0 ), 3 );
		float fuzz = vnoise( uv * 1200.0, vec2( 1200.0 ) );
		s.albedo = colBase * ( 0.85 + 0.25 * fine + 0.08 * fuzz );
		s.rough = 0.95;
		s.height = 0.5 + 0.3 * fine + 0.2 * fuzz;
		return s;
	}
`;

const FOLIAGE_GLSL = /* glsl */`
	uniform float seed;

	struct WoodSample { vec3 albedo; float rough; float height; };

	WoodSample wood( vec2 uv ) {
		WoodSample s;
		// canopy hanging from the top; individual leaves punch light holes into it
		float canopy = fbm( uv * vec2( 3.0, 2.0 ) + seed, vec2( 3.0, 2.0 ), 5 ) + smoothstep( 0.35, 1.0, uv.y ) * 0.35;
		float cluster = smoothstep( 0.55, 0.62, canopy );
		float leaves = smoothstep( 0.45, 0.55, fbm( uv * 70.0, vec2( 70.0 ), 3 ) );
		float a = cluster * leaves;

		float bx = uv.x + 0.06 * sin( uv.y * 7.0 + seed ) + 0.03 * fbm( uv * 8.0, vec2( 8.0 ), 3 );
		float branch = smoothstep( 0.006, 0.002, abs( fract( bx * 1.5 ) - 0.5 ) / 1.5 ) * smoothstep( 0.4, 0.7, uv.y );
		a = max( a, branch );

		s.albedo = vec3( a );
		s.rough = 1.0;
		s.height = a;
		return s;
	}
`;

function fragmentFor( body, pass ) {

	return /* glsl */`
		precision highp float;
		varying vec2 vUv;
		${ NOISE_GLSL }
		${ body }
		void main() {
			WoodSample s = wood( vUv );
			${ pass === 'albedo' ? 'gl_FragColor = vec4( s.albedo, 1.0 );' : '' }
			${ pass === 'rough' ? 'gl_FragColor = vec4( 1.0, s.rough, 0.0, 1.0 );' : '' }
			${ pass === 'height' ? 'gl_FragColor = vec4( s.height, 0.0, 0.0, 1.0 );' : '' }
		}
	`;

}

const VERTEX = /* glsl */`
	varying vec2 vUv;
	void main() {
		vUv = position.xy * 0.5 + 0.5;
		gl_Position = vec4( position.xy, 0.0, 1.0 );
	}
`;

const NORMAL_FRAG = /* glsl */`
	precision highp float;
	varying vec2 vUv;
	uniform sampler2D heightMap;
	uniform vec2 texel;
	uniform float strength;
	void main() {
		float hl = texture2D( heightMap, fract( vUv - vec2( texel.x, 0.0 ) ) ).r;
		float hr = texture2D( heightMap, fract( vUv + vec2( texel.x, 0.0 ) ) ).r;
		float hd = texture2D( heightMap, fract( vUv - vec2( 0.0, texel.y ) ) ).r;
		float hu = texture2D( heightMap, fract( vUv + vec2( 0.0, texel.y ) ) ).r;
		vec3 n = normalize( vec3( ( hl - hr ) * strength, ( hd - hu ) * strength, 1.0 ) );
		gl_FragColor = vec4( n * 0.5 + 0.5, 1.0 );
	}
`;

export class TextureBaker {

	constructor( renderer ) {

		this.renderer = renderer;
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, - 1, 0, 3, - 1, 0, - 1, 3, 0 ], 3 ) );
		this.quad = new THREE.Mesh( geo, null );
		this.quad.frustumCulled = false;
		this.scene.add( this.quad );
		this.cache = new Map();

	}

	_render( material, target ) {

		const r = this.renderer;
		const prevTarget = r.getRenderTarget();
		const prevTone = r.toneMapping;
		r.toneMapping = THREE.NoToneMapping;
		this.quad.material = material;
		r.setRenderTarget( target );
		r.render( this.scene, this.camera );
		r.setRenderTarget( prevTarget );
		r.toneMapping = prevTone;

	}

	_target( w, h, { srgb = false, type = THREE.UnsignedByteType, mip = true } = {} ) {

		const rt = new THREE.WebGLRenderTarget( w, h, {
			type,
			wrapS: THREE.RepeatWrapping,
			wrapT: THREE.RepeatWrapping,
			minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			generateMipmaps: mip,
			depthBuffer: false,
			colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
		} );
		rt.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
		return rt;

	}

	/**
	 * Bake a set of PBR maps from a GLSL `wood()` body.
	 * Colors in `uniforms` are given as sRGB hex and converted to linear here.
	 */
	bake( key, body, uniforms, { width = 2048, height = 1024, normalStrength = 4, tile = null } = {} ) {

		if ( this.cache.has( key ) ) return this.cache.get( key );

		const u = {};
		for ( const [ name, value ] of Object.entries( uniforms ) ) {

			u[ name ] = { value: typeof value === 'string' ? new THREE.Color( value ) : value };

		}

		const make = pass => new THREE.ShaderMaterial( {
			vertexShader: VERTEX,
			fragmentShader: fragmentFor( body, pass ),
			uniforms: u,
			depthTest: false,
			depthWrite: false,
		} );

		const albedoRT = this._target( width, height, { srgb: true } );
		const roughRT = this._target( width, height );
		const heightRT = this._target( width, height, { type: THREE.HalfFloatType, mip: false } );
		const normalRT = this._target( width, height );

		// ShaderMaterial outputs linear values; the sRGB target encodes on write.
		const mats = [ make( 'albedo' ), make( 'rough' ), make( 'height' ) ];
		this._render( mats[ 0 ], albedoRT );
		this._render( mats[ 1 ], roughRT );
		this._render( mats[ 2 ], heightRT );

		const normalMat = new THREE.ShaderMaterial( {
			vertexShader: VERTEX,
			fragmentShader: NORMAL_FRAG,
			uniforms: {
				heightMap: { value: heightRT.texture },
				texel: { value: new THREE.Vector2( 1 / width, 1 / height ) },
				strength: { value: normalStrength },
			},
			depthTest: false,
			depthWrite: false,
		} );
		this._render( normalMat, normalRT );

		mats.forEach( m => m.dispose() );
		normalMat.dispose();
		heightRT.dispose();

		const result = {
			map: albedoRT.texture,
			roughnessMap: roughRT.texture,
			normalMap: normalRT.texture,
		};
		// physical size of one tile (m): geometry UVs are in metres
		if ( tile ) for ( const t of Object.values( result ) ) t.repeat.set( 1 / tile[ 0 ], 1 / tile[ 1 ] );

		this.cache.set( key, result );
		return result;

	}

	/**
	 * Bake a single-pass scalar map from a complete fragment shader (reads `vUv`, writes the
	 * value to gl_FragColor.r). Clamped at the edges; arrays and vectors pass through as uniforms.
	 */
	bakeShader( key, fragmentShader, uniforms, { width = 1024, height = 1024 } = {} ) {

		if ( this.cache.has( key ) ) return this.cache.get( key );
		const u = {};
		for ( const [ name, value ] of Object.entries( uniforms ) ) u[ name ] = { value };
		const mat = new THREE.ShaderMaterial( { vertexShader: VERTEX, fragmentShader, uniforms: u, depthTest: false, depthWrite: false } );
		const rt = this._target( width, height );
		rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
		this._render( mat, rt );
		mat.dispose();
		this.cache.set( key, rt.texture );
		return rt.texture;

	}

	// ---- presets ----------------------------------------------------------

	weatheredOak() {

		return this.bake( 'weatheredOak', WOOD_GLSL, {
			colBase: '#6e5643', colDark: '#574332', colLate: '#3b2c21', colGray: '#7d6a58',
			weathering: 1.0, crackAmount: 1.0, planks: 3, ringScale: 22.0, roughBase: 0.62, seed: 1.7,
		}, { normalStrength: 2, tile: [ 1.5, 0.75 ] } );

	}

	walnut() {

		return this.bake( 'walnut', WOOD_GLSL, {
			colBase: '#6b4630', colDark: '#4a2f1f', colLate: '#2e1c12', colGray: '#6b4630',
			weathering: 0.0, crackAmount: 0.0, planks: 2, ringScale: 26.0, roughBase: 0.32, seed: 4.2,
		}, { normalStrength: 1.5, tile: [ 1.5, 0.75 ] } );

	}

	spruce() {

		return this.bake( 'spruce', WOOD_GLSL, {
			colBase: '#d9b98a', colDark: '#c9a472', colLate: '#a8804e', colGray: '#d9b98a',
			weathering: 0.0, crackAmount: 0.0, planks: 8, ringScale: 50.0, roughBase: 0.4, seed: 9.1,
		}, { normalStrength: 1.0, tile: [ 1.2, 0.6 ] } );

	}

	darkInterior() {

		return this.bake( 'darkInterior', WOOD_GLSL, {
			colBase: '#3a3129', colDark: '#2c251f', colLate: '#1d1814', colGray: '#3a3129',
			weathering: 0.3, crackAmount: 0.0, planks: 4, ringScale: 50.0, roughBase: 0.7, seed: 2.3,
		}, { width: 1024, height: 512, normalStrength: 2, tile: [ 1.5, 0.75 ] } );

	}

	floorOak() {

		return this.bake( 'floorOak', FLOOR_GLSL, {
			colBase: '#b08a62', colDark: '#8e6a47', colLate: '#6a4b30', rows: 8, seed: 3.3,
		}, { width: 2048, height: 2048, normalStrength: 3, tile: [ 2.4, 1.12 ] } );

	}

	plaster() {

		return this.bake( 'plaster', PLASTER_GLSL, {
			colBase: '#9aa39a', colStain: '#868f85', seed: 0.7,
		}, { width: 2048, height: 2048, normalStrength: 2.5, tile: [ 1.6, 1.6 ] } );

	}

	ceilingPlaster() {

		return this.bake( 'ceilingPlaster', PLASTER_GLSL, {
			colBase: '#d8d6d0', colStain: '#c9c6bf', seed: 5.1,
		}, { width: 1024, height: 1024, normalStrength: 1.5, tile: [ 1.6, 1.6 ] } );

	}

	felt( hex, key = hex ) {

		return this.bake( 'felt' + key, FELT_GLSL, { colBase: hex, seed: 1 }, { width: 512, height: 512, normalStrength: 3, tile: [ 0.5, 0.5 ] } );

	}

	foliage() {

		// albedo channel carries the alpha mask
		const t = this.bake( 'foliage', FOLIAGE_GLSL, { seed: 2.0 }, { width: 1024, height: 1024, normalStrength: 1 } );
		return { alphaMap: t.map };

	}

}

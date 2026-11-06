// Luminara's lightmaps, baked on the GPU (loaded only by tools/luminara-bake.mjs, in the page): the
// static shell's diffuse light (walls, ceiling, lacquer, floor, rug) for one lighting preset, by ray
// tracing through the whole scene (three-mesh-bvh: shell, furniture, ornaments, the piano).
//
//   texel G-buffer   the shell drawn in its lightmap UVs (uvBake, tools/luminara-unwrap.py's): each
//                    texel's world position and normal; the side it is seen from found by rays (the
//                    room's surfaces are not wound one way)
//   direct           spots (the dome's, the Recital's: as three lights them) and the line
//                    lights (the sconces' frosted tubes, the shelves' strips: src/luminara.js's
//                    segments), and the sun or the moon (through the windows), each sample with a shadow
//                    ray. The spots and the sun stay real-time (their direct light not stored, only their
//                    bounce); the line lights' is stored (soft shadows)
//   gather × 4       cosine-weighted rays from each texel: what they hit sends back its emission (the
//                    coves, the dome, the lines of light, the niches, the neon, the shades), the sky
//                    (the windows: the sky by direction, its photo as drawn) and its albedo
//                    × the light on it (the previous bounce's map; off the shell: the room's mean)
//   denoise, dilate  an edge-aware à-trous blur within each chart, the charts' borders run on
//
// The map: irradiance (the diffuse BRDF's input, as three's lightMap), linear, stored sRGB-encoded in 8
// bits under a scale (its 99.8th percentile). Runtime: src/luminara.js (the diffuse light on these
// surfaces from it, the probe's left to their specular).

import * as THREE from 'three';
import { MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture, BVHShaderGLSL } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const SAMPLES = { orient: 48, direct: 40, gather: [ 1536, 640, 384, 256 ] };		// (more at the first bounce: its noise, smoothed within each chart, showed as seams between them)		// per texel
const ALBEDO_SCALE = 0.95;		// (a map's mean below its material's colour)
const TILE = 512;		// texels a side drawn at once (a whole 2048 map's heavier passes in one draw: the GPU reset, the context lost)

const b64 = a => { const u = new Uint8Array( a.buffer, a.byteOffset, a.byteLength ); let s = ''; for ( let i = 0; i < u.length; i += 0x8000 ) s += String.fromCharCode.apply( null, u.subarray( i, i + 0x8000 ) ); return btoa( s ); };
const unb64 = ( s, T ) => { const b = atob( s ), u = new Uint8Array( b.length ); for ( let i = 0; i < b.length; ++ i ) u[ i ] = b.charCodeAt( i ); return new T( u.buffer ); };

/** The static shell's meshes, as tools/luminara-unwrap.py takes them (world space, triangles). */
export function exportShell( lum ) {

	lum.group.updateMatrixWorld( true );
	return lum.bakeTargets().map( ( m, i ) => {

		const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
		g.applyMatrix4( m.matrixWorld );
		if ( ! g.attributes.normal ) g.computeVertexNormals();
		if ( ! g.attributes.uv ) g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( g.attributes.position.count * 2 ), 2 ) );
		return { i, name: m.name, position: b64( g.attributes.position.array ), normal: b64( g.attributes.normal.array ), uv: b64( g.attributes.uv.array ) };

	} );

}

/** Put tools/luminara-unwrap.py's meshes (welded, with uvBake) in place of the shell's. */
export function applyShell( lum, meshes ) {

	const T = lum.bakeTargets();
	for ( const s of meshes ) {

		const m = T[ s.i ], g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( unb64( s.position, Float32Array ), 3 ) );
		g.setAttribute( 'normal', new THREE.BufferAttribute( unb64( s.normal, Float32Array ), 3 ) );
		g.setAttribute( 'uv', new THREE.BufferAttribute( unb64( s.uv, Float32Array ), 2 ) );
		g.setAttribute( 'uvBake', new THREE.BufferAttribute( unb64( s.uvBake, Float32Array ), 2 ) );
		g.setIndex( new THREE.BufferAttribute( unb64( s.index, Uint32Array ), 1 ) );
		m.geometry.dispose();
		m.geometry = g;
		m.matrixAutoUpdate = false; m.matrix.identity(); m.matrixWorld.identity();		// (its positions: world)

	}

}

// ---- shaders ----
const HEADER = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D; precision highp usampler2D;
${ BVHShaderGLSL.common_functions }
${ BVHShaderGLSL.bvh_struct_definitions }
${ BVHShaderGLSL.bvh_ray_functions }
uniform BVH bvh;
uniform sampler2D vAlbedo, vEmit, vBake;		// per vertex: albedo; emission (rgb) and its source (a); uvBake (xy) and baked (z)
uniform sampler2D gPos, gNor;					// the texel G-buffer (gNor: oriented, a: valid)
uniform float seed;
in vec2 vUv;
uint rs;
uint pcg() { rs = rs * 747796405u + 2891336453u; uint w = ( ( rs >> ( ( rs >> 28u ) + 4u ) ) ^ rs ) * 277803737u; return ( w >> 22u ) ^ w; }
float rnd() { return float( pcg() ) / 4294967296.0; }
void seedRng() { uvec2 p = uvec2( gl_FragCoord.xy ); rs = p.x * 1973u + p.y * 9277u + uint( seed ) * 26699u; pcg(); }
vec3 cosineDir( vec3 n ) {
	float a = 6.2831853 * rnd(), r = sqrt( rnd() );
	vec3 t = normalize( abs( n.y ) < 0.9 ? cross( n, vec3( 0, 1, 0 ) ) : cross( n, vec3( 1, 0, 0 ) ) ), b = cross( n, t );
	return normalize( t * ( r * cos( a ) ) + b * ( r * sin( a ) ) + n * sqrt( max( 0.0, 1.0 - r * r ) ) );
}
// the first hit: its face's vertices, barycentre, distance
bool trace( vec3 o, vec3 d, out uvec4 fi, out vec3 bc, out float dist ) {
	vec3 fn; float side;
	return bvhIntersectFirstHit( bvh, o, d, fi, fn, bc, side, dist );
}
bool occluded( vec3 o, vec3 d, float maxDist ) {
	uvec4 fi; vec3 bc; float dist;
	return trace( o, d, fi, bc, dist ) && dist < maxDist;
}
`;
const VERT = /* glsl */`out vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/** A float target of the map's size. */
const target = ( n, count = 1 ) => new THREE.WebGLRenderTarget( n, n, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, count } );

export class LuminaraBaker {

	/** `lum`: the venue (its shell applied: applyShell), `size`: the map's. */
	constructor( renderer, scene, lum, size ) {

		this.renderer = renderer; this.scene = scene; this.lum = lum; this.size = size;
		this.quad = new FullScreenQuad( null );
		// the passes add into float targets: blending them needs EXT_float_blend (else WebGL drops the draws)
		if ( ! renderer.getContext().getExtension( 'EXT_float_blend' ) ) throw new Error( 'EXT_float_blend: not supported (the bake adds into float targets)' );

	}

	/** The scene's geometry for the rays, with each vertex's albedo, emission's source and uvBake. */
	_buildBVH() {

		const L = this.lum, M = L.materials, targets = new Set( L.bakeTargets() ), parts = [], sources = [];
		const sourceOf = mat => { let i = sources.indexOf( mat ); if ( i < 0 ) { i = sources.length; sources.push( mat ); } return i + 1; };
		const albedoOf = mat => {

			const c = mat.color ? mat.color.clone() : new THREE.Color( 0.5, 0.5, 0.5 );
			if ( mat.metalness > 0.5 ) c.multiplyScalar( 0.25 );		// (a metal's diffuse: none; its reflection a little)
			if ( mat.map ) c.multiplyScalar( ALBEDO_SCALE );
			if ( mat === M.floor ) c.copy( new THREE.Color( '#e3e0da' ) );
			if ( mat === M.rug ) c.copy( new THREE.Color( '#e6dccb' ) );
			return c;

		};
		this.scene.updateMatrixWorld( true );
		this.scene.traverse( o => {

			if ( ! o.isMesh || o.isInstancedMesh ) return;
			for ( let p = o; p; p = p.parent ) if ( ! p.visible ) return;
			const mat = Array.isArray( o.material ) ? o.material[ 0 ] : o.material;
			if ( ! mat || mat.blending === THREE.AdditiveBlending || o === L.sky || mat.isMeshBasicMaterial || ( mat.transparent && mat.opacity < 0.5 ) || mat.userData?.clear ) return;		// (clear things: not occluders)
			const g0 = o.geometry, n = g0.index ? g0.index.count : g0.attributes.position.count;
			if ( ! n ) return;
			const g = g0.index ? g0.toNonIndexed() : g0.clone();
			for ( const k of Object.keys( g.attributes ) ) if ( ! [ 'position', 'color', 'uv', 'uvBake' ].includes( k ) ) g.deleteAttribute( k );
			{		// (world positions, as floats: the pack's are normalised integers)

				const src = g.attributes.position, P = new Float32Array( src.count * 3 ), v = new THREE.Vector3();
				for ( let i = 0; i < src.count; ++ i ) { v.fromBufferAttribute( src, i ).applyMatrix4( o.matrixWorld ); P[ 3 * i ] = v.x; P[ 3 * i + 1 ] = v.y; P[ 3 * i + 2 ] = v.z; }
				g.setAttribute( 'position', new THREE.BufferAttribute( P, 3 ) );

			}
			const cnt = g.attributes.position.count, alb = new Float32Array( cnt * 4 ), emi = new Float32Array( cnt * 4 ), bk = new Float32Array( cnt * 4 );
			const a = albedoOf( mat ), vc = mat.vertexColors && g.attributes.color, uv = g.attributes.uv;
			const emissive = !! mat.emissive && mat !== M.sconce && mat !== M.shelfLed && mat !== M.stepLed;		// (each a source, its colour per preset: emit(); the line lights: sampled directly)
			const src = emissive ? sourceOf( mat ) : 0, grad = mat.emissiveMap?.image?.data, gh = mat.emissiveMap?.image?.height;
			const baked = targets.has( o ), ub = g.attributes.uvBake;
			for ( let i = 0; i < cnt; ++ i ) {

				const k = 4 * i;
				alb[ k ] = a.r * ( vc ? vc.getX( i ) : 1 ); alb[ k + 1 ] = a.g * ( vc ? vc.getY( i ) : 1 ); alb[ k + 2 ] = a.b * ( vc ? vc.getZ( i ) : 1 ); alb[ k + 3 ] = 1;
				// emission: its source's (per preset: emit()) × its gradient map at its v (the coves', the dome's)
				let f = 1;
				if ( src && grad && uv && mat.emissiveMap.image.width === 1 ) f = grad[ 4 * Math.min( gh - 1, Math.max( 0, Math.round( uv.getY( i ) * ( gh - 1 ) ) ) ) ] / 255;
				else if ( src && mat.emissiveMap ) f = 0.6;		// (a mask: about its mean over its lit part)
				emi[ k ] = f; emi[ k + 3 ] = src;
				if ( baked && ub ) { bk[ k ] = ub.getX( i ); bk[ k + 1 ] = ub.getY( i ); bk[ k + 2 ] = 1; }

			}
			const out = new THREE.BufferGeometry();
			out.setAttribute( 'position', g.attributes.position );
			out.setAttribute( 'albedo', new THREE.BufferAttribute( alb, 4 ) );
			out.setAttribute( 'emit', new THREE.BufferAttribute( emi, 4 ) );
			out.setAttribute( 'bake', new THREE.BufferAttribute( bk, 4 ) );
			parts.push( out );

		} );
		// merged (one buffer: the BVH's)
		let total = 0;
		for ( const p of parts ) total += p.attributes.position.count;
		const P = new Float32Array( total * 3 ), A = new Float32Array( total * 4 ), E = new Float32Array( total * 4 ), B = new Float32Array( total * 4 );
		let o = 0;
		for ( const p of parts ) { P.set( p.attributes.position.array, 3 * o ); A.set( p.attributes.albedo.array, 4 * o ); E.set( p.attributes.emit.array, 4 * o ); B.set( p.attributes.bake.array, 4 * o ); o += p.attributes.position.count; }
		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.BufferAttribute( P, 3 ) );
		geo.setIndex( new THREE.BufferAttribute( Uint32Array.from( { length: total }, ( _, i ) => i ), 1 ) );
		const bvh = new MeshBVH( geo, { maxLeafSize: 4, strategy: 2 /* SAH */ } );
		this.bvh = new MeshBVHUniformStruct(); this.bvh.updateFrom( bvh );
		const tex = ( arr ) => { const t = new FloatVertexAttributeTexture(); t.updateFrom( new THREE.BufferAttribute( arr, 4 ) ); return t; };
		this.vAlbedo = tex( A ); this.vEmitBase = E; this.vEmit = tex( E ); this.vBake = tex( B );
		this.sources = sources;
		this.triangles = total / 3;

	}

	/** The texel G-buffer: position, normal (raw), drawn in uvBake. */
	_gbuffer() {

		const n = this.size, rt = target( n, 2 ), sc = new THREE.Scene(), cam = new THREE.OrthographicCamera();
		const mat = new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
			vertexShader: `precision highp float; in vec3 position; in vec3 normal; in vec2 uvBake; out vec3 wp; out vec3 wn; void main() { wp = position; wn = normal; gl_Position = vec4( uvBake * 2.0 - 1.0, 0.0, 1.0 ); }`,
			fragmentShader: `precision highp float; in vec3 wp; in vec3 wn; layout( location = 0 ) out vec4 oPos; layout( location = 1 ) out vec4 oNor; void main() { oPos = vec4( wp, 1.0 ); oNor = vec4( normalize( wn ), 1.0 ); }`,
		} );
		for ( const m of this.lum.bakeTargets() ) { const q = new THREE.Mesh( m.geometry, mat ); q.frustumCulled = false; sc.add( q ); }
		const r = this.renderer;
		r.setRenderTarget( rt ); r.setClearColor( 0x000000, 0 ); r.clear(); r.render( sc, cam ); r.setRenderTarget( null );
		this.gPos = rt.textures[ 0 ]; this.gRaw = rt.textures[ 1 ]; this._gRT = rt;

	}

	/** Draw `mat` into `out` (cleared first if `clear`) in tiles, syncing now and then (the GPU done, the page alive). */
	async _draw( mat, out, clear ) {

		const r = this.renderer, n = this.size, gl = r.getContext();
		out.scissorTest = false; out.viewport.set( 0, 0, n, n );
		r.setRenderTarget( out ); r.setClearColor( 0x000000, 0 ); if ( clear ) r.clear();
		this.quad.material = mat;
		out.scissorTest = true;
		let k = 0;
		for ( let y = 0; y < n; y += TILE ) for ( let x = 0; x < n; x += TILE ) {

			out.scissor.set( x, y, Math.min( TILE, n - x ), Math.min( TILE, n - y ) );
			r.setRenderTarget( out );
			this.quad.render( r );
			if ( ++ k % 2 === 0 ) { r.readRenderTargetPixels( out, x, y, 1, 1, new Float32Array( 4 ) ); await new Promise( q => setTimeout( q, 0 ) ); }

		}
		out.scissorTest = false;
		r.setRenderTarget( null );
		if ( gl.isContextLost() ) throw new Error( 'the WebGL context was lost (a draw ran too long?)' );

	}

	/** A float target from the pool (reused: at 2048 each is 64 MB), by name. */
	_scratch( name ) { return ( this._pool ??= {} )[ name ] ??= target( this.size ); }

	_pass( fragment, uniforms, out, { blend = false } = {} ) {

		const mat = new THREE.ShaderMaterial( {
			glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: HEADER + fragment, depthTest: false, depthWrite: false,
			uniforms: { bvh: { value: this.bvh }, vAlbedo: { value: this.vAlbedo }, vEmit: { value: this.vEmit }, vBake: { value: this.vBake }, gPos: { value: this.gPos }, gNor: { value: this.gNor ?? this.gRaw }, seed: { value: 0 }, ...uniforms },
			...( blend ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } : { blending: THREE.NoBlending } ),
		} );
		mat.defines = { ...( mat.defines ?? {} ) };
		return {
			mat,
			run: async ( passes = 1, clear = true ) => {

				for ( let i = 0; i < passes; ++ i ) {

					mat.uniforms.seed.value = ( this._seed = ( this._seed ?? 1 ) + 1 );
					await this._draw( mat, out, clear && i === 0 );

				}

			},
		};

	}

	/**
	 * Which side of each texel is seen: the one whose rays go furthest before they meet something (the
	 * room: metres; the inside of a closed solid, a pilaster, a table's drum: centimetres; the void
	 * behind a wall: nothing, they escape and count 0). Neither side seeing more than a few cm: hidden
	 * (inside another solid): not valid (its neighbours run on into it).
	 */
	async _orient() {

		const rt = target( this.size );
		const p = this._pass( /* glsl */`
			out vec4 o;
			void main() {
				seedRng();
				vec4 P = texture( gPos, vUv ), N = texture( gNor, vUv );
				if ( P.a < 0.5 ) { o = vec4( 0 ); return; }
				float score[ 2 ];
				for ( int s = 0; s < 2; ++ s ) {
					vec3 n = s == 0 ? N.xyz : - N.xyz; float c = 0.0;
					for ( int i = 0; i < ${ SAMPLES.orient }; ++ i ) {
						uvec4 fi; vec3 bc; float d;
						if ( trace( P.xyz + n * 0.003, cosineDir( n ), fi, bc, d ) ) c += min( d, 4.0 );
					}
					score[ s ] = c / float( ${ SAMPLES.orient } );
				}
				vec3 n = score[ 0 ] >= score[ 1 ] ? N.xyz : - N.xyz;
				o = vec4( n, max( score[ 0 ], score[ 1 ] ) > 0.03 ? 1.0 : 0.0 );
			}`, { gNor: { value: this.gRaw } }, rt );
		await p.run();
		this.gNor = rt.texture; this._nRT = rt;

	}

	/** Each source's emission (linear, ×intensity) for the preset now set on the venue: the emission texture's rgb. */
	_emit() {

		const gain = this.lum.light.bakeInterior ?? 1;		// (the room's own light in the bake: lower, the windows' stands out)
		const E = this.vEmitBase.slice(), cols = this.sources.map( m => m.emissive.clone().multiplyScalar( m.emissiveIntensity * gain ) );
		for ( let i = 0; i < E.length; i += 4 ) {

			const s = E[ i + 3 ];
			if ( ! s ) { E[ i ] = 0; continue; }
			const c = cols[ s - 1 ], f = E[ i ];
			E[ i ] = c.r * f; E[ i + 1 ] = c.g * f; E[ i + 2 ] = c.b * f;

		}
		this.vEmit.updateFrom( new THREE.BufferAttribute( E, 4 ) );

	}

	/**
	 * Bake the preset now set on the venue (its lights and materials updated). Resolves to { data:
	 * Uint8Array (rgb, the row at v 0 first: as three samples a glTF image), scale, stats }.
	 */
	async bake() {

		const wasAutoClear = this.renderer.autoClear;
		this.renderer.autoClear = false;		// (each draw adds into the target: three's own clear at each render would leave only the last)
		try { return await this._bake(); } finally { this.renderer.autoClear = wasAutoClear; }

	}

	async _bake() {

		if ( ! this.bvh ) { this._buildBVH(); this._gbuffer(); await this._orient(); }
		this._emit();
		const n = this.size, L = this.lum, MAXS = 24;
		// the direct light's sources: spots (as three's: decay 2, range windowed, the cone's smoothstep) and sconces
		const spots = [ ...L.domeSpots, L.topSpot ].filter( s => s.visible && s.intensity > 0 );
		const sp = { pos: [], dir: [], col: [], cone: [], range: [] };
		for ( const s of spots.slice( 0, MAXS ) ) {

			s.updateMatrixWorld(); s.target.updateMatrixWorld();
			const p = new THREE.Vector3().setFromMatrixPosition( s.matrixWorld ), t = new THREE.Vector3().setFromMatrixPosition( s.target.matrixWorld );
			sp.pos.push( p ); sp.dir.push( t.sub( p ).normalize() ); sp.col.push( s.color.clone().multiplyScalar( s.intensity * ( L.light.bakeInterior ?? 1 ) ) );
			sp.cone.push( new THREE.Vector2( Math.cos( s.angle ), Math.cos( s.angle * ( 1 - s.penumbra ) ) ) ); sp.range.push( s.distance );

		}
		// the sun (Blue hour) or the moon (night) through the windows: a directional light, its bounce only (its
		// direct light real-time, as the spots'); at its full strength (outside: not under bakeInterior), the
		// moon at its clear-sky light; the disc jittered over its half a degree
		const sun = L.sun, sunOn = sun.visible && ( sun.userData.intensity ?? sun.intensity ) > 0;
		const sunDir = sun.position.clone().normalize(), sunCol = sunOn ? sun.color.clone().multiplyScalar( sun.userData.intensity ?? sun.intensity ) : new THREE.Color( 0 );
		while ( sp.pos.length < MAXS ) { sp.pos.push( new THREE.Vector3() ); sp.dir.push( new THREE.Vector3( 0, - 1, 0 ) ); sp.col.push( new THREE.Color( 0 ) ); sp.cone.push( new THREE.Vector2( 1, 1 ) ); sp.range.push( 0 ); }
		// the line lights (the sconces' tubes, the shelves' strips: src/luminara.js's segments, their intensity per metre as drawn)
		const G = L.lineLights, gain = L.light.bakeInterior ?? 1, NS = G.length;		// (all of them: the sideboard's strip too)
		const U = { uSegA: { value: G.map( g => g.a ) }, uSegB: { value: G.map( g => g.b ) }, uSegCol: { value: G.map( g => g.col.clone().multiplyScalar( gain ) ) },
			uSegN: { value: G.map( g => g.n ? new THREE.Vector4( g.n.x, g.n.y, g.n.z, 1 ) : new THREE.Vector4( 0, 0, 0, 0 ) ) } };
		const direct = target( n, 2 );		// [ 0 ]: all direct (the bounce's source), [ 1 ]: the line lights' (stored)
		const dp = this._pass( /* glsl */`
			uniform vec3 spPos[ ${ MAXS } ], spDir[ ${ MAXS } ], spCol[ ${ MAXS } ]; uniform vec2 spCone[ ${ MAXS } ]; uniform float spRange[ ${ MAXS } ];
			uniform vec3 sgA[ ${ NS } ], sgB[ ${ NS } ], sgCol[ ${ NS } ]; uniform vec4 sgN[ ${ NS } ]; uniform float spp; uniform vec3 sunDir, sunCol;
			layout( location = 0 ) out vec4 oAll; layout( location = 1 ) out vec4 oSconce;
			void main() {
				seedRng();
				vec4 P = texture( gPos, vUv ), N = texture( gNor, vUv );
				if ( N.a < 0.5 ) { oAll = oSconce = vec4( 0 ); return; }
				vec3 x = P.xyz + N.xyz * 0.004, Es = vec3( 0 ), Ed = vec3( 0 );
				// the spots: one shadow ray each, the source jittered (a few cm: their lenses)
				for ( int i = 0; i < ${ MAXS }; ++ i ) {
					if ( spCol[ i ].r + spCol[ i ].g + spCol[ i ].b <= 0.0 ) continue;
					vec3 lp = spPos[ i ] + 0.03 * ( vec3( rnd(), rnd(), rnd() ) - 0.5 ), l = lp - x; float d = length( l ); l /= d;
					float c = dot( N.xyz, l ); if ( c <= 0.0 ) continue;
					float sa = smoothstep( spCone[ i ].x, spCone[ i ].y, dot( - l, spDir[ i ] ) ); if ( sa <= 0.0 ) continue;
					float w = spRange[ i ] > 0.0 ? pow( clamp( 1.0 - pow( d / spRange[ i ], 4.0 ), 0.0, 1.0 ), 2.0 ) : 1.0;
					if ( ! occluded( x, l, d - 0.02 ) ) Ed += spCol[ i ] * sa * w * c / ( d * d );
				}
				// the sun: one shadow ray towards it (out through a window, else the shell stops it)
				if ( sunCol.r + sunCol.g + sunCol.b > 0.0 ) {
					vec3 l = normalize( sunDir + 0.0045 * ( vec3( rnd(), rnd(), rnd() ) - 0.5 ) );
					float c = dot( N.xyz, l );
					if ( c > 0.0 && ! occluded( x, l, 60.0 ) ) Ed += sunCol * c;
				}
				// the line lights: a point along each (a tube's: on its side towards x; a strip's: its face), one
				// shadow ray (stopping short of the emitter's own glass or box); intensity per metre × cosines / d² × its length
				for ( int i = 0; i < ${ NS }; ++ i ) {
					vec3 a = sgA[ i ], ax = sgB[ i ] - a; float h = length( ax ); vec3 u = ax / h;
					vec3 p = a + u * ( rnd() * h ), toX = x - p, f = toX - u * dot( toX, u );
					p += sgN[ i ].w > 0.5 ? sgN[ i ].xyz * 0.005 : normalize( f ) * 0.031;
					vec3 l = p - x; float d = length( l ); l /= d;
					float cr = dot( N.xyz, l ), ce = sgN[ i ].w > 0.5 ? dot( sgN[ i ].xyz, - l ) : 1.0;
					if ( cr <= 0.0 || ce <= 0.0 ) continue;
					if ( ! occluded( x, l, d - 0.01 ) ) Es += sgCol[ i ] * cr * ce / ( d * d ) * h;
				}
				oAll = vec4( ( Ed + Es ) / spp, 1.0 ); oSconce = vec4( Es / spp, 1.0 );
			}`, { spPos: { value: sp.pos }, spDir: { value: sp.dir }, spCol: { value: sp.col }, spCone: { value: sp.cone }, spRange: { value: sp.range }, sgA: { value: U.uSegA.value }, sgB: { value: U.uSegB.value }, sgCol: { value: U.uSegCol.value }, sgN: { value: U.uSegN.value }, spp: { value: SAMPLES.direct }, sunDir: { value: sunDir }, sunCol: { value: sunCol } }, direct, { blend: true } );
		await dp.run( SAMPLES.direct );
		// the sky: as drawn (src/luminara.js's cylinder and its map's transform)
		const sky = L.materials.sky, skyMap = sky.map, cyl = L.sky.geometry.parameters;
		L.sky.geometry.computeBoundingBox();
		const yb = L.sky.geometry.boundingBox.min.y, yt = L.sky.geometry.boundingBox.max.y;
		skyMap?.updateMatrix();
		const gather = ( first ) => this._pass( /* glsl */`
			uniform sampler2D prev; uniform vec3 mean, skyCol; uniform sampler2D skyMap; uniform mat3 skyUv; uniform float skyR, skyY0, skyH, skyEye, hasSky, spp, first;
			out vec4 o;
			void main() {
				seedRng();
				vec4 P = texture( gPos, vUv ), N = texture( gNor, vUv );
				if ( N.a < 0.5 ) { o = vec4( 0 ); return; }
				vec3 x = P.xyz + N.xyz * 0.004, L = vec3( 0 );
				for ( int i = 0; i < 8; ++ i ) {
					vec3 d = cosineDir( N.xyz ); uvec4 fi; vec3 bc; float t;
					if ( trace( x, d, fi, bc, t ) ) {
						vec3 alb = textureSampleBarycoord( vAlbedo, bc, fi.xyz ).rgb;
						vec4 bk = textureSampleBarycoord( vBake, bc, fi.xyz );
						vec3 Ein = bk.z > 0.5 ? texture( prev, bk.xy ).rgb : mean;
						L += alb / 3.14159265 * Ein;
						if ( first > 0.5 ) L += textureSampleBarycoord( vEmit, bc, fi.xyz ).rgb;
					} else if ( first > 0.5 && hasSky > 0.5 ) {
						// the sky by direction (at infinity, as src/luminara.js draws it: the cylinder's mapping seen from skyEye on its axis)
						float th = atan( d.x, d.z ); if ( th < 0.0 ) th += 6.2831853;
						vec2 uv = vec2( th / 6.2831853, ( skyEye + skyR * d.y / max( length( d.xz ), 1e-3 ) - skyY0 ) / skyH );
						vec2 st = ( skyUv * vec3( uv, 1.0 ) ).xy;
						L += skyCol * textureLod( skyMap, st, 0.0 ).rgb;
					}
				}
				o = vec4( 3.14159265 * L / 8.0 / spp, 1.0 );
			}`, { prev: { value: null }, mean: { value: new THREE.Vector3() }, skyCol: { value: sky.color.clone() }, skyMap: { value: skyMap ?? null }, skyUv: { value: skyMap ? skyMap.matrix : new THREE.Matrix3() },
			skyR: { value: cyl.radiusTop }, skyY0: { value: yb }, skyEye: { value: L.skyU.uSkyEye.value }, skyH: { value: yt - yb }, hasSky: { value: skyMap ? 1 : 0 }, spp: { value: 1 }, first: { value: first ? 1 : 0 } }, null, { blend: true } );
		// bounces: E1 from the emitters, the sky and the direct light on what the rays hit; E2.. from the one before
		const mean = async tex => {

			const rt = this._scratch( 'mean' ), buf = new Float32Array( n * n * 4 ), probe = this._pass( `uniform sampler2D src; out vec4 o; void main() { o = texture( src, vUv ); }`, { src: { value: tex } }, rt );
			await probe.run(); probe.mat.dispose(); this.renderer.readRenderTargetPixels( rt, 0, 0, n, n, buf );
			let r = 0, g = 0, b = 0, c = 0;
			const valid = this._valid ??= ( () => { const v = new Float32Array( n * n * 4 ); this.renderer.readRenderTargetPixels( this._nRT, 0, 0, n, n, v ); return v; } )();
			for ( let i = 0; i < n * n; ++ i ) if ( valid[ 4 * i + 3 ] > 0.5 ) { r += buf[ 4 * i ]; g += buf[ 4 * i + 1 ]; b += buf[ 4 * i + 2 ]; ++ c; }
			return new THREE.Vector3( r / c, g / c, b / c );

		};
		let prev = await this._dilate( direct.textures[ 0 ], 4, 'prev' ), total = this._scratch( 'total' ), sum = [];
		await this._copy( direct.textures[ 1 ], total );		// (the stored: the sconces' direct)
		for ( const [ k, spp ] of SAMPLES.gather.entries() ) {

			const out = this._scratch( 'gather' ), g = gather( k === 0 ), m = await mean( prev );
			Object.assign( g.mat.uniforms, { prev: { value: prev }, mean: { value: m.multiplyScalar( 0.85 ) } } );
			g.mat.uniforms.spp.value = spp / 8;
			for ( let i = 0; i < spp / 8; ++ i ) { g.mat.uniforms.seed.value = ( this._seed = ( this._seed ?? 1 ) + 1 ); await this._draw( g.mat, out, i === 0 ); }
			g.mat.dispose();
			const clean = await this._denoise( out.texture, k === 0 ? 5 : 4 );
			prev = await this._dilate( clean, 4, k % 2 ? 'prev' : 'prev2' );		// (two: the next gather reads this one while its mean is taken from it)
			await this._add( prev, total );
			sum.push( await mean( prev ) );

		}
		// the bounces beyond: a geometric tail from the last two
		const ratio = Math.min( 0.9, sum[ 3 ].length() / Math.max( 1e-6, sum[ 2 ].length() ) );
		await this._add( prev, total, ratio / ( 1 - ratio ) );
		const final = await this._dilate( await this._denoise( total.texture, 2 ), 12, 'final' );
		// read back, encode
		const rtF = this._scratch( 'read' ), buf = new Float32Array( n * n * 4 );
		await this._copy( final, rtF );
		this.renderer.readRenderTargetPixels( rtF, 0, 0, n, n, buf );
		const lum = [];
		for ( let i = 0; i < n * n; i += 7 ) if ( buf[ 4 * i + 3 ] > 0.5 ) lum.push( Math.max( buf[ 4 * i ], buf[ 4 * i + 1 ], buf[ 4 * i + 2 ] ) );
		lum.sort( ( a, b ) => a - b );
		const scale = Math.max( 1e-3, lum[ Math.floor( lum.length * 0.998 ) ] * 1.1 ), data = new Uint8Array( n * n * 3 );
		if ( ! lum.length || ! Number.isFinite( scale ) || sum.some( v => ! Number.isFinite( v.x ) ) ) throw new Error( `the bake came out empty or not finite (valid texels ${ lum.length }, scale ${ scale })` );
		const enc = v => { v = Math.min( 1, Math.max( 0, v / scale ) ); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow( v, 1 / 2.4 ) - 0.055; };
		for ( let y = 0; y < n; ++ y ) for ( let x = 0; x < n; ++ x ) {

			const s = 4 * ( y * n + x ), d = 3 * ( y * n + x ), dither = ( ( x * 7 + y * 13 ) % 16 ) / 16 - 0.5;		// (rows as read: v 0 first, as three samples a glTF image)
			for ( let c = 0; c < 3; ++ c ) data[ d + c ] = Math.min( 255, Math.max( 0, Math.round( 255 * enc( buf[ s + c ] ) + dither ) ) );

		}
		const stats = { triangles: this.triangles, spots: spots.length, sun: +( sunOn ? sun.userData.intensity ?? sun.intensity : 0 ).toFixed( 2 ), sconces: NS, sources: this.sources.length, mean: sum.map( v => +v.length().toFixed( 4 ) ), scale: +scale.toFixed( 4 ) };
		direct.dispose();
		for ( const rt of this._keep ?? [] ) rt.dispose();
		this._keep = [];
		return { data, scale, stats };

	}

	/** Diagnostics: the valid texels, the rays' hits from them, what the hits carry (means over valid texels). */
	async debug() {

		if ( ! this.bvh ) { this._buildBVH(); this._gbuffer(); await this._orient(); }
		this._emit();
		const n = this.size, rt = target( n );
		const p = this._pass( /* glsl */`
			out vec4 o;
			void main() {
				seedRng();
				vec4 P = texture( gPos, vUv ), N = texture( gNor, vUv );
				if ( N.a < 0.5 ) { o = vec4( 0 ); return; }
				float hits = 0.0, em = 0.0, al = 0.0, baked = 0.0;
				for ( int i = 0; i < 16; ++ i ) {
					uvec4 fi; vec3 bc; float t;
					if ( trace( P.xyz + N.xyz * 0.004, cosineDir( N.xyz ), fi, bc, t ) ) {
						hits += 1.0; em += dot( textureSampleBarycoord( vEmit, bc, fi.xyz ).rgb, vec3( 1.0 / 3.0 ) );
						al += textureSampleBarycoord( vAlbedo, bc, fi.xyz ).g; baked += textureSampleBarycoord( vBake, bc, fi.xyz ).z;
					}
				}
				o = vec4( hits / 16.0, em / 16.0, al / max( hits, 1.0 ), baked / max( hits, 1.0 ) );
			}`, {}, rt );
		await p.run();
		const buf = new Float32Array( n * n * 4 ), nb = new Float32Array( n * n * 4 ), pb = new Float32Array( n * n * 4 );
		this.renderer.readRenderTargetPixels( rt, 0, 0, n, n, buf );
		this.renderer.readRenderTargetPixels( this._nRT, 0, 0, n, n, nb );
		this.renderer.readRenderTargetPixels( this._gRT, 0, 0, n, n, pb );
		let v = 0, g = 0, s = [ 0, 0, 0, 0 ];
		for ( let i = 0; i < n * n; ++ i ) { if ( pb[ 4 * i + 3 ] > 0.5 ) ++ g; if ( nb[ 4 * i + 3 ] > 0.5 ) { ++ v; for ( let c = 0; c < 4; ++ c ) s[ c ] += buf[ 4 * i + c ]; } }
		const E = this.vEmit.image.data; let emv = 0, emc = 0;
		for ( let i = 0; i < E.length; i += 4 ) if ( E[ i ] + E[ i + 1 ] + E[ i + 2 ] > 0 ) { ++ emc; emv += E[ i ]; }
		return { texels: n * n, covered: g, valid: v, hitFrac: s[ 0 ] / v, emitAtHits: s[ 1 ] / v, albedoAtHits: s[ 2 ] / v, bakedAtHits: s[ 3 ] / v, emissiveVerts: emc, meanEmitR: emv / Math.max( 1, emc ), sources: this.sources.map( m => `${ m.name || m.type }:${ m.emissiveIntensity?.toFixed( 2 ) }` ).slice( 0, 50 ) };

	}

	async _copy( src, dst ) { const p = this._pass( `uniform sampler2D src; out vec4 o; void main() { o = texture( src, vUv ); }`, { src: { value: src } }, dst ); await p.run(); p.mat.dispose(); }

	async _add( src, dst, k = 1 ) { const p = this._pass( `uniform sampler2D src; uniform float k; out vec4 o; void main() { vec4 v = texture( src, vUv ); o = vec4( v.rgb * k, 0.0 ); }`, { src: { value: src }, k: { value: k } }, dst, { blend: true } ); await p.run( 1, false ); p.mat.dispose(); }

	/** An edge-aware à-trous blur (positions and normals: within a chart, on one surface), `levels` steps. */
	async _denoise( src, levels ) {

		const n = this.size;
		let a = src;
		for ( let l = 0; l < levels; ++ l ) {

			const rt = this._scratch( l % 2 ? 'dn1' : 'dn0' );
			const p = this._pass( /* glsl */`
				uniform sampler2D src; uniform float step; out vec4 o;
				void main() {
					vec4 c0 = texture( src, vUv ), P = texture( gPos, vUv ), N = texture( gNor, vUv );
					if ( N.a < 0.5 ) { o = c0; return; }
					vec3 s = vec3( 0 ); float w = 0.0;
					for ( int j = -2; j <= 2; ++ j ) for ( int i = -2; i <= 2; ++ i ) {
						vec2 q = vUv + vec2( i, j ) * step / ${ n }.0;
						vec4 c = texture( src, q ), Pq = texture( gPos, q ), Nq = texture( gNor, q );
						if ( Nq.a < 0.5 ) continue;
						float k = float( ( 3 - abs( i ) ) * ( 3 - abs( j ) ) ) * exp( - dot( Pq.xyz - P.xyz, Pq.xyz - P.xyz ) / ( 0.02 * step * step ) ) * pow( max( 0.0, dot( Nq.xyz, N.xyz ) ), 16.0 );
						s += c.rgb * k; w += k;
					}
					o = vec4( s / max( w, 1e-6 ), c0.a );
				}`, { src: { value: a }, step: { value: 1 << l } }, rt );
			await p.run(); p.mat.dispose();
			a = rt.texture;

		}
		return a;

	}

	/** The charts' borders run on into the unused texels (`iterations` texels), so filtering never meets black. */
	async _dilate( src, iterations = 4, into = 'dil' ) {		// (`into`: the pool's name for its result; the steps between: its two scratch targets)

		const n = this.size;
		let a = src;
		for ( let it = 0; it < iterations; ++ it ) {

			const rt = this._scratch( it === iterations - 1 ? into : it % 2 ? 'dl1' : 'dl0' );
			const p = this._pass( /* glsl */`
				uniform sampler2D src; uniform float first; out vec4 o;
				void main() {
					vec4 c = texture( src, vUv ); float v = first > 0.5 ? texture( gNor, vUv ).a : c.a;
					if ( v > 0.5 ) { o = vec4( c.rgb, 1.0 ); return; }
					vec3 s = vec3( 0 ); float w = 0.0;
					for ( int j = -1; j <= 1; ++ j ) for ( int i = -1; i <= 1; ++ i ) {
						vec2 q = vUv + vec2( i, j ) / ${ n }.0; vec4 cq = texture( src, q ); float vq = first > 0.5 ? texture( gNor, q ).a : cq.a;
						if ( vq > 0.5 ) { s += cq.rgb; w += 1.0; }
					}
					o = w > 0.0 ? vec4( s / w, 1.0 ) : vec4( 0 );
				}`, { src: { value: a }, first: { value: it === 0 ? 1 : 0 } }, rt );
			await p.run(); p.mat.dispose();
			a = rt.texture;

		}
		return a;

	}

}

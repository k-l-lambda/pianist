// Baked contact shadows for the static parts of the upright interior:
// strings, wrest pins and pressure bars shading the plate, and strings plus the plate
// shading the soundboard behind it. The geometry never moves, so the result is a
// texture (used as aoMap) instead of a per-frame shadow.
//
// Each occluder is a capsule (segment + radius). For every receiver texel near it the
// splat shader evaluates analytic ambient occlusion (view factor of the capsule) and a soft
// shadow towards a broad key light (the window / glass top); results multiply together.

import * as THREE from 'three';

const SPLAT_VS = /* glsl */`
	precision highp float;
	in vec2 corner;
	in vec3 a;
	in vec3 b;
	in float radius;
	uniform vec4 rect;			// x0, y0, x1, y1 of the receiver
	uniform float zRecv;
	uniform vec3 lightDir;
	out vec2 vXY;
	flat out vec3 vA;
	flat out vec3 vB;
	flat out float vR;
	void main() {
		float h = max( a.z, b.z ) - zRecv;
		// reach of the occlusion plus the shadow's sideways offset
		vec2 shift = - lightDir.xy / max( lightDir.z, 0.2 ) * h;
		float m = 3.0 * h + 4.0 * radius;
		vec2 lo = min( a.xy, b.xy ) + min( shift, vec2( 0.0 ) ) - m;
		vec2 hi = max( a.xy, b.xy ) + max( shift, vec2( 0.0 ) ) + m;
		vXY = mix( lo, hi, corner );
		vA = a; vB = b; vR = radius;
		vec2 ndc = ( vXY - rect.xy ) / ( rect.zw - rect.xy ) * 2.0 - 1.0;
		gl_Position = vec4( ndc, 0.0, 1.0 );
	}
`;

const SPLAT_FS = /* glsl */`
	precision highp float;
	in vec2 vXY;
	flat in vec3 vA;
	flat in vec3 vB;
	flat in float vR;
	uniform float zRecv;
	uniform vec3 lightDir;
	uniform float lightAngle;		// angular radius of the key light
	uniform float lightWeight;
	out vec4 outColor;

	void main() {
		vec3 p = vec3( vXY, zRecv );
		vec3 ab = vB - vA;
		float len = max( length( ab ), 1e-6 );

		// ambient occlusion: integrate small spheres along the capsule (view factor
		// r² cosθ / d² each, scaled so a long cylinder gives the exact r h / d² result)
		float F = 0.0;
		const int S = 16;
		for ( int i = 0; i < S; ++ i ) {
			vec3 q = vA + ab * ( ( float( i ) + 0.5 ) / float( S ) );
			vec3 d = q - p;
			float d2 = dot( d, d );
			float cosT = max( d.z, 0.0 ) / sqrt( d2 );
			F += vR * cosT / d2 * ( len / float( S ) ) * ( 2.0 / 3.14159265 );
		}
		float ao = 1.0 - clamp( F, 0.0, 0.9 );

		// soft shadow: closest approach between the ray towards the light and the segment
		vec3 w = p - vA;
		float aa = dot( lightDir, lightDir ), bb = dot( lightDir, ab ), cc = dot( ab, ab );
		float dd = dot( lightDir, w ), ee = dot( ab, w );
		float den = max( aa * cc - bb * bb, 1e-12 );
		float sc = clamp( ( aa * ee - bb * dd ) / den, 0.0, 1.0 );
		float tc = max( ( bb * sc - dd ) / aa, 0.0 );
		vec3 gap = ( p + lightDir * tc ) - ( vA + ab * sc );
		float dist = length( gap );
		float t = max( tc, 1e-4 );
		// angular size of the occluder vs the light seen from p
		float occ = atan( vR / t ), sep = atan( dist / t );
		float cover = clamp( occ / lightAngle, 0.0, 1.0 ) * ( 1.0 - smoothstep( max( occ - lightAngle, 0.0 ), occ + lightAngle, sep ) );
		float shadow = 1.0 - lightWeight * cover * step( 1e-4, tc );

		outColor = vec4( vec3( ao * shadow ), 1.0 );
	}
`;

const GATHER_FS = /* glsl */`
	precision highp float;
	in vec2 vUv;
	uniform sampler2D plateMask;
	uniform vec4 rect;
	uniform float zRecv;
	uniform float zPlate;
	uniform vec2 cover;		// action cover: top edge y, front face z (blocks rays below it)
	out vec4 outColor;
	void main() {
		vec3 p = vec3( mix( rect.xy, rect.zw, vUv ), zRecv );
		float vis = 0.0;
		const int N = 48;
		for ( int i = 0; i < N; ++ i ) {
			float u1 = ( float( i ) + 0.5 ) / float( N );
			float u2 = fract( float( i ) * 0.618034 );
			float r = sqrt( u1 ), phi = 6.2831853 * u2;
			vec3 d = vec3( r * cos( phi ), r * sin( phi ), sqrt( 1.0 - u1 ) );
			// through the plate plane
			vec3 q = p + d * ( ( zPlate - p.z ) / d.z );
			vec2 uv = ( q.xy - rect.xy ) / ( rect.zw - rect.xy );
			float hit = 0.0;
			if ( uv.x < 0.0 || uv.x > 1.0 ) hit = 1.0;			// case sides
			else if ( uv.y <= 1.0 && uv.y >= 0.0 ) hit = texture( plateMask, uv ).r;
			else if ( uv.y > 1.0 ) hit = 1.0;					// top board
			// action cover in front of the plate's lower edge
			vec3 c = p + d * ( ( cover.y - p.z ) / d.z );
			if ( c.y < cover.x ) hit = 1.0;
			vis += 1.0 - hit;
		}
		outColor = vec4( vec3( vis / float( N ) ), 1.0 );
	}
`;

const QUAD_VS = /* glsl */`
	precision highp float;
	in vec2 corner;
	out vec2 vUv;
	void main() {
		vUv = corner;
		gl_Position = vec4( corner * 2.0 - 1.0, 0.0, 1.0 );
	}
`;

function quadGeometry( instanced ) {

	const geo = instanced ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
	geo.setAttribute( 'corner', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 1 ], 2 ) );
	geo.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
	return geo;

}

export class ShadowBaker {

	constructor( renderer ) {

		this.renderer = renderer;
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

	}

	_target( w, h ) {

		const rt = new THREE.WebGLRenderTarget( w, h, {
			type: THREE.HalfFloatType,
			minFilter: THREE.LinearMipmapLinearFilter,
			magFilter: THREE.LinearFilter,
			generateMipmaps: true,
			depthBuffer: false,
			wrapS: THREE.ClampToEdgeWrapping,
			wrapT: THREE.ClampToEdgeWrapping,
		} );
		return rt;

	}

	_clear( target, color ) {

		const r = this.renderer;
		const prev = { target: r.getRenderTarget(), color: r.getClearColor( new THREE.Color() ), alpha: r.getClearAlpha() };
		r.setRenderTarget( target );
		r.setClearColor( color, 1 );
		r.clear( true, false, false );
		r.setRenderTarget( prev.target );
		r.setClearColor( prev.color, prev.alpha );

	}

	_draw( mesh, target, clear ) {

		const r = this.renderer;
		const prev = { target: r.getRenderTarget(), auto: r.autoClear, tone: r.toneMapping, color: r.getClearColor( new THREE.Color() ), alpha: r.getClearAlpha() };
		r.toneMapping = THREE.NoToneMapping;
		r.autoClear = false;
		r.setRenderTarget( target );
		if ( clear ) {

			r.setClearColor( clear, 1 );
			r.clear( true, false, false );

		}

		mesh.frustumCulled = false;
		this.scene.add( mesh );
		r.render( this.scene, this.camera );
		this.scene.remove( mesh );
		r.setRenderTarget( prev.target );
		r.setClearColor( prev.color, prev.alpha );
		r.autoClear = prev.auto;
		r.toneMapping = prev.tone;

	}

	_splat( occluders, target, { rect, zRecv, light } ) {

		const geo = quadGeometry( true );
		const A = new Float32Array( occluders.length * 3 ), B = new Float32Array( occluders.length * 3 ), R = new Float32Array( occluders.length );
		occluders.forEach( ( o, i ) => {

			A.set( [ o.a.x, o.a.y, o.a.z ], i * 3 );
			B.set( [ o.b.x, o.b.y, o.b.z ], i * 3 );
			R[ i ] = o.r;

		} );
		geo.setAttribute( 'a', new THREE.InstancedBufferAttribute( A, 3 ) );
		geo.setAttribute( 'b', new THREE.InstancedBufferAttribute( B, 3 ) );
		geo.setAttribute( 'radius', new THREE.InstancedBufferAttribute( R, 1 ) );
		geo.instanceCount = occluders.length;

		const mat = new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3,
			vertexShader: SPLAT_VS,
			fragmentShader: SPLAT_FS,
			uniforms: {
				rect: { value: new THREE.Vector4( rect.x0, rect.y0, rect.x1, rect.y1 ) },
				zRecv: { value: zRecv },
				lightDir: { value: light.dir.clone().normalize() },
				lightAngle: { value: light.angle },
				lightWeight: { value: light.weight },
			},
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.CustomBlending,
			blendEquation: THREE.AddEquation,
			blendSrc: THREE.ZeroFactor,
			blendDst: THREE.SrcColorFactor,		// dst *= src
		} );
		this._draw( new THREE.Mesh( geo, mat ), target, null );
		geo.dispose();
		mat.dispose();

	}

	/**
	 * @param opts.rect        { x0, y0, x1, y1 } area shared by plate and soundboard maps
	 * @param opts.plate       { z, occluders: [{ a, b, r }] }      receiver = plate front face
	 * @param opts.board       { z, occluders, maskShapes: [THREE.Shape], zPlate, cover: { y, z } }
	 * @param opts.light       { dir, angle, weight }
	 * @returns { plate: Texture, board: Texture }
	 */
	bake( { rect, plate, board, light, plateSize = [ 2048, 1024 ], boardSize = [ 1024, 512 ] } ) {

		const plateRT = this._target( ...plateSize );
		this._clear( plateRT, 0xffffff );
		this._splat( plate.occluders, plateRT, { rect, zRecv: plate.z, light } );

		// plate mask: white where the plate (and struts) cover the soundboard
		const maskRT = new THREE.WebGLRenderTarget( 1024, 512, { depthBuffer: false } );
		{

			const geo = new THREE.ShapeGeometry( board.maskShapes );
			const cam = new THREE.OrthographicCamera( rect.x0, rect.x1, rect.y1, rect.y0, - 1, 1 );
			const sc = new THREE.Scene();
			sc.add( new THREE.Mesh( geo, new THREE.MeshBasicMaterial( { color: 0xffffff } ) ) );
			const r = this.renderer;
			const prev = r.getRenderTarget(), tone = r.toneMapping, col = r.getClearColor( new THREE.Color() ), alpha = r.getClearAlpha();
			r.toneMapping = THREE.NoToneMapping;
			r.setRenderTarget( maskRT );
			r.setClearColor( 0x000000, 1 );
			r.clear();
			r.render( sc, cam );
			r.setRenderTarget( prev );
			r.setClearColor( col, alpha );
			r.toneMapping = tone;
			geo.dispose();

		}

		const boardRT = this._target( ...boardSize );
		const gather = new THREE.RawShaderMaterial( {
			glslVersion: THREE.GLSL3,
			vertexShader: QUAD_VS,
			fragmentShader: GATHER_FS,
			uniforms: {
				plateMask: { value: maskRT.texture },
				rect: { value: new THREE.Vector4( rect.x0, rect.y0, rect.x1, rect.y1 ) },
				zRecv: { value: board.z },
				zPlate: { value: board.zPlate },
				cover: { value: new THREE.Vector2( board.cover.y, board.cover.z ) },
			},
			depthTest: false,
			depthWrite: false,
		} );
		const quad = quadGeometry( false );
		this._draw( new THREE.Mesh( quad, gather ), boardRT, new THREE.Color( 1, 1, 1 ) );
		quad.dispose();
		gather.dispose();
		maskRT.dispose();
		this._splat( board.occluders, boardRT, { rect, zRecv: board.z, light } );

		return { plate: plateRT.texture, board: boardRT.texture };

	}

}

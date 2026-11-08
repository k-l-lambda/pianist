// The piano's screen in the path tracer. The roll (pianoroll.js: its falling bars, flares, particles,
// subtitles, the power-on artwork) is drawn by additive ShaderMaterials, which the path tracer cannot
// read; while its scene is built the roll is hidden and the screen would be the bare black panel. Here
// the roll is drawn once, straight on (an orthographic camera on its plane), into a linear HDR target;
// read back, it is the emissive map of a thin plate laid on the panel: the image's radiance as the raster
// draws it, the screen a real light on the keys, the music desk, the player.
//
// Its precision: the path tracer copies every texture into one array of RGBA8 layers, decoded (linear) 8-bit.
// Scaled by each frame's peak (17..27 in the premiere) the faint guides (radiance 0.04) were stored as 0 but in
// one frame of twelve (0.07: the vertical lines blinked in video) and the dim bars by ±30 % from frame to frame.
// So: a fixed scale (SCALE: the same levels every frame), linear 8-bit with a fixed per-texel dither (each
// output pixel averages tens of texels: their mean is right), at the layer's own size (the rows repeated to
// fill it: no resampling and rounding again when the path tracer copies it in).

import * as THREE from 'three';

const SCALE = 32;		// radiance at byte 255 (above it white anyway after the tone mapping: the flares' cores)
// half floats to floats, a table
let HALF = null;
const halfTable = () => HALF ??= Float32Array.from( { length: 65536 }, ( _, i ) => { const v = THREE.DataUtils.fromHalfFloat( i ); return Number.isFinite( v ) && v > 0 ? v : 0; } );
// a fixed dither in [0, 1) per texel and channel
const dither = ( x, y, c ) => { let h = Math.imul( x * 73856093 ^ y * 19349663 ^ c * 83492791, 0x9E3779B1 ); h ^= h >>> 15; h = Math.imul( h, 0x85EBCA6B ); h ^= h >>> 13; return ( h >>> 8 ) / 16777216; };

/**
 * The roll's image as a mesh for the path tracer's scene (world space, on the screen's plane), or null
 * (no screen, the screen off, nothing drawn). `panel`: the screen's material (its lacquer: the plate
 * keeps its gloss). `size`: the path tracer's texture layers' (pt.textureSize). The caller adds it to the
 * scene for the build and disposes it after (dispose()).
 */
export function captureScreen( renderer, roll, panel, { size = 2048 } = {} ) {

	if ( ! roll?.piano || ! roll.screen || ! roll.power || ! ( roll.powerLevel > 0 ) ) return null;
	const clip = roll.clipUniform.value;		// (the screen's rectangle on the roll plane: x0, x1, y0, y1)
	const w = clip.y - clip.x, h = clip.w - clip.z;
	if ( ! ( w > 0 && h > 0 ) ) return null;
	// drawn at the layer's width and the screen's aspect (the particles' sprites square), its rows repeated to the layer's height after
	const W = size, H = Math.max( 1, Math.round( W * h / w ) );

	// the camera on the roll's plane: its frame the roll group's (x across, y up the screen, z towards the player)
	roll.piano.group.updateMatrixWorld( true );
	const M = roll.group.matrixWorld;
	const cam = new THREE.OrthographicCamera( clip.x, clip.y, clip.w, clip.z, 0.001, 1 );
	cam.matrixAutoUpdate = false;
	cam.matrix.copy( M ).multiply( new THREE.Matrix4().makeTranslation( 0, 0, 0.5 ) );
	cam.matrixWorld.copy( cam.matrix );
	cam.matrixWorldInverse.copy( cam.matrixWorld ).invert();

	const target = new THREE.WebGLRenderTarget( W, H, { type: THREE.HalfFloatType, depthBuffer: false } );
	const was = { target: renderer.getRenderTarget(), visible: roll.group.visible, color: renderer.getClearColor( new THREE.Color() ), alpha: renderer.getClearAlpha(), auto: renderer.autoClear, scale: roll.partUniforms.uScale.value, tone: renderer.toneMapping, parent: roll.group.parent };
	// a scene of its own for the roll group (it stays in its piano: its world matrix taken over)
	const scene = new THREE.Scene();
	const proxy = new THREE.Group();
	proxy.matrixAutoUpdate = false;
	scene.add( proxy );
	try {

		roll.group.visible = true;
		// particles' sprite sizes: px per m on the screen (the shaders size them for a perspective view: size * uScale / depth, at depth 0.5)
		roll.partUniforms.uScale.value = 0.5 * H / h;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.setRenderTarget( target );
		renderer.setClearColor( 0x000000, 0 );
		renderer.autoClear = true;
		renderer.clear();
		// draw the group where it is: its parent's world matrix on the proxy
		const parentWorld = roll.group.parent.matrixWorld;
		proxy.matrix.copy( parentWorld ); proxy.matrixWorld.copy( parentWorld );
		proxy.add( roll.group );
		renderer.render( scene, cam );

	} finally {

		was.parent.add( roll.group );
		roll.group.visible = was.visible;
		roll.partUniforms.uScale.value = was.scale;
		renderer.toneMapping = was.tone;
		renderer.setClearColor( was.color, was.alpha );
		renderer.autoClear = was.auto;
		renderer.setRenderTarget( was.target );

	}

	// read back (half floats); linear 8-bit at SCALE, dithered, rows repeated to the layer's size
	const half = new Uint16Array( 4 * W * H );
	renderer.readRenderTargetPixels( target, 0, 0, W, H, half );
	target.dispose();
	const F = halfTable(), px = new Uint8Array( 4 * size * size ), k = 255 / SCALE;
	let peak = 0;
	for ( let i = 0; i < half.length; i += 4 ) peak = Math.max( peak, F[ half[ i ] ], F[ half[ i + 1 ] ], F[ half[ i + 2 ] ] );
	if ( ! ( peak > 1e-4 ) ) return null;
	for ( let y = 0; y < size; ++ y ) {

		const row = 4 * W * Math.min( H - 1, Math.floor( ( y + 0.5 ) * H / size ) ), o = 4 * size * y;
		for ( let x = 0; x < size; ++ x ) {

			const i = row + 4 * x, j = o + 4 * x;
			for ( let c = 0; c < 3; ++ c ) px[ j + c ] = Math.min( 255, Math.floor( F[ half[ i + c ] ] * k + dither( x, y, c ) ) );
			px[ j + 3 ] = 255;

		}

	}

	const tex = new THREE.DataTexture( px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType );
	tex.colorSpace = THREE.NoColorSpace;		// (linear: copied into the layer as it is)
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;		// (rows bottom first, as read: v up, the plane's uvs)

	// the plate: the screen's rectangle on its plane, just in front of the panel (the roll plane is LIFT
	// above it), its lacquer and the image as its emission
	const geo = new THREE.PlaneGeometry( w, h ).translate( ( clip.x + clip.y ) / 2, ( clip.z + clip.w ) / 2, 0 );
	geo.applyMatrix4( M );
	const mat = new THREE.MeshPhysicalMaterial( {
		color: panel?.color ?? new THREE.Color( 0 ), roughness: panel?.roughness ?? 0.05, metalness: panel?.metalness ?? 0,
		clearcoat: panel?.clearcoat ?? 0, clearcoatRoughness: panel?.clearcoatRoughness ?? 0,
		emissive: new THREE.Color( 0xffffff ), emissiveMap: tex, emissiveIntensity: SCALE,
	} );
	const mesh = new THREE.Mesh( geo, mat );
	mesh.name = 'ptScreen';
	mesh.castShadow = false;
	mesh.receiveShadow = true;
	mesh.userData.peak = peak;
	mesh.dispose = () => { mesh.removeFromParent(); geo.dispose(); mat.dispose(); tex.dispose(); };
	return mesh;

}

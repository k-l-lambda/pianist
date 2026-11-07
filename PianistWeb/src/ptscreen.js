// The piano's screen in the path tracer. The roll (pianoroll.js: its falling bars, flares, particles,
// subtitles, the power-on artwork) is drawn by additive ShaderMaterials, which the path tracer cannot
// read; while its scene is built the roll is hidden and the screen would be the bare black panel. Here
// the roll is drawn once, straight on (an orthographic camera on its plane), into a linear HDR target;
// read back, scaled by its peak and encoded to sRGB 8-bit (the path tracer's texture layers are RGBA8),
// it is the emissive map of a thin plate laid on the panel, its emissive intensity the peak: the image's
// radiance as the raster draws it, the screen a real light on the keys, the music desk, the player.

import * as THREE from 'three';

const PX_PER_M = 1400;		// (the grand's 1.3 m screen: ~1820 px across)
const MAX_PX = 2048;

/**
 * The roll's image as a mesh for the path tracer's scene (world space, on the screen's plane), or null
 * (no screen, the screen off, nothing drawn). `panel`: the screen's material (its lacquer: the plate
 * keeps its gloss). The caller adds it to the scene for the build and disposes it after (dispose()).
 */
export function captureScreen( renderer, roll, panel ) {

	if ( ! roll?.piano || ! roll.screen || ! roll.power || ! ( roll.powerLevel > 0 ) ) return null;
	const clip = roll.clipUniform.value;		// (the screen's rectangle on the roll plane: x0, x1, y0, y1)
	const w = clip.y - clip.x, h = clip.w - clip.z;
	if ( ! ( w > 0 && h > 0 ) ) return null;
	const W = Math.min( MAX_PX, Math.round( w * PX_PER_M ) ), H = Math.max( 1, Math.round( W * h / w ) );

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

	// read back (half floats), scale by the peak, encode to sRGB 8-bit
	const half = new Uint16Array( 4 * W * H );
	renderer.readRenderTargetPixels( target, 0, 0, W, H, half );
	target.dispose();
	const lin = new Float32Array( 3 * W * H );
	let peak = 0;
	for ( let i = 0, j = 0; i < half.length; i += 4, j += 3 ) for ( let c = 0; c < 3; ++ c ) {

		const v = THREE.DataUtils.fromHalfFloat( half[ i + c ] );
		const x = Number.isFinite( v ) && v > 0 ? v : 0;
		lin[ j + c ] = x;
		if ( x > peak ) peak = x;

	}

	if ( ! ( peak > 1e-4 ) ) return null;
	const px = new Uint8Array( 4 * W * H );
	for ( let i = 0, j = 0; j < lin.length; i += 4, j += 3 ) {

		for ( let c = 0; c < 3; ++ c ) {

			const x = lin[ j + c ] / peak;
			px[ i + c ] = Math.round( 255 * ( x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow( x, 1 / 2.4 ) - 0.055 ) );

		}
		px[ i + 3 ] = 255;

	}

	const tex = new THREE.DataTexture( px, W, H, THREE.RGBAFormat, THREE.UnsignedByteType );
	tex.colorSpace = THREE.SRGBColorSpace;
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
		emissive: new THREE.Color( 0xffffff ), emissiveMap: tex, emissiveIntensity: peak,
	} );
	const mesh = new THREE.Mesh( geo, mat );
	mesh.name = 'ptScreen';
	mesh.castShadow = false;
	mesh.receiveShadow = true;
	mesh.userData.peak = peak;
	mesh.dispose = () => { mesh.removeFromParent(); geo.dispose(); mat.dispose(); tex.dispose(); };
	return mesh;

}

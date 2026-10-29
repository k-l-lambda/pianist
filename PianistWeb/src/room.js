// Parametric room + lighting rig, independent of the piano model.
// The room is a closed box (so light bounces stay inside) with a window on one wall;
// the sun enters through the window and casts the frame / foliage shadows.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ProceduralEquirectTexture } from 'three-gpu-pathtracer';
import { boxProjectUV } from './geometry.js';
import { applyPCSS } from './softshadows.js';

RectAreaLightUniformsLib.init();

export const ROOM_DEFAULTS = {
	width: 6.0,
	depth: 5.5,
	height: 3.0,
	wallColor: '#9aa39a',
	floorColor: '#b08a62',
	windowWall: 'right',	// 'right' | 'left' | 'front'
	windowOffset: 1.2,		// along the wall, meters from its center
	windowWidth: 1.5,
	windowHeight: 1.8,
	windowSill: 1.0,
	foliage: true,
};

export const LIGHT_PRESETS = {
	'Sunlit afternoon': { sunAzimuth: 50, sunElevation: 9, sunIntensity: 7, sunColor: '#ffd9a8', sunSoftness: 0.6, sky: 1.0, skyColor: '#a9c4e8', lamp: 0, exposure: 1.0 },
	'Overcast': { sunAzimuth: 62, sunElevation: 30, sunIntensity: 0, sunColor: '#ffffff', sunSoftness: 1, sky: 2.2, skyColor: '#d0d8e0', lamp: 0, exposure: 1.3 },
	'Golden hour': { sunAzimuth: 45, sunElevation: 5, sunIntensity: 6, sunColor: '#ffb070', sunSoftness: 0.4, sky: 0.6, skyColor: '#9fb3d9', lamp: 0, exposure: 1.1 },
	'Evening lamp': { sunAzimuth: 62, sunElevation: 14, sunIntensity: 0, sunColor: '#ffd9a8', sunSoftness: 0.6, sky: 0.05, skyColor: '#203050', lamp: 60, exposure: 1.4 },
};

const phys = p => new THREE.MeshPhysicalMaterial( p );

// sky radiance scale shared by the raster window portal and the path-traced environment
const SKY_RADIANCE = 2.5;
const SUN_DIST = 40;
const SUN_NEAR = SUN_DIST - 8, SUN_FAR = SUN_DIST + 12;

// contact-hardening sun shadows: sharp under the black keys, soft from the window frame
applyPCSS( { near: SUN_NEAR, far: SUN_FAR } );

export class Room {

	constructor( scene, baker ) {

		this.scene = scene;
		this.baker = baker;
		this.params = { ...ROOM_DEFAULTS };
		this.light = { ...LIGHT_PRESETS[ 'Sunlit afternoon' ] };
		this.group = new THREE.Group();
		this.group.name = 'room';
		scene.add( this.group );

		// piano placement: back of the piano against the back wall
		this.backWallZ = - 0.63;

		const plaster = baker.plaster();
		const floor = baker.floorOak();
		this.materials = {
			wall: phys( { map: plaster.map, normalMap: plaster.normalMap, roughnessMap: plaster.roughnessMap, roughness: 1 } ),
			ceiling: phys( { color: '#e2e0da', roughness: 0.9 } ),
			floor: phys( { map: floor.map, normalMap: floor.normalMap, roughnessMap: floor.roughnessMap, roughness: 1, clearcoat: 0.25, clearcoatRoughness: 0.25 } ),
			trim: phys( { color: '#ece9e1', roughness: 0.45 } ),
			frame: phys( { color: '#3b3a37', roughness: 0.5, metalness: 0.2 } ),
			foliage: new THREE.MeshStandardMaterial( { color: '#2c3a22', roughness: 1, alphaMap: baker.foliage().alphaMap, alphaTest: 0.5, side: THREE.DoubleSide } ),
		};

		this._buildLights();
		this.rebuild();

	}

	get center() {

		return new THREE.Vector3( 0, this.params.height / 2, this.backWallZ + this.params.depth / 2 );

	}

	// ---------------------------------------------------------------------
	rebuild() {

		for ( const child of [ ...this.group.children ] ) {

			child.geometry?.dispose();
			this.group.remove( child );

		}

		const p = this.params;
		const T = 0.15;		// wall thickness
		const z0 = this.backWallZ, z1 = z0 + p.depth;
		const x0 = - p.width / 2, x1 = p.width / 2;
		const H = p.height;
		const M = this.materials;
		// the baked albedo already carries the default tint; scale by the ratio to it
		const tint = ( target, hex, defHex ) => {

			const c = new THREE.Color( hex ), d = new THREE.Color( defHex );
			target.setRGB( c.r / d.r, c.g / d.g, c.b / d.b );

		};
		tint( M.wall.color, p.wallColor, ROOM_DEFAULTS.wallColor );
		tint( M.floor.color, p.floorColor, ROOM_DEFAULTS.floorColor );

		const add = ( geo, mat, { cast = true, receive = true } = {} ) => {

			const m = new THREE.Mesh( geo, mat );
			m.castShadow = cast;
			m.receiveShadow = receive;
			this.group.add( m );
			return m;

		};

		const box = ( ax, ay, az, bx, by, bz, mat, uv = { grain: 'x', scale: 1.5, vScale: 1 } ) => {

			const geo = new THREE.BoxGeometry( bx - ax, by - ay, bz - az );
			geo.translate( ( ax + bx ) / 2, ( ay + by ) / 2, ( az + bz ) / 2 );
			return add( boxProjectUV( geo, { ...uv, offset: [ 0, 0 ] } ), mat );

		};

		// floor (planks run along x): texture tile = 2.4 m x 1.12 m
		{

			const geo = new THREE.BoxGeometry( p.width + 2 * T, T, p.depth + 2 * T );
			geo.translate( 0, - T / 2, ( z0 + z1 ) / 2 );
			add( boxProjectUV( geo, { grain: 'x', scale: 2.4, vScale: 2.4 / 1.12, offset: [ 0.13, 0.4 ] } ), M.floor );

		}

		// ceiling
		box( x0 - T, H, z0 - T, x1 + T, H + T, z1 + T, M.ceiling );

		// walls; one may carry the window opening
		const wallUV = { grain: 'x', scale: 1.6, vScale: 1 };
		const wallUVz = { grain: 'z', scale: 1.6, vScale: 1 };
		const win = this._windowRect();

		const wall = ( axis, fixed0, fixed1, a0, a1, hasWindow ) => {

			// axis: 'z' wall spans x (back/front); 'x' wall spans z (left/right)
			const spans = [];
			if ( hasWindow ) {

				spans.push( [ a0, win.a0, 0, H ], [ win.a1, a1, 0, H ], [ win.a0, win.a1, 0, win.y0 ], [ win.a0, win.a1, win.y1, H ] );

			} else {

				spans.push( [ a0, a1, 0, H ] );

			}

			for ( const [ s0, s1, y0, y1 ] of spans ) {

				if ( s1 - s0 < 1e-3 || y1 - y0 < 1e-3 ) continue;
				if ( axis === 'z' ) box( s0, y0, fixed0, s1, y1, fixed1, M.wall, wallUV );
				else box( fixed0, y0, s0, fixed1, y1, s1, M.wall, wallUVz );

			}

		};

		wall( 'z', z0 - T, z0, x0 - T, x1 + T, false );
		wall( 'z', z1, z1 + T, x0 - T, x1 + T, p.windowWall === 'front' );
		wall( 'x', x0 - T, x0, z0, z1, p.windowWall === 'left' );
		wall( 'x', x1, x1 + T, z0, z1, p.windowWall === 'right' );

		// baseboards
		const bb = 0.1, bt = 0.015;
		box( x0, 0, z0, x1, bb, z0 + bt, M.trim );
		box( x0, 0, z1 - bt, x1, bb, z1, M.trim );
		box( x0, 0, z0, x0 + bt, bb, z1, M.trim );
		box( x1 - bt, 0, z0, x1, bb, z1, M.trim );

		this._buildWindow( win );
		this.updateLights();

	}

	// window opening in wall coordinates: a = along the wall
	_windowRect() {

		const p = this.params;
		const z0 = this.backWallZ;
		const along = p.windowWall === 'front' ? 0 : z0 + p.depth / 2;
		const c = along + p.windowOffset;
		return {
			a0: c - p.windowWidth / 2,
			a1: c + p.windowWidth / 2,
			y0: p.windowSill,
			y1: Math.min( p.windowSill + p.windowHeight, p.height - 0.1 ),
		};

	}

	// world-space frame of the window: center, inward normal, along-axis
	_windowFrame( win ) {

		const p = this.params;
		const T = 0.15;
		const cy = ( win.y0 + win.y1 ) / 2;
		const ca = ( win.a0 + win.a1 ) / 2;
		switch ( p.windowWall ) {

			case 'left': return { center: new THREE.Vector3( - p.width / 2 - T / 2, cy, ca ), inward: new THREE.Vector3( 1, 0, 0 ), along: new THREE.Vector3( 0, 0, 1 ) };
			case 'front': return { center: new THREE.Vector3( ca, cy, this.backWallZ + p.depth + T / 2 ), inward: new THREE.Vector3( 0, 0, - 1 ), along: new THREE.Vector3( 1, 0, 0 ) };
			default: return { center: new THREE.Vector3( p.width / 2 + T / 2, cy, ca ), inward: new THREE.Vector3( - 1, 0, 0 ), along: new THREE.Vector3( 0, 0, 1 ) };

		}

	}

	_buildWindow( win ) {

		const T = 0.15;
		const f = this._windowFrame( win );
		this.windowFrame = f;
		const w = win.a1 - win.a0, h = win.y1 - win.y0;
		const M = this.materials;

		const place = ( geo, mat ) => {

			// geo authored in window space: x along, y up, z inward
			const basis = new THREE.Matrix4().makeBasis( f.along, new THREE.Vector3( 0, 1, 0 ), f.inward );
			geo.applyMatrix4( basis );
			geo.translate( f.center.x, f.center.y, f.center.z );
			const m = new THREE.Mesh( geo, mat );
			m.castShadow = true;
			m.receiveShadow = true;
			this.group.add( m );
			return m;

		};

		// det of basis may be -1 for some walls; render frames double-sided
		const frameMat = M.frame;
		frameMat.side = THREE.DoubleSide;
		const fw = 0.05, md = 0.035;
		const bar = ( x, y, bw, bh, d = md ) => place( new THREE.BoxGeometry( bw, bh, d ), frameMat ).position.add( f.along.clone().multiplyScalar( x ) ).add( new THREE.Vector3( 0, y, 0 ) );
		bar( 0, h / 2 - fw / 2, w, fw );
		bar( 0, - h / 2 + fw / 2, w, fw );
		bar( - w / 2 + fw / 2, 0, fw, h );
		bar( w / 2 - fw / 2, 0, fw, h );
		// mullions: 2 columns x 3 rows
		bar( 0, 0, 0.03, h );
		bar( 0, h / 6, w, 0.025 );
		bar( 0, - h / 6, w, 0.025 );

		// sill
		const sill = place( new THREE.BoxGeometry( w + 0.1, 0.03, T + 0.06 ), M.trim );
		sill.position.y += - h / 2 - 0.015;
		sill.position.add( f.inward.clone().multiplyScalar( 0.03 ) );

		// foliage outside, roughly facing the sun
		const leaves = new THREE.Mesh( new THREE.PlaneGeometry( 4, 3 ), M.foliage );
		leaves.castShadow = true;
		leaves.receiveShadow = false;
		leaves.name = 'foliage';
		this.foliage = leaves;
		this.group.add( leaves );

	}

	_buildLights() {

		// raster sun: a distant, narrow spot aimed through the window, so the whole shadow map
		// covers just the sunlit shaft (~0.7 mm texels: fine enough for black keys on white keys,
		// strings and pins). Outside the cone everything is behind the wall anyway.
		const sun = new THREE.SpotLight( '#ffffff', 1, 0, 0.05, 0.05, 0 );
		sun.castShadow = true;
		sun.shadow.mapSize.set( 4096, 4096 );
		sun.shadow.bias = - 0.00002;
		sun.shadow.normalBias = 0.001;
		sun.shadow.camera.near = SUN_NEAR;
		sun.shadow.camera.far = SUN_FAR;
		this.scene.add( sun, sun.target );
		this.sun = sun;

		// path-traced sun: small distant area light -> physically soft penumbra
		const sunArea = new THREE.RectAreaLight( '#ffffff', 1, 1, 1 );
		sunArea.visible = false;
		this.scene.add( sunArea );
		this.sunArea = sunArea;

		// sky portal: the window's sky radiance as an area light for the raster path
		// (the path tracer samples the sky environment through the opening instead)
		const portal = new THREE.RectAreaLight( '#ffffff', 1, 1, 1 );
		this.scene.add( portal );
		this.portal = portal;

		// overhead lamp for the evening preset
		const lamp = new THREE.SpotLight( '#ffc98a', 0, 0, THREE.MathUtils.degToRad( 38 ), 0.6, 2 );
		lamp.castShadow = true;
		lamp.shadow.mapSize.set( 2048, 2048 );
		lamp.shadow.bias = - 0.0002;
		lamp.shadow.radius = 4;
		lamp.radius = 0.08;		// path tracer soft shadows
		this.scene.add( lamp, lamp.target );
		this.lamp = lamp;

		this.sky = new ProceduralEquirectTexture( 256, 128 );
		this.sky.generationCallback = ( polar, uv, coord, color ) => {

			const dir = new THREE.Vector3().setFromSpherical( polar );
			const t = Math.max( dir.y, 0 );
			const zenith = this._skyColor;
			const horizon = this._horizonColor;
			if ( dir.y >= 0 ) color.lerpColors( horizon, zenith, Math.pow( t, 0.5 ) );
			else color.copy( this._groundColor );
			// glow around the sun
			const s = Math.max( dir.dot( this._sunDir ), 0 );
			const glow = 0.25 * Math.pow( s, 8 ) * this.light.sunIntensity / 7;
			color.r += this._sunColorLinear.r * glow;
			color.g += this._sunColorLinear.g * glow;
			color.b += this._sunColorLinear.b * glow;

		};

	}

	sunDirection() {

		// azimuth measured from +x towards +z (i.e. towards the player), elevation above horizon
		const az = THREE.MathUtils.degToRad( this.light.sunAzimuth );
		const el = THREE.MathUtils.degToRad( this.light.sunElevation );
		return new THREE.Vector3( Math.cos( az ) * Math.cos( el ), Math.sin( el ), Math.sin( az ) * Math.cos( el ) );

	}

	updateLights() {

		const L = this.light;
		const dir = this.sunDirection();

		// mirror azimuth to the window side so the sun always shines in
		const f = this.windowFrame;
		if ( f ) {

			const outward = f.inward.clone().negate();
			if ( dir.x * outward.x + dir.z * outward.z < 0.1 ) {

				// reflect horizontal component onto the outward side
				const hz = new THREE.Vector3( dir.x, 0, dir.z );
				const n = outward.clone();
				hz.sub( n.multiplyScalar( 2 * hz.dot( outward ) ) );
				dir.set( hz.x, dir.y, hz.z ).normalize();

			}

		}

		const target = new THREE.Vector3( 0, 1.0, this.backWallZ + 0.6 );
		const dist = 12;

		this.sun.color.set( L.sunColor );
		this.sun.intensity = L.sunIntensity;
		this.sun.visible = L.sunIntensity > 0 && this.mode !== 'pathtrace';
		{

			// cone just covering the window aperture as seen from the sun
			const aim = f ? f.center : target;
			const win = this._windowRect();
			const r = 0.5 * Math.hypot( win.a1 - win.a0, win.y1 - win.y0 ) + 0.2;
			this.sun.position.copy( aim ).addScaledVector( dir, SUN_DIST );
			this.sun.target.position.copy( aim );
			this.sun.angle = Math.atan( r / SUN_DIST );
			// PCSS: radius = 1000 + (sun angular radius) / (texel angle); see softshadows.js
			const sunRadius = 0.0045 * ( 0.4 + 1.6 * L.sunSoftness );
			const texelAngle = 2 * this.sun.angle / this.sun.shadow.mapSize.x;
			this.sun.shadow.radius = 1000 + sunRadius / texelAngle;
			this.sun.shadow.camera.updateProjectionMatrix();

		}

		// area sun: angular size grows with softness; keep irradiance equal to the directional light
		const size = 0.15 + 0.9 * L.sunSoftness;
		this.sunArea.width = this.sunArea.height = size;
		this.sunArea.color.set( L.sunColor );
		this.sunArea.intensity = L.sunIntensity * Math.PI * dist * dist / ( size * size ) / Math.PI;
		this.sunArea.position.copy( target ).addScaledVector( dir, dist );
		this.sunArea.lookAt( target );
		this.sunArea.visible = L.sunIntensity > 0 && this.mode === 'pathtrace';

		// foliage plane: outside the window, perpendicular to the sun
		if ( this.foliage && f ) {

			this.foliage.visible = this.params.foliage;
			this.foliage.position.copy( f.center ).addScaledVector( dir, 1.6 );
			this.foliage.lookAt( this.foliage.position.clone().add( dir ) );

		}

		// window portal
		if ( f ) {

			const win = this._windowRect();
			this.portal.width = win.a1 - win.a0;
			this.portal.height = win.y1 - win.y0;
			this.portal.position.copy( f.center ).addScaledVector( f.inward, 0.08 );
			this.portal.lookAt( this.portal.position.clone().add( f.inward ) );
			this.portal.color.set( L.skyColor ).lerp( new THREE.Color( '#ffffff' ), 0.4 );
			this.portal.intensity = L.sky * SKY_RADIANCE;
			this.portal.visible = L.sky > 0 && this.mode !== 'pathtrace';

		}

		// lamp above the piano
		this.lamp.intensity = L.lamp;
		this.lamp.visible = L.lamp > 0;
		this.lamp.position.set( 0.3, this.params.height - 0.15, this.backWallZ + 1.4 );
		this.lamp.target.position.set( 0, 0.8, this.backWallZ + 0.3 );

		// sky
		this._sunDir = dir;
		this._skyColor = new THREE.Color( L.skyColor ).multiplyScalar( L.sky * SKY_RADIANCE );
		this._horizonColor = new THREE.Color( L.skyColor ).lerp( new THREE.Color( '#ffffff' ), 0.5 ).multiplyScalar( L.sky * SKY_RADIANCE * 1.2 );
		this._groundColor = new THREE.Color( '#5d6650' ).multiplyScalar( L.sky * SKY_RADIANCE * 0.4 );
		this._sunColorLinear = new THREE.Color( L.sunColor );
		this.sky.update();
		this.scene.background = this.sky;

	}

	setMode( mode ) {

		this.mode = mode;
		this.updateLights();

	}

}

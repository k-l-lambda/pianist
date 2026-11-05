// Luminara: the white grand's venue, a round music salon (after Footages.local/ref/f7a6e53c-...png):
// white fluted walls in twelve bays (round windows onto a city at the blue hour, arched niches
// with lit shelves, the treble clef's niche across from the player, the doors behind), a ceiling
// stepping up in rings, each lit from its lip, to a glowing dome over the piano, a polished marble
// floor inlaid with brass rings, the furniture round the wall.
// Built here, procedurally; its furniture, reliefs and textures from the pack
// (public/luminara/luminara.glb, tools/luminara-asset.mjs: TRELLIS meshes and MoGe-2 reliefs of
// generated photos), loaded when it is first entered (the room shows at once, they when there).
//
// Frame: world, the piano at the origin (its centre under the dome), the player towards +z. An
// angle φ round the room as three's LatheGeometry: a point (r sin φ, y, r cos φ); φ 0 behind the
// player (the doors), π across the piano (the clef).
// A venue (see room.js): group, lights, presets, light, place(), probePoint(), ...

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LUMINARA = {
	radius: 6.5,		// the wall
	wall: 3.4,			// its height, to the cornice
	bays: 12,
	pilaster: 0.36,		// wide
	floorTile: 1.8,		// the marble's repeat (m)
};
const R = LUMINARA.radius, BAY = 2 * Math.PI / LUMINARA.bays;

// what each bay holds (k: its centre at φ = k BAY): its opening in the wall (s across, y up, m;
// `circle`: a round window; `arch`: half width a, from y0, its semicircle springing at yS), how
// deep (to the back: a flat panel; a window goes through)
const OPENINGS = {
	window: { shape: 'circle', a: 1.02, yc: 1.95, depth: 0.32 },
	shelves: { shape: 'arch', a: 0.62, y0: 0.5, yS: 2.3, depth: 0.38 },
	pipes: { shape: 'arch', a: 0.62, y0: 0.5, yS: 2.3, depth: 0.32 },		// (a row of lit pipes, as an organ's)
	clef: { shape: 'arch', a: 1.2, y0: 0.25, yS: 2.25, depth: 0.3 },
	door: { shape: 'arch', a: 0.9, y0: 0, yS: 2.3, depth: 0.18 },
};
const BAYS = [ 'door', 'window', 'shelves', 'window', 'pipes', 'window', 'clef', 'window', 'pipes', 'window', 'shelves', 'window' ];

// the ceiling: soffits stepping in and up to the dome; each step's edge a line of light (LED), the
// riser behind it washed from its foot: [ r of the lip, y of the soffit ]
const STEPS = [ [ 5.45, 3.8 ], [ 4.2, 4.35 ], [ 2.95, 4.9 ] ];
const DOME = { y: 5.45, rise: 1.0 };		// from the last riser's top, to its crown
const LIP = 0.06, GAP = 0.07;

// the furniture: [ the pack's node, φ (deg), r, turn (deg, about its own up), mirrored ]
const FURNITURE = [
	[ 'sofa', 90, 5.55, 0 ], [ 'sofa', - 90, 5.55, 0 ],
	[ 'egg-chair', 45, 5.25, 0 ], [ 'egg-chair', 135, 5.25, 0 ], [ 'egg-chair', - 45, 5.25, 0 ], [ 'egg-chair', - 135, 5.25, 0 ],
	[ 'side-table', 63, 5.75, 0 ], [ 'side-table', 117, 5.75, 0 ], [ 'side-table', - 63, 5.75, 0 ], [ 'side-table', - 117, 5.75, 0 ],
	[ 'plant', 159, 5.75, 0 ], [ 'plant', - 159, 5.75, 40 ], [ 'plant', 22, 5.75, 80 ], [ 'plant', - 22, 5.75, 120 ],
];
const COFFEE = [ [ 90, 4.45 ], [ - 90, 4.45 ] ];		// round marble tables before the sofas (built here)

export const LUMINARA_PRESETS = {
	// the default: the city at the blue hour in the windows, the coves warm, the piano under a soft top light
	// (led: the ceiling's lines of light, the main ones; ledWall: the walls' (arches, pilasters, shelves,
	// pipes, the clef, the staff), ledFloor: along the floor, each below the one before (radiance);
	// bloom faint (a bright room: more and the whole frame reads overexposed), over the ceiling's
	// lines only, its threshold above the walls' and the lit white
	// walls; the probe's ambient down: an all-white room, captured, fogs itself)
	// (ACES: the warm lines and the white walls keep their contrast, as in the reference)
	'Blue hour': { key: 240, keyColor: '#fff0dc', top: 230, topColor: '#fff1e0', topAngle: 26, wash: 0, washColor: '#fff1e0', cove: 1.5, coveColor: '#ffcf96', niche: 0.9, nicheColor: '#ffc684', led: 14, ledWall: 3.2, ledFloor: 1.3, ledColor: '#ffcf96', sky: 1.1, env: 0.42, exposure: 0.42, tone: 'ACES', saturation: 1.05, bloom: 0.12, bloomThreshold: 8 },
	'Daylight': { key: 300, keyColor: '#ffffff', top: 260, topColor: '#ffffff', topAngle: 30, wash: 0, washColor: '#f7f6f2', cove: 1.2, coveColor: '#fff2e0', niche: 0.8, nicheColor: '#fff0dc', led: 6, ledWall: 1.6, ledFloor: 0.7, ledColor: '#fff0dc', sky: 1.8, env: 0.8, exposure: 0.45, bloom: 0.06, bloomThreshold: 9 },
	'Evening': { key: 260, keyColor: '#ffe7c8', top: 520, topColor: '#ffe9cc', topAngle: 20, wash: 0, washColor: '#ffdcb0', cove: 1.8, coveColor: '#ffc98a', niche: 1.1, nicheColor: '#ffc27a', led: 18, ledWall: 4, ledFloor: 1.6, ledColor: '#ffcb8a', sky: 0.45, env: 0.38, exposure: 0.55, bloom: 0.15, bloomThreshold: 8 },
	'Spotlight': { key: 0, keyColor: '#fff1de', top: 900, topColor: '#fff0dc', topAngle: 15, wash: 0, washColor: '#ffd9ad', cove: 0.5, coveColor: '#ffc98a', niche: 0.4, nicheColor: '#ffc27a', led: 4, ledWall: 1.1, ledFloor: 0.5, ledColor: '#ffcb8a', sky: 0.25, env: 0.3, exposure: 0.6, bloom: 0.12, bloomThreshold: 8 },
};

const phys = p => new THREE.MeshPhysicalMaterial( p );

/** The staff round the first riser: five wavy lines and notes, white on black (additive), one repeat. */
function staffTexture() {

	const W = 2048, H = 256, c = document.createElement( 'canvas' );
	c.width = W; c.height = H;
	const g = c.getContext( '2d' ), wave = x => 18 * Math.sin( 2 * Math.PI * x / W ), line = k => 70 + 26 * k;
	g.fillStyle = '#000'; g.fillRect( 0, 0, W, H );
	g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 3;
	for ( let k = 0; k < 5; ++ k ) { g.beginPath(); for ( let x = 0; x <= W; x += 8 ) g[ x ? 'lineTo' : 'moveTo' ]( x, line( k ) + wave( x ) ); g.stroke(); }
	// notes: heads (tilted ellipses) on lines and spaces, stems, a beam for each pair
	let seed = 3;
	const rnd = () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647;
	for ( let x = 120; x < W - 80; x += 150 ) {

		const pair = rnd() < 0.5, heads = [];
		for ( let j = 0; j < ( pair ? 2 : 1 ); ++ j ) {

			const hx = x + 60 * j, hy = line( 0 ) - 13 + 13 * Math.floor( rnd() * 9 ) + wave( hx );
			g.save(); g.translate( hx, hy ); g.rotate( - 0.35 ); g.beginPath(); g.ellipse( 0, 0, 12, 8.5, 0, 0, 2 * Math.PI ); g.fill(); g.restore();
			g.fillRect( hx + 10, hy - 70, 3, 70 );
			heads.push( [ hx + 10, hy - 70 ] );

		}
		if ( pair ) { g.lineWidth = 9; g.beginPath(); g.moveTo( heads[ 0 ][ 0 ], heads[ 0 ][ 1 ] ); g.lineTo( heads[ 1 ][ 0 ] + 3, heads[ 1 ][ 1 ] ); g.stroke(); g.lineWidth = 3; }
		else { g.beginPath(); g.moveTo( heads[ 0 ][ 0 ] + 3, heads[ 0 ][ 1 ] ); g.quadraticCurveTo( heads[ 0 ][ 0 ] + 26, heads[ 0 ][ 1 ] + 22, heads[ 0 ][ 0 ] + 18, heads[ 0 ][ 1 ] + 46 ); g.stroke(); }

	}
	const t = new THREE.CanvasTexture( c );
	t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
	return t;

}

/** Outward (f) and the viewer's right (x) at φ, from the centre. */
const outward = phi => new THREE.Vector3( Math.sin( phi ), 0, Math.cos( phi ) );
const rightOf = phi => new THREE.Vector3( - Math.cos( phi ), 0, Math.sin( phi ) );
/** A frame at φ, r out: x the viewer's right, y up, z towards the centre. */
export function frameAt( phi, r, y = 0 ) {

	const x = rightOf( phi ), z = outward( phi ).negate(), o = outward( phi ).multiplyScalar( r ).setY( y );
	return new THREE.Matrix4().makeBasis( x, new THREE.Vector3( 0, 1, 0 ), z ).setPosition( o );

}
/** A point of the wall (the cylinder, radius r) at s across bay φc (right +), y up. */
const onWall = ( phiC, s, y, r = R ) => { const p = phiC - s / R; return new THREE.Vector3( r * Math.sin( p ), y, r * Math.cos( p ) ); };

/** Distance from c along d to the opening's outline. */
function outlineT( o, c, dx, dy ) {

	if ( o.shape === 'circle' ) return o.a;
	const ts = Math.abs( dx ) > 1e-9 ? o.a / Math.abs( dx ) : Infinity;
	if ( dy > 0 ) {

		if ( c[ 1 ] + ts * dy <= o.yS ) return ts;
		const e = c[ 1 ] - o.yS;
		return - e * dy + Math.sqrt( e * e * dy * dy - e * e + o.a * o.a );

	}
	return Math.min( ts, dy < 0 ? ( c[ 1 ] - o.y0 ) / - dy : Infinity );

}
/** The opening's centre (s, y): the point its rays start from. */
const centreOf = o => [ 0, o.shape === 'circle' ? o.yc : ( o.y0 + o.yS ) / 2 ];

/** Angles round the opening: uniform, and the bay rectangle's corners (so the panel keeps them). */
function anglesFor( c, hw, h, n = 112 ) {

	const out = [];
	for ( let i = 0; i < n; ++ i ) out.push( 2 * Math.PI * i / n );
	for ( const [ x, y ] of [ [ hw, h ], [ - hw, h ], [ - hw, 0 ], [ hw, 0 ] ] ) out.push( ( Math.atan2( y - c[ 1 ], x - c[ 0 ] ) + 2 * Math.PI ) % ( 2 * Math.PI ) );
	return out.sort( ( a, b ) => a - b );

}

/** Indexed mesh of rings (each an array of [ Vector3, u, v ], all the same length, closed loops). */
function ringsGeometry( rings, flat = false ) {

	const P = [], UV = [], I = [], n = rings[ 0 ].length;
	for ( const ring of rings ) for ( const [ p, u, v ] of ring ) { P.push( p.x, p.y, p.z ); UV.push( u, v ); }
	for ( let j = 0; j < rings.length - 1; ++ j ) for ( let i = 0; i < n; ++ i ) {

		const a = j * n + i, b = j * n + ( i + 1 ) % n, c = ( j + 1 ) * n + ( i + 1 ) % n, d = ( j + 1 ) * n + i;
		I.push( a, b, c, a, c, d );

	}
	let g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( UV, 2 ) );
	g.setIndex( I );
	if ( flat ) g = g.toNonIndexed();
	g.computeVertexNormals();
	return g;

}

/** A vertical gradient (1 x 64, linear): the coves' and the dome's glow along their profiles. */
function gradient( f ) {

	const N = 64, d = new Uint8Array( 4 * N );
	for ( let i = 0; i < N; ++ i ) { const v = Math.round( 255 * Math.min( 1, Math.max( 0, f( i / ( N - 1 ) ) ) ) ); d.set( [ v, v, v, 255 ], 4 * i ); }
	const t = new THREE.DataTexture( d, 1, N );
	t.magFilter = t.minFilter = THREE.LinearFilter;
	t.needsUpdate = true;
	return t;

}

export class Luminara {

	constructor( scene, baker ) {

		this.scene = scene;
		this.baker = baker;
		this.highQuality = true;
		this.presets = LUMINARA_PRESETS;
		this.preset = 'Blue hour';
		this.light = { ...LUMINARA_PRESETS[ this.preset ] };
		this.group = new THREE.Group();
		this.group.name = 'luminara';
		this.lights = new THREE.Group();
		this.lights.name = 'luminaraLights';
		this.active = false;
		this.view = { maxDistance: 5.5, maxPolarAngle: Math.PI * 0.6 };
		this.background = new THREE.Color( '#0b1426' );
		this.pack = null;			// the furniture etc. once loaded (a group)
		this.loading = Promise.resolve();
		this.onLoad = null;		// called once the pack shows (main.js: the probe again)
		this.glow = [];			// the pack's materials glowing with the lines of light (the clef's gold)

		const plaster = baker.plaster();
		const tinted = ( hex, base ) => { const c = new THREE.Color( hex ), b = new THREE.Color( base ); return new THREE.Color( c.r / b.r, c.g / b.g, c.b / b.b ); };
		this.materials = {
			wall: phys( { map: plaster.map, normalMap: plaster.normalMap, normalScale: new THREE.Vector2( 0.5, 0.5 ), roughness: 0.85, color: tinted( '#f1e7d6', '#9aa39a' ), side: THREE.DoubleSide } ),		// (warm cream)
			ceiling: phys( { color: '#f3e9da', roughness: 0.9, side: THREE.DoubleSide } ),
			// the pilasters, the frames, the shelves, the doors: white lacquer
			lacquer: phys( { color: '#f2f0eb', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide } ),
			brass: phys( { color: '#d6a95c', metalness: 1, roughness: 0.3, side: THREE.DoubleSide } ),
			// the lines of light (LED strips, the windows' and the arches' rings, the pilasters' bars):
			// emissive only, a little in front of what they lie on
			led: new THREE.MeshStandardMaterial( { color: '#000000', roughness: 1, emissive: new THREE.Color( '#ffd9a6' ), emissiveIntensity: 14, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } ),
			ledWall: null, ledFloor: null,		// (the same, dimmer: below)
			// the staff and its notes round the first riser (additive)
			staff: new THREE.MeshBasicMaterial( { map: staffTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } ),
			// the round rug under the piano
			rug: phys( { color: '#e9e3d8', roughness: 1, sheen: 0.8, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.6 } ),
			// the floor (its marble from the pack; plain until then)
			// (polished, not a mirror: the probe's cube, 256 a face, would show its thin lines of light
			// broken into dashes; the reference's floor reflects softly too)
			floor: phys( { color: '#ecebe8', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 } ),
			border: phys( { color: '#c9c3b8', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 } ),
			inlay: phys( { color: '#d6a95c', metalness: 1, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } ),
			// the risers lit from their lip (bright at the foot), the dome (brighter to its crown, rings)
			cove: phys( { color: '#f4f2ee', roughness: 0.9, emissive: new THREE.Color( '#ffd9a8' ), emissiveMap: gradient( v => 0.12 + 0.88 * Math.exp( - 3.5 * v ) ), side: THREE.DoubleSide } ),
			dome: phys( { color: '#f4f2ee', roughness: 0.9, emissive: new THREE.Color( '#ffd9a8' ), side: THREE.DoubleSide,
				emissiveMap: gradient( v => 0.18 + 0.55 * v * v + [ 0.35, 0.62, 0.84 ].reduce( ( s, c ) => s + 0.35 * Math.exp( - ( ( ( v - c ) / 0.012 ) ** 2 ) ), 0 ) ) } ),
			// the niches' backs and the doors' fanlight: lit from behind
			niche: phys( { color: '#f6eee2', roughness: 0.8, emissive: new THREE.Color( '#ffd29a' ) } ),
			// the city outside (the pack's sky; plain until then)
			sky: new THREE.MeshBasicMaterial( { color: '#33476e', side: THREE.BackSide, fog: false } ),
		};

		this.materials.ledWall = this.materials.led.clone();
		this.materials.ledFloor = this.materials.led.clone();
		this._buildLights();
		this.rebuild();

	}

	activate() {

		this.active = true;
		this.scene.add( this.group, this.lights );
		if ( ! this._loadTried ) this.load();
		this.updateLights();

	}

	deactivate() {

		this.active = false;
		this.scene.remove( this.group, this.lights );

	}

	get keyLight() { return this.light.key > 0 ? this.keySpot : this.topSpot; }
	get specularOff() { return []; }
	get probeHidden() { return []; }		// (the sky in the probe too: else each window is a black hole in the floor's reflection)
	get environment() { return null; }
	keyLightRadius() { return 0.02; }

	/** The piano's footprint centred under the dome. */
	place( piano ) {

		piano.group.position.set( 0, 0, 0 );
		piano.group.rotation.set( 0, 0, 0 );
		piano.group.updateMatrixWorld( true );
		const c = new THREE.Box3().setFromObject( piano.group ).getCenter( new THREE.Vector3() );
		piano.group.position.set( - c.x, 0, - c.z );

	}

	probePoint() { return new THREE.Vector3( 0, 1.3, 2.6 ); }

	/** The open floor (world), inside the furniture. */
	bounds() { return { minX: - 3.8, maxX: 3.8, minZ: - 3.8, maxZ: 3.8 }; }

	/** The offline sound's shoebox (tools/spatialise.py): a square of the room's floor area, its
	 * mean height; hard walls and floor (`living`'s surfaces). */
	acousticBox() {

		const h = R * Math.sqrt( Math.PI ) / 2;
		return { minX: - h, maxX: h, minZ: - h, maxZ: h, height: 4.6, acoustics: 'living' };

	}

	views() {

		const at = ( phi, r, y ) => outward( phi * Math.PI / 180 ).multiplyScalar( r ).setY( y );
		return {
			'From the sofa': { position: at( 90, 4.6, 1.15 ), target: new THREE.Vector3( 0, 1.0, 0 ) },
			'The doors': { position: at( 0, 5.6, 1.65 ), target: new THREE.Vector3( 0, 1.4, 0 ) },
			'The clef': { position: at( 25, 2.4, 1.5 ), target: at( 180, R, 1.7 ) },
			'The coves': { position: at( 200, 3.6, 1.4 ), target: new THREE.Vector3( 0, 5.2, 0 ) },
		};

	}

	lightControls() {

		return [
			[ 'key', 0, 2000, 10, 'Key spot' ], [ 'keyColor', 'color', 'Key spot color' ],
			[ 'top', 0, 2000, 10, 'Top light' ], [ 'topColor', 'color', 'Top light color' ], [ 'topAngle', 5, 40, 0.5, 'Top light cone (°)' ],
			[ 'wash', 0, 20, 0.1, 'Dome wash' ], [ 'washColor', 'color', 'Dome wash color' ],
			[ 'cove', 0, 8, 0.01, 'Coves' ], [ 'coveColor', 'color', 'Cove color' ],
			[ 'niche', 0, 6, 0.01, 'Niches' ], [ 'nicheColor', 'color', 'Niche color' ],
			[ 'led', 0, 40, 0.1, 'Ceiling lines' ], [ 'ledWall', 0, 20, 0.1, 'Wall lines' ], [ 'ledFloor', 0, 10, 0.1, 'Floor lines' ], [ 'ledColor', 'color', 'Line color' ],
			[ 'sky', 0, 4, 0.01, 'Sky (windows)' ],
			[ 'env', 0, 1.5, 0.01, 'Ambient (probe)' ],
		];

	}

	// ---------------------------------------------------------------------
	rebuild() {

		for ( const c of [ ...this.group.children ] ) if ( c !== this.pack ) { this.group.remove( c ); c.traverse( o => o.geometry?.dispose() ); }
		const M = this.materials, parts = new Map();		// material -> geometries (merged at the end)
		const add = ( geo, mat ) => { if ( ! parts.has( mat ) ) parts.set( mat, [] ); parts.get( mat ).push( geo.index ? geo.toNonIndexed() : geo ); };
		this.nichePoints = [];

		// the bays: a panel of wall round each opening, the opening's reveal and back
		for ( let k = 0; k < LUMINARA.bays; ++ k ) this._bay( add, k * BAY, OPENINGS[ BAYS[ k ] ], BAYS[ k ] );

		// the pilasters between the bays: fluted white lacquer, a base and a brass-banded capital
		const pil = this._pilaster();
		for ( let k = 0; k < LUMINARA.bays; ++ k ) {

			const F = frameAt( ( k + 0.5 ) * BAY, R );
			add( pil.shaft.clone().applyMatrix4( F ), M.lacquer );
			add( pil.base.clone().applyMatrix4( F ), M.lacquer );
			add( pil.capital.clone().applyMatrix4( F ), M.lacquer );
			add( pil.band.clone().applyMatrix4( F ), M.brass );
			add( pil.bar.clone().applyMatrix4( F ), M.ledWall );
			add( pil.caps.clone().applyMatrix4( F ), M.brass );

		}

		// skirting (broken at the doors), a brass line above it; the cornice
		const doorHalf = ( OPENINGS.door.a + 0.03 ) / R;
		const lathe = ( pts, mat, a0 = 0, len = 2 * Math.PI, n = 192 ) => add( new THREE.LatheGeometry( pts.map( ( [ r, y ] ) => new THREE.Vector2( r, y ) ), n, a0, len ), mat );
		lathe( [ [ R, 0 ], [ R - 0.035, 0 ], [ R - 0.035, 0.15 ], [ R - 0.02, 0.17 ], [ R, 0.17 ] ], M.lacquer, doorHalf, 2 * Math.PI - 2 * doorHalf );
		lathe( [ [ R, 0.17 ], [ R - 0.012, 0.17 ], [ R - 0.012, 0.185 ], [ R, 0.185 ] ], M.brass, doorHalf, 2 * Math.PI - 2 * doorHalf );
		lathe( [ [ R - 0.036, 0.008 ], [ R - 0.036, 0.024 ] ], M.ledFloor, doorHalf, 2 * Math.PI - 2 * doorHalf );		// (a line of light along the floor)
		lathe( [ [ R + 0.01, LUMINARA.wall - 0.02 ], [ R - 0.05, LUMINARA.wall ], [ R - 0.06, LUMINARA.wall + 0.1 ], [ R - 0.16, LUMINARA.wall + 0.2 ], [ R - 0.2, LUMINARA.wall + 0.3 ], [ R - 0.2, STEPS[ 0 ][ 1 ] ] ], M.lacquer );
		lathe( [ [ R - 0.062, LUMINARA.wall + 0.1 ], [ R - 0.062, LUMINARA.wall + 0.125 ] ], M.led );		// (a line of light in the cornice)

		// the ceiling: each soffit in to its lip (brass), the gap, the lit riser up to the next soffit
		let r0 = R - 0.2;
		for ( let i = 0; i < STEPS.length; ++ i ) {

			const [ r, y ] = STEPS[ i ], yNext = i + 1 < STEPS.length ? STEPS[ i + 1 ][ 1 ] : DOME.y;
			lathe( [ [ r0, y ], [ r, y ] ], M.ceiling, 0, 2 * Math.PI, 160 );
			lathe( [ [ r, y ], [ r, y - LIP ], [ r - 0.025, y - LIP ], [ r - 0.025, y ] ], M.ceiling, 0, 2 * Math.PI, 160 );
			lathe( [ [ r - 0.026, y - LIP + 0.008 ], [ r - 0.026, y - 0.008 ] ], M.led, 0, 2 * Math.PI, 160 );		// (the step's edge: a line of light)
			lathe( [ [ r - 0.025, y ], [ r - GAP, y ] ], M.ceiling, 0, 2 * Math.PI, 160 );		// (the gap's floor: the strip's)
			const rr = r - GAP, rise = [];
			for ( let j = 0; j <= 12; ++ j ) rise.push( [ rr, y + ( yNext - y ) * j / 12 ] );
			lathe( rise, M.cove, 0, 2 * Math.PI, 160 );
			if ( i === 0 ) {		// the staff and its notes along the first riser

				const band = new THREE.LatheGeometry( [ new THREE.Vector2( rr - 0.004, y + 0.12 ), new THREE.Vector2( rr - 0.004, y + 0.47 ) ], 192 );
				const m = new THREE.Mesh( band, M.staff );
				m.name = 'luminara:staff'; m.userData.noAO = true;
				this.group.add( m );
				M.staff.map.repeat.set( - 12, 1 );		// (u round the lathe: to the viewer's left)

			}
			r0 = rr;

		}
		{

			const dome = [];
			for ( let j = 0; j <= 32; ++ j ) { const t = j / 32 * Math.PI / 2; dome.push( [ Math.max( 1e-4, r0 * Math.cos( t ) ), DOME.y + DOME.rise * Math.sin( t ) ] ); }
			lathe( dome, M.dome, 0, 2 * Math.PI, 160 );
			lathe( [ [ r0 - 0.002, DOME.y - 0.035 ], [ r0 - 0.002, DOME.y - 0.01 ] ], M.led, 0, 2 * Math.PI, 160 );

		}

		// the floor: the marble field, a border band of darker marble, brass rings
		const disc = ( r1, r2, y, mat ) => {

			const g = r1 > 0 ? new THREE.RingGeometry( r1, r2, 256, 1 ) : new THREE.CircleGeometry( r2, 256 );
			g.rotateX( - Math.PI / 2 ).translate( 0, y, 0 );
			const p = g.attributes.position, uv = g.attributes.uv;
			for ( let i = 0; i < p.count; ++ i ) uv.setXY( i, p.getX( i ) / LUMINARA.floorTile, - p.getZ( i ) / LUMINARA.floorTile );
			return g;

		};
		const floor = new THREE.Mesh( disc( 0, 5.92, 0, null ), M.floor ), border = new THREE.Mesh( disc( 5.92, R + 0.05, 0, null ), M.border );
		for ( const m of [ floor, border ] ) { m.receiveShadow = true; m.name = 'luminara:floor'; this.group.add( m ); }
		for ( const [ a, b ] of [ [ 2.68, 2.695 ], [ 5.88, 5.92 ] ] ) add( disc( a, b, 0.0005 ), M.inlay );
		// a ring of light round the rug: a bead (a flat strip this thin breaks up at grazing angles)
		add( new THREE.TorusGeometry( 2.56, 0.009, 6, 256 ).rotateX( Math.PI / 2 ).scale( 1, 0.6, 1 ), M.ledFloor );
		{

			const rug = new THREE.Mesh( disc( 0, 2.42, 0.006 ), M.rug );
			rug.receiveShadow = true; rug.name = 'luminara:rug';
			this.group.add( rug );

		}

		// coffee tables before the sofas: a marble top on a brass pedestal
		for ( const [ deg, r ] of COFFEE ) {

			const F = frameAt( deg * Math.PI / 180, r );
			add( new THREE.CylinderGeometry( 0.46, 0.46, 0.035, 64 ).translate( 0, 0.405, 0 ).applyMatrix4( F ), M.floor );
			add( new THREE.CylinderGeometry( 0.465, 0.465, 0.012, 64 ).translate( 0, 0.382, 0 ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.035, 0.05, 0.37, 24 ).translate( 0, 0.19, 0 ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.26, 0.27, 0.02, 48 ).translate( 0, 0.01, 0 ).applyMatrix4( F ), M.brass );

		}

		for ( const [ mat, geos ] of parts ) {

			const mesh = new THREE.Mesh( mergeGeometries( geos, false ), mat );
			geos.forEach( g => g.dispose() );
			mesh.castShadow = mat !== M.cove && mat !== M.dome && mat !== M.ceiling;
			mesh.receiveShadow = true;
			mesh.name = `luminara:${ Object.keys( M ).find( k => M[ k ] === mat ) }`;
			this.group.add( mesh );

		}

		// the city outside, round the room: the sky photo four times round (mirrored: no seams), its
		// horizon near the seated eye's height
		{

			const rs = 11, reps = 4, w = 2 * Math.PI * rs / reps, h = w / 3, top = h * 0.62 + 1.55;
			const g = new THREE.CylinderGeometry( rs, rs, h, 128, 1, true ).translate( 0, top - h / 2, 0 );
			this.sky = new THREE.Mesh( g, M.sky );
			this.sky.name = 'luminara:sky';
			this.sky.userData.noAO = true;
			this.group.add( this.sky );
			this.skyReps = reps;

		}
		if ( this.pack ) this.group.add( this.pack );

	}

	/** Bay k (centred at φc): its wall panel round the opening, the opening's reveal and back. */
	_bay( add, phiC, o, kind ) {

		const M = this.materials, hw = R * BAY / 2, H = LUMINARA.wall, c = centreOf( o ), th = anglesFor( c, hw, H );
		const rect = ( dx, dy ) => Math.min( Math.abs( dx ) > 1e-9 ? hw / Math.abs( dx ) : Infinity, dy > 0 ? ( H - c[ 1 ] ) / dy : dy < 0 ? c[ 1 ] / - dy : Infinity );
		const uvOf = ( s, y ) => [ ( phiC * R + s ) / 2.5, y / 2.5 ];
		// the panel: rings from the opening's outline out to the bay's rectangle
		const NR = 10, rings = [];
		for ( let j = 0; j <= NR; ++ j ) rings.push( th.map( a => {

			const dx = Math.cos( a ), dy = Math.sin( a ), t0 = outlineT( o, c, dx, dy ), t = t0 + ( rect( dx, dy ) - t0 ) * j / NR;
			const s = c[ 0 ] + t * dx, y = c[ 1 ] + t * dy;
			return [ onWall( phiC, s, y ), ...uvOf( s, y ) ];

		} ) );
		add( ringsGeometry( rings ), M.wall );
		// the reveal: the outline on the wall, back to the window's far end (round) or the niche's flat back
		const Db = R + o.depth, f = outward( phiC ), x = rightOf( phiC );
		const outline = th.map( a => { const dx = Math.cos( a ), dy = Math.sin( a ), t = outlineT( o, c, dx, dy ); return [ c[ 0 ] + t * dx, c[ 1 ] + t * dy ]; } );
		const back = ( s, y ) => o.shape === 'circle' ? onWall( phiC, s, y, Db ) : f.clone().multiplyScalar( Db ).addScaledVector( x, s ).setY( y );
		const revealRings = [ 0, 0.5, 1 ].map( q => outline.map( ( [ s, y ], i ) => [ onWall( phiC, s, y ).lerp( back( s, y ), q ), i / outline.length * 4, q * o.depth ] ) );
		add( ringsGeometry( revealRings, o.shape !== 'circle' ), o.shape === 'circle' ? M.lacquer : M.wall );
		const F = frameAt( phiC, Db );		// (the back's frame: z 0 the back, +z into the room)
		if ( o.shape === 'circle' ) {

			// a round window: a white frame and a brass ring inside it, on the wall
			const W = frameAt( phiC, R - 0.012, o.yc );
			add( new THREE.TorusGeometry( o.a + 0.045, 0.075, 16, 128 ).applyMatrix4( W ), M.lacquer );
			add( new THREE.TorusGeometry( o.a + 0.005, 0.018, 10, 128 ).translate( 0, 0, 0.03 ).applyMatrix4( W ), M.brass );
			return;

		}
		// an arch: its back flat (lit from behind in a niche; the doors in the door's)
		const shape = new THREE.Shape();
		shape.moveTo( o.a, o.y0 ); shape.lineTo( o.a, o.yS ); shape.absarc( 0, o.yS, o.a, 0, Math.PI, false ); shape.lineTo( - o.a, o.y0 ); shape.closePath();
		const backGeo = new THREE.ShapeGeometry( shape, 48 ).applyMatrix4( F );
		// its frame on the wall: a brass line round the arch (not along the floor)
		const line = outline.filter( ( [ , y ] ) => y > o.y0 + 1e-3 || o.y0 > 0 ).map( ( [ s, y ] ) => onWall( phiC, s, y, R - 0.008 ) );
		if ( o.y0 > 0 ) line.push( line[ 0 ].clone() );
		else line.sort( ( p, q ) => p.distanceTo( onWall( phiC, o.a, 0 ) ) - q.distanceTo( onWall( phiC, o.a, 0 ) ) );
		if ( kind === 'door' ) {

			add( backGeo, M.lacquer );
			this._doors( add, F, o );

		} else {

			add( backGeo, kind === 'pipes' ? M.lacquer : M.niche );
			const mid = new THREE.Vector3( 0, ( o.y0 + o.yS ) / 2, 0.25 ).applyMatrix4( F );
			this.nichePoints.push( { kind, F, o, light: mid } );
			if ( kind === 'shelves' ) for ( const y of [ 1.25, 2.0 ] ) {

				add( new THREE.BoxGeometry( 2 * o.a + 0.1, 0.03, o.depth ).translate( 0, y - 0.015, o.depth / 2 ).applyMatrix4( F ), M.lacquer );
				add( new THREE.BoxGeometry( 2 * o.a - 0.06, 0.008, 0.012 ).translate( 0, y - 0.034, o.depth - 0.03 ).applyMatrix4( F ), M.ledWall );		// (a strip under its front)

			}
			if ( kind === 'pipes' ) this._pipes( add, F, o );
			add( new THREE.BoxGeometry( 2 * o.a - 0.04, 0.01, 0.012 ).translate( 0, o.y0 + 0.006, 0.02 ).applyMatrix4( F ), M.ledWall );		// (a strip along the back's foot)

		}
		add( this._archTrim( phiC, o ), kind === 'door' ? M.brass : M.ledWall );

	}

	/** A band round an arch on the wall (its two sides and the semicircle): brass, or a line of light. */
	_archTrim( phiC, o ) {

		const pts = [];
		pts.push( [ o.a + 0.03, o.y0 ] );
		for ( let i = 0; i <= 48; ++ i ) { const t = Math.PI * i / 48; pts.push( [ ( o.a + 0.03 ) * Math.cos( t ), o.yS + ( o.a + 0.03 ) * Math.sin( t ) ] ); }
		pts.push( [ - o.a - 0.03, o.y0 ] );
		return this._wallTube( phiC, pts, 0.012, false );

	}

	/** A thin tube along points (s, y) of bay φc's wall, just in front of it. */
	_wallTube( phiC, pts, tube, closed ) {

		const curve = new THREE.CatmullRomCurve3( pts.map( ( [ s, y ] ) => onWall( phiC, s, y, R - 0.006 ) ), closed, 'catmullrom', 0.1 );
		return new THREE.TubeGeometry( curve, Math.max( 64, pts.length * 2 ), tube, 8, closed );

	}

	/** A row of lacquered pipes in a niche (frame F: its back), taller to the middle, each lit along a slit. */
	_pipes( add, F, o ) {

		const M = this.materials, n = 9;
		for ( let i = 0; i < n; ++ i ) {

			const x = ( i - ( n - 1 ) / 2 ) * 0.125, h = 0.95 + 0.75 * ( 1 - ( x / o.a ) ** 2 ), z = 0.15;
			add( new THREE.CylinderGeometry( 0.034, 0.034, h, 24 ).translate( x, o.y0 + h / 2, z ).applyMatrix4( F ), M.lacquer );
			add( new THREE.BoxGeometry( 0.012, h - 0.12, 0.004 ).translate( x, o.y0 + 0.06 + ( h - 0.12 ) / 2, z + 0.034 ).applyMatrix4( F ), M.ledWall );
			add( new THREE.CylinderGeometry( 0.036, 0.036, 0.018, 24 ).translate( x, o.y0 + 0.28, z ).applyMatrix4( F ), M.brass );
			add( new THREE.CylinderGeometry( 0.036, 0.036, 0.012, 24 ).translate( x, o.y0 + h - 0.006, z ).applyMatrix4( F ), M.brass );

		}

	}

	/** The doors in the door's arch (frame F: its back): two lacquered leaves with raised panels,
	 * brass pulls, a fanlight in the arch. */
	_doors( add, F, o ) {

		const M = this.materials, w = o.a, h = o.yS;
		for ( const sx of [ - 1, 1 ] ) {

			const cx = sx * w / 2;
			add( new THREE.BoxGeometry( w - 0.02, h - 0.02, 0.05 ).translate( cx, h / 2, 0.025 ).applyMatrix4( F ), M.lacquer );
			for ( const [ y0, y1 ] of [ [ 0.2, 1.0 ], [ 1.15, h - 0.15 ] ] ) add( new THREE.BoxGeometry( w - 0.24, y1 - y0, 0.02 ).translate( cx, ( y0 + y1 ) / 2, 0.06 ).applyMatrix4( F ), M.lacquer );
			add( new THREE.CylinderGeometry( 0.012, 0.012, 0.55, 12 ).translate( sx * 0.07, 1.05, 0.11 ).applyMatrix4( F ), M.brass );
			for ( const y of [ 0.82, 1.28 ] ) add( new THREE.CylinderGeometry( 0.008, 0.008, 0.06, 8 ).rotateX( Math.PI / 2 ).translate( sx * 0.07, y, 0.08 ).applyMatrix4( F ), M.brass );

		}
		add( new THREE.CircleGeometry( w - 0.02, 48, 0, Math.PI ).translate( 0, h, 0.01 ).applyMatrix4( F ), M.niche );
		add( new THREE.BoxGeometry( 2 * w, 0.05, 0.06 ).translate( 0, h, 0.04 ).applyMatrix4( F ), M.brass );
		for ( let i = 1; i < 6; ++ i ) {		// the fanlight's radial bars

			const t = Math.PI * i / 6;
			add( new THREE.BoxGeometry( w - 0.04, 0.018, 0.02 ).translate( ( w - 0.04 ) / 2, 0, 0 ).rotateZ( t ).translate( 0, h, 0.03 ).applyMatrix4( F ), M.brass );

		}

	}

	/** A pilaster's parts in its own frame (x across, y up, z towards the centre; its back in the wall). */
	_pilaster() {

		const w = LUMINARA.pilaster, d = 0.12, H = LUMINARA.wall, flutes = 5, fr = 0.024, s = new THREE.Shape();
		s.moveTo( - w / 2, - 0.06 ); s.lineTo( - w / 2, d );
		const span = w - 0.08, step = span / flutes;
		for ( let i = 0; i < flutes; ++ i ) {

			const cx = - span / 2 + step * ( i + 0.5 );
			s.lineTo( cx - fr, d );
			for ( let j = 1; j < 12; ++ j ) { const u = Math.PI * j / 12; s.lineTo( cx - fr * Math.cos( u ), d - 0.6 * fr * Math.sin( u ) ); }
			s.lineTo( cx + fr, d );

		}
		s.lineTo( w / 2, d ); s.lineTo( w / 2, - 0.06 ); s.closePath();
		const shaft = new THREE.ExtrudeGeometry( s, { depth: H - 0.62, bevelEnabled: false, curveSegments: 4 } ).rotateX( Math.PI / 2 ).translate( 0, H - 0.3, 0 );
		const base = new THREE.BoxGeometry( w + 0.06, 0.32, d + 0.1 ).translate( 0, 0.16, ( d + 0.1 ) / 2 - 0.06 );
		const capital = new THREE.BoxGeometry( w + 0.06, 0.24, d + 0.1 ).translate( 0, H - 0.12, ( d + 0.1 ) / 2 - 0.06 );
		const band = new THREE.BoxGeometry( w + 0.065, 0.025, d + 0.105 ).translate( 0, H - 0.27, ( d + 0.1 ) / 2 - 0.06 );
		// a bar of light down its middle, brass caps at its ends
		const bar = new THREE.BoxGeometry( 0.028, 1.2, 0.016 ).translate( 0, 1.7, d + 0.006 );
		const caps = mergeGeometries( [ 1.1, 2.3 ].map( y => new THREE.BoxGeometry( 0.05, 0.03, 0.03 ).translate( 0, y, d + 0.01 ) ) );
		return { shaft, base, capital, band, bar, caps };

	}

	// ---------------------------------------------------------------------
	_buildLights() {

		const spot = ( angle, penumbra, mapSize ) => {

			const s = new THREE.SpotLight( '#ffffff', 0, 0, angle, penumbra, 2 );
			s.castShadow = true;
			s.shadow.mapSize.set( mapSize, mapSize );
			s.shadow.bias = - 0.00015;
			s.shadow.normalBias = 0.01;
			s.shadow.radius = 3;
			s.shadow.camera.near = 1.5;
			s.shadow.camera.far = 14;
			this.lights.add( s, s.target );
			return s;

		};
		// from the front right, high, under the dome's rim: the piano's shadow falls behind it
		this.keySpot = spot( THREE.MathUtils.degToRad( 24 ), 0.6, 4096 );
		this.keySpot.radius = 0.2;
		this.keySpot.position.set( 1.7, 5.2, 2.2 );
		this.keySpot.target.position.set( 0, 0.7, 0 );
		// straight down from the dome
		this.topSpot = spot( THREE.MathUtils.degToRad( 26 ), 0.5, 2048 );
		this.topSpot.radius = 0.3;
		this.topSpot.position.set( 0, 6.1, 0.2 );
		this.topSpot.target.position.set( 0, 0, 0 );
		// the dome's soft light over the middle of the room (off in the presets: in the polished floor
		// it shows as a square)
		this.wash = new THREE.RectAreaLight( '#ffffff', 0, 4.4, 4.4 );
		this.wash.position.set( 0, 5.3, 0 );
		this.wash.rotation.set( - Math.PI / 2, 0, 0 );
		this.lights.add( this.wash );
		// a warm light in each niche (on its shelves and reliefs)
		this.nicheLights = [];

	}

	updateLights() {

		const L = this.light, M = this.materials;
		this.keySpot.intensity = L.key; this.keySpot.color.set( L.keyColor ); this.keySpot.visible = L.key > 0;
		this.topSpot.intensity = L.top; this.topSpot.color.set( L.topColor ); this.topSpot.visible = L.top > 0;
		this.topSpot.angle = THREE.MathUtils.degToRad( L.topAngle ?? 26 );
		this.wash.intensity = L.wash; this.wash.color.set( L.washColor ); this.wash.visible = L.wash > 0;
		for ( const m of [ M.cove, M.dome ] ) { m.emissive.set( L.coveColor ); m.emissiveIntensity = L.cove * ( m === M.dome ? 0.7 : 1 ); }
		M.niche.emissive.set( L.nicheColor ); M.niche.emissiveIntensity = L.niche;
		for ( const [ m, v ] of [ [ M.led, L.led ], [ M.ledWall, L.ledWall ], [ M.ledFloor, L.ledFloor ] ] ) { m.emissive.set( L.ledColor ); m.emissiveIntensity = v; }
		M.staff.color.set( L.ledColor ).multiplyScalar( 0.75 * L.ledWall );		// (on the ceiling, but ornament: the walls' tier)
		for ( const m of this.glow ) { m.emissive.set( L.ledColor ); m.emissiveIntensity = 0.8 * L.ledWall; }
		if ( this.nicheLights.length !== this.nichePoints.length ) {

			for ( const l of this.nicheLights ) this.lights.remove( l );
			this.nicheLights = this.nichePoints.map( n => {

				const l = new THREE.PointLight( '#ffffff', 0, n.kind === 'clef' ? 4 : 2.5, 2 );
				l.position.copy( n.light );
				this.lights.add( l );
				return l;

			} );

		}
		for ( const [ i, l ] of this.nicheLights.entries() ) { l.color.set( L.nicheColor ); l.intensity = L.niche * ( this.nichePoints[ i ].kind === 'clef' ? 3 : 1.2 ); l.visible = L.niche > 0; }
		M.sky.color.setScalar( this.pack ? L.sky : 0.25 * L.sky );
		const size = this.highQuality ? 4096 : 2048;
		if ( this.keySpot.shadow.mapSize.x !== size ) {

			this.keySpot.shadow.mapSize.set( size, size );
			this.keySpot.shadow.map?.dispose();
			this.keySpot.shadow.map = null;

		}
		if ( this.active ) this.scene.background = this.background;

	}

	setQuality( hq ) { this.highQuality = hq; this.updateLights(); }

	setMode( mode ) { this.mode = mode; this.updateLights(); }

	// ---------------------------------------------------------------------
	/** Load the pack (once): the furniture, the reliefs, the sky and the floor's marble. */
	load() {

		this._loadTried = true;
		const url = new URL( 'luminara/luminara.glb', new URL( import.meta.env.BASE_URL, location.href ) );
		this.loading = prefetchLuminara().then( buf => new GLTFLoader().setMeshoptDecoder( MeshoptDecoder ).parseAsync( buf, url.href ) ).then( gltf => {

			this._build( gltf );
			this.updateLights();
			this.onLoad?.();

		} ).catch( e => console.warn( `Luminara: ${ e.message ?? e } (the pack: tools/luminara-asset.mjs)` ) );
		return this.loading;

	}

	_build( gltf ) {

		const M = this.materials, nodes = {};
		gltf.scene.traverse( o => { if ( o.name && o.parent === gltf.scene ) nodes[ o.name ] = o; } );
		const mapOf = name => { let t = null; nodes[ name ]?.traverse( o => { if ( o.material?.map ) t = o.material.map; } ); return t; };
		// the textures on the swatches
		const sky = mapOf( 'sky' ), marble = mapOf( 'marble' );
		if ( sky ) {

			// (glTF images are not flipped: v down; the cylinder's v is up)
			sky.colorSpace = THREE.SRGBColorSpace; sky.wrapS = THREE.MirroredRepeatWrapping; sky.repeat.set( this.skyReps, - 1 ); sky.offset.set( 0, 1 ); sky.needsUpdate = true;
			M.sky.map = sky; M.sky.color.set( '#ffffff' ); M.sky.needsUpdate = true;

		}
		if ( marble ) {

			marble.colorSpace = THREE.SRGBColorSpace; marble.wrapS = marble.wrapT = THREE.RepeatWrapping; marble.anisotropy = 8; marble.needsUpdate = true;
			for ( const m of [ M.floor, M.border ] ) { m.map = marble; m.needsUpdate = true; }
			M.border.color.set( '#b9b2a6' );

		}
		// our materials for the pack's (by extras.look)
		const ours = new Map();
		const finish = m => {

			if ( ours.has( m ) ) return ours.get( m );
			const look = m.userData.look, base = { color: m.color, roughness: m.roughness, metalness: m.metalness };
			const p = {
				brass: () => phys( { color: '#d6a95c', metalness: 1, roughness: 0.28 } ),
				lacquer: () => phys( { color: '#f3f1ed', roughness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.15 } ),		// (more: the shell mirrors the room and reads as glass)
				boucle: () => phys( { color: '#ebe6dc', roughness: 0.95, sheen: 0.7, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.7 } ),
				marble: () => phys( { color: '#f1efec', map: marble, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.05 } ),
				ceramic: () => phys( { color: '#efede8', roughness: 0.5 } ),
				foliage: () => phys( { color: new THREE.Color( 1.5, 2.1, 1.25 ), vertexColors: true,		// (the decoder's olive: dark and grey)
					 roughness: 0.65, side: THREE.DoubleSide } ),
				natural: () => phys( { color: '#ffffff', vertexColors: true, roughness: 0.85 } ),
				relief: () => phys( { color: '#ffffff', map: m.map, normalMap: m.normalMap, normalMapType: THREE.ObjectSpaceNormalMap, roughness: 0.55, side: THREE.DoubleSide,
					...( m.emissiveMap ? { emissiveMap: m.emissiveMap, emissive: new THREE.Color( '#ffd9a6' ) } : {} ) } ),		// (the clef's gold: a line of light)
			}[ look ]?.() ?? phys( base );
			if ( p.map ) p.map.colorSpace = THREE.SRGBColorSpace;
			p.name = m.name;
			if ( p.emissiveMap ) this.glow.push( p );
			ours.set( m, p );
			return p;

		};
		const pack = new THREE.Group();
		pack.name = 'luminara:pack';
		const place = ( name, F, mirror = false ) => {

			if ( ! nodes[ name ] ) return;
			const holder = new THREE.Group();
			holder.matrixAutoUpdate = false;
			holder.matrix.copy( F );
			if ( mirror ) holder.matrix.multiply( new THREE.Matrix4().makeScale( - 1, 1, 1 ) );
			const o = nodes[ name ].clone();
			o.traverse( c => { if ( c.isMesh ) { c.material = finish( c.material ); c.castShadow = c.receiveShadow = true; } } );
			holder.add( o );
			pack.add( holder );

		};
		for ( const [ name, deg, r, turn ] of FURNITURE ) place( name, frameAt( deg * Math.PI / 180, r ).multiply( new THREE.Matrix4().makeRotationY( turn * Math.PI / 180 ) ) );
		// the reliefs in their niches: the clef on its back (raised a little), the shelves' objects on
		// the sill and each shelf (every other one mirrored)
		for ( const n of this.nichePoints ) {

			if ( n.kind === 'clef' ) place( 'clef', n.F.clone().multiply( new THREE.Matrix4().makeTranslation( 0, n.o.y0 + 0.3, 0.02 ) ) );
			else[ n.o.y0, 1.25, 2.0 ].forEach( ( y, i ) => place( 'shelf', n.F.clone().multiply( new THREE.Matrix4().makeTranslation( 0, y, 0.04 ) ), i % 2 === 1 ) );

		}
		this.pack = pack;
		this.group.add( pack );

	}

}

let prefetch = null;
/** Start fetching the pack (safe to call repeatedly); resolves to its bytes. */
export function prefetchLuminara() {

	if ( prefetch ) return prefetch;
	const url = new URL( 'luminara/luminara.glb', new URL( import.meta.env.BASE_URL, location.href ) );
	prefetch = fetch( url, { priority: 'high' } ).then( r => { if ( ! r.ok ) throw new Error( `luminara.glb: HTTP ${ r.status }` ); return r.arrayBuffer(); } );
	return prefetch;

}

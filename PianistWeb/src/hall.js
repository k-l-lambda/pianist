// Concert hall: the grands' venue (room.js has the uprights'). After Carnegie Hall's Isaac Stern
// Auditorium at about 0.65 (stage height, seats and people at full size): a raised stage with a
// rounded lip in a shell under an elliptic proscenium arch (13 m span, crown 11.5 m), a gilt
// lighting ring over the stage like the hall's "Tiara"; a U of tiers round the parquet, each
// coming forward less along the sides than at the back (two of boxes, a dress circle with thin
// side arms, a deep balcony whose sides stop half way); a flat ceiling with a shallow oval recess
// and two rings of lamps (32 and 96), no chandelier. Ivory plaster, gilt mouldings, red seats.
// Proportions from the hall's figures (ceiling 25 m, stage 12.8 m deep, 2,804 seats: parquet
// 1,021, boxes 264 + 238, dress circle 430, balcony 837) and its seating chart; the rest
// estimated from photographs. The stage and round it in detail, the far tiers simply (rows of
// seats as swept profiles).
//
// Built in the hall's own frame (x across, the audience's right positive; y up, the stage floor
// at 0; z from the proscenium towards the back of the hall, the stage at z < 0), then baked into
// world space: the audience looks at the piano's bentside (world +x), its keyboard on their left,
// as at a recital; the piano itself stays where the room keeps it (keyboard towards +z).
// Same venue interface as Room (see room.js).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxProjectUV } from './geometry.js';
import { BERLIN, BERLIN_CHANDELIERS, berlinStatus, berlinToHall, loadBerlinHall, setBerlinLamps } from './berlinhall.js';

// dimensions (m), hall frame; about 0.65 of the real hall
export const HALL = {
	stageWidth: 13,		// at the proscenium
	shellWidth: 11.8,		// the stage enclosure: between its side walls, ...
	corner: 2.6,			// ... the radius of its rounded back corners,
	shellWall: 7.0,		// ... its walls' height (to the top of the cornice),
	cove: 0.9,				// ... the cove up to its flat ceiling: run and rise,
	coveRise: 1.2,
	vaultFrom: 2.5,		// ... and from there to the arch (m behind it) a vault
	stageDepth: 8.3,		// proscenium to back wall
	lip: 1.3,				// the rounded lip's bulge in front of the proscenium
	stageHeight: 1.0,		// above the parquet's front
	archSpring: 7.0,		// proscenium: where the arch springs ...
	archCrown: 11.5,		// ... and its crown, above the stage floor
	tiara: 7.4,			// the lighting ring over the stage
	width: 17.5,			// between the side walls
	length: 22.5,			// proscenium to the back wall (at the centre)
	ceiling: 15.5,			// above the stage floor
	pianoAt: 2.4,			// the piano's centre, behind the proscenium line
	// tiers from the bottom: floor height above the stage floor, depth (wall to parapet) at the
	// back and along the sides, the rise of its seating to the wall, where it starts along the
	// side walls (z), boxes or rows
	tiers: [
		{ name: 'first tier', y: 2.9, depth: 2.0, side: 2.0, rake: 0.35, start: 0.9, boxes: true },
		{ name: 'second tier', y: 5.4, depth: 2.0, side: 2.0, rake: 0.35, start: 0.9, boxes: true },
		{ name: 'dress circle', y: 8.0, depth: 3.0, side: 1.25, rake: 1.2, start: 0.9 },
		{ name: 'balcony', y: 10.6, depth: 6.0, side: 3.0, rake: 2.6, start: 11 },
	],
};

export const HALL_PRESETS = {
	// the default: the piano alone in a pool of light, the hall dark round it (the probe's ambient
	// light `env` down too: otherwise the lit stage, captured, lights the whole hall again)
	'Spotlight': { key: 0, keyColor: '#fff1de', top: 1000, topColor: '#fff0dc', topAngle: 15, wash: 0.04, washColor: '#ffd9ad', house: 1.2, houseColor: '#ffcf94', lamps: 0.02, env: 0.12, exposure: 1.25 },
	'Recital': { key: 900, keyColor: '#fff1de', top: 420, topColor: '#ffe4c0', topAngle: 24, wash: 5, washColor: '#ffd9ad', house: 0.5, houseColor: '#ffcf94', lamps: 1, env: 1, exposure: 1.0 },
	'House lights up': { key: 600, keyColor: '#fff1de', top: 260, topColor: '#ffe4c0', topAngle: 24, wash: 4, washColor: '#ffd9ad', house: 3.5, houseColor: '#ffd29c', lamps: 1, env: 1, exposure: 0.85 },
	'Rehearsal': { key: 500, keyColor: '#ffffff', top: 250, topColor: '#fff8ee', topAngle: 26, wash: 9, washColor: '#f6f1e8', house: 2.4, houseColor: '#f6efe3', lamps: 0.4, env: 1, exposure: 0.9 },
};

// the Konzerthaus Berlin (src/berlinhall.js): the same presets, its house lights its 14
// chandeliers (and the wall sconces' glow), its lamps the candelabras round the stalls
export const BERLIN_PRESETS = {
	// (ACES: the gilt and the shadows under the galleries keep their contrast, as in the hall's
	// renders; less saturated, as ACES warms the ivory towards yellow); bloom (also in real time)
	// over the lit bulbs only: the walls stay under ~1.6 in the HDR buffer, the organ's highlights
	// ~3, the bulbs reach 7-10
	'Spotlight': { key: 0, keyColor: '#fff1de', top: 1000, topColor: '#fff0dc', topAngle: 15, wash: 0.04, washColor: '#ffd9ad', house: 0.06, houseColor: '#ffc98a', lamps: 0.15, env: 0.12, exposure: 1.25 },
	'Recital': { key: 900, keyColor: '#fff4e6', top: 420, topColor: '#ffeedd', topAngle: 24, wash: 2, washColor: '#ffe9d2', house: 0.3, houseColor: '#ffe6c6', lamps: 0.5, env: 0.1, exposure: 0.75, tone: 'ACES', saturation: 0.75, bloom: 0.3, bloomThreshold: 4 },
	'House lights up': { key: 600, keyColor: '#fff4e6', top: 260, topColor: '#ffeedd', topAngle: 24, wash: 1.5, washColor: '#ffe9d2', house: 1, houseColor: '#ffeedd', lamps: 1, env: 0.15, exposure: 0.56, tone: 'ACES', saturation: 0.75, bloom: 0.3, bloomThreshold: 4 },
	'Rehearsal': { key: 500, keyColor: '#ffffff', top: 250, topColor: '#fff8ee', topAngle: 26, wash: 5, washColor: '#f6f1e8', house: 0.6, houseColor: '#fff4e8', lamps: 0.3, env: 0.2, exposure: 0.62, tone: 'ACES', saturation: 0.7, bloom: 0.25, bloomThreshold: 4 },
};
const CHANDELIER_CD = 45;		// each chandelier's intensity (cd) at house = 1

const PIANO_Z = - HALL.pianoAt;
const H_WASH = HALL.shellWall + HALL.coveRise - 0.35;		// the stage wash, under the shell's ceiling
// hall frame -> world: the audience's direction (+z) to world +x, the piano's spot to the origin
const TO_WORLD = new THREE.Matrix4().set(
	0, 0, 1, - PIANO_Z,
	0, 1, 0, 0,
	- 1, 0, 0, 0,
	0, 0, 0, 1 );

const phys = p => new THREE.MeshPhysicalMaterial( { side: THREE.DoubleSide, ...p } );

// Tangent-space normal map of a moulded gilt band: across v (in metres along the strip's profile,
// so the ribs run along the strip), per 0.12 m a fat bead between two fine ones, with grooves
function ribNormalMap() {

	const N = 256, data = new Uint8Array( 4 * N * 4 );
	const bump = ( v, c, w ) => { const x = ( v - c ) / w; return Math.abs( x ) < 1 ? Math.sqrt( 1 - x * x ) * w : 0; };
	const h = v => bump( v, 0.2, 0.09 ) + bump( v, 0.5, 0.17 ) + bump( v, 0.8, 0.09 );
	for ( let j = 0; j < N; ++ j ) {

		const v = j / N, e = 0.5 / N;
		const d = ( h( ( v + e ) % 1 ) - h( ( v - e + 1 ) % 1 ) ) / ( 2 * e ) * 0.6;
		const l = Math.hypot( d, 1 );
		for ( let i = 0; i < 4; ++ i ) {

			const k = 4 * ( j * 4 + i );
			data[ k ] = 128;
			data[ k + 1 ] = Math.round( 255 * ( 0.5 - 0.5 * d / l ) );
			data[ k + 2 ] = Math.round( 255 * ( 0.5 + 0.5 / l ) );
			data[ k + 3 ] = 255;

		}

	}

	const t = new THREE.DataTexture( data, 4, N );
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.repeat.set( 1, 1 / 0.12 );
	t.magFilter = THREE.LinearFilter;
	t.minFilter = THREE.LinearMipmapLinearFilter;
	t.generateMipmaps = true;
	t.needsUpdate = true;
	return t;

}
const V2 = THREE.Vector2;

export class ConcertHall {

	constructor( scene, baker ) {

		this.scene = scene;
		this.baker = baker;
		this.highQuality = true;
		this.preset = 'Spotlight';
		this.light = { ...BERLIN_PRESETS[ this.preset ] };
		this.group = new THREE.Group();
		this.group.name = 'hall';
		this.lights = new THREE.Group();
		this.lights.name = 'hallLights';
		this.active = false;
		this.view = { maxDistance: 20, maxPolarAngle: Math.PI * 0.62 };
		this.background = new THREE.Color( 0x000000 );

		const plaster = baker.plaster(), ceil = baker.ceilingPlaster(), oak = baker.floorOak();
		const tinted = ( hex, base ) => {

			const c = new THREE.Color( hex ), b = new THREE.Color( base );
			return new THREE.Color( c.r / b.r, c.g / b.g, c.b / b.b );

		};

		this.materials = {
			plaster: phys( { map: plaster.map, normalMap: plaster.normalMap, roughnessMap: plaster.roughnessMap, roughness: 1, color: tinted( '#e8dcc2', '#9aa39a' ) } ),
			panel: phys( { map: plaster.map, normalMap: plaster.normalMap, roughness: 0.9, color: tinted( '#d9c9a6', '#9aa39a' ) } ),
			ceiling: phys( { map: ceil.map, normalMap: ceil.normalMap, roughness: 0.95, color: tinted( '#efe5cf', '#d8d6d0' ) } ),
			// gilding: partly metallic (a full metal mirrors the dark hall and reads as black)
			gold: phys( { color: '#d0a95a', metalness: 0.45, roughness: 0.38 } ),
			// the walls' gilt bands and strips: gilding on plaster, mostly diffuse (a full metal
			// mirrors the dark hall and reads as black bars), its relief a normal map of ribs
			// across the strip (ribNormalMap)
			ornament: phys( { color: '#d2ae66', metalness: 0.3, roughness: 0.45, normalMap: ribNormalMap(), normalScale: new THREE.Vector2( 1, 1 ) } ),
			// the same gilding, plain: the walls' vertical strips (ribs across them read wrong)
			gilt: phys( { color: '#d2ae66', metalness: 0.3, roughness: 0.45 } ),
			velvet: phys( { color: '#5e0c13', roughness: 0.92, sheen: 1, sheenColor: new THREE.Color( '#b8303c' ), sheenRoughness: 0.45 } ),
			wood: phys( { color: '#3b2417', roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3 } ),
			stage: phys( { map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.roughnessMap, roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.2, color: tinted( '#8e5f36', '#b08a62' ) } ),
			parquet: phys( { map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.roughnessMap, roughness: 1, clearcoat: 0.2, clearcoatRoughness: 0.35, color: tinted( '#6c4a2e', '#b08a62' ) } ),
			lamp: new THREE.MeshStandardMaterial( { color: '#2a2016', emissive: new THREE.Color( '#ffd49a' ), emissiveIntensity: 5, roughness: 0.6 } ),
			glow: new THREE.MeshStandardMaterial( { color: '#e9dcc0', emissive: new THREE.Color( '#ffe2b4' ), emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide } ),
		};

		this._buildLights();
		this.rebuild();
		// the shell: 'berlin' (src/berlinhall.js, loaded when the hall is first entered) or
		// 'procedural' (built here; also when the Berlin packs are not there)
		this.model = 'berlin';
		this.berlin = null;			// its group once loaded (null: not loaded, or not there)
		this.loading = Promise.resolve();
		this.onModel = null;		// called when the shell shown changes (main.js: lights, GUI)
		this.precompile = null;		// async ( object ): compile its shaders as the frame will draw it (main.js)

	}

	activate() {

		this.active = true;
		this.scene.add( this.group, this.lights );
		if ( this.berlin ) this.scene.add( this.berlin );
		if ( this.model === 'berlin' && ! this._berlinTried ) this.setModel( 'berlin' );		// (first entry: load it)
		this._showModel();
		this.updateLights();

	}

	deactivate() {

		this.active = false;
		this.scene.remove( this.group, this.lights );
		if ( this.berlin ) this.scene.remove( this.berlin );

	}

	/** The shell: 'procedural' or 'berlin'. Resolves once it shows (the procedural one when the
	 * Berlin packs are not there). */
	setModel( name ) {

		const was = this.berlinShown;
		this.model = name;
		if ( name === 'berlin' && ! this.berlin && ! this._berlinTried ) {

			this._berlinTried = true;
			this.berlinLoading = true;		// (meanwhile neither shell shows: not the procedural one first)
			this._showModel();
			this.loading = loadBerlinHall( { toWorld: TO_WORLD, pianoZ: PIANO_Z, renderer: this.baker.renderer } ).then( async g => {

				this.berlin = g;
				if ( ! g ) { this.berlinLoading = false; this._shellChanged( false ); return; }
				// its presets and lights first (still hidden: berlinLoading), then its shaders compiled
				// for those lights (one long freeze at its first frame otherwise), then shown
				if ( this.active ) this.scene.add( g );
				this._shellChanged( false );
				berlinStatus.phase = 'compile';
				await this.precompile?.( g );
				berlinStatus.phase = 'ready';
				this.berlinLoading = false;
				this._shellChanged( true );

			} );

		} else this._shellChanged( was );
		return this.loading;

	}

	get berlinShown() { return this.model === 'berlin' && !! this.berlin; }

	/** The presets of the shell shown (the procedural one's while Berlin loads or is not there). */
	get presets() { return this.berlinShown ? BERLIN_PRESETS : HALL_PRESETS; }

	_shellChanged( was ) {

		this._showModel();
		if ( this.berlinShown !== was ) Object.assign( this.light, { tone: undefined, toneFade: undefined, saturation: undefined, bloom: undefined, bloomThreshold: undefined }, this.presets[ this.preset ] );		// the preset, in this shell
		this.updateLights();
		this.onModel?.();

	}

	_showModel() {

		this.group.visible = ! this.berlinShown && ! ( this.model === 'berlin' && this.berlinLoading );
		if ( this.berlin ) this.berlin.visible = this.berlinShown && ! this.berlinLoading;		// (hidden while its shaders compile)

	}

	/** World point of a point in the Berlin packs' frame. */
	fromBerlin( x, y, z ) {

		return new THREE.Vector3( x, y, z ).applyMatrix4( berlinToHall( PIANO_Z ) ).applyMatrix4( TO_WORLD );

	}

	get keyLight() { return this.light.key > 0 ? this.keySpot : this.topSpot; }
	get specularOff() { return []; }		// a lit stage belongs in the lacquer
	get probeHidden() { return []; }
	get environment() { return null; }
	keyLightRadius() { return 0.02; }

	/** World point of a hall-frame point. */
	toWorld( x, y, z ) {

		return new THREE.Vector3( x, y, z ).applyMatrix4( TO_WORLD );

	}

	/** The piano's footprint centred on its spot. */
	place( piano ) {

		piano.group.position.set( 0, 0, 0 );
		piano.group.rotation.set( 0, 0, 0 );
		piano.group.updateMatrixWorld( true );
		const c = new THREE.Box3().setFromObject( piano.group ).getCenter( new THREE.Vector3() );
		piano.group.position.set( - c.x, 0, - c.z );

	}

	probePoint() {

		return this.toWorld( 0, 1.2, PIANO_Z + 2.6 );

	}

	/** The stage floor (world). */
	bounds() {

		if ( this.berlinShown ) {		// the front strip, before the first riser

			const a = this.fromBerlin( - BERLIN.stageWidth / 2 + 1.5, 0, - BERLIN.apronDepth + 0.2 ), b = this.fromBerlin( BERLIN.stageWidth / 2 - 1.5, 0, - 0.3 );
			return { minX: Math.min( a.x, b.x ), maxX: Math.max( a.x, b.x ), minZ: Math.min( a.z, b.z ), maxZ: Math.max( a.z, b.z ) };

		}
		const H = HALL, a = this.toWorld( - H.stageWidth / 2 + 0.4, 0, - H.stageDepth + 0.4 ), b = this.toWorld( H.stageWidth / 2 - 0.4, 0, H.lip - 0.3 );
		return { minX: Math.min( a.x, b.x ), maxX: Math.max( a.x, b.x ), minZ: Math.min( a.z, b.z ), maxZ: Math.max( a.z, b.z ) };

	}

	/** The offline sound's shoebox (tools/spatialise.py): the Berlin hall's (room `berlin`) when it is the
	 * model, else the procedural hall's (room `hall`: the stage's back wall to the hall's, wall to wall, the
	 * stage floor to the ceiling; world; the parquet below the stage's floor, the shell's lower ceiling and
	 * the tiers are in its surfaces, not its shape). */
	acousticBox() {

		if ( this.model === 'berlin' ) {

			// the Konzerthaus's Großer Saal (the packs, measured: wall to wall x ±11 m at 3-9 m up, the organ's
			// end z -14.3 to the back gallery's wall 24.8, the stalls floor y 0 to the coffered ceiling 16.2;
			// ~14,000 m³: the hall's own ~15,000 less the galleries' fronts); minY: the stalls floor (world),
			// below the stage's front strip the piano stands on (spatialise.py room `berlin`)
			const a = this.fromBerlin( - 11, 0, - 14.3 ), b = this.fromBerlin( 11, 16.2, 24.8 );
			return { minX: Math.min( a.x, b.x ), maxX: Math.max( a.x, b.x ), minZ: Math.min( a.z, b.z ), maxZ: Math.max( a.z, b.z ), minY: a.y, height: b.y - a.y, acoustics: 'berlin' };

		}
		const H = HALL, a = this.toWorld( - H.width / 2, 0, - H.stageDepth ), b = this.toWorld( H.width / 2, 0, H.length );
		return { minX: Math.min( a.x, b.x ), maxX: Math.max( a.x, b.x ), minZ: Math.min( a.z, b.z ), maxZ: Math.max( a.z, b.z ), height: H.ceiling, acoustics: 'hall' };

	}

	/** Viewpoints (world): a seat in the stalls, the dress circle, the side of the stage. */
	views() {

		if ( this.berlinShown ) {		// the same names: the stalls, a side gallery, the back gallery, the stage

			const t = this.fromBerlin( 0, BERLIN.apronHeight + 0.9, - BERLIN.pianoAt ), B = ( x, y, z ) => this.fromBerlin( x, y, z );
			return {
				'Stalls, row 8': { position: B( 3.6, 1.2, 10 ), target: B( 0, BERLIN.apronHeight + 1.0, - BERLIN.pianoAt ) },
				'Dress circle': { position: B( - 9.4, 8.3, 6 ), target: t },
				'Balcony': { position: B( - 3, 5.3, 21.5 ), target: t },
				'From the stage': { position: B( - 2.5, BERLIN.apronHeight + 1.7, - 2.3 ), target: B( 0, 4, 15 ) },
				'The shell': { position: B( 2.2, 2.8, 4 ), target: B( - 1, 4, - 8 ) },
			};

		}
		const t = this.toWorld( 0, 0.9, PIANO_Z );
		return {
			'Stalls, row 8': { position: this.toWorld( 3.6, - HALL.stageHeight + 0.05 * 7.5 + 1.25, 10 ), target: this.toWorld( 0, 2.6, PIANO_Z ) },
			'Dress circle': { position: this.toWorld( - 3, HALL.tiers[ 2 ].y + 1.5, 17 ), target: t },
			'Balcony': { position: this.toWorld( 2, HALL.tiers[ 3 ].y + 2.6, 20 ), target: t },
			'From the stage': { position: this.toWorld( - 2.5, 1.7, - 6.5 ), target: this.toWorld( 0, 4, 12 ) },
			'The shell': { position: this.toWorld( 2.2, 2.2, 6 ), target: this.toWorld( - 1, 3.6, - 6 ) },
		};

	}

	lightControls() {

		const berlin = this.berlinShown;
		return [
			[ 'key', 0, 3000, 10, 'Front spot' ], [ 'keyColor', 'color', 'Front spot color' ],
			[ 'top', 0, 3000, 10, 'Top light' ], [ 'topColor', 'color', 'Top light color' ],
			[ 'wash', 0, 30, 0.1, 'Stage wash' ], [ 'washColor', 'color', 'Stage wash color' ],
			berlin ? [ 'house', 0, 3, 0.01, 'Chandeliers' ] : [ 'house', 0, 10, 0.01, 'House lights' ], [ 'houseColor', 'color', berlin ? 'Chandelier color' : 'House color' ],
			[ 'topAngle', 5, 40, 0.5, 'Top light cone (°)' ],
			[ 'lamps', 0, 3, 0.01, berlin ? 'Candelabras' : 'Lamps (ceiling, Tiara)' ],
			[ 'env', 0, 1.5, 0.01, 'Ambient (probe)' ],
		];

	}

	// ---------------------------------------------------------------------
	rebuild() {

		for ( const child of [ ...this.group.children ] ) {

			child.geometry?.dispose();
			this.group.remove( child );

		}

		const parts = new Map();		// material -> geometries (hall frame)
		const add = ( mat, geo ) => {

			if ( ! parts.has( mat ) ) parts.set( mat, [] );
			parts.get( mat ).push( geo );
			return geo;

		};

		this._stage( add );
		this._proscenium( add );
		this._auditorium( add );
		this._ceiling( add );

		// one mesh per material, in world space
		const textured = new Set( [ this.materials.plaster, this.materials.panel, this.materials.ceiling, this.materials.stage, this.materials.parquet, this.materials.ornament ] );
		for ( const [ mat, geos ] of parts ) {

			const list = geos.map( g => {

				const metric = g.userData.metricUV && mat === this.materials.ornament;		// keep the sweep's own UVs
				let h = g.index ? g.toNonIndexed() : g.clone();
				for ( const k of Object.keys( h.attributes ) ) if ( ! [ 'position', 'normal', 'uv' ].includes( k ) ) h.deleteAttribute( k );
				h.applyMatrix4( TO_WORLD );
				if ( textured.has( mat ) && ! metric ) h = boxProjectUV( h, { grain: 'x', offset: [ 0, 0 ], angle: 0 } );
				if ( ! h.attributes.normal ) h.computeVertexNormals();
				if ( ! h.attributes.uv ) h.setAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( h.attributes.position.count * 2 ), 2 ) );
				g.dispose();
				return h;

			} );
			const geo = mergeGeometries( list, false );
			list.forEach( g => g.dispose() );
			const mesh = new THREE.Mesh( geo, mat );
			mesh.castShadow = mat !== this.materials.lamp && mat !== this.materials.glow;
			mesh.receiveShadow = true;
			mesh.name = 'hall';
			this.group.add( mesh );

		}

		this.updateLights();

	}

	// a box between two corners (hall frame)
	static box( ax, ay, az, bx, by, bz ) {

		return new THREE.BoxGeometry( bx - ax, by - ay, bz - az ).translate( ( ax + bx ) / 2, ( ay + by ) / 2, ( az + bz ) / 2 );

	}

	// a flat shape in the (x, z) plane at height y (pts: [x, z])
	static floorShape( pts, y, holes = [] ) {

		const s = new THREE.Shape( pts.map( ( [ x, z ] ) => new V2( x, - z ) ) );
		for ( const h of holes ) s.holes.push( new THREE.Path( h.map( ( [ x, z ] ) => new V2( x, - z ) ) ) );
		return new THREE.ShapeGeometry( s, 24 ).rotateX( - Math.PI / 2 ).translate( 0, y, 0 );

	}

	// a strip through 3D points (rows of [x, y, z] of equal length): quads between rows
	static grid( rows ) {

		const n = rows.length, m = rows[ 0 ].length, pos = [], idx = [];
		for ( const r of rows ) for ( const p of r ) pos.push( p[ 0 ], p[ 1 ], p[ 2 ] );
		for ( let i = 0; i < n - 1; ++ i ) for ( let j = 0; j < m - 1; ++ j ) {

			const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
			idx.push( a, c, b, b, c, d );

		}

		// UVs in metres: u along the rows (the sweep's path), v along each row (its profile)
		const uv = new Float32Array( n * m * 2 ), P = ( i, j ) => rows[ i ][ j ];
		for ( let i = 0; i < n; ++ i ) for ( let j = 0; j < m; ++ j ) {

			const k = i * m + j;
			uv[ 2 * k ] = i ? uv[ 2 * ( k - m ) ] + Math.hypot( P( i, j )[ 0 ] - P( i - 1, j )[ 0 ], P( i, j )[ 1 ] - P( i - 1, j )[ 1 ], P( i, j )[ 2 ] - P( i - 1, j )[ 2 ] ) : 0;
			uv[ 2 * k + 1 ] = j ? uv[ 2 * ( k - 1 ) + 1 ] + Math.hypot( P( i, j )[ 0 ] - P( i, j - 1 )[ 0 ], P( i, j )[ 1 ] - P( i, j - 1 )[ 1 ], P( i, j )[ 2 ] - P( i, j - 1 )[ 2 ] ) : 0;

		}

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
		g.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
		g.setIndex( idx );
		g.computeVertexNormals();
		g.userData.metricUV = true;
		return g;

	}

	// the horseshoe in plan, `d` in from the walls: points from the proscenium end of the left
	// side (z = zs) round the back to the right side's; each { x, z, nx, nz } (normal into the
	// hall), w: 0 along the sides, 1 at the back's centre
	static horseshoe( d, zs, step = 0.5 ) {

		const H = HALL, r = H.width / 2 - d, zc = H.length - H.width / 2, out = [];
		const side = ( x, nx, z0, z1 ) => {

			const n = Math.max( 1, Math.ceil( Math.abs( z1 - z0 ) / step ) );
			for ( let i = 0; i <= n; ++ i ) out.push( { x, z: z0 + ( z1 - z0 ) * i / n, nx, nz: 0, w: 0 } );

		};
		if ( zc > zs ) side( - r, 1, zs, zc );
		const na = Math.max( 8, Math.ceil( Math.PI * r / step ) );
		for ( let i = 0; i <= na; ++ i ) {

			const a = Math.PI * ( 1 - i / na );
			out.push( { x: r * Math.cos( a ), z: zc + r * Math.sin( a ), nx: - Math.cos( a ), nz: - Math.sin( a ), w: Math.sin( a ) } );

		}

		if ( zc > zs ) side( r, - 1, zc, zs );
		return out;

	}

	// sweep a profile ([u, y]: u into the hall from the path; or a function of the path point
	// giving one) along a horseshoe path
	static sweep( path, profile ) {

		return ConcertHall.grid( path.map( p => ( typeof profile === 'function' ? profile( p ) : profile ).map( ( [ u, y ] ) => [ p.x + p.nx * u, y, p.z + p.nz * u ] ) ) );

	}

	// ---------------------------------------------------------------------
	// the stage enclosure's wall line in plan, `d` in from the wall face: from the proscenium on
	// the left, along the side wall, round the corner, the back wall, the other corner, to the
	// proscenium on the right. Points { x, z, nx, nz (into the stage), s (length along) }
	static shellPath( d = 0, step = 0.25 ) {

		const H = HALL, w = H.shellWidth / 2 - d, r = Math.max( 0.05, H.corner - d ), zb = - H.stageDepth + d;
		const out = [];
		const push = ( x, z, nx, nz ) => out.push( { x, z, nx, nz } );
		const line = ( x0, z0, x1, z1, nx, nz ) => {

			const n = Math.max( 1, Math.ceil( Math.hypot( x1 - x0, z1 - z0 ) / step ) );
			for ( let i = out.length ? 1 : 0; i <= n; ++ i ) push( x0 + ( x1 - x0 ) * i / n, z0 + ( z1 - z0 ) * i / n, nx, nz );

		};
		const corner = ( cx, cz, a0, a1 ) => {

			const n = Math.max( 6, Math.ceil( Math.abs( a1 - a0 ) * r / ( step * 0.6 ) ) );
			for ( let i = 1; i <= n; ++ i ) {

				const a = a0 + ( a1 - a0 ) * i / n;
				push( cx + r * Math.cos( a ), cz + r * Math.sin( a ), - Math.cos( a ), - Math.sin( a ) );

			}

		};
		line( - w, 0, - w, zb + r, 1, 0 );
		corner( - w + r, zb + r, Math.PI, 1.5 * Math.PI );
		line( - w + r, zb, w - r, zb, 0, 1 );
		corner( w - r, zb + r, 1.5 * Math.PI, 2 * Math.PI );
		line( w, zb + r, w, 0, - 1, 0 );
		let acc = 0;
		out.forEach( ( p, i ) => {

			if ( i ) acc += Math.hypot( p.x - out[ i - 1 ].x, p.z - out[ i - 1 ].z );
			p.s = acc;

		} );
		return out;

	}

	// a point on a path at length s (interpolated)
	static pathAt( path, s ) {

		let i = 1;
		while ( i < path.length - 1 && path[ i ].s < s ) ++ i;
		const p = path[ i - 1 ], q = path[ i ], u = THREE.MathUtils.clamp( ( s - p.s ) / Math.max( 1e-6, q.s - p.s ), 0, 1 );
		const nx = p.nx + ( q.nx - p.nx ) * u, nz = p.nz + ( q.nz - p.nz ) * u, nl = Math.hypot( nx, nz );
		return { x: p.x + ( q.x - p.x ) * u, z: p.z + ( q.z - p.z ) * u, nx: nx / nl, nz: nz / nl, s };

	}

	_stage( add ) {

		const H = HALL, M = this.materials, W = H.stageWidth / 2, D = H.stageDepth, S = H.shellWidth / 2;
		const path = ConcertHall.shellPath( 0 ), L = path[ path.length - 1 ].s;
		const sweep = prof => ConcertHall.sweep( path, prof );
		const sub = ( s0, s1 ) => path.filter( p => p.s >= s0 && p.s <= s1 );
		const sweepPart = ( s0, s1, prof ) => {

			const pts = [ ConcertHall.pathAt( path, s0 ), ...sub( s0 + 1e-6, s1 - 1e-6 ), ConcertHall.pathAt( path, s1 ) ];
			return ConcertHall.sweep( pts, prof );

		};

		// the lip: rounded corners into a gentle bulge, as in the hall
		const lip = [];
		{

			const R = ( W * W + H.lip * H.lip ) / ( 2 * H.lip ), zc = H.lip - R;
			for ( let i = 0; i <= 48; ++ i ) {

				const x = - W + 2 * W * i / 48;
				lip.push( [ x, zc + Math.sqrt( Math.max( 0, R * R - x * x ) ) ] );

			}

		}

		// floor: the enclosure's plan, out to the lip
		add( M.stage, ConcertHall.floorShape( [ ...path.map( p => [ p.x, p.z ] ), [ W, 0.0 ], ...lip.slice().reverse(), [ - W, 0.0 ] ], 0 ) );
		add( M.wood, ConcertHall.grid( [ lip.map( ( [ x, z ] ) => [ x, - H.stageHeight, z ] ), lip.map( ( [ x, z ] ) => [ x, - 0.06, z ] ) ] ) );
		add( M.gold, ConcertHall.grid( [ lip.map( ( [ x, z ] ) => [ x, - 0.06, z + 0.02 ] ), lip.map( ( [ x, z ] ) => [ x, 0.0, z + 0.02 ] ) ] ) );

		// the wall, one profile all round (u: out of the wall face into the stage), after the hall:
		// a plinth with a gilt grille, a tall panelled dado (about a third of the wall), a deep
		// ledge on it, the upper field, a frieze, a stepped cornice
		const Hw = H.shellWall, dd = 2.2, fr0 = Hw - 1.0, fr1 = Hw - 0.5;
		// the doors rise through the dado: it stops at their surrounds
		const doorAt = [ 1.75, L - 1.75 ], gap = 1.22;
		const runs = [ [ 0, doorAt[ 0 ] - gap ], [ doorAt[ 0 ] + gap, doorAt[ 1 ] - gap ], [ doorAt[ 1 ] + gap, L ] ];
		const dado = ( mat, prof ) => runs.forEach( ( [ a, b ] ) => add( mat, sweepPart( a, b, prof ) ) );
		dado( M.plaster, [ [ 0, 0 ], [ 0.16, 0 ], [ 0.16, 0.28 ], [ 0.12, 0.32 ], [ 0.12, dd - 0.12 ], [ 0.17, dd - 0.08 ], [ 0.17, dd ], [ 0.3, dd + 0.04 ], [ 0.3, dd + 0.16 ], [ 0.22, dd + 0.22 ], [ 0.06, dd + 0.26 ] ] );
		for ( const sd of doorAt ) add( M.plaster, sweepPart( sd - gap, sd + gap, [ [ 0, 0 ], [ 0.06, 0 ], [ 0.06, dd + 0.26 ] ] ) );
		// the dado's cut ends beside the doors: closed back to the wall face
		{

			const prof = [ [ 0.16, 0 ], [ 0.16, 0.28 ], [ 0.12, 0.32 ], [ 0.12, dd - 0.12 ], [ 0.17, dd - 0.08 ], [ 0.17, dd ], [ 0.3, dd + 0.04 ], [ 0.3, dd + 0.16 ], [ 0.22, dd + 0.22 ], [ 0.06, dd + 0.26 ] ];
			for ( const sd of doorAt ) for ( const se of [ sd - gap, sd + gap ] ) {

				const q = ConcertHall.pathAt( path, se );
				add( M.plaster, ConcertHall.grid( [ prof.map( ( [ u, y ] ) => [ q.x + q.nx * 0.06, y, q.z + q.nz * 0.06 ] ), prof.map( ( [ u, y ] ) => [ q.x + q.nx * u, y, q.z + q.nz * u ] ) ] ) );

			}

		}
		add( M.plaster, sweep( [ [ 0.06, dd + 0.26 ], [ 0.06, fr0 - 0.08 ], [ 0.12, fr0 - 0.03 ], [ 0.12, fr0 ] ] ) );
		add( M.panel, sweep( [ [ 0.12, fr0 ], [ 0.12, fr1 ] ] ) );
		add( M.plaster, sweep( [ [ 0.12, fr1 ], [ 0.18, fr1 + 0.06 ], [ 0.18, fr1 + 0.16 ], [ 0.3, fr1 + 0.26 ], [ 0.34, fr1 + 0.38 ], [ 0.44, Hw - 0.04 ], [ 0.44, Hw ], [ 0, Hw ] ] ) );
		dado( M.ornament, [ [ 0.165, 0.06 ], [ 0.165, 0.24 ] ] );			// the grille in the plinth
		dado( M.ornament, [ [ 0.175, dd - 0.07 ], [ 0.175, dd - 0.01 ] ] );
		dado( M.ornament, [ [ 0.305, dd + 0.06 ], [ 0.305, dd + 0.14 ] ] );
		add( M.ornament, sweep( [ [ 0.125, fr0 + 0.08 ], [ 0.125, fr1 - 0.08 ] ] ) );		// the frieze's ornament
		add( M.ornament, sweep( [ [ 0.185, fr1 + 0.07 ], [ 0.185, fr1 + 0.15 ] ] ) );
		add( M.ornament, sweep( [ [ 0.445, Hw - 0.1 ], [ 0.445, Hw - 0.02 ] ] ) );

		// bays: paired pilasters on dado pedestals, each with a gilt arabesque panel and a
		// capital; between them tall panels in wide gilt borders (they follow the corners) over
		// dado panels; the bay nearest the arch each side holds a door
		const half = L / 2, sideLen = - ( - H.stageDepth + H.corner ), arcLen = Math.PI / 2 * H.corner, backLen = H.shellWidth - 2 * H.corner;
		const marks = [ 3.5, sideLen, sideLen + arcLen * 0.5, sideLen + arcLen, sideLen + arcLen + backLen / 3 ].filter( m => m < half - 0.5 );
		const pil = [ ...marks, half, ...marks.map( m => L - m ).reverse() ];
		const doors = doorAt;
		const top = fr0 - 0.12;			// the pilasters' capitals, under the frieze
		const pilaster = sc => {

			// the pedestal in the dado, under the pair
			add( M.plaster, sweepPart( sc - 0.48, sc + 0.48, [ [ 0.12, 0.32 ], [ 0.2, 0.32 ], [ 0.2, dd - 0.1 ], [ 0.12, dd - 0.1 ] ] ) );
			add( M.ornament, sweepPart( sc - 0.38, sc + 0.38, [ [ 0.205, 0.5 ], [ 0.205, 0.54 ] ] ) );
			add( M.ornament, sweepPart( sc - 0.38, sc + 0.38, [ [ 0.205, dd - 0.32 ], [ 0.205, dd - 0.28 ] ] ) );
			for ( const off of [ - 0.25, 0.25 ] ) {

				const sa = sc + off - 0.15, sb = sc + off + 0.15;
				add( M.plaster, sweepPart( sa, sb, [ [ 0.06, dd + 0.26 ], [ 0.2, dd + 0.26 ], [ 0.2, top ], [ 0.06, top ] ] ) );
				add( M.gilt, sweepPart( sa + 0.045, sb - 0.045, [ [ 0.205, dd + 0.45 ], [ 0.205, top - 0.2 ] ] ) );
				add( M.ornament, sweepPart( sa - 0.03, sb + 0.03, [ [ 0.06, top ], [ 0.26, top ], [ 0.26, top + 0.12 ], [ 0.06, top + 0.12 ] ] ) );
				add( M.plaster, sweepPart( sa - 0.03, sb + 0.03, [ [ 0.2, dd + 0.2 ], [ 0.26, dd + 0.2 ], [ 0.26, dd + 0.4 ], [ 0.2, dd + 0.4 ] ] ) );

			}

		};
		pil.forEach( pilaster );
		const frame = ( s0, s1, y0, y1, w, u, mat ) => {

			// a rectangular frame of width w on the wall (follows its curve)
			add( mat, sweepPart( s0, s1, [ [ u, y0 ], [ u, y0 + w ] ] ) );
			add( mat, sweepPart( s0, s1, [ [ u, y1 - w ], [ u, y1 ] ] ) );
			// (its upright sides plain: no ribs across a vertical strip)
			const side = mat === M.ornament ? M.gilt : mat;
			add( side, sweepPart( s0, s0 + w, [ [ u, y0 + w ], [ u, y1 - w ] ] ) );
			add( side, sweepPart( s1 - w, s1, [ [ u, y0 + w ], [ u, y1 - w ] ] ) );

		};
		for ( let i = 0; i < pil.length - 1; ++ i ) {

			const s0 = pil[ i ] + 0.6, s1 = pil[ i + 1 ] - 0.6;
			if ( s1 - s0 < 0.4 ) continue;
			// upper: a recessed field in a wide gilt arabesque border with a fine bead inside
			const y0 = dd + 0.5, y1 = top - 0.15;
			add( M.panel, sweepPart( s0 + 0.24, s1 - 0.24, [ [ 0.04, y0 + 0.24 ], [ 0.04, y1 - 0.24 ] ] ) );
			frame( s0, s1, y0, y1, 0.2, 0.075, M.ornament );
			frame( s0 + 0.27, s1 - 0.27, y0 + 0.27, y1 - 0.27, 0.03, 0.06, M.ornament );
			// dado: a raised panel with a gilt bead
			add( M.panel, sweepPart( s0 + 0.08, s1 - 0.08, [ [ 0.15, 0.55 ], [ 0.15, dd - 0.35 ] ] ) );
			frame( s0 + 0.08, s1 - 0.08, 0.55, dd - 0.35, 0.035, 0.155, M.ornament );

		}

		// doors: two cream panelled leaves in a gilt-beaded architrave, an entablature, a round
		// arched lunette with its archivolt; in a local frame (tangent, up, out of the wall)
		for ( const sd of doors ) {

			// (right-handed: t = up x n, or the frame mirrors and its faces light from behind)
			const p = ConcertHall.pathAt( path, sd ), t = new THREE.Vector3( p.nz, 0, - p.nx ), n = new THREE.Vector3( p.nx, 0, p.nz );
			const m = new THREE.Matrix4().makeBasis( t, new THREE.Vector3( 0, 1, 0 ), n ).setPosition( p.x, 0, p.z );
			const put = ( mat, g ) => add( mat, g.applyMatrix4( m ) );
			const box = ( a, b, c, d, e, f ) => ConcertHall.box( a, b, c, d, e, f );
			const dw = 0.78, dh = 2.45;
			put( M.panel, box( - 2 * dw / 2, 0, 0.06, 2 * dw / 2, dh, 0.1 ) );
			for ( const sx of [ - 1, 1 ] ) {

				const x0 = sx < 0 ? - dw + 0.1 : 0.1, x1 = x0 + dw - 0.2;
				for ( const [ y0, y1 ] of [ [ 0.15, 0.85 ], [ 1.0, 2.0 ], [ 2.12, 2.62 ] ] ) {

					put( M.plaster, box( x0, y0, 0.1, x1, y1, 0.13 ) );
					put( M.gold, box( x0 + 0.03, y0 + 0.03, 0.13, x1 - 0.03, y0 + 0.05, 0.135 ) );
					put( M.gold, box( x0 + 0.03, y1 - 0.05, 0.13, x1 - 0.03, y1 - 0.03, 0.135 ) );

				}

				put( M.gold, box( sx * 0.08 - 0.012, 1.05, 0.13, sx * 0.08 + 0.012, 1.25, 0.15 ) );		// handles

			}

			put( M.wood, box( - 0.006, 0, 0.1, 0.006, dh, 0.115 ) );
			// architrave and its bead, the entablature
			for ( const sx of [ - 1, 1 ] ) put( M.plaster, box( sx * dw, 0, 0.05, sx * ( dw + 0.2 ), dh + 0.2, 0.17 ) );
			put( M.plaster, box( - dw - 0.2, dh, 0.05, dw + 0.2, dh + 0.2, 0.17 ) );
			put( M.gold, box( - dw - 0.04, dh + 0.02, 0.17, dw + 0.04, dh + 0.05, 0.18 ) );
			for ( const sx of [ - 1, 1 ] ) put( M.gold, box( sx * ( dw + 0.02 ) - 0.015, 0.1, 0.17, sx * ( dw + 0.02 ) + 0.015, dh + 0.04, 0.18 ) );
			put( M.plaster, box( - dw - 0.38, dh + 0.2, 0.05, dw + 0.38, dh + 0.5, 0.34 ) );
			put( M.ornament, box( - dw - 0.3, dh + 0.26, 0.34, dw + 0.3, dh + 0.42, 0.345 ) );
			put( M.gold, box( - dw - 0.4, dh + 0.46, 0.34, dw + 0.4, dh + 0.52, 0.36 ) );
			// the lunette
			const r = dw + 0.05, yc = dh + 0.52;
			const lun = new THREE.Shape();
			lun.moveTo( - r, yc );
			lun.absarc( 0, yc, r, Math.PI, 0, true );
			lun.lineTo( - r, yc );
			put( M.panel, new THREE.ShapeGeometry( lun, 24 ).translate( 0, 0, 0.06 ) );
			const arch = [];
			for ( let k = 0; k <= 32; ++ k ) arch.push( new THREE.Vector3( - ( r + 0.12 ) * Math.cos( Math.PI * k / 32 ), yc + ( r + 0.12 ) * Math.sin( Math.PI * k / 32 ), 0.1 ) );
			put( M.gold, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( arch ), 48, 0.045, 6, false ) );
			put( M.plaster, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( arch.map( v => new THREE.Vector3( v.x * 1.12, yc + ( v.y - yc ) * 1.12, 0.08 ) ) ), 48, 0.07, 6, false ) );
			put( M.gold, new THREE.SphereGeometry( 1, 12, 8 ).scale( 0.16, 0.22, 0.08 ).translate( 0, yc + r + 0.18, 0.14 ) );

		}

		// up from the cornice: a cove to the flat ceiling over the stage; towards the arch, a vault
		// from that profile to the arch's ellipse
		const ceil = Hw + H.coveRise, zv = - H.vaultFrom;
		const cove = ConcertHall.shellPath( H.cove );
		const pathCut = ( pp, zMax ) => pp.filter( p => p.z <= zMax );
		{

			const pc = pathCut( path, zv ), cc = pathCut( cove, zv );
			const n = 9, rows = [];
			for ( let k = 0; k <= n; ++ k ) {

				const a = Math.PI / 2 * k / n, u = H.cove * ( 1 - Math.cos( a ) ), y = Hw + H.coveRise * Math.sin( a );
				rows.push( pc.map( p => [ p.x + p.nx * u, y, p.z + p.nz * u ] ) );

			}

			// (the two paths have different point counts: sweep the wall's along its own normals)
			add( M.plaster, ConcertHall.grid( rows[ 0 ].map( ( _, j ) => rows.map( r => r[ j ] ) ) ) );
			add( M.ceiling, ConcertHall.floorShape( [ ...cc.map( p => [ p.x, p.z ] ) ], ceil ) );
			add( M.gold, ConcertHall.sweep( pc, [ [ H.cove + 0.02, ceil - 0.03 ], [ H.cove + 0.12, ceil - 0.03 ] ] ) );

		}

		{

			// cross-sections at the vault's start (cove + flat) and at the arch (its ellipse), both
			// resampled to the same count, ruled between
			const N = 80;
			const at0 = [];
			for ( let k = 0; k <= 8; ++ k ) {

				const a = Math.PI / 2 * k / 8;
				at0.push( [ - S + H.cove * ( 1 - Math.cos( a ) ), Hw + H.coveRise * Math.sin( a ) ] );

			}

			const sec0 = [ ...at0, ...at0.slice().reverse().map( ( [ x, y ] ) => [ - x, y ] ) ];
			const sec1 = [];
			for ( let k = 0; k <= 40; ++ k ) {

				const a = Math.PI * ( 1 - k / 40 );
				sec1.push( [ S * Math.cos( a ), H.archSpring + ( H.archCrown - H.archSpring ) * Math.sin( a ) ] );

			}

			const resample = pts => {

				const len = [ 0 ];
				for ( let i = 1; i < pts.length; ++ i ) len.push( len[ i - 1 ] + Math.hypot( pts[ i ][ 0 ] - pts[ i - 1 ][ 0 ], pts[ i ][ 1 ] - pts[ i - 1 ][ 1 ] ) );
				const T = len[ len.length - 1 ], out = [];
				let j = 1;
				for ( let k = 0; k <= N; ++ k ) {

					const s = T * k / N;
					while ( j < pts.length - 1 && len[ j ] < s ) ++ j;
					const u = ( s - len[ j - 1 ] ) / Math.max( 1e-6, len[ j ] - len[ j - 1 ] );
					out.push( [ pts[ j - 1 ][ 0 ] + ( pts[ j ][ 0 ] - pts[ j - 1 ][ 0 ] ) * u, pts[ j - 1 ][ 1 ] + ( pts[ j ][ 1 ] - pts[ j - 1 ][ 1 ] ) * u ] );

				}

				return out;

			};
			const a0 = resample( sec0 ), a1 = resample( sec1 ), rows = [];
			for ( let i = 0; i <= 6; ++ i ) {

				const u = i / 6, z = zv + ( - 0.02 - zv ) * u;
				rows.push( a0.map( ( p, k ) => [ p[ 0 ] + ( a1[ k ][ 0 ] - p[ 0 ] ) * u, p[ 1 ] + ( a1[ k ][ 1 ] - p[ 1 ] ) * u, z ] ) );

			}

			add( M.plaster, ConcertHall.grid( rows ) );
			// the side walls up to the vault's start, from the cornice
			for ( const sgn of [ - 1, 1 ] ) add( M.plaster, ConcertHall.grid( [ [ [ sgn * S, Hw, zv ], [ sgn * S, Hw, - 0.02 ] ], [ [ sgn * S, H.archSpring, zv ], [ sgn * S, H.archSpring, - 0.02 ] ] ] ) );

		}

		// the Tiara: a gilt elliptic ring of lamps hanging over the stage, on four rods
		{

			const zc0 = - D * 0.45, ax = S * 0.62, az = D * 0.28, y = H.tiara;
			const pts = [];
			for ( let i = 0; i < 64; ++ i ) {

				const t = 2 * Math.PI * i / 64;
				pts.push( new THREE.Vector3( ax * Math.cos( t ), y, zc0 + az * Math.sin( t ) ) );

			}

			add( M.gold, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts, true ), 128, 0.07, 8, true ) );
			add( M.gold, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts.map( p => new THREE.Vector3( p.x * 0.9, y + 0.18, zc0 + ( p.z - zc0 ) * 0.9 ) ), true ), 128, 0.04, 6, true ) );
			for ( let i = 0; i < 28; ++ i ) {

				const t = 2 * Math.PI * ( i + 0.5 ) / 28;
				add( M.lamp, new THREE.CylinderGeometry( 0.06, 0.08, 0.14, 10 ).translate( ax * Math.cos( t ), y - 0.1, zc0 + az * Math.sin( t ) ) );

			}

			for ( const t of [ 0.25, Math.PI - 0.25, Math.PI + 0.25, 2 * Math.PI - 0.25 ] ) {

				const x = ax * Math.cos( t ), z = zc0 + az * Math.sin( t );
				add( M.gold, new THREE.CylinderGeometry( 0.015, 0.015, ceil - y, 6 ).translate( x, ( ceil + y ) / 2, z ) );

			}

		}

	}

	_proscenium( add ) {

		const H = HALL, M = this.materials, W = H.shellWidth / 2, half = H.width / 2, T = 0.9;
		const b = H.archCrown - H.archSpring;
		// the wall round the arch, from the parquet to the ceiling, with the opening (its sill a
		// little under the stage floor: level with it, the wall's top face would fight the floor)
		const s = new THREE.Shape();
		s.moveTo( - half, - H.stageHeight );
		s.lineTo( half, - H.stageHeight );
		s.lineTo( half, H.ceiling );
		s.lineTo( - half, H.ceiling );
		s.lineTo( - half, - H.stageHeight );
		const sill = - 0.05, hole = new THREE.Path();
		hole.moveTo( - W, sill );
		hole.lineTo( - W, H.archSpring );
		hole.absellipse( 0, H.archSpring, W, b, Math.PI, 0, true );
		hole.lineTo( W, sill );
		hole.lineTo( - W, sill );
		s.holes.push( hole );
		add( M.plaster, new THREE.ExtrudeGeometry( s, { depth: T, bevelEnabled: false, curveSegments: 64 } ).translate( 0, 0, - T ) );

		// the arch's band: a wide gilt ornament between two rolls, a plain outer moulding
		const curve = ( off, z, legs = 0 ) => {

			const a = W + off, bb = b + off, pts = [];
			for ( let i = 0; i <= 72; ++ i ) {

				const t = Math.PI * ( 1 - i / 72 );
				pts.push( new THREE.Vector3( a * Math.cos( t ), H.archSpring + bb * Math.sin( t ), z ) );

			}

			const c = new THREE.CurvePath();
			if ( legs ) c.add( new THREE.LineCurve3( new THREE.Vector3( - a, H.archSpring - legs, z ), pts[ 0 ] ) );
			c.add( new THREE.CatmullRomCurve3( pts ) );
			if ( legs ) c.add( new THREE.LineCurve3( pts[ pts.length - 1 ], new THREE.Vector3( a, H.archSpring - legs, z ) ) );
			return c;

		};
		const band = ( o0, o1, z, mat ) => {

			const rows = [];
			for ( const o of [ o0, o1 ] ) {

				const a = W + o, bb = b + o, r = [];
				for ( let i = 0; i <= 96; ++ i ) {

					const t = Math.PI * ( 1 - i / 96 );
					r.push( [ a * Math.cos( t ), H.archSpring + bb * Math.sin( t ), z ] );

				}

				rows.push( r );

			}

			add( mat, ConcertHall.grid( rows ) );

		};
		add( M.gold, new THREE.TubeGeometry( curve( 0.08, 0.04 ), 200, 0.1, 10, false ) );
		band( 0.2, 0.95, 0.03, M.gold );
		for ( let i = 1; i < 24; ++ i ) {

			// the ornament's rhythm: raised bosses round the band
			const t = Math.PI * ( 1 - i / 24 ), a = W + 0.58, bb = b + 0.58;
			add( M.gold, new THREE.SphereGeometry( 1, 10, 6 ).scale( 0.2, 0.2, 0.07 ).translate( a * Math.cos( t ), H.archSpring + bb * Math.sin( t ), 0.06 ) );

		}

		add( M.gold, new THREE.TubeGeometry( curve( 1.02, 0.04 ), 200, 0.06, 8, false ) );
		add( M.plaster, new THREE.TubeGeometry( curve( 1.22, 0.02 ), 200, 0.09, 8, false ) );
		add( M.gold, new THREE.SphereGeometry( 1, 24, 12 ).scale( 0.85, 0.6, 0.22 ).translate( 0, H.archCrown + 0.6, 0.06 ) );

		// the piers each side of the opening, to the arch's spring: a base, a gilt arabesque
		// panel, a capital
		for ( const sgn of [ - 1, 1 ] ) {

			const x0 = sgn * W, x1 = sgn * ( W + 1.25 );
			const lo = Math.min( x0, x1 ), hi = Math.max( x0, x1 );
			add( M.plaster, ConcertHall.box( lo, 0, 0, hi, H.archSpring - 0.7, 0.18 ) );
			add( M.gold, ConcertHall.box( lo + 0.2, 0.9, 0.18, hi - 0.2, H.archSpring - 1.2, 0.22 ) );
			add( M.panel, ConcertHall.box( lo + 0.32, 1.02, 0.2, hi - 0.32, H.archSpring - 1.32, 0.235 ) );
			add( M.plaster, ConcertHall.box( lo - 0.05, 0, 0, hi + 0.05, 0.75, 0.26 ) );
			add( M.gold, ConcertHall.box( lo - 0.08, H.archSpring - 0.75, 0, hi + 0.08, H.archSpring - 0.2, 0.3 ) );
			add( M.plaster, ConcertHall.box( lo - 0.14, H.archSpring - 0.2, 0, hi + 0.14, H.archSpring + 0.02, 0.34 ) );
			// the pier's return into the opening, gilt panel
			add( M.gold, ConcertHall.box( x0 - sgn * 0.02 - 0.01, 0.9, - 0.75, x0 - sgn * 0.02 + 0.01, H.archSpring - 1.2, - 0.1 ) );

		}

		// the square frame round the arch, its spandrels with gilt lines, a cornice
		const fx = W + 1.5, fy = H.archCrown + 1.35;
		add( M.gold, ConcertHall.box( - fx, fy, 0, fx, fy + 0.1, 0.12 ) );
		for ( const sgn of [ - 1, 1 ] ) {

			add( M.gold, ConcertHall.box( sgn * fx - 0.05, H.archSpring, 0, sgn * fx + 0.05, fy + 0.1, 0.12 ) );
			const tri = [ new THREE.Vector3( sgn * ( fx - 0.35 ), fy - 0.3, 0.05 ), new THREE.Vector3( sgn * 2.2, fy - 0.3, 0.05 ), new THREE.Vector3( sgn * ( fx - 0.35 ), H.archSpring + 2.2, 0.05 ) ];
			add( M.gold, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( tri, true, 'catmullrom', 0 ), 30, 0.03, 4, true ) );

		}

		add( M.plaster, ConcertHall.box( - half, fy + 0.6, 0, half, fy + 0.95, 0.4 ) );
		add( M.gold, ConcertHall.box( - half, fy + 0.95, 0.3, half, fy + 1.02, 0.45 ) );
		add( M.plaster, ConcertHall.box( - half, H.ceiling - 0.6, 0, half, H.ceiling, 0.45 ) );
		add( M.gold, ConcertHall.box( - half, H.ceiling - 0.66, 0.4, half, H.ceiling - 0.58, 0.5 ) );

	}

	_auditorium( add ) {

		const H = HALL, M = this.materials, half = H.width / 2, y0 = - H.stageHeight;
		const rake = z => y0 + 0.05 * Math.max( 0, z - 2.5 );		// the parquet rises ~1 m to the back

		// parquet floor: the horseshoe from the proscenium back, raked
		{

			const outline = ConcertHall.horseshoe( 0, 0, 0.5 ).map( p => [ p.x, p.z ] );
			const g = ConcertHall.floorShape( outline, 0 );
			const pos = g.attributes.position;
			for ( let i = 0; i < pos.count; ++ i ) pos.setY( i, rake( pos.getZ( i ) ) );
			g.computeVertexNormals();
			add( M.parquet, g );

		}

		// the outer wall round the horseshoe, parquet to ceiling
		const wall = ConcertHall.horseshoe( 0, 0, 0.6 );
		add( M.plaster, ConcertHall.grid( wall.map( p => [ [ p.x, rake( p.z ) - 0.05, p.z ], [ p.x, H.ceiling, p.z ] ] ) ) );
		// a dado of dark wood round the parquet
		add( M.wood, ConcertHall.sweep( wall, p => [ [ 0.02, rake( p.z ) - 0.05 ], [ 0.02, rake( p.z ) + 1.1 ] ] ) );
		add( M.gold, ConcertHall.sweep( wall, p => [ [ 0.03, rake( p.z ) + 1.1 ], [ 0.03, rake( p.z ) + 1.16 ] ] ) );

		// parquet seats: rows on arcs round a point behind the stage, two aisles
		this._seats( add, rake );

		// tiers
		for ( const t of H.tiers ) this._tier( add, t );

	}

	_seats( add, rake ) {

		const H = HALL, M = this.materials, half = H.width / 2, zc = H.length - half;
		const cushion = [], wood = [];
		const seat = ( x, z, facing ) => {

			const m = new THREE.Matrix4().makeRotationY( facing ).setPosition( x, rake( z ), z );
			cushion.push( ConcertHall.box( - 0.24, 0.38, - 0.22, 0.24, 0.48, 0.2 ).applyMatrix4( m ) );
			cushion.push( new THREE.BoxGeometry( 0.5, 0.58, 0.08 ).rotateX( - 0.14 ).translate( 0, 0.78, 0.25 ).applyMatrix4( m ) );
			wood.push( ConcertHall.box( - 0.29, 0.56, - 0.2, - 0.25, 0.64, 0.24 ).applyMatrix4( m ) );
			wood.push( ConcertHall.box( 0.25, 0.56, - 0.2, 0.29, 0.64, 0.24 ).applyMatrix4( m ) );
			wood.push( ConcertHall.box( - 0.18, 0, - 0.1, 0.18, 0.38, 0.18 ).applyMatrix4( m ) );

		};
		const focus = new V2( 0, - 3 );
		for ( let k = 0; k < 40; ++ k ) {

			const r = 6.4 + 0.92 * k;
			const da = 0.56 / r;
			for ( let a = - Math.PI / 2; a <= Math.PI / 2; a += da ) {

				const x = focus.x + r * Math.sin( a ), z = focus.y + r * Math.cos( a );
				if ( z < 2.7 ) continue;
				// inside the horseshoe, clear of the walls
				const inside = z < zc ? Math.abs( x ) < half - 0.9 : Math.hypot( x, z - zc ) < half - 1.1;
				if ( ! inside ) continue;
				if ( Math.abs( Math.abs( x ) - 3.6 ) < 0.55 ) continue;		// aisles
				seat( x, z, Math.atan2( x - focus.x, z - focus.y ) );

			}

		}

		add( M.velvet, mergeGeometries( cushion.map( g => g.toNonIndexed() ) ) );
		add( M.wood, mergeGeometries( wood.map( g => g.toNonIndexed() ) ) );

	}

	_tier( add, t ) {

		const M = this.materials, y = t.y;
		const path = ConcertHall.horseshoe( 0, t.start, 0.45 );
		// depth at a path point: `side` along the side walls, `depth` at the back's centre
		const dep = p => t.side + ( t.depth - t.side ) * p.w * p.w;
		const fy = ( p, u ) => y + t.rake * Math.max( 0, 1 - u / dep( p ) );		// the floor at u from the wall
		const sw = f => ConcertHall.sweep( path, f );
		// floor (carpeted) sloping up to the wall, its soffit under it
		add( M.velvet, sw( p => [ [ 0, y + t.rake ], [ dep( p ), y ] ] ) );
		add( M.ceiling, sw( p => [ [ 0, y - 0.5 ], [ dep( p ), y - 0.5 ] ] ) );
		// parapet: fascia, front, top, back
		add( M.plaster, sw( p => { const d = dep( p ); return [ [ d, y - 0.5 ], [ d + 0.06, y - 0.5 ], [ d + 0.06, y + 0.92 ], [ d - 0.22, y + 0.92 ], [ d - 0.22, y ] ]; } ) );
		// gilt: the top rail, a band at the floor line, a bead under the fascia
		add( M.gold, sw( p => { const d = dep( p ); return [ [ d + 0.1, y + 0.9 ], [ d + 0.1, y + 1.0 ], [ d - 0.26, y + 1.0 ] ]; } ) );
		add( M.gold, sw( p => { const d = dep( p ); return [ [ d + 0.075, y - 0.02 ], [ d + 0.075, y + 0.1 ] ]; } ) );
		add( M.gold, sw( p => { const d = dep( p ); return [ [ d + 0.09, y - 0.52 ], [ d + 0.09, y - 0.42 ] ]; } ) );

		// arc length along the path, a point at a given length
		const len = [];
		let acc = 0;
		for ( let i = 0; i < path.length; ++ i ) {

			if ( i ) acc += Math.hypot( path[ i ].x - path[ i - 1 ].x, path[ i ].z - path[ i - 1 ].z );
			len.push( acc );

		}

		const at = s => {

			let i = 1;
			while ( i < len.length - 1 && len[ i ] < s ) ++ i;
			const p = path[ i - 1 ], q = path[ i ], u = ( s - len[ i - 1 ] ) / Math.max( 1e-6, len[ i ] - len[ i - 1 ] );
			const nx = p.nx + ( q.nx - p.nx ) * u, nz = p.nz + ( q.nz - p.nz ) * u, nl = Math.hypot( nx, nz );
			return { x: p.x + ( q.x - p.x ) * u, z: p.z + ( q.z - p.z ) * u, nx: nx / nl, nz: nz / nl, w: p.w + ( q.w - p.w ) * u };

		};
		// gilt pilaster strips on the parapet's front between its panels
		const strip = ( s, w ) => {

			const p = at( s ), tx = - p.nz, tz = p.nx, u = dep( p ) + 0.07;
			const c = [ p.x + p.nx * u, p.z + p.nz * u ];
			return ConcertHall.grid( [
				[ [ c[ 0 ] - tx * w, y + 0.12, c[ 1 ] - tz * w ], [ c[ 0 ] - tx * w, y + 0.88, c[ 1 ] - tz * w ] ],
				[ [ c[ 0 ] + tx * w, y + 0.12, c[ 1 ] + tz * w ], [ c[ 0 ] + tx * w, y + 0.88, c[ 1 ] + tz * w ] ] ] );

		};
		const bay = t.boxes ? 1.6 : 1.8;
		for ( let s = bay / 2; s < acc; s += bay ) add( M.gold, strip( s, 0.035 ) );

		// boxes: partitions to the wall; lamps on the parapet
		if ( t.boxes ) for ( let s = 0; s <= acc; s += bay ) {

			const p = at( s ), d = dep( p ) - 0.25;
			add( M.plaster, ConcertHall.grid( [
				[ [ p.x, y, p.z ], [ p.x, y + 1.3, p.z ] ],
				[ [ p.x + p.nx * d, y, p.z + p.nz * d ], [ p.x + p.nx * d, y + 1.3, p.z + p.nz * d ] ] ] ) );

		}

		if ( t.lamps ) for ( let s = bay / 2; s < acc; s += bay ) {

			const p = at( s ), u = dep( p ) - 0.08;
			add( M.gold, new THREE.CylinderGeometry( 0.012, 0.012, 0.22, 6 ).translate( p.x + p.nx * u, y + 1.11, p.z + p.nz * u ) );
			add( M.lamp, new THREE.SphereGeometry( 0.07, 12, 8 ).translate( p.x + p.nx * u, y + 1.26, p.z + p.nz * u ) );

		}

		// seats: rows stepping up to the wall, counted from the parapet; a row runs where the tier
		// is deep enough for it (swept: they are far away)
		const rows = Math.max( 1, Math.floor( ( t.depth - 0.6 ) / 0.85 ) );
		for ( let k = 0; k < rows; ++ k ) {

			let run = [];
			const flush = () => {

				if ( run.length > 1 ) add( M.velvet, ConcertHall.sweep( run, p => {

					const u = dep( p ) - 0.65 - 0.85 * k, f = fy( p, u );
					return [ [ u + 0.2, f + 0.44 ], [ u - 0.24, f + 0.44 ], [ u - 0.3, f + 0.95 ], [ u - 0.38, f + 0.95 ] ];

				} ) );
				run = [];

			};
			for ( const p of path ) {

				if ( dep( p ) - 0.65 - 0.85 * k > 0.45 ) run.push( p );
				else flush();

			}

			flush();

		}

		// the tier's ends
		for ( const p of [ path[ 0 ], path[ path.length - 1 ] ] ) {

			const d = dep( p ) + 0.06;
			add( M.plaster, ConcertHall.grid( [
				[ [ p.x, y - 0.5, p.z ], [ p.x, y + 0.92, p.z ] ],
				[ [ p.x + p.nx * d, y - 0.5, p.z ], [ p.x + p.nx * d, y + 0.92, p.z ] ] ] ) );

		}

		// the balcony's raked floor reaches the wall above its front: close the wall above it
		// is part of the outer wall already

	}

	_ceiling( add ) {

		const H = HALL, M = this.materials, half = H.width / 2, zc = H.length - half;
		// a shallow oval recess over the middle of the hall, its long axis along the hall
		const oc = H.length * 0.5, a = 4.0, b = 5.5, depth = 0.4;
		const oval = ( sa, sb, n = 96 ) => {

			const pts = [];
			for ( let i = 0; i < n; ++ i ) {

				const t = 2 * Math.PI * i / n;
				pts.push( [ sa * Math.cos( t ), oc + sb * Math.sin( t ) ] );

			}

			return pts;

		};
		const outline = ConcertHall.horseshoe( 0, 0, 0.6 ).map( p => [ p.x, p.z ] );
		add( M.ceiling, ConcertHall.floorShape( outline, H.ceiling, [ oval( a, b ) ] ) );
		const ring = ( sa, sb, y ) => { const o = oval( sa, sb ); return o.concat( [ o[ 0 ] ] ).map( ( [ x, z ] ) => [ x, y, z ] ); };
		add( M.ceiling, ConcertHall.grid( [ ring( a, b, H.ceiling ), ring( a, b, H.ceiling + depth ) ] ) );
		add( M.glow, ConcertHall.floorShape( oval( a, b ), H.ceiling + depth ) );
		// gilt mouldings: round the recess, and an inner ring
		for ( const [ sa, sb, y, r ] of [ [ a, b, H.ceiling, 0.1 ], [ a + 1.1, b + 1.1, H.ceiling - 0.02, 0.05 ], [ a * 0.6, b * 0.6, H.ceiling + depth - 0.03, 0.05 ] ] ) {

			const pts = oval( sa, sb ).map( ( [ x, z ] ) => new THREE.Vector3( x, y, z ) );
			add( M.gold, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts, true ), 160, r, 6, true ) );

		}

		// two rings of lamps: 32 round the outside of the recess, 96 inside it (semi-axes across,
		// along the hall)
		for ( const [ n, sa, sb, y, r ] of [ [ 32, a + 0.75, b + 0.75, H.ceiling - 0.08, 0.11 ], [ 96, a * 0.72, b * 0.72, H.ceiling + depth - 0.06, 0.07 ] ] ) for ( let i = 0; i < n; ++ i ) {

			const t = 2 * Math.PI * ( i + 0.5 ) / n;
			add( M.lamp, new THREE.SphereGeometry( r, 10, 6 ).translate( sa * Math.cos( t ), y, oc + sb * Math.sin( t ) ) );

		}

		// two plain fields framed in gilt, before and behind the oval
		for ( const [ z0, z1 ] of [ [ 1.4, oc - b - 1.2 ], [ oc + b + 1.2, Math.min( zc + 2, H.length - 1.6 ) ] ] ) {

			if ( z1 - z0 < 1 ) continue;
			const x0 = - half + 2.2, x1 = half - 2.2, y = H.ceiling - 0.04;
			add( M.gold, ConcertHall.box( x0, y - 0.04, z0, x1, y, z0 + 0.08 ) );
			add( M.gold, ConcertHall.box( x0, y - 0.04, z1 - 0.08, x1, y, z1 ) );
			add( M.gold, ConcertHall.box( x0, y - 0.04, z0, x0 + 0.08, y, z1 ) );
			add( M.gold, ConcertHall.box( x1 - 0.08, y - 0.04, z0, x1, y, z1 ) );

		}

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
			s.shadow.camera.near = 3;
			s.shadow.camera.far = 30;
			this.lights.add( s, s.target );
			return s;

		};
		// front of house, from the audience's right, above: the piano's shadow falls upstage
		this.keySpot = spot( THREE.MathUtils.degToRad( 13 ), 0.55, 4096 );
		this.keySpot.radius = 0.25;			// path tracer: soft shadows
		this.keySpot.position.copy( this.toWorld( 2.5, 11.5, 9 ) );
		this.keySpot.target.position.copy( this.toWorld( 0, 0.7, PIANO_Z ) );
		// straight above the piano
		this.topSpot = spot( THREE.MathUtils.degToRad( 15 ), 0.45, 2048 );
		this.topSpot.radius = 0.35;
		this.topSpot.position.copy( this.toWorld( 0, 7.9, PIANO_Z + 0.3 ) );		// under the vault
		this.topSpot.target.position.copy( this.toWorld( 0, 0, PIANO_Z ) );
		// a soft wash over the stage from the shell's ceiling
		// (facing down: width along world x = the hall's z, height along world z = across)
		const wash = new THREE.RectAreaLight( '#ffffff', 0, 4, 9 );
		wash.position.copy( this.toWorld( 0, H_WASH, - HALL.stageDepth * 0.4 ) );
		wash.rotation.set( - Math.PI / 2, 0, 0 );
		this.lights.add( wash );
		this.wash = wash;
		// house lights: in the ceiling's oval recess, down on the parquet and tiers
		const house = new THREE.RectAreaLight( '#ffffff', 0, 8.8, 6.4 );
		house.position.copy( this.toWorld( 0, HALL.ceiling + 0.33, HALL.length * 0.5 ) );
		house.rotation.set( - Math.PI / 2, 0, 0 );
		this.lights.add( house );
		this.house = house;
		// the Berlin hall's chandeliers (no shadows: they hang high, over the stalls and the stage;
		// their glow: the bloom, see BERLIN_PRESETS)
		this.chandeliers = BERLIN_CHANDELIERS.map( p => {

			const l = new THREE.PointLight( '#ffcf94', 0, 0, 2 );
			l.position.copy( this.fromBerlin( ...p ) );
			l.visible = false;
			this.lights.add( l );
			return l;

		} );
		this._placed = null;
		this._placeLights();

	}

	/** The stage lights where the shell shown has room for them. */
	_placeLights() {

		const berlin = this.berlinShown;
		if ( this._placed === berlin ) return;
		this._placed = berlin;
		const piano = this.toWorld( 0, 0.7, PIANO_Z ), floor = this.toWorld( 0, 0, PIANO_Z );
		if ( berlin ) {

			// Berlin: the front spot from the dress circle's height, between the chandelier rows;
			// the top light under the ceiling (16 m) over the piano; the wash over the stage's
			// risers (17 m across, 11 m deep)
			const B = ( x, y, z ) => this.fromBerlin( x, y, z );
			this.keySpot.position.copy( B( 2.5, 11.5, 10 ) );
			this.topSpot.position.copy( B( 0, 13.5, - BERLIN.pianoAt + 0.3 ) );
			this.wash.position.copy( B( 0, 12.5, - 5.5 ) );
			this.wash.width = 10; this.wash.height = 13;

		} else {

			this.keySpot.position.copy( this.toWorld( 2.5, 11.5, 9 ) );
			this.topSpot.position.copy( this.toWorld( 0, 7.9, PIANO_Z + 0.3 ) );		// under the vault
			this.wash.position.copy( this.toWorld( 0, H_WASH, - HALL.stageDepth * 0.4 ) );
			this.wash.width = 4; this.wash.height = 9;

		}
		this.keySpot.target.position.copy( piano );
		this.topSpot.target.position.copy( floor );
		this.lights.updateMatrixWorld( true );

	}

	updateLights() {

		const L = this.light;
		this.keySpot.intensity = L.key;
		this.keySpot.color.set( L.keyColor );
		this.keySpot.visible = L.key > 0;
		this.topSpot.intensity = L.top;
		this.topSpot.angle = THREE.MathUtils.degToRad( L.topAngle ?? 24 );
		this.topSpot.color.set( L.topColor );
		this.topSpot.visible = L.top > 0;
		this.wash.intensity = L.wash;
		this.wash.color.set( L.washColor );
		this.wash.visible = L.wash > 0;
		this._placeLights();
		const berlin = this.berlinShown;
		this.house.intensity = L.house;
		this.house.color.set( L.houseColor );
		this.house.visible = L.house > 0 && ! berlin;
		for ( const c of this.chandeliers ) {

			c.intensity = CHANDELIER_CD * L.house;
			c.color.set( L.houseColor );
			c.visible = berlin && L.house > 0;

		}
		this.materials.lamp.emissiveIntensity = 5 * L.lamps;
		this.materials.glow.emissiveIntensity = 0.15 + 0.25 * L.house;
		this.materials.glow.emissive.set( L.houseColor );
		setBerlinLamps( this.berlin, { house: L.house, lamps: L.lamps } );
		const size = this.highQuality ? 4096 : 2048;
		if ( this.keySpot.shadow.mapSize.x !== size ) {

			this.keySpot.shadow.mapSize.set( size, size );
			this.keySpot.shadow.map?.dispose();
			this.keySpot.shadow.map = null;

		}

		if ( this.active ) this.scene.background = this.background;

	}

	setQuality( hq ) {

		this.highQuality = hq;
		this.updateLights();

	}

	setMode( mode ) {

		this.mode = mode;
		this.updateLights();

	}

}


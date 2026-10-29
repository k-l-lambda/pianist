// Upright piano modeled after the reference photo (Footages.local/find/uf-piano.jpg):
// raw weathered-oak case, glass top revealing plate / tuning pins / hammers,
// slanted black glossy fallboard panel, curved cheek arms and console legs.
//
// Frame: origin at floor, x along the keyboard, +z towards the player, key fronts at z = 0.

import * as THREE from 'three';
import { Keyboard } from './keyboard.js';
import { buildStringing } from './stringing.js';
import { woodBox, v3, extrudeSide, extrudeTop, mirrorX, merge, boxProjectUV } from './geometry.js';

const KEY_BOTTOM = 0.698;			// white key top at 0.72
const XI = 0.616;					// inner face of the cheeks
const XO = 0.745;					// outer face of the side panels
const SIDE_IN = 0.712;
const BACK = - 0.60;
const TOP = 1.235;
const GLASS_BOTTOM = 1.035;
const PANEL_BOTTOM = v3( 0, 0.735, - 0.150 );
const PANEL_TOP = v3( 0, 0.995, - 0.200 );

function mesh( geo, mat, { cast = true, receive = true, name } = {} ) {

	const m = new THREE.Mesh( geo, mat );
	m.castShadow = cast;
	m.receiveShadow = receive;
	if ( name ) m.name = name;
	return m;

}

function cheekShape() {

	const s = new THREE.Shape();
	s.moveTo( 0.035, 0.655 );
	s.lineTo( 0.035, 0.735 );
	s.quadraticCurveTo( 0.035, 0.752, 0.015, 0.752 );
	s.lineTo( - 0.085, 0.752 );
	s.quadraticCurveTo( - 0.125, 0.752, - 0.13, 0.82 );
	s.lineTo( - 0.175, 1.005 );
	s.lineTo( - 0.175, 1.035 );
	s.lineTo( - 0.225, 1.035 );
	s.lineTo( - 0.225, TOP );
	s.lineTo( - 0.245, TOP );
	s.lineTo( - 0.245, 0.655 );
	s.lineTo( 0.035, 0.655 );
	return s;

}

function bracketShape() {

	const s = new THREE.Shape();
	s.moveTo( - 0.235, 0.655 );
	s.lineTo( 0.02, 0.655 );
	s.quadraticCurveTo( 0.025, 0.50, - 0.11, 0.42 );
	s.lineTo( - 0.12, 0.40 );
	s.lineTo( - 0.12, 0.17 );
	s.quadraticCurveTo( - 0.12, 0.065, 0.045, 0.06 );
	s.quadraticCurveTo( 0.06, 0.06, 0.06, 0.045 );
	s.lineTo( 0.06, 0.0 );
	s.lineTo( - 0.235, 0.0 );
	s.lineTo( - 0.235, 0.655 );
	return s;

}

export function pedalShape() {

	const s = new THREE.Shape();
	s.moveTo( - 0.012, - 0.215 );
	s.lineTo( 0.012, - 0.215 );
	s.lineTo( 0.018, - 0.11 );
	s.quadraticCurveTo( 0.024, - 0.07, 0.022, - 0.06 );
	s.quadraticCurveTo( 0.018, - 0.035, 0.0, - 0.035 );
	s.quadraticCurveTo( - 0.018, - 0.035, - 0.022, - 0.06 );
	s.quadraticCurveTo( - 0.024, - 0.07, - 0.018, - 0.11 );
	s.lineTo( - 0.012, - 0.215 );
	return s;

}

function buildCase( M ) {

	const g = new THREE.Group();
	g.name = 'case';
	const caseParts = [];

	// side panels
	const side = woodBox( v3( SIDE_IN, 0, BACK ), v3( XO, TOP, - 0.23 ), { grain: 'y' } );
	caseParts.push( side, boxProjectUV( mirrorX( side ), { grain: 'y' } ) );

	// cheeks with curved arms
	const cheek = boxProjectUV( extrudeSide( cheekShape(), XI, XO - 0.003, { bevel: 0.003 } ), { grain: 'y' } );
	caseParts.push( cheek, boxProjectUV( mirrorX( cheek ), { grain: 'y' } ) );

	// console legs under the arms
	const bracket = boxProjectUV( extrudeSide( bracketShape(), XI + 0.03, XO - 0.012, { bevel: 0.004 } ), { grain: 'y' } );
	caseParts.push( bracket, boxProjectUV( mirrorX( bracket ), { grain: 'y' } ) );

	// top board with slight overhang
	caseParts.push( woodBox( v3( - XO - 0.02, TOP, BACK - 0.02 ), v3( XO + 0.02, TOP + 0.03, - 0.205 ), { grain: 'x', radius: 0.004 } ) );

	// lip rail between the panel and the glass
	caseParts.push( woodBox( v3( - XI, PANEL_TOP.y, - 0.215 ), v3( XI, GLASS_BOTTOM, - 0.172 ), { grain: 'x', radius: 0.003 } ) );

	// keyslip
	caseParts.push( woodBox( v3( - XI, 0.655, - 0.01 ), v3( XI, 0.705, 0.022 ), { grain: 'x', radius: 0.003 } ) );

	// kneeboard and toe rail
	caseParts.push( woodBox( v3( - XI - 0.03, 0.06, - 0.235 ), v3( XI + 0.03, 0.655, - 0.215 ), { grain: 'y' } ) );
	caseParts.push( woodBox( v3( - XI - 0.03, 0.0, - 0.235 ), v3( XI + 0.03, 0.06, - 0.19 ), { grain: 'x', radius: 0.003 } ) );

	// back
	caseParts.push( woodBox( v3( - XO, 0, BACK ), v3( XO, TOP, BACK + 0.02 ), { grain: 'y' } ) );

	g.add( mesh( merge( caseParts ), M.case, { name: 'caseWood' } ) );

	// key bed (dark, under the keys) and cover behind the key backs
	g.add( mesh( woodBox( v3( - XI, 0.62, - 0.235 ), v3( XI, 0.685, 0.0 ), { grain: 'x' } ), M.keybed ) );

	// red key-cover felt along the panel bottom
	g.add( mesh( woodBox( v3( - XI, 0.72, - 0.156 ), v3( XI, 0.737, - 0.146 ), { grain: 'x' } ), M.redFelt ) );

	// slanted black glossy panel (fallboard)
	{

		const dir = new THREE.Vector3().subVectors( PANEL_TOP, PANEL_BOTTOM );
		const len = dir.length();
		const geo = new THREE.BoxGeometry( 2 * XI, len, 0.012 );
		geo.translate( 0, len / 2, - 0.006 );
		const m = mesh( geo, M.panel, { name: 'panel' } );
		m.position.copy( PANEL_BOTTOM );
		m.rotation.x = Math.atan2( - dir.z, dir.y );
		g.add( m );

	}

	// action cover behind the panel (dark, keeps the cavity closed)
	g.add( mesh( woodBox( v3( - XI, 0.70, - 0.45 ), v3( XI, 0.99, - 0.26 ), { grain: 'x' } ), M.interior ) );

	// glass
	{

		const geo = new THREE.BoxGeometry( 2 * XI, TOP - GLASS_BOTTOM, 0.005 );
		geo.translate( 0, ( TOP + GLASS_BOTTOM ) / 2, - 0.2335 );
		g.add( mesh( geo, M.glass, { cast: false, name: 'glass' } ) );

	}

	// pedals
	{

		const pedal = extrudeTop( pedalShape(), 0.062, 0.074, { bevel: 0.003 } );
		const geos = [ - 0.09, 0, 0.09 ].map( x => pedal.clone().translate( x, 0, 0 ) );
		g.add( mesh( merge( geos ), M.brass, { name: 'pedals' } ) );
		// pedal slot felt
		g.add( mesh( woodBox( v3( - 0.14, 0.055, - 0.191 ), v3( 0.14, 0.08, - 0.188 ) ), M.greenFelt ) );

	}

	return g;

}

function buildInterior( M ) {

	const g = new THREE.Group();
	g.name = 'interior';

	// soundboard
	g.add( mesh( woodBox( v3( - SIDE_IN, 0.70, - 0.58 ), v3( SIDE_IN, TOP, - 0.56 ), { grain: 'y', scale: 1.2 } ), M.spruce ) );

	// plate, wrest pins, overstrung strings, pressure bars, hammers
	g.add( buildStringing( M, { yStrike: 1.055, zPlate: - 0.50, zTenor: - 0.492, zBass: - 0.484, top: TOP, halfWidth: 0.69 } ) );

	// hammer rail felt and action rail (mostly hidden behind the lip rail)
	g.add( mesh( woodBox( v3( - XI, 0.99, - 0.40 ), v3( XI, 1.012, - 0.385 ) ), M.greenFelt ) );

	// inner faces of the cavity
	g.add( mesh( woodBox( v3( - SIDE_IN, TOP - 0.02, - 0.58 ), v3( SIDE_IN, TOP, - 0.236 ), { grain: 'x' } ), M.interior ) );

	return g;

}

export function buildUpright( M ) {

	const group = new THREE.Group();
	group.name = 'upright';

	group.add( buildCase( M ) );
	group.add( buildInterior( M ) );

	const keyboard = new Keyboard( { white: M.keyWhite, black: M.keyBlack } );
	keyboard.group.position.set( 0, KEY_BOTTOM, 0 );
	group.add( keyboard.group );

	return {
		group,
		keyboard,
		depth: - BACK,
		camera: { position: v3( - 0.2, 1.35, 2.6 ), target: v3( 0, 0.78, - 0.25 ) },
	};

}

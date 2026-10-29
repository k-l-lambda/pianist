// Upright piano modeled after the reference photo (Footages.local/find/uf-piano.jpg):
// raw weathered-oak case, glass top revealing plate / tuning pins / hammers,
// slanted black glossy fallboard panel, curved cheek arms and console legs.
//
// Frame: origin at floor, x along the keyboard, +z towards the player, key fronts at z = 0.

import * as THREE from 'three';
import { Keyboard } from './keyboard.js';
import { buildStringing } from './stringing.js';
import { HammerAction } from './action.js';
import { woodBox, v3, extrudeSide, extrudeTop, mirrorX, merge, boxProjectUV } from './geometry.js';

const KEY_BOTTOM = 0.698;			// white key top at 0.72
const XI = 0.616;					// inner face of the arms (keyboard end + 5 mm)
const XS = 0.660;					// inner face of the side boards = screen edge
const XO = 0.690;					// outer face of the side boards (30 mm boards)
const BACK = - 0.60;
const TOP = 1.235;
const GLASS_BOTTOM = 1.035;
const LIP_BOTTOM = 1.012;			// thin rail between screen and glass
// the screen leans back ~25° and fills the frame between the side boards; the boards' front
// edges run in the screen plane (see uf-piano.jpg / compare-XF.png)
const SCREEN_LEAN = 25 * Math.PI / 180;
const PANEL_BOTTOM = v3( 0, 0.737, - 0.150 );
const screenZ = y => PANEL_BOTTOM.z - ( y - PANEL_BOTTOM.y ) * Math.tan( SCREEN_LEAN );
const PANEL_TOP = v3( 0, LIP_BOTTOM, screenZ( LIP_BOTTOM ) );
const ARM_TOP = 0.752;
const ARM_BACK = - 0.215;

function mesh( geo, mat, { cast = true, receive = true, name } = {} ) {

	const m = new THREE.Mesh( geo, mat );
	m.castShadow = cast;
	m.receiveShadow = receive;
	if ( name ) m.name = name;
	return m;

}

// side board profile (z, y): full height at the back; in front of the glass a vertical edge,
// below the lip rail the edge follows the screen plane and curves forward into the arm
function sideBoardShape() {

	const s = new THREE.Shape();
	const yFillet = 0.80;
	s.moveTo( BACK, 0 );
	s.lineTo( BACK, TOP );
	s.lineTo( - 0.215, TOP );
	s.lineTo( - 0.215, LIP_BOTTOM );
	s.lineTo( screenZ( LIP_BOTTOM ), LIP_BOTTOM );
	s.lineTo( screenZ( yFillet ), yFillet );
	s.quadraticCurveTo( screenZ( ARM_TOP ), ARM_TOP - 0.002, - 0.11, ARM_TOP - 0.002 );
	s.lineTo( - 0.11, 0.66 );
	s.lineTo( - 0.215, 0.66 );
	s.lineTo( - 0.215, 0 );
	s.lineTo( BACK, 0 );
	return s;

}

// arm (key block) beside the keys, rounded at the front; the screen dips into its top
function armShape() {

	const s = new THREE.Shape();
	s.moveTo( 0.035, 0.655 );
	s.lineTo( 0.035, ARM_TOP - 0.017 );
	s.quadraticCurveTo( 0.035, ARM_TOP, 0.015, ARM_TOP );
	s.lineTo( ARM_BACK, ARM_TOP );
	s.lineTo( ARM_BACK, 0.655 );
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

	// side boards
	const side = boxProjectUV( extrudeSide( sideBoardShape(), XS, XO, { bevel: 0.002 } ), { grain: 'y' } );
	caseParts.push( side, boxProjectUV( mirrorX( side ), { grain: 'y' } ) );

	// arms
	const arm = boxProjectUV( extrudeSide( armShape(), XI, XO + 0.002, { bevel: 0.003 } ), { grain: 'z' } );
	caseParts.push( arm, boxProjectUV( mirrorX( arm ), { grain: 'z' } ) );

	// console legs under the arms
	const bracket = boxProjectUV( extrudeSide( bracketShape(), XI + 0.012, XO - 0.006, { bevel: 0.004 } ), { grain: 'y' } );
	caseParts.push( bracket, boxProjectUV( mirrorX( bracket ), { grain: 'y' } ) );

	// top board with slight overhang
	caseParts.push( woodBox( v3( - XO - 0.015, TOP, BACK - 0.02 ), v3( XO + 0.015, TOP + 0.03, - 0.205 ), { grain: 'x', radius: 0.004 } ) );

	// thin rail between the screen and the glass, across the full width
	caseParts.push( woodBox( v3( - XO - 0.004, LIP_BOTTOM, - 0.30 ), v3( XO + 0.004, GLASS_BOTTOM, - 0.205 ), { grain: 'x', radius: 0.003 } ) );

	// keyslip
	caseParts.push( woodBox( v3( - XI, 0.655, - 0.01 ), v3( XI, 0.705, 0.022 ), { grain: 'x', radius: 0.003 } ) );

	// kneeboard and toe rail
	caseParts.push( woodBox( v3( - XS, 0.06, - 0.235 ), v3( XS, 0.655, - 0.215 ), { grain: 'y' } ) );
	caseParts.push( woodBox( v3( - XS, 0.0, - 0.235 ), v3( XS, 0.06, - 0.19 ), { grain: 'x', radius: 0.003 } ) );

	// back
	caseParts.push( woodBox( v3( - XO, 0, BACK ), v3( XO, TOP, BACK + 0.02 ), { grain: 'y' } ) );

	g.add( mesh( merge( caseParts ), M.case, { name: 'caseWood' } ) );

	// key bed (dark, under the keys) and cover behind the key backs
	g.add( mesh( woodBox( v3( - XI, 0.62, - 0.235 ), v3( XI, 0.685, 0.0 ), { grain: 'x' } ), M.keybed ) );

	// red key-cover felt along the panel bottom
	g.add( mesh( woodBox( v3( - XI, 0.72, - 0.156 ), v3( XI, 0.737, - 0.146 ), { grain: 'x' } ), M.redFelt ) );

	// slanted screen filling the frame: from the key felt up to the rail, side to side.
	// It reaches 1 mm into the side boards and sits 0.5 mm behind their front edges.
	{

		const dir = new THREE.Vector3().subVectors( PANEL_TOP, PANEL_BOTTOM );
		const len = dir.length();
		// negative rotation about x leans the top towards -z (away from the player)
		const tilt = Math.atan2( dir.z, dir.y );
		const geo = new THREE.BoxGeometry( 2 * ( XS + 0.001 ), len, 0.012 );
		geo.translate( 0, len / 2, - 0.006 - 0.0005 );
		const m = mesh( geo, M.panel, { name: 'panel' } );
		m.position.copy( PANEL_BOTTOM );
		m.rotation.x = tilt;
		g.add( m );

	}

	// action cover behind the panel (dark, keeps the cavity closed)
	g.add( mesh( woodBox( v3( - XS, 0.70, - 0.45 ), v3( XS, 0.985, - 0.30 ), { grain: 'x' } ), M.interior ) );

	// glass
	{

		const geo = new THREE.BoxGeometry( 2 * XS, TOP - GLASS_BOTTOM, 0.005 );
		geo.translate( 0, ( TOP + GLASS_BOTTOM ) / 2, - 0.224 );
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
	g.add( mesh( woodBox( v3( - XS, 0.70, - 0.58 ), v3( XS, TOP, - 0.56 ), { grain: 'y', scale: 1.2 } ), M.spruce ) );

	// plate, wrest pins, overstrung strings, pressure bars, hammers
	const stringing = buildStringing( M, { yStrike: 1.055, zPlate: - 0.50, zTenor: - 0.492, zBass: - 0.484, top: TOP, halfWidth: XS - 0.004 } );
	g.add( stringing.group );
	g.userData.hammers = stringing.hammers;

	// hammer rail felt and action rail (mostly hidden behind the lip rail)
	g.add( mesh( woodBox( v3( - XI, 0.99, - 0.40 ), v3( XI, 1.012, - 0.385 ) ), M.greenFelt ) );

	// inner faces of the cavity
	g.add( mesh( woodBox( v3( - XS, TOP - 0.02, - 0.58 ), v3( XS, TOP, - 0.227 ), { grain: 'x' } ), M.interior ) );

	return g;

}

export function buildUpright( M ) {

	const group = new THREE.Group();
	group.name = 'upright';

	group.add( buildCase( M ) );
	const interior = buildInterior( M );
	group.add( interior );

	const keyboard = new Keyboard( { white: M.keyWhite, black: M.keyBlack } );
	keyboard.group.position.set( 0, KEY_BOTTOM, 0 );
	group.add( keyboard.group );

	return {
		group,
		keyboard,
		action: new HammerAction( interior.userData.hammers ),
		depth: - BACK,
		camera: { position: v3( - 0.2, 1.35, 2.6 ), target: v3( 0, 0.78, - 0.25 ) },
	};

}

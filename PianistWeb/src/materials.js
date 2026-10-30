// Material sets for each piano style. All materials are MeshPhysicalMaterial so the
// raster renderer and the path tracer agree on the BRDF.

import * as THREE from 'three';
import { bakeKeyAO } from './keyboard.js';

const phys = params => new THREE.MeshPhysicalMaterial( params );

function woodMaterial( tex, extra = {} ) {

	return phys( {
		map: tex.map,
		roughnessMap: tex.roughnessMap,
		normalMap: tex.normalMap,
		roughness: 1,
		metalness: 0,
		...extra,
	} );

}

function lacquer( color, extra = {} ) {

	return phys( {
		color,
		roughness: 0.18,
		metalness: 0,
		clearcoat: 1,
		clearcoatRoughness: 0.03,
		...extra,
	} );

}

// The screens are pure black underneath their lacquer: any diffuse albedo shows the sun patch
// and the leaf shadows on them as a grey, blotchy second "window" (AgX lifts deep darks a lot).
const screen = () => lacquer( '#000000', { roughness: 0.05 } );

function shared( baker ) {

	return {
		glass: phys( {
			color: '#ffffff',
			roughness: 0.02,
			metalness: 0,
			transmission: 1,
			thickness: 0.004,
			ior: 1.52,
			attenuationColor: new THREE.Color( '#cfe3d6' ),
			attenuationDistance: 0.25,
		} ),
		plate: phys( { color: '#b8924a', metalness: 1, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2 } ),
		steel: phys( { color: '#d6d8db', metalness: 1, roughness: 0.22 } ),
		copper: phys( { color: '#c47a45', metalness: 1, roughness: 0.3 } ),
		brass: phys( { color: '#d4ab5e', metalness: 1, roughness: 0.18, clearcoat: 0.5 } ),
		redFelt: woodMaterial( baker.felt( '#3a080b' ), { sheen: 0.3, sheenColor: new THREE.Color( '#4a1418' ), sheenRoughness: 0.7 } ),
		greenFelt: woodMaterial( baker.felt( '#1f2a1c' ), { sheen: 0.6, sheenColor: new THREE.Color( '#3c4a36' ), sheenRoughness: 0.7 } ),
		hammerFelt: woodMaterial( baker.felt( '#e9e4d6' ), { sheen: 1, sheenColor: new THREE.Color( '#ffffff' ), sheenRoughness: 0.5 } ),
		keyWhite: phys( {
			color: '#f3efe4', roughness: 0.28, metalness: 0,
			clearcoat: 0.7, clearcoatRoughness: 0.08,
			// slight subsurface feel of acrylic ivory
			sheen: 0.3, sheenColor: new THREE.Color( '#fff6e0' ), sheenRoughness: 0.4,
		} ),
		keyBlack: phys( { color: '#0b0b0c', roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 } ),
		keybed: phys( { color: '#141210', roughness: 0.8 } ),
		spruce: woodMaterial( baker.spruce(), { clearcoat: 0.3, clearcoatRoughness: 0.3 } ),
		interior: woodMaterial( baker.darkInterior() ),
	};

}

export function makeMaterials( baker, style ) {

	const m = shared( baker );

	switch ( style ) {

		case 'upright-oak':
			m.case = woodMaterial( baker.weatheredOak() );
			m.trim = m.case;
			m.panel = screen();
			break;

		case 'upright-walnut':
			m.case = woodMaterial( baker.walnut(), { clearcoat: 0.8, clearcoatRoughness: 0.12 } );
			m.trim = m.case;
			m.panel = screen();
			break;

		case 'upright-black':
			m.case = lacquer( '#060606' );
			m.trim = m.case;
			m.panel = screen();
			break;

		// FIND GF: lacquered case, the display's black glass, warm wood inside the rim
		case 'grand-black':
			m.case = lacquer( '#050505' );
			m.trim = m.case;
			m.panel = screen();
			m.rimInner = woodMaterial( baker.walnut(), { clearcoat: 0.6, clearcoatRoughness: 0.2 } );
			break;

		case 'grand-white':
			m.case = lacquer( '#ecebe6', { roughness: 0.22 } );
			m.trim = m.case;
			m.panel = screen();
			m.rimInner = woodMaterial( baker.walnut(), { clearcoat: 0.6, clearcoatRoughness: 0.2 } );
			break;

		default:
			throw new Error( 'unknown style ' + style );

	}

	// black keys, fallboard and cheeks occlude the white keys
	m.keyWhite.aoMap = bakeKeyAO( baker );
	m.keyWhite.aoMapIntensity = 1;

	// interior parts receive less of the room probe (they sit in a cavity)
	for ( const k of [ 'interior', 'plate', 'spruce', 'hammerFelt', 'steel', 'copper' ] ) m[ k ].envMapIntensity = 0.6;

	return m;

}

/**
 * Glass: physically transmissive (extra transmission render pass) for high quality and the
 * path tracer; plain alpha-blended glass for the fast real-time mode. Both keep a faint diffuse
 * response (dust, film), so the sun patch and the leaf shadows still show a little on the pane:
 * 2 % of the light for the transmissive glass, and a dim albedo for the alpha glass.
 */
export function applyGlass( mat, physical ) {

	mat.transmission = physical ? 0.98 : 0;
	// transmissive: white (the colour would tint what's seen through it); alpha: 20 % albedo
	mat.color.setScalar( physical ? 1 : 0.2 );
	mat.transparent = ! physical;
	mat.opacity = physical ? 1 : 0.18;
	mat.depthWrite = physical;
	mat.needsUpdate = true;

}

export const STYLES = [
	{ id: 'upright-oak', name: 'Upright · weathered oak (UF)', type: 'upright' },
	{ id: 'upright-walnut', name: 'Upright · walnut', type: 'upright' },
	{ id: 'upright-black', name: 'Upright · black lacquer', type: 'upright' },
	{ id: 'grand-black', name: 'Grand · black lacquer', type: 'grand' },
	{ id: 'grand-white', name: 'Grand · white lacquer', type: 'grand' },
];

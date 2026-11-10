// Material sets for each piano style. All materials are MeshPhysicalMaterial so the
// raster renderer and the path tracer agree on the BRDF.

import * as THREE from 'three';
import { bakeKeyAO } from './keyboard.js';
import { clearMaterial, setClearMode } from './clearglass.js';

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
		panelBack: phys( { color: '#0a0a0a', roughness: 0.8 } ),		// the grand's display: its back and edges
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

		// FIND GF-TYPE-3 in crystal (Footages.local/find/GF-TYPE-3.jpg): the case's rim, the lid and its
		// prop in clear acrylic (a faint grey-blue in its thickness, polished), the legs, their stretcher
		// and the lyre panel in smoked acrylic; the key area (key slip, key blocks, the front section) and
		// the bottom board in white lacquer; hinges, casters and pedals chrome; the plate, the soundboard,
		// the strings and the action as the other grands, seen through the case
		case 'grand-crystal': {

			// acrylic (PMMA): ior 1.49, little dispersion, its thickness per part; absorbing, a cool grey (the
			// reference's): about 64 % through the 45 mm rim and 82 % through the 20 mm lid face on, less at
			// grazing angles (under GI and the path tracer transmission's attenuation; without GI the alpha
			// glass's see-through dimmed as much: clearglass.js `absorb`)
			const acrylic = o => clearMaterial( { ior: 1.49, roughness: 0.015, dispersion: 0.4, tint: '#c4ccd2', attenuationDistance: 0.023, haze: 0.035, absorb: true, ...o } );
			m.rim = acrylic( { thickness: 0.045 } );
			m.lid = acrylic( { thickness: 0.02 } );
			// the lid prop and the legs: dark glass, opaque (a deep grey-black under a glassy coat; their edges
			// catch the light, nothing shows through); the pedal stretcher and the lyre's upright panel satin silver
			m.prop = phys( { color: '#16181b', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.52 } );
			m.legs = m.prop;
			m.stretcher = phys( { color: '#c9cdd2', metalness: 1, roughness: 0.3 } );
			m.lyrePanel = m.stretcher;
			m.case = lacquer( '#f1f0ec', { roughness: 0.2 } );		// (the key area, the bottom board; the bench)
			m.caseBase = m.case;
			m.trim = m.case;
			m.panel = screen();
			m.rimInner = null;		// (no veneer: the rim is clear)
			m.brass = phys( { color: '#e8eaee', metalness: 1, roughness: 0.08 } );		// (chrome)
			// the plate (the cast frame under the strings, its struts, the pin-block cover) satin silver-white,
			// not the other grands' gold: under the clear case it reads as part of the chrome and silver trim
			m.plate = phys( { color: '#dfe2e6', metalness: 1, roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.15 } );
			// the lid's fold: four short hinges on the boards' edges (GF-TYPE-3), not one long brass one: black lacquer
			// (a deep black under a full, glassy coat: sharp reflections), each riveted with 3 pairs of silver-white caps
			m.foldHinge = phys( { color: '#050506', metalness: 0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, ior: 1.5 } );
			m.foldHinge.userData.count = 4;
			m.foldHinge.userData.rivets = phys( { color: '#e4e6ea', metalness: 1, roughness: 0.15 } );
			// the clear parts switch with the glass (applyGlass: transmission under GI and the path tracer)
			m.glass.userData.linked = [ m.rim, m.lid ];
			break;

		}

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

	for ( const c of mat.userData.linked ?? [] ) setClearMode( c, physical );		// (the crystal grand's case: src/clearglass.js)
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
	// venue: where it stands (main.js; the uprights in the room)
	{ id: 'grand-black', name: 'Grand · black lacquer', type: 'grand', venue: 'hall' },
	{ id: 'grand-white', name: 'Grand · white lacquer', type: 'grand', venue: 'luminara' },
	{ id: 'grand-crystal', name: 'Grand · crystal', type: 'grand', venue: 'azurea' },		// (Azurea: the seaside hotel lobby, src/azurea.js)
];

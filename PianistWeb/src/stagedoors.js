// The Berlin hall's two stage doors made real: in the scan each is only painted on the stage's side
// wall (a cream panelled leaf in a 3.6 cm reveal between two marble pilasters, beside the side
// terraces, ~2.2 m from the back of the stage). Its painted leaf (the wall's two triangles) is cut
// out and becomes a leaf on hinges, its faces the same texture, with lever handles; behind it a
// lined opening through the wall and a short corridor (warm, dim, a ceiling lamp) for a shot that
// starts outside. The leaves swing into the hall (pushed open from the corridor), hinged on the
// side towards the audience.
//
// In the hall's world frame (hall.js: y 0 the stage floor, +x towards the audience); `stage-right`
// is the +z door (stage right, facing the audience), `stage-left` the -z one. setDoor( which, open
// 0..1 ): 1 is 90 degrees open. floorAt( x, z ): the corridor's floor (the terrace's level) there,
// else null (hall.js floorHeight: the floor map has no floor beyond the wall).

import * as THREE from 'three';

// measured on the scan's wall (buehne-wand): the painted leaf, its reveal's depth, the terrace's floor
const LEAF = { x0: - 2.725, x1: - 1.754, y0: 0.417, y1: 2.536, z: 8.19 };
const FLOOR_Y = 0.346;
const WALL = 0.21;				// the opening's lining: from the leaf's plane back through the wall (to z 8.40)
const THICK = 0.04;				// the leaf
const GAP = 0.003;				// round the leaf in its opening
// the corridor behind (free of the scan: the stalls' side wall's back at x -1.72, the gallery's floor at y 3.55)
const CORR = { x0: - 4.6, x1: - 1.725, z1: 10.6, y1: 2.95 };		// (x1: flush with the hinge side's jamb)
const OPEN_MAX = Math.PI / 2;	// (any further and the leaf meets the pilaster beside it)

export const DOOR_NAMES = [ 'stage-right', 'stage-left' ];

/** The doors in `group` (the Berlin hall's, world-space meshes): cut, built and closed. Returns their controller. */
export function addStageDoors( group ) {

	const wall = group.children.find( o => o.isMesh && /buehne-wand$/.test( o.name ) );
	if ( ! wall ) { console.warn( 'stagedoors: no stage wall' ); return null; }
	const mats = doorMaterials();
	const doors = {};
	for ( const [ name, s ] of [ [ 'stage-right', 1 ], [ 'stage-left', - 1 ] ] ) {

		const leafTris = cutLeaf( wall.geometry, s );
		if ( ! leafTris ) { console.warn( `stagedoors: ${ name }: its painted leaf not found` ); continue; }
		const d = buildDoor( name, s, leafTris, wall.material, mats );
		group.add( d.root );
		doors[ name ] = d;

	}

	return {
		doors,
		names: Object.keys( doors ),
		/** Open `which` (a name, or 'both') to `open` (0 closed .. 1 at 90 degrees). */
		set( which, open ) {

			for ( const n of which === 'both' ? Object.keys( doors ) : [ which ] ) {

				const d = doors[ n ];
				if ( ! d ) throw new Error( `door ${ n }: no such door (${ Object.keys( doors ).join( ', ' ) })` );
				d.open = THREE.MathUtils.clamp( Number( open ) || 0, 0, 1 );
				d.pivot.rotation.y = - d.s * OPEN_MAX * d.open;
				d.pivot.updateMatrixWorld( true );

			}

		},
		get( which ) { return doors[ which === 'both' ? 'stage-right' : which ]?.open ?? 0; },
		/** The corridors' floor (world y) at world x, z, else null. */
		floorAt( x, z ) {

			if ( x < CORR.x0 || x > CORR.x1 ) return null;
			const a = Math.abs( z );
			// (the opening, from the reveal back, and the corridor; the floor map has the terrace up to the wall's face)
			if ( a >= LEAF.z - 0.04 && a <= CORR.z1 && ( a > LEAF.z + WALL || ( x >= LEAF.x0 && x <= LEAF.x1 ) ) ) return FLOOR_Y;
			return null;

		},
	};

}

function doorMaterials() {

	const std = ( o ) => new THREE.MeshStandardMaterial( o );
	return {
		// the leaf's edges and the lining: the leaf's cream paint
		paint: new THREE.MeshPhysicalMaterial( { color: '#d8ccb6', roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.4 } ),
		handle: new THREE.MeshPhysicalMaterial( { color: '#b89a68', metalness: 1, roughness: 0.28 } ),		// brass levers
		// the corridor: plain painted walls, a darker skirting, a worn wooden floor, a lamp; a little light of
		// its own (emissive: the raster has no light here but the hall's through the walls)
		wall: std( { color: '#a8977e', roughness: 0.85, emissive: new THREE.Color( '#8a6a44' ), emissiveIntensity: 0.16 } ),
		ceiling: std( { color: '#9a9080', roughness: 0.9, emissive: new THREE.Color( '#8a6a44' ), emissiveIntensity: 0.14 } ),
		skirting: std( { color: '#3d3128', roughness: 0.6, emissive: new THREE.Color( '#20160c' ), emissiveIntensity: 0.1 } ),
		floor: std( { color: '#5b4330', roughness: 0.55, emissive: new THREE.Color( '#4a3018' ), emissiveIntensity: 0.14 } ),
		lamp: std( { color: '#f4e6cc', roughness: 0.6, emissive: new THREE.Color( '#ffd9a6' ), emissiveIntensity: 2.2 } ),
		lampRim: std( { color: '#6a5a44', metalness: 0.8, roughness: 0.4 } ),
		// the leaf's corridor face: its paint (the wall's material) lit a little by the corridor's lamp (emissive)
		leafBack( wall ) {

			if ( ! this._back ) {

				this._back = wall.clone();
				Object.assign( this._back, { name: 'stageDoorBack', emissive: new THREE.Color( '#ffdcb0' ), emissiveMap: wall.map, emissiveIntensity: 0.06 } );

			}
			return this._back;

		},
	};

}

/**
 * The painted leaf's triangles on the wall (all three corners on its plane, inside its rectangle) taken
 * out of `geo` (indexed); returned as a non-indexed geometry with all of the wall's attributes.
 */
function cutLeaf( geo, s ) {

	const P = geo.attributes.position, I = geo.index.array, keep = [], cut = [];
	const inLeaf = i => Math.abs( P.getZ( i ) - s * LEAF.z ) < 0.008 && P.getX( i ) > LEAF.x0 - 0.01 && P.getX( i ) < LEAF.x1 + 0.01 && P.getY( i ) > LEAF.y0 - 0.01 && P.getY( i ) < LEAF.y1 + 0.01;
	for ( let t = 0; t < I.length; t += 3 ) ( inLeaf( I[ t ] ) && inLeaf( I[ t + 1 ] ) && inLeaf( I[ t + 2 ] ) ? cut : keep ).push( I[ t ], I[ t + 1 ], I[ t + 2 ] );
	if ( ! cut.length ) return null;
	geo.setIndex( keep );
	const out = new THREE.BufferGeometry();
	for ( const [ k, a ] of Object.entries( geo.attributes ) ) {

		const arr = new Float32Array( cut.length * a.itemSize );
		cut.forEach( ( i, j ) => { for ( let c = 0; c < a.itemSize; ++ c ) arr[ j * a.itemSize + c ] = a.getComponent( i, c ); } );
		out.setAttribute( k, new THREE.BufferAttribute( arr, a.itemSize ) );

	}
	return out;

}

/** A box between two corners (world), as a geometry. */
function box( x0, y0, z0, x1, y1, z1 ) {

	return new THREE.BoxGeometry( Math.abs( x1 - x0 ), Math.abs( y1 - y0 ), Math.abs( z1 - z0 ) ).translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );

}

/** A flat quad facing `n` ([nx, ny, nz]) at the centre `c` with half sizes along two axes. */
function quad( c, u, v, n ) {

	const g = new THREE.PlaneGeometry( 1, 1 );
	const m = new THREE.Matrix4().makeBasis( new THREE.Vector3( ...u ), new THREE.Vector3( ...v ), new THREE.Vector3( ...n ) ).setPosition( ...c );
	return g.applyMatrix4( m );

}

function buildDoor( name, s, leafTris, wallMaterial, M ) {

	const root = new THREE.Group();
	root.name = `stageDoor:${ name }`;
	const mesh = ( geo, mat, parent = root, shadow = true ) => {

		const m = new THREE.Mesh( geo, mat );
		m.castShadow = shadow; m.receiveShadow = true;
		m.name = `${ root.name }:${ mat.name || mat.type }`;
		parent.add( m );
		return m;

	};
	const Z = v => s * v;			// (the -z door: the +z one's mirror)
	const zf = LEAF.z, zb = LEAF.z + WALL;

	// the leaf: on its hinge (the side towards the audience, +x), its faces the painted one (cut from the
	// wall: the same texture), front and back; its edges painted
	const hx = LEAF.x1 - GAP, pivot = new THREE.Group();
	pivot.position.set( hx, 0, Z( zf ) );
	root.add( pivot );
	const lx0 = LEAF.x0 + GAP, ly0 = LEAF.y0 + GAP, ly1 = LEAF.y1 - GAP;
	{

		// the front: the cut triangles squeezed into the leaf's rectangle (less the gap), in the pivot's frame
		const front = leafTris.clone(), P = front.attributes.position;
		for ( let i = 0; i < P.count; ++ i ) {

			const u = ( P.getX( i ) - LEAF.x0 ) / ( LEAF.x1 - LEAF.x0 ), v = ( P.getY( i ) - LEAF.y0 ) / ( LEAF.y1 - LEAF.y0 );
			P.setXYZ( i, lx0 + u * ( hx - lx0 ) - hx, ly0 + v * ( ly1 - ly0 ), 0 );

		}
		P.needsUpdate = true;
		mesh( front, wallMaterial, pivot );
		// the back: the same, a leaf's thickness behind, facing the corridor
		const back = front.clone(), B = back.attributes.position, N = back.attributes.normal;
		for ( let i = 0; i < B.count; ++ i ) B.setZ( i, Z( THICK ) );
		if ( N ) for ( let i = 0; i < N.count; ++ i ) N.setXYZ( i, - N.getX( i ), - N.getY( i ), - N.getZ( i ) );
		for ( let i = 0; i < B.count; i += 3 ) for ( const a of Object.values( back.attributes ) ) {		// (wound the other way)

			for ( let c = 0; c < a.itemSize; ++ c ) { const t = a.getComponent( i + 1, c ); a.setComponent( i + 1, c, a.getComponent( i + 2, c ) ); a.setComponent( i + 2, c, t ); }

		}
		mesh( back, M.leafBack( wallMaterial ), pivot );
		// the edges (a box a little inside the faces: no z-fight with them)
		mesh( box( lx0 - hx, ly0, Z( 0.002 ), 0, ly1, Z( THICK - 0.002 ) ), M.paint, pivot );
		// lever handles on both faces, at the painted one (its free edge, 1.05 m up)
		const hy = FLOOR_Y + 1.05, hxl = lx0 - hx + 0.13;
		for ( const side of [ - 1, 1 ] ) {

			const zs = side < 0 ? Z( - 0.002 ) : Z( THICK + 0.002 ), out = side < 0 ? - s : s;
			const rose = new THREE.CylinderGeometry( 0.026, 0.028, 0.012, 20 ).rotateX( Math.PI / 2 ).translate( hxl, hy, zs + out * 0.006 );
			mesh( rose, M.handle, pivot );
			const neck = new THREE.CylinderGeometry( 0.009, 0.009, 0.05, 12 ).rotateX( Math.PI / 2 ).translate( hxl, hy, zs + out * 0.03 );
			mesh( neck, M.handle, pivot );
			// the lever: towards the hinge, its end turned in a little
			const lever = new THREE.CapsuleGeometry( 0.0095, 0.115, 4, 10 ).rotateZ( Math.PI / 2 ).translate( hxl + 0.065, hy, zs + out * 0.055 );
			mesh( lever, M.handle, pivot );
			const plate = box( hxl - 0.012, hy - 0.11, 0, hxl + 0.012, hy - 0.06, out * 0.004 ).translate( 0, 0, zs );
			mesh( plate, M.handle, pivot );

		}

	}

	// the opening through the wall: its lining (jambs, head, a sill to the terrace's level), from the reveal back
	{

		const x0 = LEAF.x0, x1 = LEAF.x1, y0 = LEAF.y0, y1 = LEAF.y1, t = 0.025;
		mesh( box( x0 - t, FLOOR_Y, Z( zf ), x0, y1 + t, Z( zb ) ), M.paint );
		mesh( box( x1, FLOOR_Y, Z( zf ), x1 + t, y1 + t, Z( zb ) ), M.paint );
		mesh( box( x0 - t, y1, Z( zf ), x1 + t, y1 + t, Z( zb ) ), M.paint );
		mesh( box( x0, FLOOR_Y, Z( zf ), x1, y0, Z( zb ) ), M.skirting );		// the sill
		// a stop moulding on the corridor's side, round the opening
		mesh( box( x0, y1 - 0.02, Z( zb - 0.03 ), x1, y1, Z( zb ) ), M.paint );

	}

	// the corridor: inward-facing walls (unseen from the hall), the wall towards the hall with the opening in it
	{

		const { x0, x1, z1, y1 } = CORR, y0 = FLOOR_Y, cx = ( x0 + x1 ) / 2, cz = ( zb + z1 ) / 2, w = x1 - x0, d = z1 - zb, h = y1 - y0, cy = ( y0 + y1 ) / 2;
		// (each quad's two axes crossed along its normal, for either door: else its triangles face away)
		mesh( quad( [ cx, y0, Z( cz ) ], [ w, 0, 0 ], [ 0, 0, - d ], [ 0, 1, 0 ] ), M.floor );
		mesh( quad( [ cx, y1, Z( cz ) ], [ w, 0, 0 ], [ 0, 0, d ], [ 0, - 1, 0 ] ), M.ceiling );
		mesh( quad( [ cx, cy, Z( z1 ) ], [ - s * w, 0, 0 ], [ 0, h, 0 ], [ 0, 0, - s ] ), M.wall );		// the far wall
		mesh( quad( [ x0, cy, Z( cz ) ], [ 0, 0, - d ], [ 0, h, 0 ], [ 1, 0, 0 ] ), M.wall );
		mesh( quad( [ x1, cy, Z( cz ) ], [ 0, 0, d ], [ 0, h, 0 ], [ - 1, 0, 0 ] ), M.wall );
		// the wall towards the hall, round the opening (four quads)
		const ox0 = LEAF.x0 - 0.025, ox1 = LEAF.x1 + 0.025, oy1 = LEAF.y1 + 0.025;
		const near = ( a, b, c, e ) => b - a > 0.005 && mesh( quad( [ ( a + b ) / 2, ( c + e ) / 2, Z( zb ) ], [ s * ( b - a ), 0, 0 ], [ 0, e - c, 0 ], [ 0, 0, s ] ), M.wall );
		near( x0, ox0, y0, y1 );
		near( ox1, x1, y0, y1 );
		near( ox0, ox1, oy1, y1 );
		// skirting along the walls
		const sk = 0.1, st = 0.015;
		mesh( box( x0, y0, Z( z1 - st ), x1, y0 + sk, Z( z1 ) ), M.skirting );
		mesh( box( x0, y0, Z( zb ), x0 + st, y0 + sk, Z( z1 ) ), M.skirting );
		mesh( box( x1 - st, y0, Z( zb ), x1, y0 + sk, Z( z1 ) ), M.skirting );
		mesh( box( x0, y0, Z( zb ), ox0, y0 + sk, Z( zb + st ) ), M.skirting );
		mesh( box( ox1, y0, Z( zb ), x1, y0 + sk, Z( zb + st ) ), M.skirting );
		// a round ceiling lamp, over the corridor's middle in front of the door
		const lx = ( LEAF.x0 + LEAF.x1 ) / 2 - 0.4, lz = Z( ( zb + z1 ) / 2 );
		mesh( new THREE.CylinderGeometry( 0.17, 0.15, 0.06, 32 ).translate( lx, y1 - 0.045, lz ), M.lamp, root, false );
		mesh( new THREE.CylinderGeometry( 0.18, 0.18, 0.015, 32 ).translate( lx, y1 - 0.008, lz ), M.lampRim, root, false );

	}

	return { name, s, root, pivot, open: 0 };

}

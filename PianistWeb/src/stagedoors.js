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
//
// The corridor-facing (outer) door face, in public/berlinhall/: door-diffuse.jpg (albedo, gpt-image-2; chosen
// over a procedural one, compared 2026-11-16), its panels and mouldings real geometry (panelledFace), and
// door-normal-detail.jpg (the paint's fine relief) as its normal map.

import * as THREE from 'three';

// (?doorgeo=0: the corridor face flat with the generated normal map (door-normal.png), as before the panels were geometry: to compare)
const DOOR_FLAT = typeof location !== 'undefined' && new URLSearchParams( location.search ).get( 'doorgeo' ) === '0';

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
		/** Resolves when the corridor faces' textures have loaded (or failed). */
		ready: ( async () => { while ( texLoaded.length < texWanted.length ) await new Promise( r => setTimeout( r, 30 ) ); } )(),
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

const texWanted = [], texLoaded = [];		// (the textures' loads: the doors' `ready`)

function loadTex( url, colorSpace = THREE.SRGBColorSpace ) {

	const t = new THREE.TextureLoader().load( url, () => texLoaded.push( url ), undefined, () => texLoaded.push( url ) );
	texWanted.push( url );
	t.colorSpace = colorSpace;
	t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
	return t;

}

/** The outer-face (corridor side) material. */
function outerLeafMaterial() {

	const base = import.meta.env.BASE_URL ?? '/';
	const diffuse = loadTex( `${ base }berlinhall/door-diffuse.jpg`, THREE.SRGBColorSpace );
	// (generated: the panels are geometry; its normal map only the paint's fine relief, from the diffuse's own
	// texture (door-normal-detail.jpg): the generated normal map's mouldings were off the painted ones, and doubled)
	const normal  = loadTex( DOOR_FLAT ? `${ base }berlinhall/door-normal.png` : `${ base }berlinhall/door-normal-detail.jpg`, THREE.NoColorSpace );
	return new THREE.MeshStandardMaterial( {
		name: 'stageDoorOuter',
		map: diffuse,
		normalMap: normal,
		normalMapType: THREE.TangentSpaceNormalMap,
		normalScale: DOOR_FLAT ? new THREE.Vector2( 1.2, 1.2 ) : new THREE.Vector2( 1, 1 ),
		roughness: 0.52,
		color: '#f5f0ea',
		// (no glow of its own: lit only by the hall's light and the corridor's, dark at the opening's Spotlight,
		// its panels read in the dim; a glow of its texture had made it a white door in the dark)
	} );

}

function doorMaterials() {

	const std = ( o ) => new THREE.MeshStandardMaterial( o );
	return {
		// the leaf's edges and the lining: the leaf's cream paint
		paint: new THREE.MeshPhysicalMaterial( { color: '#d8ccb6', roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.4 } ),
		handle: new THREE.MeshPhysicalMaterial( { color: '#b89a68', metalness: 1, roughness: 0.28 } ),		// brass levers
		// the corridor: dimmed to ~60 % of the first version (its own glow; the lamp, which lights it in the path tracer)
		wall:     std( { color: '#a8977e', roughness: 0.85, emissive: new THREE.Color( '#8a6a44' ), emissiveIntensity: 0.095 } ),
		ceiling:  std( { color: '#9a9080', roughness: 0.9,  emissive: new THREE.Color( '#8a6a44' ), emissiveIntensity: 0.085 } ),
		skirting: std( { color: '#3d3128', roughness: 0.6,  emissive: new THREE.Color( '#20160c' ), emissiveIntensity: 0.06 } ),
		floor:    std( { color: '#5b4330', roughness: 0.55, emissive: new THREE.Color( '#4a3018' ), emissiveIntensity: 0.085 } ),
		lamp:     std( { color: '#f4e6cc', roughness: 0.6,  emissive: new THREE.Color( '#ffd9a6' ), emissiveIntensity: 1.3 } ),
		lampRim:  std( { color: '#6a5a44', metalness: 0.8, roughness: 0.4 } ),
		// the outer face of the leaf: the generated texture, its panels geometry
		outerFace: outerLeafMaterial(),
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

// The corridor face's panels (door-diffuse.jpg, 1024 x 2048 over the leaf, rows from its top), as cast: per side
// of each panel the moulding's outer edge (E), the groove at its inner foot (G), where the raised field's bevel
// meets the flat (F), read off the painted lines (their brightness across them; the generated image is not quite
// symmetric, nor were its normal map's mouldings where its paint has them: that map is not used for them)
const PANEL_PX = [
	// x: left E, G, F; right F, G, E; y: top E, G, F; bottom F, G, E (image rows)
	{ x: [ 134, 156, 194, 830, 864, 892 ], y: [ 113, 140, 177, 921, 957, 1014 ] },
	{ x: [ 134, 156, 194, 830, 864, 892 ], y: [ 1126, 1149, 1186, 1841, 1877, 1934 ] },
];
// the section, from the frame's plane (0) outward (+), along E -> G -> F: a rounded moulding standing 9 mm proud,
// rolling down to its foot; a step down into the groove (20 mm deep); the field's bevel up to the flat field,
// recessed 13 mm. [ where (0: E, 1: G; 1..2: G -> F), height (m) ]
const PANEL_SECTION = [
	[ 0, 0 ], [ 0.04, 0.0035 ], [ 0.12, 0.0068 ], [ 0.24, 0.0086 ], [ 0.38, 0.009 ], [ 0.52, 0.0084 ], [ 0.66, 0.0062 ], [ 0.79, 0.0028 ], [ 0.9, - 0.0014 ], [ 1, - 0.006 ],
	[ 1, - 0.02 ], [ 1.06, - 0.02 ], [ 1.25, - 0.0175 ], [ 2, - 0.013 ],
];

/**
 * The leaf's corridor face with its panels (pivot frame: x lx..rx, y y0..y1; the face THICK out from the hall's,
 * along s z): the frame flat (with holes), each panel's rings by the section, mitred at the corners, the field flat;
 * uv the leaf's 0..1 (as the flat face had), facets flat-shaded (the bevels' planes read).
 */
function panelledFace( lx, rx, y0, y1, s ) {

	const W = rx - lx, H = y1 - y0;
	const X = c => lx + c / 1024 * W, Y = r => y0 + ( 1 - r / 2048 ) * H;
	const tris = [];		// [ [ x, y, h ] x 3 ] wound counter-clockwise seen from outside (+h)
	// the frame: the leaf's rectangle less the panels' outer edges
	const shape = new THREE.Shape( [ new THREE.Vector2( lx, y0 ), new THREE.Vector2( rx, y0 ), new THREE.Vector2( rx, y1 ), new THREE.Vector2( lx, y1 ) ] );
	const rects = PANEL_PX.map( p => ( { E: [ X( p.x[ 0 ] ), X( p.x[ 5 ] ), Y( p.y[ 5 ] ), Y( p.y[ 0 ] ) ], G: [ X( p.x[ 1 ] ), X( p.x[ 4 ] ), Y( p.y[ 4 ] ), Y( p.y[ 1 ] ) ], F: [ X( p.x[ 2 ] ), X( p.x[ 3 ] ), Y( p.y[ 3 ] ), Y( p.y[ 2 ] ) ] } ) );
	for ( const r of rects ) {

		const [ a, b, c, d ] = r.E;
		shape.holes.push( new THREE.Path( [ new THREE.Vector2( a, c ), new THREE.Vector2( a, d ), new THREE.Vector2( b, d ), new THREE.Vector2( b, c ) ] ) );

	}
	const fg = new THREE.ShapeGeometry( shape ), fp = fg.attributes.position, fi = fg.index.array;
	for ( let i = 0; i < fi.length; i += 3 ) tris.push( [ 0, 1, 2 ].map( k => [ fp.getX( fi[ i + k ] ), fp.getY( fi[ i + k ] ), 0 ] ) );
	fg.dispose();
	// the panels: rings (rectangles at a height) from the outer edge in, joined side by side
	const lerp = ( A, B, t ) => A.map( ( v, k ) => v + ( B[ k ] - v ) * t );
	const quad = ( p, q, r, t, cx, cy ) => {

		// p q r t round the quad; its facing: outward (+h), or for an upright step towards the panel's middle
		const e1 = [ q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ], q[ 2 ] - p[ 2 ] ], e2 = [ r[ 0 ] - p[ 0 ], r[ 1 ] - p[ 1 ], r[ 2 ] - p[ 2 ] ];
		const n = [ e1[ 1 ] * e2[ 2 ] - e1[ 2 ] * e2[ 1 ], e1[ 2 ] * e2[ 0 ] - e1[ 0 ] * e2[ 2 ], e1[ 0 ] * e2[ 1 ] - e1[ 1 ] * e2[ 0 ] ];
		const mx = ( p[ 0 ] + r[ 0 ] ) / 2, my = ( p[ 1 ] + r[ 1 ] ) / 2;
		const flip = n[ 2 ] < - 1e-12 || ( Math.abs( n[ 2 ] ) <= 1e-12 && n[ 0 ] * ( cx - mx ) + n[ 1 ] * ( cy - my ) < 0 );
		if ( flip ) tris.push( [ p, r, q ], [ p, t, r ] ); else tris.push( [ p, q, r ], [ p, r, t ] );

	};
	for ( const r of rects ) {

		const ring = ( [ w, h ] ) => [ ...( w <= 1 ? lerp( r.E, r.G, w ) : lerp( r.G, r.F, w - 1 ) ), h ];
		const rings = PANEL_SECTION.map( ring );		// [ x0, x1, yb, yt, h ]
		const cx = ( r.F[ 0 ] + r.F[ 1 ] ) / 2, cy = ( r.F[ 2 ] + r.F[ 3 ] ) / 2;
		for ( let k = 0; k + 1 < rings.length; ++ k ) {

			const [ a0, a1, ab, at, ah ] = rings[ k ], [ b0, b1, bb, bt, bh ] = rings[ k + 1 ];
			quad( [ a0, at, ah ], [ a1, at, ah ], [ b1, bt, bh ], [ b0, bt, bh ], cx, cy );		// top
			quad( [ a1, ab, ah ], [ a0, ab, ah ], [ b0, bb, bh ], [ b1, bb, bh ], cx, cy );		// bottom
			quad( [ a0, ab, ah ], [ a0, at, ah ], [ b0, bt, bh ], [ b0, bb, bh ], cx, cy );		// left
			quad( [ a1, at, ah ], [ a1, ab, ah ], [ b1, bb, bh ], [ b1, bt, bh ], cx, cy );		// right

		}
		const [ f0, f1, fb, ft, fh ] = rings[ rings.length - 1 ];
		quad( [ f0, fb, fh ], [ f1, fb, fh ], [ f1, ft, fh ], [ f0, ft, fh ], cx, cy );		// the field

	}
	// out: the face THICK + h along s z; mirrored (s -1), wound the other way to keep facing the corridor
	const pos = new Float32Array( tris.length * 9 ), uv = new Float32Array( tris.length * 6 );
	tris.forEach( ( t, i ) => {

		const o = s < 0 ? [ t[ 0 ], t[ 2 ], t[ 1 ] ] : t;
		o.forEach( ( [ x, y, h ], k ) => {

			pos.set( [ x, y, s * ( THICK + h ) ], i * 9 + k * 3 );
			uv.set( [ ( x - lx ) / W, ( y - y0 ) / H ], i * 6 + k * 2 );

		} );

	} );
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
	g.computeVertexNormals();		// (not indexed: each facet's own, flat)
	return g;

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
		// remap UVs on the back face to the leaf's 0..1 rectangle (the front's UVs are the wall atlas; the outer
		// face gets its own texture, so its UVs should cover the full 0..1 of that texture)
		{

			const U = back.attributes.uv;
			if ( U ) for ( let i = 0; i < U.count; ++ i ) {

				const lx = lx0 - hx, lw = 0 - lx, ly = ly0, lh = ly1 - ly0;
				const p = back.attributes.position;
				const u = ( p.getX( i ) - lx ) / lw;
				const v = ( p.getY( i ) - ly ) / lh;
				U.setXY( i, u, v );

			}
			if ( U ) U.needsUpdate = true;

		}
		// (the generated texture's face: its panels and mouldings as geometry, aligned with the painted ones)
		mesh( ! DOOR_FLAT ? panelledFace( lx0 - hx, 0, ly0, ly1, s ) : back, M.outerFace, pivot );
		// the edges (a box a little inside the faces: no z-fight with them)
		mesh( box( lx0 - hx, ly0, Z( 0.002 ), 0, ly1, Z( THICK - 0.002 ) ), M.paint, pivot );
		// lever handles on both faces, at the painted one (its free edge, 1.05 m up)
		// (the corridor's, on the generated face, nearer the edge: its panels' mouldings come to 126 mm from it, where the
		// hall's painted handle is)
		const hy = FLOOR_Y + 1.05;
		for ( const side of [ - 1, 1 ] ) {

			const hxl = lx0 - hx + ( side > 0 && ! DOOR_FLAT ? 0.07 : 0.13 );

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

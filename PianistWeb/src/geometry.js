// Geometry helpers: grain-aware box UV projection, extrusions in arbitrary planes, merging.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Re-project UVs per triangle along its dominant axis, in meters / `scale`.
 * `grain` is the local axis ('x' | 'y' | 'z') the wood grain should run along (texture u).
 * `offset` randomizes the texture window so pieces sharing a material don't look cloned;
 * when it is left random, the grain also gets a small random angle (±3°) so it never sits
 * exactly on the part's axis. `angle` (radians) sets it explicitly.
 */
export function boxProjectUV( geometry, { grain = 'x', scale = 1.5, vScale = 2, offset = null, angle = null } = {} ) {

	const geo = geometry.index ? geometry.toNonIndexed() : geometry;
	if ( ! geo.attributes.normal ) geo.computeVertexNormals();
	const pos = geo.attributes.position;
	const uv = new Float32Array( pos.count * 2 );
	const off = offset ?? [ Math.random() * 10, Math.random() ];
	const ang = angle ?? ( offset ? 0 : ( Math.random() - 0.5 ) * 2 * 3 * Math.PI / 180 );
	const ca = Math.cos( ang ), sa = Math.sin( ang );
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();

	for ( let i = 0; i < pos.count; i += 3 ) {

		a.fromBufferAttribute( pos, i );
		b.fromBufferAttribute( pos, i + 1 );
		c.fromBufferAttribute( pos, i + 2 );
		n.subVectors( c, b ).cross( a.clone().sub( b ) ).normalize();
		const ax = Math.abs( n.x ), ay = Math.abs( n.y ), az = Math.abs( n.z );
		// the face's plane axis
		const face = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';

		for ( let k = 0; k < 3; ++ k ) {

			const p = [ a, b, c ][ k ];
			const coord = { x: p.x, y: p.y, z: p.z };
			// u along grain; v along the remaining in-plane axis
			let uAxis = grain, vAxis;
			if ( face === grain ) {

				// end grain: just use the two remaining axes
				const rest = [ 'x', 'y', 'z' ].filter( t => t !== face );
				uAxis = rest[ 0 ]; vAxis = rest[ 1 ];

			} else {

				vAxis = [ 'x', 'y', 'z' ].find( t => t !== face && t !== grain );

			}

			const pu = coord[ uAxis ] * ca - coord[ vAxis ] * sa;
			const pv = coord[ uAxis ] * sa + coord[ vAxis ] * ca;
			uv[ ( i + k ) * 2 ] = pu / scale + off[ 0 ];
			uv[ ( i + k ) * 2 + 1 ] = pv / scale * vScale + off[ 1 ];

		}

	}

	geo.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
	return geo;

}

/** Box with min/max corners, UV-projected for wood grain. */
export function woodBox( min, max, opts = {} ) {

	const size = new THREE.Vector3().subVectors( max, min );
	const geo = opts.radius
		? new RoundedBoxGeometry( size.x, size.y, size.z, 3, opts.radius )
		: new THREE.BoxGeometry( size.x, size.y, size.z );
	geo.translate( ( min.x + max.x ) / 2, ( min.y + max.y ) / 2, ( min.z + max.z ) / 2 );
	return opts.noUV ? geo : boxProjectUV( geo, opts );

}

export const v3 = ( x, y, z ) => new THREE.Vector3( x, y, z );

/**
 * Extrude a 2D profile drawn in the side (z, y) plane along +x from x0 to x1.
 * The shape's local (x, y) map to world (z, y).
 */
export function extrudeSide( shape, x0, x1, { bevel = 0.002, curveSegments = 24 } = {} ) {

	const depth = Math.max( x1 - x0 - 2 * bevel, 1e-4 );
	const geo = new THREE.ExtrudeGeometry( shape, {
		depth,
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: - bevel,
		bevelSegments: 2,
		curveSegments,
	} );
	// shape (sx, sy, ez) -> world (ez, sy, sx): rotate -90° about y
	geo.rotateY( - Math.PI / 2 );
	geo.scale( - 1, 1, 1 );
	geo.translate( x0 + bevel, 0, 0 );
	return fixWinding( geo );

}

/**
 * Extrude a 2D profile drawn in the top (x, z) plane upward from y0 to y1.
 * Shape's local (x, y) map to world (x, z).
 */
export function extrudeTop( shape, y0, y1, { bevel = 0.002, curveSegments = 48 } = {} ) {

	const depth = Math.max( y1 - y0 - 2 * bevel, 1e-4 );
	const geo = new THREE.ExtrudeGeometry( shape, {
		depth,
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: - bevel,
		bevelSegments: 2,
		curveSegments,
	} );
	// shape (sx, sy, ez) -> world (sx, ez, sy): rotate +90° about x maps y->z, z->-y
	geo.rotateX( Math.PI / 2 );
	geo.scale( 1, - 1, 1 );
	geo.translate( 0, y0 + bevel, 0 );
	return fixWinding( geo );

}

/**
 * Extrude a 2D profile drawn in the front (x, y) plane along -z from z1 to z0 (z0 < z1).
 */
export function extrudeFront( shape, z0, z1, { bevel = 0.002, curveSegments = 32 } = {} ) {

	const depth = Math.max( z1 - z0 - 2 * bevel, 1e-4 );
	const geo = new THREE.ExtrudeGeometry( shape, {
		depth,
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: - bevel,
		bevelSegments: 2,
		curveSegments,
	} );
	geo.translate( 0, 0, z0 + bevel );
	return geo;

}

// a mirror (scale with negative determinant) flips triangle winding; flip it back.
// Normals were already transformed correctly by the normal matrix.
function fixWinding( geo ) {

	const g = geo.index ? geo.toNonIndexed() : geo;
	const pos = g.attributes.position;
	const attrs = Object.values( g.attributes );
	for ( let i = 0; i < pos.count; i += 3 ) {

		for ( const attr of attrs ) {

			for ( let c = 0; c < attr.itemSize; ++ c ) {

				const t = attr.array[ ( i + 1 ) * attr.itemSize + c ];
				attr.array[ ( i + 1 ) * attr.itemSize + c ] = attr.array[ ( i + 2 ) * attr.itemSize + c ];
				attr.array[ ( i + 2 ) * attr.itemSize + c ] = t;

			}

		}

	}

	return g;

}

export function mirrorX( geo ) {

	const g = geo.clone();
	g.scale( - 1, 1, 1 );
	return fixWinding( g );

}

/** Merge geometries after stripping to a common attribute set. */
export function merge( geos, attrs = [ 'position', 'normal', 'uv' ] ) {

	const list = geos.map( g => {

		let x = g.index ? g.toNonIndexed() : g;
		if ( ! x.attributes.normal ) x.computeVertexNormals();
		if ( ! x.attributes.uv ) x.setAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( x.attributes.position.count * 2 ), 2 ) );
		for ( const name of Object.keys( x.attributes ) ) if ( ! attrs.includes( name ) ) x.deleteAttribute( name );
		return x;

	} );
	return mergeGeometries( list, false );

}

/** Thin box spanning from point a to point b with the given cross-section. */
export function beam( a, b, w, h ) {

	const len = a.distanceTo( b );
	const geo = new THREE.BoxGeometry( w, h, len );
	const m = new THREE.Matrix4().lookAt( a, b, Math.abs( b.x - a.x ) + Math.abs( b.z - a.z ) < 1e-6 ? new THREE.Vector3( 0, 0, 1 ) : new THREE.Vector3( 0, 1, 0 ) );
	geo.applyMatrix4( m );
	geo.translate( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2, ( a.z + b.z ) / 2 );
	return geo;

}

/** Cylinder from a to b. */
export function rod( a, b, r, segments = 8, r2 = r ) {

	const len = a.distanceTo( b );
	const geo = new THREE.CylinderGeometry( r2, r, len, segments, 1 );
	geo.translate( 0, len / 2, 0 );
	const dir = new THREE.Vector3().subVectors( b, a ).normalize();
	geo.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir ) );
	geo.translate( a.x, a.y, a.z );
	return geo;

}

export function roundedRectShape( x0, y0, x1, y1, r ) {

	const s = new THREE.Shape();
	r = Math.min( r, ( x1 - x0 ) / 2, ( y1 - y0 ) / 2 );
	s.moveTo( x0 + r, y0 );
	s.lineTo( x1 - r, y0 );
	s.quadraticCurveTo( x1, y0, x1, y0 + r );
	s.lineTo( x1, y1 - r );
	s.quadraticCurveTo( x1, y1, x1 - r, y1 );
	s.lineTo( x0 + r, y1 );
	s.quadraticCurveTo( x0, y1, x0, y1 - r );
	s.lineTo( x0, y0 + r );
	s.quadraticCurveTo( x0, y0, x0 + r, y0 );
	return s;

}

export function roundedRectPath( x0, y0, x1, y1, r ) {

	const p = new THREE.Path();
	r = Math.min( r, ( x1 - x0 ) / 2, ( y1 - y0 ) / 2 );
	p.moveTo( x0 + r, y0 );
	p.lineTo( x1 - r, y0 );
	p.quadraticCurveTo( x1, y0, x1, y0 + r );
	p.lineTo( x1, y1 - r );
	p.quadraticCurveTo( x1, y1, x1 - r, y1 );
	p.lineTo( x0 + r, y1 );
	p.quadraticCurveTo( x0, y1, x0, y1 - r );
	p.lineTo( x0, y0 + r );
	p.quadraticCurveTo( x0, y0, x0 + r, y0 );
	return p;

}

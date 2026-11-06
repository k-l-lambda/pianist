#!/usr/bin/env python3
"""A TRELLIS mesh's parts from its photos: each vertex labelled with the material of the part it is on
(leather shell, boucle, a velvet pillow, a metal inlay, the pedestal, its floor ring), for
tools/luminara-asset.mjs's CLASSES (the part as a sixth argument). TRELLIS's vertex colour is too soft
for that (a cream leather and a cream boucle shade alike); the photos are not: boucle is finely
textured and darker, leather smooth and bright, the inlay a warm line, the pillows blue.

  .venv-trellis/bin/python PianistWeb/tools/luminara-parts.py <generated> <slug> [...] [--preview dir]

Per photo (<slug>-rgba.png and its -view<k>-rgba.png, tools/luminara-gen.mjs crops): its pixels
labelled, from its segmentation map when there is one (<name>-seg.png, tools/luminara-segmap.mjs: the
photo recoloured into flat part colours, aligned to the photo by their bounding boxes), else by
texture, brightness and colour (rough: a lit leather and a shaded boucle overlap); the mesh's camera
found (an orthographic view: yaw and pitch searched for the best silhouette overlap and colour
agreement, the colour telling a symmetric piece's front from its back; its scale and offset from the
bounding boxes), the visible
vertices (a z-buffer) take the label under them; votes over the photos, then the rest by their
labelled neighbours (a flood over the mesh's edges), a few rounds of majority smoothing. The
pedestal and its ring: by height (where the footprint narrows under the seat). Out:
<slug>-parts.glb, the TRELLIS mesh with the part id in its colour's alpha (PARTS).
"""
import argparse, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
import scipy.sparse as sp
import trimesh

PARTS = { 'leather': 1, 'boucle': 2, 'velvet': 3, 'inlay': 4, 'pedestal': 5, 'ring': 6 }
COLOURS = { 0: ( 40, 40, 40 ), 1: ( 245, 238, 225 ), 2: ( 190, 140, 90 ), 3: ( 80, 115, 215 ), 4: ( 255, 205, 30 ), 5: ( 120, 80, 50 ), 6: ( 255, 120, 40 ) }


SEG = { 'leather': ( 255, 0, 0 ), 'boucle': ( 0, 255, 0 ), 'velvet': ( 0, 0, 255 ), 'inlay': ( 255, 255, 0 ), 'pedestal': ( 255, 0, 255 ) }		# (tools/luminara-segmap.mjs)


def seg_labels( seg, mask ):
	"""Per pixel from a segmentation map: the nearest of SEG's colours (white, grey: none), its parts'
	box fitted onto the photo's mask's (the redrawing is not pixel-exact)."""
	s = seg[ ..., :3 ].astype( float ); H, W = mask.shape
	names = list( SEG ); C = np.array( [ SEG[ k ] for k in names ], float )
	d = ( ( s[ :, :, None, : ] - C[ None, None ] ) ** 2 ).sum( 3 ); k = d.argmin( 2 ); dmin = d.min( 2 )
	sat = s.max( 2 ) - s.min( 2 )
	lab = np.where( ( dmin < 120 ** 2 ) & ( sat > 90 ), np.array( [ PARTS[ n ] for n in names ] )[ k ], 0 ).astype( np.uint8 )
	ys, xs = np.where( lab > 0 ); my, mx = np.where( mask )
	if not len( ys ): return lab
	# its box onto the photo's: scale and offset (nearest)
	sx0, sx1, sy0, sy1 = xs.min(), xs.max(), ys.min(), ys.max(); px0, px1, py0, py1 = mx.min(), mx.max(), my.min(), my.max()
	Y, X = np.mgrid[ :H, :W ]
	u = np.clip( np.round( sx0 + ( X - px0 ) * ( sx1 - sx0 ) / max( 1, px1 - px0 ) ).astype( int ), 0, lab.shape[ 1 ] - 1 )
	v = np.clip( np.round( sy0 + ( Y - py0 ) * ( sy1 - sy0 ) / max( 1, py1 - py0 ) ).astype( int ), 0, lab.shape[ 0 ] - 1 )
	out = lab[ v, u ]; out[ ~ ndimage.binary_erosion( mask, iterations = 3 ) ] = 0
	# its edges: no vote (the redrawn outlines are a few px off)
	edge = ndimage.binary_dilation( ndimage.morphological_gradient( out, size = 3 ) > 0, iterations = 3 )
	out[ edge & ( out != PARTS[ 'inlay' ] ) ] = 0
	return out


def photo_labels( rgba ):
	"""Per pixel: 0 (none) or a part id, from the photo (texture, brightness, colour)."""
	rgb = rgba[ ..., :3 ].astype( float ); a = ndimage.binary_erosion( rgba[ ..., 3 ] > 128, iterations = 4 )
	lum = rgb @ [ 0.3, 0.59, 0.11 ]
	tex = ndimage.gaussian_filter( np.abs( lum - ndimage.gaussian_filter( lum, 2.0 ) ), 3 )
	edge = ndimage.gaussian_gradient_magnitude( lum, 1.5 )
	r, g, b = rgb[ ..., 0 ], rgb[ ..., 1 ], rgb[ ..., 2 ]
	lab = np.zeros( lum.shape, np.uint8 )
	# boucle: textured and darker than the leather (its loops' shade); scored, smoothed (the texture's own noise)
	score = ndimage.gaussian_filter( ( tex - 2.2 ) / 1.0 - ( lum - 188 ) / 18, 4 )
	lab[ a ] = np.where( score[ a ] > 0, PARTS[ 'boucle' ], PARTS[ 'leather' ] )
	lab[ a & ( b > r + 2 ) & ( b >= g ) ] = PARTS[ 'velvet' ]
	lab[ a & ( r - b > 44 ) & ( lum > 120 ) ] = PARTS[ 'inlay' ]
	lab[ a & ( edge > 9 ) & ( lab != PARTS[ 'inlay' ] ) ] = 0		# (outlines and creases: no vote)
	return lab, rgba[ ..., 3 ] > 128


def rot( yaw, pitch ):
	cy, sy, cp, spp = np.cos( yaw ), np.sin( yaw ), np.cos( pitch ), np.sin( pitch )
	Ry = np.array( [ [ cy, 0, sy ], [ 0, 1, 0 ], [ - sy, 0, cy ] ] ); Rx = np.array( [ [ 1, 0, 0 ], [ 0, cp, - spp ], [ 0, spp, cp ] ] )
	return Rx @ Ry


def project( v, R, mask_box, size ):
	"""The vertices orthographically, the view's silhouette box fitted to the photo's: pixel x, y and depth."""
	p = v @ R.T
	lo, hi = p[ :, :2 ].min( 0 ), p[ :, :2 ].max( 0 )
	x0, y0, x1, y1 = mask_box
	k = min( ( x1 - x0 ) / ( hi[ 0 ] - lo[ 0 ] ), ( y1 - y0 ) / ( hi[ 1 ] - lo[ 1 ] ) )
	cx, cy = ( x0 + x1 ) / 2, ( y0 + y1 ) / 2
	px = cx + ( p[ :, 0 ] - ( lo[ 0 ] + hi[ 0 ] ) / 2 ) * k
	py = cy - ( p[ :, 1 ] - ( lo[ 1 ] + hi[ 1 ] ) / 2 ) * k
	return px, py, p[ :, 2 ]


def fit_camera( v, col, mask, photo, yaw_hint = None ):
	"""Yaw and pitch whose view best matches the photo: its silhouette's overlap with the mask (IoU) and
	its colours' agreement with the photo's (the nearest vertex per pixel, at 128 px; a symmetric
	piece's silhouette is the same from the back: its colours are not)."""
	ys, xs = np.where( mask ); box = ( xs.min(), ys.min(), xs.max(), ys.max() )
	S = 128; small = np.asarray( Image.fromarray( mask.astype( np.uint8 ) * 255 ).resize( ( S, S ) ) ) > 127
	ph = np.asarray( Image.fromarray( photo ).resize( ( S, S ) ) ).astype( float ) / 255
	step = max( 1, len( v ) // 40000 ); sub, sc = v[ :: step ], col[ :: step ]
	def score( yaw, pitch ):
		px, py, z = project( sub, rot( yaw, pitch ), box, mask.shape[ 0 ] )
		ix, iy = np.clip( ( px * S / mask.shape[ 1 ] ).astype( int ), 0, S - 1 ), np.clip( ( py * S / mask.shape[ 0 ] ).astype( int ), 0, S - 1 )
		sil = np.zeros( ( S, S ), bool ); sil[ iy, ix ] = True
		sil = ndimage.binary_closing( sil, iterations = 2 )
		iou = ( sil & small ).sum() / max( 1, ( sil | small ).sum() )
		img = np.full( ( S, S, 3 ), np.nan ); o = np.argsort( z ); img[ iy[ o ], ix[ o ] ] = sc[ o ]
		both = small & ~ np.isnan( img[ ..., 0 ] )
		if both.sum() < 50: return iou, iou
		a, b = img[ both ], ph[ both ]
		a, b = a - a.mean( 0 ), b - b.mean( 0 )
		corr = ( a * b ).sum() / max( 1e-9, np.sqrt( ( a * a ).sum() * ( b * b ).sum() ) )
		return iou + 0.5 * corr, iou
	best = ( - 9, 0, 0, 0 )
	yaws = np.arange( - 180, 180, 5 ) if yaw_hint is None else yaw_hint + np.arange( - 35, 36, 5 )		# (a crop's yaw, tools/luminara-gen.mjs: near it)
	for yaw in np.radians( yaws ):
		for pitch in np.radians( np.arange( 0, 41, 5 ) ):
			sc_, iou = score( yaw, pitch )
			if sc_ > best[ 0 ]: best = ( sc_, yaw, pitch, iou )
	_, y0, p0, _ = best
	for yaw in y0 + np.radians( np.arange( - 4, 4.1, 1 ) ):
		for pitch in p0 + np.radians( np.arange( - 4, 4.1, 1 ) ):
			sc_, iou = score( yaw, pitch )
			if sc_ > best[ 0 ]: best = ( sc_, yaw, pitch, iou )
	return ( best[ 3 ], best[ 1 ], best[ 2 ] ), box


def visible( px, py, z, shape, r = 2 ):
	"""Which vertices are in front (a z-buffer of small splats; the camera looks down -z: the nearest has the largest z)."""
	H, W = shape; zb = np.full( ( H, W ), - np.inf )
	ix, iy = np.round( px ).astype( int ), np.round( py ).astype( int )
	ok = ( ix >= 0 ) & ( ix < W ) & ( iy >= 0 ) & ( iy < H )
	for dx in range( - r, r + 1 ):
		for dy in range( - r, r + 1 ):
			jx, jy = np.clip( ix + dx, 0, W - 1 ), np.clip( iy + dy, 0, H - 1 )
			np.maximum.at( zb, ( jy[ ok ], jx[ ok ] ), z[ ok ] )
	tol = 0.012 * ( z.max() - z.min() )
	vis = np.zeros( len( z ), bool )
	vis[ ok ] = z[ ok ] >= zb[ iy[ ok ], ix[ ok ] ] - tol
	return vis, ix, iy


def main():
	ap = argparse.ArgumentParser( description = __doc__.split( '\n' )[ 0 ] )
	ap.add_argument( 'generated' ); ap.add_argument( 'slugs', nargs = '+' )
	ap.add_argument( '--preview', default = None, help = 'a folder for the label images and the labelled mesh seen round' )
	a = ap.parse_args()
	for slug in a.slugs:
		m = trimesh.load( os.path.join( a.generated, f'{ slug }-trellis.glb' ), force = 'mesh', process = False )
		v = np.asarray( m.vertices ); n = len( v )
		names = [ slug ] + [ f'{ slug }-view{ k }' for k in range( 1, 9 ) if os.path.exists( os.path.join( a.generated, f'{ slug }-view{ k }-rgba.png' ) ) ]
		# each crop's yaw, if the generator recorded one (luminara.json: crop, views)
		import json
		meta = json.load( open( os.path.join( a.generated, 'luminara.json' ) ) ).get( slug, {} ) if os.path.exists( os.path.join( a.generated, 'luminara.json' ) ) else {}
		hints = [ ( meta.get( 'crop' ) or {} ).get( 'yaw' ) ] + [ v_.get( 'yaw' ) for v_ in meta.get( 'views', [] ) ]
		votes = np.zeros( ( n, 7 ) )
		for vi, name in enumerate( names ):
			rgba = np.asarray( Image.open( os.path.join( a.generated, f'{ name }-rgba.png' ) ).convert( 'RGBA' ) )
			lab, mask = photo_labels( rgba )
			segf = os.path.join( a.generated, f'{ name }-seg.png' )
			src = 'texture'
			if os.path.exists( segf ):
				seg = np.asarray( Image.open( segf ).convert( 'RGB' ).resize( mask.shape[ ::- 1 ] ) )
				lab = seg_labels( seg, mask ); src = 'its map'
			hint = hints[ vi ] if vi < len( hints ) else None
			( iou, yaw, pitch ), box = fit_camera( v, np.asarray( m.visual.vertex_colors )[ :, :3 ] / 255.0, mask, rgba[ ..., :3 ], hint )
			px, py, z = project( v, rot( yaw, pitch ), box, mask.shape[ 0 ] )
			vis, ix, iy = visible( px, py, z, mask.shape )
			l = np.zeros( n, int ); l[ vis ] = lab[ iy[ vis ], ix[ vis ] ]
			# the normal's facing as the weight (a grazing surface's pixel is a poor guess)
			nr = np.asarray( m.vertex_normals ) @ rot( yaw, pitch ).T
			w = np.abs( nr[ :, 2 ] ) * ( l > 0 )
			votes[ np.arange( n ), l ] += w
			print( f'{ name }: yaw { np.degrees( yaw ):.0f}°, pitch { np.degrees( pitch ):.0f}°, IoU { iou:.2f}, { ( l > 0 ).sum() } vertices labelled (from { src })', file = sys.stderr )
			if a.preview:
				os.makedirs( a.preview, exist_ok = True )
				img = np.zeros( ( *lab.shape, 3 ), np.uint8 )
				for k, c in COLOURS.items(): img[ lab == k ] = c
				Image.fromarray( np.concatenate( [ rgba[ ..., :3 ], img ], 1 ) ).resize( ( 1024, 512 ) ).save( os.path.join( a.preview, f'{ name }-labels.png' ) )
		# a velvet pillow: only where the views agree (a vote half the vertex's): one view's misfit painted a sofa's arm
		vv = votes[ :, PARTS[ 'velvet' ] ] < 0.5 * votes[ :, 1: ].sum( 1 )
		votes[ vv, PARTS[ 'velvet' ] ] = 0
		part = votes[ :, 1: ].argmax( 1 ) + 1
		part[ votes[ :, 1: ].max( 1 ) <= 0 ] = 0
		# the rest from their neighbours (a flood over the edges), then a few rounds of majority smoothing
		E = m.edges_unique
		Adj = sp.coo_matrix( ( np.ones( 2 * len( E ) ), ( np.r_[ E[ :, 0 ], E[ :, 1 ] ], np.r_[ E[ :, 1 ], E[ :, 0 ] ] ) ), shape = ( n, n ) ).tocsr()
		for _ in range( 200 ):
			un = part == 0
			if not un.any(): break
			oh = np.zeros( ( n, 7 ) ); oh[ np.arange( n ), part ] = 1; oh[ :, 0 ] = 0
			nb = Adj @ oh
			fill = un & ( nb.max( 1 ) > 0 )
			part[ fill ] = nb[ fill ].argmax( 1 )
		for _ in range( 8 ):
			oh = np.zeros( ( n, 7 ) ); oh[ np.arange( n ), part ] = 1
			nb = Adj @ oh + 1.5 * oh
			keep = part == PARTS[ 'inlay' ]		# (a thin line: not smoothed away)
			part = np.where( keep, part, nb.argmax( 1 ) )
		# the pedestal: under the seat, where the footprint narrows; its ring the bottom quarter of it
		lo, hi = v.min( 0 ), v.max( 0 ); H = hi[ 1 ] - lo[ 1 ]; y = ( v[ :, 1 ] - lo[ 1 ] ) / H
		bands = np.linspace( 0, 0.5, 51 ); ext = []
		for b0 in bands[ :- 1 ]:
			s = ( y >= b0 ) & ( y < b0 + 0.01 )
			ext.append( np.ptp( v[ s, 0 ] ) * np.ptp( v[ s, 2 ] ) if s.sum() > 20 else 0 )
		ext = np.array( ext ); full = ext.max()
		top = next( ( bands[ i ] for i in range( len( ext ) ) if ext[ i ] > 0.75 * full ), 0.0 )
		part[ y < top ] = PARTS[ 'pedestal' ]
		part[ y < 0.28 * top ] = PARTS[ 'ring' ]
		print( f'{ slug }: pedestal to { top:.3f} of the height; parts ' + ', '.join( f'{ k } { ( part == i ).mean() * 100:.1f}%' for k, i in PARTS.items() ), file = sys.stderr )
		col = np.asarray( m.visual.vertex_colors ).copy(); col[ :, 3 ] = part
		trimesh.Trimesh( v, m.faces, vertex_colors = col, process = False ).export( os.path.join( a.generated, f'{ slug }-parts.glb' ) )
		if a.preview:
			c = np.array( [ COLOURS[ k ] for k in part ] ) / 255.0; nrm = np.asarray( m.vertex_normals ); S = 360; ims = []
			for R in [ rot( np.radians( 30 ), np.radians( 15 ) ), np.eye( 3 ), rot( np.radians( 90 ), 0 ), rot( np.radians( 180 ), 0 ), rot( 0, np.radians( 89 ) ) ]:
				p = ( v - ( lo + hi ) / 2 ) @ R.T; q = nrm @ R.T; img = np.full( ( S, S, 3 ), 0.12 )
				u = ( ( p[ :, 0 ] / 1.15 + 0.5 ) * S ).astype( int ); w = ( ( - p[ :, 1 ] / 1.15 + 0.5 ) * S ).astype( int ); ok = ( u >= 0 ) & ( u < S ) & ( w >= 0 ) & ( w < S )
				o = np.argsort( p[ ok, 2 ] ); img[ w[ ok ][ o ], u[ ok ][ o ] ] = ( c[ ok ] * np.clip( 0.45 + 0.55 * np.abs( q[ ok, 2 ] ), 0, 1 )[ :, None ] )[ o ]
				ims.append( Image.fromarray( ( img * 255 ).astype( np.uint8 ) ) )
			row = Image.new( 'RGB', ( S * 5, S ) ); [ row.paste( im, ( k * S, 0 ) ) for k, im in enumerate( ims ) ]
			row.save( os.path.join( a.preview, f'{ slug }-parts.png' ) )


if __name__ == '__main__':
	main()

#!/usr/bin/env python3
"""tools/script-preview-geom.py <plan.json> <geom.json>: the outlines for tools/script-preview.mjs (python3 + OpenCV).

plan.json (from the page): the floor map's header and file (public/berlinhall/floor.bin: uint16 mm over `base`,
`none` where there is no floor), the corridors behind the stage doors (rows of 0/1 on the floor map's grid), the
near-floor occupancy (PNG, 2.5 cm: the hall's triangles 0.04-1.2 m above the floor under them), the piano's and
the bench's footprints (PNG, 1 cm), the doors, and `view` (x0, x1, z0, z1: what is kept).
geom.json: world (x, z) polygons:
  levels   the floor's plateaus (heights clustered), each its fill colour and polygons (holes included: even-odd)
  edges    the plateaus' outlines (the steps, the floor's edge: walls)
  occ      the near-floor objects' outlines (seat rows, risers, rails, walls' feet)
  corridor the corridors
  piano    { case, bench }: their outer outlines
  labels   the plateaus' names at a point well inside them (in view)
  doors    passed through
"""
import base64, json, sys
import numpy as np, cv2

plan = json.load( open( sys.argv[ 1 ] ) )
fl = plan[ 'floor' ]
vx0, vx1, vz0, vz1 = plan.get( 'view', [ -1e9, 1e9, -1e9, 1e9 ] )

def png( b64 ):
	a = np.frombuffer( base64.b64decode( b64 ), np.uint8 )
	return cv2.imdecode( a, cv2.IMREAD_GRAYSCALE )

def in_view( pts, pad = 0.5 ):
	xs, zs = pts[ :, 0 ], pts[ :, 1 ]
	return xs.max() >= vx0 - pad and xs.min() <= vx1 + pad and zs.max() >= vz0 - pad and zs.min() <= vz1 + pad

def polys( mask, x0, z0, res, eps = 1.0, min_area = 4, mode = cv2.RETR_CCOMP, largest = False ):
	cs, _ = cv2.findContours( mask.astype( np.uint8 ), mode, cv2.CHAIN_APPROX_SIMPLE )
	out = []
	if largest and cs: cs = [ max( cs, key = cv2.contourArea ) ]
	for c in cs:
		if cv2.contourArea( c ) < min_area and len( c ) < 8: continue
		a = cv2.approxPolyDP( c, eps, True ).reshape( -1, 2 ).astype( float )
		if len( a ) < 3: continue
		w = np.stack( [ x0 + ( a[ :, 0 ] + 0.5 ) * res, z0 + ( a[ :, 1 ] + 0.5 ) * res ], 1 )
		if in_view( w ): out.append( np.round( w, 3 ).tolist() )
	return out

# ---- the floor's plateaus ----
raw = np.fromfile( plan[ 'floorBin' ], dtype = '<u2' ).reshape( fl[ 'nz' ], fl[ 'nx' ] )
has = raw != fl[ 'none' ]
h = np.where( has, raw / 1000.0 + fl[ 'base' ], np.nan )
corr = np.array( [ [ c == '1' for c in r ] for r in plan.get( 'corridor', [] ) ], bool ) if plan.get( 'corridor' ) else np.zeros_like( has )
q = np.round( h / 0.02 ) * 0.02
vals, counts = np.unique( q[ has ], return_counts = True )
levels = sorted( v for v, n in zip( vals, counts ) if n > 200 )
L = np.full( h.shape, -1, int )
if levels:
	lv = np.array( levels )
	idx = np.abs( q[ ..., None ] - lv[ None, None, : ] ).argmin( -1 )
	L = np.where( has, idx, -1 )
res = fl[ 'res' ]
def name( v ):
	if v < -0.3: return '观众席'
	if abs( v ) < 0.06: return '舞台'
	if v < 0.25: return '台阶'
	if v < 0.45: return '侧台'
	return '合唱台'
def fill( v ):		# lower: lighter; higher: a little darker
	k = np.clip( ( v + 0.7 ) / 1.9, 0, 1 )
	c = np.array( [ 0xf3, 0xee, 0xe3 ] ) * ( 1 - k ) + np.array( [ 0xd8, 0xcd, 0xb6 ] ) * k
	return '#%02x%02x%02x' % tuple( int( x ) for x in c )
out = { 'levels': [], 'edges': [], 'labels': [] }
k3 = np.ones( ( 3, 3 ), np.uint8 )
for i, v in enumerate( levels ):
	m = ( L == i )
	m = cv2.morphologyEx( m.astype( np.uint8 ), cv2.MORPH_OPEN, k3 ) > 0
	if m.sum() < 50: continue
	ps = polys( m, fl[ 'minX' ], fl[ 'minZ' ], res, eps = 0.8, min_area = 6 )
	if not ps: continue
	out[ 'levels' ].append( { 'h': round( float( v ), 3 ), 'fill': fill( v ), 'polys': ps } )
	out[ 'edges' ] += [ p + [ p[ 0 ] ] for p in ps ]
	# a label well inside the level's in-view part
	view = np.zeros_like( m )
	i0, i1 = int( ( vx0 - fl[ 'minX' ] ) / res ), int( ( vx1 - fl[ 'minX' ] ) / res )
	j0, j1 = int( ( vz0 - fl[ 'minZ' ] ) / res ), int( ( vz1 - fl[ 'minZ' ] ) / res )
	view[ max( 0, j0 ): max( 0, j1 ), max( 0, i0 ): max( 0, i1 ) ] = True
	mv = ( m & view ).astype( np.uint8 )
	if mv.sum() > 400:
		d = cv2.distanceTransform( mv, cv2.DIST_L2, 5 )
		j, ii = np.unravel_index( d.argmax(), d.shape )
		if d[ j, ii ] > 12: out[ 'labels' ].append( { 'text': name( v ), 'x': round( fl[ 'minX' ] + ( ii + 0.5 ) * res, 2 ), 'z': round( fl[ 'minZ' ] + ( j + 0.5 ) * res, 2 ) } )
out[ 'corridor' ] = polys( corr, fl[ 'minX' ], fl[ 'minZ' ], res, eps = 0.8, min_area = 4, mode = cv2.RETR_EXTERNAL ) if corr.any() else []

# ---- near-floor objects ----
o = plan[ 'occ' ]
occ = png( o[ 'png' ] ) > 127
occ = cv2.morphologyEx( occ.astype( np.uint8 ), cv2.MORPH_CLOSE, k3 ) > 0
# (only what is in view, with a border)
ox0, oz0, ores = o[ 'minX' ], o[ 'minZ' ], o[ 'res' ]
oi0, oi1 = max( 0, int( ( vx0 - 1 - ox0 ) / ores ) ), min( occ.shape[ 1 ], int( ( vx1 + 1 - ox0 ) / ores ) )
oj0, oj1 = max( 0, int( ( vz0 - 1 - oz0 ) / ores ) ), min( occ.shape[ 0 ], int( ( vz1 + 1 - oz0 ) / ores ) )
sub = np.zeros_like( occ ); sub[ oj0:oj1, oi0:oi1 ] = occ[ oj0:oj1, oi0:oi1 ]
out[ 'occ' ] = polys( sub, ox0, oz0, ores, eps = 1.0, min_area = 6 )

# ---- the seats: one rectangle per seat cushion (connected regions, 1 cm), a bar per back cushion ----
def rects( b64, min_area ):
	st = plan[ 'seats' ]; r = st[ 'res' ]; res_ = []
	m = ( png( b64 ) > 127 ).astype( np.uint8 )
	m = cv2.morphologyEx( m, cv2.MORPH_CLOSE, np.ones( ( 3, 3 ), np.uint8 ) )		# (a cushion's own seams; neighbours are cm apart)
	n, lab, stats, _ = cv2.connectedComponentsWithStats( m, 8 )
	for k in range( 1, n ):
		if stats[ k, cv2.CC_STAT_AREA ] * r * r < min_area: continue
		x, y, w, h = stats[ k, :4 ]
		ys, xs = np.nonzero( lab[ y: y + h, x: x + w ] == k )
		box = cv2.boxPoints( cv2.minAreaRect( np.stack( [ xs + x, ys + y ], 1 ).astype( np.float32 ) ) )
		wpt = np.stack( [ st[ 'minX' ] + ( box[ :, 0 ] + 0.5 ) * r, st[ 'minZ' ] + ( box[ :, 1 ] + 0.5 ) * r ], 1 )
		if in_view( wpt, 0.2 ): res_.append( np.round( wpt, 3 ).tolist() )
	return res_
out[ 'seats' ], out[ 'seatBacks' ] = [], []
if plan.get( 'seats' ):
	out[ 'seats' ] = rects( plan[ 'seats' ][ 'seat' ], 0.05 )
	if plan[ 'seats' ].get( 'back' ): out[ 'seatBacks' ] = rects( plan[ 'seats' ][ 'back' ], 0.004 )

# ---- the piano and the bench ----
p = plan[ 'piano' ]
k5 = np.ones( ( 5, 5 ), np.uint8 )
def outline( b64 ):
	m = png( b64 ) > 127
	m = cv2.morphologyEx( m.astype( np.uint8 ), cv2.MORPH_CLOSE, k5 ) > 0
	return polys( m, p[ 'minX' ], p[ 'minZ' ], p[ 'res' ], eps = 1.2, min_area = 20, mode = cv2.RETR_EXTERNAL, largest = True )
out[ 'piano' ] = { 'case': outline( p[ 'case' ] ), 'bench': outline( p[ 'bench' ] ) }
out[ 'doors' ] = plan.get( 'doors', [] )
json.dump( out, open( sys.argv[ 2 ], 'w' ) )
print( f"geom: {len( out['levels'] )} levels, {sum( len( l['polys'] ) for l in out['levels'] )} level polygons, {len( out['occ'] )} object outlines, {len( out['seats'] )} seats ({len( out['seatBacks'] )} backs), piano {sum( len( x ) for x in out['piano']['case'] )} pts, bench {sum( len( x ) for x in out['piano']['bench'] )} pts" )

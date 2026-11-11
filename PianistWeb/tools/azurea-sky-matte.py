# A sky matte for each of Azurea's sea photos: per pixel how much of it is land (the mountains, the headlands, the
# village's lights: 1) and how much the photo's sky (0), so the runtime can put its own sky behind the land:
#   colour = photo + ( 1 - a ) * ( sky - photoSky )      (land kept, its haze's share of the old sky swapped)
# above the matte's band: the runtime's sky alone. photoSky: a smooth fit of the photo's own clear sky (cubic in
# u, v per channel, robustly reweighted: clouds, stars, the land are outliers), its coefficients written out.
#   1. the fit and its residual R (on a blurred copy: JPEG noise and stars down);
#   2. the band: a dynamic programme per photo over columns (the boundary between sky above and land below,
#      smooth), the union over the three photos (one coastline, image to image), raised by a margin;
#   3. a = smoothstep( 2.5 s, 6 s, R ) inside the band (s the fit's robust sigma), 0 above it, 1 below the horizon.
#   python3 matte.py <generated dir> <out dir> <overlay dir>
import sys, json, numpy as np, cv2

G, OUT, OV = sys.argv[ 1 ], sys.argv[ 2 ], sys.argv[ 3 ]
HOR = 0.60		# (the photos' horizon row: src/azurea.js SKY.horV)
W, H = 1536, 512
K = [ 'sea', 'sea-sunset', 'sea-night' ]

def basis( u, v ):
	return np.stack( [ np.ones_like( u ), u, v, u * u, v * v, u * v, u ** 3, v ** 3, u * u * v, u * v * v ], -1 )

def fit( a, hr ):
	ys, xs = np.mgrid[ 0:hr, 0:W ]
	u, v = ( xs + 0.5 ) / W, ( ys + 0.5 ) / H
	X = basis( u, v ).reshape( -1, 10 ); Y = a[ :hr ].reshape( -1, 3 )
	w = np.ones( len( Y ) )
	w[ ( ( np.abs( u - 0.5 ) > 0.3 ) & ( ys > hr * 0.6 ) ).reshape( -1 ) ] = 0
	for it in range( 10 ):
		sw = np.sqrt( w )[ :, None ]
		B = np.linalg.lstsq( X * sw, Y * sw, rcond = None )[ 0 ]
		r = np.linalg.norm( Y - X @ B, axis = 1 )
		s = np.median( r[ w > 0.5 ] ) * 1.4826 + 1e-3
		w = 1 / ( 1 + ( r / ( 3 * s ) ) ** 4 )
	return B, r.reshape( hr, W ), s

def boundary( R, t, hr ):
	sky_pen = np.clip( ( R - t ) / t, 0, 3 ); land_pen = np.clip( ( t - R ) / t, 0, 1 )
	cs = np.vstack( [ np.zeros( ( 1, W ) ), np.cumsum( sky_pen, 0 ) ] )
	cl = np.vstack( [ np.cumsum( land_pen[ ::-1 ], 0 )[ ::-1 ], np.zeros( ( 1, W ) ) ] )
	C = cs + cl; lam = 0.25; nb = hr + 1
	D = C[ :, 0 ].copy(); P = np.zeros( ( nb, W ), np.int32 ); idx = np.arange( nb )
	for x in range( 1, W ):
		f = D.copy(); arg = idx.copy()
		for b in range( 1, nb ):
			if f[ b - 1 ] + lam < f[ b ]: f[ b ] = f[ b - 1 ] + lam; arg[ b ] = arg[ b - 1 ]
		for b in range( nb - 2, -1, -1 ):
			if f[ b + 1 ] + lam < f[ b ]: f[ b ] = f[ b + 1 ] + lam; arg[ b ] = arg[ b + 1 ]
		P[ :, x ] = arg; D = f + C[ :, x ]
	b = np.zeros( W, int ); b[ -1 ] = int( np.argmin( D ) )
	for x in range( W - 1, 0, -1 ): b[ x - 1 ] = P[ b[ x ], x ]
	return b

def refit( a, hr, band ):
	# (the sky's fit on what is surely sky: above the band, and the open sea's columns down to the horizon; the
	# land never in it, so the fit cannot bend into a dark hill)
	ys, xs = np.mgrid[ 0:hr, 0:W ]
	u, v = ( xs + 0.5 ) / W, ( ys + 0.5 ) / H
	sure = ( ys < band[ None, : ] - 2 ) | ( band[ None, : ] >= hr - 1 )
	X = basis( u, v ).reshape( -1, 10 ); Y = a[ :hr ].reshape( -1, 3 )
	w = sure.reshape( -1 ).astype( float )
	for it in range( 8 ):
		sw = np.sqrt( w )[ :, None ]
		B = np.linalg.lstsq( X * sw, Y * sw, rcond = None )[ 0 ]
		r = np.linalg.norm( Y - X @ B, axis = 1 )
		s = np.median( r[ w > 0.5 ] ) * 1.4826 + 1e-3
		w = sure.reshape( -1 ) / ( 1 + ( r / ( 3 * s ) ) ** 4 )
	return B, r.reshape( hr, W ), s

hr = int( round( HOR * H ) )
data = {}
for k in K:
	im = cv2.imread( f'{ G }/{ k }-raw.jpg' )
	a = cv2.resize( im, ( W, H ), interpolation = cv2.INTER_AREA ).astype( np.float64 )[ :, :, ::-1 ]		# (RGB)
	ab = cv2.GaussianBlur( a, ( 0, 0 ), 1.6 )
	B, R, s = fit( ab, hr )
	data[ k ] = dict( a = a, ab = ab, b = boundary( R, max( 6 * s, 10 ), hr ) )
# the band: the highest boundary of the day's and the golden hour's (clear skies, high contrast; the night's photo
# has the same coastline), per column, the max height over 25 columns, raised 10 rows (of 512)
bb = np.min( np.stack( [ data[ k ][ 'b' ] for k in K[ :2 ] ] ), 0 ).astype( np.float32 )
bb = cv2.erode( bb[ None, : ], np.ones( ( 1, 25 ), np.uint8 ) )[ 0 ]
# (open sea where the land would be under 14 rows (1.6 deg: the horizon's own haze, not a hill))
land = ( hr - bb ) >= 14
band = np.where( land, np.clip( bb - 10, 0, hr ), hr ).astype( np.float32 )
band = cv2.erode( band[ None, : ], np.ones( ( 1, 9 ), np.uint8 ) )[ 0 ].astype( float )		# (its ends: 4 columns wider)
for k in K:
	d = data[ k ]
	d[ 'B' ], d[ 'R' ], d[ 's' ] = refit( d[ 'ab' ], hr, band )
	print( k, 'fit sigma', round( d[ 's' ], 2 ), 'band columns', int( ( band < hr ).sum() ), 'of', W )
meta = { 'horizon': HOR, 'size': [ W, H ], 'photos': {} }
ys = np.arange( H )[ :, None ]
for k in K:
	d = data[ k ]; s = d[ 's' ]
	# the sky behind the land, locally: per row, the open sea's columns' own sky carried across the band (linear between
	# its two sides, the nearest where one), and the column's own sky just above the band, faded towards the horizon
	# (a global fit missed the horizon's local glow by more than the hills' contrast: flat slabs)
	ab = d[ 'ab' ]
	openc = band >= hr
	oi = np.where( openc )[ 0 ]
	xs = np.arange( W )
	ref = np.zeros( ( hr, W, 3 ) )
	for y in range( hr ):
		for c in range( 3 ): ref[ y, :, c ] = np.interp( xs, oi, ab[ y, oi, c ] )
	for x in np.where( ~ openc )[ 0 ]:
		t = max( int( band[ x ] ) - 3, 0 )
		off = ab[ t, x ] - ref[ t, x ]
		w = np.clip( ( hr - np.arange( hr ) ) / max( hr - t, 1 ), 0, 1 )[ :, None ]
		ref[ :, x ] = ref[ :, x ] + off[ None, : ] * w
	R = np.zeros( ( H, W ) ); R[ :hr ] = np.linalg.norm( ab[ :hr ] - ref, axis = 2 )
	# (one-sided: land is darker than the sky there (a hill, a headland) or much brighter (a village's lights);
	# a little brighter is the horizon's glow, sky: at night the hills' only contrast is their darkness)
	lum = lambda c: c @ np.array( [ 0.2126, 0.7152, 0.0722 ] )
	dl = np.zeros( ( H, W ) ); dl[ :hr ] = lum( ab[ :hr ] ) - lum( ref )		# (> 0: brighter than the sky)
	gate = np.clip( 1 - ( dl - 1.0 * s ) / ( 3.0 * s ), 0, 1 )		# (1 where not brighter; 0 where brighter by 4 s)
	lights = np.clip( ( dl - 10 * s ) / ( 6 * s ), 0, 1 )
	R = R * np.maximum( gate, lights )
	al = np.clip( ( R - 3.0 * s ) / ( 3.0 * s ), 0, 1 ); al = al * al * ( 3 - 2 * al )		# (clear land only: a haze strip that differs a little from the sky stays sky)
	# (soft at the band's top: 4 rows; and at its ends, over 40 columns: a far ridge fades into the sky, not cut)
	top = np.clip( ( ys - band[ None, : ] ) / 4.0, 0, 1 )
	inb = band < hr
	# (the distance in columns to the band's end; the photo's own edges are not ends: the land runs on, mirrored)
	left = np.zeros( W ); run = 1e9
	for x in range( W ): run = ( run + 1 if inb[ x ] else 0 ); left[ x ] = run
	right = np.zeros( W ); run = 1e9
	for x in range( W - 1, -1, -1 ): run = ( run + 1 if inb[ x ] else 0 ); right[ x ] = run
	taper = np.clip( np.minimum( left, right ) / 90.0, 0, 1 ); taper = taper * taper * ( 3 - 2 * taper )
	al = al * top * taper[ None, : ]
	# (a village's lights on a coast too low for the band (under 14 rows): kept, near the horizon, wherever they are)
	near = ( ( ys >= hr - 14 ) & ( ys < hr ) ).astype( float )
	dlr = np.zeros( ( H, W ) ); dlr[ :hr ] = lum( d[ 'a' ][ :hr ] ) - lum( ref )		# (unblurred: a light is a few pixels)
	lit = np.clip( ( dlr - 8 * s ) / ( 8 * s ), 0, 1 ) * near
	al = np.maximum( al, lit )
	# (below the horizon: land only under the land's columns (a headland's foot); the open sea's columns 0, so the sea's
	# reflection of the sky just above the horizon reads the sky, not the photo's horizon row)
	foot = ( band < hr ).astype( float )[ None, : ] * taper[ None, : ]
	al[ hr: ] = foot
	# (a pixel's own matte, a little smoothed: no JPEG speckle)
	al = cv2.GaussianBlur( al, ( 0, 0 ), 0.8 )
	al[ hr: ] = foot
	cv2.imwrite( f'{ OUT }/{ k }-matte.png', ( al * 255 + 0.5 ).astype( np.uint8 ) )
	# the photo's clear sky's mean over the band 5..30 deg up (the runtime's brightness target): linear, its saturation
	# raised ×1.45 as the shader's, the land and the band's columns left out (rows by src/azurea.js's mapping:
	# v = horV ( 1 - ( el / top )^0.7 ), top the arc's 38.36 deg)
	top = 38.36
	rows = [ int( HOR * ( 1 - ( el / top ) ** 0.7 ) * H ) for el in np.linspace( 5, 30, 26 ) ]
	px = np.concatenate( [ d[ 'a' ][ r, openc ] for r in rows ] ) / 255
	lin = np.where( px <= 0.04045, px / 12.92, ( ( px + 0.055 ) / 1.055 ) ** 2.4 )
	l = lin @ np.array( [ 0.2126, 0.7152, 0.0722 ] )
	sat = np.clip( l[ :, None ] + ( lin - l[ :, None ] ) * 1.45, 0, None )
	# its colour by elevation (0, 2.5 .. 37.5 deg: 16), each a chroma (rgb / luminance), over the open columns, ±2 rows:
	# the hue the runtime mixes the atmosphere towards (the photo's warm horizon, its blue above), its brightness the air's
	prof = []
	for el in np.arange( 16 ) * 2.5:
		r = min( int( HOR * ( 1 - ( max( el, 0.4 ) / top ) ** 0.7 ) * H ), hr - 1 )
		q = np.concatenate( [ d[ 'a' ][ rr, openc ] for rr in range( max( r - 2, 0 ), min( r + 3, hr ) ) ] ) / 255
		q = np.where( q <= 0.04045, q / 12.92, ( ( q + 0.055 ) / 1.055 ) ** 2.4 )
		ql = q @ np.array( [ 0.2126, 0.7152, 0.0722 ] )
		q = np.clip( ql[ :, None ] + ( q - ql[ :, None ] ) * 1.45, 0, None ).mean( 0 )
		prof.append( [ round( float( v ), 4 ) for v in q / max( q @ np.array( [ 0.2126, 0.7152, 0.0722 ] ), 1e-6 ) ] )
	meta[ 'photos' ][ k ] = { 'band': [ round( float( v ), 5 ) for v in sat.mean( 0 ) ], 'profile': prof, 'sigma': round( float( s ), 3 ), 'bandTop': round( float( band.min() / H ), 4 ) }
	# overlays: the matte as red over the photo, its band's top in yellow
	ov = d[ 'a' ][ :, :, ::-1 ].copy()
	ov[ :, :, 2 ] = ov[ :, :, 2 ] * ( 1 - 0.5 * al ) + 255 * 0.5 * al
	for x in range( W ): ov[ int( band[ x ] ), x ] = ( 0, 255, 255 )
	ov = ov.astype( np.uint8 )
	cv2.imwrite( f'{ OV }/matte-{ k }.jpg', np.hstack( [ ov[ 230:320, 0:560 ], ov[ 230:320, W - 560: ] ] ) )
	# the composite check: the photo's sky swapped for flat magenta
	# (straight alpha, as the runtime)
	mag = np.array( [ 200.0, 60.0, 200.0 ] )
	comp = d[ 'a' ] * al[ :, :, None ] + ( 1 - al[ :, :, None ] ) * mag
	comp = np.where( ( ys < band[ None, : ] )[ :, :, None ], mag, comp )
	comp = np.clip( comp, 0, 255 )[ :, :, ::-1 ].astype( np.uint8 )
	cv2.imwrite( f'{ OV }/comp-{ k }.jpg', np.hstack( [ comp[ 200:320, 0:560 ], comp[ 200:320, W - 560: ] ] ) )
json.dump( meta, open( f'{ OUT }/sky-matte.json', 'w' ), indent = 1 )
cv2.imwrite( f'{ OV }/matte-all.jpg', np.vstack( [ cv2.imread( f'{ OV }/matte-{ k }.jpg' ) for k in K ] ) )
cv2.imwrite( f'{ OV }/comp-all.jpg', np.vstack( [ cv2.imread( f'{ OV }/comp-{ k }.jpg' ) for k in K ] ) )

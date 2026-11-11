# The moon's near side as Azurea's moon disc sees it: NASA SVS's LROC colour map (CGI Moon Kit, public domain:
# svs.gsfc.nasa.gov/4720, lroc_color_poles_4k.tif (or _2k), equirectangular, longitude -180..180 left to right, centred on 0),
# projected orthographically from the sub-Earth point (0, 0), north up, east (Mare Crisium) on the right as seen
# from the northern hemisphere. Grey (the albedo), normalised to mean 0.5 over the disc; outside the disc 0.5.
#   python3 moon.py <tif> <out.png> [size]
# (sampled at twice the size, then area-averaged down: the map's own detail, without aliasing)
import sys, numpy as np, cv2

src, out = sys.argv[ 1 ], sys.argv[ 2 ]
N0 = int( sys.argv[ 3 ] ) if len( sys.argv ) > 3 else 1024
N = 2 * N0
im = cv2.imread( src, cv2.IMREAD_UNCHANGED ).astype( np.float64 )
if im.ndim == 3: im = im[ :, :, :3 ].mean( 2 )
im /= im.max()
H, W = im.shape
y, x = np.mgrid[ 0:N, 0:N ]
qx = ( x + 0.5 ) / N * 2 - 1; qy = 1 - ( y + 0.5 ) / N * 2		# (right, up)
r2 = qx * qx + qy * qy; inside = r2 < 1
z = np.sqrt( np.clip( 1 - r2, 0, 1 ) )
lat = np.arcsin( np.clip( qy, -1, 1 ) ); lon = np.arctan2( qx, z )
mx = ( ( lon / np.pi + 1 ) / 2 * W ).astype( np.float32 ); my = ( ( 0.5 - lat / np.pi ) * H ).astype( np.float32 )
alb = cv2.remap( im.astype( np.float32 ), mx, my, cv2.INTER_AREA if False else cv2.INTER_LINEAR, borderMode = cv2.BORDER_WRAP )
m = alb[ inside ].mean()
g = np.where( inside, alb / m * 0.5, 0.5 )
g = cv2.resize( g.astype( np.float32 ), ( N0, N0 ), interpolation = cv2.INTER_AREA )
print( 'albedo mean', round( float( m ), 4 ), 'p5/p95 relative', np.percentile( alb[ inside ] / m, [ 5, 95 ] ).round( 3 ) )
cv2.imwrite( out, np.clip( g * 255 + 0.5, 0, 255 ).astype( np.uint8 ) )

#!/usr/bin/env python3
"""Luminara's skies' highlight maps: where a panorama (tools/luminara-skies.mjs's source, pano-<hour>-wide.png) shows a
light brighter than an 8-bit photo can hold, how much (src/luminara.js: the sky's colour x 2^( skyHdr x map ), so those
places pass the bloom's threshold; a preset's skyHdr in stops).

A highlight is a small bright thing against its surroundings: a lit window, a street light, a craft's lamp, a ring of
light, a glint on glass, a facade in full sun; not the sky's broad glow (that is the sky's own brightness). Per pixel,
in linear luminance Y: its contrast to the local mean (a Gaussian of `--radius` px), how bright it is, and how near the
8-bit top (clipped: brighter still in the scene). How bright is the image's own (its percentiles of Y, `lo` and
`hi`): a night's lit window is Y ~0.2-0.6, a day's glint ~0.97. Per hour (HOURS): the local mean's radius, the
percentiles, the contrast's range and the clipped term's weight; by day wider and looser (a facade in full sun, its
glass), at night only the brightest small lights. The map

    m = smoothstep( lo, hi, Y ) x smoothstep( c0, c1, Y / local ) + clip x smoothstep( 0.86, 0.98, Y ) x smoothstep( k0, k1, Y / local )

clamped to 0..1, smoothed a little (no aliasing at the light's edge), and written as public/luminara/skies/<hour>-hdr.webp
(grey, the photo's size). Prints each map's share above 0.5 and its mean.

  python3 tools/luminara-sky-hdr.py --generated <dir> [--radius 30] [--quality 90]
"""
import sys, os, numpy as np, cv2

arg = lambda k, d, f = str: f( sys.argv[ sys.argv.index( k ) + 1 ] ) if k in sys.argv else d
G = arg( '--generated', None )
if not G: sys.exit( 'usage: python3 tools/luminara-sky-hdr.py --generated <dir> [--radius 30] [--quality 90]' )
R, Q = arg( '--radius', 30, float ), arg( '--quality', 90, int )
OUT = os.path.join( os.path.dirname( os.path.abspath( __file__ ) ), '..', 'public', 'luminara', 'skies' )
# per hour: the local mean's radius (px), Y's percentiles for lo / hi, the contrast's range, the clipped term's weight and
# its contrast's range
HOURS = {
	'day': { 'radius': 70, 'pct': ( 90, 98.5 ), 'contrast': ( 1.05, 1.8 ), 'clip': 1.0, 'clipContrast': ( 1.0, 1.25 ) },
	'sunset': { 'radius': 70, 'pct': ( 90, 98.5 ), 'contrast': ( 1.05, 1.8 ), 'clip': 1.0, 'clipContrast': ( 1.0, 1.25 ) },
	'dusk': { 'radius': 30, 'pct': ( 96, 99.5 ), 'contrast': ( 1.2, 2.5 ), 'clip': 0.5, 'clipContrast': ( 1.1, 1.6 ) },
	'night': { 'radius': 30, 'pct': ( 98.6, 99.85 ), 'contrast': ( 1.6, 3.2 ), 'clip': 0.3, 'clipContrast': ( 1.3, 2.0 ) },
}
def smooth( a, b, x ):
	t = np.clip( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t )
for hour in ( 'day', 'sunset', 'dusk', 'night' ):
	src = os.path.join( G, f'pano-{ hour }-wide.png' )
	if not os.path.exists( src ): print( f'{ hour }: no { os.path.basename( src ) }' ); continue
	c = cv2.imread( src ).astype( np.float32 ) / 255
	lin = np.where( c <= 0.04045, c / 12.92, ( ( c + 0.055 ) / 1.055 ) ** 2.4 )
	Y = 0.0722 * lin[ ..., 0 ] + 0.7152 * lin[ ..., 1 ] + 0.2126 * lin[ ..., 2 ]
	local = cv2.GaussianBlur( Y, ( 0, 0 ), R ) + 1e-3
	ratio = Y / local
	P = HOURS[ hour ]
	if P[ 'radius' ] != R: local = cv2.GaussianBlur( Y, ( 0, 0 ), P[ 'radius' ] ) + 1e-3; ratio = Y / local
	lo, hi = np.percentile( Y, P[ 'pct' ][ 0 ] ), np.percentile( Y, P[ 'pct' ][ 1 ] )
	m = smooth( lo, hi, Y ) * smooth( *P[ 'contrast' ], ratio ) + P[ 'clip' ] * smooth( 0.86, 0.98, Y ) * smooth( *P[ 'clipContrast' ], ratio )
	m = cv2.GaussianBlur( np.clip( m, 0, 1 ), ( 0, 0 ), 1.0 )
	g = np.clip( m * 255 + 0.5, 0, 255 ).astype( np.uint8 )
	f = os.path.join( OUT, f'{ hour }-hdr.webp' )
	cv2.imwrite( f, cv2.cvtColor( g, cv2.COLOR_GRAY2BGR ), [ cv2.IMWRITE_WEBP_QUALITY, Q ] )
	print( f'{ hour }: Y { lo:.2f}..{ hi:.2f}, share > 0.5 { ( m > 0.5 ).mean() * 100:.2f} %, mean { m.mean():.4f}, { os.path.getsize( f ) / 1024:.0f} KB' )

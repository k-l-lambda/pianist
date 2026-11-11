#!/usr/bin/env python3
"""Join a panorama's outpainted sides (tools/pano-outpaint.mjs, tools/pano-restyle.mjs) to the middle image.

  python3 tools/pano-join.py <middle.png> <stem> <out> [--feather 96] [--low 1500]

<stem>.left-raw.png / <stem>.right-raw.png: 3840x2160, the kept half where the canvas had it (left side: the middle's
left half on the right; right side: its right half on the left), the new half beside it, all one picture of the model's
(it redraws the kept half too, a little). Each side is aligned to the middle by phase correlation over the kept half (a
weak match, response < 0.3 or a shift > 12 px, is not applied: the redrawn half is another picture there, a side to
make again). Then two-band blending over the overlap (the kept half): the fine detail (above a Gaussian of sigma 120 px)
switches from the side's to the middle's over `feather` px from the seam (short: a longer one ghosted what the redraw
moved), the broad tones over `low` px (the sky's gradients differ: a narrow join showed them as a band). The side's new
half as the model drew it. Prints the alignment and the kept half's mean difference."""
import sys, os, numpy as np, cv2
arg = lambda k, d: int( sys.argv[ sys.argv.index( k ) + 1 ] ) if k in sys.argv else d
mid_f, stem, out = sys.argv[ 1 ], sys.argv[ 2 ], sys.argv[ 3 ]
feather, LOW, SIGMA = arg( '--feather', 96 ), arg( '--low', 1500 ), 120
M = cv2.imread( mid_f ).astype( np.float32 ); H, W = M.shape[ :2 ]; HALF = W // 2
lowpass = lambda a: cv2.GaussianBlur( a, ( 0, 0 ), SIGMA )
def load( side ):
	f = f'{ stem }.{ side }-raw.png'
	return cv2.resize( cv2.imread( f ), ( W, H ), interpolation = cv2.INTER_AREA ).astype( np.float32 ) if os.path.exists( f ) else None
def align( part, kept_part, kept_mid ):
	a = cv2.cvtColor( kept_mid, cv2.COLOR_BGR2GRAY ); b = cv2.cvtColor( kept_part, cv2.COLOR_BGR2GRAY )
	( dx, dy ), r = cv2.phaseCorrelate( a, b )
	if r < 0.3 or abs( dx ) > 12 or abs( dy ) > 12: return part, 0.0, 0.0, r, False
	return cv2.warpAffine( part, np.float32( [ [ 1, 0, - dx ], [ 0, 1, - dy ] ] ), ( W, H ), borderMode = cv2.BORDER_REFLECT ), dx, dy, r, True
smooth = lambda t: t * t * ( 3 - 2 * t )
news = {}
Mlow = lowpass( M ); Mhigh = M - Mlow
for side in ( 'left', 'right' ):
	P = load( side )
	if P is None: continue
	left = side == 'left'
	P, dx, dy, r, ok = align( P, P[ :, HALF: ] if left else P[ :, :HALF ], M[ :, :HALF ] if left else M[ :, HALF: ] )
	Pk = P[ :, HALF: ] if left else P[ :, :HALF ]		# (the kept half, in the middle's columns 0..HALF or HALF..W)
	print( f'{side}: shift {dx:+.1f} {dy:+.1f} px (response {r:.2f}{"" if ok else ", NOT aligned: make this side again"}), kept half differs by {np.abs( Pk - ( M[ :, :HALF ] if left else M[ :, HALF: ] ) ).mean():.1f}/255' )
	Plow = lowpass( P ); Pklow = Plow[ :, HALF: ] if left else Plow[ :, :HALF ]
	d = np.arange( HALF, dtype = np.float32 )		# (distance from the seam, in the middle's columns of this half)
	if not left: d = d[ ::-1 ]
	wl = smooth( np.clip( d / LOW, 0, 1 ) )[ None, :, None ]		# (the middle's share of the broad tones)
	wh = smooth( np.clip( d / feather, 0, 1 ) )[ None, :, None ]		# (and of the detail)
	sl = slice( 0, HALF ) if left else slice( HALF, W )
	lo = Mlow[ :, sl ] * wl + Pklow * ( 1 - wl )
	hi = Mhigh[ :, sl ] * wh + ( Pk - Pklow ) * ( 1 - wh )
	M[ :, sl ] = lo + hi
	Mlow[ :, sl ], Mhigh[ :, sl ] = lo, hi		# (the other side's blend reads the middle as it is now)
	news[ side ] = P[ :, :HALF ] if left else P[ :, HALF: ]
full = np.hstack( [ p for p in ( news.get( 'left' ), M, news.get( 'right' ) ) if p is not None ] )
cv2.imwrite( out, np.clip( full, 0, 255 ).astype( np.uint8 ) )
print( out, full.shape[ 1 ], 'x', full.shape[ 0 ] )

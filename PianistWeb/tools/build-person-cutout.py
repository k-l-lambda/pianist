# Handheld-mode person: a cut-out of the reference mirror selfie
# (Footages.local/186e889d-05a0-4b38-bae0-86a610d982ce.png, a dark figure on a plain white
# background). Writes public/person/:
#   cutout.png   RGBA, the figure's own colours with the white background keyed out, legs
#                extended down to the floor, mirrored left-right: the photo shows what a mirror
#                shows, the card must show the person as seen from the front, so its reflection
#                in the piano's screen reads like the photo again
#                The whole raised arm (upper arm, forearm, hand, phone) is cut out, the torso behind
#                it filled in: person.js models it in 3D, from the shoulder to the camera
#                Colours are corrected from the backlit photo (exposed for the white background,
#                the figure 5-15x too dark) to plausible albedo: skin ~0.25, black knit ~0.035
#   cutout.json  size in metres, where the phone (the camera), the eyes and the right shoulder
#                joint are on the card, and the albedo of the modelled arm's skin and sleeve (same correction)
# Run: python3 tools/build-person-cutout.py

import json, os
import cv2
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname( os.path.abspath( __file__ ) )
SRC = os.path.join( HERE, '../../Footages.local/186e889d-05a0-4b38-bae0-86a610d982ce.png' )
OUT = os.path.join( HERE, '../public/person' )

M_PER_PX = 0.00072			# head with hair ~265 px wide -> 0.19 m
EYES = ( 515, 245 )			# px in the photo, between the eyes
PHONE = ( 617, 405 )		# px, the phone's lens (the camera)
SHOULDER = ( 785, 560 )		# px, the raised arm's shoulder joint
# upper arm (sleeve) outline: shoulder top, round the elbow, back up the torso side
UPPER_ARM = [ ( 700, 470 ), ( 760, 500 ), ( 850, 575 ), ( 895, 700 ), ( 930, 830 ), ( 930, 892 ), ( 902, 948 ), ( 856, 984 ), ( 790, 994 ), ( 700, 994 ) ]
# the figure's right outline behind the raised arm (px, y increasing): neck under the jaw, collar,
# shoulder, then the torso side straight down (as it shows below the elbow)
COLLAR_Y = 450				# px, neck above, sweater below
TORSO_RIGHT = [ ( 560, 376 ), ( 585, 430 ), ( 600, 445 ), ( 700, 478 ), ( 745, 495 ), ( 772, 515 ), ( 786, 545 ), ( 792, 620 ), ( 790, 960 ), ( 800, 1010 ) ]
# forearm + hand + phone outline (px), replaced by the sweater / neck behind it
ARM = [ ( 540, 376 ), ( 692, 376 ), ( 694, 470 ), ( 735, 560 ), ( 790, 650 ), ( 850, 735 ), ( 872, 800 ),
	( 880, 868 ), ( 852, 905 ), ( 800, 880 ), ( 720, 790 ), ( 640, 715 ), ( 560, 650 ), ( 528, 560 ), ( 532, 470 ) ]
SKIN = ( 58, 47, 39 )		# px colour of the raised forearm (photo, sRGB)
SLEEVE = ( 17, 18, 22 )		# its pushed-up sleeve
SWEATER = ( 9, 10, 13 )		# the upper arm's sweater (as the torso)
EYE_HEIGHT = 1.64			# m above the floor
BG = 240.0					# background grey
OUT_W = 512

img = np.asarray( Image.open( SRC ).convert( 'RGB' ) ).astype( np.float32 )
h, w, _ = img.shape

# alpha from the distance to the background; colours un-mixed from the white at the edges
lum = img.mean( axis = 2 )
alpha = np.clip( ( BG - 8 - lum ) / 90, 0, 1 )
a = np.maximum( alpha, 1e-3 )[ ..., None ]
rgb = np.clip( ( img - ( 1 - alpha[ ..., None ] ) * BG ) / a, 0, 255 )

# the raised arm out: inside the figure's outline (TORSO_RIGHT) the neck and sweater behind it are
# filled in from around the hole (inpainting), outside it becomes background
hole = Image.new( 'L', ( w, h ), 0 )
ImageDraw.Draw( hole ).polygon( ARM, fill = 255 )
ImageDraw.Draw( hole ).polygon( UPPER_ARM, fill = 255 )
hole = cv2.dilate( np.asarray( hole ), np.ones( ( 9, 9 ), np.uint8 ) ) > 0		# swallow the sleeve's edge fringe
ys, xs = np.mgrid[ 0:h, 0:w ]
edge = np.interp( ys, [ p[ 1 ] for p in TORSO_RIGHT ], [ p[ 0 ] for p in TORSO_RIGHT ] )
# everything right of the outline down to the hip goes (the sleeve's top above the polygon too)
air = ( xs > edge ) & ( ( hole & ( ys < 1000 ) ) | ( ( ys > 376 ) & ( ys < 1000 ) ) )
hole |= air
fill = hole & ~ air
# fill only from the figure outside the hole: the whole hole (arm, phone, hand) and the
# background are masked together, and the background (un-mixed white, meaningless) is set to the
# sweater first, so neither the arm's skin nor the white leaks in as streaks
src = rgb.copy()
src[ ( alpha < 0.995 ) & ~ hole ] = np.median( rgb[ 1000:1100, 300:700 ].reshape( - 1, 3 ), axis = 0 )
near = cv2.dilate( hole.astype( np.uint8 ), np.ones( ( 41, 41 ), np.uint8 ) ) > 0
mask = ( hole | ( ( alpha < 0.995 ) & near ) ).astype( np.uint8 ) * 255
# the neck (above the collar) from the skin around it; the sweater from the sweater only, so the
# neck's skin doesn't flood down over the shoulder as a light patch
neck = fill & ( ys < COLLAR_Y ) & ( xs < 612 )
filled = cv2.inpaint( src.round().astype( np.uint8 ), mask, 9, cv2.INPAINT_TELEA ).astype( np.float32 )
rgb[ neck ] = filled[ neck ]
# sources: solid sweater only. The figure's anti-aliased outline (lum up to ~140 still counts as
# alpha 1) and the neck would otherwise spread as light patches
solid = cv2.erode( ( alpha >= 0.995 ).astype( np.uint8 ), np.ones( ( 13, 13 ), np.uint8 ) ) > 0
src[ ~ solid | ( ys < COLLAR_Y ) ] = src[ ( alpha < 0.995 ) & ~ hole ][ 0 ]		# the sweater median set above
filled = cv2.inpaint( src.round().astype( np.uint8 ), mask, 9, cv2.INPAINT_TELEA ).astype( np.float32 )
rgb[ fill & ~ neck ] = filled[ fill & ~ neck ]
alpha[ hole ] = 1
alpha[ air ] = 0

# legs: the photo ends at the thighs; continue the bottom row down to the floor, with a gap
# opening between the legs
floor_px = EYES[ 1 ] + int( EYE_HEIGHT / M_PER_PX )
ext = floor_px - h
rows_rgb = np.repeat( rgb[ - 1: ], ext, axis = 0 )
rows_a = np.repeat( alpha[ - 1: ], ext, axis = 0 )
cols = np.where( alpha[ - 1 ] > 0.5 )[ 0 ]
mid = ( cols[ 0 ] + cols[ - 1 ] ) / 2
xs = np.arange( w )
for i in range( ext ):

	t = i / ext
	gap = 6 + 70 * min( 1, t * 2.5 )					# px, half width of the gap between the legs
	narrow = 40 * t										# legs taper a little towards the ankles
	keep = ( np.abs( xs - mid ) > gap ) & ( xs > cols[ 0 ] + narrow ) & ( xs < cols[ - 1 ] - narrow )
	rows_a[ i ] *= keep

rgb = np.concatenate( [ rgb, rows_rgb ] )
alpha = np.concatenate( [ alpha, rows_a ] )

# photo -> albedo: linear gain plus a floor, so the face lands at ~0.25 and the sweater at ~0.035
# (the scene's light then makes them as dark as they should be)
to_lin = lambda c: np.where( c <= 0.04045, c / 12.92, ( ( c + 0.055 ) / 1.055 ) ** 2.4 )
to_srgb = lambda l: np.where( l <= 0.0031308, l * 12.92, 1.055 * l ** ( 1 / 2.4 ) - 0.055 )
albedo = lambda c: np.clip( to_srgb( np.minimum( 0.025 + 4.3 * to_lin( np.asarray( c, np.float32 ) / 255 ), 0.8 ) ) * 255, 0, 255 )
rgb = albedo( rgb )
hexc = lambda c: '#' + ''.join( f'{ int( round( v ) ):02x}' for v in albedo( c ) )

# mirror (see above) and scale down
rgba = np.dstack( [ rgb, alpha * 255 ] )[ :, :: - 1 ].astype( np.uint8 )
H = rgba.shape[ 0 ]
out_h = round( H * OUT_W / w )
os.makedirs( OUT, exist_ok = True )
Image.fromarray( rgba, 'RGBA' ).resize( ( OUT_W, out_h ), Image.LANCZOS ).save( os.path.join( OUT, 'cutout.png' ), optimize = True )

# positions in metres on the card, from its bottom-left corner (after mirroring)
m = lambda p: [ round( ( w - p[ 0 ] ) * M_PER_PX, 4 ), round( ( H - p[ 1 ] ) * M_PER_PX, 4 ) ]
info = { 'width': round( w * M_PER_PX, 4 ), 'height': round( H * M_PER_PX, 4 ), 'phone': m( PHONE ), 'eyes': m( EYES ), 'shoulder': m( SHOULDER ), 'skin': hexc( SKIN ), 'sleeve': hexc( SLEEVE ), 'sweater': hexc( SWEATER ) }
json.dump( info, open( os.path.join( OUT, 'cutout.json' ), 'w' ) )
print( info, ( OUT_W, out_h ) )

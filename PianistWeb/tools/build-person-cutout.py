# Handheld-mode person: a cut-out of the reference mirror selfie
# (Footages.local/186e889d-05a0-4b38-bae0-86a610d982ce.png, a dark figure on a plain white
# background). Writes public/person/:
#   cutout.png   RGBA, the figure's own colours with the white background keyed out, legs
#                extended down to the floor, mirrored left-right: the photo shows what a mirror
#                shows, the card must show the person as seen from the front, so its reflection
#                in the piano's screen reads like the photo again
#                The raised forearm, hand and phone are cut out (filled with the sweater behind
#                them): person.js models them in 3D, reaching forward from the elbow to the camera
#                Colours are corrected from the backlit photo (exposed for the white background,
#                the figure 5-15x too dark) to plausible albedo: skin ~0.25, black knit ~0.035
#   cutout.json  size in metres, where the phone (the camera), the eyes and the elbow are on the
#                card, and the albedo of the modelled arm's skin and sleeve (same correction)
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
ELBOW = ( 875, 895 )		# px, the raised arm's elbow
# forearm + hand + phone outline (px), replaced by the sweater / neck behind it
ARM = [ ( 540, 376 ), ( 692, 376 ), ( 694, 470 ), ( 735, 560 ), ( 790, 650 ), ( 850, 735 ), ( 872, 800 ),
	( 880, 868 ), ( 852, 905 ), ( 800, 880 ), ( 720, 790 ), ( 640, 715 ), ( 560, 650 ), ( 528, 560 ), ( 532, 470 ) ]
SKIN = ( 58, 47, 39 )		# px colour of the raised forearm (photo, sRGB)
SLEEVE = ( 17, 18, 22 )		# its pushed-up sleeve
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

# the raised arm out: the sweater and neck behind it filled in from around the hole (inpainting),
# the background right of the neck above the shoulder line
hole = Image.new( 'L', ( w, h ), 0 )
ImageDraw.Draw( hole ).polygon( ARM, fill = 255 )
hole = np.asarray( hole ) > 0
ys, xs = np.mgrid[ 0:h, 0:w ]
shoulder = 440 + np.maximum( xs - 600, 0 ) * 0.27			# collar -> shoulder line, sloping down
air = hole & ( xs >= 600 ) & ( ys < shoulder )
fill = ( hole & ~ air ).astype( np.uint8 ) * 255
# the background's colour is meaningless (un-mixed white): extend the figure's colours into it
# first, so the hole is filled from the figure only
src = rgb.round().astype( np.uint8 )
bgmask = ( ( ( alpha < 0.995 ) & ~ hole ) | air ).astype( np.uint8 ) * 255
near = cv2.dilate( fill, np.ones( ( 61, 61 ), np.uint8 ) ) > 0		# only around the hole (fast)
src_ext = cv2.inpaint( src, ( bgmask * near ).astype( np.uint8 ), 5, cv2.INPAINT_TELEA )
filled = cv2.inpaint( src_ext, cv2.dilate( fill, np.ones( ( 5, 5 ), np.uint8 ) ), 9, cv2.INPAINT_TELEA )
grow = cv2.dilate( fill, np.ones( ( 5, 5 ), np.uint8 ) ) > 0
rgb[ grow ] = filled[ grow ]
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
info = { 'width': round( w * M_PER_PX, 4 ), 'height': round( H * M_PER_PX, 4 ), 'phone': m( PHONE ), 'eyes': m( EYES ), 'elbow': m( ELBOW ), 'skin': hexc( SKIN ), 'sleeve': hexc( SLEEVE ) }
json.dump( info, open( os.path.join( OUT, 'cutout.json' ), 'w' ) )
print( info, ( OUT_W, out_h ) )

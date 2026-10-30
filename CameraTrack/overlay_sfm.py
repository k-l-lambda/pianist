"""Draw the keyboard model (aligned via SfM, camera.json) on video frames to check the alignment."""

import json
import sys

import cv2
import numpy as np

from solve import BX, WHITE

VIDEO = '../Footages.local/VID_20261029_231550.mp4'


def project( Pw, Rcw, c, K ):
	Xc = ( Rcw.T @ ( Pw - c ).T ).T
	x = Xc[ :, :2 ] / Xc[ :, 2:3 ]
	d = 1 + K[ 'k' ] * ( x ** 2 ).sum( 1, keepdims = True )
	return x * d * K[ 'f' ] + np.array( [ K[ 'cx' ], K[ 'cy' ] ] ), Xc[ :, 2 ]


def main( out, frames ):
	cam = json.load( open( 'camera.json' ) )
	K, L = cam[ 'intrinsics' ], cam[ 'black_len' ]
	byf = { x[ 'frame' ]: x for x in cam[ 'frames' ] }
	cap = cv2.VideoCapture( VIDEO )
	tiles = []
	hw = 0.0047
	for t in frames:
		cap.set( cv2.CAP_PROP_POS_FRAMES, t )
		ok, img = cap.read()
		x = byf[ t ]
		Rcw, c = np.array( x[ 'R' ] ), np.array( x[ 'pos' ] )
		for xk in BX * WHITE:
			quad = np.array( [ [ xk - hw, 0, 0 ], [ xk + hw, 0, 0 ], [ xk + hw, 0, - L ], [ xk - hw, 0, - L ] ] )
			p, z = project( quad, Rcw, c, K )
			if ( z > 0 ).all():
				cv2.polylines( img, [ p.astype( np.int32 ) ], True, ( 0, 255, 0 ), 1, cv2.LINE_AA )
		# white-key front edge (12 mm below the black tops, 52 mm in front of the black-key fronts)
		edge = np.array( [ [ v, - 0.012, 0.052 ] for v in np.linspace( - 0.62, 0.62, 60 ) ] )
		p, z = project( edge, Rcw, c, K )
		ok = z > 0
		cv2.polylines( img, [ p[ ok ].astype( np.int32 ) ], False, ( 255, 0, 255 ), 1, cv2.LINE_AA )
		cv2.putText( img, 'f%d' % t, ( 10, 30 ), cv2.FONT_HERSHEY_SIMPLEX, 0.9, ( 0, 0, 255 ), 2 )
		tiles.append( cv2.resize( img, ( 360, 640 ) ) )
	cv2.imwrite( out, np.vstack( [ np.hstack( tiles[ i:i + 4 ] ) for i in range( 0, len( tiles ), 4 ) ] ) )


if __name__ == '__main__':
	main( sys.argv[ 1 ], [ int( v ) for v in sys.argv[ 2: ] ] )

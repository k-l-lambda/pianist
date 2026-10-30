"""Overlay labels and reprojected key ends on selected frames (diagnostics)."""

import json
import pickle
import sys

import cv2
import numpy as np

from solve import BX, WHITE, BLACK_PITCHES, W, H

VIDEO = '../Footages.local/VID_20261029_231550.mp4'
NAMES = [ 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B' ]


def main( frames, out ):
	dets = pickle.load( open( 'detections.pkl', 'rb' ) )
	lab = pickle.load( open( 'labels.pkl', 'rb' ) )[ 'labels' ]
	tr = json.load( open( 'trajectory.json' ) )
	f, L = tr[ 'focal' ], tr[ 'black_len' ]
	byf = { x[ 'frame' ]: x for x in tr[ 'frames' ] }
	K = np.array( [ [ f, 0, W / 2 ], [ 0, f, H / 2 ], [ 0, 0, 1 ] ] )
	cap = cv2.VideoCapture( VIDEO )
	tiles = []
	for t in frames:
		cap.set( cv2.CAP_PROP_POS_FRAMES, t )
		ok, img = cap.read()
		if t in byf and lab[ t ]:
			x = byf[ t ]
			Rcw = np.array( x[ 'R' ] )
			R = Rcw.T
			tv = - R @ np.array( x[ 'pos' ] )
			rv, _ = cv2.Rodrigues( R )
			# reprojected keyboard: all black keys' front/back ends and the keyboard outline
			P = np.concatenate( [ np.stack( [ BX * WHITE, 0 * BX, 0 * BX ], 1 ), np.stack( [ BX * WHITE, 0 * BX, - L + 0 * BX ], 1 ) ] )
			p, _ = cv2.projectPoints( P, rv, tv, K, None )
			p = p.reshape( - 1, 2 )
			for k in range( len( BX ) ):
				a, b = p[ k ], p[ k + len( BX ) ]
				cv2.line( img, tuple( int( v ) for v in a ), tuple( int( v ) for v in b ), ( 0, 255, 0 ), 2 )
			for i, k in lab[ t ].items():
				c = dets[ t ][ 'blobs' ][ i ][ 'c' ]
				pitch = BLACK_PITCHES[ k ]
				cv2.putText( img, NAMES[ pitch % 12 ] + str( pitch // 12 - 1 ), ( int( c[ 0 ] ) - 10, int( c[ 1 ] ) - 12 ), cv2.FONT_HERSHEY_SIMPLEX, 0.35, ( 0, 0, 255 ), 1 )
			cv2.putText( img, 'f%d keys %d err %.1f' % ( t, x[ 'keys' ], x[ 'reproj' ] ), ( 10, 30 ), cv2.FONT_HERSHEY_SIMPLEX, 0.8, ( 0, 0, 255 ), 2 )
		tiles.append( cv2.resize( img, ( 360, 640 ) ) )
	cv2.imwrite( out, np.hstack( tiles ) )


if __name__ == '__main__':
	main( [ int( v ) for v in sys.argv[ 2: ] ], sys.argv[ 1 ] )

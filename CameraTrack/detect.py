"""Stage 1: detect black-key blobs in every frame (parallel) and cache them.

Output: detections.pkl = list over frames of dicts
  { 'blobs': [ { c, major, length, width, area, e1, e2 } ], 'axis': fit or None }
"""

import pickle
import sys
from multiprocessing import Pool

import cv2
import numpy as np

from keys import key_blobs, fit_keyboard

VIDEO = '../Footages.local/VID_20261029_231550.mp4'


def frame_count():
	cap = cv2.VideoCapture(VIDEO)
	return int(cap.get(cv2.CAP_PROP_FRAME_COUNT))


def work(span):
	a, b = span
	cap = cv2.VideoCapture(VIDEO)
	cap.set(cv2.CAP_PROP_POS_FRAMES, a)
	out = []
	for n in range(a, b):
		ok, f = cap.read()
		if not ok:
			out.append(dict(blobs=[], axis=None))
			continue
		bl = key_blobs(f)
		for x in bl:
			half = x['major'] * x['length'] / 2
			x['e1'] = x['c'] - half
			x['e2'] = x['c'] + half
			del x['pts']
		out.append(dict(blobs=bl, axis=fit_keyboard(bl)))
	return out


if __name__ == '__main__':
	N = frame_count()
	step = 12
	spans = [ ( a, min( N, a + step ) ) for a in range( 0, N, step ) ]
	with Pool( 26 ) as pool:
		parts = pool.map( work, spans )
	dets = [ d for p in parts for d in p ]
	pickle.dump( dets, open( 'detections.pkl', 'wb' ) )
	n = [ len( d['axis']['idx'] ) if d['axis'] else 0 for d in dets ]
	print( 'frames', len( dets ), 'with axis', sum( 1 for x in n if x ), 'mean keys on axis %.1f' % np.mean( n ) )

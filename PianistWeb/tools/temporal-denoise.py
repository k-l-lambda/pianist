#!/usr/bin/env python3
# A motion-compensated temporal denoiser for path-traced video: what the per-frame spatial denoiser
# (src/ptdenoise.js) leaves, residual noise and low-frequency blotches that change every frame (flicker),
# averaged over neighbouring frames, the neighbours first aligned to the frame.
#
# For frame t and each neighbour s within --radius frames: a dense optical flow t -> s (OpenCV's DIS, on
# blurred grey: the noise does not steer it), s warped onto t; per pixel its weight exp(-(d / sigma)^2), d the
# blurred difference to t (a mismatch: a disocclusion, a wrong flow, a fast particle, gets ~0: no ghosts; the
# flicker's small differences pass), times a gaussian of |s - t|; averaged in linear light with t itself.
# Offline and symmetric (frames after t as well as before): no lag, nothing smeared after a cut.
#
#   python3 tools/temporal-denoise.py in.mp4 out.mp4 [--radius 2] [--sigma 8] [--crf 18]
#   ... --raw WxH [in: raw rgb24 on stdin] [--raw-out: raw rgb24 on stdout]   (a pipe: tools/pt-client.mjs)
#
# in.mp4 -> out.mp4: H.264 (BT.709, tagged), the input's audio copied. Needs numpy and OpenCV (cv2 with DIS).

import argparse, subprocess, sys
from collections import deque
import numpy as np
import cv2

ap = argparse.ArgumentParser()
ap.add_argument( 'input', nargs = '?' ); ap.add_argument( 'output', nargs = '?' )
ap.add_argument( '--radius', type = int, default = 2 ); ap.add_argument( '--sigma', type = float, default = 8.0 )
ap.add_argument( '--time-sigma', type = float, default = 1.5 ); ap.add_argument( '--crf', type = int, default = 18 )
ap.add_argument( '--raw', help = 'WxH: raw rgb24 frames on stdin' ); ap.add_argument( '--raw-out', action = 'store_true', help = 'raw rgb24 frames on stdout' )
a = ap.parse_args()

def probe( f ):

	r = subprocess.run( [ 'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', f ], capture_output = True, text = True, check = True )
	w, h, fr = r.stdout.strip().split( ',' )
	return int( w ), int( h ), fr

if a.raw: W, H = map( int, a.raw.split( 'x' ) ); fps = None; src = sys.stdin.buffer
else:
	W, H, fps = probe( a.input )
	dec = subprocess.Popen( [ 'ffmpeg', '-v', 'error', '-i', a.input, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-' ], stdout = subprocess.PIPE ); src = dec.stdout
if a.raw_out: dst = sys.stdout.buffer; enc = None
else:
	if not a.output: sys.exit( 'an output file (or --raw-out)' )
	tmp = a.output + '.video.mp4' if not a.raw else a.output
	enc = subprocess.Popen( [ 'ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{ W }x{ H }', '-framerate', fps or '25', '-i', '-',
		'-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int', '-c:v', 'libx264', '-preset', 'slow', '-crf', str( a.crf ), '-pix_fmt', 'yuv420p',
		'-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', tmp ], stdin = subprocess.PIPE )
	dst = enc.stdin

N = W * H * 3
lin = ( ( np.arange( 256 ) / 255.0 + 0.055 ) / 1.055 ) ** 2.4; lin[ : 11 ] = np.arange( 11 ) / 255.0 / 12.92		# sRGB -> linear
lin = lin.astype( np.float32 )
def to_srgb( x ):

	x = np.clip( x, 0, 1 )
	return np.where( x <= 0.0031308, 12.92 * x, 1.055 * np.power( x, 1 / 2.4 ) - 0.055 ) * 255

dis = cv2.DISOpticalFlow_create( cv2.DISOPTICAL_FLOW_PRESET_MEDIUM )
gx, gy = np.meshgrid( np.arange( W, dtype = np.float32 ), np.arange( H, dtype = np.float32 ) )
grey = lambda f: cv2.GaussianBlur( cv2.cvtColor( f, cv2.COLOR_RGB2GRAY ), ( 5, 5 ), 1.2 )

def read():

	b = src.read( N )
	if not b or len( b ) < N: return None
	f = np.frombuffer( b, np.uint8 ).reshape( H, W, 3 )
	return { 'rgb': f, 'grey': grey( f ), 'lin': lin[ f ] }

def denoise( win, c ):

	t = win[ c ]
	acc = t[ 'lin' ].copy(); wsum = np.ones( ( H, W, 1 ), np.float32 )
	tf = t[ 'rgb' ].astype( np.float32 )
	for k, s in enumerate( win ):

		if k == c or s is None: continue
		flow = dis.calc( t[ 'grey' ], s[ 'grey' ], None )		# t(x) ~ s(x + flow(x))
		mx, my = gx + flow[ ..., 0 ], gy + flow[ ..., 1 ]
		ws = cv2.remap( s[ 'lin' ], mx, my, cv2.INTER_LINEAR, borderMode = cv2.BORDER_REPLICATE )
		wsr = cv2.remap( s[ 'rgb' ], mx, my, cv2.INTER_LINEAR, borderMode = cv2.BORDER_REPLICATE ).astype( np.float32 )
		d = cv2.GaussianBlur( np.abs( wsr - tf ).mean( axis = 2 ), ( 5, 5 ), 1.0 )
		inside = ( mx >= 0 ) & ( mx <= W - 1 ) & ( my >= 0 ) & ( my <= H - 1 )
		w = ( np.exp( - ( d / a.sigma ) ** 2 ) * np.exp( - 0.5 * ( ( k - c ) / a.time_sigma ) ** 2 ) * inside )[ ..., None ].astype( np.float32 )
		acc += w * ws; wsum += w

	return to_srgb( acc / wsum ).round().astype( np.uint8 )

R = a.radius
win = deque( [ None ] * R, maxlen = 2 * R + 1 )		# frames t-R .. t+R (None before the start)
for _ in range( R + 1 ): win.append( read() )
n = 0
while win[ R ] is not None:

	dst.write( denoise( list( win ), R ).tobytes() ); n += 1
	if n % 25 == 0: print( f'\r{ n } frames', end = '', file = sys.stderr, flush = True )
	win.append( read() )		# (None after the end)

print( f'\r{ n } frames', file = sys.stderr )
dst.close()
if enc:

	enc.wait()
	if not a.raw:
		# the input's audio, as it is
		subprocess.run( [ 'ffmpeg', '-y', '-v', 'error', '-i', tmp, '-i', a.input, '-map', '0:v', '-map', '1:a?', '-c', 'copy', '-shortest', a.output ], check = True )
		import os; os.remove( tmp )

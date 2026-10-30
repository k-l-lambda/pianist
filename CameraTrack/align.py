"""Stage 5: put the SfM reconstruction into the keyboard's world frame (metric).

world = s R x_sfm + t. With the SfM cameras fixed, the unknowns are the similarity (7) and
the black keys' visible top length L. They are fitted to the detected black-key ends of every
registered frame with a robust loss; detections are (re)labelled by projecting the current
model and taking the nearest predicted key, which removes the octave errors of the purely
image-based labelling. The start comes from frames whose keyboard-only PnP was clean.

Writes camera.json: intrinsics + per-frame pose in world (camera centre, camera->world R).
Run with PYTHONPATH=.pylib (pycolmap).
World: x along the keyboard (E4|F4 = 0, treble +x), y up, z towards the player, metres;
y = 0 is the black-key top plane, z = 0 the black keys' front ends.
"""

import json
import pickle

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

import pycolmap

from solve import BX, WHITE

W, H = 720, 1280


def load_sfm():
	rec = pycolmap.Reconstruction( 'sfm/sparse/0' )
	cams = list( rec.cameras.values() )
	assert len( cams ) == 1, 'expected one shared camera'
	cam = cams[ 0 ]
	f, cx, cy, k = cam.params
	poses = {}
	for img in rec.images.values():
		cfw = img.cam_from_world
		cfw = cfw() if callable( cfw ) else cfw
		M = np.array( cfw.matrix() )
		poses[ int( img.name.split( '.' )[ 0 ] ) ] = ( M[ :, :3 ], M[ :, 3 ] )
	pts = np.array( [ p.xyz for p in rec.points3D.values() ] )
	return dict( f = f, cx = cx, cy = cy, k = k, poses = poses, points = pts )


def project( Xc, cam ):
	x = Xc[ :, :2 ] / Xc[ :, 2:3 ]
	d = 1 + cam[ 'k' ] * ( x ** 2 ).sum( 1, keepdims = True )
	return x * d * cam[ 'f' ] + np.array( [ cam[ 'cx' ], cam[ 'cy' ] ] )


def model_points( L ):
	xs = BX * WHITE
	front = np.stack( [ xs, 0 * xs, 0 * xs ], 1 )
	back = np.stack( [ xs, 0 * xs, - L + 0 * xs ], 1 )
	return front, back


def world_to_cam( Xw, Rc, tc, R, t, s ):
	# x_sfm = R^T (x_w - t) / s ; x_cam = Rc x_sfm + tc ; scaled by s (projection invariant)
	return ( Rc @ R.T @ ( Xw - t ).T ).T + s * tc


def main():
	sfm = load_sfm()
	dets = pickle.load( open( 'detections.pkl', 'rb' ) )
	lab0 = pickle.load( open( 'labels.pkl', 'rb' ) )
	tr = json.load( open( 'trajectory.json' ) )
	frames = sorted( sfm[ 'poses' ] )
	print( 'SfM: f %.1f  cx %.1f cy %.1f  k %.4f  registered %d / %d  points %d' % ( sfm[ 'f' ], sfm[ 'cx' ], sfm[ 'cy' ], sfm[ 'k' ], len( frames ), len( dets ), len( sfm[ 'points' ] ) ) )

	# ---- initial similarity from clean keyboard-only PnP frames ---------------------------
	good = [ x for x in tr[ 'frames' ] if x[ 'reproj' ] < 4 and x[ 'keys' ] >= 12 and x[ 'frame' ] in sfm[ 'poses' ] ]
	Rs, A, B = [], [], []
	for x in good:
		Rc, tc = sfm[ 'poses' ][ x[ 'frame' ] ]
		Rkb = np.array( x[ 'R' ] )				# cam -> world (keyboard)
		Rs.append( Rkb @ Rc )						# sfm -> world
		A.append( - Rc.T @ tc )						# centre in sfm
		B.append( np.array( x[ 'pos' ] ) )			# centre in world
	Rs = Rotation.from_matrix( np.array( Rs ) )
	R0 = Rs.mean().as_matrix()
	A, B = np.array( A ), np.array( B )
	# s, t from centres: B = s R0 A + t (robust: iterate with trimming)
	keep = np.ones( len( A ), bool )
	for _ in range( 5 ):
		RA = ( R0 @ A[ keep ].T ).T
		M = np.concatenate( [ RA.reshape( - 1, 1 ), np.tile( np.eye( 3 ), ( keep.sum(), 1 ) ) ], 1 )
		sol, *_ = np.linalg.lstsq( M, B[ keep ].ravel(), rcond = None )
		s0, t0 = sol[ 0 ], sol[ 1: ]
		err = np.linalg.norm( s0 * ( R0 @ A.T ).T + t0 - B, axis = 1 )
		keep = err < max( 0.05, np.percentile( err, 70 ) )
	print( 'init from %d clean frames: scale %.4f, centre misfit median %.3f m' % ( len( good ), s0, np.median( err ) ) )

	cam = sfm

	def detections( t ):
		bl = dets[ t ][ 'blobs' ]
		return np.array( [ b[ 'c' ] for b in bl ] ), bl

	def associate( R, t, s, L, gate = 0.35 ):
		"""Label every blob by the nearest projected key centre; return observations."""
		front, back = model_points( L )
		mid = ( front + back ) / 2
		obs = []
		for fr in frames:
			if not dets[ fr ][ 'blobs' ]:
				continue
			Rc, tc = sfm[ 'poses' ][ fr ]
			Xc = world_to_cam( mid, Rc, tc, R, t, s )
			if ( Xc[ :, 2 ] <= 0 ).any():
				continue
			pm = project( Xc, cam )
			pf = project( world_to_cam( front, Rc, tc, R, t, s ), cam )
			pb = project( world_to_cam( back, Rc, tc, R, t, s ), cam )
			C, bl = detections( fr )
			D = np.linalg.norm( C[ :, None ] - pm[ None ], axis = 2 )
			for i in range( len( bl ) ):
				k = int( D[ i ].argmin() )
				spacing = np.linalg.norm( pm[ min( k + 1, len( pm ) - 1 ) ] - pm[ max( k - 1, 0 ) ] ) / 2
				if D[ i, k ] > gate * spacing or D[ :, k ].argmin() != i:
					continue
				# which blob end is the front: the one closer to the projected front end
				e1, e2 = bl[ i ][ 'e1' ], bl[ i ][ 'e2' ]
				fe, be = ( e1, e2 ) if np.linalg.norm( e1 - pf[ k ] ) < np.linalg.norm( e2 - pf[ k ] ) else ( e2, e1 )
				obs.append( ( fr, k, 0, *fe ) )
				obs.append( ( fr, k, 1, *be ) )
		return np.array( obs )

	def residuals( x, obs ):
		R = Rotation.from_rotvec( x[ :3 ] ).as_matrix()
		t, s, L = x[ 3:6 ], np.exp( x[ 6 ] ), x[ 7 ]
		front, back = model_points( L )
		r = np.empty( ( len( obs ), 2 ) )
		for fr in np.unique( obs[ :, 0 ] ).astype( int ):
			m = obs[ :, 0 ] == fr
			o = obs[ m ]
			Rc, tc = sfm[ 'poses' ][ fr ]
			P = np.where( o[ :, 2:3 ] > 0, back[ o[ :, 1 ].astype( int ) ], front[ o[ :, 1 ].astype( int ) ] )
			# every frame weighs the same: frontal views with many keys must not outvote the
			# oblique close-ups, which are the ones that constrain depth and height
			r[ m ] = ( project( world_to_cam( P, Rc, tc, R, t, s ), cam ) - o[ :, 3:5 ] ) * np.sqrt( 8.0 / m.sum() )
		return r.ravel()

	x = np.concatenate( [ Rotation.from_matrix( R0 ).as_rotvec(), t0, [ np.log( s0 ), 0.09 ] ] )
	for it, gate in enumerate( [ 0.9, 0.7, 0.55, 0.45, 0.4, 0.35, 0.35 ] ):
		R = Rotation.from_rotvec( x[ :3 ] ).as_matrix()
		obs = associate( R, x[ 3:6 ], np.exp( x[ 6 ] ), x[ 7 ], gate )
		# black-key visible top length: held at a physical value (ALIGN_L env, metres; 'free' to
		# fit it). Left free, the fit shortens it to ~56 mm to absorb a world-frame offset and the
		# reprojection error doubles (9.9 vs 5.1 px median).
		import os
		Lenv = os.environ.get( 'ALIGN_L', '0.095' )
		Lfix = None if Lenv == 'free' else float( Lenv )
		if Lfix is not None:
			x[ 7 ] = Lfix
			sol = least_squares( lambda y: residuals( np.concatenate( [ y, [ Lfix ] ] ), obs ), x[ :7 ], loss = 'huber', f_scale = 2.0, x_scale = [ 0.01 ] * 7 )
			x = np.concatenate( [ sol.x, [ Lfix ] ] )
		else:
			sol = least_squares( residuals, x, args = ( obs, ), loss = 'huber', f_scale = 2.0, x_scale = [ 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.002 ] )
			x = sol.x
		e = np.linalg.norm( residuals( x, obs ).reshape( - 1, 2 ), axis = 1 ) / np.sqrt( 8.0 / np.array( [ ( obs[ :, 0 ] == f ).sum() for f in obs[ :, 0 ] ] ) )
		print( 'iter %d: %d obs in %d frames  reproj median %.2f px p90 %.2f  scale %.4f  L %.4f m' % ( it, len( obs ), len( np.unique( obs[ :, 0 ] ) ), np.median( e ), np.percentile( e, 90 ), np.exp( x[ 6 ] ), x[ 7 ] ) )

	R = Rotation.from_rotvec( x[ :3 ] ).as_matrix()
	t, s = x[ 3:6 ], np.exp( x[ 6 ] )
	out = []
	for fr in frames:
		Rc, tc = sfm[ 'poses' ][ fr ]
		centre_sfm = - Rc.T @ tc
		pos = s * R @ centre_sfm + t
		Rcw = R @ Rc.T								# camera -> world
		n = int( ( obs[ :, 0 ] == fr ).sum() // 2 )
		out.append( dict( frame = fr, time = fr / 30.0, pos = pos.tolist(), R = Rcw.tolist(), keys = n ) )
	json.dump( dict(
		intrinsics = dict( model = 'SIMPLE_RADIAL', f = cam[ 'f' ], cx = cam[ 'cx' ], cy = cam[ 'cy' ], k = cam[ 'k' ], width = W, height = H ),
		black_len = x[ 7 ], frames = out,
		note = 'world: x along keyboard (E4|F4=0, treble +x), y up, z to player; metres; R = camera->world (OpenCV camera: x right, y down, z forward)',
	), open( 'camera.json', 'w' ), indent = 1 )
	# keyboard-frame room points for the report
	np.save( 'points_world.npy', s * ( R @ sfm[ 'points' ].T ).T + t )
	print( 'wrote camera.json:', len( out ), 'frames' )


if __name__ == '__main__':
	main()

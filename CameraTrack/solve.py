"""Stage 2: label the detected black keys and solve the camera for every frame.

World frame (metres): x along the keyboard (E4|F4 at 0, treble +x), y up, z towards the
player; the black-key top plane is y = 0 and the black keys' front ends are at z = 0.
Each detected black key gives two points: its front end (x, 0, 0) and the end of its
visible top (x, 0, -L). L, the focal length and every per-frame pose are refined together.

Labelling: black-key centroids lie on one image line; their positions along it are a 1D
projective image of the known key positions, which fixes which key is which up to whole
octaves (the octave pattern is also mirror-symmetric, so pitch direction comes from the
image handedness: seen from above and in front, treble x and front z keep the image's
orientation). The octave is anchored in frame 0 (the treble end is in view) and then
carried from frame to frame by continuity.
"""

import json
import pickle

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix

W, H = 720, 1280
WHITE = 0.0235
GROUP = [ 0, 0.38, 1, 1.62, 2, 3, 3.37, 4, 4.50, 5, 5.63, 6 ]
BLACK_STEPS = { 1, 3, 6, 8, 10 }
BLACK_PITCHES = [ p for p in range( 21, 109 ) if p % 12 in BLACK_STEPS ]
BX = np.array( [ ( ( p // 12 ) * 7 + GROUP[ p % 12 ] - 37.5 ) for p in BLACK_PITCHES ] )		# white units
NB = len( BX )


def h1d_from3( X, s ):
	"""1D homography s = (a X + b) / (c X + 1) through 3 pairs."""
	A = np.stack( [ X, np.ones( 3 ), - X * s ], 1 )
	try:
		return np.linalg.solve( A, s )
	except np.linalg.LinAlgError:
		return None


def h1d_apply( h, X ):
	a, b, c = h
	return ( a * X + b ) / ( c * X + 1 )


def h1d_fit( X, s ):
	A = np.stack( [ X, np.ones_like( X ), - X * s ], 1 )
	h, *_ = np.linalg.lstsq( A, s, rcond = None )
	return h


def label_frame( blobs, idx, d ):
	"""Return {blob index: black-key index} hypotheses grouped by octave offset."""
	C = np.array( [ blobs[ i ][ 'c' ] for i in idx ] )
	s = ( C - C.mean( 0 ) ) @ d
	order = np.argsort( s )
	idx = [ idx[ i ] for i in order ]
	s = s[ order ]
	gaps = np.diff( s )
	med = np.median( gaps ) if len( gaps ) else 1
	hyps = {}
	for a in range( len( s ) - 2 ):
		for L in range( NB - 2 ):
			h = h1d_from3( BX[ L:L + 3 ], s[ a:a + 3 ] )
			if h is None:
				continue
			pred = h1d_apply( h, BX )
			if not np.all( np.isfinite( pred ) ) or np.any( np.diff( pred ) <= 0 ):
				continue
			# assign every detection to its nearest predicted key
			j = np.abs( s[ :, None ] - pred[ None, : ] ).argmin( 1 )
			err = np.abs( s - pred[ j ] )
			ok = err < 0.22 * med
			lab = {}
			for k in np.nonzero( ok )[ 0 ]:
				if j[ k ] in lab.values():
					continue
				lab[ idx[ k ] ] = int( j[ k ] )
			if len( lab ) < 5:
				continue
			# refit on all inliers and rescore
			ks = [ k for k in range( len( s ) ) if idx[ k ] in lab ]
			h2 = h1d_fit( BX[ [ lab[ idx[ k ] ] for k in ks ] ], s[ ks ] )
			res = np.abs( h1d_apply( h2, BX[ [ lab[ idx[ k ] ] for k in ks ] ] ) - s[ ks ] )
			score = len( lab ) - res.mean() / med
			key = min( lab.values() ) % 5		# octave-equivalence class (5 black keys / octave)
			sig = ( key, tuple( sorted( ( i, l - min( lab.values() ) ) for i, l in lab.items() ) ) )
			if sig not in hyps or hyps[ sig ][ 0 ] < score:
				hyps[ sig ] = ( score, lab )
	return sorted( hyps.values(), key = lambda t: - t[ 0 ] )


def endpoints( b, n ):
	"""Front / back end of a key blob, given the image direction n pointing to the key fronts."""
	return ( b[ 'e1' ], b[ 'e2' ] ) if b[ 'e1' ] @ n > b[ 'e2' ] @ n else ( b[ 'e2' ], b[ 'e1' ] )


def project( pts3, rvec, tvec, f ):
	K = np.array( [ [ f, 0, W / 2 ], [ 0, f, H / 2 ], [ 0, 0, 1 ] ] )
	p, _ = cv2.projectPoints( pts3, rvec, tvec, K, None )
	return p.reshape( - 1, 2 )


def main():
	dets = pickle.load( open( 'detections.pkl', 'rb' ) )
	N = len( dets )
	f0, L0 = 1000.0, 0.090

	labels = [ None ] * N
	normals = [ None ] * N
	prev_n = np.array( [ 0.0, 1.0 ] )		# frame 0: key fronts point down in the image
	prev_pred = None						# predicted image positions of all black keys
	for t, d in enumerate( dets ):
		ax = d[ 'axis' ]
		if not ax:
			continue
		blobs = d[ 'blobs' ]
		axis = ax[ 'axis' ]
		n = np.array( [ - axis[ 1 ], axis[ 0 ] ] )
		if n @ prev_n < 0:
			n = - n
		# treble direction from handedness: d x n > 0 (image u right, v down)
		dvec = axis if axis[ 0 ] * n[ 1 ] - axis[ 1 ] * n[ 0 ] > 0 else - axis
		hyps = label_frame( blobs, ax[ 'idx' ], dvec )
		if not hyps:
			continue
		best_score = hyps[ 0 ][ 0 ]
		cands = [ lab for sc, lab in hyps if sc > best_score - 1.5 ]
		# octave choice: frame 0 -> treble end in view (highest label = top black key);
		# later -> closest to where the previous frame put those keys
		variants = []
		for lab in cands:
			for shift in range( - 35, 36, 5 ):
				l2 = { i: l + shift for i, l in lab.items() }
				if min( l2.values() ) < 0 or max( l2.values() ) >= NB:
					continue
				variants.append( l2 )
		if prev_pred is None:
			lab = max( variants, key = lambda l: ( len( l ), max( l.values() ) ) )
		else:
			def cost( l ):
				e = [ np.linalg.norm( blobs[ i ][ 'c' ] - prev_pred[ k ] ) for i, k in l.items() ]
				return np.median( e ) - 5 * len( l )
			lab = min( variants, key = cost )
		labels[ t ] = lab
		normals[ t ] = n
		prev_n = n
		# prediction for the next frame: 2D line fit of key index -> centroid
		ks = np.array( list( lab.values() ) )
		C = np.array( [ blobs[ i ][ 'c' ] for i in lab ] )
		hx = h1d_fit( BX[ ks ], C[ :, 0 ] )
		hy = h1d_fit( BX[ ks ], C[ :, 1 ] )
		prev_pred = np.stack( [ h1d_apply( hx, BX ), h1d_apply( hy, BX ) ], 1 )

	# ---- observations ------------------------------------------------------------------
	obs = []			# (frame, key, which: 0 front / 1 back, u, v)
	for t in range( N ):
		if not labels[ t ]:
			continue
		for i, k in labels[ t ].items():
			fr, bk = endpoints( dets[ t ][ 'blobs' ][ i ], normals[ t ] )
			obs.append( ( t, k, 0, *fr ) )
			obs.append( ( t, k, 1, *bk ) )
	obs = np.array( obs )
	frames = sorted( set( int( x ) for x in obs[ :, 0 ] ) )
	print( 'labelled frames', len( frames ), 'of', N, 'observations', len( obs ) )

	def pts3( ks, which, L ):
		return np.stack( [ BX[ ks ] * WHITE, np.zeros( len( ks ) ), np.where( which > 0, - L, 0.0 ) ], 1 )

	# ---- initial poses (planar PnP) -----------------------------------------------------
	poses = {}
	for t in frames:
		o = obs[ obs[ :, 0 ] == t ]
		ks, wh = o[ :, 1 ].astype( int ), o[ :, 2 ]
		P = pts3( ks, wh, L0 ).astype( np.float64 )
		K = np.array( [ [ f0, 0, W / 2 ], [ 0, f0, H / 2 ], [ 0, 0, 1 ] ] )
		ok, rvec, tvec = cv2.solvePnP( P, o[ :, 3:5 ].astype( np.float64 ), K, None, flags = cv2.SOLVEPNP_IPPE )
		if ok:
			poses[ t ] = np.concatenate( [ rvec.ravel(), tvec.ravel() ] )
	frames = [ t for t in frames if t in poses ]
	obs = obs[ np.isin( obs[ :, 0 ], frames ) ]

	# ---- bundle adjustment: f, L, all poses ---------------------------------------------
	fidx = { t: i for i, t in enumerate( frames ) }

	def unpack( x ):
		return x[ 0 ], x[ 1 ], x[ 2: ].reshape( - 1, 6 )

	def residuals( x ):
		f, L, P = unpack( x )
		r = np.empty( ( len( obs ), 2 ) )
		for t in frames:
			m = obs[ :, 0 ] == t
			o = obs[ m ]
			p = P[ fidx[ t ] ]
			r[ m ] = project( pts3( o[ :, 1 ].astype( int ), o[ :, 2 ], L ), p[ :3 ], p[ 3: ], f ) - o[ :, 3:5 ]
		return r.ravel()

	def sparsity():
		A = lil_matrix( ( 2 * len( obs ), 2 + 6 * len( frames ) ), dtype = int )
		for k, o in enumerate( obs ):
			j = 2 + 6 * fidx[ int( o[ 0 ] ) ]
			A[ 2 * k:2 * k + 2, 0:2 ] = 1
			A[ 2 * k:2 * k + 2, j:j + 6 ] = 1
		return A

	x0 = np.concatenate( [ [ f0, L0 ], np.array( [ poses[ t ] for t in frames ] ).ravel() ] )
	r0 = residuals( x0 )
	print( 'BA start: median px %.2f' % np.median( np.linalg.norm( r0.reshape( - 1, 2 ), axis = 1 ) ) )
	# numeric sensitivity of the cost to f and L at the start
	for k, dx in ( ( 0, 10.0 ), ( 1, 0.005 ) ):
		x1 = x0.copy(); x1[ k ] += dx
		print( '  d cost / d %s: %.1f' % ( 'fL'[ k ], ( np.sum( residuals( x1 ) ** 2 ) - np.sum( r0 ** 2 ) ) / dx ) )
	sol = least_squares( residuals, x0, jac_sparsity = sparsity(), loss = 'huber', f_scale = 3.0, x_scale = 'jac', max_nfev = 60, verbose = 1 )
	print( 'BA status', sol.status, sol.message, 'nfev', sol.nfev )
	f, L, P = unpack( sol.x )
	r = residuals( sol.x ).reshape( - 1, 2 )
	err = np.linalg.norm( r, axis = 1 )
	print( 'focal %.1f px  (HFOV %.1f deg on the 720 px side, VFOV %.1f deg)  L %.4f m' % ( f, 2 * np.degrees( np.arctan( W / 2 / f ) ), 2 * np.degrees( np.arctan( H / 2 / f ) ), L ) )
	print( 'reprojection px: median %.2f  p90 %.2f' % ( np.median( err ), np.percentile( err, 90 ) ) )

	# per-frame quality
	q = {}
	for t in frames:
		e = err[ obs[ :, 0 ] == t ]
		q[ t ] = dict( n = int( len( e ) // 2 ), med = float( np.median( e ) ) )

	# ---- camera trajectory in the world frame ------------------------------------------
	traj = []
	for t in frames:
		p = P[ fidx[ t ] ]
		R, _ = cv2.Rodrigues( p[ :3 ] )
		Rcw = R.T						# camera -> world
		pos = - Rcw @ p[ 3: ]
		traj.append( dict( frame = t, time = t / 30.0, pos = pos.tolist(), R = Rcw.tolist(), keys = q[ t ][ 'n' ], reproj = q[ t ][ 'med' ] ) )
	json.dump( dict( focal = f, width = W, height = H, black_len = L, frames = traj ), open( 'trajectory.json', 'w' ), indent = 1 )
	pickle.dump( dict( labels = labels, normals = normals ), open( 'labels.pkl', 'wb' ) )
	print( 'wrote trajectory.json:', len( traj ), 'frames' )


if __name__ == '__main__':
	main()

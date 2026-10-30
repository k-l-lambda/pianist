"""Stage 6: analyse the reconstructed handheld camera motion.

Input  camera.json (align.py). Outputs:
  traj.csv              per-frame pose (t, x, y, z, yaw, pitch, roll, look-at on the keyboard plane)
  fig_*.png             plots
  handheld_params.json  fitted shake model for the generator (handheld.js)

Decomposition: every DOF = intended motion (zero-phase low-pass, FC Hz) + shake (residual).
Orientation is described the way an operator thinks about it: yaw (heading about world up),
pitch (elevation of the optical axis), roll (horizon tilt about the optical axis).
"""

import json

import matplotlib
matplotlib.use( 'Agg' )
import matplotlib.pyplot as plt
import numpy as np
from scipy.signal import butter, filtfilt, welch
from scipy.spatial.transform import Rotation, Slerp

FPS = 30.0
FC = 1.0			# Hz, intended / shake split


import sys

SRC = sys.argv[ 1 ] if len( sys.argv ) > 1 else 'camera.json'
TAG = sys.argv[ 2 ] if len( sys.argv ) > 2 else ''		# output name suffix (e.g. '_sim')


def load():
	d = json.load( open( SRC ) )
	fr = np.array( [ x[ 'frame' ] for x in d[ 'frames' ] ] )
	P = np.array( [ x[ 'pos' ] for x in d[ 'frames' ] ] )
	R = Rotation.from_matrix( np.array( [ x[ 'R' ] for x in d[ 'frames' ] ] ) )
	# resample to every frame (fill unregistered frames)
	full = np.arange( fr.min(), fr.max() + 1 )
	Pf = np.stack( [ np.interp( full, fr, P[ :, i ] ) for i in range( 3 ) ], 1 )
	Rf = Slerp( fr, R )( full )
	return d, full, Pf, Rf, np.setdiff1d( full, fr )


def angles( Rf ):
	M = Rf.as_matrix()
	right, down, fwd = M[ :, :, 0 ], M[ :, :, 1 ], M[ :, :, 2 ]		# OpenCV camera axes in world
	up = - down
	yaw = np.degrees( np.unwrap( np.arctan2( fwd[ :, 0 ], - fwd[ :, 2 ] ) ) )
	pitch = np.degrees( np.arcsin( np.clip( fwd[ :, 1 ], - 1, 1 ) ) )
	# roll: tilt of the camera's up vector away from the vertical plane through the optical axis
	horiz = np.cross( fwd, [ 0, 1, 0 ] )
	horiz /= np.linalg.norm( horiz, axis = 1, keepdims = True )
	roll = np.degrees( np.arctan2( - ( up * horiz ).sum( 1 ), ( up * np.cross( horiz, fwd ) ).sum( 1 ) ) )
	return yaw, pitch, roll, fwd


def lowpass( x, fc = FC ):
	b, a = butter( 2, fc / ( FPS / 2 ) )
	return filtfilt( b, a, x, axis = 0 )


def lowpass_rotation( Rf ):
	"""Zero-phase low-pass of an orientation sequence (sign-aligned quaternions)."""
	q = Rf.as_quat()
	for i in range( 1, len( q ) ):
		if q[ i ] @ q[ i - 1 ] < 0:
			q[ i ] = - q[ i ]
	q = lowpass( q )
	return Rotation.from_quat( q / np.linalg.norm( q, axis = 1, keepdims = True ) )


def body_rates( Rf ):
	"""Angular velocity in the camera frame (rad/s): like a gyro (x: tilt up/down, y: pan, z: roll)."""
	rel = Rf[ :-1 ].inv() * Rf[ 1: ]
	return rel.as_rotvec() * FPS


def main():
	d, t_frames, P, Rf, missing = load()
	t = t_frames / FPS
	yaw, pitch, roll, fwd = angles( Rf )
	# look-at point: optical axis ∩ black-key plane (y = 0)
	s = - P[ :, 1 ] / np.where( np.abs( fwd[ :, 1 ] ) > 1e-3, fwd[ :, 1 ], - 1e-3 )
	look = P + fwd * s[ :, None ]
	np.savetxt( f'traj{TAG}.csv', np.column_stack( [ t, P, yaw, pitch, roll, look[ :, [ 0, 2 ] ] ] ), delimiter = ',', header = 't,x,y,z,yaw_deg,pitch_deg,roll_deg,look_x,look_z', comments = '', fmt = '%.6f' )

	ang = np.column_stack( [ yaw, pitch, roll ] )
	ang_i, P_i = lowpass( ang ), lowpass( P )
	R_i = lowpass_rotation( Rf )
	# shake as a small rotation in the camera's own axes (OpenCV: x right -> tilt,
	# y down -> pan, z forward -> roll); this is how the wrist actually moves the phone
	ang_s = np.degrees( ( R_i.inv() * Rf ).as_rotvec() )
	M_i = R_i.as_matrix()
	P_s = np.einsum( 'nji,nj->ni', M_i, P - P_i ) * 1000		# translation shake in camera axes, mm
	w = body_rates( Rf )									# rad/s, camera frame
	w_i = lowpass( w )
	w_s = w - w_i

	# ---- spectra ------------------------------------------------------------------------
	nper = 128
	fA, Pang = welch( ang_s, fs = FPS, nperseg = nper, axis = 0 )		# deg² / Hz
	fP, Ppos = welch( P_s, fs = FPS, nperseg = nper, axis = 0 )		# mm² / Hz
	fW, Pw = welch( np.degrees( w ), fs = FPS, nperseg = nper, axis = 0 )	# (deg/s)² / Hz
	band = ( fA >= 1.0 ) & ( fA <= 10 )
	slopes = [ float( np.polyfit( np.log( fA[ band ] ), np.log( Pang[ band, i ] ), 1 )[ 0 ] ) for i in range( 3 ) ]

	# ---- coupling: translation shake vs rotation shake (effective pivot of the hand) ------------
	# lateral (camera x) shake vs pan (about camera y), vertical (camera y) vs tilt (about x)
	Pc = P_s / 1000
	pan_s = np.radians( ang_s[ :, 1 ] )
	tilt_s = np.radians( ang_s[ :, 0 ] )
	lever_pan = float( np.polyfit( pan_s, Pc[ :, 0 ], 1 )[ 0 ] )
	lever_tilt = float( np.polyfit( tilt_s, Pc[ :, 1 ], 1 )[ 0 ] )
	corr_pan = float( np.corrcoef( pan_s, Pc[ :, 0 ] )[ 0, 1 ] )
	corr_tilt = float( np.corrcoef( tilt_s, Pc[ :, 1 ] )[ 0, 1 ] )

	# ---- time scales: autocorrelation of the shake ---------------------------------------
	def corr_time( x ):
		x = x - x.mean()
		ac = np.correlate( x, x, 'full' )[ len( x ) - 1: ]
		ac /= ac[ 0 ]
		k = np.argmax( ac < np.exp( - 1 ) )
		return k / FPS

	# ---- intended motion: speeds and holds ---------------------------------------------
	v = np.linalg.norm( np.gradient( P_i, axis = 0 ) * FPS, axis = 1 )		# m/s
	om = np.degrees( np.linalg.norm( w_i, axis = 1 ) )						# deg/s
	moving = ( v[ 1: ] > 0.05 ) | ( om > 8 )		# om is per frame interval

	stats = dict(
		duration_s = float( t[ -1 ] - t[ 0 ] ), frames = int( len( t ) ), unregistered_frames = int( len( missing ) ),
		path_length_m = float( np.sum( np.linalg.norm( np.diff( P_i, axis = 0 ), axis = 1 ) ) ),
		position_range_m = ( P.max( 0 ) - P.min( 0 ) ).round( 3 ).tolist(),
		distance_to_keyboard_m = [ float( np.linalg.norm( P - look, axis = 1 ).min() ), float( np.linalg.norm( P - look, axis = 1 ).max() ) ],
		yaw_range_deg = [ float( yaw.min() ), float( yaw.max() ) ], pitch_range_deg = [ float( pitch.min() ), float( pitch.max() ) ], roll_range_deg = [ float( roll.min() ), float( roll.max() ) ],
		intended_speed_mps = dict( median = float( np.median( v ) ), p95 = float( np.percentile( v, 95 ) ) ),
		intended_angular_speed_dps = dict( median = float( np.median( om ) ), p95 = float( np.percentile( om, 95 ) ) ),
		moving_fraction = float( moving.mean() ),
		shake_rms_deg = dict( zip( [ 'tilt', 'pan', 'roll' ], np.sqrt( ( ang_s ** 2 ).mean( 0 ) ).round( 3 ).tolist() ) ),
		shake_rms_mm = dict( zip( [ 'right', 'down', 'forward' ], np.sqrt( ( P_s ** 2 ).mean( 0 ) ).round( 2 ).tolist() ) ),
		shake_rate_rms_dps = dict( zip( [ 'tilt', 'pan', 'roll' ], np.degrees( np.sqrt( ( w_s ** 2 ).mean( 0 ) ) ).round( 2 ).tolist() ) ),
		shake_psd_slope_1_10Hz = dict( zip( [ 'tilt', 'pan', 'roll' ], np.round( slopes, 2 ).tolist() ) ),
		shake_corr_time_s = dict( zip( [ 'tilt', 'pan', 'roll' ], [ round( corr_time( ang_s[ :, i ] ), 3 ) for i in range( 3 ) ] ) ),
		lever_arm_m = dict( pan_to_lateral = lever_pan, tilt_to_vertical = lever_tilt, corr_pan = corr_pan, corr_tilt = corr_tilt ),
		kurtosis_rate = [ float( ( ( x - x.mean() ) ** 4 ).mean() / x.var() ** 2 ) for x in w_s.T ],
	)
	print( json.dumps( stats, indent = 1 ) )
	json.dump( stats, open( f'stats{TAG}.json', 'w' ), indent = 1 )
	if TAG:
		np.savez( f'spectra{TAG}.npz', fA = fA, Pang = Pang, fP = fP, Ppos = Ppos )
		return
	np.savez( 'spectra.npz', fA = fA, Pang = Pang, fP = fP, Ppos = Ppos )

	# intended path as keyframes every 0.5 s (position + look-at point), for the generator
	look_i = lowpass( look )
	keys = [ dict( t = float( t[ k ] - t[ 0 ] ), position = P_i[ k ].tolist(), target = look_i[ k ].tolist(), roll = float( ang_i[ k, 2 ] ) ) for k in range( 0, len( t ), 15 ) ]
	json.dump( keys, open( 'intended_keys.json', 'w' ), indent = 1 )

	# ---- generator parameters: shake PSD per axis on a log-frequency grid ------------------
	# PSD on a log-frequency grid: mean power density within each band (sampling the noisy
	# Welch estimate at single points lands on local peaks and inflates the synthesis)
	grid = np.geomspace( 0.3, 13, 12 )
	edges = np.sqrt( grid[ :-1 ] * grid[ 1: ] )
	edges = np.concatenate( [ [ grid[ 0 ] ** 2 / edges[ 0 ] ], edges, [ min( FPS / 2, grid[ -1 ] ** 2 / edges[ -1 ] ) ] ] )
	# the measured shake is the residual of a zero-phase low-pass split, i.e. the true spectrum
	# times (1 - |H|²)²; undo that once (capped) so a re-analysed synthetic camera matches
	b, a = butter( 2, FC / ( FPS / 2 ) )
	def split_gain( f ):
		from scipy.signal import freqz
		_, h = freqz( b, a, worN = 2 * np.pi * f / FPS )
		return np.maximum( ( 1 - np.abs( h ) ** 2 ) ** 2, 0.1 )

	def on_grid( f, p ):
		p = p / split_gain( f )[ :, None ] if p.ndim == 2 else p / split_gain( f )
		out = []
		for lo, hi in zip( edges[ :-1 ], edges[ 1: ] ):
			m = ( f >= lo ) & ( f < hi )
			out.append( float( p[ m ].mean() ) if m.any() else float( np.interp( np.sqrt( lo * hi ), f, p ) ) )
		return out
	params = dict(
		source = 'VID_20261029_231550.mp4 (handheld phone, 30 fps)', split_hz = FC,
		psd_freq_hz = grid.tolist(),
		axes = 'OpenCV camera frame: x right, y down, z forward; tilt/pan/roll = rotation about x/y/z',
		rot_psd_deg2_per_hz = { k: on_grid( fA, Pang[ :, i ] ) for i, k in enumerate( [ 'tilt', 'pan', 'roll' ] ) },
		pos_psd_mm2_per_hz = { k: on_grid( fP, Ppos[ :, i ] ) for i, k in enumerate( [ 'x', 'y', 'z' ] ) },
		rot_cross_corr = np.corrcoef( ang_s.T ).round( 3 ).tolist(),
		shake_rms_deg = stats[ 'shake_rms_deg' ], shake_rms_mm = stats[ 'shake_rms_mm' ],
		lever_arm_m = dict( pan = lever_pan, tilt = lever_tilt ),
		intended = dict( speed_p95_mps = stats[ 'intended_speed_mps' ][ 'p95' ], angular_speed_p95_dps = stats[ 'intended_angular_speed_dps' ][ 'p95' ] ),
	)
	json.dump( params, open( 'handheld_params.json', 'w' ), indent = 1 )

	# ---- plots ----------------------------------------------------------------------------
	fig, ax = plt.subplots( 4, 1, figsize = ( 11, 11 ), sharex = True )
	for i, n in enumerate( 'xyz' ):
		ax[ 0 ].plot( t, P[ :, i ], label = n )
		ax[ 0 ].plot( t, P_i[ :, i ], 'k', lw = 0.6, alpha = 0.6 )
	ax[ 0 ].set_ylabel( 'position (m)' ); ax[ 0 ].legend( ncol = 3 )
	for i, n in enumerate( [ 'yaw', 'pitch', 'roll' ] ):
		ax[ 1 ].plot( t, ang[ :, i ], label = n )
		ax[ 1 ].plot( t, ang_i[ :, i ], 'k', lw = 0.6, alpha = 0.6 )
	ax[ 1 ].set_ylabel( 'orientation (deg)' ); ax[ 1 ].legend( ncol = 3 )
	for i, n in enumerate( [ 'tilt', 'pan', 'roll' ] ):
		ax[ 2 ].plot( t, ang_s[ :, i ], label = n, lw = 0.8 )
	ax[ 2 ].set_ylabel( f'rotation shake, camera axes (deg, >{FC} Hz)' ); ax[ 2 ].legend( ncol = 3 )
	for i, n in enumerate( [ 'right', 'down', 'forward' ] ):
		ax[ 3 ].plot( t, P_s[ :, i ], label = n, lw = 0.8 )
	ax[ 3 ].set_ylabel( 'translation shake, camera axes (mm)' ); ax[ 3 ].legend( ncol = 3 ); ax[ 3 ].set_xlabel( 'time (s)' )
	for m in missing:
		for a in ax:
			a.axvline( m / FPS, color = 'r', alpha = 0.15, lw = 1 )
	fig.tight_layout(); fig.savefig( f'fig_timeseries{TAG}.png', dpi = 110 )

	fig, ax = plt.subplots( 1, 3, figsize = ( 15, 4.2 ) )
	for i, n in enumerate( [ 'tilt', 'pan', 'roll' ] ):
		ax[ 0 ].loglog( fA[ 1: ], Pang[ 1:, i ], label = n )
	ax[ 0 ].set_title( 'rotation shake PSD, camera axes (deg²/Hz)' )
	for i, n in enumerate( [ 'right', 'down', 'forward' ] ):
		ax[ 1 ].loglog( fP[ 1: ], Ppos[ 1:, i ], label = n )
	ax[ 1 ].set_title( 'translation shake PSD (mm²/Hz)' )
	for i, n in enumerate( [ 'tilt', 'pan', 'roll' ] ):
		ax[ 2 ].loglog( fW[ 1: ], Pw[ 1:, i ], label = n )
	ax[ 2 ].set_title( 'angular rate PSD, camera frame ((deg/s)²/Hz)' )
	for a in ax:
		a.set_xlabel( 'Hz' ); a.legend(); a.grid( True, which = 'both', alpha = 0.3 ); a.axvline( FC, color = 'k', ls = ':', lw = 1 )
	fig.tight_layout(); fig.savefig( 'fig_spectra.png', dpi = 110 )

	pts = np.load( 'points_world.npy' )
	near = ( np.abs( pts ) < 3 ).all( 1 )
	fig, ax = plt.subplots( 1, 2, figsize = ( 14, 6 ) )
	ax[ 0 ].scatter( pts[ near, 0 ], pts[ near, 2 ], s = 0.3, c = 'lightgray' )
	ax[ 0 ].plot( [ - 0.61, 0.61 ], [ 0, 0 ], 'k', lw = 4, label = 'keyboard (black-key fronts)' )
	sc = ax[ 0 ].scatter( P[ :, 0 ], P[ :, 2 ], c = t, s = 4, cmap = 'viridis' )
	for k in range( 0, len( t ), 30 ):
		ax[ 0 ].arrow( P[ k, 0 ], P[ k, 2 ], 0.15 * fwd[ k, 0 ], 0.15 * fwd[ k, 2 ], head_width = 0.02, color = 'C3' )
	ax[ 0 ].plot( look[ :, 0 ], look[ :, 2 ], 'C1', lw = 0.6, alpha = 0.7, label = 'look-at on key plane' )
	ax[ 0 ].set_aspect( 'equal' ); ax[ 0 ].set_xlabel( 'x (m)' ); ax[ 0 ].set_ylabel( 'z (m)' ); ax[ 0 ].set_title( 'top view (arrows every 1 s)' ); ax[ 0 ].legend( loc = 'lower left' )
	plt.colorbar( sc, ax = ax[ 0 ], label = 't (s)' )
	ax[ 1 ].scatter( pts[ near, 0 ], pts[ near, 1 ], s = 0.3, c = 'lightgray' )
	ax[ 1 ].scatter( P[ :, 0 ], P[ :, 1 ], c = t, s = 4, cmap = 'viridis' )
	ax[ 1 ].set_aspect( 'equal' ); ax[ 1 ].set_xlabel( 'x (m)' ); ax[ 1 ].set_ylabel( 'y (m, black-key tops = 0)' ); ax[ 1 ].set_title( 'front view' )
	fig.tight_layout(); fig.savefig( 'fig_path.png', dpi = 110 )


if __name__ == '__main__':
	main()

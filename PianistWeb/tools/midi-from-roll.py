#!/usr/bin/env python3
# Note lengths from a falling-notes video: a transcription's note-offs (Transkun's run long: it hears the
# string ring on under the pedal) moved to where the video's own piano roll ends each note. The video is a
# "Synthesia"-style render of the same performance (its sound what was transcribed): bars fall onto an 88-key
# keyboard at a constant speed, each as long as its note is held.
#
# A band of rows high above the keyboard (above the hit line's particles) is read per frame, per key a window
# across its bar (a white key's: the part no black key's bar covers; a black key's: its middle). A bar crossing
# the band at video time t is a note held at t + delta (the bars' fall time from the band to the keyboard,
# plus the transcription's own latency): delta is fitted to the transcription's onsets (each onset: the bar
# lit just after it, dark just before). Each note's off is then where its bar ends (its window dark again),
# clamped to [onset + 30 ms, the next onset of its pitch] and never later than the transcription's own; a note
# whose bar is not seen at its onset keeps its length (a fallback, counted).
#
#   python tools/midi-from-roll.py in.mid video.mp4 out.mid [--cut 268] [--band 70:90] [--x0 21.16]
#        [--white 24.214] [--thr 70] [--debug dir]
#
# --cut T: nothing after T s (the file's time): notes starting at or after it dropped, those sounding
# ended there, the pedals released there. --band: the rows read (in the video's 1280x720 frame; other sizes
# scaled). --x0: the A0/B0 boundary of the bars in the band (px), --white: a white key's bar pitch (px): the
# bars, not the keys (the keyboard is seen in perspective: its keys are narrower than the bars above them;
# fitted to Rousseau's Liebestraum, 1280x720: white-note bars 26 px wide, black-note bars 17.5, a black bar's
# centre off its white boundary by BLACK_OFF). --thr: a window lit above it
# (0-255, the bar's pink: the mean of red and blue). Needs numpy; ffmpeg on the path.

import argparse, json, os, struct, subprocess, sys
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument( 'midi' ); ap.add_argument( 'video' ); ap.add_argument( 'out' )
ap.add_argument( '--cut', type = float, default = None )
ap.add_argument( '--band', default = '70:90' )
ap.add_argument( '--x0', type = float, default = 13.66 ); ap.add_argument( '--white', type = float, default = 24.906 )
ap.add_argument( '--thr', type = float, default = 70 )
ap.add_argument( '--debug', default = None )
a = ap.parse_args()

# ---- the MIDI file: read (every event kept), notes paired, written back ----

def varlen( b, i ):

	v = 0
	while True:
		c = b[ i ]; i += 1; v = ( v << 7 ) | ( c & 0x7f )
		if c < 0x80: return v, i

def wvarlen( v ):

	out = [ v & 0x7f ]; v >>= 7
	while v: out.append( 0x80 | ( v & 0x7f ) ); v >>= 7
	return bytes( reversed( out ) )

def read_smf( path ):

	b = open( path, 'rb' ).read()
	assert b[ :4 ] == b'MThd'
	fmt, ntr, div = struct.unpack( '>HHH', b[ 8:14 ] )
	assert not div & 0x8000, 'SMPTE time division'
	i = 8 + struct.unpack( '>I', b[ 4:8 ] )[ 0 ]
	tracks = []
	for _ in range( ntr ):

		assert b[ i:i + 4 ] == b'MTrk'
		n = struct.unpack( '>I', b[ i + 4:i + 8 ] )[ 0 ]; j = i + 8; end = j + n; i = end
		tick = 0; run = None; ev = []
		while j < end:

			d, j = varlen( b, j ); tick += d
			s = b[ j ]
			if s == 0xff:
				t = b[ j + 1 ]; ln, k = varlen( b, j + 2 ); ev.append( ( tick, 'meta', t, b[ k:k + ln ] ) ); j = k + ln
			elif s in ( 0xf0, 0xf7 ):
				ln, k = varlen( b, j + 1 ); ev.append( ( tick, 'sysex', s, b[ k:k + ln ] ) ); j = k + ln
			else:
				if s & 0x80: run = s; j += 1
				nd = 1 if run & 0xf0 in ( 0xc0, 0xd0 ) else 2
				ev.append( ( tick, 'ch', run, b[ j:j + nd ] ) ); j += nd

		tracks.append( ev )

	return fmt, div, tracks

def write_smf( path, fmt, div, tracks ):

	out = b'MThd' + struct.pack( '>IHHH', 6, fmt, len( tracks ), div )
	for ev in tracks:

		body = b''; last = 0
		for tick, kind, s, data in ev:

			body += wvarlen( tick - last ); last = tick
			if kind == 'meta': body += bytes( [ 0xff, s ] ) + wvarlen( len( data ) ) + data
			elif kind == 'sysex': body += bytes( [ s ] ) + wvarlen( len( data ) ) + data
			else: body += bytes( [ s ] ) + data

		out += b'MTrk' + struct.pack( '>I', len( body ) ) + body

	open( path, 'wb' ).write( out )

fmt, div, tracks = read_smf( a.midi )
# the tempo map (track 0's, or any's): tick <-> seconds
tempos = sorted( ( t, int.from_bytes( d, 'big' ) ) for ev in tracks for t, k, s, d in ev if k == 'meta' and s == 0x51 ) or [ ( 0, 500000 ) ]
if tempos[ 0 ][ 0 ] != 0: tempos.insert( 0, ( 0, 500000 ) )
segs = []; sec = 0.0
for n, ( t, us ) in enumerate( tempos ):

	segs.append( ( t, sec, us ) )
	if n + 1 < len( tempos ): sec += ( tempos[ n + 1 ][ 0 ] - t ) * us / 1e6 / div

def t2s( tick ):

	t, s, us = next( x for x in reversed( segs ) if x[ 0 ] <= tick )
	return s + ( tick - t ) * us / 1e6 / div

def s2t( sec ):

	t, s, us = next( x for x in reversed( segs ) if x[ 1 ] <= sec )
	return int( round( t + ( sec - s ) * 1e6 * div / us ) )

# notes: ( track, channel, pitch, on tick, off tick, velocity ), other events kept as they are
notes = []; other = []
for ti, ev in enumerate( tracks ):

	open_ = {}
	for tick, kind, s, data in ev:

		if kind == 'ch' and s & 0xf0 in ( 0x80, 0x90 ):
			ch, p, v = s & 0x0f, data[ 0 ], data[ 1 ]
			if s & 0xf0 == 0x90 and v > 0:
				if ( ch, p ) in open_:		# (struck again while sounding: the old one ends here)
					on, vel = open_.pop( ( ch, p ) ); notes.append( ( ti, ch, p, on, tick, vel ) )
				open_[ ( ch, p ) ] = ( tick, v )
			elif ( ch, p ) in open_:
				on, vel = open_.pop( ( ch, p ) ); notes.append( ( ti, ch, p, on, tick, vel ) )
		elif not ( kind == 'meta' and s == 0x2f ): other.append( ( ti, tick, kind, s, data ) )

	for ( ch, p ), ( on, vel ) in open_.items(): notes.append( ( ti, ch, p, on, ev[ -1 ][ 0 ], vel ) )

notes.sort( key = lambda n: ( n[ 3 ], n[ 2 ] ) )
N = len( notes )
pitch = np.array( [ n[ 2 ] for n in notes ] ); on_s = np.array( [ t2s( n[ 3 ] ) for n in notes ] ); off_s = np.array( [ t2s( n[ 4 ] ) for n in notes ] )
print( f'{ N } notes, { on_s.min():.2f}-{ off_s.max():.2f} s; lengths: median { np.median( off_s - on_s ):.2f} s' )

# ---- the video: per frame, per key, its window's light in the band ----

r = subprocess.run( [ 'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', a.video ], capture_output = True, text = True, check = True )
st = json.loads( r.stdout )[ 'streams' ][ 0 ]; W, H = st[ 'width' ], st[ 'height' ]; fn, fd = map( int, st[ 'r_frame_rate' ].split( '/' ) ); fps = fn / fd
k = W / 1280
y0, y1 = ( int( round( int( v ) * H / 720 ) ) for v in a.band.split( ':' ) )
whites = [ p for p in range( 21, 109 ) if p % 12 in ( 0, 2, 4, 5, 7, 9, 11 ) ]
bw = 0.70		# a black-note bar's width, in white keys
BLACK_OFF = { 1: -1.8, 3: 2.4, 6: -3.3, 8: 0.3, 10: 4.0 }		# px (at a white pitch of 24.906)
def black_centre( p ): return a.x0 + whites.index( p - 1 ) * a.white + BLACK_OFF[ p % 12 ] * a.white / 24.906
def window( p ):

	if p in whites:
		j = whites.index( p ); l, rr = a.x0 + ( j - 1 ) * a.white, a.x0 + j * a.white		# (white j spans boundaries j-1 .. j)
		if p - 1 >= 21 and ( p - 1 ) not in whites: l = black_centre( p - 1 ) + bw / 2 * a.white
		if p + 1 <= 108 and ( p + 1 ) not in whites: rr = black_centre( p + 1 ) - bw / 2 * a.white
		l, rr = l + 2, rr - 2
	else:
		# a black key's: two windows, either side of its centre; lit only if both are. (A white-note bar is
		# as wide as its key's whole pitch, under the black keys too: the white bar beside lights one side)
		c = black_centre( p ); h = bw / 2 * a.white
		return [ px( c - h + 1, c - h + 4 ), px( c + h - 4, c + h - 1 ) ]		# (its edges: under a white bar beside only on that side)
	return [ px( l, rr ) ]
def px( l, rr ): return ( max( 0, int( round( l * k ) ) ), min( W, int( round( rr * k ) ) + 1 ) )

wins = { p: window( p ) for p in range( 21, 109 ) }
frame = W * ( y1 - y0 ) * 3
dec = subprocess.Popen( [ 'ffmpeg', '-v', 'error', '-i', a.video, '-vf', f'crop={ W }:{ y1 - y0 }:0:{ y0 }', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-' ], stdout = subprocess.PIPE )
rows = []
while True:

	b = dec.stdout.read( frame )
	if len( b ) < frame: break
	f = np.frombuffer( b, np.uint8 ).reshape( y1 - y0, W, 3 ).astype( np.float32 )
	pink = ( f[ ..., 0 ] + f[ ..., 2 ] ).mean( axis = 0 ) / 2		# (down the band)
	rows.append( [ min( pink[ l:rr ].mean() for l, rr in wins[ p ] ) for p in range( 21, 109 ) ] )

dec.wait()
V = np.array( rows, np.float32 )		# frames x 88
F = len( V ); print( f'video: { F } frames at { fps:g} fps, rows { y0 }-{ y1 }' )

def light( p, t ):
	"""The window's light at video time t (linear between frames)."""
	x = np.clip( np.asarray( t ) * fps, 0, F - 1 ); i = np.floor( x ).astype( int ); j = np.minimum( i + 1, F - 1 ); u = x - i
	return V[ i, p - 21 ] * ( 1 - u ) + V[ j, p - 21 ] * u

# ---- the bars: per key, each lit run (start, end: sub-frame, where the light crosses thr) ----
bars = {}
for q in range( 21, 109 ):

	v = V[ :, q - 21 ]; lit = v > a.thr; runs = []; f = 0
	while f < F:
		if lit[ f ]:
			g = f
			while g < F and lit[ g ]: g += 1
			# (where the light crosses thr: linear between the frames)
			st = ( f - 1 + ( a.thr - v[ f - 1 ] ) / max( v[ f ] - v[ f - 1 ], 1e-6 ) ) / fps if f > 0 else 0.0
			en = ( g - 1 + ( v[ g - 1 ] - a.thr ) / max( v[ g - 1 ] - v[ g ], 1e-6 ) ) / fps if g < F else F / fps
			runs.append( ( st, en ) ); f = g
		else: f += 1
	bars[ q ] = np.array( runs ).reshape( -1, 2 )

def nearest_start( q, t, tol ):
	"""The bar of key q starting nearest to video time t (within tol s): its index, or None."""
	b = bars[ q ]
	if not len( b ): return None
	i = int( np.argmin( np.abs( b[ :, 0 ] - t ) ) )
	return i if abs( b[ i, 0 ] - t ) <= tol else None

# delta: the fall time (band to keyboard) plus the transcription's latency. Globally: the most common
# onset - bar start; then per note, a running median of its neighbours' (the video drifts by ~0.1 s)
cand = []
for n in range( N ):
	b = bars[ pitch[ n ] ]
	if len( b ): cand.extend( on_s[ n ] - b[ :, 0 ][ np.abs( on_s[ n ] - b[ :, 0 ] - 1.6 ) < 2.5 ] )
h, edges = np.histogram( cand, bins = np.arange( 0, 4.0, 0.02 ) )
delta = edges[ int( np.argmax( h ) ) ] + 0.01
own = np.full( N, np.nan )
for n in range( N ):
	i = nearest_start( pitch[ n ], on_s[ n ] - delta, 0.25 )
	if i is not None: own[ n ] = on_s[ n ] - bars[ pitch[ n ] ][ i, 0 ]
local = np.full( N, delta )
ok = ~ np.isnan( own )
for n in range( N ):
	sel = ok & ( np.abs( on_s - on_s[ n ] ) < 8 )
	if sel.sum() >= 8: local[ n ] = np.median( own[ sel ] )
print( f'delta { delta:.3f} s; per note (running median over 16 s): { np.percentile( local, 5 ):.3f}-{ np.percentile( local, 95 ):.3f} s; '
	f'matched { ok.sum() } of { N } onsets within 0.25 s, |onset error| median { np.median( np.abs( own[ ok ] - local[ ok ] ) ) * 1000:.0f} ms' )

# ---- the offs: each note as long as its bar ----
next_same = np.full( N, 1e9 ); seen = {}
for n in range( N - 1, -1, -1 ):
	next_same[ n ] = on_s[ seen[ pitch[ n ] ] ] if pitch[ n ] in seen else 1e9
	seen[ pitch[ n ] ] = n
new_off = off_s.copy(); fell = np.zeros( N, bool )
for n in range( N ):

	q = pitch[ n ]
	hi = min( off_s[ n ], next_same[ n ] )
	if hi - on_s[ n ] < 0.03: continue
	i = nearest_start( q, on_s[ n ] - local[ n ], 0.12 )
	if i is not None: length = bars[ q ][ i, 1 ] - bars[ q ][ i, 0 ]		# (its bar's own length: no offset in it)
	else:
		# no bar starts here: struck again inside a bar that is still lit (merged), or none seen.
		# Lit at the onset: its end; dark: as it was
		t0 = on_s[ n ] - local[ n ]; b = bars[ q ]
		inside = np.nonzero( ( b[ :, 0 ] < t0 ) & ( b[ :, 1 ] > t0 + 0.04 ) )[ 0 ] if len( b ) else []
		if len( inside ): length = b[ inside[ 0 ], 1 ] - t0
		else: fell[ n ] = True; new_off[ n ] = hi; continue
	new_off[ n ] = min( max( on_s[ n ] + length, on_s[ n ] + 0.03 ), hi )

# ---- the cut ----
keep = np.ones( N, bool )
if a.cut is not None:
	keep = on_s < a.cut
	new_off = np.minimum( new_off, a.cut )

short = ( off_s - new_off )[ keep & ~ fell ]
changed = int( ( np.abs( off_s - new_off ) > 0.005 )[ keep ].sum() )
print( f'kept { keep.sum() } of { N } notes (cut { a.cut }); changed { changed }; fell back { int( ( fell & keep ).sum() ) }' )
print( f'shortened by: median { np.median( short ):.3f} s, 90th pct { np.percentile( short, 90 ):.3f} s, max { short.max():.2f} s; lengths median { np.median( ( new_off - on_s )[ keep ] ):.3f} s (was { np.median( ( off_s - on_s )[ keep ] ):.3f})' )

# ---- write: the notes, the other events (those after the cut dropped; the pedals released at it) ----
cut_tick = s2t( a.cut ) if a.cut is not None else None
out = [ [] for _ in tracks ]
order = { 'meta': 0, 'sysex': 1, 'ch': 2 }
for ti, tick, kind, s, data in other:

	if cut_tick is not None and tick > cut_tick: continue
	out[ ti ].append( ( tick, 1, kind, s, data ) )

if cut_tick is not None:
	# every controller that was last set non-zero (the pedals: 64, 66, 67), released at the cut
	state = {}
	for ti, tick, kind, s, data in sorted( other, key = lambda e: e[ 1 ] ):
		if kind == 'ch' and s & 0xf0 == 0xb0 and tick <= cut_tick and data[ 0 ] in ( 64, 66, 67 ): state[ ( ti, s, data[ 0 ] ) ] = data[ 1 ]
	for ( ti, s, cc ), v in state.items():
		if v: out[ ti ].append( ( cut_tick, 2, 'ch', s, bytes( [ cc, 0 ] ) ) )
for n in np.nonzero( keep )[ 0 ]:

	ti, ch, p, on, _, vel = notes[ n ]
	off = max( s2t( new_off[ n ] ), on + 1 )
	out[ ti ].append( ( on, 3, 'ch', 0x90 | ch, bytes( [ p, vel ] ) ) )
	out[ ti ].append( ( off, 0, 'ch', 0x80 | ch, bytes( [ p, 0 ] ) ) )		# (an off before an on at the same tick)

final = []
for ti, ev in enumerate( out ):
	ev.sort( key = lambda e: ( e[ 0 ], e[ 1 ] ) )
	endt = max( [ e[ 0 ] for e in ev ] + [ 0 ] )
	final.append( [ ( t, kind, s, d ) for t, _, kind, s, d in ev ] + [ ( endt, 'meta', 0x2f, b'' ) ] )
write_smf( a.out, fmt, div, final )
print( f'wrote { a.out }' )

if a.debug:
	os.makedirs( a.debug, exist_ok = True )
	np.savez_compressed( os.path.join( a.debug, 'roll.npz' ), V = V, fps = fps, delta = delta, pitch = pitch, on = on_s, off = off_s, new_off = new_off, fell = fell, keep = keep )

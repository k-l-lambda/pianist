#!/usr/bin/env python3
# Sustain pedal (CC64) given back where shortened notes left silence. A transcription's notes were cut to their
# keys' real lengths (tools/midi-from-roll.py), but its long notes had been what carried the sound while the
# pianist held the pedal; where its pedal does not cover what they used to sound, the notes now stop dead.
#
# Each note of the reference (the file before the cut) that is now shorter must sound to its old end: its
# string ringing under the pedal. Required: [its new off, its old off] (up to its pitch's next onset, and the
# cut); where no pedal is down then, the pedal is added. The pedal must be down before the key comes up (pressed
# after, the damper has fallen already): so a press goes just after the note's onset (--lead, the legato
# pedalling's ~50 ms, as a pianist presses it after the chord sounds), never closer than --gap to the previous
# release (a pedal change takes time), else before the key's release; where that cannot be, the previous pedal is
# held on through. A pedal already down while the note is held but released too early is held on (its release
# moved later); one pressed too late is pressed earlier; else a new press. Segments then merged; a release and a
# press closer than --gap become one held pedal. Gaps shorter than --min are left (inaudible).
# Notes, velocities, the soft pedal and everything else as they were; nothing after --cut.
#
#   python3 tools/midi-pedal-fill.py reference.mid trimmed.mid out.mid [--cut 268] [--min 0.08] [--lead 0.05]
#        [--gap 0.06] [--report file.json]
#
# Prints the gaps found, the seconds uncovered before and after, the presses added and the pedals extended, and
# the "blur" added: for the notes, sound past their old ends (a pedal held over a later chord sustains it too).
# Needs mido.

import argparse, json
import mido

ap = argparse.ArgumentParser()
ap.add_argument( 'ref' ); ap.add_argument( 'trimmed' ); ap.add_argument( 'out' )
ap.add_argument( '--cut', type = float, default = 268.0 )
ap.add_argument( '--min', type = float, default = 0.08 )
ap.add_argument( '--lead', type = float, default = 0.05 )
ap.add_argument( '--gap', type = float, default = 0.06 )
ap.add_argument( '--report', default = None )
a = ap.parse_args()


def tempo_map( m ):

	# (tick, seconds, tempo) segments
	ev = []
	for tr in m.tracks:
		t = 0
		for e in tr:
			t += e.time
			if e.type == 'set_tempo': ev.append( ( t, e.tempo ) )
	ev.sort()
	if not ev or ev[ 0 ][ 0 ] != 0: ev.insert( 0, ( 0, 500000 ) )
	seg, s = [], 0.0
	for i, ( t, tempo ) in enumerate( ev ):
		if i: s += ( t - ev[ i - 1 ][ 0 ] ) * ev[ i - 1 ][ 1 ] / 1e6 / m.ticks_per_beat
		seg.append( ( t, s, tempo ) )
	return seg


def t2s( seg, tpb, t ):

	k = max( i for i, x in enumerate( seg ) if x[ 0 ] <= t )
	return seg[ k ][ 1 ] + ( t - seg[ k ][ 0 ] ) * seg[ k ][ 2 ] / 1e6 / tpb


def s2t( seg, tpb, s ):

	k = max( i for i, x in enumerate( seg ) if x[ 1 ] <= s )
	return round( seg[ k ][ 0 ] + ( s - seg[ k ][ 1 ] ) * 1e6 * tpb / seg[ k ][ 2 ] )


def load( f ):

	m = mido.MidiFile( f ); seg = tempo_map( m )
	notes, on, ped = [], {}, []
	for tr in m.tracks:
		t = 0
		for e in tr:
			t += e.time
			s = t2s( seg, m.ticks_per_beat, t )
			if e.type == 'note_on' and e.velocity > 0: on.setdefault( e.note, [] ).append( ( s, e.velocity ) )
			elif e.type in ( 'note_off', 'note_on' ):
				if on.get( e.note ): o, v = on[ e.note ].pop( 0 ); notes.append( ( e.note, o, s, v ) )
			elif e.type == 'control_change' and e.control == 64: ped.append( ( s, e.value ) )
	ped.sort()
	iv, d = [], None
	for s, v in ped:
		if v >= 64 and d is None: d = s
		elif v < 64 and d is not None: iv.append( [ d, s ] ); d = None
	if d is not None: iv.append( [ d, a.cut ] )
	return m, seg, sorted( notes, key = lambda n: ( n[ 1 ], n[ 0 ] ) ), iv


def merge( iv ):

	out = []
	for s, e in sorted( iv ):
		if out and s <= out[ -1 ][ 1 ]: out[ -1 ][ 1 ] = max( out[ -1 ][ 1 ], e )
		else: out.append( [ s, e ] )
	return out


def minus( iv, cover ):

	# the parts of the intervals iv not in cover (both merged)
	out = []
	for s, e in iv:
		cur = s
		for c0, c1 in cover:
			if c1 <= cur or c0 >= e: continue
			if c0 > cur: out.append( [ cur, c0 ] )
			cur = max( cur, c1 )
			if cur >= e: break
		if cur < e: out.append( [ cur, e ] )
	return out


def length( iv ): return sum( e - s for s, e in iv )


ref_m, _, ref, _ = load( a.ref )
m, seg, notes, ped = load( a.trimmed )
ped = merge( ped )

# the notes matched (pitch, onset within 5 ms); each one's required ringing
by_pitch = {}
for n in notes: by_pitch.setdefault( n[ 0 ], [] ).append( n )
next_on = {}
for p, ns in by_pitch.items():
	for i, n in enumerate( ns ): next_on[ ( p, n[ 1 ] ) ] = ns[ i + 1 ][ 1 ] if i + 1 < len( ns ) else a.cut
req = []		# ( new off, end, onset, pitch )
for p, o, off, v in ref:
	if o >= a.cut: continue
	match = [ n for n in by_pitch.get( p, [] ) if abs( n[ 1 ] - o ) < 0.005 ]
	if not match: continue
	n = match[ 0 ]
	end = min( off, next_on[ ( p, n[ 1 ] ) ], a.cut )
	if end > n[ 2 ] + 1e-4: req.append( ( n[ 2 ], end, n[ 1 ], p ) )

need = merge( [ [ s, e ] for s, e, _, _ in req ] )
gaps0 = minus( need, ped )
gaps0_big = [ g for g in gaps0 if g[ 1 ] - g[ 0 ] >= a.min ]

# the fill, note by note in time: each required interval's uncovered part
pedal = [ list( x ) for x in ped ]
added = extended_rel = extended_press = bridged = 0
for s, e, o, p in sorted( req ):

	pedal = merge( pedal )
	unc = [ g for g in minus( [ [ s, e ] ], pedal ) if g[ 1 ] - g[ 0 ] >= a.min ]
	for g0, g1 in unc:

		if g0 > s + 1e-4:
			# a pedal covered the start (pressed while the key was held) and was released at g0: held on
			k = next( i for i, x in enumerate( pedal ) if abs( x[ 1 ] - g0 ) < 1e-4 )
			pedal[ k ][ 1 ] = g1; extended_rel += 1
			continue
		# not down at the key's release: down from just after the onset
		prev = max( ( x for x in pedal if x[ 1 ] <= s + 1e-4 ), key = lambda x: x[ 1 ], default = None )
		lo = max( o, prev[ 1 ] + a.gap if prev else o )
		hi = s - 0.01
		press = min( max( o + a.lead, lo ), hi )
		if press < lo or press <= o - 1e-6:
			# no room for a change before the key comes up: the previous pedal held on through
			if prev is not None and s - prev[ 1 ] < a.gap + 0.01: prev[ 1 ] = g1; bridged += 1; continue
			press = max( o, hi )
		after = min( ( x for x in pedal if x[ 0 ] >= s - 1e-4 ), key = lambda x: x[ 0 ], default = None )
		if after is not None and after[ 0 ] <= g1 + a.gap:
			after[ 0 ] = press; extended_press += 1		# (pressed too late: earlier; it covers on from there)
			if after[ 1 ] < g1: after[ 1 ] = g1
		else:
			pedal.append( [ press, g1 ] ); added += 1

# a release and a press too close for a pianist: one held pedal
pedal = merge( pedal )
fused = []
for x in pedal:
	if fused and x[ 0 ] - fused[ -1 ][ 1 ] < a.gap * 0.75: fused[ -1 ][ 1 ] = max( fused[ -1 ][ 1 ], x[ 1 ] )
	else: fused.append( list( x ) )
pedal = [ [ s, min( e, a.cut ) ] for s, e in fused if s < a.cut ]
gaps1 = minus( need, pedal )


def blur( pedal_iv ):

	# sound past the notes' old ends: a note released under the pedal rings to its release (or its next onset)
	ref_end = {}
	for p, o, off, v in ref: ref_end[ ( p, round( o, 3 ) ) ] = off
	tot = 0.0
	for p, o, off, v in notes:
		ring = off
		for s, e in pedal_iv:
			if s <= off < e: ring = e; break
		ring = min( ring, next_on[ ( p, o ) ] )
		old = ref_end.get( ( p, round( o, 3 ) ), off )
		tot += max( 0.0, ring - max( old, off ) )
	return tot


# write: the pedal's CC64 events replaced, everything else as it was
track_cc = None
for i, tr in enumerate( m.tracks ):
	if any( e.type == 'control_change' and e.control == 64 for e in tr ): track_cc = i
if track_cc is None: track_cc = len( m.tracks ) - 1
chan = next( ( e.channel for tr in m.tracks for e in tr if e.type == 'control_change' and e.control == 64 ), 0 )
tpb = m.ticks_per_beat
for i, tr in enumerate( m.tracks ):

	abs_ev, t = [], 0
	for e in tr:
		t += e.time
		if e.is_meta and e.type == 'end_of_track': continue
		if i == track_cc and e.type == 'control_change' and e.control == 64: continue
		abs_ev.append( ( t, 1, e ) )
	if i == track_cc:
		for s, e in pedal:
			abs_ev.append( ( s2t( seg, tpb, s ), 0, mido.Message( 'control_change', channel = chan, control = 64, value = 127 ) ) )
			abs_ev.append( ( s2t( seg, tpb, e ), 0, mido.Message( 'control_change', channel = chan, control = 64, value = 0 ) ) )
	abs_ev.sort( key = lambda x: ( x[ 0 ], x[ 1 ] ) )		# (at one tick: the pedal before the notes)
	end_t = abs_ev[ -1 ][ 0 ] if abs_ev else 0
	tr.clear(); last = 0
	for t, _, e in abs_ev: tr.append( e.copy( time = t - last ) ); last = t
	tr.append( mido.MetaMessage( 'end_of_track', time = 0 ) )
m.save( a.out )

rep = {
	'required_s': round( length( need ), 2 ),
	'gaps_before': len( gaps0 ), 'gaps_before_over_min': len( gaps0_big ),
	'uncovered_before_s': round( length( gaps0 ), 2 ), 'uncovered_before_over_min_s': round( length( gaps0_big ), 2 ),
	'uncovered_after_s': round( length( gaps1 ), 2 ), 'gaps_after_over_min': sum( 1 for g in gaps1 if g[ 1 ] - g[ 0 ] >= a.min ),
	'pedals_before': len( ped ), 'pedals_after': len( pedal ),
	'presses_added': added, 'releases_held_on': extended_rel, 'presses_moved_earlier': extended_press, 'held_through_change': bridged,
	'blur_before_s': round( blur( ped ), 2 ), 'blur_after_s': round( blur( pedal ), 2 ),
	'pedal_down_before_s': round( length( ped ), 2 ), 'pedal_down_after_s': round( length( pedal ), 2 ),
}
print( json.dumps( rep, indent = 1 ) )
if a.report:
	json.dump( { **rep, 'gaps_before': [ [ round( s, 3 ), round( e, 3 ) ] for s, e in gaps0 ], 'pedal_before': ped, 'pedal_after': pedal }, open( a.report, 'w' ), indent = 1 )

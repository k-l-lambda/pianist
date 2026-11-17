#!/usr/bin/env python3
"""tools/script-preview-align.py <utterances.json> <aligned.json> [--cache whisper-cache.json] [--no-whisper]

Each character's time for tools/script-preview.mjs's subtitles. An utterance: { kind: audio | midi, text, start
(script s the sound starts), file, from (audio: s into the file), tts (midi: the TTS line it was fitted to, or null) }.
  audio      faster-whisper word timestamps on the recording; t = start + (word time - from)
  midi+tts   the same on the TTS line, its speech (first word .. last word) mapped linearly onto the MIDI's notes
             (first note on .. last note off): the file was fitted to the line sped up (Rubber Band 1.3x)
  midi       the text spread over the MIDI's note activity (20 ms frames with a note sounding)
Characters: the words' characters (a word's time shared out evenly) matched to the text's (difflib, punctuation
left out); a character not matched is interpolated between matched neighbours; punctuation appears with the
character before it. Whisper's words are cached by file, size and mtime.
"""
import difflib, json, os, re, sys, unicodedata
import numpy as np

args = sys.argv[ 1: ]
src, dst = args[ 0 ], args[ 1 ]
cache_file = args[ args.index( '--cache' ) + 1 ] if '--cache' in args else None
use_whisper = '--no-whisper' not in args
utts = json.load( open( src ) )
cache = json.load( open( cache_file ) ) if cache_file and os.path.exists( cache_file ) else {}

def is_content( c ):
	return unicodedata.category( c )[ 0 ] in 'LN'

_model = None
def words_of( path, prompt ):
	key = f'{path}|{os.path.getsize( path )}|{int( os.path.getmtime( path ) )}'
	if key in cache: return cache[ key ]
	global _model
	if _model is None:
		from faster_whisper import WhisperModel
		try: _model = WhisperModel( 'small', device = 'cuda', compute_type = 'float16' )
		except Exception: _model = WhisperModel( 'small', device = 'cpu', compute_type = 'int8' )
	segs, _ = _model.transcribe( path, language = 'zh', word_timestamps = True, initial_prompt = prompt, beam_size = 5, vad_filter = False )
	ws = [ [ w.start, w.end, w.word ] for s in segs for w in ( s.words or [] ) ]
	cache[ key ] = ws
	return ws

def midi_notes( path ):
	import mido
	t, on, notes = 0.0, {}, []
	for msg in mido.MidiFile( path ):
		t += msg.time
		if msg.type == 'note_on' and msg.velocity > 0: on.setdefault( ( msg.channel, msg.note ), [] ).append( t )
		elif msg.type in ( 'note_off', 'note_on' ):
			s = on.get( ( msg.channel, msg.note ) )
			if s: notes.append( ( s.pop( 0 ), t ) )
	return sorted( notes )

def voiced( path ):
	"""20 ms frames with speech (RMS within 35 dB of the peak, over the noise): their times, the speech's span."""
	import subprocess
	raw = subprocess.run( [ 'ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-' ], capture_output = True ).stdout
	x = np.frombuffer( raw, np.float32 )
	n = 320; f = len( x ) // n
	if f < 2: return np.array( [ 0.0 ] ), ( 0.0, len( x ) / 16000 )
	db = 20 * np.log10( np.sqrt( ( x[ : f * n ].reshape( f, n ) ** 2 ).mean( 1 ) ) + 1e-9 )
	thr = max( db.max() - 35, np.percentile( db, 10 ) + 8 )
	on = np.flatnonzero( db > thr ) * 0.02
	if not len( on ): on = np.array( [ 0.0, f * 0.02 ] )
	return on, ( float( on[ 0 ] ), float( on[ -1 ] + 0.02 ) )

def spread( text, on ):
	"""The content characters spread evenly over the voiced frames `on` (punctuation with the one before)."""
	content = [ i for i, c in enumerate( text ) if is_content( c ) ]
	t = [ None ] * len( text )
	for k, i in enumerate( content ): t[ i ] = float( on[ min( len( on ) - 1, int( k * len( on ) / max( 1, len( content ) ) ) ) ] )
	last = float( on[ 0 ] )
	for i in range( len( t ) ):
		if t[ i ] is None: t[ i ] = last
		last = t[ i ]
	return t

def char_times( text, words, span, on = None ):
	"""Times (relative to the words' clock) for each character of text; `span`: the speech's (from its energy),
	`on`: its voiced frames (where too few characters match the words, the text is spread over them)."""
	tc = list( text )
	content = [ i for i, c in enumerate( tc ) if is_content( c ) ]
	wc, wt = [], []
	for s, e, w in words:
		cs = [ c for c in w if is_content( c ) ]
		for k, c in enumerate( cs ):
			wc.append( c ); wt.append( s + ( e - s ) * k / max( 1, len( cs ) ) )
	times = [ None ] * len( tc )
	if wc:
		sm = difflib.SequenceMatcher( None, wc, [ tc[ i ] for i in content ], autojunk = False )
		for a, b, n in sm.get_matching_blocks():
			for k in range( n ): times[ content[ b + k ] ] = wt[ a + k ]
	# too few matched (Whisper heard something else: a dubbed film line): spread over the voiced frames
	s0, s1 = span
	known = [ i for i in content if times[ i ] is not None ]
	if on is not None and len( known ) < 0.5 * len( content ): return spread( text, on )
	# the speech's ends as anchors where the first / last characters were not heard (a dropped first phrase)
	if content and times[ content[ 0 ] ] is None: times[ content[ 0 ] ] = s0
	if content and times[ content[ -1 ] ] is None and known: times[ content[ -1 ] ] = max( times[ known[ -1 ] ], s1 - 0.15 )
	known = [ i for i in content if times[ i ] is not None ]
	if not known:		# nothing matched: evenly over the speech
		for k, i in enumerate( content ): times[ i ] = s0 + ( s1 - s0 ) * k / max( 1, len( content ) )
	else:
		avg = ( ( times[ known[ -1 ] ] - times[ known[ 0 ] ] ) / max( 1, content.index( known[ -1 ] ) - content.index( known[ 0 ] ) ) ) if len( known ) > 1 else 0.2
		avg = min( max( avg, 0.08 ), 0.35 )
		pos = { i: k for k, i in enumerate( content ) }
		for i in content:
			if times[ i ] is not None: continue
			before = [ j for j in known if j < i ]; after = [ j for j in known if j > i ]
			if before and after:
				a, b = before[ -1 ], after[ 0 ]
				times[ i ] = times[ a ] + ( times[ b ] - times[ a ] ) * ( pos[ i ] - pos[ a ] ) / ( pos[ b ] - pos[ a ] )
			elif before: times[ i ] = min( s1, times[ before[ -1 ] ] + avg * ( pos[ i ] - pos[ before[ -1 ] ] ) )
			else: times[ i ] = max( s0, times[ after[ 0 ] ] - avg * ( pos[ after[ 0 ] ] - pos[ i ] ) )
	# punctuation with the character before it (the first ones with the first character)
	last = None
	for i in range( len( tc ) ):
		if times[ i ] is None: times[ i ] = last
		last = times[ i ]
	first = next( ( t for t in times if t is not None ), s0 )
	times = [ first if t is None else t for t in times ]
	# never backwards
	for i in range( 1, len( times ) ): times[ i ] = max( times[ i ], times[ i - 1 ] )
	return times

out = []
for u in utts:
	text, method = u[ 'text' ], None
	try:
		if u[ 'kind' ] == 'audio':
			ws = words_of( u[ 'file' ], text ) if use_whisper else []
			on, span = voiced( u[ 'file' ] )
			rel = char_times( text, ws, span, on )
			ts = [ u[ 'start' ] + t - ( u.get( 'from' ) or 0 ) for t in rel ]
			method = 'whisper' if ws else 'even'
		else:
			notes = midi_notes( u[ 'file' ] )
			ms, me = ( notes[ 0 ][ 0 ], max( e for _, e in notes ) ) if notes else ( 0.0, 2.0 )
			if u.get( 'tts' ) and use_whisper:
				ws = words_of( u[ 'tts' ], text )
				on, span = voiced( u[ 'tts' ] )		# (the speech's span from its energy: Whisper may drop a first phrase)
				rel = char_times( text, ws, span, on )
				k = ( me - ms ) / max( 1e-3, span[ 1 ] - span[ 0 ] )
				ts = [ u[ 'start' ] + ms + ( t - span[ 0 ] ) * k for t in rel ]
				method = f'tts-whisper x{k:.3f}'
			else:
				# over the note activity: 20 ms frames with a note on, the characters spread over them
				fr = 0.02; n = int( me / fr ) + 2; act = np.zeros( n, bool )
				for s, e in notes: act[ int( s / fr ): int( e / fr ) + 1 ] = True
				on = np.flatnonzero( act ) * fr
				content = [ i for i, c in enumerate( text ) if is_content( c ) ]
				rel = [ None ] * len( text )
				for k, i in enumerate( content ): rel[ i ] = float( on[ int( k * len( on ) / max( 1, len( content ) ) ) ] ) if len( on ) else ms
				rel = char_times( text, [], ( ms, me ) ) if not len( on ) else [ ( r if r is not None else None ) for r in rel ]
				last = ms
				for i in range( len( rel ) ):
					if rel[ i ] is None: rel[ i ] = last
					last = rel[ i ]
				ts = [ u[ 'start' ] + t for t in rel ]
				method = 'midi-activity'
	except Exception as e:
		print( f"align {u.get( 'id' )}: {e}", file = sys.stderr )
		ts = [ u[ 'start' ] + 0.12 * k for k in range( len( text ) ) ]; method = 'fallback'
	out.append( { **u, 'method': method, 'chars': [ { 'c': c, 't': round( float( t ), 3 ) } for c, t in zip( text, ts ) ] } )
	print( f"  {u.get( 'id', '?' ):28s} {method:18s} {ts[ 0 ]:7.2f}-{ts[ -1 ]:7.2f} s  {text[ :24 ]}" )
if cache_file: json.dump( cache, open( cache_file, 'w' ), ensure_ascii = False )
json.dump( out, open( dst, 'w' ), ensure_ascii = False, indent = 1 )

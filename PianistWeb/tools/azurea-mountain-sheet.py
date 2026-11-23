# Before / after sheets for Azurea's procedural coast (src/azurea-mountains.js), and a side-by-side with the references.
#   python3 tools/azurea-mountain-sheet.py <render dir> <reference dir>
# <render dir> holds before/b-<shot>.png and after/a-<shot>.png (tools/azurea-preset-shot.mjs with
# tools/azurea-mountain-shots.json); writes before-after-{day,night,golden}.png, horizon-crops.png and
# reference-side-by-side.png there.
import sys, os
from PIL import Image, ImageDraw

R, REF = sys.argv[ 1 ], sys.argv[ 2 ]
W = 960

def load( p, w = W ):
	im = Image.open( p ).convert( 'RGB' )
	return im.resize( ( w, round( im.height * w / im.width ) ) )

def label( im, text ):
	d = ImageDraw.Draw( im ); d.rectangle( ( 0, 0, 8 + 7 * len( text ), 18 ), fill = ( 0, 0, 0 ) ); d.text( ( 4, 3 ), text, fill = ( 255, 255, 255 ) )
	return im

def grid( rows, out ):
	h = sum( max( i.height for i in r ) for r in rows ); w = max( sum( i.width for i in r ) for r in rows )
	S = Image.new( 'RGB', ( w, h ), ( 20, 20, 20 ) ); y = 0
	for r in rows:
		x = 0
		for i in r: S.paste( i, ( x, y ) ); x += i.width
		y += max( i.height for i in r )
	S.save( os.path.join( R, out ) ); print( out, S.size )

shots = sorted( f[ 2:-4 ] for f in os.listdir( os.path.join( R, 'after' ) ) if f.startswith( 'a-' ) )
for t in ( 'day', 'night', 'golden' ):
	rows = [ [ label( load( os.path.join( R, 'before', f'b-{s}.png' ) ), f'before {s}' ), label( load( os.path.join( R, 'after', f'a-{s}.png' ) ), f'after {s}' ) ] for s in shots if s.endswith( t ) and os.path.exists( os.path.join( R, 'before', f'b-{s}.png' ) ) ]
	if rows: grid( rows, f'before-after-{t}.png' )

# the horizon band at full resolution (rows 250..470 of the 1280 x 720 shots)
rows = []
for s in ( 'right-day', 'window-day', 'right-night', 'right-golden' ):
	b, a = ( os.path.join( R, d, f'{p}-{s}.png' ) for d, p in ( ( 'before', 'b' ), ( 'after', 'a' ) ) )
	if os.path.exists( b ) and os.path.exists( a ):
		rows.append( [ label( Image.open( b ).convert( 'RGB' ).crop( ( 0, 250, 1280, 470 ) ), f'before {s}' ) ] )
		rows.append( [ label( Image.open( a ).convert( 'RGB' ).crop( ( 0, 250, 1280, 470 ) ), f'after {s}' ) ] )
grid( rows, 'horizon-crops.png' )

# the references beside the nearest views
pairs = [ ( '6d41e899-6ce2-45ea-bce3-8b0a39768ff1.png', 'lobby-day' ), ( '屏幕截图 2026-11-09 203423.png', 'window-day' ) ]
rows = []
for ref, s in pairs:
	p = os.path.join( REF, ref )
	if not os.path.exists( p ): continue
	r = load( p ); a = load( os.path.join( R, 'after', f'a-{s}.png' ) ); b = load( os.path.join( R, 'before', f'b-{s}.png' ) )
	rows.append( [ label( r, 'reference' ), label( b, f'before {s}' ), label( a, f'after {s}' ) ] )
grid( rows, 'reference-side-by-side.png' )

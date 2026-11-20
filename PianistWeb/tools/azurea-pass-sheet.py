#!/usr/bin/env python3
"""Package reference crop | named stage render without automated acceptance scores.
Usage: python3 -I tools/azurea-pass-sheet.py TOPIC PREFIX COMPONENT...
COMPONENT is stair/lounge/tower/chandelier/reference-lobby/neutral/grazing.
"""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('topic', type=Path)
p.add_argument('prefix')
p.add_argument('components', nargs='+')
a = p.parse_args()
refs = {'tower': 'bar-tower', 'reference-lobby': 'lighting', 'neutral': 'lighting', 'grazing': 'floor'}
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
for component in a.components:
    ref = a.topic / 'specs' / f'{refs.get(component, component)}-reference.png'
    rendered = a.topic / 'round2' / f'{a.prefix}-{component}.png'
    sheet = Image.new('RGB', (1600, 510), '#fafaf7')
    draw = ImageDraw.Draw(sheet)
    for x, path, title in [(0, ref, 'REFERENCE CROP'), (800, rendered, a.prefix.upper() + ' / ' + component)]:
        im = Image.open(path).convert('RGB')
        im.thumbnail((800, 450), getattr(Image, 'Resampling', Image).LANCZOS)
        sheet.paste(im, (x + (800 - im.width) // 2, 52 + (450 - im.height) // 2))
        draw.text((x + 12, 14), title, font=font, fill='#242b31')
    sheet.save(a.topic / 'round2' / f'{a.prefix}-{component}-comparison.png')

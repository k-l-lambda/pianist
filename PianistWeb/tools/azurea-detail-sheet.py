#!/usr/bin/env python3
"""Assemble Azurea render evidence; no similarity score or automatic acceptance.

python3 -I tools/azurea-detail-sheet.py REFERENCE TOPIC_DIR
Requires Pillow, uses the named baseline/after captures from azurea-detail-shot.mjs.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def sheet(items, path, width, columns):
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
    image_h = round(width * 9 / 16)
    row_h = image_h + 48
    rows = (len(items) + columns - 1) // columns
    output = Image.new('RGB', (width * columns, row_h * rows), '#fafaf7')
    draw = ImageDraw.Draw(output)
    for i, (source, title) in enumerate(items):
        x, y = i % columns * width, i // columns * row_h
        draw.text((x + 16, y + 12), title, fill='#242b31', font=font)
        im = Image.open(source).convert('RGB').resize((width, image_h), getattr(Image, 'Resampling', Image).LANCZOS)
        output.paste(im, (x, y + 48))
    output.save(path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('reference', type=Path)
    p.add_argument('topic', type=Path)
    args = p.parse_args()
    t = args.topic
    sheet([(args.reference, 'REFERENCE'), (t / 'baseline-reference-lobby.png', 'BEFORE'),
           (t / 'after-reference-lobby.png', 'AFTER')], t / 'comparison-reference-before-after.png', 960, 3)
    sheet([(t / f'after-{name}.png', title) for name, title in [
        ('chandelier-close', 'Crystal leaves and coves'), ('bar-close', 'Bar service details'),
        ('sculpture-close', 'Chrome loop sculpture'), ('floor-grazing', 'Floor: grazing light'),
        ('neutral', 'Broad white key / fill diagnostic'), ('bar-neutral', 'Bar: neutral diagnostic')]],
        t / 'comparison-closeups.png', 960, 2)


if __name__ == '__main__':
    main()

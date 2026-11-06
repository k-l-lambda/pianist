#!/usr/bin/env python3
"""A relief's self-lit pattern: where it stands out of its panel (tools/bust-depth.py's MoGe geometry).

The panel's plane is fitted to the masked points (robustly: refitted to the 60 % nearest it, a few
times), each point's height is its distance in front of that plane; the glow is a smoothstep of the
height (--low .. --high, MoGe units, about metres), slightly blurred: the raised lines (a clef, its
staff, notes, a border) lit, the flat panel not. Writes <prefix>-glow.png (grey, the photo's size:
the relief's UVs), which tools/luminara-asset.mjs packs as its emissive map.

  .venv-depth/bin/python -I tools/relief-glow.py <relief prefix> [--low 0.006] [--high 0.016]
"""
import argparse
import numpy as np
from PIL import Image, ImageFilter


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('prefix', help='e.g. <generated>/relief/clef (its .npz)')
	ap.add_argument('--low', type=float, default=0.006)
	ap.add_argument('--high', type=float, default=0.016)
	a = ap.parse_args()
	d = np.load(a.prefix + '.npz')
	P, M = d['points'], d['mask']
	H, W = M.shape
	z = P[..., 2]
	ys, xs = np.nonzero(M & np.isfinite(z))
	A = np.stack([ xs / W, ys / H, np.ones(len(xs)) ], 1)
	zz = z[ys, xs].astype(np.float64)
	keep = np.ones(len(zz), bool)
	for _ in range(4):
		c, *_ = np.linalg.lstsq(A[keep], zz[keep], rcond=None)
		r = zz - A @ c
		keep = np.abs(r) < np.percentile(np.abs(r), 60)
	h = np.zeros((H, W))
	h[ys, xs] = - r		# (towards the camera: nearer, smaller z)
	t = np.clip(( h - a.low ) / ( a.high - a.low ), 0, 1)
	g = t * t * ( 3 - 2 * t )
	img = Image.fromarray(( g * 255 ).round().astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
	img.save(a.prefix + '-glow.png')
	print(f'{a.prefix}-glow.png: {( g > 0.5 ).mean() * 100:.1f} % lit (height {a.low}..{a.high})')


if __name__ == '__main__':
	main()

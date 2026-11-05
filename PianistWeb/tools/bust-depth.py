#!/usr/bin/env python3
"""Geometry of a generated bust photo (tools/bust-relief.mjs makes the mesh from it).

MoGe-2 (microsoft/MoGe, Ruicheng/moge-2-vitl-normal, MIT): a metric point map in camera space
(x right, y down, z forward) and a normal map from one image; the bust's mask (bust_mask:
colour or depth against the backdrop, less the floor) within MoGe's own.
Writes <out>.npz: points (H, W, 3) float32, normal (H, W, 3) float32, mask (H, W) bool, and
<out>-preview.png (depth and normals, for a look).

  .venv-depth/bin/python tools/bust-depth.py <photo.jpg> <out prefix> --moge <MoGe source dir> [--tokens 2500]
"""
import argparse, sys
from collections import deque
import numpy as np
from PIL import Image


def background_mask(a):
	"""The bust: not the border's colour, the largest blob, its holes filled."""
	h, w, _ = a.shape
	border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]).astype(np.float32)
	bg = np.median(border, 0)
	d = np.linalg.norm(a.astype(np.float32) - bg, axis=2)
	fg = d > max(18.0, 4 * float(np.median(np.linalg.norm(border - bg, axis=1))))
	lab = np.zeros((h, w), np.int32); best, bestn, cur = 0, 0, 0
	for y0 in range(0, h, 8):
		for x0 in range(0, w, 8):
			if not fg[y0, x0] or lab[y0, x0]: continue
			cur += 1; q = deque([(y0, x0)]); lab[y0, x0] = cur; n = 0
			while q:
				y, x = q.popleft(); n += 1
				for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
					if 0 <= yy < h and 0 <= xx < w and fg[yy, xx] and not lab[yy, xx]:
						lab[yy, xx] = cur; q.append((yy, xx))
			if n > bestn: best, bestn = cur, n
	m = lab == best
	out = np.zeros((h, w), bool); q = deque()
	for y in range(h):
		for x in (0, w - 1):
			if not m[y, x] and not out[y, x]: out[y, x] = True; q.append((y, x))
	for x in range(w):
		for y in (0, h - 1):
			if not m[y, x] and not out[y, x]: out[y, x] = True; q.append((y, x))
	while q:
		y, x = q.popleft()
		for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
			if 0 <= yy < h and 0 <= xx < w and not m[yy, xx] and not out[yy, xx]:
				out[yy, xx] = True; q.append((yy, xx))
	return ~out


def otsu(v):
	h, e = np.histogram(v, 256); c = ( e[:-1] + e[1:] ) / 2; w0 = np.cumsum(h); w1 = w0[-1] - w0
	m0 = np.cumsum(h * c) / np.maximum(w0, 1); m1 = ( ( h * c ).sum() - np.cumsum(h * c) ) / np.maximum(w1, 1)
	return c[np.argmax(w0 * w1 * ( m0 - m1 ) ** 2)]


def bust_mask(img, depth, normal, valid):
	"""The bust: what differs from the backdrop in colour (background_mask: misses white plaster on a
	light backdrop) or lies in front of it (MoGe's depth, Otsu's split: may split the head from the
	chest), less the floor (facing up, in the lower 40 %), the largest blob, its holes filled."""
	from scipy import ndimage
	H, W = depth.shape
	ok = valid & np.isfinite(depth)
	m = ( background_mask(img) | ( depth < otsu(depth[ok]) ) ) & ok
	rows = np.arange(H)[:, None].repeat(W, 1)
	m &= ~ ( ( normal[..., 1] < - 0.7 ) & ( rows > 0.6 * H ) )
	m = ndimage.binary_opening(m, iterations=2)
	lab, k = ndimage.label(m)
	if k: m = lab == 1 + int(np.argmax(ndimage.sum(m, lab, range(1, k + 1))))
	return ndimage.binary_fill_holes(m)


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('photo'); ap.add_argument('out')
	ap.add_argument('--moge', required=True, help='the MoGe source (its package is imported from there)')
	ap.add_argument('--model', default='Ruicheng/moge-2-vitl-normal', help='a Hugging Face id, or the checkpoint file (model.pt)')
	ap.add_argument('--tokens', type=int, default=2500)
	a = ap.parse_args()
	sys.path.insert(0, a.moge)
	import torch
	from moge.model.v2 import MoGeModel
	img = np.asarray(Image.open(a.photo).convert('RGB'))
	model = MoGeModel.from_pretrained(a.model).to('cuda').eval()
	with torch.no_grad():
		o = model.infer(torch.tensor(img / 255, dtype=torch.float32, device='cuda').permute(2, 0, 1), num_tokens=a.tokens)
	pts = o['points'].float().cpu().numpy(); nor = o['normal'].float().cpu().numpy(); mm = o['mask'].cpu().numpy().astype(bool)
	m = bust_mask(img, o['depth'].float().cpu().numpy(), nor, mm) & np.isfinite(pts).all(2)
	np.savez_compressed(a.out + '.npz', points=pts.astype(np.float32), normal=nor.astype(np.float32), mask=m)
	z = pts[..., 2]; zl, zh = np.percentile(z[m], [0.5, 99.5])
	dep = np.where(m, np.clip((z - zl) / max(zh - zl, 1e-6), 0, 1), 1)
	prev = np.concatenate([np.repeat((255 * (1 - dep))[..., None], 3, 2), np.where(m[..., None], (nor * [0.5, -0.5, -0.5] + 0.5) * 255, 0)], 1)
	Image.fromarray(prev.astype(np.uint8)).resize((prev.shape[1] // 2, prev.shape[0] // 2)).save(a.out + '-preview.png')
	ext = pts[m].max(0) - pts[m].min(0)
	print(f'{a.out}: mask {m.mean() * 100:.0f} %, extent (camera units) x {ext[0]:.3f} y {ext[1]:.3f} z {ext[2]:.3f}; depth {zl:.3f}..{zh:.3f}', file=sys.stderr)


if __name__ == '__main__':
	main()

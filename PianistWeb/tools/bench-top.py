#!/usr/bin/env python3
"""The bench cushion's tufted top from a photo (MoGe-2), as src/benchtop.js.

MoGe-2 (microsoft/MoGe, Ruicheng/moge-2-vitl-normal, MIT) gives a point map and normals of the
photo. The cushion's top face is the region around SEED: its plane is fitted to the points, then the
region is grown to points near that plane that also face its way. The face is resampled on a grid
in the plane's frame. Its relief comes from MoGe's normals, integrated (Frankot-Chellappa); they are
cleaner than its depth at this scale. The broad shape is removed by a quadratic fit (the plane's
tilt, MoGe's bow); bench.js has its own crown. The buttons are the yellowish blobs, fitted to a
staggered lattice. The relief is centred on the lattice, mirrored both ways and averaged (the photo's
light and noise are not symmetric, the tufting is), then kept as one quadrant: centre to edge, in
fractions of the face's half sizes. Heights are in units of the face's width; bench.js scales them to
its own cushion.

Writes src/benchtop.js: the quadrant as uint8 (base64) with its range, and the buttons in fractions.

  .venv-depth/bin/python tools/bench-top.py <photo> --moge <MoGe source dir> --model <moge-2 .pt> [--seed x,y] [--npz cache]
"""
import argparse, base64, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.interpolate import griddata

GRID = 3.0e-3			# the rectified grid's cell (MoGe's units, about metres)
TABLE = ( 128, 64 )		# the quadrant kept: columns (u, centre -> edge), rows (v)


def moge(photo, src, model, tokens=3600):
	sys.path.insert(0, src)
	import torch
	from moge.model.v2 import MoGeModel
	img = np.asarray(Image.open(photo).convert('RGB'))
	m = MoGeModel.from_pretrained(model).to('cuda').eval()
	with torch.no_grad():
		o = m.infer(torch.tensor(img / 255, dtype=torch.float32, device='cuda').permute(2, 0, 1), num_tokens=tokens)
	return o['points'].float().cpu().numpy().astype(np.float64), o['normal'].float().cpu().numpy().astype(np.float64)


def fit_plane(pts):
	m = pts.mean(0)
	return m, np.linalg.svd(pts - m, full_matrices=False)[2]


def face_region(P, N, seed, dist=0.035, angle=28):
	"""The top face: points near the plane through the seed's neighbourhood, facing its way, connected to the seed."""
	ok = np.isfinite(P).all(2) & np.isfinite(N).all(2)
	sx, sy = seed
	win = ( slice(sy - 40, sy + 40), slice(sx - 60, sx + 60) )
	m, v = fit_plane(P[win][ok[win]])
	for _ in range(3):
		cand = ok & ( np.abs(( ( P - m ) * v[2] ).sum(2)) < dist ) & ( np.abs(( N * v[2] ).sum(2)) > np.cos(np.radians(angle)) )
		lab, _ = ndimage.label(cand)
		reg = lab == lab[sy, sx]
		m, v = fit_plane(P[reg])
	return ndimage.binary_fill_holes(reg), m, v


def integrate(gx, gy, du, dv):
	"""Height from its gradients (Frankot-Chellappa, the grid mirrored to be periodic)."""
	h, w = gx.shape
	GX = np.block([[ gx, - gx[:, ::-1] ], [ gx[::-1], - gx[::-1, ::-1] ]])
	GY = np.block([[ gy, gy[:, ::-1] ], [ - gy[::-1], - gy[::-1, ::-1] ]])
	WX, WY = np.meshgrid(np.fft.fftfreq(2 * w, du) * 2 * np.pi, np.fft.fftfreq(2 * h, dv) * 2 * np.pi)
	den = WX ** 2 + WY ** 2; den[0, 0] = 1
	return np.real(np.fft.ifft2(( - 1j * WX * np.fft.fft2(GX) - 1j * WY * np.fft.fft2(GY) ) / den))[:h, :w]


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('photo')
	ap.add_argument('--moge', help='the MoGe source (its package is imported from there)')
	ap.add_argument('--model', default='Ruicheng/moge-2-vitl-normal')
	ap.add_argument('--seed', default='330,380', help='a pixel on the top face, x,y')
	ap.add_argument('--npz', help="cache of MoGe's output (read if there, else written)")
	ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'src', 'benchtop.js'))
	a = ap.parse_args()
	if a.npz and os.path.exists(a.npz):
		d = np.load(a.npz); P, N = d['points'].astype(np.float64), d['normal'].astype(np.float64)
	else:
		P, N = moge(a.photo, a.moge, a.model)
		if a.npz: np.savez_compressed(a.npz, points=P.astype(np.float32), normal=N.astype(np.float32))
	img = np.asarray(Image.open(a.photo).convert('RGB')).astype(np.float64)
	reg, m, vt = face_region(P, N, tuple(int(v) for v in a.seed.split(',')))
	# the plane's frame: ax along the face's length (image right), ay across, n out (towards the camera)
	ax, n = vt[0], vt[2]
	if n[2] > 0: n = - n
	if ax[0] < 0: ax = - ax
	ay = np.cross(n, ax)
	q = P[reg] - m
	U, V = q @ ax, q @ ay
	u0, u1 = np.percentile(U, [ 0.3, 99.7 ]); v0, v1 = np.percentile(V, [ 0.3, 99.7 ])
	gw, gh = int(( u1 - u0 ) / GRID) + 1, int(( v1 - v0 ) / GRID) + 1
	gu, gv = np.meshgrid(np.linspace(u0, u1, gw), np.linspace(v0, v1, gh))
	nn = N[reg] / np.linalg.norm(N[reg], axis=1, keepdims=True)
	NL = np.stack([ griddata(( U, V ), nn @ e, ( gu, gv ), method='linear') for e in ( ax, ay, n ) ], -1)
	col = np.stack([ griddata(( U, V ), img[reg][:, k], ( gu, gv ), method='linear') for k in range(3) ], -1)
	ok = np.isfinite(NL).all(-1)
	mean = NL[ok].mean(0); mean /= np.linalg.norm(mean)
	NL = np.where(ok[..., None], NL, mean)
	gx, gy = - NL[..., 0] / np.clip(NL[..., 2], 0.3, None), - NL[..., 1] / np.clip(NL[..., 2], 0.3, None)
	Z = integrate(gx - gx[ok].mean(), gy - gy[ok].mean(), ( u1 - u0 ) / ( gw - 1 ), ( v1 - v0 ) / ( gh - 1 ))
	# less the broad form: a quadratic in u, v (over the face)
	X, Y = ( gu - gu.mean() ) / ( u1 - u0 ), ( gv - gv.mean() ) / ( v1 - v0 )
	A = np.stack([ np.ones_like(X), X, Y, X * X, X * Y, Y * Y ], -1)
	coef, *_ = np.linalg.lstsq(A[ok], Z[ok], rcond=None)
	Z = Z - A @ coef
	# the buttons: yellowish blobs on the white leather
	C = np.nan_to_num(col)
	yl = ndimage.gaussian_filter(C[..., 0] + C[..., 1] - 2 * C[..., 2], 1.5)
	lab, k = ndimage.label(yl > np.percentile(yl[ok], 99.0))
	cs = np.array(ndimage.center_of_mass(yl, lab, range(1, k + 1)))[ ndimage.sum(np.ones_like(yl), lab, range(1, k + 1)) > 8 ]
	B = np.stack([ gu[0, 0] + cs[:, 1] * ( u1 - u0 ) / ( gw - 1 ), gv[0, 0] + cs[:, 0] * ( v1 - v0 ) / ( gh - 1 ) ], 1)
	# the lattice: rows (v) and, in each, columns a step apart, the odd rows half a step over
	rows = np.round(( B[:, 1] - B[:, 1].mean() ) / ( np.ptp(B[:, 1]) / 2 )).astype(int)
	order = np.argsort(B[:, 0]); step = np.median(np.diff(np.sort(B[ rows == 0, 0 ])))
	cols = np.round(( B[:, 0] - B[ rows == 0, 0 ].mean() ) / ( step / 2 )).astype(int)
	L = np.stack([ np.ones(len(B)), cols / 2, rows ], 1)
	sol, *_ = np.linalg.lstsq(L, B, rcond=None)
	centre, a_, b_ = sol
	res = np.sqrt(( ( B - L @ sol ) ** 2 ).sum(1).mean())
	# the face's half sizes about the lattice's centre: its nearer edges
	hu = min(centre[0] - u0, u1 - centre[0]); hv = min(centre[1] - v0, v1 - centre[1])
	# the quadrant, mirrored four ways and averaged (fractions of the half sizes)
	fu, fv = np.meshgrid(np.linspace(0, 1, TABLE[0]), np.linspace(0, 1, TABLE[1]))
	pts = np.stack([ gu[ok], gv[ok] ], 1)
	quad = []
	for su in ( 1, - 1 ):
		for sv in ( 1, - 1 ):
			quad.append(griddata(pts, Z[ok], ( centre[0] + su * fu * hu, centre[1] + sv * fv * hv ), method='linear'))
	T = np.nanmean(np.stack(quad), 0)
	T = np.where(np.isfinite(T), T, np.nanmedian(T)) / ( 2 * hu )		# (heights in face widths)
	# the buttons in fractions of the half sizes, symmetrised: one per column offset and row
	bt = sorted({ ( round(float(abs(c) / 2 * step / hu), 4), round(float(abs(r) * abs(b_[1]) / hv), 4) ) for c, r in zip(cols, rows) })
	lo, hi = float(T.min()), float(T.max())
	q8 = np.round(( T - lo ) / ( hi - lo ) * 255).astype(np.uint8)
	out = {
		'source': os.path.basename(a.photo), 'size': list(TABLE), 'min': round(lo, 6), 'max': round(hi, 6),
		'aspect': round(hu / hv, 4), 'buttons': [ list(p) for p in bt ], 'data': base64.b64encode(q8.tobytes()).decode(),
	}
	with open(a.out, 'w') as f:
		f.write('// Generated by tools/bench-top.py (do not edit): the bench cushion\'s tufted top, measured from a photo\n'
			'// (MoGe-2). `data`: the relief\'s quadrant, uint8 rows (v, from the centre to the edge) of\n'
			'// size[ 0 ] columns (u), in [ min, max ] face widths; `buttons`: [ u, v ] in fractions of the half\n'
			'// sizes (each mirrored); `aspect`: the photo\'s face, half length / half depth.\n')
		f.write('export const BENCH_TOP = ' + json.dumps(out) + ';\n')
	print(f'face {2 * hu:.3f} x {2 * hv:.3f} (MoGe units, aspect {hu / hv:.2f}); {len(B)} buttons, lattice residual {res * 1000:.1f} mm; '
		f'relief {( hi - lo ) * 2 * hu * 1000:.1f} mm (MoGe units); {len(bt)} button places per quadrant: {bt}; -> {a.out}', file=sys.stderr)


if __name__ == '__main__':
	main()

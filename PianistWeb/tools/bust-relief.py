#!/usr/bin/env python3
"""A bust's mesh from its MoGe geometry (tools/bust-depth.py's <name>.npz).

The point map on a grid of ROWS rows over the bust (the mask's box), a quad where its four
corners are on the bust and no depth jump (> JUMP cells) between them; the bust's frame: x right,
y up, z out of the front (the camera's -z), scaled to `--height` metres, the origin at the middle
of its base (y 0 the lowest point, x and z the middle of the extent); its outline smoothed along its loop and swept back to a
flat back (the wall behind: never seen). UVs: the photo's (u along x, v up). Normals: an
object-space normal map (MoGe's, in the bust's frame) at the photo's resolution / 2.

Writes <out>.json (positions, uvs, indices: base64 float32 / uint32; the bust's size) and
<out>-normal.png (object space: rgb = n / 2 + 0.5).

  .venv-depth/bin/python tools/bust-relief.py <name>.npz <out prefix> [--height 0.55] [--rows 160]
"""
import argparse, base64, json, sys
import numpy as np
from PIL import Image

JUMP = 40.0			# a quad's depth range over this many cells' size: a cut (a real overhang); below it the
					# fold stays connected (cut at every fold, the outline's sweep made terraces of them)


def relief(P, N, M, height=0.55, rows=160, jump=JUMP, smooth=12, zblur=2.0):
	"""The mesh and normal map from MoGe's points (H, W, 3), normals (H, W, 3) and mask (H, W):
	{ verts (n, 3), uv (n, 2), tris (m, 3), normal (PIL image), cell, rim }."""
	from types import SimpleNamespace
	a = SimpleNamespace(height=height, rows=rows, jump=jump, smooth=smooth, zblur=zblur)
	H, W = M.shape
	# the mask a little eroded (the rim's points are the least sure)
	m = M.copy()
	for _ in range(2): m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
	ys, xs = np.nonzero(m)
	y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
	step = (y1 - y0) / a.rows
	gy = np.clip(np.round(y0 + np.arange(a.rows + 1) * step).astype(int), 0, H - 1)
	cols = int(np.ceil((x1 - x0) / step))
	gx = np.clip(np.round(x0 + np.arange(cols + 1) * step).astype(int), 0, W - 1)
	S = P[np.ix_(gy, gx)].astype(np.float64)
	V = m[np.ix_(gy, gx)] & np.isfinite(S).all(2)
	# the bust's frame (camera: x right, y down, z forward)
	L = np.stack([S[..., 0], - S[..., 1], - S[..., 2]], -1)
	pts = L[V]
	scale = a.height / (pts[:, 1].max() - pts[:, 1].min())
	org = np.array([( pts[:, 0].max() + pts[:, 0].min() ) / 2, pts[:, 1].min(), ( pts[:, 2].max() + pts[:, 2].min() ) / 2])
	L = ( L - org ) * scale
	# the depth smoothed over the bust (`--zblur` cells, within it only): the geometry's broad form;
	# its detail is the normal map's (a single view's depth has cliffs where a curl hides the next:
	# seen from the side they stack like slabs)
	if a.zblur > 0:
		from scipy.ndimage import gaussian_filter
		w = V.astype(np.float64); z = np.where(V, L[..., 2], 0)
		zs = gaussian_filter(z, a.zblur) / np.maximum(gaussian_filter(w, a.zblur), 1e-6)
		L[..., 2] = np.where(V, zs, L[..., 2])
	# a cell's size: the median distance between grid neighbours
	dx = np.linalg.norm(L[:, 1:] - L[:, :-1], axis=2)[V[:, 1:] & V[:, :-1]]
	cell = float(np.median(dx))
	idx = - np.ones(V.shape, np.int64)
	idx[V] = np.arange(V.sum())
	verts = L[V]
	uv = np.stack([gx[None, :].repeat(len(gy), 0)[V] / ( W - 1 ), 1 - gy[:, None].repeat(len(gx), 1)[V] / ( H - 1 )], -1)
	tris = []
	for r in range(len(gy) - 1):
		for c in range(len(gx) - 1):
			q = [ idx[r, c], idx[r, c + 1], idx[r + 1, c + 1], idx[r + 1, c] ]
			if min(q) < 0: continue
			z = verts[q, 2]
			if z.max() - z.min() > a.jump * cell: continue
			# (grid rows go down the photo: counter-clockwise seen from the front is a, d, c / a, c, b)
			tris += [ ( q[0], q[3], q[2] ), ( q[0], q[2], q[1] ) ]
	tris = np.array(tris, np.int64)
	# the rim: edges with one triangle; the outline smoothed along its loop first (the grid makes it a
	# staircase, and each step swept back is a terrace seen from the side), then swept back to a flat
	# back behind the deepest point
	from collections import Counter, defaultdict
	e = Counter()
	for t in tris:
		for i in range(3): e[tuple(sorted(( t[i], t[( i + 1 ) % 3] )))] += 1
	nxt, prv = defaultdict(list), defaultdict(list)
	for t in tris:
		for i in range(3):
			a_, b_ = t[i], t[( i + 1 ) % 3]
			if e[tuple(sorted(( a_, b_ )))] == 1: nxt[a_].append(b_); prv[b_].append(a_)
	loop = [ v for v in nxt if len(nxt[v]) == 1 and len(prv[v]) == 1 ]		# (pinch points: left as they are)
	for _ in range(a.smooth):
		new = { v: 0.5 * verts[v] + 0.25 * ( verts[nxt[v][0]] + verts[prv[v][0]] ) for v in loop }
		for v, q in new.items(): verts[v] = q
	back_z = verts[:, 2].min() - 0.01
	rim = {}
	extra_v, extra_uv, extra_t = [], [], []
	for t in tris:
		for i in range(3):
			a_, b_ = t[i], t[( i + 1 ) % 3]
			if e[tuple(sorted(( a_, b_ )))] != 1: continue
			for v in ( a_, b_ ):
				if v not in rim:
					rim[v] = len(verts) + len(extra_v); extra_v.append([ verts[v, 0], verts[v, 1], back_z ]); extra_uv.append(uv[v])
			# the edge a->b as its triangle has it: the skirt b, a, a', then b, a', b' (facing out)
			extra_t += [ ( b_, a_, rim[a_] ), ( b_, rim[a_], rim[b_] ) ]
	verts = np.concatenate([ verts, np.array(extra_v).reshape(- 1, 3) ])
	uv = np.concatenate([ uv, np.array(extra_uv).reshape(- 1, 2) ])
	tris = np.concatenate([ tris, np.array(extra_t, np.int64).reshape(- 1, 3) ])
	# the object-space normal map (the bust's frame), half the photo's size
	n = np.stack([ N[..., 0], - N[..., 1], - N[..., 2] ], -1)
	n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-9
	n[ ~ M ] = [ 0, 0, 1 ]
	nimg = Image.fromarray(np.round(( n * 0.5 + 0.5 ) * 255).clip(0, 255).astype(np.uint8)).resize(( W // 2, H // 2 ), Image.LANCZOS)
	return dict(verts=verts, uv=uv, tris=tris, normal=nimg, cell=cell, rim=len(extra_t))


def write(r, out):
	"""<out>.json (positions, uvs, indices: base64 float32 / uint32; the size) and <out>-normal.png."""
	r['normal'].save(out + '-normal.png')
	b64 = lambda x: base64.b64encode(np.ascontiguousarray(x).tobytes()).decode()
	ext = r['verts'].max(0) - r['verts'].min(0)
	json.dump({ 'positions': b64(r['verts'].astype(np.float32)), 'uvs': b64(r['uv'].astype(np.float32)), 'indices': b64(r['tris'].astype(np.uint32)),
		'vertices': len(r['verts']), 'triangles': len(r['tris']), 'size': [ round(float(v), 4) for v in ext ], 'cell': round(r['cell'], 5) }, open(out + '.json', 'w'))
	return f'{len(r["verts"])} vertices, {len(r["tris"])} triangles ({r["rim"]} in the rim); {ext[0]:.3f} x {ext[1]:.3f} x {ext[2]:.3f} (w x h x d), cell {r["cell"] * 1000:.1f} mm'


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('npz'); ap.add_argument('out')
	ap.add_argument('--height', type=float, default=0.55)
	ap.add_argument('--rows', type=int, default=160)
	ap.add_argument('--jump', type=float, default=JUMP)
	ap.add_argument('--smooth', type=int, default=12, help='passes smoothing the outline along its loop')
	ap.add_argument('--zblur', type=float, default=2.0, help='the depth smoothed over this many cells (sigma)')
	a = ap.parse_args()
	d = np.load(a.npz)
	r = relief(d['points'], d['normal'], d['mask'], a.height, a.rows, a.jump, a.smooth, a.zblur)
	print(f'{a.out}: {write(r, a.out)}', file=sys.stderr)


if __name__ == '__main__':
	main()

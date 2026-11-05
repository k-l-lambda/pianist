#!/usr/bin/env python3
"""Lightmap UVs for Luminara's static shell (xatlas, MIT): tools/luminara-bake.mjs's export of its
meshes (world space, triangle soups) in, each welded by position (its connectivity: xatlas cuts its
charts at creases itself; welded by normal too, a flat-shaded surface fell apart into a chart per
triangle) and all unwrapped into one atlas, out: each triangle's corners keep their own normal and uv
(non-indexed), with its uvBake.

  .venv-depth/bin/python -I tools/luminara-unwrap.py <in.json> <out.json> [--size 1024] [--texels 40]

in: [ { i, name, position, normal, uv (base64 float32) } ]; out: the same with index (uint32),
uvBake (float32, 0..1 over the atlas) and the atlas' size and texels per metre. If the shell does not
fit one atlas of --size at --texels per metre, the density is lowered until it does.
"""
import argparse, base64, json, sys
import numpy as np
import xatlas


def dec(s, dt): return np.frombuffer(base64.b64decode(s), dtype=dt)
def enc(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def weld(P):
	_, first, inv = np.unique(np.round(P * 2000).astype(np.int64), axis=0, return_index=True, return_inverse=True)
	return P[first], inv.reshape(-1).astype(np.uint32)


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('inp'); ap.add_argument('out')
	ap.add_argument('--size', type=int, default=1024)
	ap.add_argument('--texels', type=float, default=40)
	a = ap.parse_args()
	meshes = json.load(open(a.inp))
	welded = []
	for m in meshes:
		P = dec(m['position'], np.float32).reshape(-1, 3); N = dec(m['normal'], np.float32).reshape(-1, 3); U = dec(m['uv'], np.float32).reshape(-1, 2)
		p, idx = weld(P.astype(np.float64))
		tri = idx.reshape(-1, 3)
		keep = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])		# (degenerate after welding: dropped)
		welded.append((m, p.astype(np.float32), tri[keep].astype(np.uint32), P.reshape(-1, 3, 3)[keep], N.reshape(-1, 3, 3)[keep], U.reshape(-1, 3, 2)[keep]))
		print(f"{m['name']}: {len(P)} -> {len(p)} vertices, {keep.sum()} triangles", file=sys.stderr)
	texels = a.texels
	while True:
		atlas = xatlas.Atlas()
		for _, p, tri, *_ in welded: atlas.add_mesh(p, tri)
		co = xatlas.ChartOptions(); co.max_iterations = 2
		# (no fixed resolution: one atlas, sized to fit the charts at this density; too big: lower it)
		po = xatlas.PackOptions(); po.padding = 2; po.texels_per_unit = texels; po.bilinear = True; po.blockAlign = False
		atlas.generate(co, po)
		if atlas.atlas_count == 1 and atlas.width <= a.size and atlas.height <= a.size: break
		print(f'{texels:.1f} texels/m: {atlas.atlas_count} atlases, {atlas.width}x{atlas.height}: lower', file=sys.stderr)
		texels *= 0.92 * min(1.0, a.size / max(atlas.width, atlas.height)) ** 0.5
	out = []
	for k, ( m, p, tri, cP, cN, cU ) in enumerate(welded):
		vmap, ind, uvs = atlas[k]
		uvs = uvs * np.array([ atlas.width / a.size, atlas.height / a.size ], np.float32)		# (xatlas: 0..1 over its own size; ours: over the whole --size map)
		ind = ind.reshape(-1, 3)
		assert len(ind) == len(tri), (len(ind), len(tri))		# (its triangles in our order)
		nv = 3 * len(ind)
		out.append({ 'i': m['i'], 'name': m['name'], 'position': enc(cP.reshape(-1, 3).astype(np.float32)), 'normal': enc(cN.reshape(-1, 3).astype(np.float32)), 'uv': enc(cU.reshape(-1, 2).astype(np.float32)),
			'uvBake': enc(uvs[ind.reshape(-1)].astype(np.float32)), 'index': enc(np.arange(nv, dtype=np.uint32)) })
	json.dump({ 'size': a.size, 'texels': round(texels, 2), 'utilization': round(float(np.mean(atlas.utilization)), 3), 'meshes': out }, open(a.out, 'w'))
	print(f'atlas {atlas.width}x{atlas.height} of {a.size}, {texels:.1f} texels/m, {atlas.chart_count} charts, utilisation {float(np.mean(atlas.utilization)):.2f}', file=sys.stderr)


if __name__ == '__main__':
	main()

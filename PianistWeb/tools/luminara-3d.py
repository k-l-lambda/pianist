#!/usr/bin/env python3
"""Luminara's furniture as whole meshes: TRELLIS (microsoft/TRELLIS, TRELLIS-image-large; code and
weights MIT) on tools/luminara-gen.mjs's product photos.

Each <generated>/<slug>-raw.jpg: cut out (rembg u2net, the white backdrop away; kept as
<slug>-rgba.png for a look), then TRELLIS's mesh decoder (its FlexiCubes surface with the decoder's
vertex colour) -> <generated>/<slug>-trellis.glb: y up, about 1 unit across, untextured, the
colour per vertex (tools/luminara-asset.mjs simplifies it, sizes it and makes its materials).

  .venv-trellis/bin/python PianistWeb/tools/luminara-3d.py <generated dir> --trellis <TRELLIS dir> [slug ...] [--seed 1] [--force]
<TRELLIS dir>: where trellis_load.py, TRELLIS/ (source) and trellis-weights/ are (Footages.local/tools).
"""
import argparse, json, os, sys, time

OBJECTS = [ 'egg-chair', 'sofa', 'side-table', 'plant' ]


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('generated')
	ap.add_argument('slugs', nargs='*')
	ap.add_argument('--trellis', required=True)
	ap.add_argument('--seed', type=int, default=1)
	ap.add_argument('--force', action='store_true')
	ap.add_argument('--views', action='store_true', help="also <slug>-view1-raw.jpg, ... (tools/luminara-gen.mjs crop views): TRELLIS's multi-image conditioning, the main photo first (its front: +z)")
	ap.add_argument('--key', action='store_true', help="also keep what differs from the backdrop's colour (rembg drops white or pale parts on a plain backdrop: a marble base, silver-green leaves)")
	a = ap.parse_args()
	os.environ.setdefault('TORCH_HOME', os.path.join(a.trellis, 'trellis-weights', 'torch-hub'))
	os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
	sys.path.insert(0, a.trellis)
	import trellis_load		# (TRELLIS without its text pipeline and renderers)
	from trellis_load import TrellisImageTo3DPipeline
	import numpy as np, torch, trimesh, rembg
	from PIL import Image

	todo = [ s for s in ( a.slugs or OBJECTS ) if a.force or not os.path.exists(os.path.join(a.generated, f'{s}-trellis.glb')) ]
	if not todo: print('nothing to do', file=sys.stderr); return
	session = rembg.new_session('u2net')
	pipe = TrellisImageTo3DPipeline.from_pretrained(os.path.join(a.trellis, 'trellis-weights', 'TRELLIS-image-large'))
	pipe.cuda()
	stats_file = os.path.join(a.generated, 'trellis-stats.json')
	stats = json.load(open(stats_file)) if os.path.exists(stats_file) else {}
	def cutout(name, s):
		img = Image.open(os.path.join(a.generated, f'{name}-raw.jpg')).convert('RGB')
		img = img.resize(( 1024, 1024 ), Image.Resampling.LANCZOS)
		cut = rembg.remove(img, session=session)
		if a.key:		# rembg's mask, and what is not the backdrop's colour (the border's median), its largest blob, holes filled
			from scipy import ndimage
			px = np.asarray(img).astype(np.float32)
			border = np.concatenate([ px[0], px[-1], px[:, 0], px[:, -1] ])
			key = np.linalg.norm(px - np.median(border, 0), axis=2) > 34
			lab, n = ndimage.label(key)
			if n:
				key = lab == 1 + np.argmax(ndimage.sum(key, lab, range(1, n + 1)))
			key = ndimage.binary_fill_holes(ndimage.binary_opening(key, iterations=2))
			al = np.maximum(np.asarray(cut)[..., 3], ( key * 255 ).astype(np.uint8))
			cut = Image.fromarray(np.dstack([ np.asarray(img), al ]))
		cut.save(os.path.join(a.generated, f'{name}-rgba.png'))
		return cut

	for s in todo:
		cut = cutout(s, s)
		views = []
		if a.views:
			k = 1
			while os.path.exists(os.path.join(a.generated, f'{s}-view{k}-raw.jpg')):
				views.append(cutout(f'{s}-view{k}', s)); k += 1
		torch.cuda.reset_peak_memory_stats(); t = time.time()
		out = pipe.run_multi_image([ cut, *views ], seed=a.seed, formats=[ 'mesh' ], mode='stochastic') if views else pipe.run(cut, seed=a.seed, formats=[ 'mesh' ])
		torch.cuda.synchronize(); dt = time.time() - t
		m = out['mesh'][0]
		v = m.vertices.detach().cpu().numpy() @ np.array([ [ 1, 0, 0 ], [ 0, 0, - 1 ], [ 0, 1, 0 ] ])		# (z up -> y up, as TRELLIS's to_glb)
		f = m.faces.detach().cpu().numpy()
		c = m.vertex_attrs[:, :3].detach().float().clamp(0, 1).cpu().numpy()
		trimesh.Trimesh(v, f, vertex_colors=( c * 255 ).round().astype(np.uint8), process=False).export(os.path.join(a.generated, f'{s}-trellis.glb'))
		stats[s] = { 'views': 1 + len(views), 'seconds': round(dt, 1), 'peak_vram_gb': round(torch.cuda.max_memory_allocated() / 2 ** 30, 2), 'triangles': int(len(f)),
			'extent': [ round(float(x), 3) for x in v.max(0) - v.min(0) ], 'seed': a.seed }
		print(s, json.dumps(stats[s]), file=sys.stderr)
		json.dump(stats, open(stats_file, 'w'), indent=1)


if __name__ == '__main__':
	main()

#!/usr/bin/env python3
"""All the busts' meshes (tools/hall-asset.mjs packs them): for each <generated>/busts/<slug>-raw.jpg
(tools/bust-gen.mjs), MoGe-2 (tools/bust-depth.py's) and the relief (tools/bust-relief.py's) at a
height of 1 (the packer scales it to its place) -> <generated>/busts/relief/<slug>.json and
<slug>-normal.png. MoGe is loaded once; a relief already there is kept (--force for new ones).

  .venv-depth/bin/python tools/bust-batch.py --generated <dir> --moge <MoGe source> --model <model.pt> [--only a,b] [--force]
"""
import argparse, os, sys, time
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
depth = import_module('bust-depth'); rel = import_module('bust-relief')


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('--generated', required=True); ap.add_argument('--moge', required=True); ap.add_argument('--model', required=True)
	ap.add_argument('--only'); ap.add_argument('--force', action='store_true'); ap.add_argument('--tokens', type=int, default=2500)
	a = ap.parse_args()
	src = os.path.join(a.generated, 'busts'); out = os.path.join(src, 'relief'); os.makedirs(out, exist_ok=True)
	slugs = sorted(f[:-8] for f in os.listdir(src) if f.endswith('-raw.jpg'))
	if a.only: slugs = [ s for s in slugs if s in a.only.split(',') ]
	todo = [ s for s in slugs if a.force or not os.path.exists(os.path.join(out, s + '.json')) ]
	print(f'{len(slugs)} photos, {len(todo)} to do', file=sys.stderr)
	if not todo: return
	sys.path.insert(0, a.moge)
	import torch
	from moge.model.v2 import MoGeModel
	model = MoGeModel.from_pretrained(a.model).to('cuda').eval()
	for s in todo:
		t0 = time.time()
		img = np.asarray(Image.open(os.path.join(src, s + '-raw.jpg')).convert('RGB'))
		with torch.no_grad():
			o = model.infer(torch.tensor(img / 255, dtype=torch.float32, device='cuda').permute(2, 0, 1), num_tokens=a.tokens)
		P = o['points'].float().cpu().numpy(); N = o['normal'].float().cpu().numpy()
		M = depth.bust_mask(img, o['depth'].float().cpu().numpy(), N, o['mask'].cpu().numpy().astype(bool)) & np.isfinite(P).all(2)
		try:
			r = rel.relief(P, N, M, height=1.0)
			print(f'{s}: {rel.write(r, os.path.join(out, s))} ({time.time() - t0:.0f} s)', file=sys.stderr)
		except Exception as e:
			print(f'{s}: FAILED {e}', file=sys.stderr)


if __name__ == '__main__':
	main()

#!/usr/bin/env python3
"""Comparison sheets for the offline render's four changes (src/offline.js, tools/render-video.mjs), from
tools/render-quality.sh's renders.

	python3 tools/render-quality.py <renders dir> [sheets dir, default <renders dir>/sheets]


Pre-encode frames: <name>-<win>/<frame>.png (8-bit, or 16-bit for bits10). Encoded: <name>-<win>/clip.mp4,
decoded here as a player would (BT.709 limited range for the tagged clips; for the legacy untagged clip
both readings are measured).
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

Q = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else sys.exit('usage: render-quality.py <renders dir> [sheets dir]')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(Q, 'sheets')
os.makedirs(OUT, exist_ok=True)
W, H = 1280, 720
font = ImageFont.load_default()
try:
	font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
	small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except OSError:
	small = font


def png(name, win, frame):
	"""A pre-encode frame, float 0..1."""
	im = Image.open(os.path.join(Q, f'{name}-{win}', f'{frame:05d}.png'))
	a = np.asarray(im)
	if a.ndim == 3 and a.shape[2] == 4: a = a[..., :3]		# (the legacy capture's PNGs: RGBA from the canvas)
	return a.astype(np.float64) / (65535.0 if a.dtype == np.uint16 else 255.0)


def decoded(name, win, index, matrix='bt709'):
	"""Frame `index` of the clip, decoded to 16-bit RGB with `matrix`, float 0..1."""
	clip = os.path.join(Q, f'{name}-{win}', 'clip.mp4')
	vf = f'select=eq(n\\,{index}),scale=in_color_matrix={matrix}:in_range=tv:flags=accurate_rnd+full_chroma_int,format=rgb48le'
	raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
	return np.frombuffer(raw, np.uint16).reshape(H, W, 3).astype(np.float64) / 65535.0


def to8(a):
	return Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8))


def crop(a, box, zoom=1, nearest=True):
	x, y, w, h = box
	im = to8(a[y:y + h, x:x + w])
	return im.resize((w * zoom, h * zoom), Image.NEAREST if nearest else Image.LANCZOS) if zoom != 1 else im


def stretch(a, box, lo=None, hi=None):
	"""A crop's contrast stretched to its own range (its steps visible): (a - lo) / (hi - lo), per the luma."""
	x, y, w, h = box
	c = a[y:y + h, x:x + w]
	lum = c @ [0.2126, 0.7152, 0.0722]
	lo = np.percentile(lum, 1) if lo is None else lo
	hi = np.percentile(lum, 99) if hi is None else hi
	return np.clip((c - lo) / max(hi - lo, 1e-6), 0, 1), lo, hi


def sheet(rows, title, file, note=''):
	"""rows: [ ( label, [ ( caption, PIL image ), ... ] ) ]; one row per label, the images side by side."""
	pad, cap = 12, 24
	cw = max(sum(im.width for _, im in ims) + pad * (len(ims) - 1) for _, ims in rows)
	rh = [max(im.height for _, im in ims) + cap for _, ims in rows]
	top = 40 + (22 if note else 0)
	S = Image.new('RGB', (cw + 2 * pad + 150, top + sum(rh) + pad * (len(rows) + 1)), (24, 24, 26))
	d = ImageDraw.Draw(S)
	d.text((pad, 10), title, fill=(235, 235, 235), font=font)
	if note: d.text((pad, 36), note, fill=(170, 170, 170), font=small)
	y = top + pad
	for (label, ims), h in zip(rows, rh):
		d.text((pad, y + cap + 4), label, fill=(210, 210, 210), font=small)
		x = pad + 150
		for c, im in ims:
			d.text((x, y), c, fill=(200, 200, 200), font=small)
			S.paste(im, (x, y + cap))
			x += im.width + pad
		y += h + pad
	S.save(file)
	return file


def steps(a, box):
	"""How banded a smooth crop is: the number of distinct 8-bit-equivalent luma levels along its rows
	that are runs of 6+ equal pixels (flat bands), per row, averaged; and the noise (std of the luma minus
	a 9 px box blur)."""
	x, y, w, h = box
	lum = a[y:y + h, x:x + w] @ [0.2126, 0.7152, 0.0722]
	q = np.round(lum * 1023)
	runs = []
	for r in q:
		n, run = 0, 1
		for i in range(1, len(r)):
			if r[i] == r[i - 1]: run += 1
			else:
				n += run >= 6; run = 1
		runs.append(n + (run >= 6))
	from scipy.ndimage import uniform_filter
	noise = float(np.std(lum - uniform_filter(lum, 9)))
	return float(np.mean(runs)), noise


report = {}

# ---- 1. the resolve, against ground truth: a 32-sub-frame render (each output pixel's box sampled at 128
# jittered points, resolved in linear light, as a camera's pixel integrates light). legacy: drawImage of the
# tone-mapped 8-bit canvas (2x2 box after the tone mapping); box: the same 2x2 box before it (linear);
# linear: the Blackman-Harris window r 1.25 (the default). Errors on the edges (where the resolve matters)
from scipy.ndimage import uniform_filter, gaussian_filter, sobel
L3 = [0.2126, 0.7152, 0.0722]
REF = png('ref', 'still', 10)
A, X, B = png('legacy', 'still', 10), png('box', 'still', 10), png('linear', 'still', 10)
rl = REF @ L3
edge = np.hypot(sobel(rl, 0), sobel(rl, 1)) > 0.08
mask = edge.copy(); mask[-110:, -260:] = False		# (not the watermark)
def err(a): d = np.abs(a - REF)[mask]; return float(d.mean() * 255), float(np.sqrt((d ** 2).mean()) * 255)
report['resolve'] = {'edge_pixels': int(mask.sum()), 'legacy (2x2 box, sRGB 8-bit, after tone mapping)': err(A), 'box (2x2 box, linear, before)': err(X), 'linear BH r1.25 (default)': err(B),
	'mean_luma': {k: float((v @ L3).mean()) for k, v in [('ref', REF), ('legacy', A), ('box', X), ('linear', B)]}}
d = np.abs(A - REF).sum(2) * mask
score = uniform_filter(d, 96)
boxes = []
for _ in range(3):
	yx = np.unravel_index(np.argmax(score), score.shape)
	cy, cx = int(np.clip(yx[0], 48, H - 48)), int(np.clip(yx[1], 48, W - 48))
	boxes.append((cx - 48, cy - 48, 96, 96))
	score[max(0, cy - 160):cy + 160, max(0, cx - 160):cx + 160] = -1
rows = [(f'({b[0]},{b[1]}) 4x', [('legacy', crop(A, b, 4)), ('box, linear', crop(X, b, 4)), ('BH r1.25, linear', crop(B, b, 4)), ('reference (128 samples/px)', crop(REF, b, 4))]) for b in boxes]
full = to8(REF).resize((W // 2, H // 2), Image.LANCZOS)
dd = ImageDraw.Draw(full)
for b in boxes: dd.rectangle([b[0] // 2, b[1] // 2, (b[0] + b[2]) // 2, (b[1] + b[3]) // 2], outline=(255, 80, 60), width=2)
R = report['resolve']
sheet([('where', [('reference frame (the crops: red)', full)])] + rows, '1. Supersample resolve: linear light before the tone mapping, against the old 8-bit sRGB drawImage',
	os.path.join(OUT, '1-resolve.png'), 'Error on edge pixels vs the reference (mean/RMS, /255): legacy {:.2f}/{:.2f}, box linear {:.2f}/{:.2f}, BH linear {:.2f}/{:.2f}'.format(
		*R['legacy (2x2 box, sRGB 8-bit, after tone mapping)'], *R['box (2x2 box, linear, before)'], *R['linear BH r1.25 (default)']))

# ---- 2. banding: a smooth gradient of the room (the wall, the dome), the clips decoded as a player
# would, grey (luma), stretched alike. The band error: what survives a small blur (dither's noise does not,
# bands do) against the 10-bit pre-encode frame, blurred alike
idx = 5		# (a P-frame mid-clip, not the first I-frame)
src = png('bits10', 'still', 5 + idx)		# (10 bits, dithered: blurred, as near continuous as we have)
lum = src @ L3
hf = np.abs(lum - gaussian_filter(lum, 3))
g = np.hypot(*np.gradient(gaussian_filter(lum, 6)))
score = uniform_filter(hf, 120) * 40 + uniform_filter((lum < 0.15) + (lum > 0.9), 120) * 9 - np.minimum(uniform_filter(g, 120), 0.004) * 400
score[:70], score[-70:], score[:, :110], score[:, -110:] = 99, 99, 99, 99
yx = np.unravel_index(np.argmin(score), score.shape)
bb = (int(yx[1]) - 100, int(yx[0]) - 60, 200, 120)
x0, y0, w0, h0 = bb
smooth = gaussian_filter(lum, 2)[y0:y0 + h0, x0:x0 + w0]
lo, hi = np.percentile(smooth, 0.5), np.percentile(smooth, 99.5)
def band(a):
	l = a @ L3
	e = gaussian_filter(l, 2)[y0:y0 + h0, x0:x0 + w0] - smooth
	return float(np.sqrt(np.mean( ( e - e.mean() ) ** 2 )) * 1023)		# (its mean out: a colour shift is not a band)
def grey(a):
	l = (a @ L3)[y0:y0 + h0, x0:x0 + w0]
	return Image.fromarray(np.clip(np.round((l - lo) / (hi - lo) * 255), 0, 255).astype(np.uint8)).resize((w0 * 2, h0 * 2), Image.NEAREST)
# encoder variants of the same pre-encode frames: x264 grain tuning (keeps the dither), and the sizes
def encode(name, out, args, pix):
	src_dir = os.path.join(Q, f'{name}-still')
	subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', '25', '-start_number', '5', '-i', os.path.join(src_dir, '%05d.png'), '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int',
		*args, '-pix_fmt', pix, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', os.path.join(Q, out)], check=True)
os.makedirs(os.path.join(Q, 'grain-still'), exist_ok=True)
encode('dither', 'grain-still/clip.mp4', ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'grain'], 'yuv420p')
clips = [('legacy', 'old: 8-bit, no dither, BT.601 untagged'), ('linear', 'new 8-bit, no dither'), ('dither', 'new 8-bit + dither (x264 crf 18)'), ('grain', 'new 8-bit + dither, x264 -tune grain'), ('bits10', 'new 10-bit HEVC (crf 20)')]
enc = {n: decoded(n, 'still', idx) for n, _ in clips}
size = {n: os.path.getsize(os.path.join(Q, f'{n}-still', 'clip.mp4')) for n, _ in clips}
report['banding'] = {n: {'band_error_10bit_steps': band(enc[n]), 'clip_kB_10_frames': round(size[n] / 1024)} for n, _ in clips}
report['matrix'] = {
	'legacy read as BT.709 (as players read untagged HD)': float(np.mean(np.abs(enc['legacy'] - png('legacy', 'still', 5 + idx))) * 255),
	'legacy read as BT.601 (what it was)': float(np.mean(np.abs(decoded('legacy', 'still', idx, 'bt470bg') - png('legacy', 'still', 5 + idx))) * 255),
	'new 8-bit, tagged BT.709': float(np.mean(np.abs(enc['dither'] - png('dither', 'still', 5 + idx))) * 255)}
fullb = to8(src).resize((W // 2, H // 2), Image.LANCZOS)
ImageDraw.Draw(fullb).rectangle([x0 // 2, y0 // 2, (x0 + w0) // 2, (y0 + h0) // 2], outline=(255, 80, 60), width=2)
rows = [('where', [('the crop (red)', fullb), ('10-bit pre-encode, blurred: the gradient', grey(np.stack([gaussian_filter(lum, 2)] * 3, -1)))])]
rows += [('decoded', [(f'{c}: {report["banding"][n]["band_error_10bit_steps"]:.2f}', grey(enc[n])) for n, c in clips[:3]]), ('', [(f'{c}: {report["banding"][n]["band_error_10bit_steps"]:.2f}', grey(enc[n])) for n, c in clips[3:]])]
sheet(rows, '2. Banding: dither and 10 bits against the old 8-bit capture (the encoded clips, decoded)',
	os.path.join(OUT, '2-banding.png'), f'Luma, stretched {lo:.3f}..{hi:.3f} alike, 2x nearest. Band error: RMS of the blurred luma vs the blurred 10-bit source, in 10-bit steps (lower: fewer bands)')

# ---- 3. sub-frames: motion blur on the pan, anti-aliasing on the still
P1, P8 = png('dither', 'pan', 50), png('sub8', 'pan', 50)
S1, S8 = png('dither', 'still', 10), png('sub8', 'still', 10)
d = np.abs(S1 - S8).sum(2)
sc = uniform_filter(d, 96); yx = np.unravel_index(np.argmax(sc), sc.shape)
ab = (int(np.clip(yx[1], 48, W - 48)) - 48, int(np.clip(yx[0], 48, H - 48)) - 48, 96, 96)
d2 = np.abs(P1 - P8).sum(2)
sc2 = uniform_filter(d2, 160); yx2 = np.unravel_index(np.argmax(sc2), sc2.shape)
pb = (int(np.clip(yx2[1], 160, W - 160)) - 160, int(np.clip(yx2[0], 100, H - 100)) - 100, 320, 200)
report['subframes'] = {'still_mean_abs_8bit': float(np.mean(np.abs(S1 - S8)) * 255), 'pan_mean_abs_8bit': float(np.mean(np.abs(P1 - P8)) * 255)}
sheet([('pan, whole', [('1 sub-frame', to8(P1).resize((W // 2, H // 2), Image.LANCZOS)), ('8 sub-frames, 180° shutter', to8(P8).resize((W // 2, H // 2), Image.LANCZOS))]),
	('pan, crop 2x', [('1 sub-frame', crop(P1, pb, 2, False)), ('8 sub-frames', crop(P8, pb, 2, False))]),
	('still, crop 4x', [('1 sub-frame (2x2 per pixel)', crop(S1, ab, 4)), ('8 sub-frames jittered (32 per pixel)', crop(S8, ab, 4))])],
	'3. Temporal supersampling: 8 sub-frames across a 180° shutter, the camera jittered between them',
	os.path.join(OUT, '3-subframes.png'), f'Pan at its fastest (frame 50, t 2.0 s) and the still frame 10. Mean |diff| still {report["subframes"]["still_mean_abs_8bit"]:.2f}/255, pan {report["subframes"]["pan_mean_abs_8bit"]:.2f}/255')

# ---- 4. the quality profile (both 8 sub-frames): the floor's mirror, the screen's, the probe, AO
Q1, Q2 = png('sub8', 'still', 10), png('hq', 'still', 10)
d = np.abs(Q1 - Q2).sum(2)
report['hq'] = {'mean_abs_8bit': float(np.mean(np.abs(Q1 - Q2)) * 255)}
sc = uniform_filter(d, 128)
qb = []
for _ in range(2):
	yx = np.unravel_index(np.argmax(sc), sc.shape)
	cy, cx = int(np.clip(yx[0], 64, H - 64)), int(np.clip(yx[1], 64, W - 64))
	qb.append((cx - 64, cy - 64, 128, 128))
	sc[max(0, cy - 200):cy + 200, max(0, cx - 200):cx + 200] = -1
fullq = Image.new('RGB', (W // 2 * 2 + 12, H // 2), (24, 24, 26))
fullq.paste(to8(Q1).resize((W // 2, H // 2), Image.LANCZOS), (0, 0)); fullq.paste(to8(Q2).resize((W // 2, H // 2), Image.LANCZOS), (W // 2 + 12, 0))
dq = ImageDraw.Draw(fullq)
for b in qb:
	for ox in (0, W // 2 + 12): dq.rectangle([ox + b[0] // 2, b[1] // 2, ox + (b[0] + b[2]) // 2, (b[1] + b[3]) // 2], outline=(255, 80, 60), width=2)
sheet([('whole frame', [('default | hq', fullq)])] + [(f'({b[0]},{b[1]}) 3x', [('default', crop(Q1, b, 3, False)), ('hq', crop(Q2, b, 3, False)), ('|difference| x8', crop(np.clip(np.abs(Q1 - Q2) * 8, 0, 1), b, 3))]) for b in qb],
	'4. Offline quality profile (--hq): mirrors at the frame\'s size, a 512 px probe, 32 AO samples',
	os.path.join(OUT, '4-hq.png'), f'Both 8 sub-frames, frame 10 (still). Mean |diff| {report["hq"]["mean_abs_8bit"]:.2f}/255')

json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
print(json.dumps(report, indent=1))

"""Detect the piano's black keys in a frame and fit their arrangement.

A black key seen from above is a dark, elongated blob sitting inside a bright (white keys)
band. We threshold for dark, low-saturation pixels (the reddish floor is saturated, the
walls and keys are bright), keep blobs whose shape and size fit a key top, and then keep
the largest set of blobs whose centroids lie close to one line (the keyboard axis).
"""

import cv2
import numpy as np


def dark_mask(bgr):
	hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
	v = hsv[..., 2].astype(np.float32)
	s = hsv[..., 1]
	# much darker than the wide neighbourhood (the white keys around a black one); a wide blur
	# keeps whole key tops dark instead of only their edges
	blur = cv2.GaussianBlur(v, (0, 0), 25)
	m = ( v < 0.6 * blur ) & ( v < 120 ) & ( s < 90 )
	m = m.astype(np.uint8) * 255
	# cut the thin dark line along the key backs that joins neighbouring keys
	m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
	return m


def split_components(m):
	"""Split touching keys: watershed on the distance transform, seeded by eroded cores."""
	dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
	core = (dist >= 2.0).astype(np.uint8)
	n, markers = cv2.connectedComponents(core, connectivity=4)
	markers = markers + 1
	markers[(m > 0) & (core == 0)] = 0
	img = cv2.cvtColor(255 - cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8), cv2.COLOR_GRAY2BGR)
	markers = cv2.watershed(img, markers.astype(np.int32))
	lab = np.where(m > 0, markers - 1, 0)
	lab[lab < 0] = 0
	return lab


def key_blobs(bgr):
	m = dark_mask(bgr)
	lab = split_components(m)
	ids = np.unique(lab)
	blobs = []
	for i in ids:
		if i == 0:
			continue
		ys, xs = np.nonzero(lab == i)
		area = len(xs)
		if area < 25 or area > 6000:
			continue
		pts = np.stack([xs, ys], 1).astype(np.float32)
		c = pts.mean(0)
		cov = np.cov((pts - c).T)
		ev, evec = np.linalg.eigh(cov)
		if ev[0] <= 0:
			continue
		elong = np.sqrt(ev[1] / ev[0])
		if elong < 1.6 or elong > 12:
			continue
		major = evec[:, 1]
		# fill ratio of the oriented bounding box: key tops are near-rectangular
		proj = (pts - c) @ evec
		ext = proj.max(0) - proj.min(0) + 1
		fill = area / (ext[0] * ext[1])
		if fill < 0.55:
			continue
		blobs.append(dict(c=c, major=major, length=ext[1], width=ext[0], area=area, pts=pts))
	return blobs


def fit_keyboard(blobs, iters=400, tol=None, rng=None):
	"""RANSAC a line through blob centroids; keys are roughly parallel and of similar size."""
	if len(blobs) < 6:
		return None
	rng = rng or np.random.default_rng(0)
	C = np.array([b['c'] for b in blobs])
	W = np.array([b['width'] for b in blobs])
	best = None
	for _ in range(iters):
		i, j = rng.choice(len(blobs), 2, replace=False)
		d = C[j] - C[i]
		L = np.linalg.norm(d)
		if L < 20:
			continue
		d /= L
		nrm = np.array([-d[1], d[0]])
		dist = np.abs((C - C[i]) @ nrm)
		t = tol or 0.6 * np.median(W) + 6
		inl = np.nonzero(dist < t)[0]
		# keys are roughly perpendicular-ish to the axis (not along it)
		ok = [k for k in inl if abs(blobs[k]['major'] @ d) < 0.8]
		if best is None or len(ok) > len(best[0]):
			best = (ok, d)
	if best is None or len(best[0]) < 6:
		return None
	idx, d = best
	# refit the axis with a total least squares line
	P = C[idx]
	c = P.mean(0)
	_, _, vt = np.linalg.svd(P - c)
	d = vt[0]
	order = np.argsort((P - c) @ d)
	return dict(idx=[idx[k] for k in order], axis=d, centre=c)

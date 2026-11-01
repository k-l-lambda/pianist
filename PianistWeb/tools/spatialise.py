#!/usr/bin/env python3
"""Room and stereo for the offline render's sound (tools/render-audio.mjs --room / --stereo).

Input: the dry stems of the page (src/renderaudio.js renderStems: piano stereo without FluidSynth's
reverb and chorus, speech mono) and a pose log (the phone camera every frame, the user's mouth, the
piano's source points, the room). Output: a stereo float WAV from 0 s, the mix before the page's
output stage (master gain -> compressor), which render-audio.mjs sends back through it.

The model, a shoebox room (pyroomacoustics 0.10.1) of the scene's size:
  - sources: the piano as two points on its soundboard (FluidSynth's left channel at the bass end,
    right at the treble end), the speech (the user's lines) at the mouth of the person holding the
    phone (a little above and behind it); omni;
  - microphones on the phone: `ab` two omnis 14 cm apart along the phone's horizontal axis (as a
    phone held sideways records stereo), `mono` one omni at the camera;
  - direct sound per sample (delay r / c, gain 1 / r, cubic interpolation), so the image follows
    the shake and the walk smoothly;
  - early reflections (image sources to order 10, up to ~50 ms) recomputed for the pose every
    `--hop` frames; the input is split into Hann^2 windows (sum 1) between updates, each filtered
    with its pose's reflections and overlap-added, so updates crossfade without clicks;
  - the late tail (ray tracing, from 40-60 ms crossfade on), once at the median pose, for the
    piano (far from the phone); each source gets it at its own level, matched to its image sources
    at the splice, and for `ab` the two channels get the coherence of a diffuse field
    (sinc(2 f d / c)) instead of pyroomacoustics' independent ones.
Each group (piano, speech) is scaled to the RMS of its dry stem, so the mix balance set in the
script stays and only the room and the movement change.

  spatialise.py --piano piano.wav --speech speech.wav --pose pose.json --out room.wav
                [--room living|bare] [--stereo ab|mono] [--hop 2] [--absorption 1] [--report report.json] [--stems PREFIX]
"""
import argparse, json, os, sys, time
from concurrent.futures import ProcessPoolExecutor

os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
import numpy as np
import scipy.signal as ss
import soundfile as sf
import pyroomacoustics as pra

C = 343.0							# m/s, as pyroomacoustics
BANDS = [125, 250, 500, 1000, 2000, 4000]
AB_SPACING = 0.14					# m
EARLY_ORDER = 10					# complete to ~45 ms in this room
SPLICE = (0.040, 0.060)				# s, early -> tail crossfade
SEED = 1

# absorption per octave band; walls after the scene (room.js): the piano against the back wall
# (south, z min), the window with curtains on the right (east, x max). `scale` tunes RT60:
# living T30 ~0.70 s at 500 Hz, ~0.6 s at 1 kHz; bare ~2.0 s (measured, see the report).
ROOMS = {
	'living': dict(scale=0.8, scattering=0.35, walls=dict(
		floor=[0.10, 0.15, 0.25, 0.30, 0.35, 0.35],		# oak boards, a large rug
		ceiling=[0.25, 0.15, 0.08, 0.06, 0.06, 0.06],	# plasterboard on battens
		east=[0.15, 0.25, 0.35, 0.40, 0.45, 0.45],		# window, heavy curtains
		west=[0.15, 0.20, 0.25, 0.25, 0.25, 0.25],		# sofa, cushions
		south=[0.08, 0.10, 0.12, 0.14, 0.15, 0.15],		# plaster behind the piano
		north=[0.15, 0.20, 0.25, 0.30, 0.30, 0.30],		# bookshelf, door
	)),
	'bare': dict(scale=1.0, scattering=0.08, walls=dict(
		floor=[0.15, 0.11, 0.10, 0.07, 0.06, 0.07],		# oak boards
		ceiling=[0.03, 0.03, 0.04, 0.05, 0.05, 0.05],	# plaster
		east=[0.06, 0.05, 0.05, 0.05, 0.05, 0.05],		# plaster + the window glass
		west=[0.03, 0.03, 0.04, 0.05, 0.05, 0.05],
		south=[0.03, 0.03, 0.04, 0.05, 0.05, 0.05],
		north=[0.03, 0.03, 0.04, 0.05, 0.05, 0.05],
	)),
}


ABSORPTION = 1.0					# --absorption: times the room's (shorter RT60 above 1)


def materials(room):
	p = ROOMS[room]
	return {w: pra.Material({'description': w, 'coeffs': list(np.clip(np.array(c) * p['scale'] * ABSORPTION, 0.01, 0.95)), 'center_freqs': BANDS},
	                        {'description': w, 'coeffs': [p['scattering']] * 6, 'center_freqs': BANDS})
	        for w, c in p['walls'].items()}


# ---- geometry: scene (x right, y up, z towards the viewer) -> room (pyroomacoustics: x, y, z up, from 0)

class Geometry:
	def __init__(self, pose):
		r = pose['room']
		self.x0, self.z0 = r['minX'], r['minZ']
		self.dims = [r['maxX'] - r['minX'], r['maxZ'] - r['minZ'], r['height']]

	def __call__(self, p):
		p = np.asarray(p, float)
		return np.stack([p[..., 0] - self.x0, p[..., 2] - self.z0, p[..., 1]], -1)

	def clamp(self, p):		# keep points just inside the walls
		return np.clip(p, 0.02, np.array(self.dims) - 0.02)


def rotate(q, v):
	"""Rotate vectors v (..., 3) by quaternions q (..., 4: x, y, z, w)."""
	u, w = q[..., :3], q[..., 3:4]
	t = 2 * np.cross(u, v)
	return v + w * t + np.cross(u, t)


class Track:
	"""The pose log as functions of time (s): mic positions, the mouth; held before the first frame."""
	def __init__(self, pose, geo, stereo):
		f = pose['frames']
		self.t = np.array([a['t'] for a in f])
		pos = np.array([a['p'] for a in f])
		q = np.array([a['q'] for a in f])
		right = rotate(q, np.array([1.0, 0, 0]))
		offsets = [-AB_SPACING / 2, AB_SPACING / 2] if stereo == 'ab' else [0.0]
		self.mics = [geo.clamp(geo(pos + o * right)) for o in offsets]		# (frames, 3) each
		if all(a.get('mouth') for a in f):
			mouth = np.array([a['mouth'] for a in f])
		else:		# no person: 0.3 m behind and 0.29 m above the phone
			back = rotate(q, np.array([0, 0, 1.0]))
			back[:, 1] = 0
			back /= np.linalg.norm(back, axis=1, keepdims=True) + 1e-9
			mouth = pos + 0.3 * back + [0, 0.29, 0]
		self.mouth = geo.clamp(geo(mouth))

	def at(self, track, t):
		t = np.atleast_1d(t)
		return np.stack([np.interp(t, self.t, track[:, k]) for k in range(3)], -1)


# ---- impulse responses

def rir_pairs(dims, room, order, srcs, mics, fs, ray=False):
	"""RIRs[s][m] for sources and mics (room coordinates); `ray`: hybrid with ray tracing."""
	pra.random.seed(numpy=SEED, libroom=SEED)		# its numpy and C++ (ray tracing) generators: repeatable
	r = pra.ShoeBox(dims, fs=fs, materials=materials(room), max_order=order, air_absorption=True, ray_tracing=ray, use_rand_ism=False)
	if ray:
		r.set_ray_tracing(receiver_radius=0.5, n_rays=30000, energy_thres=1e-7, time_thres=3.5)
	for s in srcs:
		r.add_source(list(s))
	r.add_microphone_array(np.array(mics).T)
	r.compute_rir()
	return [[np.asarray(r.rir[m][s], float) for m in range(len(mics))] for s in range(len(srcs))]


OFFSET = pra.constants.get('frac_delay_length') // 2		# samples: pyroomacoustics' t = 0


def early(args):
	"""Reflections only (the order-0 part removed), from t = 0 (emission), faded out over SPLICE."""
	dims, room, srcs, mics, fs, absorption = args
	global ABSORPTION
	ABSORPTION = absorption		# (in the worker processes too)
	full = rir_pairs(dims, room, EARLY_ORDER, srcs, mics, fs)
	direct = rir_pairs(dims, room, 0, srcs, mics, fs)
	n = int(SPLICE[1] * fs)
	fade = splice_fade(fs, n)
	out = []
	for fs_, ds in zip(full, direct):
		row = []
		for h, d in zip(fs_, ds):
			x = h.copy()
			x[:len(d)] -= d
			x = x[OFFSET:OFFSET + n]
			x = np.pad(x, (0, n - len(x)))
			row.append(x * fade)
		out.append(row)
	return out


def splice_fade(fs, n):
	"""1 before SPLICE[0], cos^2 down to 0 at SPLICE[1] (the early part; the tail gets 1 - this)."""
	t = np.arange(n) / fs
	return np.where(t < SPLICE[0], 1.0, np.cos(np.pi / 2 * np.clip((t - SPLICE[0]) / (SPLICE[1] - SPLICE[0]), 0, 1)) ** 2)


def diffuse_coherence(a, b, fs, d):
	"""Two independent tails -> the pair a diffuse field gives at spacing d (coherence sinc(2 f d / c))."""
	n = len(a)
	A, B = np.fft.rfft(a), np.fft.rfft(b)
	g = np.sinc(2 * np.fft.rfftfreq(n, 1 / fs) * d / C)
	return a, np.fft.irfft(g * A + np.sqrt(np.maximum(0, 1 - g ** 2)) * B, n)


def tails(dims, room, srcs, mics, fs, stereo, early_ref, template=0):
	"""Late tails (from SPLICE[0]) at one pose. The ray tracing is done for one source far from the
	phone (`template`: the piano; a source inside the receiver sphere, as the mouth is, comes out
	wrong); every source gets that tail at its own level, matched to its image sources over SPLICE
	(the late field hardly depends on where the source is)."""
	hyb = rir_pairs(dims, room, 3, [srcs[template]], mics, fs, ray=True)[0]
	row = [np.asarray(h[OFFSET:], float) for h in hyb]
	n = max(len(h) for h in row)
	row = [np.pad(h, (0, n - len(h))) for h in row]
	a, b = int(SPLICE[0] * fs), int(SPLICE[1] * fs)
	got = np.mean([np.sum(h[a:b] ** 2) for h in row])
	if stereo == 'ab':
		row = list(diffuse_coherence(row[0], row[1], fs, AB_SPACING))
	fade = 1 - splice_fade(fs, n)
	row = [h * fade for h in row]
	out, gains = [], []
	for s in range(len(srcs)):
		ref = np.mean([np.sum(e[a:b] ** 2) for e in early_ref[s]])
		g = np.sqrt(ref / got) if got > 0 else 1.0
		gains.append(20 * np.log10(g))
		out.append([g * h for h in row])
	return out, gains


# ---- signal paths

def direct_path(x, fs, src, mic):
	"""x delayed by r / c with gain 1 / r per sample (src, mic: (n, 3) or (3,)), cubic interpolation."""
	n = len(x)
	r = np.linalg.norm(np.broadcast_to(src, (n, 3)) - mic, axis=-1)
	pos = np.arange(n) - r / C * fs
	i = np.floor(pos).astype(np.int64)
	f = pos - i
	xp = np.pad(x, (2, 2))
	get = lambda k: xp[np.clip(i + k + 2, 0, n + 3)]
	y0, y1, y2, y3 = get(-1), get(0), get(1), get(2)
	# Catmull-Rom
	out = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)))
	out[pos < 0] = 0
	return out / np.maximum(r, 0.05)


def varying(x, irs, hop):
	"""x through a filter that changes every `hop` samples (irs[k] at sample k * hop), Hann^2 crossfade."""
	n, m = len(x), len(irs[0])
	y = np.zeros(n + m)
	w = np.sin(np.pi * np.arange(2 * hop) / (2 * hop)) ** 2		# overlapping halves sum to 1
	for k, h in enumerate(irs):
		a = k * hop - hop
		lo, hi = max(0, a), min(n, a + 2 * hop)
		if lo >= hi:
			continue
		seg = x[lo:hi] * w[lo - a:hi - a]
		if not seg.any():
			continue
		y[lo:hi + m - 1] += ss.oaconvolve(seg, h)
	return y[:n]


def lrms(x):
	return float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0


def t30(h, fs, fc):
	b, a = ss.butter(3, [fc / np.sqrt(2) / (fs / 2), fc * np.sqrt(2) / (fs / 2)], 'band')
	e = np.cumsum((ss.filtfilt(b, a, h) ** 2)[::-1])[::-1]
	e = 10 * np.log10(e / e[0] + 1e-30)
	t = np.arange(len(e)) / fs
	i = (e <= -5) & (e >= -35)
	return float(-60 / np.polyfit(t[i], e[i], 1)[0])


def main():
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('--piano', required=True)
	ap.add_argument('--speech', required=True)
	ap.add_argument('--pose', required=True)
	ap.add_argument('--out', required=True)
	ap.add_argument('--room', default='living', choices=list(ROOMS))
	ap.add_argument('--stereo', default='ab', choices=['ab', 'mono'])
	ap.add_argument('--hop', type=int, default=2, help='frames between reflection updates')
	ap.add_argument('--absorption', type=float, default=1.0, help="times the room's absorption (1.5: living RT60 ~0.45 s)")
	ap.add_argument('--report')
	ap.add_argument('--stems', help='also write the spatialised piano / speech as <STEMS>.piano.wav, <STEMS>.speech.wav')
	ap.add_argument('--jobs', type=int, default=min(8, os.cpu_count() or 1))
	a = ap.parse_args()
	global ABSORPTION
	ABSORPTION = a.absorption
	t0 = time.time()

	piano, fs = sf.read(a.piano, dtype='float64', always_2d=True)
	speech, fs2 = sf.read(a.speech, dtype='float64', always_2d=True)
	assert fs == fs2, 'stems at different rates'
	speech = speech.mean(1)
	n = max(len(piano), len(speech))
	piano = np.pad(piano, ((0, n - len(piano)), (0, 0)))
	speech = np.pad(speech, (0, n - len(speech)))
	pose = json.load(open(a.pose))
	geo = Geometry(pose)
	track = Track(pose, geo, a.stereo)
	nm = len(track.mics)
	ps = pose['sources']['piano']
	# fixed sources and moving one (the mouth): (name, group, signal, position(t) or fixed)
	sources = [('piano-bass', 'piano', piano[:, 0], geo.clamp(geo(ps['bass']))),
	           ('piano-treble', 'piano', piano[:, 1], geo.clamp(geo(ps['treble']))),
	           ('speech', 'speech', speech, None)]

	# reflection updates every `hop` frames
	fps = pose['fps']
	hop = int(round(a.hop / fps * fs))
	times = np.arange(0, n + hop, hop) / fs
	src_at = lambda s, t: s[3] if s[3] is not None else track.at(track.mouth, t)[0]
	jobs = [(geo.dims, a.room, [src_at(s, t) for s in sources], [track.at(m, t)[0] for m in track.mics], fs) for t in times]
	jobs = [j + (a.absorption,) for j in jobs]
	with ProcessPoolExecutor(a.jobs) as ex:
		E = list(ex.map(early, jobs, chunksize=4))		# E[k][source][mic]
	t_early = time.time() - t0

	# the late tail at the median pose
	mid = float(np.median(track.t))
	ref_srcs = [src_at(s, mid) for s in sources]
	ref_mics = [track.at(m, mid)[0] for m in track.mics]
	ref_early = early((geo.dims, a.room, ref_srcs, ref_mics, fs, a.absorption))
	T, tail_gain = tails(geo.dims, a.room, ref_srcs, ref_mics, fs, a.stereo, ref_early)

	# render
	tt = np.arange(n) / fs
	mic_t = [track.at(m, tt) for m in track.mics]
	mouth_t = track.at(track.mouth, tt)
	groups = {'piano': np.zeros((nm, n)), 'speech': np.zeros((nm, n))}
	for si, s in enumerate(sources):
		x = s[2]
		if not x.any():
			continue
		src = s[3] if s[3] is not None else mouth_t
		for m in range(nm):
			y = direct_path(x, fs, src, mic_t[m])
			y += varying(x, [E[k][si][m] for k in range(len(times))], hop)
			y += ss.oaconvolve(x, T[si][m])[:n]
			groups[s[1]][m] += y

	# each group at the RMS of its dry stem (the script's balance)
	dry = {'piano': lrms(piano.reshape(-1)), 'speech': lrms(speech)}
	scale = {}
	for g, y in groups.items():
		wet = lrms(y.reshape(-1))
		scale[g] = dry[g] / wet if wet > 0 else 0.0
		groups[g] = y * scale[g]
	out = groups['piano'] + groups['speech']
	if nm == 1:
		out = np.vstack([out, out])
	sf.write(a.out, out.T.astype(np.float32), fs, subtype='FLOAT')
	if a.stems:		# <prefix>.piano.wav, <prefix>.speech.wav
		for g, y in groups.items():
			y = np.vstack([y, y]) if nm == 1 else y
			sf.write(f'{a.stems}.{g}.wav', y.T.astype(np.float32), fs, subtype='FLOAT')
	elapsed = time.time() - t0

	if a.report:
		# the IRs at the median pose: T30 per band (direct + early + tail, first mic), DRR per source
		rep = dict(room=a.room, stereo=a.stereo, absorption=a.absorption, fs=fs, seconds=n / fs, updates=len(times), hop_s=hop / fs,
		           time_s=dict(early=round(t_early, 1), total=round(elapsed, 1)), tail_gain_db=[round(g, 2) for g in tail_gain],
		           group_scale_db={g: round(20 * np.log10(v), 2) if v > 0 else None for g, v in scale.items()}, sources={})
		for si, s in enumerate(sources):
			rows = []
			for m in range(nm):
				r = np.linalg.norm(ref_srcs[si] - ref_mics[m])
				d0 = int(round(r / C * fs))
				rev = ref_early[si][m]
				h = np.zeros(len(T[si][m]))
				h[:len(rev)] += rev
				h += T[si][m]
				# direct energy: a unit impulse of 1 / r (as direct_path)
				e_dir = (1 / r) ** 2
				hd = h.copy()
				hd[d0] += 1 / r
				rows.append(dict(distance_m=round(float(r), 3), drr_db=round(float(10 * np.log10(e_dir / np.sum(h ** 2))), 1),
				                 t30_s={str(f): round(t30(hd, fs, f), 2) for f in BANDS[1:5]}))
			rep['sources'][s[0]] = rows
		json.dump(rep, open(a.report, 'w'), indent=1)
	print(f'spatialise: {a.room} {a.stereo}, {n / fs:.1f} s, {len(times)} reflection updates, '
	      f'{elapsed:.1f} s (reflections {t_early:.1f} s)', file=sys.stderr)


if __name__ == '__main__':
	main()

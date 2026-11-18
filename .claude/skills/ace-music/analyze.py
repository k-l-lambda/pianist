"""A quick objective check of generated audio: length, tempo, key, brightness, loudness, and
the end's silence; a log spectrogram per file into <out>/spectrograms.png.

    <librosa-python> analyze.py <file.wav> [<file.wav> ...] [--png <path>]

Read the numbers with care:
- tempo: beat tracking often reports double (arpeggios read as beats): 144 for a 72 BPM piece.
- key: Krumhansl profiles on the mean chroma; a mode's colour (e.g. lydian's #4) shows in the
  pitch-class list, not in the key name.
"""
import argparse, os
import numpy as np, librosa, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt, librosa.display

ap = argparse.ArgumentParser()
ap.add_argument('files', nargs='+')
ap.add_argument('--png')
a = ap.parse_args()

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

fig, axes = plt.subplots(len(a.files), 1, figsize=(14, 3.5 * len(a.files)), squeeze=False)
for ax, f in zip(axes[:, 0], a.files):
    y, sr = librosa.load(f, sr=None, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr).mean()
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(1)
    keys = sorted([(np.corrcoef(np.roll(MAJ, k), chroma)[0, 1], f'{NAMES[k]} major') for k in range(12)] +
                  [(np.corrcoef(np.roll(MIN, k), chroma)[0, 1], f'{NAMES[k]} minor') for k in range(12)],
                  reverse=True)
    rms = librosa.feature.rms(y=y)[0]
    loud = np.nonzero(20 * np.log10(rms + 1e-9) > 20 * np.log10(rms.max()) - 45)[0]
    end = (loud[-1] + 1) * 512 / sr if len(loud) else 0
    pcs = ', '.join(NAMES[k] for k in np.argsort(chroma)[::-1][:7])
    print(f'{os.path.basename(f)}: {len(y) / sr:.1f} s (sound ends ~{end:.1f} s), '
          f'tempo ~{float(np.atleast_1d(tempo)[0]):.0f}, key {keys[0][1]} ({keys[0][0]:.2f}) / '
          f'{keys[1][1]} ({keys[1][0]:.2f}), pitch classes {pcs}, centroid {centroid:.0f} Hz, '
          f'rms {20 * np.log10(rms.mean()):.1f} dB')
    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)), ref=np.max)
    librosa.display.specshow(S, sr=sr, hop_length=1024, x_axis='time', y_axis='log', ax=ax)
    ax.set_title(os.path.basename(f))
plt.tight_layout()
png = a.png or os.path.join(os.path.dirname(os.path.abspath(a.files[0])), 'spectrograms.png')
plt.savefig(png, dpi=80)
print('spectrograms:', png)

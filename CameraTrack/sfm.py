"""Stage 4: structure from motion over the whole video (pycolmap).

All frames are reconstructed with a single shared SIMPLE_RADIAL camera (focal length and
one radial distortion term refined in bundle adjustment). Sequential matching suits video;
the static room (wallpaper, piano, bench, floor) gives dense features, so this recovers the
camera motion far more robustly than the keyboard alone. The keyboard is used afterwards
only to fix the world frame and the metric scale (align.py).

Run with PYTHONPATH=.pylib
"""

import os
import shutil
from pathlib import Path

import cv2
import pycolmap

VIDEO = '../Footages.local/VID_20261029_231550.mp4'
WORK = Path( 'sfm' )


def export_frames():
	img_dir = WORK / 'images'
	if img_dir.exists() and len( list( img_dir.iterdir() ) ) > 600:
		return img_dir
	img_dir.mkdir( parents = True, exist_ok = True )
	cap = cv2.VideoCapture( VIDEO )
	n = 0
	while True:
		ok, f = cap.read()
		if not ok:
			break
		cv2.imwrite( str( img_dir / f'{n:04d}.jpg' ), f, [ cv2.IMWRITE_JPEG_QUALITY, 95 ] )
		n += 1
	print( 'exported', n, 'frames' )
	return img_dir


def main():
	img_dir = export_frames()
	db = WORK / 'database.db'
	if db.exists():
		db.unlink()
	ex = pycolmap.FeatureExtractionOptions()
	ex.sift.max_num_features = 4096
	ex.use_gpu = False
	pycolmap.extract_features(
		str( db ), str( img_dir ),
		camera_mode = pycolmap.CameraMode.SINGLE,
		camera_model = 'SIMPLE_RADIAL',
		extraction_options = ex,
	)
	seq = pycolmap.SequentialPairingOptions()
	seq.overlap = 12
	seq.quadratic_overlap = True
	pycolmap.match_sequential( str( db ), pairing_options = seq )

	out = WORK / 'sparse'
	if out.exists():
		shutil.rmtree( out )
	out.mkdir()
	opts = pycolmap.IncrementalPipelineOptions()
	opts.ba_refine_focal_length = True
	opts.ba_refine_extra_params = True
	opts.multiple_models = False
	maps = pycolmap.incremental_mapping( str( db ), str( img_dir ), str( out ), options = opts )
	for i, rec in maps.items():
		print( i, rec.summary() )


if __name__ == '__main__':
	main()

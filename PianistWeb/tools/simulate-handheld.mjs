// Feed the video's intended path (CameraTrack/intended_keys.json) through the handheld
// generator and write the synthetic camera in camera.json format (OpenCV camera axes), so
// CameraTrack/analyze.py can measure it exactly like the real one.
//   cd PianistWeb && node tools/simulate-handheld.mjs <seed>
//   cd ../CameraTrack && python3 analyze.py camera_sim<seed>.json _sim<seed>
import fs from 'fs';
import * as THREE from 'three';
import { HandheldCamera } from '../src/handheld.js';

const dir = new URL( '../../CameraTrack/', import.meta.url ).pathname;
const params = JSON.parse( fs.readFileSync( dir + 'handheld_params.json' ) );
const keys = JSON.parse( fs.readFileSync( dir + 'intended_keys.json' ) );
const seed = Number( process.argv[ 2 ] ?? 1 );
const hc = new HandheldCamera( params, { seed } );
hc.setPath( keys );
const frames = [];
const flip = new THREE.Matrix4().makeScale( 1, - 1, - 1 );		// three camera -> OpenCV camera axes
for ( let f = 0; f <= Math.round( hc.duration * 30 ); ++ f ) {
	const { position, quaternion } = hc.update( f / 30 );
	const R = new THREE.Matrix4().makeRotationFromQuaternion( quaternion ).multiply( flip );
	const e = R.elements;		// column-major
	frames.push( { frame: f, time: f / 30, pos: position.toArray(), R: [ [ e[ 0 ], e[ 4 ], e[ 8 ] ], [ e[ 1 ], e[ 5 ], e[ 9 ] ], [ e[ 2 ], e[ 6 ], e[ 10 ] ] ] } );
}
fs.writeFileSync( dir + `camera_sim${ seed }.json`, JSON.stringify( { frames } ) );
console.log( 'wrote', frames.length, 'frames' );

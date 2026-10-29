// Copy the FluidSynth WASM runtime (with libsndfile, needed to decode .sf3) and the
// js-synthesizer AudioWorklet script into public/fluid, so they are served as plain files
// (AudioWorklet.addModule needs URLs, not bundled modules). Runs before dev / build.

import fs from 'node:fs';
import path from 'node:path';

const root = path.join( path.dirname( new URL( import.meta.url ).pathname ), '..' );
const pkg = path.join( root, 'node_modules/js-synthesizer' );
const out = path.join( root, 'public/fluid' );
const files = [
	[ 'externals/libfluidsynth-2.4.6-with-libsndfile.js', 'libfluidsynth-with-libsndfile.js' ],
	[ 'dist/js-synthesizer.worklet.min.js', 'js-synthesizer.worklet.js' ],
];

fs.mkdirSync( out, { recursive: true } );
for ( const [ from, to ] of files ) {

	const src = path.join( pkg, from ), dst = path.join( out, to );
	const s = fs.statSync( src );
	if ( fs.existsSync( dst ) && fs.statSync( dst ).size === s.size ) continue;
	fs.copyFileSync( src, dst );
	console.log( 'copied', to );

}

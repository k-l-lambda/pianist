#!/usr/bin/env node
// The Konzerthaus Berlin's walkable floor as a height map (scene metres): public/berlinhall/floor.bin +
// floor.json, read by src/hall.js (ConcertHall.floorHeight( x, z )) for the handheld camera's floor
// following (src/handheldmode.js).
//
//   node tools/hall-floor.mjs [--url http://localhost:5184/] [--res 0.05]
//
// The hall loaded in headless Chrome (?style=grand-black); its floor meshes alone (the stage's
// parquet and platforms, the stalls' parquet and the grilles in it: FLOOR below; not the seats, the
// piano, the walls or the galleries) drawn from above by an orthographic camera into a float target,
// each pixel the world height of the highest floor surface there (a top view: risers and steps by
// their treads). Grid: `res` m (5 cm) over BOUNDS. One level only: the galleries (3-7 m up, no stairs
// to them in the model) are left out; where no floor is drawn (outside the hall, under the walls):
// no height.
// Stored as Uint16 little-endian, row-major from (minX, minZ), x fastest: height = v / 1000 + base
// (mm above `base`), 65535 = none; floor.json: { minX, minZ, res, nx, nz, base, none, meshes }.
// GPU and browser as tools/render-video.mjs.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const argv = process.argv.slice( 2 );
const arg = ( k, d ) => { const i = argv.indexOf( k ); return i >= 0 ? argv[ i + 1 ] : d; };
const url = arg( '--url', null ), res = Number( arg( '--res', 0.05 ) );

// the floor meshes (berlinHall:<name>): stage parquet and its platforms / risers, the stalls' parquet,
// the ventilation grilles let into both
const FLOOR = [ 'buehnen-parkett', 'buehnen-parkett-near', 'buehne-platten', 'grille-stage', 'parkett', 'parkett-near', 'parkett-2', 'parkett-4', 'grille-stalls' ];
const BOUNDS = { minX: - 10.2, maxX: 23.0, minZ: - 10.9, maxZ: 10.9 };	// the hall's ground floor, stage to the back wall
const BASE = - 1.0;			// m: heights stored from here (mm)

let vite = null, base = url;
const reachable = async u => { try { return ( await fetch( u ) ).ok; } catch { return false; } };
if ( ! base ) {

	base = 'http://localhost:5184/';
	if ( ! await reachable( base ) ) {

		vite = spawn( 'npx', [ 'vite', '--port', '5184', '--strictPort' ], { cwd: root, stdio: 'ignore', detached: true } );
		for ( let i = 0; ! await reachable( base ); ++ i ) { if ( i > 120 ) throw new Error( 'vite did not start' ); await new Promise( r => setTimeout( r, 500 ) ); }

	}

}

const require = createRequire( import.meta.url );
const { chromium } = require( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );
const browser = await chromium.launch( {
	executablePath: process.env.CHROME ?? path.join( os.homedir(), '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ),
	headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES ?? '/tmp/pianist-tools/nvidia_egl.json' },
	args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist' ],
} );
try {

	const page = await browser.newPage( { viewport: { width: 640, height: 360 } } );
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	await page.goto( new URL( '?style=grand-black', base ).href );
	await page.waitForFunction( () => window.__pianist?.hall?.berlin && ! window.__pianist.hall.berlinLoading, null, { timeout: 300000 } );
	const out = await page.evaluate( async ( { FLOOR, BOUNDS, res, BASE } ) => {

		const url = performance.getEntriesByType( 'resource' ).map( e => e.name ).find( n => /deps\/three\.js/.test( n ) );
		const THREE = await import( url );
		const P = window.__pianist, renderer = P.renderer;
		const scene = new THREE.Scene(), found = [];
		const mat = new THREE.ShaderMaterial( {
			side: THREE.DoubleSide,
			vertexShader: 'varying float vY; void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
			fragmentShader: 'varying float vY; void main() { gl_FragColor = vec4( vY, 1.0, 0.0, 1.0 ); }',
		} );
		P.hall.berlin.updateMatrixWorld( true );
		P.hall.berlin.traverse( o => {

			const name = o.name.replace( /^berlinHall:/, '' );
			if ( ! o.isMesh || o.isInstancedMesh || ! FLOOR.includes( name ) ) return;
			const m = new THREE.Mesh( o.geometry, mat );
			m.matrixAutoUpdate = false;
			m.matrix.copy( o.matrixWorld );
			m.matrixWorld.copy( o.matrixWorld );
			scene.add( m );
			found.push( name );

		} );
		const nx = Math.round( ( BOUNDS.maxX - BOUNDS.minX ) / res ), nz = Math.round( ( BOUNDS.maxZ - BOUNDS.minZ ) / res );
		// looking straight down, image up = -z: pixel (i, j) from the top = z from minZ, x from minX
		const cam = new THREE.OrthographicCamera( BOUNDS.minX, BOUNDS.minX + nx * res, - BOUNDS.minZ, - ( BOUNDS.minZ + nz * res ), 0.01, 20 );
		cam.position.set( 0, 10, 0 );
		cam.up.set( 0, 0, - 1 );
		cam.lookAt( 0, 0, 0 );
		cam.updateMatrixWorld();
		const rt = new THREE.WebGLRenderTarget( nx, nz, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true } );
		const keep = { target: renderer.getRenderTarget(), clear: renderer.getClearColor( new THREE.Color() ).clone(), alpha: renderer.getClearAlpha(), tone: renderer.toneMapping };
		renderer.setRenderTarget( rt );
		renderer.setClearColor( 0x000000, 0 );		// (green 0: no floor)
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.clear();
		renderer.render( scene, cam );
		const px = new Float32Array( nx * nz * 4 );
		renderer.readRenderTargetPixels( rt, 0, 0, nx, nz, px );
		renderer.setRenderTarget( keep.target );
		renderer.setClearColor( keep.clear, keep.alpha );
		renderer.toneMapping = keep.tone;
		rt.dispose();
		// (the read is bottom-up: row 0 = the image's bottom = the largest z) -> rows from minZ
		const h = new Array( nx * nz );
		for ( let j = 0; j < nz; ++ j ) for ( let i = 0; i < nx; ++ i ) {

			const k = ( ( nz - 1 - j ) * nx + i ) * 4;
			h[ j * nx + i ] = px[ k + 1 ] > 0.5 ? Math.round( ( px[ k ] - BASE ) * 1000 ) : 65535;

		}
		return { nx, nz, h, found };

	}, { FLOOR, BOUNDS, res, BASE } );

	const missing = FLOOR.filter( n => ! out.found.includes( n ) );
	if ( missing.length ) console.warn( 'floor meshes not found:', missing.join( ', ' ) );
	const buf = Buffer.alloc( out.nx * out.nz * 2 );
	out.h.forEach( ( v, i ) => buf.writeUInt16LE( Math.max( 0, Math.min( 65535, v ) ), i * 2 ) );
	const dir = path.join( root, 'public/berlinhall' );
	fs.writeFileSync( path.join( dir, 'floor.bin' ), buf );
	const meta = { minX: BOUNDS.minX, minZ: BOUNDS.minZ, res, nx: out.nx, nz: out.nz, base: BASE, none: 65535, meshes: out.found.sort() };
	fs.writeFileSync( path.join( dir, 'floor.json' ), JSON.stringify( meta, null, 1 ) + '\n' );
	// the levels found (a check): heights by area
	const count = new Map();
	for ( const v of out.h ) if ( v !== 65535 ) { const k = ( v / 1000 + BASE ).toFixed( 2 ); count.set( k, ( count.get( k ) ?? 0 ) + 1 ); }
	const top = [ ...count ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 12 ).map( ( [ k, n ] ) => `${ k } m: ${ ( n * res * res ).toFixed( 1 ) } m²` );
	console.log( `floor ${ out.nx } x ${ out.nz } at ${ res } m from ${ out.found.length } meshes -> public/berlinhall/floor.bin (${ buf.length } bytes)\n  ${ top.join( '\n  ' ) }` );

} finally {

	await browser.close();
	if ( vite ) try { process.kill( - vite.pid ); } catch { /* gone */ }

}

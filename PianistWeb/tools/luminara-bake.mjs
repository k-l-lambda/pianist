// Luminara's lightmaps: one per lighting preset (src/luminarabake.js, on the GPU in a headless
// Chrome), into <generated>/bake/: shell.json (the static shell's meshes with their lightmap UVs:
// tools/luminara-unwrap.py's) and <preset>.png (the map, sRGB-encoded under its scale), bake.json
// (each map's scale, the shell's hash). tools/luminara-asset.mjs packs them; src/luminara.js uses them
// while its shell is still the one baked (the hash).
//
//   node tools/luminara-bake.mjs --generated <dir> [--url http://localhost:5187/] [--size 1024] [--only Afternoon,Night]
// Needs the dev server (vite), playwright-core (PLAYWRIGHT_CORE, as tools/render-video.mjs) and the GPU
// (the NVIDIA EGL setup: HEADLESS_GPU_EGL).

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createRequire } from 'module';

const { chromium } = createRequire( import.meta.url )( process.env.PLAYWRIGHT_CORE ?? '/tmp/pianist-tools/node_modules/playwright-core' );		// (as tools/render-video.mjs)
const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const opt = { generated: null, url: 'http://localhost:5187/', size: 1024, only: null, texels: 40 };
const argv = process.argv.slice( 2 );
for ( let i = 0; i < argv.length; ++ i ) {

	const a = argv[ i ], v = () => argv[ ++ i ];
	if ( a === '--generated' ) opt.generated = v();
	else if ( a === '--url' ) opt.url = v();
	else if ( a === '--size' ) opt.size = Number( v() );
	else if ( a === '--texels' ) opt.texels = Number( v() );
	else if ( a === '--only' ) opt.only = new Set( v().split( ',' ) );
	else throw new Error( `unknown argument ${ a }` );

}
if ( ! opt.generated ) throw new Error( 'usage: node tools/luminara-bake.mjs --generated <dir> [--url ...] [--size 1024] [--only a,b]' );
const out = path.join( opt.generated, 'bake' );
fs.mkdirSync( out, { recursive: true } );
const t0 = Date.now(), say = s => console.log( `[${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s] ${ s }` );

const browser = await chromium.launch( {
	executablePath: process.env.CHROME ?? path.join( process.env.HOME, '.cache/ms-playwright/chromium-1208/chrome-linux64/chrome' ), headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: process.env.HEADLESS_GPU_EGL ?? '/tmp/pianist-tools/nvidia_egl.json' },
	args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog' ],
} );
const page = await browser.newPage( { viewport: { width: 640, height: 360 } } );
page.on( 'console', m => { if ( m.type() === 'error' ) console.log( 'page:', m.text().slice( 0, 300 ) ); } );
page.on( 'pageerror', e => console.log( 'page error:', e.message ) );
await page.goto( `${ opt.url }#grand-white&gi&nobake` );
await page.waitForFunction( () => window.__pianist?.luminara?.pack, null, { timeout: 180000 } );
// the baker's first import may make vite optimise its deps and reload the page: once, then wait again
await page.evaluate( () => import( '/src/luminarabake.js' ) ).catch( () => {} );
await page.waitForTimeout( 4000 );
await page.waitForFunction( () => window.__pianist?.luminara?.pack, null, { timeout: 180000 } );
await page.evaluate( () => import( '/src/luminarabake.js' ) );
await page.waitForTimeout( 1500 );
say( 'page ready' );
await page.evaluate( () => { window.__pianistPaused = true; } );
// the shell, unwrapped
const shellIn = path.join( out, 'shell-in.json' ), shellOut = path.join( out, 'shell.json' );
fs.writeFileSync( shellIn, JSON.stringify( await page.evaluate( async () => ( await import( '/src/luminarabake.js' ) ).exportShell( window.__pianist.luminara ) ) ) );
const hash = await page.evaluate( () => window.__pianist.luminara.shellHash() );
execFileSync( path.join( root, '..', '.venv-depth', 'bin', 'python' ), [ '-I', path.join( root, 'tools', 'luminara-unwrap.py' ), shellIn, shellOut, '--size', String( opt.size ), '--texels', String( opt.texels ) ], { stdio: 'inherit' } );
fs.unlinkSync( shellIn );
const shell = JSON.parse( fs.readFileSync( shellOut, 'utf8' ) );
say( `unwrapped: ${ shell.meshes.length } meshes, ${ shell.texels } texels/m` );
await page.evaluate( async meshes => ( await import( '/src/luminarabake.js' ) ).applyShell( window.__pianist.luminara, meshes ), shell.meshes );
// each preset
const meta = { hash, size: opt.size, texels: shell.texels, presets: {} };
const presets = await page.evaluate( () => Object.keys( window.__pianist.luminara.presets ) );
for ( const name of presets ) {

	if ( opt.only && ! opt.only.has( name ) ) continue;
	const r = await page.evaluate( async ( [ name, size ] ) => {

		const { LuminaraBaker } = await import( '/src/luminarabake.js' ), P = window.__pianist, L = P.luminara;
		L.preset = name;
		Object.assign( L.light, { tone: undefined, saturation: undefined, bloom: undefined, bloomThreshold: undefined }, L.presets[ name ] );
		L.updateLights();
		window.__baker ??= new LuminaraBaker( P.renderer, P.scene, L, size );
		const t = performance.now(), b = await window.__baker.bake();
		let s = '';
		for ( let i = 0; i < b.data.length; i += 0x8000 ) s += String.fromCharCode.apply( null, b.data.subarray( i, i + 0x8000 ) );
		return { data: btoa( s ), scale: b.scale, stats: b.stats, seconds: ( performance.now() - t ) / 1000 };

	}, [ name, opt.size ] );
	if ( ! Number.isFinite( r.scale ) ) throw new Error( `${ name }: the bake failed (scale ${ r.scale })` );
	const file = path.join( out, `${ name.replace( /\s+/g, '-' ).toLowerCase() }.png` );
	await sharp( Buffer.from( r.data, 'base64' ), { raw: { width: opt.size, height: opt.size, channels: 3 } } ).png( { compressionLevel: 9 } ).toFile( file );
	meta.presets[ name ] = { file: path.basename( file ), scale: r.scale, stats: r.stats };
	say( `${ name }: ${ r.seconds.toFixed( 0 ) } s, scale ${ r.scale.toFixed( 3 ) }, ${ JSON.stringify( r.stats ) }` );
	fs.writeFileSync( path.join( out, 'bake.json' ), JSON.stringify( meta, null, '\t' ) + '\n' );

}
await browser.close();
say( 'done' );

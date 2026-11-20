// Reproducible local GPU look-dev: node tools/azurea-detail-shot.mjs PORT PREFIX 'JSON_SHOTS'.
// Requires the machine's existing playwright-core installation (or PLAYWRIGHT_MODULE).
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const { chromium } = createRequire( import.meta.url )( process.env.PLAYWRIGHT_MODULE || '/tmp/pianist-tools/node_modules/playwright-core' );
const [ , , port, out, shotsJson ] = process.argv;
if ( ! port || ! out || ! shotsJson ) throw new Error( 'Expected PORT PREFIX JSON_SHOTS' );
await mkdir( dirname( out ), { recursive: true } );
const browser = await chromium.launch( { executablePath: process.env.CHROME || process.env.HOME + '/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome', headless: true,
	env: { ...process.env, __EGL_VENDOR_LIBRARY_FILENAMES: '/tmp/pianist-tools/nvidia_egl.json' }, args: [ '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist' ] } );
const errors = [], results = [];
try {
	const page = await browser.newPage( { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } );
	page.on( 'pageerror', e => { errors.push( e.message ); console.log( 'PAGEERR', e.message ); } );
	page.on( 'console', m => { if ( m.type() === 'error' ) { errors.push( m.text() ); console.log( 'CONSOLE', m.text().slice( 0, 400 ) ); } } );
	await page.goto( `http://127.0.0.1:${ port }/?style=grand-crystal&preset=Day#?gi`, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.__pianist?.azurea?.pack && window.__pianist.venue === window.__pianist.azurea, null, { timeout: 300000 } );
	await page.addStyleTag( { content: '.lil-gui,#hud,#power,#ptshot,#play,#start,#hallbar{display:none!important}' } );
	await page.waitForTimeout( 6000 );
	for ( const s of JSON.parse( shotsJson ) ) {
		await page.evaluate( async s => {
			const P = window.__pianist, A = P.azurea;
			for ( const o of window.__detailHidden || [] ) o.visible = true;
			window.__detailHidden = [];
			if ( s.hide ) A.group.traverse( o => { if ( o.isMesh && s.hide.some( key => A.materials[ key ] === o.material ) && o.visible ) { o.visible = false; window.__detailHidden.push( o ); } } );
			for ( const o of window.__detailLights || [] ) A.scene.remove( o );
			window.__detailLights = [];
			Object.assign( A.light, A.presets[ s.preset || 'Day' ], s.light || {} );
			A.updateLights();
			if ( A.materials.leafGlow ) A.materials.leafGlow.emissiveIntensity = s.glows === false ? 0 : 5;
			if ( s.glows === false ) A.materials.barLight.emissiveIntensity = 0;
			if ( A.pillowChecks?.some( c => c.maxPenetration > .001 ) ) throw new Error( 'Pillow penetration exceeds 1 mm' );
			if ( A.bounds().maxZ > 20 ) {

				const T = await import( '/node_modules/three/build/three.module.js' ), targets = A.group.children.filter( o => o.material === A.materials.plaster ), checks = [];
				A.scene.updateMatrixWorld( true );
				for ( const x of [ - 13.20, 8.45 ] ) for ( const y of [ .1, 2, 4.2 ] ) {

					const hit = new T.Raycaster( new T.Vector3( x, y, 18 ), new T.Vector3( 0, 0, 1 ), 0, 6.3 ).intersectObjects( targets )[ 0 ];
					checks.push( { kind: 'back', x, y, hit: hit?.point.toArray() ?? null } );

				}
				for ( const dx of [ - 1, 1 ] ) {

					const hit = new T.Raycaster( new T.Vector3( - 2, 2, 23.9 ), new T.Vector3( dx, 0, 0 ), 0, 13 ).intersectObjects( targets )[ 0 ];
					checks.push( { kind: 'side-return', dx, hit: hit?.point.toArray() ?? null } );

				}
				if ( checks.some( c => ! c.hit ) ) throw new Error( 'Room closure ray missed the extended shell' );
				A.closureChecks = checks;

			}
			if ( s.neutral ) {
				const T = await import( '/node_modules/three/build/three.module.js' );
				const fill = new T.HemisphereLight( '#ffffff', '#bcc0c4', 1.2 );
				const key = new T.RectAreaLight( '#ffffff', 5, 9, 6 );
				key.position.set( 1, 3.5, 10 ); key.lookAt( - 2, 1.5, 4 );
				window.__detailLights = [ fill, key ]; A.scene.add( fill, key );
			}
			if ( window.__detailControlsUpdate ) { P.controls.update = window.__detailControlsUpdate; window.__detailControlsUpdate = null; }
			if ( s.plan ) {

				window.__detailControlsUpdate = P.controls.update;
				P.controls.update = () => { P.camera.position.set( ...s.pos ); P.camera.up.set( 0, 0, - 1 ); P.camera.lookAt( ...s.target ); P.camera.updateMatrixWorld(); };
				P.controls.update(); P.controls.enabled = false;

			} else { P.camera.up.set( 0, 1, 0 ); P.camera.position.set( ...s.pos ); P.controls.target.set( ...s.target ); P.controls.update(); }
			P.camera.fov = s.fov || 36; P.camera.updateProjectionMatrix();
		}, s );
		await page.waitForTimeout( 4000 );
		await page.screenshot( { path: `${ out }-${ s.name }.png` } );
		const info = await page.evaluate( async () => {
			const r = window.__pianist.renderer, old = r.info.autoReset, frames = [];
			r.info.autoReset = false; r.info.reset();
			for ( let i = 0; i < 12; ++ i ) {
				await new Promise( resolve => requestAnimationFrame( resolve ) );
				if ( i > 1 ) frames.push( { calls: r.info.render.calls, triangles: r.info.render.triangles } );
				r.info.reset();
			}
			r.info.autoReset = old;
			const median = k => frames.map( f => f[ k ] ).sort( ( a, b ) => a - b )[ Math.floor( frames.length / 2 ) ];
			const A = window.__pianist.azurea, T = await import( '/node_modules/three/build/three.module.js' );
			const stoolChecks = A.pack.children.filter( o => o.name === 'bar-stool' ).map( o => {

				const b = new T.Box3().setFromObject( o ), cx = - 2.5, cz = 3.6;
				const dx = Math.max( b.min.x - cx, 0, cx - b.max.x ), dz = Math.max( b.min.z - cz, 0, cz - b.max.z );
				return { position: o.position.toArray(), bodyClearanceLowerBound: Math.hypot( dx, dz ) - ( A.barDimensions?.bodyRadius ?? 1.86878 ), bounds: { min: b.min.toArray(), max: b.max.toArray() } };

			} );
			if ( stoolChecks.some( c => c.bodyClearanceLowerBound < 0 ) ) throw new Error( 'Conservative stool/body bound intersects; inspect before accepting' );
			return { calls: median( 'calls' ), triangles: median( 'triangles' ), frames,
				memory: { ...r.info.memory }, programs: r.info.programs.length, mode: A.mode, floorSampling: { sourceSize: [ A.materials.marble.map?.image?.width, A.materials.marble.map?.image?.height ], floorSize: [ A.materials.floor.map?.image?.width, A.materials.floor.map?.image?.height ], anisotropy: A.materials.floor.map?.anisotropy, rendererMaxAnisotropy: r.capabilities.getMaxAnisotropy(), mipmaps: A.materials.floor.map?.generateMipmaps, minFilter: A.materials.floor.map?.minFilter, colorSpace: A.materials.floor.map?.colorSpace, repeat: A.materials.floor.map?.repeat.toArray() }, chandelierChecks: A.chandelierChecks, closureChecks: A.closureChecks, bounds: A.bounds(), acousticBox: A.acousticBox(), barDimensions: A.barDimensions, stoolChecks, pillowChecks: A.pillowChecks ?? [], mirror: { enabled: A.mirror.enabled, hiddenNames: [ A.floorMesh.name ], cameraLayerMask: A.mirror.camera.layers.mask, glowMeshes: A.group.children.filter( o => o.isMesh && [ A.materials.leafGlow, A.materials.barLight ].includes( o.material ) ).map( o => ( { name: o.name, visible: o.visible, layerMask: o.layers.mask, emissive: o.material.emissiveIntensity } ) ) } };
		} );
		results.push( { shot: s, info } ); console.log( s.name, JSON.stringify( info ) );
	}
} finally {
	await writeFile( `${ out }-metrics.json`, JSON.stringify( { errors, results }, null, 2 ) );
	await browser.close();
}
if ( errors.length ) process.exitCode = 1;

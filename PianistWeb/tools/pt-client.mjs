#!/usr/bin/env node
// A client of tools/pt-server.mjs (its port and token from ~/.cache/pianist-pt-server.token).
//
//   node tools/pt-client.mjs video <script.yaml> --from A --to B [--fps 25] [--size 640x360] [--pt 1024]
//        [--denoise] [--bits 8|10] [--crf 18] [--wm off] [--query "style=..."] [--no-audio] [--frames dir]
//        [--out file.mp4] [--wait]
//   node tools/pt-client.mjs still <state.json> [--spp 4096] [--size WxH] [--denoise] [--out file.png] [--wait]
//   node tools/pt-client.mjs status | jobs | wait <id> | cancel <id> | shutdown
//
// --out: relative to the server's --out-dir unless absolute. --wait: until the job is done (progress on the way).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { port, token } = JSON.parse( fs.readFileSync( path.join( os.homedir(), '.cache', 'pianist-pt-server.token' ), 'utf8' ) );
const api = async ( method, p, body ) => {

	const r = await fetch( `http://127.0.0.1:${ port }${ p }`, { method, headers: { authorization: `Bearer ${ token }`, 'content-type': 'application/json' }, body: body ? JSON.stringify( body ) : undefined } );
	const j = await r.json();
	if ( ! r.ok ) throw new Error( j.error ?? r.status );
	return j;

};
const [ cmd, ...rest ] = process.argv.slice( 2 );
const flags = {}, pos = [];
for ( let i = 0; i < rest.length; ++ i ) {

	const a = rest[ i ];
	if ( [ '--denoise', '--no-audio', '--wait' ].includes( a ) ) flags[ a.slice( 2 ) ] = true;
	else if ( a.startsWith( '--' ) ) flags[ a.slice( 2 ) ] = rest[ ++ i ];
	else pos.push( a );

}
const abs = f => f && ( path.isAbsolute( f ) ? f : f.includes( '/' ) ? path.resolve( f ) : f );

async function wait( id ) {

	let last = '';
	for ( ;; ) {

		let j;
		try { j = await api( 'GET', `/jobs/${ id }` ); } catch ( e ) { if ( /no such job|token/.test( e.message ) ) throw e; await new Promise( r => setTimeout( r, 3000 ) ); continue; }		// (a connection hiccup: again)
		const line = `job ${ id }: ${ j.status } ${ j.done }/${ j.total }${ j.sPerFrame ? `, ${ j.sPerFrame } s/frame` : '' }${ j.eta !== null && j.eta !== undefined ? `, ~${ j.eta } s left` : '' }`;
		if ( line !== last ) { process.stdout.write( `\r${ line }    ` ); last = line; }
		if ( [ 'done', 'failed', 'cancelled' ].includes( j.status ) ) { console.log( `\n${ j.status === 'done' ? `wrote ${ j.out } in ${ j.elapsed } s` : j.error ?? j.status }` ); process.exit( j.status === 'done' ? 0 : 1 ); }
		await new Promise( r => setTimeout( r, 2000 ) );

	}

}

if ( cmd === 'video' ) {

	const spec = { type: 'video', script: pos[ 0 ], from: Number( flags.from ), to: Number( flags.to ), fps: flags.fps ? Number( flags.fps ) : undefined, size: flags.size,
		pt: flags.pt ? Number( flags.pt ) : 0, denoise: !! flags.denoise, bits: flags.bits ? Number( flags.bits ) : undefined, crf: flags.crf ? Number( flags.crf ) : undefined,
		wm: flags.wm, query: flags.query, audio: ! flags[ 'no-audio' ], framesDir: flags.frames && path.resolve( flags.frames ), out: abs( flags.out ) };
	const { id } = await api( 'POST', '/jobs', spec );
	console.log( `job ${ id } queued` );
	if ( flags.wait ) await wait( id );

} else if ( cmd === 'still' ) {

	const state = JSON.parse( fs.readFileSync( pos[ 0 ], 'utf8' ) );
	const { id } = await api( 'POST', '/jobs', { type: 'still', state, spp: flags.spp ? Number( flags.spp ) : undefined, size: flags.size, denoise: flags.denoise ? true : undefined,
		out: abs( flags.out ) ?? path.basename( pos[ 0 ] ).replace( /\.json$/i, '' ) + `-pt${ flags.spp ? '-' + flags.spp + 'spp' : '' }.png` } );
	console.log( `job ${ id } queued` );
	if ( flags.wait ) await wait( id );

} else if ( cmd === 'status' ) console.log( JSON.stringify( await api( 'GET', '/status' ), null, 1 ) );
else if ( cmd === 'jobs' ) for ( const j of await api( 'GET', '/jobs' ) ) console.log( `${ j.id }\t${ j.type }\t${ j.status }\t${ j.done }/${ j.total }\t${ j.elapsed } s\t${ j.out }${ j.error ? '\t' + j.error : '' }` );
else if ( cmd === 'wait' ) await wait( pos[ 0 ] );
else if ( cmd === 'cancel' ) console.log( ( await api( 'DELETE', `/jobs/${ pos[ 0 ] }` ) ).status );
else if ( cmd === 'shutdown' ) console.log( ( await api( 'POST', '/shutdown' ) ).ok ? 'shutting down' : '?' );
else { console.log( fs.readFileSync( new URL( import.meta.url ), 'utf8' ).split( '\n' ).slice( 1, 11 ).join( '\n' ) ); process.exit( cmd ? 1 : 0 ); }

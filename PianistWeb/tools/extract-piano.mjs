// Extract a single preset (default: bank 0 / program 0, Acoustic Grand Piano) from an
// SF2/SF3 SoundFont into a standalone, much smaller SoundFont.
//
//   node tools/extract-piano.mjs [in.sf3] [out.sf3] [bank] [program]
//
// SoundFont layout (RIFF 'sfbk'):
//   LIST INFO  – metadata (copied, name adjusted)
//   LIST sdta  – smpl: sample data. SF2: 16-bit PCM, offsets in sample frames.
//                SF3: concatenated Ogg-Vorbis streams, shdr start/end are byte offsets and
//                loop points are relative to the decoded sample.
//   LIST pdta  – the "hydra": phdr/pbag/pmod/pgen (presets), inst/ibag/imod/igen
//                (instruments), shdr (samples). Every list ends with a terminal record and
//                bag/gen/mod indices point into the next list down.
//
// We keep the chosen preset, the instruments its zones reference (pgen 41 = instrument),
// and the samples those instruments reference (igen 53 = sampleID) plus stereo links; then
// renumber everything, rebase sample offsets and write fresh terminal records.

import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname( new URL( import.meta.url ).pathname );
const [ inPath = path.join( here, '../soundfont/gm.sf3' ), outPath = path.join( here, '../public/soundfont/piano.sf3' ), bankArg = '0', progArg = '0' ] = process.argv.slice( 2 );
const BANK = Number( bankArg ), PROGRAM = Number( progArg );

const GEN_INSTRUMENT = 41;
const GEN_SAMPLE_ID = 53;
const SAMPLE_COMPRESSED = 0x10;		// SF3 (Ogg Vorbis)
const SAMPLE_ROM = 0x8000;
const PCM_TAIL = 46;				// SF2 requires 46 zero sample frames after each sample

const buf = fs.readFileSync( inPath );
const str = ( o, n ) => buf.toString( 'latin1', o, o + n ).replace( /\0.*$/s, '' );

function chunks( off, end ) {

	const out = [];
	while ( off + 8 <= end ) {

		const id = str( off, 4 ), size = buf.readUInt32LE( off + 4 );
		const c = { id, off: off + 8, size };
		if ( id === 'RIFF' || id === 'LIST' ) {

			c.form = str( off + 8, 4 );
			c.children = chunks( off + 12, off + 8 + size );

		}

		out.push( c );
		off += 8 + size + ( size & 1 );

	}

	return out;

}

const riff = chunks( 0, buf.length )[ 0 ];
if ( riff.id !== 'RIFF' || riff.form !== 'sfbk' ) throw new Error( 'not a SoundFont' );
const list = form => riff.children.find( c => c.form === form );
const sub = ( l, id ) => {

	const c = l.children.find( x => x.id === id );
	if ( ! c ) throw new Error( 'missing chunk ' + id );
	return c;

};

const info = list( 'INFO' ), sdta = list( 'sdta' ), pdta = list( 'pdta' );
const smpl = sub( sdta, 'smpl' );

// ---- read the hydra ------------------------------------------------------------------
function records( id, size, read ) {

	const c = sub( pdta, id );
	const n = c.size / size;
	return Array.from( { length: n }, ( _, i ) => read( c.off + i * size ) );

}

const phdr = records( 'phdr', 38, o => ( { name: str( o, 20 ), program: buf.readUInt16LE( o + 20 ), bank: buf.readUInt16LE( o + 22 ), bag: buf.readUInt16LE( o + 24 ), library: buf.readUInt32LE( o + 26 ), genre: buf.readUInt32LE( o + 30 ), morphology: buf.readUInt32LE( o + 34 ) } ) );
const bag = o => ( { gen: buf.readUInt16LE( o ), mod: buf.readUInt16LE( o + 2 ) } );
const mod = o => buf.subarray( o, o + 10 );
const gen = o => ( { oper: buf.readUInt16LE( o ), amount: buf.readUInt16LE( o + 2 ) } );
const pbag = records( 'pbag', 4, bag ), pmod = records( 'pmod', 10, mod ), pgen = records( 'pgen', 4, gen );
const inst = records( 'inst', 22, o => ( { name: str( o, 20 ), bag: buf.readUInt16LE( o + 20 ) } ) );
const ibag = records( 'ibag', 4, bag ), imod = records( 'imod', 10, mod ), igen = records( 'igen', 4, gen );
const shdr = records( 'shdr', 46, o => ( {
	name: str( o, 20 ), start: buf.readUInt32LE( o + 20 ), end: buf.readUInt32LE( o + 24 ),
	loopStart: buf.readUInt32LE( o + 28 ), loopEnd: buf.readUInt32LE( o + 32 ), rate: buf.readUInt32LE( o + 36 ),
	pitch: buf.readUInt8( o + 40 ), correction: buf.readInt8( o + 41 ), link: buf.readUInt16LE( o + 42 ), type: buf.readUInt16LE( o + 44 ),
} ) );

// ---- select ---------------------------------------------------------------------------
const pi = phdr.findIndex( ( p, i ) => i < phdr.length - 1 && p.bank === BANK && p.program === PROGRAM );
if ( pi < 0 ) throw new Error( `preset bank ${ BANK } program ${ PROGRAM } not found` );
const preset = phdr[ pi ];

// zones of a header: bags [bag, nextHeader.bag); each bag's gens/mods up to the next bag
const zones = ( bags, gens, mods, from, to ) => {

	const out = [];
	for ( let b = from; b < to; ++ b ) out.push( { gens: gens.slice( bags[ b ].gen, bags[ b + 1 ].gen ), mods: mods.slice( bags[ b ].mod, bags[ b + 1 ].mod ) } );
	return out;

};

const presetZones = zones( pbag, pgen, pmod, preset.bag, phdr[ pi + 1 ].bag );
const instIds = [ ...new Set( presetZones.flatMap( z => z.gens.filter( g => g.oper === GEN_INSTRUMENT ).map( g => g.amount ) ) ) ];
const instZones = new Map( instIds.map( id => [ id, zones( ibag, igen, imod, inst[ id ].bag, inst[ id + 1 ].bag ) ] ) );

const sampleIds = new Set();
for ( const zs of instZones.values() ) for ( const z of zs ) for ( const g of z.gens ) if ( g.oper === GEN_SAMPLE_ID ) sampleIds.add( g.amount );
// stereo partners, when the link really points at the matching other channel
// (many fonts leave link = 0 and pan left/right samples per zone instead)
const isPartner = ( a, b ) => b < shdr.length - 1 && b !== a && ( ( shdr[ a ].type & 2 && shdr[ b ].type & 4 ) || ( shdr[ a ].type & 4 && shdr[ b ].type & 2 ) || ( shdr[ a ].type & 8 && shdr[ b ].type & 8 ) );
for ( const id of [ ...sampleIds ] ) {

	const s = shdr[ id ];
	if ( s.type & ( 2 | 4 | 8 ) && isPartner( id, s.link ) ) sampleIds.add( s.link );

}

const sampleList = [ ...sampleIds ].sort( ( a, b ) => a - b ).filter( id => ! ( shdr[ id ].type & SAMPLE_ROM ) );
const sampleMap = new Map( sampleList.map( ( id, i ) => [ id, i ] ) );
const instMap = new Map( instIds.map( ( id, i ) => [ id, i ] ) );

// ---- sample data ----------------------------------------------------------------------
const compressed = sampleList.map( id => !! ( shdr[ id ].type & SAMPLE_COMPRESSED ) );
if ( compressed.some( c => c ) && compressed.some( c => ! c ) ) throw new Error( 'mixed compressed / PCM samples are not supported' );
const sf3 = compressed[ 0 ] ?? false;

const pieces = [];
let cursor = 0;		// bytes (SF3) or frames (SF2)
const newSamples = sampleList.map( id => {

	const s = { ...shdr[ id ] };
	if ( sf3 ) {

		pieces.push( buf.subarray( smpl.off + s.start, smpl.off + s.end ) );
		const len = s.end - s.start;
		s.start = cursor;
		s.end = cursor + len;
		cursor += len;		// loop points stay relative to the decoded sample

	} else {

		const len = s.end - s.start;
		pieces.push( buf.subarray( smpl.off + s.start * 2, smpl.off + s.end * 2 ), Buffer.alloc( PCM_TAIL * 2 ) );
		const shift = cursor - s.start;
		s.start += shift; s.end += shift; s.loopStart += shift; s.loopEnd += shift;
		cursor += len + PCM_TAIL;

	}

	s.link = isPartner( id, s.link ) ? sampleMap.get( s.link ) ?? 0 : 0;
	return s;

} );
const smplData = Buffer.concat( pieces );

// ---- rebuild the hydra ----------------------------------------------------------------
function writeZones( zoneList, refOper, refMap, bagsOut, gensOut, modsOut ) {

	for ( const z of zoneList ) {

		bagsOut.push( { gen: gensOut.length, mod: modsOut.length } );
		for ( const g of z.gens ) gensOut.push( g.oper === refOper ? { oper: g.oper, amount: refMap.get( g.amount ) } : { ...g } );
		for ( const m of z.mods ) modsOut.push( m );

	}

}

const oPhdr = [], oPbag = [], oPgen = [], oPmod = [];
oPhdr.push( { ...preset, bag: 0 } );
writeZones( presetZones, GEN_INSTRUMENT, instMap, oPbag, oPgen, oPmod );

const oInst = [], oIbag = [], oIgen = [], oImod = [];
for ( const id of instIds ) {

	oInst.push( { name: inst[ id ].name, bag: oIbag.length } );
	writeZones( instZones.get( id ), GEN_SAMPLE_ID, sampleMap, oIbag, oIgen, oImod );

}

// terminal records
oPhdr.push( { name: 'EOP', program: 0, bank: 0, bag: oPbag.length, library: 0, genre: 0, morphology: 0 } );
oPbag.push( { gen: oPgen.length, mod: oPmod.length } );
oPgen.push( { oper: 0, amount: 0 } );
oPmod.push( Buffer.alloc( 10 ) );
oInst.push( { name: 'EOI', bag: oIbag.length } );
oIbag.push( { gen: oIgen.length, mod: oImod.length } );
oIgen.push( { oper: 0, amount: 0 } );
oImod.push( Buffer.alloc( 10 ) );
newSamples.push( { name: 'EOS', start: 0, end: 0, loopStart: 0, loopEnd: 0, rate: 0, pitch: 0, correction: 0, link: 0, type: 0 } );

// ---- serialize ----------------------------------------------------------------------------
const name20 = ( b, o, s ) => {

	b.fill( 0, o, o + 20 );
	b.write( s.slice( 0, 19 ), o, 'latin1' );

};
const table = ( rows, size, write ) => {

	const b = Buffer.alloc( rows.length * size );
	rows.forEach( ( r, i ) => write( b, i * size, r ) );
	return b;

};

const phdrB = table( oPhdr, 38, ( b, o, r ) => {

	name20( b, o, r.name ); b.writeUInt16LE( r.program, o + 20 ); b.writeUInt16LE( r.bank, o + 22 ); b.writeUInt16LE( r.bag, o + 24 );
	b.writeUInt32LE( r.library, o + 26 ); b.writeUInt32LE( r.genre, o + 30 ); b.writeUInt32LE( r.morphology, o + 34 );

} );
const bagB = rows => table( rows, 4, ( b, o, r ) => {

	b.writeUInt16LE( r.gen, o ); b.writeUInt16LE( r.mod, o + 2 );

} );
const genB = rows => table( rows, 4, ( b, o, r ) => {

	b.writeUInt16LE( r.oper, o ); b.writeUInt16LE( r.amount, o + 2 );

} );
const modB = rows => Buffer.concat( rows );
const instB = table( oInst, 22, ( b, o, r ) => {

	name20( b, o, r.name ); b.writeUInt16LE( r.bag, o + 20 );

} );
const shdrB = table( newSamples, 46, ( b, o, r ) => {

	name20( b, o, r.name );
	b.writeUInt32LE( r.start, o + 20 ); b.writeUInt32LE( r.end, o + 24 ); b.writeUInt32LE( r.loopStart, o + 28 ); b.writeUInt32LE( r.loopEnd, o + 32 );
	b.writeUInt32LE( r.rate, o + 36 ); b.writeUInt8( r.pitch, o + 40 ); b.writeInt8( r.correction, o + 41 ); b.writeUInt16LE( r.link, o + 42 ); b.writeUInt16LE( r.type, o + 44 );

} );

const chunk = ( id, data ) => {

	const h = Buffer.alloc( 8 );
	h.write( id, 0, 'latin1' );
	h.writeUInt32LE( data.length, 4 );
	return Buffer.concat( data.length & 1 ? [ h, data, Buffer.alloc( 1 ) ] : [ h, data ] );

};
const listChunk = ( form, parts ) => chunk( 'LIST', Buffer.concat( [ Buffer.from( form, 'latin1' ), ...parts ] ) );

// INFO: copy every sub-chunk, retitle INAM and note the extraction in ICMT
const infoParts = info.children.map( c => {

	if ( c.id === 'INAM' ) {

		const t = Buffer.from( `${ str( c.off, c.size ) } - ${ preset.name }\0`, 'latin1' );
		return chunk( 'INAM', t.length & 1 ? Buffer.concat( [ t, Buffer.alloc( 1 ) ] ) : t );

	}

	return chunk( c.id, buf.subarray( c.off, c.off + c.size ) );

} );

const body = Buffer.concat( [
	Buffer.from( 'sfbk', 'latin1' ),
	listChunk( 'INFO', infoParts ),
	listChunk( 'sdta', [ chunk( 'smpl', smplData ) ] ),
	listChunk( 'pdta', [
		chunk( 'phdr', phdrB ), chunk( 'pbag', bagB( oPbag ) ), chunk( 'pmod', modB( oPmod ) ), chunk( 'pgen', genB( oPgen ) ),
		chunk( 'inst', instB ), chunk( 'ibag', bagB( oIbag ) ), chunk( 'imod', modB( oImod ) ), chunk( 'igen', genB( oIgen ) ),
		chunk( 'shdr', shdrB ),
	] ),
] );
const out = Buffer.concat( [ chunk( 'RIFF', body ) ] );
fs.writeFileSync( outPath, out );

const mb = n => ( n / 1048576 ).toFixed( 2 ) + ' MB';
console.log( `preset "${ preset.name }" (bank ${ BANK }, program ${ PROGRAM }): ${ instIds.length } instrument(s), ${ sampleList.length } sample(s)${ sf3 ? ' (Ogg Vorbis)' : '' }` );
console.log( `${ path.basename( inPath ) } ${ mb( buf.length ) } -> ${ path.basename( outPath ) } ${ mb( out.length ) }` );

// OpenAI's gpt-image-2 through the same proxy as seedream (tools/bust-gen.mjs generate: CLAUDE_BASE_URL,
// PAIGOD_API_KEY), its /v3 routes: gpt-image-2-text-to-image, and gpt-image-2-edit (with reference images, as
// data URLs). The proxy takes only fixed sizes: 1024x1024, 1536x1024, 2048x688 (3:1), 2048x1024, 2048x1152,
// 3840x2160 (16:9 4K, the most pixels; a 3:1 band of it is 3840x1280), their portrait twins, auto; quality low |
// medium | high. (Its OpenAI-style /v1/images/generations ignores the size: 1672x941 for 3840x1280.)
// `mask` (edit only): a PNG of the image's size whose fully transparent pixels are the ones to paint.
//   import { generateGPT } from './gpt-image.mjs';  await generateGPT( prompt, { size, quality, refs: [ Buffer ], mask } ) -> Buffer

export async function generateGPT( prompt, { size = '1024x1024', quality = 'high', refs = [], mask = null } = {} ) {

	const base = ( process.env.CLAUDE_BASE_URL ?? 'https://apiproxy.paigod.work' ).replace( /\/+$/, '' ), key = process.env.PAIGOD_API_KEY;
	if ( ! key ) throw new Error( 'PAIGOD_API_KEY not set' );
	const mime = b => b.slice( 0, 4 ).toString( 'hex' ) === '89504e47' ? 'image/png' : 'image/jpeg';
	const route = refs.length ? 'gpt-image-2-edit' : 'gpt-image-2-text-to-image';
	const body = { prompt, size, quality, output_format: 'png', ...( refs.length ? { image: refs.map( b => `data:${ mime( b ) };base64,${ b.toString( 'base64' ) }` ) } : {} ), ...( mask ? { mask: `data:image/png;base64,${ mask.toString( 'base64' ) }` } : {} ) };
	const res = await fetch( `${ base }/v3/${ route }`, { method: 'POST', headers: { Authorization: `Bearer ${ key }`, 'Content-Type': 'application/json' },
		body: JSON.stringify( body ), signal: AbortSignal.timeout( 900000 ) } );
	const out = await res.json().catch( () => ( {} ) );
	const urls = out.images ?? out.image_urls ?? out.data?.map( d => d.url ?? d.b64_json ) ?? [];
	const u = typeof urls[ 0 ] === 'string' ? urls[ 0 ] : urls[ 0 ]?.url;
	if ( ! res.ok || ! u ) throw new Error( `HTTP ${ res.status } ${ JSON.stringify( out ).replace( /https?:\/\/[^"]+/g, '<url>' ).slice( 0, 400 ) }` );
	if ( ! /^https?:/.test( u ) ) return Buffer.from( u.replace( /^data:[^,]*,/, '' ), 'base64' );
	return Buffer.from( await ( await fetch( u, { signal: AbortSignal.timeout( 300000 ) } ) ).arrayBuffer() );

}

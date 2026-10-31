// Offline render mode (#?render=<script.yaml>&fps=25&from=0&to=10): the page renders a scene
// script frame by frame at a fixed rate, on a simulated clock, for tools/render-video.mjs to
// capture. Read once at module load, so the quality limits below can depend on it.
//
// The clock: in normal use `now()` / `setTimeout` / `setInterval` are the browser's. In render
// mode they run on simulated time that only `advance( ms )` moves; timers due within the step
// fire in order. Everything that affects what is drawn and keeps its own time (the MIDI player's
// scheduler, fades) uses this clock, so a frame shows exactly the scene at its time.

const hash = new URLSearchParams( location.hash.replace( /^#\??/, '' ) );
const query = new URLSearchParams( location.search );
const get = k => hash.get( k ) ?? query.get( k );

export const RENDER = get( 'render' ) !== null;
export const RENDER_OPTS = RENDER ? {
	script: get( 'render' ),
	fps: Number( get( 'fps' ) ?? 25 ),
	from: Number( get( 'from' ) ?? 0 ),
	to: get( 'to' ) !== null ? Number( get( 'to' ) ) : Infinity,
	pixelRatio: Number( get( 'ss' ) ?? 2 ),		// render scale (supersampling), downscaled by the capture
} : null;

// a render is reproducible: Math.random (wood grain offsets in geometry.js, ...) seeded
if ( RENDER ) {

	let seed = Number( get( 'seed' ) ?? 1 ) >>> 0;
	Math.random = () => {		// mulberry32

		seed = ( seed + 0x6D2B79F5 ) >>> 0;
		let t = seed;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

let simNow = 0;
let nextId = 1;
const timers = new Map();		// id -> { at, fn, every }

export const clock = RENDER ? {
	now: () => simNow,
	setTimeout( fn, ms = 0 ) {

		const id = nextId ++;
		timers.set( id, { at: simNow + Math.max( 0, ms ), fn, every: 0 } );
		return id;

	},
	setInterval( fn, ms ) {

		const id = nextId ++;
		timers.set( id, { at: simNow + Math.max( 1, ms ), fn, every: Math.max( 1, ms ) } );
		return id;

	},
	clearTimeout: id => timers.delete( id ),
	clearInterval: id => timers.delete( id ),
	/** Move simulated time forward by `ms`, firing due timers in time order. */
	advance( ms ) {

		const end = simNow + ms;
		for ( ; ; ) {

			let id = null, t = Infinity;
			for ( const [ k, v ] of timers ) if ( v.at <= end && ( v.at < t || ( v.at === t && k < id ) ) ) {

				id = k;
				t = v.at;

			}

			if ( id === null ) break;
			const v = timers.get( id );
			simNow = Math.max( simNow, v.at );
			if ( v.every ) v.at += v.every; else timers.delete( id );
			v.fn();

		}

		simNow = end;

	},
} : {
	now: () => performance.now(),
	setTimeout: ( fn, ms ) => setTimeout( fn, ms ),
	setInterval: ( fn, ms ) => setInterval( fn, ms ),
	clearTimeout: id => clearTimeout( id ),
	clearInterval: id => clearInterval( id ),
	advance() {},
};

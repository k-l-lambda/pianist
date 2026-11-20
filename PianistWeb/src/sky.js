// Azurea's sky: a physical atmosphere (Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique"), its stars, thin clouds and the photos' land in front of it.
//
// Three LUTs, rendered as fragment passes (half float):
//   transmittance   256 × 64   the sun's (or moon's) light through the air from a height towards a direction
//                              (Rayleigh, Mie, ozone; Bruneton's parametrisation)
//   multiple scattering 32 × 32 Hillaire's isotropic approximation of all orders beyond the second (64 directions)
//   sky view        192 × 108  the in-scattered light seen from the eye (30 m over the sea) by azimuth from the
//                              light and elevation (squared: dense at the horizon), the light at unit illuminance
// They depend on the light's elevation and the haze (Mie density): rebuilt when those change, not per frame.
//
// Units: the sky's colour is normalised to the photos' own (`uSkyScale`): its mean over the photo's band of sky
// (5..30 deg up, across the photo's 160 deg) equals that of the photo's clear sky (tools/azurea-sky-matte.py's fit:
// the brightness the presets were tuned on), its hue the atmosphere's, mixed `hue` towards the photo's. So the
// presets read as before and the colour, the gradient to the horizon, the glow round the sun or the moon, the
// darker band opposite and the twilight's warm horizon are the atmosphere's. At night (the moon) the same air lit
// by the moon, plus airglow (van Rhijn's brightening to the horizon).
//
// SKY_GLSL: `vec3 skyColor( vec3 d, float pix, float blur, bool airOn )`: the sky in direction d (unit, world: y up), pix the
// pixel's angular size (rad: the stars' footprint), blur an angular blur (rad: a rough sea's reflection; its stars
// and clouds softened). Above the horizon; below it the air's own haze colour (the sea's far end).

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
	in vec3 position;
	void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

// the atmosphere (km, per km): Hillaire's Earth
const COMMON = /* glsl */`
	precision highp float; precision highp sampler2D;
	const float RG = 6360.0, RT = 6460.0;
	const vec3 RAY_S = vec3( 5.802e-3, 13.558e-3, 33.1e-3 );
	uniform float uRayHeight; // molecular scale height (km), shared by all three LUTs
	const float MIE_S = 3.996e-3, MIE_A = 4.40e-3, MIE_H = 1.2, MIE_G = 0.8;
	// (the sky view's own forward peak softer than Hillaire's 0.8: the drawn disc's halo (src/azurea.js, kept as it
	// was) is the aureole; at 0.8 the two doubled into a white smear over a low sun)
	const float MIE_G_VIEW = 0.62;
	const vec3 OZ_A = vec3( 0.650e-3, 1.881e-3, 0.085e-3 );
	const float PI = 3.14159265359;
	uniform float uHaze;		// (the Mie density's factor: 1 Hillaire's clear day)
	struct Medium { vec3 scatR; float scatM; vec3 ext; };
	Medium medium( float r ) {
		float h = max( r - RG, 0.0 );
		float dR = exp( - h / max( uRayHeight, 1e-4 ) ),		// (0: no molecules above the sea)
			 dM = exp( - h / MIE_H ) * uHaze, dO = max( 0.0, 1.0 - abs( h - 25.0 ) / 15.0 );
		Medium m;
		m.scatR = RAY_S * dR; m.scatM = MIE_S * dM;
		m.ext = m.scatR + vec3( m.scatM + MIE_A * dM ) + OZ_A * dO;
		return m;
	}
	float raySphere( float r, float mu, float R ) {
		// (the distance along a ray from radius r, cos zenith mu, to the sphere R; -1 if none ahead)
		float b = r * mu, c = r * r - R * R, D = b * b - c;
		if ( D < 0.0 ) return - 1.0;
		float s = sqrt( D ), t1 = - b - s, t2 = - b + s;
		return t1 > 0.0 ? t1 : ( t2 > 0.0 ? t2 : - 1.0 );
	}
	float rayleighPhase( float c ) { return 3.0 / ( 16.0 * PI ) * ( 1.0 + c * c ); }
	float miePhaseG( float c, float g ) {
		// (Cornette-Shanks)
		float g2 = g * g;
		return 3.0 / ( 8.0 * PI ) * ( 1.0 - g2 ) * ( 1.0 + c * c ) / ( ( 2.0 + g2 ) * pow( 1.0 + g2 - 2.0 * g * c, 1.5 ) );
	}
	float miePhase( float c ) { return miePhaseG( c, MIE_G ); }
	// the transmittance LUT's coordinates (Bruneton 2017)
	vec2 transUV( float r, float mu ) {
		float H = sqrt( RT * RT - RG * RG ), rho = sqrt( max( r * r - RG * RG, 0.0 ) );
		float d = max( - r * mu + sqrt( max( r * r * ( mu * mu - 1.0 ) + RT * RT, 0.0 ) ), 0.0 );
		float dmin = RT - r, dmax = rho + H;
		return vec2( ( d - dmin ) / max( dmax - dmin, 1e-6 ), rho / H );
	}
	uniform sampler2D uTrans;
	vec3 transmittance( float r, float mu ) {
		// (towards a light: none past the planet's own horizon)
		float muH = - sqrt( max( 1.0 - RG * RG / ( r * r ), 0.0 ) );
		if ( mu < muH ) return vec3( 0.0 );
		return texture( uTrans, transUV( r, mu ) ).rgb;
	}
`;

const TRANS = COMMON + /* glsl */`
	uniform vec2 uSize;
	out vec4 o;
	void main() {
		vec2 uv = gl_FragCoord.xy / uSize;
		float H = sqrt( RT * RT - RG * RG ), rho = H * uv.y, r = sqrt( rho * rho + RG * RG );
		float dmin = RT - r, dmax = rho + H, d = dmin + uv.x * ( dmax - dmin );
		float mu = d == 0.0 ? 1.0 : clamp( ( H * H - rho * rho - d * d ) / ( 2.0 * r * d ), - 1.0, 1.0 );
		vec3 od = vec3( 0.0 );
		const int S = 40;
		for ( int i = 0; i < S; ++ i ) {
			float t = ( float( i ) + 0.5 ) / float( S ) * d;
			float ri = sqrt( r * r + t * t + 2.0 * r * mu * t );
			od += medium( ri ).ext * ( d / float( S ) );
		}
		o = vec4( exp( - od ), 1.0 );
	}
`;

const MULTI = COMMON + /* glsl */`
	uniform vec2 uSize;
	out vec4 o;
	void main() {
		vec2 uv = gl_FragCoord.xy / uSize;
		float muS = uv.x * 2.0 - 1.0, r = RG + uv.y * ( RT - RG ) + 0.01;
		vec3 sunD = vec3( sqrt( max( 1.0 - muS * muS, 0.0 ) ), muS, 0.0 );
		vec3 L2 = vec3( 0.0 ), fms = vec3( 0.0 );
		const int N = 64, S = 20;
		for ( int j = 0; j < N; ++ j ) {
			// (a Fibonacci sphere of directions)
			float fy = 1.0 - ( float( j ) + 0.5 ) / float( N ) * 2.0, rr = sqrt( max( 1.0 - fy * fy, 0.0 ) ), ph = float( j ) * 2.39996323;
			vec3 w = vec3( rr * cos( ph ), fy, rr * sin( ph ) );
			float mu = w.y;
			float tG = raySphere( r, mu, RG ), tT = raySphere( r, mu, RT );
			float tMax = tG > 0.0 ? tG : tT;
			if ( tMax <= 0.0 ) continue;
			vec3 T = vec3( 1.0 ), Lw = vec3( 0.0 ), Fw = vec3( 0.0 );
			for ( int i = 0; i < S; ++ i ) {
				float t0 = float( i ) / float( S ) * tMax, t1 = float( i + 1 ) / float( S ) * tMax, dt = t1 - t0, t = 0.5 * ( t0 + t1 );
				vec3 p = vec3( 0.0, r, 0.0 ) + w * t;
				float ri = length( p );
				Medium m = medium( ri );
				vec3 scat = m.scatR + vec3( m.scatM ), Ts = exp( - m.ext * dt );
				vec3 sunT = transmittance( ri, dot( p / ri, sunD ) );
				vec3 S1 = scat * sunT / ( 4.0 * PI );		// (isotropic, as Hillaire)
				Lw += T * ( S1 - S1 * Ts ) / max( m.ext, vec3( 1e-12 ) );
				Fw += T * ( scat - scat * Ts ) / max( m.ext, vec3( 1e-12 ) );
				T *= Ts;
			}
			if ( tG > 0.0 ) {
				// (the ground's light: albedo 0.06, the sea)
				vec3 p = vec3( 0.0, r, 0.0 ) + w * tG;
				float nl = max( dot( normalize( p ), sunD ), 0.0 );
				Lw += T * transmittance( RG, nl ) * nl * 0.06 / PI;
			}
			L2 += Lw / float( N ); fms += Fw / float( N );		// (the second order's light (isotropic phase already in Lw), and the share of it scattered again)
		}
		// all the orders beyond: the series 1 + f + f² ... (Hillaire's eq. 9)
		o = vec4( L2 / max( vec3( 1.0 ) - fms, vec3( 1e-3 ) ), 1.0 );
	}
`;

const VIEW = COMMON + /* glsl */`
	uniform vec2 uSize;
	uniform float uLightMu;		// (the light's cos zenith)
	uniform sampler2D uMulti;
	uniform float uEye;		// (km over the sea)
	out vec4 o;
	vec3 multi( float r, float mu ) { return texture( uMulti, vec2( mu * 0.5 + 0.5, ( r - RG ) / ( RT - RG ) ) ).rgb; }
	void main() {
		vec2 uv = gl_FragCoord.xy / uSize;
		float az = uv.x * PI;		// (from the light's azimuth, 0..π: the sky is symmetric about it)
		float vv = uv.y * 2.0 - 1.0;
		float el = sign( vv ) * vv * vv * PI * 0.5;
		vec3 d = vec3( cos( el ) * cos( az ), sin( el ), cos( el ) * sin( az ) );
		vec3 sunD = vec3( sqrt( max( 1.0 - uLightMu * uLightMu, 0.0 ) ), uLightMu, 0.0 );
		float r = RG + uEye;
		float tG = raySphere( r, d.y, RG ), tT = raySphere( r, d.y, RT );
		float tMax = tG > 0.0 ? tG : tT;
		float cth = dot( d, sunD ), pR = rayleighPhase( cth ), pM = miePhaseG( cth, MIE_G_VIEW );
		vec3 T = vec3( 1.0 ), L = vec3( 0.0 );
		const int S = 32;
		float tp = 0.0;
		for ( int i = 0; i < S; ++ i ) {
			float f = ( float( i ) + 1.0 ) / float( S ), t1 = tMax * f * f, dt = t1 - tp, t = 0.5 * ( tp + t1 );
			tp = t1;
			vec3 p = vec3( 0.0, r, 0.0 ) + d * t;
			float ri = length( p ), muS = dot( p / ri, sunD );
			Medium m = medium( ri );
			vec3 sunT = transmittance( ri, muS );
			vec3 S1 = ( m.scatR * pR + vec3( m.scatM * pM ) ) * sunT + ( m.scatR + vec3( m.scatM ) ) * multi( ri, muS );
			vec3 Ts = exp( - m.ext * dt );
			L += T * ( S1 - S1 * Ts ) / max( m.ext, vec3( 1e-12 ) );
			T *= Ts;
		}
		o = vec4( L, dot( T, vec3( 0.2126, 0.7152, 0.0722 ) ) );
	}
`;

/**
 * GLSL for the materials (backdrop, dome): the sky's colour by direction. Needs the Sky's uniforms
 * (sky.uniforms) and a `uTime`.
 */
export const SKY_GLSL = /* glsl */`
	uniform sampler2D uSkyView, uSkyTrans;
	uniform vec3 uSkyLight;		// (the light's direction: the sun's, or the moon's at night)
	uniform vec3 uSkyScale, uAirglow, uSkyHueProf[ 16 ], uSkyTint;
	uniform float uSkyHue, uClearDay, uCloudLight, uSkySat, uSkyExposure;
	// (the photo's own hue by elevation (tools/azurea-sky-matte.py: 0, 2.5 .. 37.5 deg), a chroma: rgb / luminance)
	vec3 skyHueAt( float el ) {
		float e = clamp( el / 0.0436332, 0.0, 15.0 );
		int i = int( floor( e ) );
		return mix( uSkyHueProf[ i ], uSkyHueProf[ min( i + 1, 15 ) ], e - float( i ) );
	}
	uniform float uStars, uClouds, uWisps, uSkyEyeR, uCloudHorizon, uCloudWind;
	const float SKY_PI = 3.14159265359;
	vec2 skyTransUV( float r, float mu ) {
		float H = sqrt( 6460.0 * 6460.0 - 6360.0 * 6360.0 ), rho = sqrt( max( r * r - 6360.0 * 6360.0, 0.0 ) );
		float d = max( - r * mu + sqrt( max( r * r * ( mu * mu - 1.0 ) + 6460.0 * 6460.0, 0.0 ) ), 0.0 );
		float dmin = 6460.0 - r, dmax = rho + H;
		return vec2( ( d - dmin ) / max( dmax - dmin, 1e-6 ), rho / H );
	}
	vec3 skyTrans( float r, float mu ) {
		float muH = - sqrt( max( 1.0 - 6360.0 * 6360.0 / ( r * r ), 0.0 ) );
		if ( mu < muH ) return vec3( 0.0 );
		return texture( uSkyTrans, skyTransUV( r, mu ) ).rgb;
	}
	// the air's light in direction d (the LUT, at unit light), in the photos' units
	vec4 skyAir( vec3 d ) {
		vec2 lh = normalize( uSkyLight.xz + vec2( 1e-6, 0.0 ) ), dh = d.xz / max( length( d.xz ), 1e-6 );
		float az = acos( clamp( dot( lh, dh ), - 1.0, 1.0 ) );
		float el = asin( clamp( d.y, - 1.0, 1.0 ) );
		float v = 0.5 + 0.5 * sign( el ) * sqrt( abs( el ) / ( SKY_PI * 0.5 ) );
		vec2 uv = vec2( az / SKY_PI, v );
		// (texel centres: the LUT is 192 × 108)
		uv = ( uv * ( vec2( 192.0, 108.0 ) - 1.0 ) + 0.5 ) / vec2( 192.0, 108.0 );
		vec4 a = texture( uSkyView, uv );
		// (airglow: brighter to the horizon, van Rhijn: 1 / sqrt( 1 - 0.96 cos² z ))
		// (capped at 2.5: the haze hides the last of it)
		float vr = min( 1.0 / sqrt( max( 1.0 - 0.96 * ( 1.0 - max( d.y, 0.0 ) * max( d.y, 0.0 ) ), 0.04 ) ), 2.5 );
		vec3 c = a.rgb * ( uSkyScale * uSkyExposure );
		// (the hue: towards the photo's at this elevation (its warm horizon, its blue above), its luminance kept: the
		// brightness and the glow round the light the air's own)
		float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
		c = mix( c, l * skyHueAt( el ), uSkyHue );
		// Clear day: one colour × gain (uSkyTint) over the clear air, before clouds and the disc (the reflections' sky
		// too); the horizon's whitening and the glow round the sun are the atmosphere's own
		if ( uClearDay > 0.5 ) c *= uSkyTint;
		// (saturation about the luminance: 1 leaves the air's own colour, > 1 deepens it; the sea tint no longer
		// touches the air, so this is where the sky's colour is set)
		if ( uSkySat != 1.0 ) {
			float ls = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
			c = max( vec3( 0.0 ), ls + ( c - ls ) * uSkySat );
		}
		return vec4( c + uAirglow * vr * mix( 1.0, a.a, 0.5 ) * uSkyExposure, a.a );
	}
	uint skyPcg( uvec3 v ) {
		v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
		v ^= v >> 16u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v.x ^ v.y ^ v.z;
	}
	float skyRnd( uint h ) { return float( h & 0xffffffu ) / 16777216.0; }
	// the stars: one candidate per cell of a cube grid round the eye (~5000 over the sphere), its magnitude drawn by
	// the counts' law (N( < m ) ~ 10^0.5m, to 6), its colour by a temperature; a point of its flux spread over the
	// pixel (a Gaussian of the pixel's width: sub-pixel, its sum the flux whatever the resolution), dimmed by the air
	// (the transmittance towards it: red near the horizon), twinkling more low down
	vec3 skyStars( vec3 d, float pix ) {
		if ( uStars <= 0.0 || d.y < - 0.01 ) return vec3( 0.0 );
		const float G = 22.0;
		vec3 c = floor( d * G );
		uvec3 h = uvec3( ivec3( c ) + 4096 );
		uint s = skyPcg( h );
		vec3 sp = normalize( c + 0.2 + 0.6 * vec3( skyRnd( s ), skyRnd( s * 747796405u + 1u ), skyRnd( s * 2891336453u + 7u ) ) );
		// (its own cell, its centre half: never cut by the neighbours' check)
		vec3 f = sp * G - c;
		if ( any( lessThan( f, vec3( 0.12 ) ) ) || any( greaterThan( f, vec3( 0.88 ) ) ) ) return vec3( 0.0 );
		float m = 6.0 + 2.0 * log( max( skyRnd( s ^ 0x9e3779b9u ), 1e-6 ) ) / log( 10.0 );		// (P( < m ) = 10^0.5( m - 6 ))
		if ( m < - 1.5 ) return vec3( 0.0 );
		float flux = pow( 10.0, - 0.4 * m );
		float w = max( pix, 1e-5 ) * 0.6;		// (the footprint's sigma: a little under the pixel)
		float a = acos( clamp( dot( d, sp ), - 1.0, 1.0 ) );
		float g = exp( - 0.5 * a * a / ( w * w ) ) / ( 2.0 * SKY_PI * w * w );
		// (its colour: blue-white to orange)
		float tk = skyRnd( s * 1103515245u + 12345u );
		vec3 col = mix( vec3( 1.0, 0.72, 0.45 ), vec3( 0.75, 0.85, 1.0 ), smoothstep( 0.1, 0.9, tk ) );
		col /= dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
		vec3 T = skyTrans( uSkyEyeR, max( sp.y, 0.0 ) );
		// (twinkling: stronger low down; a smooth random in time)
		float tw = 1.0;
		{
			float tt = uTime * 9.0 + skyRnd( s * 69069u ) * 100.0, i0 = floor( tt ), fr = tt - i0;
			float r0 = skyRnd( skyPcg( h + uvec3( uint( i0 ) ) ) ), r1 = skyRnd( skyPcg( h + uvec3( uint( i0 ) + 1u ) ) );
			tw = 1.0 + ( mix( r0, r1, fr * fr * ( 3.0 - 2.0 * fr ) ) - 0.5 ) * 0.9 * ( 1.0 - smoothstep( 0.05, 0.5, sp.y ) );
		}
		return uStars * flux * g * col * T * tw;
	}
	float skyHash2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
	float skyNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( skyHash2( i ), skyHash2( i + vec2( 1, 0 ) ), f.x ), mix( skyHash2( i + vec2( 0, 1 ) ), skyHash2( i + vec2( 1, 1 ) ), f.x ), f.y ); }
	// Distant cloud banks: coverage rises with spherical distance, so the horizon is
	// brightened by real layer intersection/slant optical depth rather than a screen tint.
	float skyCloudBank( float distanceKm, float heightKm ) {
		return mix( 1.0, smoothstep( heightKm * 6.0, heightKm * 13.0, distanceKm ), uCloudHorizon );
	}
	vec2 skyCloudWind( vec2 p ) {
		float c = cos( uCloudWind ), s = sin( uCloudWind );
		return mat2( c, - s, s, c ) * p;
	}
	// thin high cloud (cirrus, cirrostratus: a layer 8 km up): streaks of fbm along the wind, lit by the light through
	// the air above it (the transmittance from 8 km: gold at sunset), forward scattering, and the sky's own light
	vec4 skyCloud( vec3 d, float blur, bool airOn ) {
		if ( uClouds <= 0.0 || d.y < 0.002 ) return vec4( 0.0 );
		float rc = 6360.0 + 8.0, r0 = uSkyEyeR;
		float b = r0 * d.y, t = - b + sqrt( b * b - r0 * r0 + rc * rc );		// (km to the layer)
		vec2 p = d.xz * t;		// (km on the layer)
		p += vec2( 0.012, 0.004 ) * uTime;		// (drift: ~12 m/s)
		vec2 wind = skyCloudWind( p );
		vec2 q = mix( vec2( p.x * 0.55 + p.y * 0.2, p.y * 1.6 - p.x * 0.3 ), wind * vec2( 0.32, 1.8 ), uCloudHorizon );		// (wind-sheared streaks)
		float n = 0.0, amp = 0.5, fq = 0.12;
		// (the octaves finer than the pixel's or the blur's footprint left out: no shimmer at the horizon)
		float layerMu = sqrt( max( 1.0 - pow( r0 / rc, 2.0 ) * ( 1.0 - d.y * d.y ), 0.0001 ) );
		float foot = max( t * max( blur, 1e-4 ) / mix( max( d.y, 0.02 ), sqrt( layerMu ), uCloudHorizon ), 1e-3 );
		for ( int i = 0; i < 6; ++ i ) {
			float k = 1.0 - smoothstep( 0.5, 2.0, foot * fq );
			n += amp * ( skyNoise( q * fq ) * k + 0.5 * ( 1.0 - k ) );
			fq *= 2.07; amp *= 0.5; q = mat2( 0.8, 0.6, - 0.6, 0.8 ) * q + 3.1;
		}
		float weather = mix( 1.0, smoothstep( 0.24, 0.72, skyNoise( p * 0.016 + 7.1 ) ), uCloudHorizon );
		float coverage = uClouds * skyCloudBank( t, 8.0 ) * weather;
		float cov = smoothstep( 1.0 - coverage, 1.0 - coverage + mix( 0.35, 0.24, uCloudHorizon ), n );
		float slant = inversesqrt( max( 1.0 - pow( r0 / rc, 2.0 ) * ( 1.0 - d.y * d.y ), 0.001 ) );
		float tau = cov * mix( 0.9, min( 2.0, 0.13 * slant ), uCloudHorizon );
		float alpha = 1.0 - exp( - tau );
		if ( ! airOn ) return vec4( vec3( 0.95, 0.97, 1.0 ) * uCloudLight, alpha );
		vec3 Lc = skyTrans( rc, dot( normalize( vec3( 0.0, rc, 0.0 ) + d * t ), uSkyLight ) );
		float c = dot( d, uSkyLight ), g = 0.6, ph = 0.6 * ( 1.0 - g * g ) / ( 4.0 * SKY_PI * pow( 1.0 + g * g - 2.0 * g * c, 1.5 ) ) + 0.4 / ( 4.0 * SKY_PI );
		vec4 air = skyAir( d );
		// (lit: the light (unit illuminance in the LUT's units, so the sky's scale) by the phase, a cloud's
		// white; plus the sky's light on it; then seen through the air below it (its own transmittance))
		vec3 lit = Lc * ph * uSkyScale * mix( 5.0, 1.35, uCloudHorizon ) + skyAir( normalize( vec3( d.x, max( d.y, 0.05 ) + 0.3, d.z ) ) ).rgb * 0.7;
		vec3 Tv = vec3( pow( max( air.a, 0.0 ), 0.5 ) );
		return vec4( lit * Tv + air.rgb * ( 1.0 - Tv ), alpha );
	}
	// sparse thin cloud lower down (fair-weather wisps, a layer 2.5 km up): scattered patches a km or two across,
	// soft-edged and thin (half the light through at their cores), drifting slowly; lit as the cirrus, with a darker
	// underside where they are densest (a little self-shadow), seen through the air below them
	vec4 skyWisp( vec3 d, float blur, bool airOn ) {
		if ( uWisps <= 0.0 || d.y < 0.004 ) return vec4( 0.0 );
		float rc = 6360.0 + 2.5, r0 = uSkyEyeR;
		float b = r0 * d.y, t = - b + sqrt( b * b - r0 * r0 + rc * rc );
		vec2 p = d.xz * t + vec2( 0.006, - 0.0025 ) * uTime + vec2( 37.0, 11.0 );
		vec2 wind = skyCloudWind( p );
		vec2 q = mix( vec2( p.x * 0.8 + p.y * 0.15, p.y * 1.25 - p.x * 0.1 ), wind * vec2( 0.65, 1.2 ), uCloudHorizon );		// (stretched along the wind)
		float layerMu = sqrt( max( 1.0 - pow( r0 / rc, 2.0 ) * ( 1.0 - d.y * d.y ), 0.0001 ) );
		float foot = max( t * max( blur, 1e-4 ) / mix( max( d.y, 0.02 ), sqrt( layerMu ), uCloudHorizon ), 1e-3 );
		float n = 0.0, amp = 0.5, fq = mix( 0.45, 0.10, uCloudHorizon );
		for ( int i = 0; i < 6; ++ i ) {
			float k = 1.0 - smoothstep( 0.5, 2.0, foot * fq );
			n += amp * ( skyNoise( q * fq ) * k + 0.5 * ( 1.0 - k ) );
			fq *= 2.13; amp *= 0.5; q = mat2( 0.8, - 0.6, 0.6, 0.8 ) * q + 5.7;
		}
		// (sparse: where a broad mask allows (a quarter of the sky at cover 1) and the detail is high)
		float coverage = uWisps * skyCloudBank( t, 1.4 );
		float mask = smoothstep( 0.72 - mix( 0.16, 0.30, uCloudHorizon ) * coverage, 0.84 - mix( 0.16, 0.30, uCloudHorizon ) * coverage, skyNoise( p * mix( 0.07, 0.012, uCloudHorizon ) + 3.3 ) );
		float dens = smoothstep( mix( 0.58, 0.36, uCloudHorizon ), mix( 0.88, 0.70, uCloudHorizon ), n ) * mask * min( 1.0, 0.5 + coverage );
		dens *= mix( 1.0, skyCloudBank( t, 1.4 ), uCloudHorizon );
		float slant = inversesqrt( max( 1.0 - pow( r0 / rc, 2.0 ) * ( 1.0 - d.y * d.y ), 0.0005 ) );
		float tau = dens * mix( 0.5, min( 3.0, 0.22 * slant ), uCloudHorizon );
		float alpha = 1.0 - exp( - tau );
		if ( ! airOn ) return vec4( vec3( 0.95, 0.97, 1.0 ) * uCloudLight, alpha );
		vec3 Lc = skyTrans( rc, dot( normalize( vec3( 0.0, rc, 0.0 ) + d * t ), uSkyLight ) );
		float c = dot( d, uSkyLight ), g = 0.55, ph = 0.55 * ( 1.0 - g * g ) / ( 4.0 * SKY_PI * pow( 1.0 + g * g - 2.0 * g * c, 1.5 ) ) + 0.45 / ( 4.0 * SKY_PI );
		vec4 air = skyAir( d );
		vec3 lit = Lc * ph * uSkyScale * mix( 5.0, 1.35, uCloudHorizon ) * mix( 1.0, 0.7, smoothstep( 0.3, 0.9, dens ) ) + skyAir( normalize( vec3( d.x, max( d.y, 0.05 ) + 0.3, d.z ) ) ).rgb * 0.75;
		vec3 Tv = vec3( pow( max( air.a, 0.0 ), 0.35 ) );
		return vec4( lit * Tv + air.rgb * ( 1.0 - Tv ), alpha );
	}
	vec3 skyColor( vec3 d, float pix, float blur, bool airOn ) {
		vec3 c = airOn ? skyAir( d ).rgb : vec3( 0.0 );
		vec4 cl = skyCloud( d, max( pix, blur ), airOn );
		if ( airOn ) c += skyStars( d, max( pix, blur ) ) * ( 1.0 - cl.a );
		c = mix( c, cl.rgb, cl.a );
		vec4 w = skyWisp( d, max( pix, blur ), airOn );
		return mix( c, w.rgb, w.a );
	}
`;

/** The disc of the sun or the moon (and its halo) in direction d, drawn as before (sizes kept); the moon's face mapped. */
export const DISC_GLSL = /* glsl */`
	uniform sampler2D uMoonTex;
	uniform float uSunCore;		// (the sun's disc core × this: its brightness against the sky; the halo and the sea's glitter not)
	uniform float uMoonCore;		// (the moon's disc × this: low enough that its face is not tone-mapped to a flat white)
	vec3 skyDisc( vec3 vd, vec3 L, vec3 color, float moon ) {
		float ang = acos( clamp( dot( vd, L ), - 1.0, 1.0 ) );
		float R = moon > 0.5 ? 0.0115 : 0.0135, aa = 0.0009;
		float disc = 1.0 - smoothstep( R - aa, R + aa, ang );
		if ( moon > 0.5 ) {
			// the moon: its near side (NASA SVS's LROC map, public domain: public/azurea/moon.png, mean 0.5), north up
			vec3 t1 = normalize( cross( L, vec3( 0.0, 1.0, 0.0 ) ) ), t2 = cross( t1, L );
			vec2 q = vec2( - dot( vd, t1 ), dot( vd, t2 ) ) / R;
			// (its albedo as mapped: the maria ~0.6 of the highlands; a full moon is near uniform to the limb, the
			// opposition surge: a little darkening only)
			// (its contrast raised: the tone curve's shoulder compresses the face's top; × 1.5 in log, mean ~ kept)
			float alb = disc > 0.0 ? pow( max( texture( uMoonTex, q * 0.5 + 0.5 ).r * 2.0, 0.0 ), 1.5 ) * 1.04 : 1.0;
			float limb = sqrt( max( 1.0 - dot( q, q ), 0.0 ) );
			return color * ( disc * 9.0 * uMoonCore * ( 0.88 + 0.12 * limb ) * alb + 0.5 * exp( - ang / 0.02 ) + 0.12 * exp( - ang / 0.12 ) );
		}
		return color * ( disc * 14.0 * uSunCore + 1.2 * exp( - ang / 0.02 ) + 0.35 * exp( - ang / 0.09 ) + 0.06 * exp( - ang / 0.30 ) );
	}
`;

const lum = c => 0.2126 * c[ 0 ] + 0.7152 * c[ 1 ] + 0.0722 * c[ 2 ];

export class Sky {

	constructor() {

		const rt = ( w, h ) => new THREE.WebGLRenderTarget( w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping } );
		this.trans = rt( 256, 64 ); this.multi = rt( 32, 32 ); this.view = rt( 192, 108 );
		const quad = ( fs, u ) => new FullScreenQuad( new THREE.RawShaderMaterial( { glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false } ) );
		const haze = { value: 1 }, rayHeight = { value: 8 };
		this.qTrans = quad( TRANS, { uHaze: haze, uRayHeight: rayHeight, uSize: { value: new THREE.Vector2( 256, 64 ) }, uTrans: { value: null } } );
		this.qMulti = quad( MULTI, { uHaze: haze, uRayHeight: rayHeight, uSize: { value: new THREE.Vector2( 32, 32 ) }, uTrans: { value: this.trans.texture } } );
		this.qView = quad( VIEW, { uHaze: haze, uRayHeight: rayHeight, uSize: { value: new THREE.Vector2( 192, 108 ) }, uTrans: { value: this.trans.texture }, uMulti: { value: this.multi.texture }, uLightMu: { value: 0.5 }, uEye: { value: 0.03 } } );
		this.haze = haze; this.rayHeight = rayHeight;
		const grey = Object.assign( new THREE.DataTexture( new Uint8Array( [ 128, 128, 128, 255 ] ), 1, 1 ), { needsUpdate: true } );
		this.uniforms = {
			uSkyView: { value: this.view.texture }, uSkyTrans: { value: this.trans.texture },
			uSkyLight: { value: new THREE.Vector3( 0, 1, 0 ) }, uSkyScale: { value: new THREE.Vector3( 1, 1, 1 ) }, uAirglow: { value: new THREE.Vector3() },
			uStars: { value: 0 }, uClouds: { value: 0 }, uWisps: { value: 0 }, uSkyEyeR: { value: 6360.03 }, uMoonTex: { value: grey }, uSunCore: { value: 1 }, uMoonCore: { value: 1 },
			uCloudHorizon: { value: 0 }, uCloudWind: { value: 0 },
			uCloudLight: { value: 1 }, uClearDay: { value: 0 }, uSkyHue: { value: 0 }, uSkyHueProf: { value: Array.from( { length: 16 }, () => new THREE.Vector3( 1, 1, 1 ) ) },
			uSkySat: { value: 1 }, uSkyExposure: { value: 1 },
			uSkyTint: { value: new THREE.Vector3( 0.36, 0.98, 2.7 ) },
		};
		this.params = null; this._built = null; this.dirty = true;
		this._buf = new Uint16Array( 192 * 108 * 4 );
		this._bufRef = new Uint16Array( 192 * 108 * 4 );		// (the same air at haze 1: the scale's reference)
		this.mean = [ 1, 1, 1 ];		// (the band's mean sky colour after the scale: the portal light's)

	}

	/**
	 * The state: light (unit direction, the sun's or the moon's), haze (Mie density × Hillaire's), target (linear
	 * RGB: the photo's clear sky's mean over the band), hue (0: the atmosphere's own, 1: the photo's), airglow
	 * (a share of the target: the night's), stars (0..), clouds (0..1 cover), wisps (the lower thin cloud's, 0..1),
	 * rayH (the molecular scale height, km), sat (the sky's saturation about its luminance), exposure (its gain),
	 * tint (clear day: a linear rgb gain on the air's colour).
	 */
	set( p ) {

		const key = JSON.stringify( [ p.light.x.toFixed( 4 ), p.light.y.toFixed( 4 ), p.light.z.toFixed( 4 ), p.haze, p.clearDay, p.target.map( v => v.toFixed( 5 ) ), p.hue, p.airglow, p.rayH, p.profile?.[ 0 ] ] );
		this.uniforms.uSkyLight.value.copy( p.light );
		this.uniforms.uClearDay.value = p.clearDay ? 1 : 0;
		this.uniforms.uStars.value = p.stars ?? 0;
		if ( p.profile ) p.profile.forEach( ( c, i ) => this.uniforms.uSkyHueProf.value[ i ]?.set( c[ 0 ], c[ 1 ], c[ 2 ] ) );
		this.uniforms.uCloudLight.value = 2.0 * lum( p.target );
		this.uniforms.uClouds.value = p.clouds ?? 0;
		this.uniforms.uWisps.value = p.wisps ?? 0;
		this.uniforms.uCloudHorizon.value = p.cloudHorizon ?? 0;
		this.uniforms.uCloudWind.value = ( p.cloudWind ?? 0 ) * Math.PI / 180;
		this.uniforms.uSkySat.value = p.sat ?? 1;
		this.uniforms.uSkyExposure.value = p.exposure ?? 1;
		if ( p.tint ) this.uniforms.uSkyTint.value.copy( p.tint );
		this.params = p;
		if ( key !== this._key ) { this._key = key; this.dirty = true; }

	}

	/** The LUTs and the scale, if the state changed (a few ms). */
	update( renderer ) {

		if ( ! this.dirty || ! this.params ) return;
		this.dirty = false;
		const p = this.params, prev = renderer.getRenderTarget(), auto = renderer.autoClear;
		renderer.autoClear = false;
		const height = Math.max( p.rayH ?? ( p.clearDay ? 5.0 : 8.0 ), 0 );
		// the LUTs for an air (its haze, its molecular scale height); the transmittance and multiple scattering
		// rebuilt only when that air changes
		const build = ( haze, h ) => {

			const k = haze + ',' + h;
			if ( this._lut !== k ) {

				this._lut = k; this.haze.value = haze; this.rayHeight.value = h;
				renderer.setRenderTarget( this.trans ); this.qTrans.render( renderer );
				renderer.setRenderTarget( this.multi ); this.qMulti.render( renderer );

			}
			renderer.setRenderTarget( this.view ); this.qView.render( renderer );

		};
		this.qView.material.uniforms.uLightMu.value = THREE.MathUtils.clamp( p.light.y, - 1, 1 );
		// the scale's reference: a fixed air (haze 1, the hour's usual scale height: 5 km clear day, else 8), so
		// neither the haze nor the scale height is normalised away — less air is a darker, less blue sky, as it is.
		// Built first: the LUTs end as the state's own (the stars' and clouds' transmittance read them)
		const refH = p.clearDay ? 5.0 : 8.0;
		let ref = this._buf;
		if ( p.haze !== 1 || height !== refH ) {

			build( 1, refH );
			renderer.readRenderTargetPixels( this.view, 0, 0, 192, 108, this._bufRef );
			ref = this._bufRef;

		}
		build( p.haze, height );
		renderer.readRenderTargetPixels( this.view, 0, 0, 192, 108, this._buf );
		renderer.setRenderTarget( prev ); renderer.autoClear = auto;
		// the band's mean (the LUT's): 5..30 deg up over the photo's azimuths (pa0..pa1, absolute; from the light's)
		const f = THREE.DataUtils.fromHalfFloat;
		let n = 0;
		const la = Math.atan2( p.light.z, p.light.x );
		const bandMean = B => {

			const s = [ 0, 0, 0 ];
			n = 0;
			for ( let i = 0; i < 24; ++ i ) for ( let j = 0; j < 8; ++ j ) {

				const a = p.az0 + ( p.az1 - p.az0 ) * ( i + 0.5 ) / 24, el = ( 5 + 25 * ( j + 0.5 ) / 8 ) * Math.PI / 180;
				let da = Math.abs( ( ( a - la ) % ( 2 * Math.PI ) + 3 * Math.PI ) % ( 2 * Math.PI ) - Math.PI );
				// (not the light's own glow: the sky's level is the rest's, as the photo's even sky)
				const cosA = Math.cos( el ) * Math.cos( Math.asin( Math.max( - 1, Math.min( 1, p.light.y ) ) ) ) * Math.cos( da ) + Math.sin( el ) * p.light.y;
				if ( cosA > Math.cos( 20 * Math.PI / 180 ) ) continue;
				const u = da / Math.PI, v = 0.5 + 0.5 * Math.sqrt( el / ( Math.PI / 2 ) );
				const x = Math.min( 191, Math.max( 0, Math.round( u * 191 ) ) ), y = Math.min( 107, Math.max( 0, Math.round( v * 107 ) ) ), k = 4 * ( y * 192 + x );
				s[ 0 ] += f( B[ k ] ); s[ 1 ] += f( B[ k + 1 ] ); s[ 2 ] += f( B[ k + 2 ] ); n ++;

			}
			return s.map( v => Math.max( v / n, 1e-9 ) );

		};
		const m = bandMean( this._buf ), mRef = ref === this._buf ? m : bandMean( ref ), T = p.target, glow = p.airglow ?? 0;
		// (the air's share of the target: all of it by day; at night the airglow takes its part)
		const Tair = T.map( v => v * ( 1 - glow ) );
		const k = lum( Tair ) / lum( mRef );
		this.uniforms.uSkyScale.value.set( k, k, k );		// (the luminance matched at haze 1; the haze's own share kept)
		const tl = lum( Tair ) || 1;
		this.uniforms.uSkyHue.value = p.hue ?? 0;
		const hue = p.hue ?? 0, ml = lum( m ) * k, sc = m.map( ( v, c ) => ( v * k * ( 1 - hue ) + ml * Tair[ c ] / tl * hue ) / Math.max( v, 1e-9 ) );
		const g = lum( T ) * glow;
		// (its colour: the night sky's own (the photo's), barely greener: the O I line, seen through the moon's blue air)
		const tn = lum( T ) || 1;
		this.uniforms.uAirglow.value.set( g * T[ 0 ] / tn, g * T[ 1 ] / tn * 1.04, g * T[ 2 ] / tn );
		this.mean = m.map( ( v, c ) => v * sc[ c ] + this.uniforms.uAirglow.value.getComponent( c ) );

	}

	setMoonTexture( t ) { this.uniforms.uMoonTex.value = t; }

	dispose() {

		for ( const t of [ this.trans, this.multi, this.view ] ) t.dispose();
		this.qTrans.dispose(); this.qMulti.dispose(); this.qView.dispose();

	}

}

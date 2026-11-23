// Azurea's distant coast: procedural ridges at infinity, drawn by the backdrop (src/azurea.js) over its sky and
// mirrored by its sea. They replace the sea photos' own thin strips of land (those sat at the panorama's very ends,
// out of the lobby's view). After the references (Footages.local/azurea): a headland to the right of the view out to
// sea — a far pale ridge behind, green wooded hills with a steep tip in the middle distance, a low promontory with
// white limestone cliffs at its foot in front — and, to the left, faint far islands and a few near rocks.
//
// Each layer: a silhouette (its crest's elevation by azimuth: an envelope × ridged noise), a distance (km: the haze
// between, and the scale of its detail), its surface lit as the clouds are (src/sky.js: the light through the air ×
// a Lambert term, plus the sky's light), then seen through the air: lit × T + the air's colour × ( 1 - T ),
// T = exp( - 3.912 d / visibility ). The layers composited far to near, their edges a pixel soft (blurred by the
// sea's slope spread in the reflection). Azimuths are the backdrop's: atan( z, x ), the sea from -170 to -10 deg.
//
// Needs (from the backdrop's shader): azHash, SKY_GLSL (skyAir, skyTrans, uSkyLight, uSkyScale, uSkyEyeR),
// PHOTO_SKY_GLSL (uAtmosphere, uCloudsOnly), uSunE, uLightDir, uTime.
export const MOUNTAIN_GLSL = /* glsl */`
	uniform float uMtn, uMtnSun, uMtnVis, uMtnLights;
	float mtnN1( float x ) { float i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f ); return mix( azHash( vec2( i, 7.13 ) ), azHash( vec2( i + 1.0, 7.13 ) ), f ); }
	// (ridged fbm, ~0..1: sharp crests, rounded valleys)
	float mtnRidge( float x ) {
		// (the coarse octaves smooth, the fine ones ridged and weak: long slopes, a little crest detail)
		float n = 0.0, a = 0.6, s = 0.0;
		for ( int i = 0; i < 5; ++ i ) { float v = mtnN1( x ), r = 1.0 - abs( 2.0 * v - 1.0 ); n += a * ( i < 2 ? v : r * r ); s += a; x = x * 2.13 + 1.7; a *= 0.38; }
		return n / s;
	}
	float mtnN2( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( azHash( i ), azHash( i + vec2( 1, 0 ) ), f.x ), mix( azHash( i + vec2( 0, 1 ) ), azHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
	float mtnFbm2( vec2 p ) { float n = 0.0, a = 0.5; for ( int i = 0; i < 4; ++ i ) { n += a * mtnN2( p ); p = mat2( 1.6, 1.2, - 1.2, 1.6 ) * p + 3.3; a *= 0.5; } return n / 0.9375; }
	float mtnEnv( float A, float a0, float w0, float a1, float w1 ) { return smoothstep( a0, a0 + w0, A ) * ( 1.0 - smoothstep( a1 - w1, a1, A ) ); }
	float mtnBump( float A, float c, float w ) { float x = ( A - c ) / w; return max( 1.0 - x * x, 0.0 ); }
	const int MTN_N = 6;
	// (km: the layers' distances, far to near)
	float mtnDist( int i ) { return i == 0 ? 36.0 : i == 1 ? 30.0 : i == 2 ? 13.0 : i == 3 ? 6.5 : i == 4 ? 2.6 : 2.2; }
	// the crest's elevation (deg) at azimuth A (deg)
	float mtnH( int i, float A ) {
		if ( i == 0 ) {		// far islands, left of the lobby view's centre and just right of the bar: faint low humps
			float e = mtnBump( A, - 136.0, 5.5 ) * 0.42 + mtnBump( A, - 127.5, 3.2 ) * 0.30 + mtnBump( A, - 121.0, 2.2 ) * 0.18 + mtnBump( A, - 113.0, 6.0 ) * 0.32;
			return e * ( 0.75 + 0.5 * mtnRidge( A * 0.6 + 11.0 ) );
		}
		if ( i == 1 ) {		// the far ridge behind the headland: long, pale, rising to the right
			float e = mtnEnv( A, - 128.0, 22.0, 6.0, 8.0 );
			return e * ( 0.45 + 0.9 * smoothstep( - 110.0, - 50.0, A ) ) * ( 0.8 + 0.35 * mtnRidge( A * 0.08 + 3.0 ) );
		}
		if ( i == 2 ) {		// the mountain behind the headland: a long shoulder from the left, high to the right, hazy
			float e = mtnEnv( A, - 106.0, 30.0, 8.0, 6.0 );
			// (its crest under ~3.5 deg: the golden hour's sun (az -50, el 4.5) sets clear of it)
			return e * ( 1.1 + 2.0 * smoothstep( - 82.0, - 30.0, A ) ) * ( 0.78 + 0.35 * mtnRidge( A * 0.1 + 7.0 ) );
		}
		if ( i == 3 ) {		// the left headland, past the stair (the panorama's left end), and its spur
			float e = sqrt( 1.0 - smoothstep( - 161.0, - 155.0, A ) ) * step( - 200.0, A );
			return e * 1.25 * ( 0.7 + 0.45 * mtnRidge( A * 0.15 + 2.0 ) );
		}
		if ( i == 4 ) {		// the near headland: a steep tip of white cliffs to the sea, wooded above, a low rocky point off it
			float e = sqrt( mtnEnv( A, - 100.0, 2.5, - 24.0, 12.0 ) );
			float h = e * ( 1.3 + 1.0 * smoothstep( - 98.0, - 70.0, A ) ) * ( 0.7 + 0.5 * mtnRidge( A * 0.22 + 5.0 ) );
			return max( h, mtnBump( A, - 102.0, 3.0 ) * 0.14 * ( 0.8 + 0.4 * mtnRidge( A * 2.0 ) ) );
		}
		// near rocks off the left headland
		return ( mtnBump( A, - 151.5, 1.1 ) * 0.30 + mtnBump( A, - 147.8, 0.55 ) * 0.17 + mtnBump( A, - 145.6, 0.35 ) * 0.09 ) * ( 0.8 + 0.4 * mtnRidge( A * 3.0 ) );
	}
	// a layer's surface at (A, U) (deg), its crest h there, seen in direction vd: its colour after the air between.
	// air: the air's own colour in this direction (what the haze tends to); amb: the sky's light on it
	vec3 mtnShade( int i, float A, float U, float h, vec3 vd, vec3 air, vec3 amb, vec3 sunI, vec3 Ls ) {
		float d = mtnDist( i ), rel = clamp( U / max( h, 1e-3 ), 0.0, 1.0 );
		// (the crest's slope along the azimuth (deg / deg: as a true slope, both at the same distance), the faces
		// turned that way; its detail: 2D noise in the layer's own metres)
		// (over a few degrees: the hill's flank, not the crest's every notch; fine notches turn no whole face)
		float dh = clamp( ( mtnH( i, A + 1.2 ) - mtnH( i, A - 1.2 ) ) / 2.4, - 0.6, 0.6 );
		// (the detail in the layer's own metres: gullies down the flanks, leaning with the slope)
		vec2 p = vec2( ( A + 0.6 * U ) * 0.9, U * 0.5 ) * ( d * 0.30 ) + float( i ) * 17.0;
		float n0 = mtnFbm2( p ), e = 0.35;
		float gx = ( mtnFbm2( p + vec2( e, 0.0 ) ) - n0 ) / e, gy = ( mtnFbm2( p + vec2( 0.0, e ) ) - n0 ) / e;
		vec2 hz = normalize( vd.xz + vec2( 1e-6, 0.0 ) );
		vec3 toEye = - vec3( hz.x, 0.0, hz.y ), tAz = vec3( - hz.y, 0.0, hz.x );
		// (the face towards the sea (the eye), leaning back; the profile's slope and the gullies turning it)
		// (the coast's faces turned to the open sea, to the left of the view: the headlands run out from the right)
		vec3 n = normalize( toEye * 0.85 - tAz * 0.6 * step( 1.5, float( i ) ) * step( float( i ), 4.5 ) + vec3( 0.0, 1.0, 0.0 ) * ( 0.75 + 0.25 * rel - 0.35 * gy ) + tAz * ( - 1.6 * dh - 0.3 * gx ) );
		// albedo: woods (dark and olive patches), scrub higher up, limestone in the near layers' feet and steep tips
		float veg = mtnFbm2( p * 0.7 + 5.0 );
		float near = 1.0 - smoothstep( 4.0, 10.0, d );
		vec3 alb = mix( vec3( 0.030, 0.058, 0.026 ), vec3( 0.075, 0.098, 0.045 ), smoothstep( 0.3, 0.75, veg ) );
		// (the near woods' crowns: a fine speckle of lit tops and shaded gaps)
		float crown = mtnN2( vec2( A, U * 1.3 ) * d * 4.0 ) * 0.6 + mtnN2( vec2( A, U * 1.3 ) * d * 9.0 ) * 0.4;
		alb *= mix( 1.0, 0.55 + 0.9 * crown, near );
		alb = mix( alb, vec3( 0.13, 0.12, 0.09 ), 0.35 * smoothstep( 0.6, 1.0, rel ) * smoothstep( 0.45, 0.7, n0 ) );
		// (the near layers' limestone: in stretches along the coast (between them the woods come down to a thin
		// rocky shore) a cliff up to half the height, its top edge ragged; the point's rocks all bare)
		float stretch = smoothstep( 0.38, 0.6, mtnN2( vec2( A * 0.32 + float( i ) * 3.1, 1.5 ) ) );
		float top = mix( 0.1, 0.55, stretch ) + 0.3 * ( n0 - 0.5 ) + 0.08 * ( crown - 0.5 );
		float rock = near * ( 1.0 - smoothstep( top - 0.04, top + 0.04, rel ) ) * smoothstep( 0.2, 0.35, h );
		rock = max( rock, near * ( 1.0 - smoothstep( 0.15, 0.3, h ) ) );
		rock = max( rock, near * smoothstep( 0.9, 1.8, abs( dh ) ) * smoothstep( 0.5, 0.65, n0 ) );
		rock = max( rock, ( i == 5 ? 0.85 : 0.0 ) );
		// (the limestone: pale, its bedding and joints darker, stained under the woods)
		float bed = mtnN2( vec2( A * d * 1.2, U * d * 6.0 ) ), joint = mtnN2( vec2( A * d * 6.0, U * d * 0.8 ) );
		vec3 stone = vec3( 0.52, 0.50, 0.46 ) * ( 0.62 + 0.3 * bed + 0.25 * joint ) * mix( 1.0, 0.7, smoothstep( top - 0.2, top, rel ) );
		alb = mix( alb, stone, clamp( rock, 0.0, 1.0 ) );
		// (a cliff: a sheer face to the sea, its bedding and joints in the light)
		float cliff = clamp( rock, 0.0, 1.0 ) * near;
		n = normalize( mix( n, normalize( toEye + tAz * ( - 0.6 - 0.8 * dh - 0.5 * ( joint - 0.5 ) ) + vec3( 0.0, 0.15, 0.0 ) ), cliff ) );
		vec3 lit = alb * ( sunI * max( dot( n, Ls ), 0.0 ) + amb * ( 0.55 + 0.45 * n.y ) );
		// village lights at night: a few warm points on the near hills' lower slopes, in clusters
		if ( uMtnLights > 0.0 && ( i == 2 || i == 4 ) ) {
			vec2 q = vec2( A * 9.0, U * 22.0 );
			vec2 c = floor( q ), f = fract( q ) - 0.5;
			float hsh = azHash( c + 0.37 * float( i ) ), cl = smoothstep( 0.55, 0.75, mtnN2( vec2( A * 0.35, 0.5 ) + float( i ) ) );
			vec2 o = vec2( azHash( c + 1.7 ), azHash( c + 9.1 ) ) - 0.5;
			float pt = exp( - dot( f - 0.6 * o, f - 0.6 * o ) * 60.0 ) * step( 0.82, hsh ) * cl * ( 1.0 - smoothstep( 0.25, 0.55, rel ) );
			lit += vec3( 1.0, 0.72, 0.42 ) * pt * uMtnLights * ( 0.5 + hsh );
		}
		float T = exp( - 3.912 * d / max( uMtnVis, 0.1 ) );
		return lit * T + air * ( 1.0 - T );
	}
	// the coast over bg in direction vd (pixel angle pix, blur: rad): rgb composited, a its cover
	vec4 mtnLand( vec3 vd, float pix, float blur, vec3 bg ) {
		float U = degrees( asin( clamp( vd.y, - 1.0, 1.0 ) ) );
		if ( uMtn <= 0.0 || U > 5.0 || U < - 0.05 ) return vec4( bg, 0.0 );
		float A = degrees( atan( vd.z, vd.x ) );
		if ( A > 15.0 ) A -= 360.0;		// (the land side behind the room, past -180: the left headland's tail)
		if ( A > 12.0 || A < - 200.0 ) return vec4( bg, 0.0 );
		float pw = degrees( max( pix, blur ) ) * 0.75 + 1e-4;
		vec3 air = uAtmosphere ? skyAir( vd ).rgb : bg;
		vec3 Ls = uAtmosphere ? normalize( uSkyLight ) : normalize( uLightDir );
		vec3 sunI, amb;
		if ( uAtmosphere ) {
			// (the light through the air to the ground (unit illuminance in the LUT's units, the sky's scale, as the
			// clouds); the sky's light from the eye's side)
			sunI = skyTrans( uSkyEyeR, max( Ls.y, 0.0 ) ) * uSkyScale * ( 4.0 / 3.14159 ) * uMtnSun * smoothstep( - 0.02, 0.05, Ls.y );
			amb = skyAir( normalize( vec3( - vd.x, 0.45, - vd.z ) ) ).rgb * 1.1;
		} else {
			sunI = uSunE * 0.03 * uMtnSun * smoothstep( - 0.02, 0.05, Ls.y );
			amb = bg * 0.6;
		}
		vec3 c = bg; float cover = 0.0;
		for ( int i = 0; i < MTN_N; ++ i ) {
			float h = mtnH( i, A );
			if ( h <= 0.0 ) continue;
			float a = smoothstep( - pw, pw, h - U ) * smoothstep( - 0.05, 0.0, U );
			if ( a <= 0.0 ) continue;
			c = mix( c, mtnShade( i, A, max( U, 0.0 ), h, vd, air, amb, sunI, Ls ), a );
			cover = max( cover, a );
		}
		return vec4( c, cover * uMtn );
	}
`;

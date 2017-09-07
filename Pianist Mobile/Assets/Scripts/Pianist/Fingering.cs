
using System.Collections.Generic;
using Math = System.Math;


namespace Pianist
{
	using FingerChord = Dictionary<int, Finger>;


	public enum Finger
	{
		EMPTY					= 0,

		LEFT_THUMB				= -1,
		LEFT_INDEX				= -2,
		LEFT_MIDDLE				= -3,
		LEFT_RING				= -4,
		LEFT_PINKY				= -5,

		RIGHT_THUMB				= 1,
		RIGHT_INDEX				= 2,
		RIGHT_MIDDLE			= 3,
		RIGHT_RING				= 4,
		RIGHT_PINKY				= 5,


		// shift fingers on single note
		LEFT_THUMB_INDEX		= -12,
		LEFT_THUMB_MIDDLE		= -13,
		LEFT_THUMB_RING			= -14,
		LEFT_THUMB_PINKY		= -15,
		LEFT_INDEX_MIDDLE		= -23,
		LEFT_MIDDLE_RING		= -34,
		LEFT_RING_PINKY			= -45,

		LEFT_INDEX_THUMB		= -21,
		LEFT_MIDDLE_THUMB		= -31,
		LEFT_RING_THUMB			= -41,
		LEFT_PINKY_THUMB		= -51,
		LEFT_MIDDLE_INDEX		= -32,
		LEFT_RING_MIDDLE		= -43,
		LEFT_PINKY_RING			= -54,

		RIGHT_THUMB_INDEX		= 12,
		RIGHT_THUMB_MIDDLE		= 13,
		RIGHT_THUMB_RING		= 14,
		RIGHT_THUMB_PINKY		= 15,
		RIGHT_INDEX_MIDDLE		= 23,
		RIGHT_MIDDLE_RING		= 34,
		RIGHT_RING_PINKY		= 45,

		RIGHT_INDEX_THUMB		= 21,
		RIGHT_MIDDLE_THUMB		= 31,
		RIGHT_RING_THUMB		= 41,
		RIGHT_PINKY_THUMB		= 51,
		RIGHT_MIDDLE_INDEX		= 32,
		RIGHT_RING_MIDDLE		= 43,
		RIGHT_PINKY_RING		= 54,
	};


	public class FingerSequence
	{
		public FingerChord[] seq;
	};


	public class Fingering
	{
		public class Marker
		{
			public int tick;
			public float time;
			public int pitch;
			public Finger finger;
		};

		public Marker[] markers;
	};


	[System.Serializable]
	public class HandConfig
	{
		public string Name;

		public float Span15 = 7.5f;
	};


	public enum SolveHandType
	{
		MIX,
		LEFT,
		RIGHT,
	}


	public class FingerConstants
	{
		public struct Bound
		{
			public int left;
			public int right;

			public Bound(Finger finger)
			{
				int value = (int)finger;
				if (System.Math.Abs(value) < 10)
				{
					left = value;
					right = value;
				}
				else
				{
					bool minus = value < 0;
					value = System.Math.Abs(value);

					int first = (int)Math.Floor(value / 10f);
					int second = value % 10;

					left = Math.Min(first, second);
					right = Math.Max(first, second);
				}
			}
		};

		public static readonly Dictionary<Finger, Bound> Bounds = new Dictionary<Finger, Bound>()
		{
			{Finger.EMPTY,					new Bound(Finger.EMPTY)},

			{Finger.LEFT_THUMB			,	new Bound(Finger.LEFT_THUMB)},
			{Finger.LEFT_INDEX			,	new Bound(Finger.LEFT_INDEX)},
			{Finger.LEFT_MIDDLE			,	new Bound(Finger.LEFT_MIDDLE)},
			{Finger.LEFT_RING			,	new Bound(Finger.LEFT_RING)},
			{Finger.LEFT_PINKY			,	new Bound(Finger.LEFT_PINKY)},

			{Finger.RIGHT_THUMB			,	new Bound(Finger.RIGHT_THUMB)},
			{Finger.RIGHT_INDEX			,	new Bound(Finger.RIGHT_INDEX)},
			{Finger.RIGHT_MIDDLE		,	new Bound(Finger.RIGHT_MIDDLE)},
			{Finger.RIGHT_RING			,	new Bound(Finger.RIGHT_RING)},
			{Finger.RIGHT_PINKY			,	new Bound(Finger.RIGHT_PINKY)},

			{Finger.LEFT_THUMB_INDEX	,	new Bound(Finger.LEFT_THUMB_INDEX)},
			{Finger.LEFT_THUMB_MIDDLE	,	new Bound(Finger.LEFT_THUMB_MIDDLE)},
			{Finger.LEFT_THUMB_RING		,	new Bound(Finger.LEFT_THUMB_RING)},
			{Finger.LEFT_THUMB_PINKY	,	new Bound(Finger.LEFT_THUMB_PINKY)},
			{Finger.LEFT_INDEX_MIDDLE	,	new Bound(Finger.LEFT_INDEX_MIDDLE)},
			{Finger.LEFT_MIDDLE_RING	,	new Bound(Finger.LEFT_MIDDLE_RING)},
			{Finger.LEFT_RING_PINKY		,	new Bound(Finger.LEFT_RING_PINKY)},
			{Finger.LEFT_INDEX_THUMB	,	new Bound(Finger.LEFT_INDEX_THUMB)},
			{Finger.LEFT_MIDDLE_THUMB	,	new Bound(Finger.LEFT_MIDDLE_THUMB)},
			{Finger.LEFT_RING_THUMB		,	new Bound(Finger.LEFT_RING_THUMB)},
			{Finger.LEFT_PINKY_THUMB	,	new Bound(Finger.LEFT_PINKY_THUMB)},
			{Finger.LEFT_MIDDLE_INDEX	,	new Bound(Finger.LEFT_MIDDLE_INDEX)},
			{Finger.LEFT_RING_MIDDLE	,	new Bound(Finger.LEFT_RING_MIDDLE)},
			{Finger.LEFT_PINKY_RING		,	new Bound(Finger.LEFT_PINKY_RING)},

			{Finger.RIGHT_THUMB_INDEX	,	new Bound(Finger.RIGHT_THUMB_INDEX)},
			{Finger.RIGHT_THUMB_MIDDLE	,	new Bound(Finger.RIGHT_THUMB_MIDDLE)},
			{Finger.RIGHT_THUMB_RING	,	new Bound(Finger.RIGHT_THUMB_RING)},
			{Finger.RIGHT_THUMB_PINKY	,	new Bound(Finger.RIGHT_THUMB_PINKY)},
			{Finger.RIGHT_INDEX_MIDDLE	,	new Bound(Finger.RIGHT_INDEX_MIDDLE)},
			{Finger.RIGHT_MIDDLE_RING	,	new Bound(Finger.RIGHT_MIDDLE_RING)},
			{Finger.RIGHT_RING_PINKY	,	new Bound(Finger.RIGHT_RING_PINKY)},
			{Finger.RIGHT_INDEX_THUMB	,	new Bound(Finger.RIGHT_INDEX_THUMB)},
			{Finger.RIGHT_MIDDLE_THUMB	,	new Bound(Finger.RIGHT_MIDDLE_THUMB)},
			{Finger.RIGHT_RING_THUMB	,	new Bound(Finger.RIGHT_RING_THUMB)},
			{Finger.RIGHT_PINKY_THUMB	,	new Bound(Finger.RIGHT_PINKY_THUMB)},
			{Finger.RIGHT_MIDDLE_INDEX	,	new Bound(Finger.RIGHT_MIDDLE_INDEX)},
			{Finger.RIGHT_RING_MIDDLE	,	new Bound(Finger.RIGHT_RING_MIDDLE)},
			{Finger.RIGHT_PINKY_RING	,	new Bound(Finger.RIGHT_PINKY_RING)},
		};
	};
}

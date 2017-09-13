
using System.Collections.Generic;
using Math = System.Math;


namespace Pianist
{
	using FingerChord = SortedDictionary<int, Finger>;


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

		public float Span12 = 5.2f;
		public float Span13 = 6.4f;
		public float Span14 = 7.3f;
		public float Span15 = 7.7f;

		public float Span23 = 3.3f;
		public float Span24 = 4.6f;
		public float Span25 = 6.1f;

		public float Span34 = 3.2f;
		public float Span35 = 4.8f;

		public float Span45 = 3.3f;

		float[,] spans;

		public float[,] getSpans()
		{
			if (spans == null)
			{
				spans = new float[6, 6];

				spans[1, 2] = Span12;
				spans[1, 3] = Span13;
				spans[1, 4] = Span14;
				spans[1, 5] = Span15;
				spans[2, 3] = Span23;
				spans[2, 4] = Span24;
				spans[2, 5] = Span25;
				spans[3, 4] = Span34;
				spans[3, 5] = Span35;
				spans[4, 5] = Span45;

				spans[2, 1] = Span12;
				spans[3, 1] = Span13;
				spans[4, 1] = Span14;
				spans[5, 1] = Span15;
				spans[3, 2] = Span23;
				spans[4, 2] = Span24;
				spans[5, 2] = Span25;
				spans[4, 3] = Span34;
				spans[5, 3] = Span35;
				spans[5, 4] = Span45;
			}

			return spans;
		}
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

		public static readonly Dictionary<SolveHandType, Finger[]> SolveTypeFingers = new Dictionary<SolveHandType, Finger[]>
		{
			{SolveHandType.MIX, new Finger[]{
				Finger.LEFT_PINKY, Finger.LEFT_RING, Finger.LEFT_MIDDLE, Finger.LEFT_INDEX, Finger.LEFT_THUMB, Finger.LEFT_THUMB_INDEX, Finger.LEFT_THUMB_MIDDLE, Finger.LEFT_THUMB_RING, Finger.LEFT_THUMB_PINKY, Finger.LEFT_INDEX_MIDDLE, Finger.LEFT_MIDDLE_RING, Finger.LEFT_RING_PINKY, Finger.LEFT_INDEX_THUMB, Finger.LEFT_MIDDLE_THUMB, Finger.LEFT_RING_THUMB, Finger.LEFT_PINKY_THUMB, Finger.LEFT_MIDDLE_INDEX, Finger.LEFT_RING_MIDDLE, Finger.LEFT_PINKY_RING,
				Finger.RIGHT_THUMB, Finger.RIGHT_INDEX, Finger.RIGHT_MIDDLE, Finger.RIGHT_RING, Finger.RIGHT_PINKY, Finger.RIGHT_THUMB_INDEX, Finger.RIGHT_THUMB_MIDDLE, Finger.RIGHT_THUMB_RING, Finger.RIGHT_THUMB_PINKY, Finger.RIGHT_INDEX_MIDDLE, Finger.RIGHT_MIDDLE_RING, Finger.RIGHT_RING_PINKY, Finger.RIGHT_INDEX_THUMB, Finger.RIGHT_MIDDLE_THUMB, Finger.RIGHT_RING_THUMB, Finger.RIGHT_PINKY_THUMB, Finger.RIGHT_MIDDLE_INDEX, Finger.RIGHT_RING_MIDDLE, Finger.RIGHT_PINKY_RING,
			}},

			{SolveHandType.LEFT, new Finger[]{
				Finger.LEFT_PINKY, Finger.LEFT_RING, Finger.LEFT_MIDDLE, Finger.LEFT_INDEX, Finger.LEFT_THUMB, Finger.LEFT_THUMB_INDEX, Finger.LEFT_THUMB_MIDDLE, Finger.LEFT_THUMB_RING, Finger.LEFT_THUMB_PINKY, Finger.LEFT_INDEX_MIDDLE, Finger.LEFT_MIDDLE_RING, Finger.LEFT_RING_PINKY, Finger.LEFT_INDEX_THUMB, Finger.LEFT_MIDDLE_THUMB, Finger.LEFT_RING_THUMB, Finger.LEFT_PINKY_THUMB, Finger.LEFT_MIDDLE_INDEX, Finger.LEFT_RING_MIDDLE, Finger.LEFT_PINKY_RING,
			}},

			{SolveHandType.RIGHT, new Finger[]{
				Finger.RIGHT_THUMB, Finger.RIGHT_INDEX, Finger.RIGHT_MIDDLE, Finger.RIGHT_RING, Finger.RIGHT_PINKY, Finger.RIGHT_THUMB_INDEX, Finger.RIGHT_THUMB_MIDDLE, Finger.RIGHT_THUMB_RING, Finger.RIGHT_THUMB_PINKY, Finger.RIGHT_INDEX_MIDDLE, Finger.RIGHT_MIDDLE_RING, Finger.RIGHT_RING_PINKY, Finger.RIGHT_INDEX_THUMB, Finger.RIGHT_MIDDLE_THUMB, Finger.RIGHT_RING_THUMB, Finger.RIGHT_PINKY_THUMB, Finger.RIGHT_MIDDLE_INDEX, Finger.RIGHT_RING_MIDDLE, Finger.RIGHT_PINKY_RING,
			}},
		};

		public static bool testFingerDistance(Finger left, Finger right, HandConfig hand, float distance)
		{
			int product = (int)left * (int)right;
			if (product <= 0)
				return true;

			int left_bound = Bounds[left].right;
			int right_bound = Bounds[right].left;
			if (right_bound <= left_bound)
				return false;

			float span = hand.getSpans()[Math.Abs(left_bound), Math.Abs(right_bound)];

			return span >= distance;
		}
	};
}

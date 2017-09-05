

namespace Pianist
{
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
		public Finger[] seq;
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
}

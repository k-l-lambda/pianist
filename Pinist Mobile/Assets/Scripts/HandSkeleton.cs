
using System;

namespace Pianist
{
	using bi = HandBoneIndex;
	using Vector3 = UnityEngine.Vector3;


	public enum HandBoneIndex
	{
		WRIST_Y,
			WRIST_X,

				THUMB_Z,
					THUMB_Y,
						THUMB1,
							THUMB2,
								THUMB3,
									THUMB_TIP,

				PALM_INDEX,
					INDEX_Y,
						INDEX1,
							INDEX2,
								INDEX3,
									INDEX_TIP,

				PALM_MIDDLE,
					MIDDLE_Y,
						MIDDLE1,
							MIDDLE2,
								MIDDLE3,
									MIDDLE_TIP,

				PALM_RING,
					RING_Y,
						RING1,
							RING2,
								RING3,
									RING_TIP,

				PALM_PINKY,
					PINKY_Y,
						PINKY1,
							PINKY2,
								PINKY3,
									PINKY_TIP,
	}


	public class HandBoneIndices
	{
		public static readonly HandBoneIndex[] Positions = new HandBoneIndex[] {
			bi.THUMB_Z, bi.THUMB2, bi.THUMB3, bi.THUMB_TIP,
			bi.PALM_INDEX, bi.INDEX_Y, bi.INDEX2, bi.INDEX3, bi.INDEX_TIP,
			bi.PALM_MIDDLE, bi.MIDDLE_Y, bi.MIDDLE2, bi.MIDDLE3, bi.MIDDLE_TIP,
			bi.PALM_RING, bi.RING_Y, bi.RING2, bi.RING3, bi.RING_TIP,
			bi.PALM_PINKY, bi.PINKY_Y, bi.PINKY2, bi.PINKY3, bi.PINKY_TIP,
		};

		public static readonly HandBoneIndex[] Orientations = new HandBoneIndex[] {
			bi.WRIST_Y, bi.WRIST_X,
			bi.THUMB_Z, bi.THUMB_Y, bi.THUMB1, bi.THUMB2, bi.THUMB3,
			bi.PALM_INDEX, bi.INDEX_Y, bi.INDEX1, bi.INDEX2, bi.INDEX3,
			bi.PALM_MIDDLE, bi.MIDDLE_Y, bi.MIDDLE1, bi.MIDDLE2, bi.MIDDLE3,
			bi.PALM_RING, bi.RING_Y, bi.RING1, bi.RING2, bi.RING3,
			bi.PALM_PINKY, bi.PINKY_Y, bi.PINKY1, bi.PINKY2, bi.PINKY3,
		};

		public static readonly HandBoneIndex[] Ranges = new HandBoneIndex[] {
			bi.WRIST_Y, bi.WRIST_X,
			bi.THUMB_Z, bi.THUMB_Y, bi.THUMB1, bi.THUMB2, bi.THUMB3,
			bi.INDEX_Y, bi.INDEX1, bi.INDEX2, bi.INDEX3,
			bi.MIDDLE_Y, bi.MIDDLE1, bi.MIDDLE2, bi.MIDDLE3,
			bi.RING_Y, bi.RING1, bi.RING2, bi.RING3,
			bi.PINKY_Y, bi.PINKY1, bi.PINKY2, bi.PINKY3,
		};
	};


	public class HandRig
	{
		public struct Range
		{
			public float low, up;
		};

		public Vector3[] Positions = new Vector3[HandBoneIndices.Positions.Length];
		public float[] Orientations = new float[HandBoneIndices.Orientations.Length];
		public Range[] Ranges = new Range[HandBoneIndices.Ranges.Length];
	};
}

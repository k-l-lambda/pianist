
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

		Count,

		Begin = WRIST_Y,
		End = PINKY_TIP + 1,
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

		public static readonly Vector3[] RotationAxies = new Vector3[]{
			Vector3.up,			// WRIST_Y
			Vector3.right,		// WRIST_X

			Vector3.forward,	// THUMB_Z
			Vector3.up,			// THUMB_Y
			Vector3.right,		// THUMB1
			Vector3.right,		// THUMB2
			Vector3.right,		// THUMB3
			Vector3.zero,		// THUMB_TIP

			Vector3.up,			// PALM_INDEX
			Vector3.up,			// INDEX_Y
			Vector3.right,		// INDEX1
			Vector3.right,		// INDEX2
			Vector3.right,		// INDEX3
			Vector3.zero,		// INDEX_TIP

			Vector3.up,			// PALM_MIDDLE
			Vector3.up,			// MIDDLE_Y
			Vector3.right,		// MIDDLE1
			Vector3.right,		// MIDDLE2
			Vector3.right,		// MIDDLE3
			Vector3.zero,		// MIDDLE_TIP

			Vector3.up,			// PALM_RING
			Vector3.up,			// RING_Y
			Vector3.right,		// RING1
			Vector3.right,		// RING2
			Vector3.right,		// RING3
			Vector3.zero,		// RING_TIP

			Vector3.up,			// PALM_PINKY
			Vector3.up,			// PINKY_Y
			Vector3.right,		// PINKY1
			Vector3.right,		// PINKY2
			Vector3.right,		// PINKY3
			Vector3.zero,		// PINKY_TIP
		};
	};


	[System.Serializable]
	public class HandRigData
	{
		[System.Serializable]
		public struct Range
		{
			public float low, up;
		};

		public Vector3[] Positions = new Vector3[HandBoneIndices.Positions.Length];
		public float[] Orientations = new float[HandBoneIndices.Orientations.Length];
		public Range[] Ranges = new Range[HandBoneIndices.Ranges.Length];
	};
}


using System;

namespace Pianist
{
	using bi = HandBoneIndex;
	using Vector3 = UnityEngine.Vector3;


	public enum HandBoneIndex
	{
		WRIST_Y,
			WRIST_X,
				WRIST_Z,
					THUMB0_Z,
						THUMB0_Y,
							THUMB0_X,
								THUMB1_FZ,
									THUMB1_FY,
										THUMB1_X,
											THUMB2_FZ,
												THUMB2_FY,
													THUMB2_X,
														THUMB_TIP,
					INDEX0_FZ,
						INDEX0_FY,
							INDEX0_FX,
								INDEX1_FZ,
									INDEX1_FY,
										INDEX1_X,
											INDEX2_FZ,
												INDEX2_FY,
													INDEX2_X,
														INDEX3_FZ,
															INDEX3_FY,
																INDEX3_X,
																	INDEX_TIP,
					MIDDLE0_FZ,
						MIDDLE0_FY,
							MIDDLE0_FX,
								MIDDLE1_FZ,
									MIDDLE1_FY,
										MIDDLE1_X,
											MIDDLE2_FZ,
												MIDDLE2_FY,
													MIDDLE2_X,
														MIDDLE3_FZ,
															MIDDLE3_FY,
																MIDDLE3_X,
																	MIDDLE_TIP,
					RING0_FZ,
						RING0_FY,
							RING0_FX,
								RING1_FZ,
									RING1_FY,
										RING1_X,
											RING2_FZ,
												RING2_FY,
													RING2_X,
														RING3_FZ,
															RING3_FY,
																RING3_X,
																	RING_TIP,
					PINKY0_FZ,
						PINKY0_FY,
							PINKY0_FX,
								PINKY1_FZ,
									PINKY1_FY,
										PINKY1_X,
											PINKY2_FZ,
												PINKY2_FY,
													PINKY2_X,
														PINKY3_FZ,
															PINKY3_FY,
																PINKY3_X,
																	PINKY_TIP,

		Count,
	}


	public class HandBoneIndices
	{
		public static readonly HandBoneIndex Begin = bi.WRIST_Y;
		public static readonly HandBoneIndex End = bi.PINKY_TIP + 1;

		public static readonly HandBoneIndex WristStart = bi.WRIST_Y;
		public static readonly HandBoneIndex WristEnd = bi.WRIST_Z + 1;
		public static readonly HandBoneIndex ThumbStart = bi.THUMB0_Z;
		public static readonly HandBoneIndex ThumbEnd = bi.THUMB_TIP + 1;
		public static readonly HandBoneIndex IndexStart = bi.INDEX0_FZ;
		public static readonly HandBoneIndex IndexEnd = bi.INDEX_TIP + 1;
		public static readonly HandBoneIndex MiddleStart = bi.MIDDLE0_FZ;
		public static readonly HandBoneIndex MiddleEnd = bi.MIDDLE_TIP + 1;
		public static readonly HandBoneIndex RingStart = bi.RING0_FZ;
		public static readonly HandBoneIndex RingEnd = bi.RING_TIP + 1;
		public static readonly HandBoneIndex PinkyStart = bi.PINKY0_FZ;
		public static readonly HandBoneIndex PinkyEnd = bi.PINKY_TIP + 1;

		public static readonly HandBoneIndex[] Tips = new HandBoneIndex[] {
			bi.THUMB_TIP, bi.INDEX_TIP, bi.MIDDLE_TIP, bi.RING_TIP, bi.PINKY_TIP,
		};

		public static readonly HandBoneIndex[] Positions = new HandBoneIndex[] {
			bi.THUMB0_Z, bi.THUMB1_FZ, bi.THUMB2_FZ, bi.THUMB_TIP,
			bi.INDEX0_FZ, bi.INDEX1_FZ, bi.INDEX2_FZ, bi.INDEX3_FZ, bi.INDEX_TIP,
			bi.MIDDLE0_FZ, bi.MIDDLE1_FZ, bi.MIDDLE2_FZ, bi.MIDDLE3_FZ, bi.MIDDLE_TIP,
			bi.RING0_FZ, bi.RING1_FZ, bi.RING2_FZ, bi.RING3_FZ, bi.RING_TIP,
			bi.PINKY0_FZ, bi.PINKY1_FZ, bi.PINKY2_FZ, bi.PINKY3_FZ, bi.PINKY_TIP,
		};

		public static readonly HandBoneIndex[] FixedAngles = new HandBoneIndex[] {
			bi.THUMB1_FZ, bi.THUMB1_FY, bi.THUMB2_FZ, bi.THUMB2_FY,
			bi.INDEX0_FZ, bi.INDEX0_FY, bi.INDEX1_FZ, bi.INDEX1_FZ, bi.INDEX1_FY, bi.INDEX2_FZ, bi.INDEX2_FY, bi.INDEX3_FZ, bi.INDEX3_FY,
			bi.MIDDLE0_FZ, bi.MIDDLE0_FY, bi.MIDDLE1_FZ, bi.MIDDLE1_FZ, bi.MIDDLE1_FY, bi.MIDDLE2_FZ, bi.MIDDLE2_FY, bi.MIDDLE3_FZ, bi.MIDDLE3_FY,
			bi.RING0_FZ, bi.RING0_FY, bi.RING1_FZ, bi.RING1_FZ, bi.RING1_FY, bi.RING2_FZ, bi.RING2_FY, bi.RING3_FZ, bi.RING3_FY,
			bi.PINKY0_FZ, bi.PINKY0_FY, bi.PINKY1_FZ, bi.PINKY1_FZ, bi.PINKY1_FY, bi.PINKY2_FZ, bi.PINKY2_FY, bi.PINKY3_FZ, bi.PINKY3_FY,
		};

		public static readonly HandBoneIndex[] RangedAngles = new HandBoneIndex[] {
			bi.WRIST_Y, bi.WRIST_X, bi.WRIST_Z,
			bi.THUMB0_Z, bi.THUMB0_Y, bi.THUMB0_X, bi.THUMB1_X, bi.THUMB2_X,
			bi.INDEX1_X, bi.INDEX2_X, bi.INDEX3_X,
			bi.MIDDLE1_X, bi.MIDDLE2_X, bi.MIDDLE3_X,
			bi.RING1_X, bi.RING2_X, bi.RING3_X,
			bi.PINKY1_X, bi.PINKY2_X, bi.PINKY3_X,
		};

		public static readonly Vector3[] RotationAxies = new Vector3[]{
			Vector3.up,				// WRIST_Y,
			Vector3.right,			// WRIST_X,
			Vector3.forward,		// WRIST_Z,

			Vector3.forward,		// THUMB0_Z,
			Vector3.up,				// THUMB0_Y,
			Vector3.right,			// THUMB0_X,
			Vector3.forward,		// THUMB1_FZ,
			Vector3.up,				// THUMB1_FY,
			Vector3.right,			// THUMB1_X,
			Vector3.forward,		// THUMB2_FZ,
			Vector3.up,				// THUMB2_FY,
			Vector3.right,			// THUMB2_X,
			Vector3.forward,		// THUMB_TIP,

			Vector3.forward,		// INDEX0_FZ,
			Vector3.up,				// INDEX0_FY,
			Vector3.right,			// INDEX0_FX,
			Vector3.forward,		// INDEX1_FZ,
			Vector3.up,				// INDEX1_FY,
			Vector3.right,			// INDEX1_X,
			Vector3.forward,		// INDEX2_FZ,
			Vector3.up,				// INDEX2_FY,
			Vector3.right,			// INDEX2_X,
			Vector3.forward,		// INDEX3_FZ,
			Vector3.up,				// INDEX3_FY,
			Vector3.right,			// INDEX3_X,
			Vector3.forward,		// INDEX_TIP,

			Vector3.forward,		// MIDDLE0_FZ,
			Vector3.up,				// MIDDLE0_FY,
			Vector3.right,			// MIDDLE0_FX,
			Vector3.forward,		// MIDDLE1_FZ,
			Vector3.up,				// MIDDLE1_FY,
			Vector3.right,			// MIDDLE1_X,
			Vector3.forward,		// MIDDLE2_FZ,
			Vector3.up,				// MIDDLE2_FY,
			Vector3.right,			// MIDDLE2_X,
			Vector3.forward,		// MIDDLE3_FZ,
			Vector3.up,				// MIDDLE3_FY,
			Vector3.right,			// MIDDLE3_X,
			Vector3.forward,		// MIDDLE_TIP,

			Vector3.forward,		// RING0_FZ,
			Vector3.up,				// RING0_FY,
			Vector3.right,			// RING0_FX,
			Vector3.forward,		// RING1_FZ,
			Vector3.up,				// RING1_FY,
			Vector3.right,			// RING1_X,
			Vector3.forward,		// RING2_FZ,
			Vector3.up,				// RING2_FY,
			Vector3.right,			// RING2_X,
			Vector3.forward,		// RING3_FZ,
			Vector3.up,				// RING3_FY,
			Vector3.right,			// RING3_X,
			Vector3.forward,		// RING_TIP,

			Vector3.forward,		// PINKY0_FZ,
			Vector3.up,				// PINKY0_FY,
			Vector3.right,			// PINKY0_FX,
			Vector3.forward,		// PINKY1_FZ,
			Vector3.up,				// PINKY1_FY,
			Vector3.right,			// PINKY1_X,
			Vector3.forward,		// PINKY2_FZ,
			Vector3.up,				// PINKY2_FY,
			Vector3.right,			// PINKY2_X,
			Vector3.forward,		// PINKY3_FZ,
			Vector3.up,				// PINKY3_FY,
			Vector3.right,			// PINKY3_X,
			Vector3.forward,		// PINKY_TIP,
		};
	};


	[System.Serializable]
	public class HandRigData
	{
		[System.Serializable]
		public struct Range
		{
			public float low, high;
		};

		public Vector3[] Positions = new Vector3[HandBoneIndices.Positions.Length];

		public float[] FixedAngles = new float[HandBoneIndices.FixedAngles.Length];

		public Range[] RangedAngles = new Range[HandBoneIndices.RangedAngles.Length];
	};
}


using System;
using System.Collections.Generic;


namespace Pianist
{
	using bi = HandBoneIndex;
	using Vector3 = UnityEngine.Vector3;
	using Quaternion = UnityEngine.Quaternion;


	public enum HandBoneIndex
	{
		WRIST_X,
			WRIST_Y,
				WRIST_Z,
					THUMB0_Z,
						THUMB0_X,
							THUMB0_Y,
								THUMB1_X,
									THUMB1_FY,
										THUMB1_FZ,
											THUMB2_X,
												THUMB2_FY,
													THUMB2_FZ,
														THUMB_TIP,
					INDEX0_FX,
						INDEX0_FY,
							INDEX0_FZ,
								INDEX1_X,
									INDEX1_Y,
										INDEX1_FZ,
											INDEX2_X,
												INDEX2_FY,
													INDEX2_FZ,
														INDEX3_X,
															INDEX3_FY,
																INDEX3_FZ,
																	INDEX_TIP,
					MIDDLE0_FX,
						MIDDLE0_FY,
							MIDDLE0_FZ,
								MIDDLE1_X,
									MIDDLE1_Y,
										MIDDLE1_FZ,
											MIDDLE2_X,
												MIDDLE2_FY,
													MIDDLE2_FZ,
														MIDDLE3_X,
															MIDDLE3_FY,
																MIDDLE3_FZ,
																	MIDDLE_TIP,
					RING0_FX,
						RING0_FY,
							RING0_FZ,
								RING1_X,
									RING1_Y,
										RING1_FZ,
											RING2_X,
												RING2_FY,
													RING2_FZ,
														RING3_X,
															RING3_FY,
																RING3_FZ,
																	RING_TIP,
					PINKY0_FX,
						PINKY0_FY,
							PINKY0_FZ,
								PINKY1_X,
									PINKY1_Y,
										PINKY1_FZ,
											PINKY2_X,
												PINKY2_FY,
													PINKY2_FZ,
														PINKY3_X,
															PINKY3_FY,
																PINKY3_FZ,
																	PINKY_TIP,

		Count,
	}


	public class HandBoneIndices
	{
		public static readonly HandBoneIndex Begin = bi.WRIST_X;
		public static readonly HandBoneIndex End = bi.PINKY_TIP + 1;

		public static readonly HandBoneIndex WristStart = bi.WRIST_X;
		public static readonly HandBoneIndex WristEnd = bi.WRIST_Z + 1;
		public static readonly HandBoneIndex ThumbStart = bi.THUMB0_Z;
		public static readonly HandBoneIndex ThumbEnd = bi.THUMB_TIP + 1;
		public static readonly HandBoneIndex IndexStart = bi.INDEX0_FX;
		public static readonly HandBoneIndex IndexEnd = bi.INDEX_TIP + 1;
		public static readonly HandBoneIndex MiddleStart = bi.MIDDLE0_FX;
		public static readonly HandBoneIndex MiddleEnd = bi.MIDDLE_TIP + 1;
		public static readonly HandBoneIndex RingStart = bi.RING0_FX;
		public static readonly HandBoneIndex RingEnd = bi.RING_TIP + 1;
		public static readonly HandBoneIndex PinkyStart = bi.PINKY0_FX;
		public static readonly HandBoneIndex PinkyEnd = bi.PINKY_TIP + 1;

		public static readonly HandBoneIndex[] Tips = new HandBoneIndex[] {
			bi.THUMB_TIP, bi.INDEX_TIP, bi.MIDDLE_TIP, bi.RING_TIP, bi.PINKY_TIP,
		};

		public static readonly HandBoneIndex[] Positions = new HandBoneIndex[] {
			bi.THUMB0_Z, bi.THUMB1_X, bi.THUMB2_X, bi.THUMB_TIP,
			bi.INDEX0_FX, bi.INDEX1_X, bi.INDEX2_X, bi.INDEX3_X, bi.INDEX_TIP,
			bi.MIDDLE0_FX, bi.MIDDLE1_X, bi.MIDDLE2_X, bi.MIDDLE3_X, bi.MIDDLE_TIP,
			bi.RING0_FX, bi.RING1_X, bi.RING2_X, bi.RING3_X, bi.RING_TIP,
			bi.PINKY0_FX, bi.PINKY1_X, bi.PINKY2_X, bi.PINKY3_X, bi.PINKY_TIP,
		};

		public static readonly HandBoneIndex[] FixedAngles = new HandBoneIndex[] {
			bi.THUMB1_FY, bi.THUMB1_FZ, bi.THUMB2_FY, bi.THUMB2_FZ,
			bi.INDEX0_FY, bi.INDEX0_FZ, bi.INDEX1_FZ, bi.INDEX2_FY, bi.INDEX2_FZ, bi.INDEX3_FY, bi.INDEX3_FZ,
			bi.MIDDLE0_FY, bi.MIDDLE0_FZ, bi.MIDDLE1_FZ, bi.MIDDLE2_FY, bi.MIDDLE2_FZ, bi.MIDDLE3_FY, bi.MIDDLE3_FZ,
			bi.RING0_FY, bi.RING0_FZ, bi.RING1_FZ, bi.RING2_FY, bi.RING2_FZ, bi.RING3_FY, bi.RING3_FZ,
			bi.PINKY0_FY, bi.PINKY0_FZ, bi.PINKY1_FZ, bi.PINKY2_FY, bi.PINKY2_FZ, bi.PINKY3_FY, bi.PINKY3_FZ,
		};

		public static readonly HandBoneIndex[] RangedAngles = new HandBoneIndex[] {
			bi.WRIST_X, bi.WRIST_Y, bi.WRIST_Z,
			bi.THUMB0_Z, bi.THUMB0_X, bi.THUMB0_Y, bi.THUMB1_X, bi.THUMB2_X,
			bi.INDEX1_X, bi.INDEX1_Y, bi.INDEX2_X, bi.INDEX3_X,
			bi.MIDDLE1_X, bi.MIDDLE1_Y, bi.MIDDLE2_X, bi.MIDDLE3_X,
			bi.RING1_X, bi.RING1_Y, bi.RING2_X, bi.RING3_X,
			bi.PINKY1_X, bi.PINKY1_Y, bi.PINKY2_X, bi.PINKY3_X,
		};

		public static readonly HandBoneIndex[][] FingerAngles = new HandBoneIndex[][] {
			new HandBoneIndex[] {bi.THUMB0_X, bi.THUMB0_Y, bi.THUMB0_Z, bi.THUMB1_X, bi.THUMB2_X,},
			new HandBoneIndex[] {bi.INDEX1_X, bi.INDEX1_Y, bi.INDEX2_X, bi.INDEX3_X,},
			new HandBoneIndex[] {bi.MIDDLE1_X, bi.MIDDLE1_Y, bi.MIDDLE2_X, bi.MIDDLE3_X,},
			new HandBoneIndex[] {bi.RING1_X, bi.RING1_Y, bi.RING2_X, bi.RING3_X,},
			new HandBoneIndex[] {bi.PINKY1_X, bi.PINKY1_Y, bi.PINKY2_X, bi.PINKY3_X,},
		};

		public static readonly Vector3[] RotationAxies = new Vector3[]{
			Vector3.right,		// WRIST_X,
			Vector3.up,			// WRIST_Y,
			Vector3.forward,	// WRIST_Z,

			Vector3.forward,	// THUMB0_Z,
			Vector3.right,		// THUMB0_X,
			Vector3.up,			// THUMB0_Y,
			Vector3.right,		// THUMB1_X,
			Vector3.up,			// THUMB1_FY,
			Vector3.forward,	// THUMB1_FZ,
			Vector3.right,		// THUMB2_X,
			Vector3.up,			// THUMB2_FY,
			Vector3.forward,	// THUMB2_FZ,
			Vector3.zero,		// THUMB_TIP,

			Vector3.right,		// INDEX0_FX,
			Vector3.up,			// INDEX0_FY,
			Vector3.forward,	// INDEX0_FZ,
			Vector3.right,		// INDEX1_X,
			Vector3.up,			// INDEX1_Y,
			Vector3.forward,	// INDEX1_FZ,
			Vector3.right,		// INDEX2_X,
			Vector3.up,			// INDEX2_FY,
			Vector3.forward,	// INDEX2_FZ,
			Vector3.right,		// INDEX3_X,
			Vector3.up,			// INDEX3_FY,
			Vector3.forward,	// INDEX3_FZ,
			Vector3.zero,		// INDEX_TIP,

			Vector3.right,		// MIDDLE0_FX,
			Vector3.up,			// MIDDLE0_FY,
			Vector3.forward,	// MIDDLE0_FZ,
			Vector3.right,		// MIDDLE1_X,
			Vector3.up,			// MIDDLE1_Y,
			Vector3.forward,	// MIDDLE1_FZ,
			Vector3.right,		// MIDDLE2_X,
			Vector3.up,			// MIDDLE2_FY,
			Vector3.forward,	// MIDDLE2_FZ,
			Vector3.right,		// MIDDLE3_X,
			Vector3.up,			// MIDDLE3_FY,
			Vector3.forward,	// MIDDLE3_FZ,
			Vector3.forward,	// MIDDLE_TIP,

			Vector3.right,		// RING0_FX,
			Vector3.up,			// RING0_FY,
			Vector3.forward,	// RING0_FZ,
			Vector3.right,		// RING1_X,
			Vector3.up,			// RING1_Y,
			Vector3.forward,	// RING1_FZ,
			Vector3.right,		// RING2_X,
			Vector3.up,			// RING2_FY,
			Vector3.forward,	// RING2_FZ,
			Vector3.right,		// RING3_X,
			Vector3.up,			// RING3_FY,
			Vector3.forward,	// RING3_FZ,
			Vector3.zero,		// RING_TIP,

			Vector3.right,		// PINKY0_FX,
			Vector3.up,			// PINKY0_FY,
			Vector3.forward,	// PINKY0_FZ,
			Vector3.right,		// PINKY1_X,
			Vector3.up,			// PINKY1_Y,
			Vector3.forward,	// PINKY1_FZ,
			Vector3.right,		// PINKY2_X,
			Vector3.up,			// PINKY2_FY,
			Vector3.forward,	// PINKY2_FZ,
			Vector3.right,		// PINKY3_X,
			Vector3.up,			// PINKY3_FY,
			Vector3.forward,	// PINKY3_FZ,
			Vector3.zero,		// PINKY_TIP,
		};

		public static readonly Dictionary<HandBoneIndex, HandBoneIndex> Linkages = new Dictionary<bi, bi>()
		{
			{bi.INDEX2_X, bi.INDEX3_X},
			{bi.INDEX3_X, bi.INDEX2_X},
			{bi.MIDDLE2_X, bi.MIDDLE3_X},
			{bi.MIDDLE3_X, bi.MIDDLE2_X},
			{bi.RING2_X, bi.RING3_X},
			{bi.RING3_X, bi.RING2_X},
			{bi.PINKY2_X, bi.PINKY3_X},
			{bi.PINKY3_X, bi.PINKY2_X},
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

		FingerTipCalculator calculator;

		public FingerTipCalculator Calculator
		{
			get
			{
				if (calculator == null)
					calculator = new FingerTipCalculator(this);

				return calculator;
			}
		}
	};


	public class FingerTipCalculator
	{
		Vector3 PositionThumb0, PositionThumb1, PositionThumb2, PositionThumbTip;
		Vector3 PositionIndex0, PositionIndex1, PositionIndex2, PositionIndex3, PositionIndexTip;
		Vector3 PositionMiddle0, PositionMiddle1, PositionMiddle2, PositionMiddle3, PositionMiddleTip;
		Vector3 PositionRing0, PositionRing1, PositionRing2, PositionRing3, PositionRingTip;
		Vector3 PositionPinky0, PositionPinky1, PositionPinky2, PositionPinky3, PositionPinkyTip;

		Quaternion RotationThumb1, RotationThumb2;
		Quaternion RotationIndex0, RotationIndex1, RotationIndex2, RotationIndex3;
		Quaternion RotationMiddle0, RotationMiddle1, RotationMiddle2, RotationMiddle3;
		Quaternion RotationRing0, RotationRing1, RotationRing2, RotationRing3;
		Quaternion RotationPinky0, RotationPinky1, RotationPinky2, RotationPinky3;

		public FingerTipCalculator(HandRigData rig)
		{
			PositionThumb0 = rig.Positions[0];
			PositionThumb1 = rig.Positions[1];
			PositionThumb2 = rig.Positions[2];
			PositionThumbTip = rig.Positions[3];

			PositionIndex0 = rig.Positions[4];
			PositionIndex1 = rig.Positions[5];
			PositionIndex2 = rig.Positions[6];
			PositionIndex3 = rig.Positions[7];
			PositionIndexTip = rig.Positions[8];

			PositionMiddle0 = rig.Positions[9];
			PositionMiddle1 = rig.Positions[10];
			PositionMiddle2 = rig.Positions[11];
			PositionMiddle3 = rig.Positions[12];
			PositionMiddleTip = rig.Positions[13];

			PositionRing0 = rig.Positions[14];
			PositionRing1 = rig.Positions[15];
			PositionRing2 = rig.Positions[16];
			PositionRing3 = rig.Positions[17];
			PositionRingTip = rig.Positions[18];

			PositionPinky0 = rig.Positions[19];
			PositionPinky1 = rig.Positions[20];
			PositionPinky2 = rig.Positions[21];
			PositionPinky3 = rig.Positions[22];
			PositionPinkyTip = rig.Positions[23];


			/*RotationThumb1 = Quaternion.AngleAxis(rig.FixedAngles[1], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[0], Vector3.up);
			RotationThumb2 = Quaternion.AngleAxis(rig.FixedAngles[3], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[2], Vector3.up);

			RotationIndex0 = Quaternion.AngleAxis(rig.FixedAngles[5], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[4], Vector3.up);
			RotationIndex1 = Quaternion.AngleAxis(rig.FixedAngles[6], Vector3.forward);
			RotationIndex2 = Quaternion.AngleAxis(rig.FixedAngles[8], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[7], Vector3.up);
			RotationIndex3 = Quaternion.AngleAxis(rig.FixedAngles[10], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[9], Vector3.up);

			RotationMiddle0 = Quaternion.AngleAxis(rig.FixedAngles[12], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[11], Vector3.up);
			RotationMiddle1 = Quaternion.AngleAxis(rig.FixedAngles[13], Vector3.forward);
			RotationMiddle2 = Quaternion.AngleAxis(rig.FixedAngles[15], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[14], Vector3.up);
			RotationMiddle3 = Quaternion.AngleAxis(rig.FixedAngles[17], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[16], Vector3.up);

			RotationRing0 = Quaternion.AngleAxis(rig.FixedAngles[19], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[18], Vector3.up);
			RotationRing1 = Quaternion.AngleAxis(rig.FixedAngles[20], Vector3.forward);
			RotationRing2 = Quaternion.AngleAxis(rig.FixedAngles[22], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[21], Vector3.up);
			RotationRing3 = Quaternion.AngleAxis(rig.FixedAngles[24], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[23], Vector3.up);

			RotationPinky0 = Quaternion.AngleAxis(rig.FixedAngles[26], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[25], Vector3.up);
			RotationPinky1 = Quaternion.AngleAxis(rig.FixedAngles[27], Vector3.forward);
			RotationPinky2 = Quaternion.AngleAxis(rig.FixedAngles[29], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[28], Vector3.up);
			RotationPinky3 = Quaternion.AngleAxis(rig.FixedAngles[31], Vector3.forward) * Quaternion.AngleAxis(rig.FixedAngles[30], Vector3.up);*/
			RotationThumb1 = Quaternion.AngleAxis(rig.FixedAngles[0], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[1], Vector3.forward);
			RotationThumb2 = Quaternion.AngleAxis(rig.FixedAngles[2], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[3], Vector3.forward);

			RotationIndex0 = Quaternion.AngleAxis(rig.FixedAngles[4], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[5], Vector3.forward);
			RotationIndex1 = Quaternion.AngleAxis(rig.FixedAngles[6], Vector3.forward);
			RotationIndex2 = Quaternion.AngleAxis(rig.FixedAngles[7], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[8], Vector3.forward);
			RotationIndex3 = Quaternion.AngleAxis(rig.FixedAngles[9], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[10], Vector3.forward);

			RotationMiddle0 = Quaternion.AngleAxis(rig.FixedAngles[11], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[12], Vector3.forward);
			RotationMiddle1 = Quaternion.AngleAxis(rig.FixedAngles[13], Vector3.forward);
			RotationMiddle2 = Quaternion.AngleAxis(rig.FixedAngles[14], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[15], Vector3.forward);
			RotationMiddle3 = Quaternion.AngleAxis(rig.FixedAngles[16], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[17], Vector3.forward);

			RotationRing0 = Quaternion.AngleAxis(rig.FixedAngles[18], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[19], Vector3.forward);
			RotationRing1 = Quaternion.AngleAxis(rig.FixedAngles[20], Vector3.forward);
			RotationRing2 = Quaternion.AngleAxis(rig.FixedAngles[21], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[22], Vector3.forward);
			RotationRing3 = Quaternion.AngleAxis(rig.FixedAngles[23], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[24], Vector3.forward);

			RotationPinky0 = Quaternion.AngleAxis(rig.FixedAngles[25], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[26], Vector3.forward);
			RotationPinky1 = Quaternion.AngleAxis(rig.FixedAngles[27], Vector3.forward);
			RotationPinky2 = Quaternion.AngleAxis(rig.FixedAngles[28], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[29], Vector3.forward);
			RotationPinky3 = Quaternion.AngleAxis(rig.FixedAngles[30], Vector3.up) * Quaternion.AngleAxis(rig.FixedAngles[31], Vector3.forward);
		}

		public Vector3 computeThumbTip(float[] angles)
		{
			Vector3 result = Quaternion.AngleAxis(angles[4], Vector3.right) * RotationThumb2 * PositionThumbTip;
			result = Quaternion.AngleAxis(angles[3], Vector3.right) * RotationThumb1 * (result + PositionThumb2);
			result = Quaternion.AngleAxis(angles[0], Vector3.right) * Quaternion.AngleAxis(angles[1], Vector3.up) * Quaternion.AngleAxis(angles[2], Vector3.forward) * (result + PositionThumb1);
			result += PositionThumb0;

			return result;
		}

		public Vector3 computeIndexTip(float[] angles)
		{
			Vector3 result = Quaternion.AngleAxis(angles[3], Vector3.right) * RotationIndex3 * PositionIndexTip;
			result = Quaternion.AngleAxis(angles[2], Vector3.right) * RotationIndex2 * (result + PositionIndex3);
			result = Quaternion.AngleAxis(angles[0], Vector3.right) * Quaternion.AngleAxis(angles[1], Vector3.up) * RotationIndex1 * (result + PositionIndex2);
			result = RotationIndex0 * (result + PositionIndex1);
			result += PositionIndex0;

			return result;
		}

		public Vector3 computeMiddleTip(float[] angles)
		{
			Vector3 result = Quaternion.AngleAxis(angles[3], Vector3.right) * RotationMiddle3 * PositionMiddleTip;
			result = Quaternion.AngleAxis(angles[2], Vector3.right) * RotationMiddle2 * (result + PositionMiddle3);
			result = Quaternion.AngleAxis(angles[0], Vector3.right) * Quaternion.AngleAxis(angles[1], Vector3.up) * RotationMiddle1 * (result + PositionMiddle2);
			result = RotationMiddle0 * (result + PositionMiddle1);
			result += PositionMiddle0;

			return result;
		}

		public Vector3 computeRingTip(float[] angles)
		{
			Vector3 result = Quaternion.AngleAxis(angles[3], Vector3.right) * RotationRing3 * PositionRingTip;
			result = Quaternion.AngleAxis(angles[2], Vector3.right) * RotationRing2 * (result + PositionRing3);
			result = Quaternion.AngleAxis(angles[0], Vector3.right) * Quaternion.AngleAxis(angles[1], Vector3.up) * RotationRing1 * (result + PositionRing2);
			result = RotationRing0 * (result + PositionRing1);
			result += PositionRing0;

			return result;
		}

		public Vector3 computePinkyTip(float[] angles)
		{
			Vector3 result = Quaternion.AngleAxis(angles[3], Vector3.right) * RotationPinky3 * PositionPinkyTip;
			result = Quaternion.AngleAxis(angles[2], Vector3.right) * RotationPinky2 * (result + PositionPinky3);
			result = Quaternion.AngleAxis(angles[0], Vector3.right) * Quaternion.AngleAxis(angles[1], Vector3.up) * RotationPinky1 * (result + PositionPinky2);
			result = RotationPinky0 * (result + PositionPinky1);
			result += PositionPinky0;

			return result;
		}
	};
}

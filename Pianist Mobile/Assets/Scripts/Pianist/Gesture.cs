

namespace Pianist
{
	using Vector3 = UnityEngine.Vector3;


	public class FingerGesture
	{
		public int finger;

		public float[] angles;

		public double Cost
		{
			get
			{
				// TODO:
				return 0;
			}
		}
	};

	public class HandGesture
	{
		public float[] angles;

		public double Cost
		{
			get
			{
				// TODO:
				return 0;
			}
		}
	};

	public class FingerGestureField
	{
		public FingerGesture[, ,] array;

		public static Vector3 computeGesturePosition(HandRigData rig, FingerGesture gesture)
		{
			FingerTipCalculator calculator = rig.Calculator;

			switch (gesture.finger)
			{
				case FingerIndex.THUMB:
					calculator.computeThumbTip(gesture.angles);

					break;
				case FingerIndex.INDEX:
					calculator.computeIndexTip(gesture.angles);

					break;
				case FingerIndex.MIDDLE:
					calculator.computeMiddleTip(gesture.angles);

					break;
				case FingerIndex.RING:
					calculator.computeRingTip(gesture.angles);

					break;
				case FingerIndex.PINKY:
					calculator.computePinkyTip(gesture.angles);

					break;
			}

			return Vector3.zero;
		}

		public static FingerGestureField computePointGestureField(HandRigData rig)
		{
			// TODO:
			return null;
		}
	};
}

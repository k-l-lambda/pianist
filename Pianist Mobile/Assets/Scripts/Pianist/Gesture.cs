

namespace Pianist
{
	using Vector3 = UnityEngine.Vector3;


	public class FingerGesture
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
			// TODO:
			return Vector3.zero;
		}

		public static FingerGestureField computePointGestureField(HandRigData rig)
		{
			// TODO:
			return null;
		}
	};
}

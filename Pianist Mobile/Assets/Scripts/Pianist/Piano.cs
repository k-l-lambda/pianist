
using Math = System.Math;
using System.Linq;


namespace Pianist
{
	public class Piano
	{
		public static readonly int GroupLength = 12;
		public static readonly int GroupSize = 7;

		public static readonly int PitchMin = 21;
		public static readonly int PitchMax = 108;


		public static readonly float[] GroupKeyPositions =
		{
			0, 0.38f, 1, 1.62f, 2, 3, 3.37f, 4, 4.50f, 5, 5.63f, 6, 7,
		};

		public static int pitchStep(int pitch)
		{
			return pitch % GroupLength;
		}

		public static int pitchGroup(int pitch)
		{
			return pitch / GroupLength;
		}

		public static float pitchPosition(int pitch)
		{
			int step = pitchStep(pitch);
			int group = pitchGroup(pitch);

			return group * GroupSize + GroupKeyPositions[step];
		}

		public static readonly float[] KeyPositions = Enumerable.Range(0, 120).Select(x => pitchPosition(x)).ToArray();

		public static float pitchPairDistance(int pitch1, int pitch2)
		{
			return Math.Abs(KeyPositions[pitch1] - KeyPositions[pitch2]);
		}
	};
}



namespace Pianist
{
	public class FingeringNavigator
	{
		public NotationTrack Track;

		public HandConfig Config;
		public SolveHandType HandType;

		public Fingering run()
		{
			// test
			Fingering result = new Fingering();
			result.markers = new Fingering.Marker[Track.notes.Length];

			for (int i = 0; i < Track.notes.Length; ++i)
			{
				var note = Track.notes[i];

				int f = UnityEngine.Random.Range(-5, 5);
				if (f >= 0)
					f += 1;

				result.markers[i] = new Fingering.Marker { tick = note.tick, time = note.start, pitch = note.pitch, finger = (Finger)f };
			}

			return result;
		}
	};
}

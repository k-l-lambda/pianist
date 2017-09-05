

using System.Collections.Generic;


namespace Pianist
{
	public class FingeringNavigator
	{
		private NoteSequence NoteSeq;
		private NotationTrack SourceTrack;

		public NotationTrack Track
		{
			set
			{
				SourceTrack = value;

				NoteSeq = NoteSequence.fromNotationTrack(value);
			}
		}

		public HandConfig Config;
		public SolveHandType HandType;

		public Fingering run()
		{
			// test
			Fingering result = new Fingering();
			result.markers = new Fingering.Marker[SourceTrack.notes.Length];

			for (int i = 0; i < SourceTrack.notes.Length; ++i)
			{
				var note = SourceTrack.notes[i];

				int f = UnityEngine.Random.Range(-5, 5);
				if (f >= 0)
					f += 1;

				result.markers[i] = new Fingering.Marker { tick = note.tick, time = note.start, pitch = note.pitch, finger = (Finger)f };
			}

			return result;
		}
	};
}

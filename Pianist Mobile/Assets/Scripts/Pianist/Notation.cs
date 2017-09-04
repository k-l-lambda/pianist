
using System.Collections.Generic;


namespace Pianist
{
	public class Note
	{
		public int pitch;
		public int velocity;

		public int tick;

		public float start;
		public float duration;

		public Finger finger = Finger.EMPTY;
	};

	public class NotationTrack
	{
		public Note[] notes;

		public static NotationTrack merge(NotationTrack[] tracks)
		{
			Dictionary<int, Note> noteMap = new Dictionary<int, Note>();

			foreach(NotationTrack track in tracks)
			{
				foreach(Note note in track.notes)
				{
					if(!noteMap.ContainsKey(note.tick) || note.duration < noteMap[note.tick].duration)
						noteMap[note.tick] = note;
				}
			}

			Note[] notes = new Note[noteMap.Count];
			noteMap.Values.CopyTo(notes, noteMap.Count);

			return new NotationTrack{notes = notes};
		}
	};
}

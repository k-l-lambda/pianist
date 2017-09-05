
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
			var noteList = new List<Note>();

			foreach(NotationTrack track in tracks)
			{
				foreach(Note note in track.notes)
				{
					noteList.Add(note);
				}
			}

			noteList.Sort((n1, n2) => n1.tick - n2.tick);

			Note[] notes = new Note[noteList.Count];
			noteList.CopyTo(notes);

			return new NotationTrack{notes = notes};
		}
	};
}


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


	public class NoteChord
	{
		public int tick;
		public Dictionary<int, Note> notes = new Dictionary<int, Note>();
	};


	public class NoteSequence
	{
		public NoteChord[] chords;

		public NoteChord this[int index]
		{
			get
			{
				return chords[index];
			}
		}

		public int Length
		{
			get
			{
				return chords.Length;
			}
		}


		public static NoteSequence fromNotationTrack(NotationTrack track)
		{
			var chords = new List<NoteChord>();

			NoteChord lastChord = null;

			foreach (var note in track.notes)
			{
				var chord = lastChord;
				if (chord == null || chord.tick < note.tick)
				{
					chord = new NoteChord { tick = note.tick, notes = new Dictionary<int,Note>() };
					chords.Add(chord);

					lastChord = chord;
				}

				chord.notes[note.pitch] = note;
			}

			var seq = new NoteSequence();
			seq.chords = new NoteChord[chords.Count];
			chords.CopyTo(seq.chords);

			return seq;
		}
	};
}

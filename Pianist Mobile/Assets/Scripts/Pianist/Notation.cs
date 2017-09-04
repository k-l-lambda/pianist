

namespace Pianist
{
	public class Note
	{
		int pitch;

		int tick;

		float start;
		float duration;

		Finger finger = Finger.EMPTY;
	};

	public class NotationTrack
	{
		Note[] notes;

		static NotationTrack merge(NotationTrack[] tracks);
	};
}

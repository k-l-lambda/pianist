
using System.Collections.Generic;
using UnityEngine;

using Pianist;
using Midi = Sanford.Multimedia.Midi;


using ChannelStatus = System.Collections.Generic.Dictionary<int, PitchStatus>;
using TrackStatus = System.Collections.Generic.Dictionary<int, System.Collections.Generic.Dictionary<int, PitchStatus>>;


class PitchStatus
{
	public int tick;
	public float startTime;
	public int velocity;
};


public class NotationUtils
{

	public static NotationTrack parseMidiTrack(Midi.Track track, int division)
	{
		int microsecondsPerBeat = Midi.PpqnClock.DefaultTempo;

		float time = 0;

		TrackStatus trackStatus = new TrackStatus();

		List<Note> notes = new List<Note>();

		foreach (Midi.MidiEvent e in track.Iterator())
		{
			time += e.DeltaTicks * microsecondsPerBeat / (division * 1000);

			switch (e.MidiMessage.MessageType)
			{
				case Midi.MessageType.Meta:
					Midi.MetaMessage mm = e.MidiMessage as Midi.MetaMessage;
					if (mm.MetaType == Midi.MetaType.Tempo)
					{
						Midi.TempoChangeBuilder builder = new Midi.TempoChangeBuilder(mm);
						microsecondsPerBeat = builder.Tempo;
					}

					break;
				case Midi.MessageType.Channel:
					Midi.ChannelMessage cm = e.MidiMessage as Midi.ChannelMessage;

					if (!trackStatus.ContainsKey(cm.MidiChannel))
						trackStatus[cm.MidiChannel] = new ChannelStatus();

					switch (cm.Command)
					{
						case Midi.ChannelCommand.NoteOn:
							{
								int pitch = cm.Data1;
								int velocity = cm.Data2;

								trackStatus[cm.MidiChannel][pitch] = new PitchStatus { tick = e.AbsoluteTicks, startTime = time, velocity = velocity };
							}

							break;
						case Midi.ChannelCommand.NoteOff:
							{
								int pitch = cm.Data1;

								if (!trackStatus[cm.MidiChannel].ContainsKey(pitch))
									Debug.LogWarningFormat("Unexpected noteOff: {0}, {1}", e.AbsoluteTicks, pitch);
								else
								{
									PitchStatus status = trackStatus[cm.MidiChannel][pitch];

									Note note = new Note { tick = status.tick, start = status.startTime, duration = time - status.startTime, pitch = pitch, velocity = status.velocity };
									notes.Add(note);
								}
							}

							break;
					}

					break;
			}
		}

		NotationTrack notation = new NotationTrack();
		notation.notes = notes.ToArray();

		return notation;
	}
};

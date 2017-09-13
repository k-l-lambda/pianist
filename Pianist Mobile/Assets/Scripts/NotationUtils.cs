
using System.Collections.Generic;
using UnityEngine;
using Regex = System.Text.RegularExpressions.Regex;

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
	static readonly string MidiSignatureText = "Fingering by K.L.Pianist, fingering-marker-pattern:finger:(\\d+)\\|([\\d,-]+)";


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

								if (pitch >= Piano.PitchMin && pitch <= Piano.PitchMax)
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

	public static NotationTrack[] parseMidiFile(Midi.Sequence file)
	{
		NotationTrack[] tracks = new NotationTrack[file.Count];

		for (int i = 0; i < file.Count; ++i)
			tracks[i] = parseMidiTrack(file[i], file.Division);

		return tracks;
	}

	public static void clearFingeringInMidiFile(Midi.Sequence file)
	{
		Regex signaturePattern = new Regex("^Fingering");
		Regex fingerPattern = new Regex("^finger:");

		foreach (Midi.Track track in file)
		{
			System.Collections.Generic.List<int> toRemove = new System.Collections.Generic.List<int>();

			for (int i = track.Count - 1; i >= 0; --i)
			{
				Midi.MidiEvent e = track.GetMidiEvent(i);

				if (e.MidiMessage.MessageType == Midi.MessageType.Meta)
				{
					Midi.MetaMessage msg = e.MidiMessage as Midi.MetaMessage;
					switch (msg.MetaType)
					{
						case Midi.MetaType.Text:
							if (signaturePattern.Match(System.Text.Encoding.Default.GetString(msg.GetBytes())).Length > 0)
								toRemove.Add(i);

							break;
						case Midi.MetaType.Marker:
							if (fingerPattern.Match(System.Text.Encoding.Default.GetString(msg.GetBytes())).Length > 0)
								toRemove.Add(i);

							break;
					}
				}
			}

			foreach (int i in toRemove)
				track.RemoveAt(i);
		}
	}

	public static void appendFingeringToMidiFile(Midi.Sequence file, Fingering[] fingerings)
	{
		if (file.Count == 0)
		{
			Debug.LogWarning("MIDI no track found.");
			return;
		}

		var FingerMap = new Dictionary<int, Dictionary<int, Finger>>();

		foreach (var fingering in fingerings)
		{
			if (fingering.markers == null)
			{
				Debug.LogWarning("fingering markers is null.");
				continue;
			}

			foreach (var marker in fingering.markers)
			{
				if (!FingerMap.ContainsKey(marker.tick))
					FingerMap[marker.tick] = new Dictionary<int, Finger>();

				FingerMap[marker.tick][marker.pitch] = marker.finger;
				//Debug.LogFormat("marker: {0}, {1}, {2}", marker.tick, marker.pitch, marker.finger);
			}
		}

		clearFingeringInMidiFile(file);

		file[0].Insert(0, new Midi.MetaMessage(Midi.MetaType.Text, System.Text.Encoding.Default.GetBytes(MidiSignatureText)));

		foreach (Midi.Track track in file)
		{
			foreach(Midi.MidiEvent e in track.Iterator())
			{
				if (e.MidiMessage.MessageType == Midi.MessageType.Channel)
				{
					Midi.ChannelMessage cm = e.MidiMessage as Midi.ChannelMessage;
					if (cm.Command == Midi.ChannelCommand.NoteOn)
					{
						if (FingerMap.ContainsKey(e.AbsoluteTicks) && FingerMap[e.AbsoluteTicks].ContainsKey(cm.Data1))
						{
							Finger f = FingerMap[e.AbsoluteTicks][cm.Data1];

							string marker = string.Format("finger:{0}|{1}", cm.Data1, (int)f);

							track.Insert(e.AbsoluteTicks, new Midi.MetaMessage(Midi.MetaType.Marker, System.Text.Encoding.Default.GetBytes(marker)));
						}
					}
				}
			}
		}
	}
};

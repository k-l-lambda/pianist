
using System.Collections.Generic;
using UnityEngine;
using Regex = System.Text.RegularExpressions.Regex;

using Pianist;
using Midi = Sanford.Multimedia.Midi;


using ChannelStatus = System.Collections.Generic.Dictionary<int, PitchStatus>;
using TrackStatus = System.Collections.Generic.Dictionary<int, System.Collections.Generic.Dictionary<int, PitchStatus>>;

using FingerChord = System.Collections.Generic.SortedDictionary<int, Pianist.Finger>;
using FingerChordMap = System.Collections.Generic.Dictionary<int, System.Collections.Generic.SortedDictionary<int, Pianist.Finger>>;


class PitchStatus
{
	public int tick;
	public float startTime;
	public int velocity;
};


public class NotationUtils
{
	static readonly string MidiSignatureText = "Fingering by K.L.Pianist, fingering-marker-pattern:finger:(\\d+)\\|([\\d,-]+)";


	public static NotationTrack parseMidiTrack(Midi.Track track, int division, ref Regex fingerPattern)
	{
		int microsecondsPerBeat = Midi.PpqnClock.DefaultTempo;

		float time = 0;

		TrackStatus trackStatus = new TrackStatus();
		FingerChordMap fingerMap = new FingerChordMap();

		List<Note> notes = new List<Note>();

		Regex fingerMetaPattern = new Regex("fingering-marker-pattern:(.*)");

		foreach (Midi.MidiEvent e in track.Iterator())
		{
			time += e.DeltaTicks * microsecondsPerBeat / (division * 1000);

			switch (e.MidiMessage.MessageType)
			{
				case Midi.MessageType.Meta:
					Midi.MetaMessage mm = e.MidiMessage as Midi.MetaMessage;
					switch (mm.MetaType)
					{
						case Midi.MetaType.Tempo:
							Midi.TempoChangeBuilder builder = new Midi.TempoChangeBuilder(mm);
							microsecondsPerBeat = builder.Tempo;

							break;
						case Midi.MetaType.Text:
							{
								string text = System.Text.Encoding.Default.GetString(mm.GetBytes());
								var match = fingerMetaPattern.Match(text);
								if (match.Success)
								{
									fingerPattern = new Regex(match.Groups[1].ToString());
									Debug.LogFormat("Finger Pattern found: {0}", fingerPattern.ToString());
								}
							}

							break;
						case Midi.MetaType.Marker:
							if (fingerPattern != null)
							{
								string text = System.Text.Encoding.Default.GetString(mm.GetBytes());
								var match = fingerPattern.Match(text);
								if (match.Success)
								{
									//Debug.LogFormat("Finger: {0}", text);
									try
									{
										int pitch = int.Parse(match.Groups[1].ToString());
										Finger finger = (Finger)int.Parse(match.Groups[2].ToString());

										if (!fingerMap.ContainsKey(e.AbsoluteTicks))
											fingerMap[e.AbsoluteTicks] = new FingerChord();

										fingerMap[e.AbsoluteTicks][pitch] = finger;
									}
									catch (System.Exception except)
									{
										Debug.LogWarningFormat("fingering marker parse failed: {0}, {1}", text, except.Message);
									}
								}
								//else
								//	Debug.LogWarningFormat("fail marker: {0}", text);
							}

							break;
					}

					break;
				case Midi.MessageType.Channel:
					Midi.ChannelMessage cm = e.MidiMessage as Midi.ChannelMessage;

					if (!trackStatus.ContainsKey(cm.MidiChannel))
						trackStatus[cm.MidiChannel] = new ChannelStatus();

					var commandType = cm.Command;
					if (commandType == Midi.ChannelCommand.NoteOn && cm.Data2 == 0)
						commandType = Midi.ChannelCommand.NoteOff;

					switch (commandType)
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

									if (fingerMap.ContainsKey(note.tick) && fingerMap[note.tick].ContainsKey(note.pitch))
										note.finger = fingerMap[note.tick][note.pitch];

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

		Regex fingerPattern = null;

		for (int i = 0; i < file.Count; ++i)
			tracks[i] = parseMidiTrack(file[i], file.Division, ref fingerPattern);

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

using UnityEngine;
using System.IO;
using Midi = Sanford.Multimedia.Midi;


[ExecuteInEditMode]
public class FingeringGenerator : MonoBehaviour
{
	public TextAsset SourceAsset;
	public Midi.Sequence MidiSeq;


	void Start ()
	{
		if (SourceAsset)
			load();
	}

	public void load()
	{
		if (!SourceAsset)
		{
			Debug.LogError("SourceAsset is null.");
			return;
		}

		MemoryStream stream = new MemoryStream();
		stream.Write(SourceAsset.bytes, 0, SourceAsset.bytes.Length);
		stream.Position = 0;

		MidiSeq = new Midi.Sequence();
		MidiSeq.Load(stream);
	}

	public void generate(string fileName)
	{
		if (MidiSeq == null)
			load();

		run(MidiSeq);

		FileStream file = new FileStream(fileName, FileMode.OpenOrCreate);
		MidiSeq.Save(file);
		file.Close();

		Debug.Log("MIDI file saved: " + fileName);
	}

	public static void clear(Midi.Sequence seq)
	{
		foreach (Midi.Track track in seq)
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
							if (new System.Text.RegularExpressions.Regex("^Fingering").Match(System.Text.Encoding.Default.GetString(msg.GetBytes())).Length > 0)
								toRemove.Add(i);

							break;
						case Midi.MetaType.Marker:
							if (new System.Text.RegularExpressions.Regex("^finger:").Match(System.Text.Encoding.Default.GetString(msg.GetBytes())).Length > 0)
								toRemove.Add(i);

							break;
					}
				}
			}

			foreach (int i in toRemove)
				track.RemoveAt(i);
		}
	}

	public static void run(Midi.Sequence seq)
	{
		if (seq.Count == 0)
		{
			Debug.LogWarning("MIDI no track found.");
			return;
		}

		clear(seq);

		seq[0].Insert(0, new Midi.MetaMessage(Midi.MetaType.Text, System.Text.Encoding.Default.GetBytes("Fingering by K.L.Pianist, fingering-marker-pattern:finger:(\\d+)\\|([\\d,]+)")));

		foreach (Midi.Track track in seq)
		{
			foreach(Midi.MidiEvent e in track.Iterator())
			{
				if (e.MidiMessage.MessageType == Midi.MessageType.Channel)
				{
					Midi.ChannelMessage cm = e.MidiMessage as Midi.ChannelMessage;
					if (cm.Command == Midi.ChannelCommand.NoteOn)
					{
						int f = Random.Range(-5, 5);
						if (f >= 0)
							f += 1;

						string marker = string.Format("finger:{0}|{1}", cm.Data1, f);

						track.Insert(e.AbsoluteTicks, new Midi.MetaMessage(Midi.MetaType.Marker, System.Text.Encoding.Default.GetBytes(marker)));
					}
				}
			}
		}
	}
}

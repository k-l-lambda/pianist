using UnityEngine;
using System;
using System.IO;
using System.Collections.Generic;

using Random = UnityEngine.Random;
using Midi = Sanford.Multimedia.Midi;
using Pianist;


[ExecuteInEditMode]
[RequireComponent(typeof(HandConfigLibrary))]
public class FingeringGenerator : MonoBehaviour
{
	HandConfigLibrary HandConfigLib;

	public TextAsset SourceAsset;
	public Midi.Sequence MidiSeq;


	[System.Serializable]
	public class Hand
	{
		public string Config;
		public SolveHandType Type;
	}

	public Hand[] Hands;

	public int[] TrackHandIndices;

	public Dictionary<int, int[]> HandTracksMap
	{
		get
		{
			Dictionary<int, int[]> map = new Dictionary<int, int[]>();

			for (int i = 0; i < TrackHandIndices.Length; ++i)
			{
				int index = TrackHandIndices[i];
				if (index >= 0)
				{
					if(!map.ContainsKey(index))
						map[index] = new int[0];

					int[] list = map[index];

					Array.Resize(ref list, map[index].Length + 1);
					list[list.Length - 1] = i;

					map[index] = list;
				}
			}

			return map;
		}
	}

	FingeringNavigator Navigator = new FingeringNavigator();


	void Start ()
	{
		HandConfigLib = GetComponent<HandConfigLibrary>();

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

		TrackHandIndices = new int[MidiSeq.Count];
	}

	public void generate(string fileName)
	{
		if (MidiSeq == null)
			load();

		run();

		FileStream file = new FileStream(fileName, FileMode.OpenOrCreate);
		MidiSeq.Save(file);
		file.Close();

		Debug.Log("MIDI file saved: " + fileName);
	}

	/*public void clear()
	{
		Regex signaturePattern = new Regex("^Fingering");
		Regex fingerPattern = new Regex("^finger:");

		foreach (Midi.Track track in MidiSeq)
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
	}*/

	public void run()
	{
		if (MidiSeq.Count == 0)
		{
			Debug.LogWarning("MIDI no track found.");
			return;
		}

		if(!HandConfigLib)
			HandConfigLib = GetComponent<HandConfigLibrary>();

		if (!HandConfigLib)
			Debug.LogError("HandConfigLibrary is null.");

		//clear();

		//MidiSeq[0].Insert(0, new Midi.MetaMessage(Midi.MetaType.Text, System.Text.Encoding.Default.GetBytes(MidiSignatureText)));

		NotationTrack[] notation = NotationUtils.parseMidiFile(MidiSeq);

		var trackMap = HandTracksMap;
		Fingering[] results = new Fingering[trackMap.Count];
		int resultIndex = 0;

		foreach (var pair in trackMap)
		{
			if (pair.Key >= Hands.Length)
			{
				Debug.LogErrorFormat("Hand index {0} out of hand config range.", pair.Key);
				return;
			}

			Hand hand = Hands[pair.Key];

			int[] trackList = pair.Value;

			NotationTrack[] tracks = new NotationTrack[trackList.Length];
			for(int track = 0; track < trackList.Length; ++track)
				tracks[track] = notation[track];

			Navigator.Track = NotationTrack.merge(tracks);
			Navigator.Config = HandConfigLib.getConfig(hand.Config);

			if (Navigator.Config == null)
			{
				Debug.LogErrorFormat("Hand config of {0} is null.", hand.Config);
				return;
			}

			Navigator.HandType = hand.Type;

			results[resultIndex++] = Navigator.run();
		}

		NotationUtils.appendFingeringToMidiFile(MidiSeq, results);
	}
}

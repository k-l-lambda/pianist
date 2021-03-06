﻿using UnityEngine;
using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;

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

	public NotationTrack[] Notation;


	[System.Serializable]
	public class Hand
	{
		public string Config;
		public SolveHandType Type;
		public float AdaptionSpeed = 1;
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

	public bool KeepConstraints = true;

	public int StepCountMin = 100;
	public int StepCountMax = 1000;

	public int BubbleLength = 100;

	public float EstimationStepIncrement = 0.1f;

	public bool DumpTree = true;

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

		if (TrackHandIndices == null || TrackHandIndices.Length != MidiSeq.Count)
			TrackHandIndices = Enumerable.Repeat(-1, MidiSeq.Count).ToArray();

		Notation = NotationUtils.parseMidiFile(MidiSeq);
	}

	public void generate(string fileName)
	{
		if (Notation == null)
			load();

		run();

		FileStream file = new FileStream(fileName, FileMode.Create);
		MidiSeq.Save(file);
		file.Close();

		Debug.Log("MIDI file saved: " + fileName);
	}

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
				tracks[track] = Notation[trackList[track]];

			Navigator.Track = NotationTrack.merge(tracks);
			Navigator.Config = HandConfigLib.getConfig(hand.Config);
			Navigator.KeepConstraints = KeepConstraints;
			Navigator.MinStepCount = StepCountMin;
			Navigator.MaxStepCount = StepCountMax;
			Navigator.BubbleLength = BubbleLength;
			Navigator.EstimationStepIncrement = EstimationStepIncrement;

			if (Navigator.Config == null)
			{
				Debug.LogErrorFormat("Hand config of {0} is null.", hand.Config);
				return;
			}

			Navigator.HandType = hand.Type;
			Navigator.AdaptionSpeed = hand.AdaptionSpeed;

			results[resultIndex++] = Navigator.run();

			if (DumpTree)
			{
#if UNITY_EDITOR
				UnityEditor.EditorUtility.DisplayProgressBar("FingeringGenerator", "DumpTree ...", 0);
#endif

				FileStream file = new FileStream(Application.dataPath + "/Editor/Log/FingeringNavigatorTreeDump" + pair.Key.ToString() + ".txt", FileMode.Create);

				byte[] bytes = System.Text.Encoding.Default.GetBytes(Navigator.getTreeJsonDump());
#if UNITY_EDITOR
				UnityEditor.EditorUtility.DisplayProgressBar("FingeringGenerator", string.Format("DumpTree {0:n} bytes...", bytes.Length), 0);
#endif
				file.Write(bytes, 0, bytes.Length);

				file.Close();

#if UNITY_EDITOR
				UnityEditor.EditorUtility.ClearProgressBar();
#endif
			}

			/*// dump leaf nodes
			{
				FileStream file = new FileStream(Application.dataPath + "/Editor/Log/leaves.txt", FileMode.Create);

				file.WriteByte((byte)'[');
				List<FingeringNavigator.TreeNode> leaves = Navigator.TreeLeaves;
				leaves.Sort(delegate(FingeringNavigator.TreeNode node1, FingeringNavigator.TreeNode node2)
				{
					double cost1 = node1.CommittedCost;
					double cost2 = node2.CommittedCost;

					return cost1.CompareTo(cost2);
				});
				foreach(var leaf in leaves)
				{
					byte[] bytes = System.Text.Encoding.Default.GetBytes(leaf.JsonDump);
					file.Write(bytes, 0, bytes.Length);
					file.WriteByte((byte)',');
				}
				file.WriteByte((byte)'{');
				file.WriteByte((byte)'}');
				file.WriteByte((byte)']');

				file.Close();
			}*/
		}

		NotationUtils.appendFingeringToMidiFile(MidiSeq, results);
	}

	public void dumpNode(string path)
	{
		FingeringNavigator.TreeNode node = Navigator.getTreeNodeByPath(path);
		if (node != null)
			Debug.Log(node.JsonDumpSelf);
		else
			Debug.Log("Not found: " + path);
	}
}

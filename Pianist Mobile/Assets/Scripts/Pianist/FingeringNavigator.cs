

using System;
using System.Collections.Generic;


namespace Pianist
{
	using FingerChord = Dictionary<int, Finger>;


	public class FingeringNavigator
	{
		class TreeNode
		{
			public TreeNode parent = null;
			public TreeNode[] children = new TreeNode[0];

			int depth = -1;

			public int Index
			{
				get
				{
					if (depth >= 0)
						return depth;

					if (parent != null)
					{
						depth = parent.Index + 1;
						return depth;
					}

					// root node
					return -1;
				}
			}

			FingerChord data;
			public FingerChord Data
			{
				get
				{
					return data;
				}
			}

			double difficulty;

			public double SelfDifficulty
			{
				get
				{
					return difficulty;
				}
			}

			public double CommittedDifficulty
			{
				get
				{
					double parentDiff = parent != null ? parent.CommittedDifficulty : 0;

					return parentDiff + difficulty;
				}
			}


			public TreeNode(FingerChord chord = null, double diff = 0)
			{
				data = chord;
				difficulty = diff;
			}

			public void appendChild(TreeNode child)
			{
				Array.Resize(ref children, children.Length + 1);
				children[children.Length - 1] = child;
				child.parent = this;
			}

			public void appendChild(FingerChord chord)
			{
				appendChild(new TreeNode(chord));
			}
		};


		private NoteSequence NoteSeq;
		private NotationTrack SourceTrack;

		public NotationTrack Track
		{
			set
			{
				SourceTrack = value;

				NoteSeq = NoteSequence.fromNotationTrack(value);
			}
		}

		public HandConfig Config;
		public SolveHandType HandType;

		TreeNode TreeRoot;
		List<TreeNode> TreeLeaves;

		public Fingering run()
		{
			TreeRoot = new TreeNode();
			TreeLeaves = new List<TreeNode>();
			TreeLeaves.Add(TreeRoot);

			for (int i = 0; i < 100; ++i)
			{
				if (TreeLeaves.Count == 0)
					break;

				step();
			}

			// test
			Fingering result = new Fingering();
			result.markers = new Fingering.Marker[SourceTrack.notes.Length];

			for (int i = 0; i < SourceTrack.notes.Length; ++i)
			{
				var note = SourceTrack.notes[i];

				int f = UnityEngine.Random.Range(-5, 5);
				if (f >= 0)
					f += 1;

				result.markers[i] = new Fingering.Marker { tick = note.tick, time = note.start, pitch = note.pitch, finger = (Finger)f };
			}

			return result;
		}

		double evaluateNodeDifficulty(TreeNode leaf, FingerChord chord)
		{
			double chordPrior = evaluateChordPriorDifficulty(chord);

			// TODO:
			return chordPrior;
		}

		double evaluateChordPriorDifficulty(FingerChord chord)
		{
			// TODO:
			double difficulty = 0;
			foreach(var pair in chord)
				difficulty += evaluateFingerPriorDifficulty(pair.Key, pair.Value);

			return difficulty;
		}

		double evaluateFingerPriorDifficulty(int pitch, Finger finger)
		{
			// TODO:
			return Math.Abs(pitch - 60);
		}

		void step()
		{
			TreeLeaves.Sort(delegate(TreeNode node1, TreeNode node2)
			{
				return node1.CommittedDifficulty.CompareTo(node2.CommittedDifficulty);
			});

			TreeNode currentLeave = TreeLeaves[0];
			TreeLeaves.RemoveAt(0);

			if (currentLeave.Index >= NoteSeq.chords.Length - 1)
			{
				// TODO: completed path
				return;
			}

			NoteChord currentNode = NoteSeq.chords[currentLeave.Index];
			NoteChord nextNode = NoteSeq.chords[currentLeave.Index + 1];

			// TODO:
		}
	};
}

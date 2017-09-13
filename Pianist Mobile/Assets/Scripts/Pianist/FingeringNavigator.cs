

using System;
using System.Collections.Generic;


namespace Pianist
{
	using FingerChord = SortedDictionary<int, Finger>;


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

			int choice;
			public int Choice
			{
				get
				{
					return choice;
				}
			}

			double cost;

			public double SelfCost
			{
				get
				{
					return cost;
				}
			}

			public double CommittedCost
			{
				get
				{
					double parentDiff = parent != null ? parent.CommittedCost : 0;

					return parentDiff + cost;
				}
			}


			public TreeNode(int choice_ = -1, double cost_ = 0)
			{
				choice = choice_;
				cost = cost_;
			}

			public void appendChild(TreeNode child)
			{
				Array.Resize(ref children, children.Length + 1);
				children[children.Length - 1] = child;
				child.parent = this;
			}

			public TreeNode appendChild(int choice_ = -1, double cost_ = 0)
			{
				TreeNode child = new TreeNode(choice_, cost_);
				appendChild(child);

				return child;
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

		class CostEstimation
		{
			double accumulation = 0;
			int count = 0;

			public double Value
			{
				get
				{
					return accumulation;
				}
			}

			public void append(double value, int times = 1)
			{
				count++;
				accumulation = accumulation * (count - 1) / count + value / count;
			}
		};

		public HandConfig Config;
		public SolveHandType HandType;

		public FingerChord[] Constraints;

		CostEstimation[] EstimatedCosts;

		FingerChord[][] ChoiceSequence;

		TreeNode TreeRoot;
		List<TreeNode> TreeLeaves;

		public Fingering run()
		{
			generateChoiceSequence();

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

		double evaluateNodeCost(TreeNode leaf, FingerChord chord)
		{
			double chordPrior = evaluateChordPriorCost(chord);

			// TODO:
			return chordPrior;
		}

		double evaluateChordPriorCost(FingerChord chord)
		{
			// TODO:
			double cost = 0;
			foreach(var pair in chord)
				cost += evaluateFingerPriorCost(pair.Key, pair.Value);

			return cost;
		}

		double evaluateFingerPriorCost(int pitch, Finger finger)
		{
			// TODO:
			return Math.Abs(pitch - 60);
		}

		void step()
		{
			double[] accumulatedEstimatedCosts = new double[NoteSeq.Length + 1];
			accumulatedEstimatedCosts[NoteSeq.Length] = 0;
			for (int i = NoteSeq.Length - 1; i >= 0; ++i)
				accumulatedEstimatedCosts[i] = EstimatedCosts[i].Value + accumulatedEstimatedCosts[i + 1];

			TreeLeaves.Sort(delegate(TreeNode node1, TreeNode node2)
			{
				double cost1 = node1.CommittedCost + accumulatedEstimatedCosts[node1.Index + 1];
				double cost2 = node2.CommittedCost + accumulatedEstimatedCosts[node2.Index + 1];

				return cost1.CompareTo(cost2);
			});

			TreeNode currentLeave = TreeLeaves[0];
			TreeLeaves.RemoveAt(0);

			if (currentLeave.Index >= NoteSeq.Length - 1)
			{
				// TODO: completed path
				return;
			}

			//NoteChord currentNode = NoteSeq[currentLeave.Index];
			//NoteChord nextNode = NoteSeq[currentLeave.Index + 1];

			FingerChord[] choices = ChoiceSequence[currentLeave.Index + 1];
			for (int i = 0; i < choices.Length; ++i)
			{
				double cost = evaluateNodeCost(currentLeave, choices[i]);
				TreeNode leaf = currentLeave.appendChild(i, cost);

				TreeLeaves.Add(leaf);
			}
		}

		void generateChoiceSequence()
		{
			ChoiceSequence = new FingerChord[NoteSeq.Length][];
			EstimatedCosts = new CostEstimation[NoteSeq.Length];

			for (int i = 0; i < ChoiceSequence.Length; ++i)
			{
				ChoiceSequence[i] = getFingerChoices(NoteSeq[i]);

				EstimatedCosts[i] = new CostEstimation();
				// TODO: initialize estimated costs with minimized static note cost
			}
		}

		FingerChord[] getFingerChoices(NoteChord nc)
		{
			if(nc.notes.Count == 0)
				return new FingerChord[0];

			List<FingerChord> choices = new List<FingerChord>();

			int[] pitches = new int[nc.notes.Count];
			nc.notes.Keys.CopyTo(pitches, 0);

			int fingerCount = HandType == SolveHandType.MIX ? 10 : 5;

			int emptyQuota = Math.Max(pitches.Length - fingerCount, 0);
			FingerChord fc = new FingerChord();
			while (choices.Count == 0)
				tryFingerChoice(pitches, ref choices, fc, 0, emptyQuota++);

			return choices.ToArray();
		}

		void tryFingerChoice(int[] pitches, ref List<FingerChord> choices, FingerChord fc, int currentNoteIndex, int emptyQuota)
		{
			if (currentNoteIndex >= pitches.Length)
			{
				choices.Add(fc);

				/*Finger[] fa = new Finger[fc.Values.Count];
				fc.Values.CopyTo(fa, 0);
				UnityEngine.Debug.Log("fc: " + String.Join(",", Array.ConvertAll(fa, x => ((int)x).ToString())));*/
			}
			else
			{
				int currentPitch = pitches[currentNoteIndex];

				foreach(Finger f in FingerConstants.SolveTypeFingers[HandType])
				{
					bool pass = true;
					for (int index = currentNoteIndex - 1; index >= 0; --index)
					{
						int pitch = pitches[index];
						Finger finger = fc[pitch];

						float distance = Piano.pitchPairDistance(pitch, currentPitch);

						pass = FingerConstants.testFingerDistance(finger, f, Config, distance);
						if (!pass)
							break;
					}

					if (pass)
					{
						fc[currentPitch] = f;
						tryFingerChoice(pitches, ref choices, fc, currentNoteIndex + 1, emptyQuota);
					}
				}

				if (emptyQuota > 0)
				{
					fc[currentPitch] = Finger.EMPTY;
					tryFingerChoice(pitches, ref choices, fc, currentNoteIndex + 1, emptyQuota - 1);
				}
			}
		}
	};
}

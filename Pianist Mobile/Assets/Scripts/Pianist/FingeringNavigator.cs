

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

			NoteChord currentNode = NoteSeq[currentLeave.Index];
			NoteChord nextNode = NoteSeq[currentLeave.Index + 1];

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
			// TODO:
			FingerChord empty = new FingerChord();
			foreach(var pair in nc.notes)
				empty[pair.Key] = Finger.EMPTY;

			return new FingerChord[]{empty};
		}
	};
}

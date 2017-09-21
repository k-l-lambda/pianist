

using System;
using System.Collections.Generic;


namespace Pianist
{
	using FingerChord = SortedDictionary<int, Finger>;
	using FingerMap = SortedDictionary<int, SortedDictionary<int, Finger>>;


	public class FingeringNavigator
	{
		public class TreeNode
		{
			public TreeNode parent = null;
			public TreeNode[] children = new TreeNode[0];

			public int StepIndex = -1;

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

			int choiceIndex;
			public int Choice
			{
				get
				{
					return choiceIndex;
				}
			}

			public string ChoicePathDescription
			{
				get
				{
					string prefix = parent != null ? parent.ChoicePathDescription : "";

					string desc = choiceIndex >= 0 ? (prefix.Length > 0 ? "-" : "") + choiceIndex.ToString() : "";

					return prefix + desc;
				}
			}

			HandConfig handConfig;

			FingerChord fingerChord;

			HandConfig.RangePair wrists;

			float timeUnit;

			double staticCost;
			double dynamicCost;

			public double SelfCost
			{
				get
				{
					return staticCost + dynamicCost;
				}
			}

			public double CommittedCost
			{
				get
				{
					double parentCost = parent != null ? parent.CommittedCost : 0;

					return parentCost + SelfCost;
				}
			}

			public string JsonDump
			{
				get
				{
					string result = "{";

					if (choiceIndex >= 0)
					{
						result += "\"choice\":" + FingerConstants.getFingerChordJsonDump(fingerChord) + ",";
						result += "\"cost\":" + SelfCost.ToString() + ",";
						//if (wrists.right != null)
						//	result += "\"middle\":" + wrists.right.middle.ToString() + ",";
					}

					result += "\"stepIndex\":" + StepIndex.ToString() + ",";

					result += "\"children\":[";

					foreach (TreeNode child in children)
						if (child.StepIndex > 0)
							result += child.JsonDump + ",";

					if (result[result.Length - 1] == ',')
						result = result.Remove(result.Length - 1, 1);

					result += "]";

					result += "}";

					return result;
				}
			}


			public TreeNode()
			{
				choiceIndex = -1;
				staticCost = 0;
				dynamicCost = 0;
			}

			TreeNode(Choice[] choices, HandConfig config, float benchmarkDuration, int choiceIndex_)
			{
				handConfig = config;

				choiceIndex = choiceIndex_;

				Choice choice = choices[choiceIndex];

				fingerChord = choice.chord;
				staticCost = choice.staticCost;
				wrists = choice.wrists;
				timeUnit = choice.deltaTime / benchmarkDuration;
			}

			public void appendChild(TreeNode child)
			{
				Array.Resize(ref children, children.Length + 1);
				children[children.Length - 1] = child;
				child.parent = this;
			}

			public TreeNode appendChild(Choice[] choices, HandConfig config, float benchmarkDuration, int choiceIndex_)
			{
				TreeNode child = new TreeNode(choices, config, benchmarkDuration, choiceIndex_);
				appendChild(child);

				child.dynamicCost = child.evaluateDynamicCost();

				return child;
			}

			double evaluateSingleArmCost(HandConfig.Range lastWrist, HandConfig.Range currentWrist)
			{
				double cost = 0;

				cost += Math.Abs(currentWrist.middle - lastWrist.middle) / timeUnit;

				if (!(lastWrist.low < currentWrist.high && lastWrist.high > currentWrist.low))
					cost += Math.Min(Math.Abs(currentWrist.low - lastWrist.high), Math.Abs(lastWrist.low - currentWrist.high)) * 10 / timeUnit;

				// TODO:

				return cost;
			}

			double evaluateDynamicCost()
			{
				double cost = 0;

				if (parent != null)
				{
					if (wrists.left != null && parent.wrists.left != null)
						cost += evaluateSingleArmCost(parent.wrists.left, wrists.left);

					if (wrists.right != null && parent.wrists.right != null)
						cost += evaluateSingleArmCost(parent.wrists.right, wrists.right);
				}

				return cost;
			}
		};


		public class LeafSequence : List<TreeNode>
		{
			public double[] StairCosts;

			void insertRange(TreeNode node, double cost, int low, int high)
			{
				if (high <= low + 1)
				{
					Insert(high, node);
					return;
				}

				int middle = low + (high - low) / 2;
				double middleCost = getNodeCost(this[middle]);

				if (cost > middleCost)
					insertRange(node, cost, middle, high);
				else if (cost < middleCost)
					insertRange(node, cost, low, middle);
				else
					Insert(middle, node);
			}

			void swap(int i1, int i2)
			{
				var temp = this[i1];
				this[i1] = this[i2];
				this[i2] = temp;
			}

			double getNodeCost(TreeNode node)
			{
				return node.CommittedCost + StairCosts[node.Index + 1];
			}

			public void insert(TreeNode node)
			{
				insertRange(node, getNodeCost(node), -1, Count);
			}

			public void bubbleOnce(int tail)
			{
				tail = Math.Min(tail, Count - 1);

				//int times = 0;

				double lastCost = getNodeCost(this[tail]);
				for (int i = tail - 1; i >= 0; --i)
				{
					double cost = getNodeCost(this[i]);
					if (lastCost < cost)
					{
						swap(i + 1, i);
						//UnityEngine.Debug.LogFormat("Swap: [{0}]	{1}	{2}", i, cost, cost - lastCost);
						//++times;
					}

					lastCost = cost;
				}

				//UnityEngine.Debug.LogFormat("Swap times: {0}", times);
			}

			public TreeNode Top
			{
				get
				{
					if(Count > 0)
						return this[0];

					return null;
				}
			}
		};


		public int MinStepCount = 100;
		public int MaxStepCount = 1000;

		public int BubbleLength = 100;

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

		float benchmarkDuration = HandConfig.BenchmarkDuration;
		public float AdaptionSpeed
		{
			set
			{
				benchmarkDuration = HandConfig.BenchmarkDuration * value;
			}
		}

		public bool KeepConstraints = true;

		CostEstimation[] EstimatedCosts;

		public struct Choice
		{
			public FingerChord chord;
			public double staticCost;
			public HandConfig.RangePair wrists;
			public float deltaTime;
		};

		Choice[][] ChoiceSequence;

		TreeNode TreeRoot;
		//public List<TreeNode> TreeLeaves;
		LeafSequence TreeLeaves;
		public List<TreeNode> ResultNodes;

		TreeNode currentNode;

		TreeNode candidateNode;

		int currentStep = 0;

		public Fingering run()
		{
			generateChoiceSequence();

			TreeRoot = new TreeNode();
			TreeLeaves = new LeafSequence();
			TreeLeaves.Add(TreeRoot);

			ResultNodes = new List<TreeNode>();

			currentNode = TreeRoot;
			candidateNode = TreeRoot;

			for (int i = 0; i < MaxStepCount; ++i)
			{
				if (TreeLeaves.Count == 0)
					break;

				if (i >= MinStepCount && ResultNodes.Count > 0)
					break;

				currentStep = i;

				step();

#if UNITY_EDITOR
				{
					const int lenMax = 70;

					string info = string.Format("Analyzing: {2}/{3}, {0}, {1}", Math.Round(currentNode.CommittedCost, 4), currentNode.ChoicePathDescription, currentNode.Index, NoteSeq.Length);
					if (info.Length > lenMax)
						info = info.Substring(0, lenMax - 9) + "..." + info.Substring(info.Length - 6, 6);

					if (UnityEditor.EditorUtility.DisplayCancelableProgressBar("FingeringNavigator running", info, (float)i / MaxStepCount))
						break;
				}
#endif
			}

			ResultNodes.Sort(delegate(TreeNode node1, TreeNode node2)
			{
				double cost1 = node1.CommittedCost;
				double cost2 = node2.CommittedCost;

				return cost1.CompareTo(cost2);
			});

			TreeNode resultNode = ResultNodes.Count > 0 ? ResultNodes[0] : candidateNode;

			Fingering result = new Fingering();
			result.markers = new Fingering.Marker[SourceTrack.notes.Length];

			// generate markers
			FingerMap map = getTreeNodeFingerMap(resultNode);
			for (int i = 0; i < SourceTrack.notes.Length; ++i)
			{
				var note = SourceTrack.notes[i];

				Finger finger = map.ContainsKey(note.tick) && map[note.tick].ContainsKey(note.pitch) ? map[note.tick][note.pitch] : Finger.EMPTY;

				result.markers[i] = new Fingering.Marker { tick = note.tick, time = note.start, pitch = note.pitch, finger = finger };
			}

#if UNITY_EDITOR
			UnityEditor.EditorUtility.ClearProgressBar();
#endif

			return result;
		}

		Choice evaluateChordChoice(FingerChord chord, float deltaTime)
		{
			HandConfig.RangePair wrists = Config.getFingerChordWristRange(chord);

			double cost = 0;

			// wrist position naturality reward
			if (wrists.left != null)
			{
				float distance = Math.Abs(wrists.left.middle - -HandConfig.WristNaturePosition);
				cost = Math.Pow(distance / 14, 4);
			}

			if (wrists.right != null)
			{
				float distance = Math.Abs(wrists.right.middle - HandConfig.WristNaturePosition);
				cost = Math.Pow(distance / 14, 4);
			}

			// shift fingers punish
			foreach (Finger f in chord.Values)
			{
				if (Math.Abs((int)f) > 10)
					cost += 100;
			}

			return new Choice { chord = chord, staticCost = cost, wrists = wrists, deltaTime = deltaTime };
		}

		FingerMap getTreeNodeFingerMap(TreeNode node)
		{
			FingerMap map = node.parent != null ? getTreeNodeFingerMap(node.parent) : new FingerMap();
			if (node.Choice >= 0)
			{
				FingerChord fc = ChoiceSequence[node.Index][node.Choice].chord;
				NoteChord nc = NoteSeq[node.Index];
				map[nc.tick] = fc;
			}

			return map;
		}

		void step()
		{
			double[] accumulatedEstimatedCosts = new double[NoteSeq.Length + 1];
			accumulatedEstimatedCosts[NoteSeq.Length] = 0;
			for (int i = NoteSeq.Length - 1; i >= 0; --i)
				accumulatedEstimatedCosts[i] = EstimatedCosts[i].Value + accumulatedEstimatedCosts[i + 1];

			TreeLeaves.StairCosts = accumulatedEstimatedCosts;

			TreeLeaves.bubbleOnce(BubbleLength);

			/*double minCost = double.MaxValue;
			int minIndex = 0;
			for(int i = 0; i < TreeLeaves.Count; ++i)
			{
				TreeNode node = TreeLeaves[i];
				double cost = node.CommittedCost + accumulatedEstimatedCosts[node.Index + 1];
				if(cost < minCost)
				{
					minCost = cost;
					minIndex = i;
				}
			}

			TreeNode currentLeave = TreeLeaves[minIndex];
			TreeLeaves.RemoveAt(minIndex);*/
			TreeNode currentLeave = TreeLeaves.Top;
			TreeLeaves.RemoveAt(0);


			currentNode = currentLeave;

			currentLeave.StepIndex = currentStep;

			// update EstimatedCosts
			for (TreeNode node = currentLeave; node.Index >= 0; node = node.parent)
				EstimatedCosts[node.Index].append(node.SelfCost);

			if (currentLeave.Index > candidateNode.Index)
				candidateNode = currentLeave;

			if (currentLeave.Index >= NoteSeq.Length - 1)
			{
				ResultNodes.Add(currentLeave);

				UnityEngine.Debug.LogFormat("Result found: [{0}]	{2}	{1}", currentLeave.StepIndex, currentLeave.ChoicePathDescription, currentLeave.CommittedCost);

				return;
			}

			//NoteChord currentNode = NoteSeq[currentLeave.Index];
			//NoteChord nextNode = NoteSeq[currentLeave.Index + 1];

			Choice[] choices = ChoiceSequence[currentLeave.Index + 1];
			for (int i = 0; i < choices.Length; ++i)
			{
				//double cost = evaluateNodeCost(currentLeave, choices[i].chord);
				TreeNode leaf = currentLeave.appendChild(choices, Config, benchmarkDuration, i);

				TreeLeaves.insert(leaf);
			}
		}

		void generateChoiceSequence()
		{
			ChoiceSequence = new Choice[NoteSeq.Length][];
			EstimatedCosts = new CostEstimation[NoteSeq.Length];

			float lastTime = 0;
			for (int i = 0; i < ChoiceSequence.Length; ++i)
			{
				ChoiceSequence[i] = getFingerChoices(NoteSeq[i], NoteSeq[i].start - lastTime);
				lastTime = NoteSeq[i].start;

				EstimatedCosts[i] = new CostEstimation();

				// initialize estimated costs with minimized static note cost
				double minCost = 1000;
				foreach (var choice in ChoiceSequence[i])
					minCost = Math.Min(minCost, choice.staticCost);

				EstimatedCosts[i].append(minCost);

#if UNITY_EDITOR
				UnityEditor.EditorUtility.DisplayProgressBar("FingeringNavigator running", string.Format("Generating Choice Sequence {0}/{1}", i, ChoiceSequence.Length), (float)i / ChoiceSequence.Length);
#endif
			}
		}

		Choice[] getFingerChoices(NoteChord nc, float deltaTime)
		{
			if(nc.notes.Count == 0)
				return new Choice[0];

			List<FingerChord> choices = new List<FingerChord>();

			int[] pitches = new int[nc.notes.Count];
			nc.notes.Keys.CopyTo(pitches, 0);

			FingerChord constrait = null;
			if (KeepConstraints)
			{
				constrait = new FingerChord();
				foreach (var pair in nc.notes)
					if (pair.Value.finger != Finger.EMPTY)
					{
						constrait[pair.Key] = pair.Value.finger;
						UnityEngine.Debug.Log("pair.Value.finger: " + pair.Value.finger.ToString());
					}
			}

			int fingerCount = HandType == SolveHandType.MIX ? 10 : 5;

			int emptyQuota = Math.Max(pitches.Length - fingerCount, 0);
			FingerChord fc = new FingerChord();
			while (choices.Count == 0)
				tryFingerChoice(pitches, ref choices, constrait, fc, 0, emptyQuota++);

			Choice[] choiceArray = new Choice[choices.Count];
			for (int i = 0; i < choices.Count; ++i)
			{
				FingerChord chord = choices[i];
				choiceArray[i] = evaluateChordChoice(chord, deltaTime);
			}

			return choiceArray;
		}

		void tryFingerChoice(int[] pitches, ref List<FingerChord> choices, FingerChord constrait, FingerChord fc, int currentNoteIndex, int emptyQuota)
		{
			if (currentNoteIndex >= pitches.Length)
			{
				choices.Add(new FingerChord(fc));

				/*Finger[] fa = new Finger[fc.Values.Count];
				fc.Values.CopyTo(fa, 0);
				UnityEngine.Debug.Log("fc: " + String.Join(",", Array.ConvertAll(fa, x => ((int)x).ToString())));*/
			}
			else
			{
				int currentPitch = pitches[currentNoteIndex];

				if (constrait != null && constrait.ContainsKey(currentPitch) && constrait[currentPitch] != Finger.EMPTY)
				{
					fc[currentPitch] = constrait[currentPitch];
					tryFingerChoice(pitches, ref choices, constrait, fc, currentNoteIndex + 1, emptyQuota);
				}
				else
				{
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
							tryFingerChoice(pitches, ref choices, constrait, fc, currentNoteIndex + 1, emptyQuota);
						}
					}

					if (emptyQuota > 0)
					{
						fc[currentPitch] = Finger.EMPTY;
						tryFingerChoice(pitches, ref choices, constrait, fc, currentNoteIndex + 1, emptyQuota - 1);
					}
				}
			}
		}

		public string getTreeJsonDump()
		{
			return TreeRoot.JsonDump;
		}
	};
}

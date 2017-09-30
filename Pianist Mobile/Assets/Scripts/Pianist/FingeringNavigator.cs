

using System;
using System.Collections.Generic;
using System.Linq;


namespace Pianist
{
	using FingerChord = SortedDictionary<int, Finger>;
	using FingerMap = SortedDictionary<int, SortedDictionary<int, Finger>>;


	class CostCoeff
	{
		public static readonly float WRIST_POSITION_NATURALITY_REWARD = 1f;

		public static readonly float WRIST_CROWD_PUNISH = 1f;

		public static readonly float MULTIPLE_FINGERS_PUNISH = 1f;

		public static readonly float OMIT_KEY_PUNISH = 100f;
		public static readonly float NOTE_CUTOFF_PUNISH = 1f;
		public static readonly float FINGER_MOVE_SPEED_PUNISH = 10f;

		public static readonly float SHIFT_FINGERS_PUNISH = 100f;

		public static readonly float BLACK_KEY_SHORT_PUNISH = 1f;

		public static readonly float WRIST_OFFSET_MIDDLE_PUNISH = 1f;
		public static readonly float WRIST_OFFSET_RANGE_PUNISH = 10f;

		//public static readonly float FINGER_DURATION_CUTOFF_PUNISH = 1f;
		//public static readonly float FINGER_MOVE_INTERVAL_REWARD = 1f;
		//public static readonly float FINGER_SOFT_MOVE_INTERVAL_REWARD = 10f;
	};


	public class FingeringNavigator
	{
		public struct FingerState
		{
			public float Press;
			public float Release;

			public int Pitch;
			public float Position;
			public int Height;
			public int Index;
		};

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

			FingerChord fingerChord;

			HandConfig.RangePair wrists;

			float startTime;
			float timeUnit;

			NoteChord note;

			FingerState[] leftFingers;
			FingerState[] rightFingers;

			double staticCost;
			double dynamicCost;

			string debug = "";


			// common context
			public static float s_BenchmarkDuration;
			public static NoteSequence s_NoteSeq;
			public static HandConfig s_HandConfig;
			public static Choice[][] s_ChoiceSequence;


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

			static string removeTailComma(string source)
			{
				if (source[source.Length - 1] == ',')
					return source.Remove(source.Length - 1, 1);

				return source;
			}

			public string JsonDumpSelf
			{
				get
				{
					string result = "";

					if (choiceIndex >= 0)
					{
						result += "\"choice\":" + FingerConstants.getFingerChordJsonDump(fingerChord) + ",";
						result += "\"cost\":" + SelfCost.ToString() + ",";
						//if (wrists.right != null)
						//	result += "\"middle\":" + wrists.right.middle.ToString() + ",";
					}

					result += "\"stepIndex\":" + StepIndex.ToString() + ",";

					result += string.Format("\"path\":\"{0}\",", ChoicePathDescription);

					if (leftFingers != null)
					{
						result += "\"leftFingers\":[";

						foreach (var finger in leftFingers)
							result += "{" + string.Format("\"press\":{0},\"release\":{1},\"position\":{2}", finger.Press, finger.Release, finger.Position) + "},";

						result = removeTailComma(result);

						result += "],";
					}

					if (rightFingers != null)
					{
						result += "\"rightFingers\":[";

						foreach (var finger in rightFingers)
							result += "{" + string.Format("\"press\":{0},\"release\":{1},\"position\":{2}", finger.Press, finger.Release, finger.Position) + "},";

						result = removeTailComma(result);

						result += "],";
					}

					if (debug != null)
						result += string.Format("\"debug\":\"{0}\",", debug);

					return result;
				}
			}

			public string JsonDump
			{
				get
				{
					string result = "{";

					result += JsonDumpSelf;

					result += "\"children\":[";

					foreach (TreeNode child in children)
						if (child.StepIndex > 0)
							result += child.JsonDump + ",";

					result = removeTailComma(result);

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

			TreeNode(TreeNode parent_, int choiceIndex_)
			{
				parent = parent_;
				choiceIndex = choiceIndex_;

				Choice choice = s_ChoiceSequence[Index][choiceIndex];

				fingerChord = choice.chord;
				staticCost = choice.staticCost;
				wrists = choice.wrists;
				note = s_NoteSeq[Index];
				startTime = note.start;
				timeUnit = choice.deltaTime / s_BenchmarkDuration;

				leftFingers = generateFingerStates(parent.leftFingers, -1, fingerChord, note, Index);
				rightFingers = generateFingerStates(parent.rightFingers, 1, fingerChord, note, Index);
			}

			void appendChild(TreeNode child)
			{
				Array.Resize(ref children, children.Length + 1);
				children[children.Length - 1] = child;
			}

			public TreeNode appendChild(int choiceIndex_)
			{
				TreeNode child = new TreeNode(this, choiceIndex_);
				appendChild(child);

				child.dynamicCost = child.evaluateDynamicCost();

				return child;
			}

			static FingerState[] generateFingerStates(FingerState[] parentStates, int hand, FingerChord chord, NoteChord nc, int index)
			{
				FingerState[] states = null;

				if (parentStates != null)
				{
					states = new FingerState[parentStates.Length];
					Array.Copy(parentStates, states, states.Length);
				}

				foreach (var pair in chord)
				{
					int finger = (int)pair.Value * hand;
					if (finger > 0)
					{
						if (states == null)
						{
							states = Enumerable.Repeat(new FingerState { Press = -10000f, Release = -10000f, Index = -1, Height = 0 }, 5).ToArray();
							for (int i = 0; i < states.Length; ++i)
								states[i].Position = (HandConfig.WristNaturePosition + i - 2) * hand;
						}

						Note note = nc.notes[pair.Key];
						UnityEngine.Debug.Assert(note != null, "note and finger chord mismatch");

						float position = Piano.KeyPositions[pair.Key];
						int height = Piano.getKeyHeight(pair.Key);

						int first = (int)Math.Floor(finger / 10f) - 1;
						int second = finger % 10 - 1;

						if (first >= 0)
						{
							states[first].Press = note.start;
							states[first].Release = note.start;
							states[first].Pitch = pair.Key;
							states[first].Position = position;
							states[first].Height = height;
							states[first].Index = index;
						}

						UnityEngine.Debug.Assert(second >= 0 && second < 5, "invalid finger value");
						{
							states[second].Press = note.start;
							states[second].Release = note.start + note.duration;
							states[second].Pitch = pair.Key;
							states[second].Position = position;
							states[second].Height = height;
							states[second].Index = index;

							//fixFingerStatesObstacle(ref states, hand, second);
						}
					}
				}

				return states;
			}

			double evaluateFingerObstacleCost(FingerState state, float minPreparation, NoteChord obsNote, float startPosition, int startHeight, int pitch)
			{
				float deltaX = startPosition - Piano.KeyPositions[pitch];
				float deltaY = startHeight - Piano.getKeyHeight(pitch);
				double distance = Math.Min(Math.Sqrt(deltaX * deltaX + deltaY * deltaY), 5) + 1;

				float prepareTime = startTime - minPreparation;

				float importance = NotationUtils.getNoteImportanceInChord(obsNote, state.Pitch);

				debug += string.Format("O{0},{1},{2},{3};", state.Pitch, prepareTime, state.Release, state.Press);

				if (prepareTime >= state.Release)
				{
					double coeff = CostCoeff.FINGER_MOVE_SPEED_PUNISH * Math.Pow(0.1, (startTime - state.Release) / minPreparation);
					return coeff * distance;
				}
				else if (prepareTime >= state.Press)
				{
					double speedCost = CostCoeff.FINGER_MOVE_SPEED_PUNISH * distance;
					double cutoffCost = CostCoeff.NOTE_CUTOFF_PUNISH * importance * (state.Release - prepareTime) / (state.Release - state.Press);

					return speedCost + cutoffCost;
				}
				else
				{
					return CostCoeff.OMIT_KEY_PUNISH * importance;
				}
			}

			double evaluateSingleArmCost(HandConfig.Range lastWrist, HandConfig.Range currentWrist, FingerState[] lastFs, FingerState[] currentFs, int hand)
			{
				double cost = 0;

				// wrist offset punish

				//		by middle
				cost += Math.Abs(currentWrist.middle - lastWrist.middle) * CostCoeff.WRIST_OFFSET_MIDDLE_PUNISH / timeUnit;

				//		by range
				if (!(lastWrist.low < currentWrist.high && lastWrist.high > currentWrist.low))
					cost += Math.Min(Math.Abs(currentWrist.low - lastWrist.high), Math.Abs(lastWrist.low - currentWrist.high)) * CostCoeff.WRIST_OFFSET_RANGE_PUNISH / timeUnit;

				// finger speed punish
				if (lastFs != null)
				{
					List<int> fingers = new List<int>();
					List<int> pitches = new List<int>();

					foreach (var pair in fingerChord)
					{
						int finger = (int)pair.Value * hand;
						if (finger > 0)
						{
							int first = (int)Math.Floor(finger / 10f) - 1;
							int second = finger % 10 - 1;

							if (first > 0)
							{
								fingers.Add(first);
								pitches.Add(pair.Key);
							}
							fingers.Add(second);
							pitches.Add(pair.Key);
						}
					}

					for (int i = 0; i < fingers.Count; ++i)
					{
						int finger = fingers[i];
						int pitch = pitches[i];
						//float position = Piano.KeyPositions[pitch];

						FingerState state = lastFs[finger];

						/*if (state.Release > note.start)
						{
							// cut off duration punish
							float duration = state.Release - state.Press;
							cost += CostCoeff.FINGER_DURATION_CUTOFF_PUNISH * ((note.start - state.Press)) / duration / (duration / s_BenchmarkDuration);
						}
						else
						{
							// soft move interval reward
							float interval = 4f * (note.start - state.Release) / s_BenchmarkDuration;
							cost += CostCoeff.FINGER_SOFT_MOVE_INTERVAL_REWARD * Math.Pow(1 / CostCoeff.FINGER_SOFT_MOVE_INTERVAL_REWARD, interval);
						}

						// move interval reward
						{
							float interval = 4f * (note.start - state.Press) / s_BenchmarkDuration;
							cost += CostCoeff.FINGER_MOVE_INTERVAL_REWARD * (1 + Math.Abs(position - state.Position)) / (interval * interval);
						}*/

						float minimumPreparationTime = s_BenchmarkDuration * 2 * HandConfig.MinimumPreparationRate;

						// self obstacle
						if(state.Index >= 0)
						{
							NoteChord obsNote = s_NoteSeq[state.Index];
							cost += evaluateFingerObstacleCost(state, minimumPreparationTime * 2, obsNote, state.Position, state.Height, pitch);
						}

						// other obstacles
						if (finger > 0)
						{
							for (int of = 1; of < 5; ++of)
							{
								// ignore self finger
								if(of == finger)
									continue;

								FingerState obsState = lastFs[of];
								if(obsState.Index >= 0)
								{
									int height = Piano.getKeyHeight(pitch);

									// allow ring finger on black cross pinky finger on white
									if (finger == 3 && of == 4 && height > obsState.Height)
										continue;

									float startPosition = obsState.Position + (finger - of) * hand;
									int startHeight = obsState.Height;

									float targetPosition = currentFs[finger].Position;

									if (state.Index >= 0)
									{
										startHeight = state.Height;

										if (finger * hand < of * hand)
											startPosition = Math.Min(startPosition, state.Position);
										else
											startPosition = Math.Max(startPosition, state.Position);
									}

									//debug += string.Format("of: {0}, {1}, {2}, {3}\\n", of, startPosition, obsState.Position, targetPosition);

									if ((targetPosition - obsState.Position) * (obsState.Position - startPosition) <= 0)
										continue;

									NoteChord obsNote = s_NoteSeq[obsState.Index];
									cost += evaluateFingerObstacleCost(obsState, minimumPreparationTime, obsNote, startPosition, startHeight, pitch);

									//debug += "O" + ((of + 1) * hand).ToString() + ","/* + (startTime - minimumPreparationTime - obsState.Release).ToString() + ";"*/;
								}
							}
						}
					}
				}

				// TODO:

				return cost;
			}

			double evaluateDynamicCost()
			{
				double cost = 0;

				if (parent != null)
				{
					if (wrists.left != null && parent.wrists.left != null)
						cost += evaluateSingleArmCost(parent.wrists.left, wrists.left, parent != null ? parent.leftFingers : null, leftFingers, -1);

					if (wrists.right != null && parent.wrists.right != null)
						cost += evaluateSingleArmCost(parent.wrists.right, wrists.right, parent != null ? parent.rightFingers : null, rightFingers, 1);
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
			var begin = DateTime.Now;

			generateChoiceSequence();

			var choiceEnd = DateTime.Now;
			UnityEngine.Debug.LogFormat("Choice generation cost: {0:F4}", choiceEnd.Subtract(begin).TotalMilliseconds / 1000f);

			TreeNode.s_BenchmarkDuration = benchmarkDuration;
			TreeNode.s_HandConfig = Config;
			TreeNode.s_ChoiceSequence = ChoiceSequence;
			TreeNode.s_NoteSeq = NoteSeq;

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

			var stepEnd = DateTime.Now;

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

			var end = DateTime.Now;
			UnityEngine.Debug.LogFormat("Total cost: {0:F2}s, per step: {1:F4}s", end.Subtract(begin).TotalMilliseconds / 1000f, (stepEnd.Subtract(choiceEnd).TotalMilliseconds / 1000f) / currentStep);

#if UNITY_EDITOR
			UnityEditor.EditorUtility.ClearProgressBar();
#endif

			return result;
		}

		Choice evaluateChordChoice(FingerChord chord, int index)
		{
			float deltaTime = index > 0 ? NoteSeq[index].start - NoteSeq[index - 1].start : 0;

			NoteChord note = NoteSeq[index];

			HandConfig.RangePair wrists = Config.getFingerChordWristRange(chord);

			double cost = 0;

			// wrist position naturality reward
			if (wrists.left != null)
			{
				float distance = Math.Abs(wrists.left.middle - -HandConfig.WristNaturePosition);
				cost = Math.Pow(distance / 14, 4) * CostCoeff.WRIST_POSITION_NATURALITY_REWARD;
			}

			if (wrists.right != null)
			{
				float distance = Math.Abs(wrists.right.middle - HandConfig.WristNaturePosition);
				cost = Math.Pow(distance / 14, 4) * CostCoeff.WRIST_POSITION_NATURALITY_REWARD;
			}

			// wrist crowd punish
			if (wrists.left != null && wrists.right != null)
			{
				float distance = Math.Max(Math.Abs(wrists.left.high - wrists.right.low), Math.Abs(wrists.right.high - wrists.left.low));
				if (distance < 5)
					cost += CostCoeff.WRIST_CROWD_PUNISH * (5f - distance) / 5f;
			}

			foreach (Finger f in chord.Values)
			{
				// shift fingers punish
				if (Math.Abs((int)f) > 10)
					cost += CostCoeff.SHIFT_FINGERS_PUNISH;
			}

			int leftFingerCount = 0;
			int rightFingerCount = 0;

			foreach (var pair in chord)
			{
				if (pair.Value != Finger.EMPTY)
				{
					// black key short punish
					if (Piano.isBlackKey(pair.Key))
					{
						int finger = Math.Abs((int)pair.Value);
						int first = (int)Math.Floor(finger / 10f) - 1;
						int second = finger % 10 - 1;

						float sh = HandConfig.BlackKeyShort[second];
						if (first >= 0)
							sh = Math.Max(HandConfig.BlackKeyShort[first], sh);

						cost += sh * CostCoeff.BLACK_KEY_SHORT_PUNISH;
					}

					if (pair.Value > Finger.EMPTY)
						++rightFingerCount;
					else if (pair.Value < Finger.EMPTY)
						++leftFingerCount;
				}
				else
				{
					// omit key punish
					float importance = NotationUtils.getNoteImportanceInChord(note, pair.Key);
					cost += CostCoeff.OMIT_KEY_PUNISH * importance;
				}
			}

			// multiple fingers punish
			if (leftFingerCount > 0)
			{
				float value = leftFingerCount / 5f;
				cost += CostCoeff.MULTIPLE_FINGERS_PUNISH * value * value;
			}
			if (rightFingerCount > 0)
			{
				float value = rightFingerCount / 5f;
				cost += CostCoeff.MULTIPLE_FINGERS_PUNISH * value * value;
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

			//NoteChord currentNote = NoteSeq[currentLeave.Index];
			NoteChord nextNote = NoteSeq[currentLeave.Index + 1];

			Choice[] choices = ChoiceSequence[currentLeave.Index + 1];
			for (int i = 0; i < choices.Length; ++i)
			{
				//double cost = evaluateNodeCost(currentLeave, choices[i].chord);
				TreeNode leaf = currentLeave.appendChild(i);

				TreeLeaves.insert(leaf);
			}
		}

		void generateChoiceSequence()
		{
			ChoiceSequence = new Choice[NoteSeq.Length][];
			EstimatedCosts = new CostEstimation[NoteSeq.Length];

			int total = 0;

			//float lastTime = 0;
			for (int i = 0; i < ChoiceSequence.Length; ++i)
			{
				ChoiceSequence[i] = getFingerChoices(NoteSeq[i], i);
				//lastTime = NoteSeq[i].start;

				EstimatedCosts[i] = new CostEstimation();

				// initialize estimated costs with minimized static note cost
				double minCost = 1000;
				foreach (var choice in ChoiceSequence[i])
					minCost = Math.Min(minCost, choice.staticCost);

				EstimatedCosts[i].append(minCost);

				total += ChoiceSequence[i].Length;

#if UNITY_EDITOR
				UnityEditor.EditorUtility.DisplayProgressBar("FingeringNavigator running", string.Format("Generating Choice Sequence {0}/{1}", i, ChoiceSequence.Length), (float)i / ChoiceSequence.Length);
#endif
			}

			UnityEngine.Debug.LogFormat("Total choices: {0}, average per step: {1}", total, total / ChoiceSequence.Length);
		}

		Choice[] getFingerChoices(NoteChord nc, int index)
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
				choiceArray[i] = evaluateChordChoice(chord, index);
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

		public TreeNode getTreeNodeByPath(string path)
		{
			if (TreeRoot == null)
				return null;

			int[] indices = Array.ConvertAll(path.Split('-'), x => int.Parse(x));

			TreeNode node = TreeRoot;
			for (int i = 0; i < indices.Length; ++i)
			{
				if (node.children.Length <= i)
					return null;

				node = node.children[indices[i]];
			}

			return node;
		}
	};
}

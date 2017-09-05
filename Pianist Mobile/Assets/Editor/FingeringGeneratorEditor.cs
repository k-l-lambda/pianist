
using UnityEngine;
using UnityEditor;


[CustomEditor(typeof(FingeringGenerator))]
public class FingeringGeneratorEditor : Editor
{
	string TargetName;


	public override void OnInspectorGUI()
	{
		FingeringGenerator t = target as FingeringGenerator;

		{
			EditorGUI.BeginChangeCheck();

			t.SourceAsset = EditorGUILayout.ObjectField("Source MIDI", t.SourceAsset, typeof(TextAsset), false) as TextAsset;

			if (EditorGUI.EndChangeCheck())
			{
				TargetName = string.Format("fingering {0}", t.SourceAsset.name);

				t.load();
			}
		}

		if (GUILayout.Button("Load"))
		{
			t.load();
		}

		EditorGUILayout.Space();

		if (t.MidiSeq != null)
		{
			EditorGUILayout.LabelField(string.Format("Format: {0}", t.MidiSeq.Format));
			EditorGUILayout.LabelField(string.Format("Tracks: {0}", t.MidiSeq.Count));
			EditorGUILayout.LabelField(string.Format("Division: {0}", t.MidiSeq.Division));
		}

		EditorGUILayout.Space();

		// Hands
		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("Hands"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		// TrackHandIndices
		{
			EditorGUILayout.LabelField("TrackHandIndices");

			EditorGUI.indentLevel++;

			for (int i = 0; i < t.TrackHandIndices.Length; ++i)
			{
				t.TrackHandIndices[i] = EditorGUILayout.IntField("Track " + i.ToString(), t.TrackHandIndices[i]);
			}

			EditorGUI.indentLevel--;
		}

		EditorGUILayout.Space();

		TargetName = EditorGUILayout.TextField("Target File Name", TargetName);
		if (TargetName == "" && t.SourceAsset)
			TargetName = string.Format("fingering {0}", t.SourceAsset.name);

		if (GUILayout.Button("Generate"))
		{
			t.generate(string.Format("{0}/Editor/Resources/MIDI/Fingerings/{1}", Application.dataPath, TargetName));
		}
	}
}

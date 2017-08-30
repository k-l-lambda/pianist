
using UnityEngine;
using UnityEditor;


[CustomEditor(typeof(FingeringGenerator))]
public class FingeringGeneratorEditor : Editor
{
	public override void OnInspectorGUI()
	{
		FingeringGenerator t = target as FingeringGenerator;

		{
			EditorGUI.BeginChangeCheck();

			t.SourceAsset = EditorGUILayout.ObjectField("Source MIDI", t.SourceAsset, typeof(TextAsset), false) as TextAsset;

			if (EditorGUI.EndChangeCheck())
			{
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
	}
}

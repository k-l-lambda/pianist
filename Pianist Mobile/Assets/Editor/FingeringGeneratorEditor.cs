
using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(FingeringGenerator))]
public class FingeringGeneratorEditor : Editor
{
	public override void OnInspectorGUI()
	{
		FingeringGenerator t = target as FingeringGenerator;

		t.SourceAsset = EditorGUILayout.ObjectField("Source MIDI", t.SourceAsset, typeof(TextAsset), false) as TextAsset;
	}
}

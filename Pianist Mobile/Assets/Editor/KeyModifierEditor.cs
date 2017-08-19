
using UnityEngine;
using UnityEditor;
using System.Collections.Generic;


[CustomEditor(typeof(KeyModifier))]
public class KeyModifierEditor : Editor
{
	public override void OnInspectorGUI()
	{
		KeyModifier t = target as KeyModifier;

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionOutXIndex"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionInnerXIndex"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		{
			EditorGUI.BeginChangeCheck();

			string line = string.Join(",", new List<int>(t.HollowIndices).ConvertAll(ii => ii.ToString()).ToArray());
			line = EditorGUILayout.TextField("Hollow Indices", line);

			if (EditorGUI.EndChangeCheck())
			{
				Undo.RecordObject(target, "Changed Hollow Indices");

				try
				{
					t.HollowIndices = System.Array.ConvertAll<string, int>(line.Split(','), int.Parse);
				}
				catch(System.FormatException)
				{
				}
			}
		}

		{
			EditorGUI.BeginChangeCheck();

			string line = string.Join(",", new List<int>(t.TailIndices).ConvertAll(ii => ii.ToString()).ToArray());
			line = EditorGUILayout.TextField("Tail Indices", line);

			if (EditorGUI.EndChangeCheck())
			{
				Undo.RecordObject(target, "Changed Tail Indices");

				try
				{
					t.TailIndices = System.Array.ConvertAll<string, int>(line.Split(','), int.Parse);
				}
				catch (System.FormatException)
				{
				}
			}
		}
	}
}

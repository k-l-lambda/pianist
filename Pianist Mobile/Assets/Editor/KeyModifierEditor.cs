
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

			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionLeftOutXIndex"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionRightOutXIndex"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionLeftInnerXIndex"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionRightInnerXIndex"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionTailLeftIndex"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("CriterionTailRightIndex"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		{
			EditorGUI.BeginChangeCheck();

			string line = string.Join(",", new List<int>(t.LeftHollowIndices).ConvertAll(ii => ii.ToString()).ToArray());
			line = EditorGUILayout.TextField("Left Hollow Indices", line);

			if (EditorGUI.EndChangeCheck())
			{
				Undo.RecordObject(target, "Changed Left Hollow Indices");

				try
				{
					t.LeftHollowIndices = System.Array.ConvertAll<string, int>(line.Split(','), int.Parse);
				}
				catch(System.FormatException)
				{
				}
			}
		}

		{
			EditorGUI.BeginChangeCheck();

			string line = string.Join(",", new List<int>(t.RightHollowIndices).ConvertAll(ii => ii.ToString()).ToArray());
			line = EditorGUILayout.TextField("Right Hollow Indices", line);

			if (EditorGUI.EndChangeCheck())
			{
				Undo.RecordObject(target, "Changed Right Hollow Indices");

				try
				{
					t.RightHollowIndices = System.Array.ConvertAll<string, int>(line.Split(','), int.Parse);
				}
				catch (System.FormatException)
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

		EditorGUILayout.Space();

		{
			if (t.CriterionLeftInnerXIndex >= 0)
			{
				EditorGUI.BeginChangeCheck();

				float x = EditorGUILayout.FloatField("Left Hollow X", t.LeftHollowX);

				if (EditorGUI.EndChangeCheck())
				{
					Undo.RecordObject(target, "Changed Left Hollow X");

					t.LeftHollowX = x;
				}
			}

			if (t.CriterionRightInnerXIndex >= 0)
			{
				EditorGUI.BeginChangeCheck();

				float x = EditorGUILayout.FloatField("Right Hollow X", t.RightHollowX);

				if (EditorGUI.EndChangeCheck())
				{
					Undo.RecordObject(target, "Changed Right Hollow X");

					t.RightHollowX = x;
				}
			}

			if (GUILayout.Button("Mirror"))
			{
				Undo.RecordObject(target, "Mirror");

				t.mirrorX();
				SceneView.RepaintAll();
			}
		}
	}
}

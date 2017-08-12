
using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
	private string name;

	public override void OnInspectorGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("Name"), true);
			EditorGUILayout.PropertyField(serializedObject.FindProperty("AssetFolder"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		t.PointerCount = EditorGUILayout.IntField("Pointers Count", t.PointerCount);

		for (int i = 0; i < t.PointerCount; ++i)
		{
			Transform trans = t.getPointerAt(i);
			trans.localPosition = EditorGUILayout.Vector3Field(i.ToString(), trans.localPosition);
		}

		if (GUILayout.Button("Export Mesh"))
		{
			UnityEditor.AssetDatabase.CreateAsset(t.ResultMesh, t.AssetFolder + t.Name + ".prefab");
			UnityEditor.AssetDatabase.SaveAssets();
		}
	}
}


using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
	bool showVertecies = true;
	bool showNormals = true;
	//bool showIndices = true;

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

		showVertecies = EditorGUILayout.Foldout(showVertecies, "Vertecies");
		if (showVertecies)
		{
			EditorGUI.indentLevel++;
			for (int i = 0; i < t.PointerCount; ++i)
			{
				Transform trans = t.getPointerAt(i);
				trans.localPosition = EditorGUILayout.Vector3Field(i.ToString(), trans.localPosition);
			}
			EditorGUI.indentLevel--;
		}

		bool showNormals_ = EditorGUILayout.Toggle("Show Normals", showNormals);
		if (showNormals_ != showNormals)
		{
			SceneView.RepaintAll();
			showNormals = showNormals_;
		}
		//showNormals = GUILayout.Toggle(showNormals, "Show Normals");

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("Faces"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		if (GUILayout.Button("Export Mesh"))
		{
			UnityEditor.AssetDatabase.CreateAsset(t.ResultMesh, t.AssetFolder + t.Name + ".prefab");
			UnityEditor.AssetDatabase.SaveAssets();
		}
	}

	public void OnSceneGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		drawPointerGizmos(t, GizmoType.Selected, showNormals);
	}

	[DrawGizmo(GizmoType.NonSelected)]
	static void DrawGizmos(MeshBuilder mb, GizmoType gizmoType)
	{
		drawPointerGizmos(mb, gizmoType, false);
	}

	static void drawPointerGizmos(MeshBuilder mb, GizmoType gizmoType, bool withNormals)
	{
		Color color = gizmoType == GizmoType.Selected ? new Color(0.3f, 1, 0.3f) : new Color(0.7f, 0.7f, 0.7f);

		GUIStyle style = new GUIStyle();
		style.normal.textColor = color;

		float dotScale = gizmoType == GizmoType.Selected ? 0.02f : 0.01f;

		for (int i = 0; i < mb.PointerCount; ++i)
		{
			Transform trans = mb.getPointerAt(i);
			Handles.Label(trans.position, i.ToString(), style);

			Handles.color = color;
			Handles.DotHandleCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale, EventType.Repaint);

			if (withNormals)
			{
				Handles.color = Color.blue;
				Handles.ArrowHandleCap(0, trans.position, trans.rotation, 0.4f, EventType.Repaint);
			}
		}
	}
}

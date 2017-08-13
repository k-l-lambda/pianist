
using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
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

	public void OnSceneGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		drawPointerLabels(t, GizmoType.Selected);
	}

	[DrawGizmo(GizmoType.NonSelected)]
	static void DrawGizmos(MeshBuilder mb, GizmoType gizmoType)
	{
		drawPointerLabels(mb, gizmoType);
	}

	static void drawPointerLabels(MeshBuilder mb, GizmoType gizmoType)
	{
		Color color = gizmoType == GizmoType.Selected ? new Color(0.3f, 1, 0.3f) : new Color(0.7f, 0.7f, 0.7f);

		GUIStyle style = new GUIStyle();
		style.normal.textColor = color;
		Handles.color = color;

		float dotScale = gizmoType == GizmoType.Selected ? 0.02f : 0.01f;

		for (int i = 0; i < mb.PointerCount; ++i)
		{
			Transform trans = mb.getPointerAt(i);
			Handles.Label(trans.position, i.ToString(), style);

			Handles.DotHandleCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale, EventType.Repaint);
		}
	}
}


using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
	bool showVertecies = true;
	bool showNormals = true;
	bool showMesh = true;

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

		bool showMesh_ = EditorGUILayout.Toggle("Show Mesh", showMesh);
		if (showMesh_ != showMesh)
		{
			SceneView.RepaintAll();
			showMesh = showMesh_;
		}

		if (GUILayout.Button("Export Mesh"))
		{
			string path = t.AssetFolder + t.Name + ".prefab";
			UnityEditor.AssetDatabase.CreateAsset(t.ResultMesh, path);
			UnityEditor.AssetDatabase.SaveAssets();

			Debug.Log("Mesh export completed: " + path);
		}
	}

	public void OnSceneGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		drawPointerGizmos(t, GizmoType.Selected, showNormals);

		if (showMesh)
			drawMeshGizmo(t);
	}

	[DrawGizmo(GizmoType.NonSelected)]
	static void DrawGizmos(MeshBuilder mb, GizmoType gizmoType)
	{
		drawPointerGizmos(mb, gizmoType, true);
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
#if UNITY_2017
			Handles.DotHandleCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale, EventType.Repaint);
#else
			Handles.DotCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale);
#endif

			if (withNormals)
			{
				Handles.color = gizmoType == GizmoType.Selected ? Color.blue : new Color(0.4f, 0.4f, 0.4f);
#if UNITY_2017
				Handles.ArrowHandleCap(0, trans.position, trans.rotation, 0.4f, EventType.Repaint);
#else
				Handles.ArrowCap(0, trans.position, trans.rotation, 0.4f);
#endif
			}
		}
	}

	static void drawMeshGizmo(MeshBuilder mb)
	{
		Graphics.DrawMeshNow(mb.ResultMesh, mb.transform.position, mb.transform.rotation);
	}
}


using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
	bool showVertecies = true;
	bool showNormals = true;
	bool showNormalGizmos = true;
	bool showMesh = true;

	float[] normalScales = new float[0];

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

		if (t.PointerCount != normalScales.Length)
		{
			int start = normalScales.Length;
			System.Array.Resize(ref normalScales, t.PointerCount);

			for (int i = start; i < t.PointerCount; ++i)
				normalScales[i] = 1;
		}

		showNormals = EditorGUILayout.Foldout(showVertecies, "Normals");
		if (showNormals)
		{
			EditorGUI.indentLevel++;
			for (int i = 0; i < t.PointerCount; ++i)
			{
				Transform trans = t.getPointerAt(i);
				Vector3 tf = EditorGUILayout.Vector3Field(i.ToString(), trans.TransformVector(Vector3.forward) * normalScales[i]);
				normalScales[i] = tf.magnitude;
				tf.Normalize();

				Vector3 cross = Vector3.Cross(Vector3.forward, tf);
				float dot = Vector3.Dot(Vector3.forward, tf);
				trans.rotation = new Quaternion(cross.x, cross.y, cross.z, 1 + dot);
			}
			EditorGUI.indentLevel--;
		}

		bool showNormalGizmos_ = EditorGUILayout.Toggle("Show Normals", showNormalGizmos);
		if (showNormalGizmos_ != showNormalGizmos)
		{
			SceneView.RepaintAll();
			showNormalGizmos = showNormalGizmos_;
		}
		//showNormalGizmos = GUILayout.Toggle(showNormalGizmos, "Show Normals");

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

		if (showMesh)
		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("PreviewMaterial"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
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

		drawPointerGizmos(t, GizmoType.Selected, showNormalGizmos);

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
		Color dotColor = gizmoType == GizmoType.Selected ? new Color(0.3f, 1, 0.3f) : new Color(0.3f, 1, 0.3f, 0.4f);

		GUIStyle style = new GUIStyle();
		style.normal.textColor = gizmoType == GizmoType.Selected ? Color.white : new Color(1, 1, 1, 0.4f);

		float dotScale = gizmoType == GizmoType.Selected ? 0.02f : 0.01f;

		for (int i = 0; i < mb.PointerCount; ++i)
		{
			Transform trans = mb.getPointerAt(i);
			Handles.Label(trans.position, i.ToString(), style);

			Handles.color = dotColor;
#if UNITY_2017
			Handles.DotHandleCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale, EventType.Repaint);
#else
			Handles.DotCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale);
#endif

			if (withNormals)
			{
				Handles.color = gizmoType == GizmoType.Selected ? new Color(1, 0.6f, 0) : new Color(1, 0.6f, 0, 0.4f);
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
		if (mb.PreviewMaterial)
			mb.PreviewMaterial.SetPass(0);

		Graphics.DrawMeshNow(mb.ResultMesh, mb.transform.position, mb.transform.rotation);
	}
}

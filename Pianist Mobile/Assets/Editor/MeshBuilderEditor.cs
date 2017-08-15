
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

	Mesh meshToImport;

	public override void OnInspectorGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("Name"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		EditorGUILayout.Space();

		t.PointerCount = EditorGUILayout.IntField("Pointers Count", t.PointerCount);

		showVertecies = EditorGUILayout.Foldout(showVertecies, "Vertecies");
		if (showVertecies)
		{
			EditorGUI.indentLevel++;
			for (int i = 0; i < t.PointerCount; ++i)
			{
				Transform trans = t.getPointerAt(i);

				EditorGUI.BeginChangeCheck();
				Vector3 np = EditorGUILayout.Vector3Field(i.ToString(), trans.localPosition);
				if (EditorGUI.EndChangeCheck())
				{
					Undo.RecordObject(t.getPointerAt(i), "Changed Vertex Position");
					trans.localPosition = np;
				}
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

		showNormals = EditorGUILayout.Foldout(showNormals, "Normals");
		if (showNormals)
		{
			EditorGUI.indentLevel++;
			for (int i = 0; i < t.PointerCount; ++i)
			{
				Transform trans = t.getPointerAt(i);

				EditorGUI.BeginChangeCheck();
				Vector3 tf = EditorGUILayout.Vector3Field(i.ToString(), trans.TransformVector(Vector3.forward) * normalScales[i]);
				if (EditorGUI.EndChangeCheck())
				{
					Undo.RecordObject(t.getPointerAt(i), "Changed Vertex Normal");

					normalScales[i] = tf.magnitude;
					tf.Normalize();

					if (tf == -Vector3.forward)
					{
						trans.rotation = new Quaternion(1, 0, 0, 0);
					}
					else
					{
						Vector3 cross = Vector3.Cross(Vector3.forward, tf);
						float dot = Vector3.Dot(Vector3.forward, tf);
						trans.rotation = new Quaternion(cross.x, cross.y, cross.z, 1 + dot);
						//trans.rotation.SetFromToRotation(Vector3.forward, tf);
					}
				}
			}
			EditorGUI.indentLevel--;
		}

		EditorGUILayout.Space();

		bool showNormalGizmos_ = EditorGUILayout.Toggle("Show Normals", showNormalGizmos);
		if (showNormalGizmos_ != showNormalGizmos)
		{
			SceneView.RepaintAll();
			showNormalGizmos = showNormalGizmos_;
		}
		//showNormalGizmos = GUILayout.Toggle(showNormalGizmos, "Show Normals");

		EditorGUILayout.Space();

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("Faces"), true);

			if (EditorGUI.EndChangeCheck())
			{
				serializedObject.ApplyModifiedProperties();
				Undo.RecordObject(target, "Changed Face");
			}
		}

		EditorGUILayout.Space();

		bool showMesh_ = EditorGUILayout.Toggle("Preview Mesh", showMesh);
		if (showMesh_ != showMesh)
		{
			SceneView.RepaintAll();
			showMesh = showMesh_;
		}

		/*if (showMesh)
		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("PreviewMaterial"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}*/

		EditorGUILayout.Space();

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("AssetFolder"), true);

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

		EditorGUILayout.Space();

		GUILayout.BeginHorizontal();

		meshToImport = EditorGUILayout.ObjectField(meshToImport, typeof(Mesh)) as Mesh;

		if (GUILayout.Button("Import Mesh"))
		{
			t.importMesh(meshToImport);
			Debug.Log("Mesh import completed.");
		}

		GUILayout.EndHorizontal();

		//if (GUI.changed)
		//	Undo.RecordObject(t, "modified by inspector");
	}

	public void OnSceneGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		drawPointerGizmos(t, GizmoType.Selected, showNormalGizmos);

		if (showMesh)
		{
			drawMeshGizmo(t, GizmoType.Selected);
			EditorUtility.SetDirty(target);
		}
	}

	[DrawGizmo(GizmoType.NonSelected)]
	static void DrawGizmos(MeshBuilder mb, GizmoType gizmoType)
	{
		drawPointerGizmos(mb, gizmoType, true);
		drawMeshGizmo(mb, gizmoType);
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

	static void drawMeshGizmo(MeshBuilder mb, GizmoType gizmoType)
	{
		if (mb.PreviewMaterial)
		{
			mb.PreviewMaterial.SetColor("_Color", new Color(0.7f, 0.7f, 0.7f, gizmoType == GizmoType.Selected ? 0.8f : 0.2f));
		}

		if (gizmoType == GizmoType.Selected)
		{
			//MaterialPropertyBlock block = new MaterialPropertyBlock();
			//block.SetColor("_Color", new Color(0.7f, 0.7f, 0.7f, gizmoType == GizmoType.Selected ? 0.6f : 0.1f));

			for (int i = 0; i < mb.Faces.Length; ++i)
				Graphics.DrawMesh(mb.ResultMesh, mb.transform.localToWorldMatrix, mb.PreviewMaterial, 0, null, i);
		}
		else
		{
			if (mb.PreviewMaterial)
				mb.PreviewMaterial.SetPass(0);

			Graphics.DrawMeshNow(mb.ResultMesh, mb.transform.localToWorldMatrix);
		}

	}
}

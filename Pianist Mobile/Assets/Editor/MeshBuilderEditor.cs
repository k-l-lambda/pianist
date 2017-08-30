
using UnityEngine;
using UnityEditor;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
	bool showVertecies = true;
	bool showNormals = true;
	static bool showNormalGizmos = true;
	bool showMesh = true;

	float[] normalScales = new float[0];

	Mesh meshToImport;

	Color meshPreviewColor = new Color(0.7f, 0.7f, 0.7f, 0.8f);

	static float normalGizmoLengh = 0.4f;


	static float snapToNumber(float input, float snap)
	{
		if (Mathf.Abs(input - snap) < 1e-6f)
			return snap;

		return input;
	}

	static float snapToInteger(float input)
	{
		float x= snapToNumber(input, 0);
		x = snapToNumber(x, -1);
		x = snapToNumber(x, 1);
		x = snapToNumber(x, 0.5f);
		x = snapToNumber(x, -0.5f);
		x = snapToNumber(x, 2);
		x = snapToNumber(x, -2);

		return x;
	}

	static Vector3 snapToInteger(Vector3 input)
	{
		return new Vector3(snapToInteger(input.x), snapToInteger(input.y), snapToInteger(input.z));
	}


	public override void OnInspectorGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		if (t.Name == "")
			t.Name = t.gameObject.name;

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("Name"), true);

			if (EditorGUI.EndChangeCheck())
				serializedObject.ApplyModifiedProperties();
		}

		EditorGUILayout.Space();

		{
			EditorGUI.BeginChangeCheck();

			EditorGUILayout.PropertyField(serializedObject.FindProperty("AssetFolder"), true);

			if (EditorGUI.EndChangeCheck())
			{
				serializedObject.ApplyModifiedProperties();

				string tail = t.AssetFolder.Substring(t.AssetFolder.Length - 1);
				if (tail != "/")
					t.AssetFolder += "/";
			}
		}

		if (GUILayout.Button("Export Mesh"))
		{
			string path = t.AssetFolder + t.Name + ".prefab";

			Mesh resultMesh = t.ResultMesh;

			Mesh oldMesh = AssetDatabase.LoadAssetAtPath(path, typeof(Mesh)) as Mesh;

			if (oldMesh)
				EditorUtility.CopySerialized(resultMesh, oldMesh);
			else
				UnityEditor.AssetDatabase.CreateAsset(resultMesh, path);

			UnityEditor.AssetDatabase.SaveAssets();

			Debug.Log("Mesh export completed: " + path);
		}

		EditorGUILayout.Space();

		GUILayout.BeginHorizontal();

		meshToImport = EditorGUILayout.ObjectField(meshToImport, typeof(Mesh), false) as Mesh;

		if (GUILayout.Button("Import Mesh"))
		{
			t.importMesh(meshToImport);
			Debug.Log("Mesh import completed.");
		}

		GUILayout.EndHorizontal();

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
				Vector3 tf = EditorGUILayout.Vector3Field(i.ToString(), snapToInteger(trans.TransformVector(Vector3.forward) * normalScales[i]));
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

		if (GUILayout.Button("Inverse Faces"))
		{
			Undo.RecordObject(target, "Inverse Faces");
			t.inverseFaces();
			SceneView.RepaintAll();
		}

		EditorGUILayout.Space();

		bool showMesh_ = EditorGUILayout.Toggle("Preview Mesh", showMesh);
		if (showMesh_ != showMesh)
		{
			SceneView.RepaintAll();
			showMesh = showMesh_;
		}

		if (!t.PreviewMaterialHighlight || !t.PreviewMaterialDim)
		{
			Material previwMat = UnityEditor.EditorGUIUtility.Load("Assets/Editor/Resources/MeshPreview.mat") as Material;
			if (previwMat)
			{
				t.PreviewMaterialHighlight = new Material(previwMat);
				t.PreviewMaterialHighlight.SetColor("_Color", new Color(0.7f, 0.7f, 0.7f, 0.8f));

				t.PreviewMaterialDim = new Material(previwMat);
				t.PreviewMaterialDim.SetColor("_Color", new Color(0.7f, 0.7f, 0.7f, 0.2f));
			}
			else
				Debug.LogWarning("Mesh preview material is missing.");
		}

		if (showMesh)
		{
			EditorGUI.BeginChangeCheck();
			EditorGUI.indentLevel++;

			meshPreviewColor = EditorGUILayout.ColorField("Mesh Color", t.PreviewMaterialHighlight.GetColor("_Color"));

			EditorGUI.indentLevel--;
			if (EditorGUI.EndChangeCheck())
			{
				t.PreviewMaterialHighlight.SetColor("_Color", meshPreviewColor);

				meshPreviewColor.a *= 0.25f;
				t.PreviewMaterialDim.SetColor("_Color", meshPreviewColor);

				serializedObject.ApplyModifiedProperties();
				Undo.RecordObject(target, "Changed Face");
			}
		}

		EditorGUILayout.Space();

		bool showNormalGizmos_ = EditorGUILayout.Toggle("Show Normals", showNormalGizmos);
		if (showNormalGizmos_ != showNormalGizmos)
		{
			SceneView.RepaintAll();
			showNormalGizmos = showNormalGizmos_;
		}
		//showNormalGizmos = GUILayout.Toggle(showNormalGizmos, "Show Normals");

		if (showNormalGizmos)
		{
			EditorGUI.BeginChangeCheck();
			EditorGUI.indentLevel++;

			normalGizmoLengh = EditorGUILayout.FloatField("Normal Length", normalGizmoLengh);

			EditorGUI.indentLevel--;
			if (EditorGUI.EndChangeCheck())
			{
				SceneView.RepaintAll();
			}
		}

		//if (GUI.changed)
		//	Undo.RecordObject(t, "modified by inspector");
	}

	public void OnSceneGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		drawPointerGizmos(t, GizmoType.Selected, true);

		if (showMesh)
		{
			drawMeshGizmo(t, GizmoType.Selected);
			EditorUtility.SetDirty(target);
		}
	}

	[DrawGizmo(GizmoType.NonSelected)]
	static void DrawGizmos(MeshBuilder mb, GizmoType gizmoType)
	{
		drawPointerGizmos(mb, gizmoType, false);
		drawMeshGizmo(mb, gizmoType);
	}

	static void drawPointerGizmos(MeshBuilder mb, GizmoType gizmoType, bool withNormals)
	{
		for (int i = 0; i < mb.PointerCount; ++i)
		{
			Transform trans = mb.getPointerAt(i);
			bool chosen = System.Array.IndexOf(Selection.objects, trans.gameObject) >= 0;
			bool highlight = gizmoType == GizmoType.Selected || chosen;

			GUIStyle style = new GUIStyle();
			style.normal.textColor = highlight ? Color.white : new Color(1, 1, 1, 0.3f);
			style.fontSize = chosen ? 14 : 10;
			style.fontStyle = chosen ? FontStyle.Bold : FontStyle.Normal;

			Handles.Label(trans.position, i.ToString(), style);

			float dotScale = highlight ? 0.02f : 0.01f;

			Handles.color = highlight ? new Color(0.3f, 1, 0.3f) : new Color(0.3f, 1, 0.3f, 0.4f);
#if UNITY_2017
			Handles.DotHandleCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale, EventType.Repaint);
#else
			Handles.DotCap(0, trans.position, trans.rotation, HandleUtility.GetHandleSize(trans.position) * dotScale);
#endif

			if (showNormalGizmos && (withNormals || chosen))
			{
				Handles.color = highlight ? new Color(1, 0.6f, 0) : new Color(1, 0.6f, 0, 0.4f);
#if UNITY_2017
				Handles.ArrowHandleCap(0, trans.position, trans.rotation, normalGizmoLengh, EventType.Repaint);
#else
				Handles.ArrowCap(0, trans.position, trans.rotation, normalGizmoLengh);
#endif
			}
		}
	}

	static void drawMeshGizmo(MeshBuilder mb, GizmoType gizmoType)
	{
		Material mat = gizmoType == GizmoType.Selected ? mb.PreviewMaterialHighlight : mb.PreviewMaterialDim;

		if (gizmoType == GizmoType.Selected)
		{
			for (int i = 0; i < mb.Faces.Length; ++i)
				Graphics.DrawMesh(mb.ResultMesh, mb.transform.localToWorldMatrix, mat, 0, null, i);
		}
		else
		{
			if (mat)
				mat.SetPass(0);

			Graphics.DrawMeshNow(mb.ResultMesh, mb.transform.localToWorldMatrix);
		}

	}
}

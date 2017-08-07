
using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(HandRig))]
public class HandRigEditor : Editor
{
	public override void OnInspectorGUI()
	{
		DrawDefaultInspector();

		HandRig t = target as HandRig;

		if (GUILayout.Button("Capture Data"))
		{
			t.captureData();
		}

		if (GUILayout.Button("Apply Data"))
		{
			t.applyData();
		}
	}
}

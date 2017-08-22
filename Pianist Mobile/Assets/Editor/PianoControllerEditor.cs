
using UnityEngine;
using UnityEditor;


[CustomEditor(typeof(PianoController))]
public class PianoControllerEditor : Editor
{
	public override void OnInspectorGUI()
	{
		PianoController t = target as PianoController;

		for (int index = 21; index <= 108; ++index)
		{
			float angle = t.getKeyPosition(index);
			angle = EditorGUILayout.Slider(index.ToString(), angle, 0, 1);
			angle = Mathf.Max(Mathf.Min(angle, 1), 0);
			t.setKeyPosition(index, angle);
		}
	}
}

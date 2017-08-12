
using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(MeshBuilder))]
public class MeshBuilderEditor : Editor
{
	public override void OnInspectorGUI()
	{
		MeshBuilder t = target as MeshBuilder;

		t.PointerCount = EditorGUILayout.IntField("Pointers Count", t.PointerCount);

		for (int i = 0; i < t.PointerCount; ++i)
		{
			Transform trans = t.getPointerAt(i);
			trans.localPosition = EditorGUILayout.Vector3Field(i.ToString(), trans.localPosition);
		}
	}
}


/*[CustomPropertyDrawer(typeof(MeshBuilder.Pointer))]
public class PointerDrawer : PropertyDrawer
{
	public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
	{
		MeshBuilder.Pointer data = fieldInfo.GetValue(property.serializedObject.targetObject) as MeshBuilder.Pointer;

		EditorGUI.BeginProperty(position, label, property);

		if(data == null)
			data = new MeshBuilder.Pointer();
		data.position = EditorGUI.Vector3Field(position, "", data.position);

		EditorGUI.EndProperty();
	}
}*/

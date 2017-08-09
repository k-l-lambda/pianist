
using UnityEngine;
using UnityEditor;

using Pianist;


/*[CustomPropertyDrawer(typeof(NamedArrayAttribute))]
public class NamedArrayDrawer : PropertyDrawer
{
	public override void OnGUI(Rect rect, SerializedProperty property, GUIContent label)
	{
		try
		{
			int pos = int.Parse(property.propertyPath.Split('[', ']')[1]);
			NamedArrayAttribute na = attribute as NamedArrayAttribute;

			if(na.type == typeof(float))
				EditorGUI.FloatField(rect, property, new GUIContent(na.names[pos]));
			else if(na.type == typeof(float))
				EditorGUI.Vector3Field(rect, property, new GUIContent(na.names[pos]));
		}
		catch
		{
			EditorGUI.ObjectField(rect, property, label);
		}
	}
}*/


[CustomPropertyDrawer(typeof(HandRigData))]
public class HandRigDrawer : PropertyDrawer {
	bool showPositions = true;
	bool showOrientations = true;
	bool showRanges = true;

	static readonly float LINE_HEIGHT = 18;

	public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
	{
		//HandRigData data = attribute as HandRigData;
		HandRigData data = fieldInfo.GetValue(property.serializedObject.targetObject) as HandRigData;

		EditorGUI.BeginProperty(position, label, property);

		float y = position.y;

		showPositions = EditorGUI.Foldout(new Rect(position.x, y, position.width, LINE_HEIGHT), showPositions, "Positions:");
		y += LINE_HEIGHT;

		if (showPositions)
		{
			EditorGUI.indentLevel++;

			for (int i = 0; i < HandBoneIndices.Positions.Length; ++i)
			{
				HandBoneIndex index = HandBoneIndices.Positions[i];

				data.Positions[i] = EditorGUI.Vector3Field(new Rect(position.x, y, position.width, LINE_HEIGHT), index.ToString().ToLower(), data.Positions[i]);
				y += LINE_HEIGHT;
			}

			EditorGUI.indentLevel--;
		}

		showOrientations = EditorGUI.Foldout(new Rect(position.x, y, position.width, LINE_HEIGHT), showOrientations, "Orientations:");
		y += LINE_HEIGHT;

		if (showOrientations)
		{
			EditorGUI.indentLevel++;

			for (int i = 0; i < HandBoneIndices.Orientations.Length; ++i)
			{
				HandBoneIndex index = HandBoneIndices.Orientations[i];

				data.Orientations[i] = EditorGUI.FloatField(new Rect(position.x, y, position.width, LINE_HEIGHT), index.ToString().ToLower(), data.Orientations[i]);
				y += LINE_HEIGHT;
			}

			EditorGUI.indentLevel--;
		}

		showRanges = EditorGUI.Foldout(new Rect(position.x, y, position.width, LINE_HEIGHT), showRanges, "Ranges:");
		y += LINE_HEIGHT;

		if (showRanges)
		{
			EditorGUI.indentLevel++;

			for (int i = 0; i < HandBoneIndices.Ranges.Length; ++i)
			{
				HandBoneIndex index = HandBoneIndices.Ranges[i];

				EditorGUI.LabelField(new Rect(position.x, y, position.width * 0.3f, LINE_HEIGHT), index.ToString().ToLower());

				data.Ranges[i].low = EditorGUI.FloatField(new Rect(position.x + position.width * 0.3f, y, position.width * 0.35f, LINE_HEIGHT), "", data.Ranges[i].low);
				data.Ranges[i].high = EditorGUI.FloatField(new Rect(position.x + position.width * 0.65f, y, position.width * 0.35f, LINE_HEIGHT), "", data.Ranges[i].high);
				y += LINE_HEIGHT;
			}

			EditorGUI.indentLevel--;
		}

		//Debug.Log("position: " + position.ToString());

		EditorGUI.EndProperty();
	}

	public override float GetPropertyHeight(SerializedProperty property, GUIContent label)
	{
		return (3 + (showPositions ? HandBoneIndices.Positions.Length : 0) + (showOrientations ? HandBoneIndices.Orientations.Length : 0) + (showRanges ? HandBoneIndices.Ranges.Length : 0)) * LINE_HEIGHT;
	}
}

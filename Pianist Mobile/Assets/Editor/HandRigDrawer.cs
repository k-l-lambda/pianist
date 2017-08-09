
using UnityEngine;
using UnityEditor;

using Pianist;


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

		showOrientations = EditorGUI.Foldout(new Rect(position.x, y, position.width, LINE_HEIGHT), showOrientations, "FixedAngles:");
		y += LINE_HEIGHT;

		if (showOrientations)
		{
			EditorGUI.indentLevel++;

			for (int i = 0; i < HandBoneIndices.FixedAngles.Length; ++i)
			{
				HandBoneIndex index = HandBoneIndices.FixedAngles[i];

				data.FixedAngles[i] = EditorGUI.FloatField(new Rect(position.x, y, position.width, LINE_HEIGHT), index.ToString().ToLower(), data.FixedAngles[i]);
				y += LINE_HEIGHT;
			}

			EditorGUI.indentLevel--;
		}

		showRanges = EditorGUI.Foldout(new Rect(position.x, y, position.width, LINE_HEIGHT), showRanges, "RangedAngles:");
		y += LINE_HEIGHT;

		if (showRanges)
		{
			EditorGUI.indentLevel++;

			for (int i = 0; i < HandBoneIndices.RangedAngles.Length; ++i)
			{
				HandBoneIndex index = HandBoneIndices.RangedAngles[i];

				EditorGUI.LabelField(new Rect(position.x, y, position.width * 0.3f, LINE_HEIGHT), index.ToString().ToLower());

				data.RangedAngles[i].low = EditorGUI.FloatField(new Rect(position.x + position.width * 0.3f, y, position.width * 0.35f, LINE_HEIGHT), "", data.RangedAngles[i].low);
				data.RangedAngles[i].high = EditorGUI.FloatField(new Rect(position.x + position.width * 0.65f, y, position.width * 0.35f, LINE_HEIGHT), "", data.RangedAngles[i].high);
				y += LINE_HEIGHT;
			}

			EditorGUI.indentLevel--;
		}

		//Debug.Log("position: " + position.ToString());

		EditorGUI.EndProperty();
	}

	public override float GetPropertyHeight(SerializedProperty property, GUIContent label)
	{
		return (3 + (showPositions ? HandBoneIndices.Positions.Length : 0) + (showOrientations ? HandBoneIndices.FixedAngles.Length : 0) + (showRanges ? HandBoneIndices.RangedAngles.Length : 0)) * LINE_HEIGHT;
	}
}

using UnityEngine;
using System.Collections;
using System.Collections.Generic;


[ExecuteInEditMode]
[RequireComponent(typeof(MeshBuilder))]
public class KeyModifier : MonoBehaviour
{
	public int CriterionLeftOutXIndex;
	public int CriterionRightOutXIndex;
	public int CriterionLeftInnerXIndex;
	public int CriterionRightInnerXIndex;

	public int CriterionTailLeftIndex;
	public int CriterionTailRightIndex;

	public int[] LeftHollowIndices = new int[0];
	public int[] RightHollowIndices = new int[0];
	public int[] TailIndices = new int[0];

	public float LeftHollowX
	{
		get
		{
			if (CriterionLeftInnerXIndex < 0)
				return 0;

			return getX(CriterionLeftInnerXIndex);
		}
		set
		{
			setHollowX(value, RightHollowX);
		}
	}

	public float RightHollowX
	{
		get
		{
			if (CriterionRightInnerXIndex < 0)
				return 0;

			return getX(CriterionRightInnerXIndex);
		}
		set
		{
			setHollowX(LeftHollowX, value);
		}
	}

	private MeshBuilder meshBuilder;

	private float getX(int index)
	{
		Transform trans = meshBuilder.getPointerAt(index);
		return trans.localPosition.x;
	}

	private void setX(int index, float x)
	{
		Transform trans = meshBuilder.getPointerAt(index);
		trans.localPosition = new Vector3(x, trans.localPosition.y, trans.localPosition.z);
	}

	void Start()
	{
		meshBuilder = GetComponent<MeshBuilder>();
	}

	public void setHollowX(float leftX, float rightX)
	{
		if (CriterionLeftInnerXIndex >= 0)
		{
			float delta = leftX - LeftHollowX;

			foreach (int i in LeftHollowIndices)
				setX(i, getX(i) + delta);
		}

		if (CriterionRightInnerXIndex >= 0)
		{
			float delta = rightX - RightHollowX;

			foreach (int i in RightHollowIndices)
				setX(i, getX(i) + delta);
		}

		{
			float left = CriterionLeftInnerXIndex >= 0 ? getX(CriterionLeftInnerXIndex) : getX(CriterionLeftOutXIndex);
			float right = CriterionRightInnerXIndex >= 0 ? getX(CriterionRightInnerXIndex) : getX(CriterionRightOutXIndex);
			float center = (left + right) / 2f;

			float delta = center - (getX(CriterionTailLeftIndex) + getX(CriterionTailRightIndex)) / 2f;
			foreach(int i in TailIndices)
				setX(i, getX(i) + delta);
		}
	}

	public void mirrorX()
	{
		for (int i = 0; i < meshBuilder.PointerCount; ++i)
		{
			Transform pointer = meshBuilder.getPointerAt(i);
			pointer.localPosition = new Vector3(-pointer.localPosition.x, pointer.localPosition.y, pointer.localPosition.z);
			pointer.localRotation = new Quaternion(-pointer.localRotation.x, pointer.localRotation.y, pointer.localRotation.z, -pointer.localRotation.w);
		}

		meshBuilder.inverseFaces();
	}
}

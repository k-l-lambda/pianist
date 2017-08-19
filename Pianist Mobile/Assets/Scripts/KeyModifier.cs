using UnityEngine;
using System.Collections;
using System.Collections.Generic;


[ExecuteInEditMode]
[RequireComponent(typeof(MeshBuilder))]
public class KeyModifier : MonoBehaviour
{
	public int CriterionOutXIndex;
	public int CriterionInnerXIndex;

	public int CriterionTailLeftIndex;
	public int CriterionTailRightIndex;

	public int[] HollowIndices = new int[0];
	public int[] TailIndices = new int[0];

	public float HollowX
	{
		get {
			return getX(CriterionInnerXIndex);
		}
		set {
			// TODO:
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
}

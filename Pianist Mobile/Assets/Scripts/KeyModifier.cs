using UnityEngine;
using System.Collections;
using System.Collections.Generic;


[ExecuteInEditMode]
[RequireComponent(typeof(MeshBuilder))]
public class KeyModifier : MonoBehaviour
{
	public int CriterionOutXIndex;
	public int CriterionInnerXIndex;

	public int[] HollowIndices = new int[0];
	public int[] TailIndices = new int[0];
}

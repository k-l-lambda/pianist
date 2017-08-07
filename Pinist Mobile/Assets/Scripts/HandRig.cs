using UnityEngine;
using System.Collections;


namespace Pianist
{
	[ExecuteInEditMode]
	public class HandRig : MonoBehaviour
	{
		public HandRigData Data = new HandRigData();

		private Transform[] Nodes;


		private void searchNodes()
		{
			Transform[] children = gameObject.GetComponentsInChildren<Transform>();

			Nodes = new Transform[(int)HandBoneIndex.Count];
			foreach (Transform child in children)
			{
				try
				{
					HandBoneIndex index = (HandBoneIndex)System.Enum.Parse(typeof(HandBoneIndex), child.name, true);
					Nodes[(int)index] = child;
				}
				catch(System.ArgumentException)
				{
				}
			}

			for (HandBoneIndex i = HandBoneIndex.Begin; i < HandBoneIndex.End; ++i)
			{
				if (!Nodes[(int)i])
				{
					Debug.LogError("HandRig: Node of not found: " + i.ToString());
				}
			}

			Debug.Log("HandRig: nodes load.");
		}

		public void captureData()
		{
			int i = 0;
			foreach (HandBoneIndex index in HandBoneIndices.Positions)
				Data.Positions[i++] = Nodes[(int)index].localPosition;

			i = 0;
			foreach (HandBoneIndex index in HandBoneIndices.Orientations)
				Data.Orientations[i++] = Vector3.Dot(Nodes[(int)index].localRotation.eulerAngles, HandBoneIndices.RotationAxies[(int)index]);
	}

		public void applyData()
		{
			int i = 0;
			foreach (HandBoneIndex index in HandBoneIndices.Positions)
				Nodes[(int)index].localPosition = Data.Positions[i++];

			i = 0;
			foreach (HandBoneIndex index in HandBoneIndices.Orientations)
				Nodes[(int)index].localRotation = Quaternion.AngleAxis(Data.Orientations[i++], HandBoneIndices.RotationAxies[(int)index]);
		}

		public void Start()
		{
			searchNodes();
		}
	}
}

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
			foreach (HandBoneIndex index in HandBoneIndices.FixedAngles)
			{
				float angle = Vector3.Dot(Nodes[(int)index].localRotation.eulerAngles, HandBoneIndices.RotationAxies[(int)index]);
				if (angle > 180)
					angle -= 360;
				Data.FixedAngles[i++] = angle;
			}
	}

		public void applyData()
		{
			int i = 0;
			foreach (HandBoneIndex index in HandBoneIndices.Positions)
				Nodes[(int)index].localPosition = Data.Positions[i++];

			i = 0;
			foreach (HandBoneIndex index in HandBoneIndices.FixedAngles)
				Nodes[(int)index].localRotation = Quaternion.AngleAxis(Data.FixedAngles[i++], HandBoneIndices.RotationAxies[(int)index]);
		}

		public void Start()
		{
			searchNodes();
		}
	}
}

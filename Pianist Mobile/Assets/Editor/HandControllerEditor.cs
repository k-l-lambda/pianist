
using UnityEngine;
using UnityEditor;

using Pianist;


[CustomEditor(typeof(HandController))]
public class HandControllerEditor : Editor
{
	public override void OnInspectorGUI()
	{
		HandController t = target as HandController;

		if (GUILayout.Button("Generate Skeleton"))
		{
			Transform parent = t.transform;

			for (HandBoneIndex i = HandBoneIndices.WristStart; i < HandBoneIndices.WristEnd; ++i)
				parent = createBoneNode(parent, i);

			Transform thumb = parent, index = parent, middle = parent, ring = parent, pinky = parent;

			for (HandBoneIndex i = HandBoneIndices.ThumbStart; i < HandBoneIndices.ThumbEnd; ++i)
				thumb = createBoneNode(thumb, i);
			for (HandBoneIndex i = HandBoneIndices.IndexStart; i < HandBoneIndices.IndexEnd; ++i)
				index = createBoneNode(index, i);
			for (HandBoneIndex i = HandBoneIndices.MiddleStart; i < HandBoneIndices.MiddleEnd; ++i)
				middle = createBoneNode(middle, i);
			for (HandBoneIndex i = HandBoneIndices.RingStart; i < HandBoneIndices.RingEnd; ++i)
				ring = createBoneNode(ring, i);
			for (HandBoneIndex i = HandBoneIndices.PinkyStart; i < HandBoneIndices.PinkyEnd; ++i)
				pinky = createBoneNode(pinky, i);

			HandRig rig = t.GetComponent<HandRig>();
			if(rig)
				rig.searchNodes();
		}
	}

	private Transform createBoneNode(Transform parent, HandBoneIndex name)
	{
		string sname = ((HandBoneIndex)(int)name).ToString().ToLower();
		Transform trans = parent.FindChild(sname);
		if (trans == null)
		{
			GameObject obj;
			if (name > HandBoneIndices.WristEnd && System.Array.IndexOf(HandBoneIndices.Positions, name + 1) >= 0 && System.Array.IndexOf(HandBoneIndices.Tips, name) < 0)
			{
				obj = GameObject.Instantiate(Resources.Load<GameObject>("Prefabs/bone"));
				obj.name = sname;
			}
			else
				obj = new GameObject(sname);
			obj.transform.parent = parent;
			trans = obj.transform;

			BoneMarker marker = parent.GetComponent<BoneMarker>();
			if (marker)
				marker.Tip = trans;
		}

		return trans;
	}
}

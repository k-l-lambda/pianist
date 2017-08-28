using UnityEngine;
using System.Collections;
using System.Collections.Generic;


namespace Pianist
{
	[ExecuteInEditMode]
	[RequireComponent(typeof(HandRig))]
	public class HandController : MonoBehaviour
	{
		public delegate void GearMoving(float angle);

		public class Gear
		{
			public Gear(Transform trans, HandBoneIndex bone, HandRig rig, GearMoving onMoving_)
			{
				transform = trans;
				axis = HandBoneIndices.RotationAxies[(int)bone];

				int index = System.Array.IndexOf(HandBoneIndices.RangedAngles, bone);
				range = rig.Data.RangedAngles[index];
				onMoving = onMoving_;
			}

			public readonly Transform transform;
			public readonly Vector3 axis;

			public readonly HandRigData.Range range;

			GearMoving onMoving;

			public float angle
			{
				get {
					float angle = Vector3.Dot(transform.localRotation.eulerAngles, axis);
					if (angle > 180)
						angle -= 360;

					return angle;
				}
				set {
					float v = Mathf.Min(Mathf.Max(value, range.low), range.high);
					transform.localRotation = Quaternion.AngleAxis(v, axis);

					onMoving(v);
				}
			}
		};


		public HandRig Rig;
		public Transform[] Nodes;

		public Dictionary<HandBoneIndex, Gear> Gears = new Dictionary<HandBoneIndex,Gear>();


		void Start()
		{
			Rig = GetComponent<HandRig>();
			Nodes = Rig.getNodes();

			createGears();
		}

		public void createGears()
		{
			foreach (HandBoneIndex bone in HandBoneIndices.RangedAngles)
			{
				if (Nodes.Length > (int)bone && Nodes[(int)bone])
					Gears[bone] = new Gear(Nodes[(int)bone], bone, Rig, x => onGearMoving(bone, x));
			}
		}

		void Update()
		{
		}

		void onGearMoving(HandBoneIndex bone, float angle)
		{
			//Debug.Log("onGearMoving: " + bone.ToString());
			HandBoneIndex linkage;
			if (HandBoneIndices.Linkages.TryGetValue(bone, out linkage))
			{
				int sourceIndex = System.Array.IndexOf(HandBoneIndices.RangedAngles, bone);
				HandRigData.Range sourceRange = Rig.Data.RangedAngles[sourceIndex];
				float amplitude = (angle - sourceRange.low) / (sourceRange.high - sourceRange.low);

				int targetIndex = System.Array.IndexOf(HandBoneIndices.RangedAngles, linkage);
				HandRigData.Range targetRange = Rig.Data.RangedAngles[targetIndex];
				float targetAmp = (Gears[linkage].angle - targetRange.low) / (targetRange.high - targetRange.low);
				if(Mathf.Abs(targetAmp - amplitude) > 0.05f)
					Gears[linkage].angle = targetRange.low + (targetRange.high - targetRange.low) * amplitude;
			}
		}
	}
}

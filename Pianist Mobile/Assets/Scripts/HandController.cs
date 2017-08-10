using UnityEngine;
using System.Collections;
using System.Collections.Generic;


namespace Pianist
{
	[ExecuteInEditMode]
	[RequireComponent(typeof(HandRig))]
	public class HandController : MonoBehaviour
	{
		public class Gear
		{
			public Gear(Transform trans, HandBoneIndex bone)
			{
				transform = trans;
				axis = HandBoneIndices.RotationAxies[(int)bone];
			}

			public readonly Transform transform;
			public readonly Vector3 axis;

			public float angle
			{
				get {
					float angle = Vector3.Dot(transform.localRotation.eulerAngles, axis);
					if (angle > 180)
						angle -= 360;

					return angle;
				}
				set {
					transform.localRotation = Quaternion.AngleAxis(value, axis);
				}
			}
		};


		HandRig Rig;
		private Transform[] Nodes;

		Dictionary<HandBoneIndex, Gear> Gears = new Dictionary<HandBoneIndex,Gear>();


		void Start () {
			Rig = GetComponent<HandRig>();
			Nodes = Rig.getNodes();

			foreach (HandBoneIndex bone in HandBoneIndices.RangedAngles)
			{
				Gears[bone] = new Gear(Nodes[(int)bone], bone);
			}
		}
	
		void Update () {
		}
	}
}

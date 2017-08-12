using UnityEngine;
using System.Collections;
using System.Collections.Generic;


[ExecuteInEditMode]
public class MeshBuilder : MonoBehaviour
{
	/*[System.Serializable]
	public class Pointer
	{
		public Transform transform;

		public Vector3 position
		{
			get {
				return transform ? transform.localPosition : Vector3.zero;
			}
			set {
				if (transform)
					transform.localPosition = value;
			}
		}
	};


	public Pointer[] Pointers;*/

	private List<GameObject> Pointers = new List<GameObject>();

	public int PointerCount
	{
		get {
			return Pointers.Count;
		}
		set {
			value = Mathf.Min(value, 32768);
			if (value != Pointers.Count)
				resizePointers(value);
		}
	}


	void Start()
	{
	}

	void Update()
	{
	}


	public void resizePointers(int newSize)
	{
		if (newSize < Pointers.Count)
		{
			for (int i = newSize; i < Pointers.Count; ++i)
			{
				Pointers[i].SetActive(false);
				//GameObject.Destroy(Pointers[i]);
			}

			Pointers.RemoveRange(newSize, Pointers.Count - newSize);
		}
		else
		{
			for (int i = Pointers.Count; i < newSize; ++i)
			{
				Transform trans = transform.Find(i.ToString());
				GameObject obj = trans ? trans.gameObject : new GameObject(i.ToString());

				obj.transform.parent = transform;
				obj.SetActive(true);

				Pointers.Add(obj);
			}
		}
	}

	public Transform getPointerAt(int i)
	{
		return Pointers[i].transform;
	}
}

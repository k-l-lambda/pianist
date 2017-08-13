﻿using UnityEngine;
using System.Collections;
using System.Collections.Generic;


[ExecuteInEditMode]
public class MeshBuilder : MonoBehaviour
{
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

	public Mesh ResultMesh
	{
		get {
			// TODO:
			return new Mesh();
		}
	}

	public string Name;
	public string AssetFolder = "Assets/Resources/";


	void Start()
	{
		Name = gameObject.name;
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
			Transform lastTransform = Pointers.Count > 0 ? getPointerAt(PointerCount - 1) : null;

			for (int i = Pointers.Count; i < newSize; ++i)
			{
				Transform trans = transform.Find(i.ToString());
				GameObject obj = trans ? trans.gameObject : new GameObject(i.ToString());

				obj.transform.parent = transform;
				obj.transform.position = lastTransform ? lastTransform.position : Vector3.zero;
				obj.transform.rotation = lastTransform ? lastTransform.rotation : Quaternion.identity;

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
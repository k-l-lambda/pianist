﻿using UnityEngine;
using System.Collections;
using System.Collections.Generic;


[ExecuteInEditMode]
public class MeshBuilder : MonoBehaviour
{
	[System.Serializable]
	public class Face
	{
		public MeshTopology topology;

		[TextArea(1, 20)]
		public string indicesSource;

		public int[] indices
		{
			get {
				string[] lines = indicesSource.Split('\n');

				int [] results = new int[0];

				foreach (string line in lines)
				{
					try
					{
						int[] indices = System.Array.ConvertAll<string, int>(line.Split(','), int.Parse);

						switch (topology)
						{
							case MeshTopology.Triangles:
								{
									int size = indices.Length - indices.Length % 3;
									if (size != indices.Length)
										System.Array.Resize(ref indices, size);
								}

								break;
							case MeshTopology.Lines:
								{
									int size = indices.Length - indices.Length % 2;
									if (size != indices.Length)
										System.Array.Resize(ref indices, size);
								}

								break;
							case MeshTopology.Quads:
								{
									int size = indices.Length - indices.Length % 4;
									if (size != indices.Length)
										System.Array.Resize(ref indices, size);
								}

								break;
						}

						int start = results.Length;
						System.Array.Resize(ref results, results.Length + indices.Length);
						indices.CopyTo(results, start);
					}
					catch(System.FormatException)
					{
					}
				}

				return results;
			}
		}
	};

	public Material PreviewMaterial;

	private List<GameObject> Pointers = new List<GameObject>();

	public Face[] Faces = new Face[0];

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
		get
		{
			Mesh mesh = new Mesh();

			Vector3[] positions = new Vector3[Pointers.Count];
			Vector3[] normals = new Vector3[Pointers.Count];

			for (int i = 0; i < Pointers.Count; ++i)
			{
				positions[i] = Pointers[i].transform.localPosition;
				normals[i] = Pointers[i].transform.TransformVector(Vector3.forward);
			}

			mesh.vertices = positions;
			mesh.normals = normals;

			mesh.subMeshCount = Faces.Length;
			{
				int i = 0;
				foreach (Face face in Faces)
				{
					//Debug.Log(System.String.Join(",", new List<int>(face.indices).ConvertAll(ii => ii.ToString()).ToArray()));
					if (face.indices.Length > 0)
						mesh.SetIndices(face.indices, face.topology, i++);
				}
			}

			return mesh;
		}
	}

	public string Name;
	public string AssetFolder = "Assets/Resources/";

	public bool PreviewMesh = true;
	//public MaterialPropertyBlock PreviewMeshMpb = new MaterialPropertyBlock();


	void Start()
	{
		if (Name == "")
			Name = gameObject.name;

		loadPointers();
	}

	void Update()
	{
		if (PreviewMesh)
		{
			bool selected = System.Array.IndexOf(UnityEditor.Selection.gameObjects, gameObject) >= 0;

			MaterialPropertyBlock block = new MaterialPropertyBlock();
			block.SetColor("_Color", new Color(0.7f, 0.7f, selected ? 0.7f : 0f, 0.6f));

			for (int i = 0; i < Faces.Length; ++i)
				Graphics.DrawMesh(ResultMesh, transform.localToWorldMatrix, PreviewMaterial, 0, null, i, block);
		}
	}


	public void loadPointers()
	{
		int count = 0;
		while (true)
		{
			if (!transform.FindChild(count.ToString()))
				break;

			++count;
		}

		resizePointers(count);
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
		else if (newSize > Pointers.Count)
		{
			Transform lastTransform = Pointers.Count > 0 ? getPointerAt(PointerCount - 1) : null;

			for (int i = Pointers.Count; i < newSize; ++i)
			{
				Transform trans = transform.Find(i.ToString());
				GameObject obj = trans ? trans.gameObject : new GameObject(i.ToString());

				if (!trans)
				{
					obj.transform.parent = transform;
					obj.transform.localPosition = lastTransform ? lastTransform.localPosition : Vector3.zero;
					obj.transform.localRotation = lastTransform ? lastTransform.localRotation : Quaternion.identity;
				}

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

using UnityEngine;
using System.Collections;


[ExecuteInEditMode]
public class BoneMarker : MonoBehaviour
{

	public Transform Tip;
	public float Width = 0.6f;
	public bool AutoUpdateMesh = false;

	// Use this for initialization
	void Start () {
		if (AutoUpdateMesh)
			updateMesh();

		MeshRenderer mr = GetComponent<MeshRenderer>();
		if (mr)
		{
			MaterialPropertyBlock block = new MaterialPropertyBlock();
			block.SetColor("_Color", new Color(0.48f, 1, 0.78f));

			mr.SetPropertyBlock(block);
		}
	}
	
	// Update is called once per frame
	void Update () {
	
	}

	public void updateMesh() {
		const float sqrt3_3 = 0.57735f;
		float half_wid = Width / 2f;
		Vector3 tip_pos = Tip.localPosition;

		Vector3[] vertices = new Vector3[] {
			new Vector3(-half_wid, -half_wid, 0), new Vector3(-half_wid, +half_wid, 0), new Vector3(+half_wid, +half_wid, 0), new Vector3(+half_wid, -half_wid, 0),
			tip_pos + new Vector3(-half_wid, -half_wid, 0), tip_pos + new Vector3(-half_wid, +half_wid, 0), tip_pos + new Vector3(+half_wid, +half_wid, 0), tip_pos + new Vector3(+half_wid, -half_wid, 0),
		};
		Vector3[] normals = new Vector3[] {
			new Vector3(-sqrt3_3, -sqrt3_3, -sqrt3_3), new Vector3(-sqrt3_3, +sqrt3_3, -sqrt3_3), new Vector3(+sqrt3_3, +sqrt3_3, -sqrt3_3), new Vector3(+sqrt3_3, -sqrt3_3, -sqrt3_3),
			new Vector3(-sqrt3_3, -sqrt3_3, +sqrt3_3), new Vector3(-sqrt3_3, +sqrt3_3, +sqrt3_3), new Vector3(+sqrt3_3, +sqrt3_3, +sqrt3_3), new Vector3(+sqrt3_3, -sqrt3_3, +sqrt3_3),
		};

		Mesh box = new Mesh();
		box.vertices = vertices;
		box.normals = normals;

		box.subMeshCount = 3;
		box.SetIndices(new int[] { 0, 1, 2, 3, 0 }, MeshTopology.LineStrip, 0);
		box.SetIndices(new int[] { 4, 5, 6, 7, 4 }, MeshTopology.LineStrip, 1);
		box.SetIndices(new int[] { 0, 4, 1, 5, 2, 6, 3, 7 }, MeshTopology.Lines, 2);

		MeshFilter mf = GetComponent<MeshFilter>();
		if (mf)
			mf.mesh = box;
	}
}

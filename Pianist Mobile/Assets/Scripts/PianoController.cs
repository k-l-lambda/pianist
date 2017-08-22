using System.Collections;
using System.Collections.Generic;
using UnityEngine;


[ExecuteInEditMode]
public class PianoController : MonoBehaviour {
	public Transform Keyboard;
	public float AngleMax = -2.6f;

	private Transform[] Keys = new Transform[109];

	void Start () {
		if (!Keyboard)
		{
			Debug.LogError("Piano keyboard is null.");
			return;
		}

		int index = 21;

		Keys[index++] = Keyboard.Find("KeyGroup0/key6");
		Keys[index++] = Keyboard.Find("KeyGroup0/key_b5");
		Keys[index++] = Keyboard.Find("KeyGroup0/key7");

		for (int i = 1; i <= 7; ++i)
		{
			Transform group = Keyboard.Find("KeyGroup" + i.ToString());

			Keys[index++] = group.Find("key1");
			Keys[index++] = group.Find("key_b1");
			Keys[index++] = group.Find("key2");
			Keys[index++] = group.Find("key_b2");
			Keys[index++] = group.Find("key3");
			Keys[index++] = group.Find("key4");
			Keys[index++] = group.Find("key_b3");
			Keys[index++] = group.Find("key5");
			Keys[index++] = group.Find("key_b4");
			Keys[index++] = group.Find("key6");
			Keys[index++] = group.Find("key_b5");
			Keys[index++] = group.Find("key7");
		}

		Keys[index++] = Keyboard.Find("KeyGroup8/key1");
	}

	void Update () {
	}

	public float getKeyPosition(int index)
	{
		Transform key = Keys[index];
		if (key)
		{
			float x = key.localRotation.eulerAngles.x;
			if (x > 0)
				x -= 360;
			return x / AngleMax;
		}

		Debug.LogWarning("index out of range: " + index.ToString());

		return -1;
	}
	public void setKeyPosition(int index, float depth)
	{
		Transform key = Keys[index];
		if(key)
			key.localRotation = Quaternion.AngleAxis(AngleMax * depth, Vector3.right);
	}
}

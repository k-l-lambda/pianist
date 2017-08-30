using UnityEngine;
using System.IO;
using Midi = Sanford.Multimedia.Midi;


[ExecuteInEditMode]
public class FingeringGenerator : MonoBehaviour
{
	public TextAsset SourceAsset;
	public Midi.Sequence MidiSeq;


	void Start ()
	{
	}

	public void load()
	{
		if (!SourceAsset)
		{
			Debug.LogError("SourceAsset is null.");
			return;
		}

		MemoryStream stream = new MemoryStream();
		stream.Write(SourceAsset.bytes, 0, SourceAsset.bytes.Length);
		stream.Position = 0;

		MidiSeq = new Midi.Sequence();
		MidiSeq.Load(stream);
	}
}

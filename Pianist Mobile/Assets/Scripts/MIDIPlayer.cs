using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using System.IO;

public class MIDIPlayer : MonoBehaviour {
	Transform Player;

	Dropdown FileList;
	InputField MediaFolder;

	Sanford.Multimedia.Midi.Sequence sequence = new Sanford.Multimedia.Midi.Sequence();
	Sanford.Multimedia.Midi.Sequencer sequencer = new Sanford.Multimedia.Midi.Sequencer();

	public event System.EventHandler<Sanford.Multimedia.Midi.ChannelMessageEventArgs> ChannelMessagePlayed
	{
		add
		{
			sequencer.ChannelMessagePlayed += value;
		}
		remove
		{
			sequencer.ChannelMessagePlayed -= value;
		}
	}

	FileInfo[] Files;


	void Start()
	{
		Player = transform;

		FileList = Player.Find("FileList").GetComponent<Dropdown>();
		FileList.ClearOptions();

		MediaFolder = Player.Find("MediaFolder").GetComponent<InputField>();

		sequence.Format = 1;

		sequencer.Position = 0;
		sequencer.Sequence = sequence;

		sequencer.ChannelMessagePlayed += new System.EventHandler<Sanford.Multimedia.Midi.ChannelMessageEventArgs> (onChannelMessagePlayed);
	}

	void searchFiles()
	{
		List<Dropdown.OptionData> options = new List<Dropdown.OptionData>();

		DirectoryInfo dir = new DirectoryInfo(MediaFolder.text);
		Files = dir.GetFiles("*.mid");
		foreach (FileInfo file in Files)
		{
			options.Add(new Dropdown.OptionData(file.Name));
		}

		FileList.AddOptions(options);
	}

	public void onMediaPathEditEnd()
	{
		searchFiles();
	}

	public void onFileSelectChanged()
	{
		sequencer.Stop();

		string fileName = Files[FileList.value].FullName;
		if (fileName != null)
			sequence.Load(fileName);
	}

	public void onPlay()
	{
		sequencer.Start();
	}

	private void onChannelMessagePlayed(object sender, Sanford.Multimedia.Midi.ChannelMessageEventArgs arg)
	{
		Debug.Log("ChannelMessagePlayed: " + arg.Message.Command.ToString());
	}
}

using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using System.IO;

public class MIDIPlayer : MonoBehaviour {
	Transform Player;

	Dropdown FileList;
	InputField MediaFolder;
	Text Timer;

	Sanford.Multimedia.Midi.Sequence sequence = new Sanford.Multimedia.Midi.Sequence();
	Sanford.Multimedia.Midi.Sequencer sequencer = new Sanford.Multimedia.Midi.Sequencer();

	public bool OutputToDevice = true;

	Sanford.Multimedia.Midi.OutputDevice outDevice;

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

		Timer = Player.Find("Timer").GetComponent<Text>();

		sequence.Format = 1;

		sequencer.Position = 0;
		sequencer.Sequence = sequence;

		//sequence.LoadCompleted += HandleLoadCompleted;
		sequencer.ChannelMessagePlayed += onChannelMessagePlayed;
		sequencer.Stopped += onStopped;

		if (OutputToDevice)
			outDevice = new Sanford.Multimedia.Midi.OutputDevice(0);
	}

	void OnDestroy()
	{
		if (outDevice != null)
			outDevice.Dispose();
	}

	void Update()
	{
		Timer.text = sequence.GetLength().ToString();
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

		FileList.ClearOptions();
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
			sequence.LoadAsync(fileName);
	}

	public void onPlay()
	{
		sequencer.Start();
	}

	public void onStop()
	{
		sequencer.Stop();
	}

	/*private void HandleLoadCompleted(object sender, System.ComponentModel.AsyncCompletedEventArgs e)
	{
		Timer.text = sequence.GetLength().ToString();
	}*/

	private void onChannelMessagePlayed(object sender, Sanford.Multimedia.Midi.ChannelMessageEventArgs arg)
	{
		//Debug.Log("ChannelMessagePlayed: " + arg.Message.Command.ToString());

		if(OutputToDevice)
			outDevice.Send(arg.Message);
	}

	private void onStopped(object sender, Sanford.Multimedia.Midi.StoppedEventArgs arg)
	{
		foreach(Sanford.Multimedia.Midi.ChannelMessage message in arg.Messages)
			Debug.Log("ChannelMessagePlayed: " + message.Command);
	}
}

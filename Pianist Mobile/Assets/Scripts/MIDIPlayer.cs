using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using System.IO;
using Midi = Sanford.Multimedia.Midi;



public class MIDIPlayer : MonoBehaviour {
	Transform Player;

	Dropdown FileList;
	InputField MediaFolder;
	Text Timer;

	Midi.Sequence sequence = new Midi.Sequence();
	Midi.Sequencer sequencer = new Midi.Sequencer();

	public bool OutputToDevice = true;

	Midi.OutputDevice outDevice;

	public event System.EventHandler<Midi.ChannelMessageEventArgs> ChannelMessagePlayed
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

		string path = PlayerPrefs.GetString("MediaFolder");
		if (path != null && path.Length > 0)
			MediaFolder.text = path;

		Timer = Player.Find("Timer").GetComponent<Text>();

		sequence.Format = 1;

		sequencer.Position = 0;
		sequencer.Sequence = sequence;

		//sequence.LoadCompleted += HandleLoadCompleted;
		sequencer.ChannelMessagePlayed += onChannelMessagePlayed;
		sequencer.Stopped += onStopped;

		if (OutputToDevice)
			outDevice = new Midi.OutputDevice(0);
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
		PlayerPrefs.SetString("MediaFolder", MediaFolder.text);
		PlayerPrefs.Save();

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

	private void onChannelMessagePlayed(object sender, Midi.ChannelMessageEventArgs arg)
	{
		//Debug.Log("ChannelMessagePlayed: " + arg.Message.Command.ToString());

		if(OutputToDevice)
			outDevice.Send(arg.Message);
	}

	private void onStopped(object sender, Midi.StoppedEventArgs arg)
	{
		foreach (Midi.ChannelMessage message in arg.Messages)
		{
			Debug.Log("ChannelMessagePlayed: " + message.Command);
			outDevice.Send(message);
		}
	}
}

using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using System.IO;

public class MIDIPlayer : MonoBehaviour {
	Transform Player;

	Dropdown FileList;
	InputField MediaFolder;


	void Start()
	{
		Player = transform;

		FileList = Player.Find("FileList").GetComponent<Dropdown>();
		FileList.ClearOptions();

		MediaFolder = Player.Find("MediaFolder").GetComponent<InputField>();
	}

	void searchFiles()
	{
		List<Dropdown.OptionData> options = new List<Dropdown.OptionData>();

		DirectoryInfo dir = new DirectoryInfo(MediaFolder.text);
		FileInfo[] files = dir.GetFiles("*.mid");
		foreach (FileInfo file in files)
		{
			options.Add(new Dropdown.OptionData(file.Name));
		}

		FileList.AddOptions(options);
	}

	public void onMediaPathEditEnd()
	{
		searchFiles();
	}
}

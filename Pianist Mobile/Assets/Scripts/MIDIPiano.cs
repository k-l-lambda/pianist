using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Midi = Sanford.Multimedia.Midi;



[RequireComponent(typeof(PianoController))]
public class MIDIPiano : MonoBehaviour
{
	PianoController Controller;
	MIDIPlayer Player;

	List<System.Action> Actions = new List<System.Action>();

	void Start () {
		Controller = GetComponent<PianoController>();

		GameObject midiPlayer = GameObject.Find("MIDIPlayer");
		Player = midiPlayer.GetComponent<MIDIPlayer>();

		Player.ChannelMessagePlayed += onChannelMessagePlayed;
	}

	void Update () {
		foreach (System.Action action in Actions)
			action.Invoke();

		Actions.Clear();
	}

	private void onChannelMessagePlayed(object sender, Midi.ChannelMessageEventArgs arg)
	{
		if (arg.Message.Command == Midi.ChannelCommand.NoteOn)
			Actions.Add(delegate {
				Controller.setKeyPosition(arg.Message.Data1, 1);
			});
		else if (arg.Message.Command == Midi.ChannelCommand.NoteOff)
			Actions.Add(delegate {
				Controller.setKeyPosition(arg.Message.Data1, 0);
			});
	}
}

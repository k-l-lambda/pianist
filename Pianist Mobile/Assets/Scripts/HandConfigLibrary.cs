using UnityEngine;
using System.IO;
using System.Collections.Generic;

using Pianist;


[ExecuteInEditMode]
public class HandConfigLibrary : MonoBehaviour
{
	public HandConfig[] HandConfigs;


	public HandConfig getConfig(string name)
	{
		foreach(HandConfig config in HandConfigs)
		{
			if (config.Name == name)
				return config;
		}

		return null;
	}
}

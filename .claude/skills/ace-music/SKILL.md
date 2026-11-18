---
name: ace-music
description: Generate music locally with ACE-Step 1.5 (text to music; a 5Hz LM plans BPM, key and structure, a turbo DiT renders the audio in 8 steps). Use when asked to generate, compose or produce a music track, background music, an instrumental or a song from a description, to try a style, or to make variants by seed; also to check generated audio's tempo, key and brightness.
---

# Music with ACE-Step 1.5

**Start here:** read `doc.local.md` in this skill's folder. It is not committed. It gives this
machine's values for the placeholders below: `<ace>` (the ACE-Step checkout with its weights),
`<ace-python>`, `<audio-python>`, `<uv>`, where outputs go, the network routes for downloads,
and the runs made so far. If it is missing, follow "Setup" and write one.

## What it is

- Code: `https://github.com/ace-step/ACE-Step-1.5`. Weights: the HF repo `ACE-Step/Ace-Step1.5`
  (mirrors exist, e.g. `anti-human-music/Ace-Step1.5`, same files). MIT licence; the authors state
  the output may be used commercially.
- Two stages:
  1. A **5Hz LM** (`acestep-5Hz-lm-0.6B` / `1.7B` / `4B`, Qwen3-based). From the caption it
     plans metadata (BPM, key, time signature, duration), a refined caption and 5 Hz audio codes,
     by chain of thought ("thinking").
  2. A **DiT** renders audio from them: `acestep-v15-turbo` (8 steps, no CFG), `-sft` / `-base`
     (50 steps, CFG), or the XL (4B) variants for higher quality.
  - Supporting parts: a VAE (48 kHz stereo) and a text encoder (`Qwen3-Embedding-0.6B`).
- The `Ace-Step1.5` repo holds the turbo DiT, the 1.7B LM, the VAE and the text encoder, about
  10 GB in all. Put it in `<ace>/checkpoints/`: the code looks for `<project_root>/checkpoints/<model>`.
- On an RTX 3090 (the 1.7B LM, `pt` backend):
  - loading takes 40-80 s;
  - two 90 s tracks take ~95 s, one 20 s track ~12 s;
  - VRAM is well under 24 GB.

## Generate

```bash
cd <ace>
<ace-python> <skill>/generate.py --ace <ace> --out <dir> --caption '<description>' \
    [--bpm 72] [--key 'E Major'] [--timesig 4] [--duration 90] [--seeds 11,23] [--name <stem>]
```

- `--caption-file` takes the description from a file instead. Captions are at most 512
  characters.
- `--lyrics` / `--lyrics-file` give lyrics with section tags (`[Verse]`, `[Chorus]`, `[Bridge]`,
  `[Instrumental Break]`, ...). Set `--language` (`zh`, `en`, ...). Without lyrics the track is
  instrumental (`[Instrumental]`).
- `--seeds` makes one sample per seed, in one batch. Fixed seeds reproduce.
- `--no-think` skips the LM: the DiT works from your caption and metadata alone. It is faster
  and more literal, but has no plan.
- Non-turbo DiT: `--dit acestep-v15-sft --steps 50 --guidance 7`. Turbo ignores the guidance
  (it is forced to 1) and needs `--shift 3.0`, which is the default here.
- Output in `<dir>`:
  - `<name>-seed<N>.wav`, peak-normalised to -1 dBFS, plus an `.mp3` copy;
  - `run.json` with the parameters and timings.
- The weights are local; the script sets `HF_HUB_OFFLINE=1` so nothing is fetched at run time.

### Python API (what the script wraps)

```python
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music
dit = AceStepHandler(); dit.initialize_service(project_root=ace, config_path='acestep-v15-turbo', device='cuda')
llm = LLMHandler(); llm.initialize(checkpoint_dir=f'{ace}/checkpoints', lm_model_path='acestep-5Hz-lm-1.7B', backend='pt', device='cuda')
p = GenerationParams(caption=..., lyrics='[Instrumental]', instrumental=True, bpm=72, keyscale='E Major',
                     timesignature='4', duration=90, inference_steps=8, shift=3.0, thinking=True)
r = generate_music(dit, llm, p, GenerationConfig(batch_size=2, use_random_seed=False, seeds=[11, 23], audio_format='wav'), save_dir=out)
```

- `initialize_service` / `initialize` return `(message, ok)`. Check `ok`.
- The saved files get uuid names; the script renames them by seed.
- Other tasks go through the same call with `task_type`: `cover` (with `src_audio` and
  `audio_cover_strength`), `repaint` (with `repainting_start` / `repainting_end`), and on the
  base model `extract`, `lego`, `complete`. See `<ace>/docs/en/INFERENCE.md`.

## Writing the caption

Write one paragraph: the genre, the lead instrument, the accompaniment, the tempo feel, the space
and the mood. Fix BPM, key and time signature with the flags rather than in words.

- **Name the lead and say it leads**, e.g. "a solo grand piano leads throughout, playing a slow,
  lyrical melody in the upper register". Otherwise pads and percussion take over.
- **Say what you don't want**: "no drums, no heavy beat". In a test without it, "soft light
  electronic percussion" turned into dense percussion halfway through.
- Brightness comes from the register and the voicing ("upper register", "open, luminous major
  voicings", "glassy bell tones") together with a major key.
- **A mode named in words is not followed; spell out the harmony.** "lydian colour" alone gave no A#
  in E major, in any sample. Naming the note and the chords ("E Lydian, A sharp prominent: chords
  Emaj9#11, F#/E, Bmaj7#11, C#m11"; "whole-tone runs (C D E F# G# A#)"; "a second layer in B flat
  major, a tritone away, Bbmaj7 over E bass") brought A# into 3 of 4 seeds. One seed was clearly
  polytonal (Bb and F about as strong as E's notes). One stayed plain major. Use 4+ seeds and pick.
  A stronger LM (4B) or an XL DiT may follow better; not tested.
- "No drums" is not always obeyed. With "brass swells, choir" in the caption, 2 of 4 seeds
  still had broadband rhythmic hits.
- Sci-fi feel: "shimmering synth pads, crystalline arpeggios, glassy FM bells, wide stereo, long
  lush reverb, slowly evolving textures".

## Check the result

```bash
<audio-python> <skill>/analyze.py <dir>/*-seed*.wav     # also writes <dir>/spectrograms.png
```

The script prints the length, where the sound ends, tempo, key, the pitch classes, the spectral
centroid and the RMS. Look at the spectrogram image too. Then **listen**; the numbers are only a
screen.

- **Tempo**: beat tracking often reports double the real tempo. 141-144 for a 72 BPM piece is right.
- **Key**: a correlation of 0.9 or more means the piece clearly sits in that key. Whether a mode's
  note is present shows in the pitch-class list (lydian on E needs A#), not in the key name.
  A low correlation (~0.5) with two foreign sets both strong can mean real polytonality.
- To judge a mode or a second key, compare the share of each pitch class: the mode's note against
  the plain note (A# against A for E Lydian), and the second key's own notes (F, Bb for B flat major).
  Do this over the whole piece and per 20 s window.
  - A whole-tone set's share is 50 % by chance. A short run hardly moves the average; listen for it.
- **Trailing silence**: with `--duration 90` the music sometimes ends at ~81 s and the rest is
  near silence. Trim it (`ffmpeg -t`), or ask for a longer duration and cut.
- **Spectrogram**: piano reads as separate onsets with decays; pads read as long flat bands;
  drums read as broadband vertical lines.

## Setup (once per machine)

1. `git clone https://github.com/ace-step/ACE-Step-1.5 <ace>`
2. Install with a **recent uv** (0.1.x has no `sync`): `uv sync --frozen`. `--frozen` installs
   from `uv.lock` without re-resolving. A plain `uv sync` re-resolves for every platform and
   fetches a Windows flash-attn wheel's metadata from GitHub.
   - Linux x86_64 gets torch 2.10 cu128 and a prebuilt `flash-attn` wheel. That wheel comes from a
     GitHub release (`nano-vllm` depends on it). Where GitHub is unreachable directly, give uv a
     proxy for GitHub only and keep PyPI and PyTorch direct with `NO_PROXY`.
3. Weights: `hf download ACE-Step/Ace-Step1.5 --local-dir <ace>/checkpoints` (~10 GB). Other
   models (`acestep-5Hz-lm-4B`, `acestep-v15-xl-turbo`, ...) are their own HF repos, into
   `checkpoints/<name>`.
4. Analysis needs librosa and matplotlib in some Python (`<audio-python>`).

## Pitfalls

- `cli.py` and parts of the package **clear the `*_proxy` variables** on import. Run downloads as
  separate steps, before generating.
- `run.json`'s `cot_*` fields can come back empty even when thinking ran and used your metadata.
  The plan is in the log (`# Caption`, `- bpm: ...`).
- **Memory for the larger models.** The XL DiTs ship **FP32** weights (`acestep-v15-xl-turbo`: 4 x
  5 GB = 20 GB). Loading them takes that much **host RAM** before the move to the GPU. With
  `--offload` (`offload_to_cpu`, `offload_dit_to_cpu`), the idle models also stay in host RAM.
  - A 4B LM + XL-turbo load with offload reached 30.9 GB RSS and was OOM-killed. On a 62 GB
    machine shared with other jobs it filled swap and stalled the whole box.
  - Before using XL, convert the weights to BF16 (half the size).
  - Run large loads under a memory cap, so an overrun kills only that job:
    `systemd-run --user --scope -p MemoryMax=<n>G <ace-python> generate.py ...`.
  - The 4B LM next to the 2B turbo DiT needs ~16 GB of VRAM, more than a 24 GB card has free
    when ~7 GB is taken. With `--offload` it fits.
- The 4B LM did not follow a spelt-out mode better than the 1.7B in one test (2 seeds), but it
  dropped the unwanted drums. The same seed gives different music with a different LM.
- `hf download` can hang on a bad CDN address (0-byte `.incomplete`, no progress). Downloading the
  same `resolve/main/<file>` URLs with `curl -L -C -` (resumable), with sizes checked against
  `https://huggingface.co/api/models/<repo>/tree/main?recursive=1`, works around it.
- Installing into a uv-made venv: it has no pip, and `pip` on the PATH may be the system's or the
  user's (`~/.local`). Use `uv pip install --python <venv>/bin/python ...`.

---
name: tts
description: Synthesize speech in a cloned voice with Qwen3-TTS 1.7B Base, locally. Use when asked to generate TTS / narration / a voice line from a reference voice or a saved voice embedding, or to build a voice-clone prompt from a reference clip plus its transcript.
---

# TTS with a cloned voice (Qwen3-TTS Base)

**Start here:** read `doc.local.md` in this skill's folder. It is not committed. It gives the
machine-specific values for the placeholders below: `<repo>`, `<model-dir>`, `<scripts>`,
`<voices>`, the proxy, the GPU, and the voices that already exist. If it is missing, ask the user
where the TTS repo and model are.

## Requirements

- Model: `Qwen/Qwen3-TTS-12Hz-1.7B-Base`, in `<model-dir>`. Only **Base** models can clone:
  VoiceDesign (text description) and CustomVoice (preset speakers) raise on `generate_voice_clone`.
  The speaker encoder is inside the Base checkpoint: an ECAPA-TDNN, 2048-d for 1.7B. No separate
  embedding model is needed.
- Python package `qwen-tts==0.1.1` (upstream: https://github.com/QwenLM/Qwen3-TTS).
- Run the scripts through the repo's `scripts/env.sh` from `<repo>`. It sets the venv python, the
  proxy, `LD_LIBRARY_PATH` and `HF_HUB_DISABLE_XET`.
- A CUDA GPU.
- If the model is missing, download it:
  `scripts/env.sh scripts/download_model.py --repo Qwen/Qwen3-TTS-12Hz-1.7B-Base --out <model-dir> --reuse <voice-design-dir>`

## 1. Build a voice-clone prompt (once per voice)

Input: a clean reference clip (a few seconds to about 30 s) and its **exact** transcript as SRT.

```bash
cd <repo>
scripts/env.sh <scripts>/extract_prompt.py <ref.wav> <ref.srt> --out <voices>/<voice-id>
```

- The script joins the SRT cue texts without separators into `ref_text`. That suits Chinese; for
  languages with spaces, join with spaces.
- It calls `create_voice_clone_prompt(ref_audio=(wav, sr), ref_text, x_vector_only_mode=False)` in float32.
- Writes:
  - `voice_clone_prompt.pt`: `ref_code` [frames, 16] at about 12.5 frames/s, `ref_spk_embedding` (2048-d), `ref_text`, and the mode flags;
  - `speaker_embedding.npy`;
  - `report.json`, which includes a half-vs-half cosine check. About 0.99 means the voice is consistent.

## 2. Synthesize

```bash
scripts/env.sh <scripts>/synthesize.py <voices>/<voice-id>/voice_clone_prompt.pt '<text>' \
  --language Chinese --mode icl --out <out.wav> [--seed 42]
```

- `--mode icl` (default, better quality): conditions on the reference codes, `ref_text` and the
  embedding. The reference part is decoded together with the new text and then cut off, so the
  output contains only the new text.
- `--mode xvec`: uses only the 2048-d speaker embedding, with no codes and no transcript. Quality
  may be lower.
- Output is a 24 kHz float WAV. The script prints JSON with `seconds`, `wall_seconds` and
  `cosine_to_reference`.
- `--language`: Chinese, English, … The API also accepts `Auto`.

## Using the API directly

```python
import torch
from qwen_tts import Qwen3TTSModel
from qwen_tts.inference.qwen3_tts_model import VoiceClonePromptItem

saved = torch.load('voice_clone_prompt.pt')
item = VoiceClonePromptItem(ref_code=saved['ref_code'], ref_spk_embedding=saved['ref_spk_embedding'],
                            x_vector_only_mode=False, icl_mode=True, ref_text=saved['ref_text'])
# x-vector only: ref_code=None, ref_text=None, x_vector_only_mode=True, icl_mode=False
model = Qwen3TTSModel.from_pretrained('<model-dir>', device_map='cuda',
                                      dtype=torch.bfloat16, attn_implementation='sdpa')
wavs, sr = model.generate_voice_clone(text='…', language='Chinese', voice_clone_prompt=[item],
                                      max_new_tokens=1024)
```

## Pitfalls

- Pass `voice_clone_prompt` as a **list** of `VoiceClonePromptItem`, not a dict. With a dict,
  `ref_texts_for_ids` becomes `None` and ICL silently loses the tokenized reference transcript.
- ICL without `ref_text` raises `ref_text is required when x_vector_only_mode=False (ICL mode)`.
- Sampling defaults come from the Base `generation_config.json`: temperature 0.9 and top_k 50, for
  both talker and subtalker. Seed torch and numpy for repeatable output; the script uses 42.
- Long texts: `max_new_tokens=1024` is about 80 s of audio at 12.5 frames/s. Split longer text into
  sentences and concatenate the results.
- Reading speaker cosine: different speakers still score about 0.92, because the embedding space is
  anisotropic. The same voice scores about 0.98–0.99.

## Checking a result

- Intelligibility: transcribe the output back with faster-whisper. The base model makes homophone
  errors; use a larger model for a real check.
- Similarity: compare `cosine_to_reference` against the 0.92 / 0.99 reference points above.

## Ethics

Clone a real person's voice only with their consent, and label the output as synthetic. Speech
made from a voice taken from public media without consent stays a local experiment: do not publish
or share it.

## Not yet verified

- A listening comparison of ICL vs x-vector.
- Behaviour on long texts.
- Variation across seeds.
- Whether background music in the reference clip leaks into the embedding.

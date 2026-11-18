"""Text to music with ACE-Step 1.5 (turbo DiT + 5Hz LM planner).

Run with the ACE-Step checkout's venv python (it imports `acestep`):

    <ace-python> generate.py --ace <ace-repo> --out <dir> \
        (--caption '<text>' | --caption-file <file>) [--lyrics '<text>' | --lyrics-file <file>] \
        [--bpm 72] [--key 'E Major'] [--timesig 4] [--duration 90] [--seeds 11,23] \
        [--lm acestep-5Hz-lm-1.7B] [--dit acestep-v15-turbo] [--steps 8] [--shift 3.0] \
        [--no-think] [--name futurist] [--format wav]

No lyrics means an instrumental ('[Instrumental]'). Writes <name>-seed<N>.<format> per seed,
an .mp3 copy (ffmpeg, if found), and run.json with the parameters and timings.
"""
import argparse, json, os, shutil, subprocess, sys, time

ap = argparse.ArgumentParser()
ap.add_argument('--ace', required=True, help='the ACE-Step 1.5 checkout (its checkpoints/ beside acestep/)')
ap.add_argument('--out', required=True)
g = ap.add_mutually_exclusive_group(required=True)
g.add_argument('--caption')
g.add_argument('--caption-file')
ap.add_argument('--lyrics')
ap.add_argument('--lyrics-file')
ap.add_argument('--bpm', type=int)
ap.add_argument('--key', default='', help="e.g. 'E Major', 'F# minor'; empty: the LM chooses")
ap.add_argument('--timesig', default='', help="'4' for 4/4, '3' for 3/4, '6' for 6/8")
ap.add_argument('--duration', type=float, default=-1, help='seconds, 10-600; <=0: the model chooses')
ap.add_argument('--language', default='unknown', help='vocal language code (zh, en, ...)')
ap.add_argument('--seeds', default='11,23', help='one sample per seed, batched')
ap.add_argument('--lm', default='acestep-5Hz-lm-1.7B')
ap.add_argument('--dit', default='acestep-v15-turbo')
ap.add_argument('--steps', type=int, default=8)
ap.add_argument('--shift', type=float, default=3.0, help='3.0 for turbo models')
ap.add_argument('--guidance', type=float, default=7.0, help='CFG, non-turbo models only')
ap.add_argument('--no-think', action='store_true', help='skip the LM plan (faster, the DiT alone)')
ap.add_argument('--lm-backend', default='pt', choices=['pt', 'vllm'])
ap.add_argument('--offload', action='store_true',
                help='keep idle models on the CPU (the LM while the DiT runs and back): for XL + 4B on 24 GB')
ap.add_argument('--name', default='ace')
ap.add_argument('--format', default='wav', choices=['wav', 'flac', 'mp3', 'wav32'])
a = ap.parse_args()

ace = os.path.abspath(a.ace)
sys.path.insert(0, ace)
os.environ.setdefault('HF_HUB_OFFLINE', '1')   # weights are local; never fetch at run time
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

# acestep's LM loader calls from_pretrained without a dtype, so transformers 4.x loads the BF16
# weights as FP32 and casts on the GPU (`.to(device).to(dtype)`): a 4B LM takes ~16 GB there before
# shrinking, which with an XL DiT does not fit 24 GB. Load it as BF16 in the first place.
import torch
import acestep.llm_inference as _li
_Auto = _li.AutoModelForCausalLM
class _AutoBF16:
    @staticmethod
    def from_pretrained(*args, **kw):
        if 'torch_dtype' not in kw and 'dtype' not in kw: kw['torch_dtype'] = torch.bfloat16
        return _Auto.from_pretrained(*args, **kw)
_li.AutoModelForCausalLM = _AutoBF16

read = lambda p: open(p, encoding='utf-8').read().strip()
caption = a.caption if a.caption is not None else read(a.caption_file)
lyrics = a.lyrics if a.lyrics is not None else (read(a.lyrics_file) if a.lyrics_file else '')
instrumental = not lyrics or lyrics.strip() == '[Instrumental]'
if instrumental: lyrics = '[Instrumental]'
seeds = [int(s) for s in a.seeds.split(',')]
os.makedirs(a.out, exist_ok=True)

t0 = time.time()
dit = AceStepHandler()
msg, ok = dit.initialize_service(project_root=ace, config_path=a.dit, device='cuda',
                                 offload_to_cpu=a.offload, offload_dit_to_cpu=a.offload)
if not ok: sys.exit(f'DiT init failed: {msg}')
llm = None
if not a.no_think:
    llm = LLMHandler()
    msg, ok = llm.initialize(checkpoint_dir=os.path.join(ace, 'checkpoints'), lm_model_path=a.lm,
                             backend=a.lm_backend, device='cuda', offload_to_cpu=a.offload)
    if not ok: sys.exit(f'LM init failed: {msg}')
t1 = time.time()

params = GenerationParams(
    caption=caption, lyrics=lyrics, instrumental=instrumental, vocal_language=a.language,
    bpm=a.bpm, keyscale=a.key, timesignature=a.timesig, duration=a.duration,
    inference_steps=a.steps, shift=a.shift, guidance_scale=a.guidance, thinking=not a.no_think,
)
config = GenerationConfig(batch_size=len(seeds), use_random_seed=False, seeds=seeds, audio_format=a.format)
res = generate_music(dit, llm, params, config, save_dir=a.out)
t2 = time.time()
if not res.success: sys.exit(f'generation failed: {res.error}')

ffmpeg = shutil.which('ffmpeg')
files = []
for au, seed in zip(res.audios, seeds):
    seed = au.get('params', {}).get('seed', seed)
    src = au['path']
    dst = os.path.join(a.out, f'{a.name}-seed{seed}{os.path.splitext(src)[1]}')
    os.replace(src, dst)
    f = {'seed': seed, 'path': dst}
    if ffmpeg and not dst.endswith('.mp3'):
        mp3 = os.path.splitext(dst)[0] + '.mp3'
        subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-i', dst, '-b:a', '256k', mp3], check=False)
        f['mp3'] = mp3
    files.append(f)

info = {'caption': caption, 'lyrics': lyrics, 'bpm': a.bpm, 'key': a.key, 'timesig': a.timesig,
        'duration': a.duration, 'dit': a.dit, 'lm': None if a.no_think else a.lm, 'steps': a.steps,
        'shift': a.shift, 'think': not a.no_think, 'offload': a.offload, 'load_s': round(t1 - t0, 1),
        'gen_s': round(t2 - t1, 1), 'files': files}
json.dump(info, open(os.path.join(a.out, 'run.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(info, ensure_ascii=False, indent=1))

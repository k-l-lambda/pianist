#!/bin/bash
# An offline render (tools/render-video.mjs) split over several GPUs, one headless Chrome on each, the
# parts joined and the sound track muxed on (the sound from a quick raster pass of the whole range).
#
#   tools/render-split.sh <script.yaml> --from A --to B [--fps 25] [--devs "3 4 6"] [--out out.mp4]
#        [--work dir] [--no-audio] [-- <render-video.mjs args: --pt 1024 --size 640x360 ...>]
#
# Chrome's EGL picks its GPU itself (CUDA_VISIBLE_DEVICES does not steer it): each worker runs in an
# unprivileged user namespace (unshare -Urm) where every /dev/nvidiaN but its own is bound to an empty
# file, so the driver sees one GPU. --devs: the device nodes' numbers to use (default: all /dev/nvidiaN).
# The frames are split into contiguous parts, one per device (the timeline is the same from any --from:
# src/main.js advanceTo), each its own mp4 in --work; joined without re-encoding (same parameters).
# Env as render-video.mjs (PLAYWRIGHT_CORE, CHROME, __EGL_VENDOR_LIBRARY_FILENAMES, LD_LIBRARY_PATH).
set -euo pipefail
here=$( cd "$( dirname "$0" )/.." && pwd )
script=""; from=""; to=""; fps=25; devs=""; out=""; work=""; audio=1; extra=()
while [ $# -gt 0 ]; do
	case "$1" in
		--from) from=$2; shift 2;; --to) to=$2; shift 2;; --fps) fps=$2; shift 2;;
		--devs) devs=$2; shift 2;; --out) out=$2; shift 2;; --work) work=$2; shift 2;;
		--no-audio) audio=0; shift;; --) shift; extra=( "$@" ); break;;
		-*) echo "unknown argument $1" >&2; exit 2;;
		*) script=$1; shift;;
	esac
done
[ -n "$script" ] && [ -n "$from" ] && [ -n "$to" ] || { echo "usage: $0 <script.yaml> --from A --to B [--fps F] [--devs \"3 4\"] [--out out.mp4] [-- render-video args]" >&2; exit 2; }
[ -n "$devs" ] || devs=$( ls /dev/nvidia[0-9]* | sed 's#/dev/nvidia##' | tr '\n' ' ' )
out=${out:-$( basename "$script" .yaml )-split.mp4}; work=${work:-$( dirname "$out" )/$( basename "$out" .mp4 ).parts}
mkdir -p "$work" "$( dirname "$out" )"; work=$( realpath "$work" ); out=$( realpath -m "$out" )
read -r -a D <<< "$devs"; k=${#D[@]}
n=$( python3 -c "print( round( ( $to - $from ) * $fps ) )" )
[ "$n" -ge "$k" ] || k=$n
# a dev server for all the workers
port=5184; while ( exec 3<>/dev/tcp/127.0.0.1/$port ) 2>/dev/null; do port=$(( port + 1 )); done
( cd "$here" && exec npx vite --port $port --strictPort > "$work/vite.log" 2>&1 ) & vp=$!
trap 'kill $vp 2>/dev/null || true' EXIT
for i in $( seq 120 ); do curl -sf "http://127.0.0.1:$port/" > /dev/null && break; sleep 1; done
url="http://localhost:$port/"
: > /tmp/render-split.empty
echo "$n frames of $script ($from-$to s at $fps fps) on ${k} GPU(s): /dev/nvidia{${D[*]:0:$k}}; vite :$port; parts in $work"
t0=$( date +%s ); pids=(); list="$work/parts.txt"; : > "$list"
for (( i = 0; i < k; ++ i )); do
	f0=$(( n * i / k )); f1=$(( n * ( i + 1 ) / k ))
	a=$( python3 -c "print( $from + $f0 / $fps )" ); b=$( python3 -c "print( $from + $f1 / $fps )" )
	binds=""; for d in /dev/nvidia[0-9]*; do [ "$d" = "/dev/nvidia${D[$i]}" ] || binds="$binds mount --bind /tmp/render-split.empty $d;"; done
	part="$work/part$i.mp4"; echo "file '$( realpath -m "$part" )'" >> "$list"
	( cd "$here" && unshare -Urm sh -c "$binds exec node tools/render-video.mjs '$script' --from $a --to $b --fps $fps --no-audio --out '$part' --url '$url' $( printf "'%s' " "${extra[@]}" )" > "$work/part$i.log" 2>&1 ) &
	pids+=( $! ); echo "  part $i: frames $f0-$(( f1 - 1 )) ($a-$b s) on /dev/nvidia${D[$i]}"
done
fail=0; for p in "${pids[@]}"; do wait "$p" || fail=1; done
for (( i = 0; i < k; ++ i )); do tr '\r' '\n' < "$work/part$i.log" | grep -E "frames \(|rror" | tail -2 | sed "s/^/  part $i: /"; done
[ $fail = 0 ] || { echo "a part failed (logs in $work)" >&2; exit 1; }
video="$work/video.mp4"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -c copy "$video"
if [ $audio = 1 ]; then
	# the sound: a raster pass of the whole range (small, fast: the sound track is the timeline's, not the picture's)
	( cd "$here" && node tools/render-video.mjs "$script" --from "$from" --to "$to" --fps "$fps" --size 320x180 --ss 1 --out "$work/sound.mp4" --url "$url" > "$work/sound.log" 2>&1 )
	ffmpeg -y -loglevel error -i "$video" -i "$work/sound.mp4" -map 0:v -map 1:a -c copy -shortest "$out"
else cp "$video" "$out"; fi
echo "wrote $out in $(( $( date +%s ) - t0 )) s"

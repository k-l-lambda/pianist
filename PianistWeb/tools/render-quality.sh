#!/bin/bash
# The offline render quality comparison (tools/render-quality.py makes the sheets from it): the test script
# (public/scripts/quality-test.yaml, Luminara at night) rendered with the old capture and each of the new
# options, a still window and a fast-pan window each, plus a 32-sub-frame reference.
#   tools/render-quality.sh <out dir> [dev server url, default http://localhost:5187/]
#   python3 tools/render-quality.py <out dir> [sheets dir]
set -e
cd "$( dirname "$0" )/.."
T=${1:?usage: tools/render-quality.sh <out dir> [url]}
URL=${2:-http://localhost:5187/}
mkdir -p $T
run() {
	name=$1; shift
	for win in "still 0.2 0.6" "pan 1.92 2.12"; do
		set -- $win "$@"; w=$1 from=$2 to=$3; shift 3
		rm -rf $T/$name-$w; mkdir -p $T/$name-$w
		echo "== $name $w"
		timeout 900 node tools/render-video.mjs quality-test.yaml --query "style=grand-white&preset=Night" --from $from --to $to --no-audio \
			--url $URL --out $T/$name-$w/clip.mp4 --frames $T/$name-$w "$@" 2>&1 | grep -v "^    at " | grep -E "frames|wrote|rror|warn" | tail -3
	done
}
run1() {
	name=$1; shift
	rm -rf $T/$name-still; mkdir -p $T/$name-still
	echo "== $name still"
	timeout 1800 node tools/render-video.mjs quality-test.yaml --query "style=grand-white&preset=Night" --from 0.2 --to 0.6 --no-audio \
		--url $URL --out $T/$name-still/clip.mp4 --frames $T/$name-still "$@" 2>&1 | grep -v "^    at " | grep -E "frames|wrote|rror|warn" | tail -3
}
run legacy --legacy
run linear --no-dither
run dither
run bits10 --bits 10
run sub8 --subframes 8
run hq --subframes 8 --hq
run1 box --no-dither --filter 0.5
run1 ref --no-dither --filter 0.5 --subframes 32 --shutter 0
echo ALL DONE

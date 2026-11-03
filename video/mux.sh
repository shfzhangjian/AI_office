#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd $ROOT
# 1) 帧 → 无声视频 (10fps → 输出25fps流畅)
ffmpeg -y -v error -framerate 10 -i frames/f%05d.jpg -vf "fps=25,scale=1280:800" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p _video.mp4
# 2) 五段音频按顺序拼 + 静音补齐对齐视频
ffmpeg -y -v error -i audio/intro.mp3 -i audio/feature.mp3 -i audio/board.mp3 -i audio/arch.mp3 -i audio/outro.mp3 -filter_complex "[0][1][2][3][4]concat=n=5:v=0:a=1[a]" -map "[a]" -ar 44100 _audio.m4a
# 3) 合流（以短者为准）
ffmpeg -y -v error -i _video.mp4 -i _audio.m4a -c:v copy -c:a aac -shortest _muxed.mp4
echo MUX_OK $(du -h _muxed.mp4 | cut -f1)

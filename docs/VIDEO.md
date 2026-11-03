# 🎬 演示视频是怎么合成的

`video/像素办公室介绍.mp4`（1280×800，约 100 秒）不是手 K 的，是一条**全自动可复现**的流水线跑出来的。整个目录保留了每一步的脚本，改文案就能重跑。

## 依赖

```bash
pip install edge-tts pillow websockets     # 口播 / 字幕带 / CDP
npm i playwright-core                      # 无头浏览器截帧（chromium）
brew install ffmpeg                        # 合成
```

> 本机坑：ffmpeg **没有** `subtitles` / `ass` / `drawtext` 滤镜（缺 libass/freetype）。
> 所以字幕**不能**走 `ass` 滤镜，改用「PIL 画整屏字幕带 PNG → 每段单独 `overlay` → `concat`」。
> 别再试 `subtitles=` / `drawtext=` / `filter_complex enable` —— 在这类精简 ffmpeg 上会静默失败。

## 五个阶段

| 阶段 | 脚本 | 产物 | 做什么 |
|---|---|---|---|
| ① 口播 | `build_video.py` | `audio/*.mp3` + `durations.json` | edge-tts 分 5 段（intro/feature/board/arch/outro）合成中文男声，取每段时长 |
| ② 截帧 | `record.js`（推荐）或 `cdp_shot.py` | `frames/*.jpg` | 无头浏览器开 `/town`，按状态 + 镜头脚本 10fps 连续截 JPEG |
| ③ 合成无声视频 + 合流 | `mux.sh` | `_muxed.mp4` | 帧 → 25fps 视频；5 段音频 concat；`-shortest` 合流 |
| ④ 烧字幕 | `subs2.py`（推荐）或 `subs.py` | `part_*.mp4` | PIL 按标点断句，逐句画底部字幕带，全片逐段 `overlay` |
| ⑤ 拼接 | （`list.txt` + `ffmpeg concat`） | `像素办公室介绍.mp4` | 各段重编码统一时基后 concat |

## 一行看懂数据流

```
文案(SEG) ─edge-tts→ audio/*.mp3 ─┐
                                   ├─mux.sh→ _muxed.mp4 ─subs2.py→ part_*.mp4 ─concat→ 成片
town.html ──playwright 截帧──→ frames/*.jpg ─┘
   ↑ window.demo(x,y,z) 控制镜头缩放平移 · setSelf(state) 控制猫的动作
```

## 页面留给录屏的钩子

`frontend/town.html` 暴露了两个演示 API（不影响正常使用）：

```js
setSelf('writing', '敲键盘中');   // 立即切换小镇状态 / 猫动作
demo(640, 380, 1.9);              // 镜头平移到 (640,380) 并放大 1.9 倍（缓动跟随）
```

`record.js` 就是靠 `p.evaluate(...)` 在每段之间调这两个函数，做出"镜头推近看猫敲键盘 → 拉远看全景 → 平移看服务器房"的分镜。

## 复现（改成本地端口即可）

```bash
cd video
python3 build_video.py                     # ① 口播 + durations.json
# 先手动起服务： TOWN_DIR=../samples node ../server/town-server.js
node record.js                              # ② 截帧到 frames/
bash mux.sh                                 # ③ → _muxed.mp4
python3 subs2.py                            # ④ → part_*.mp4
# ⑤ ffmpeg -f concat -safe 0 -i list.txt -c copy 成片.mp4
```

脚本里的 `ROOT` 已改成"脚本所在目录"，路径不再写死；口播文案在 `SEGMENTS` / `SEG` 里，改成你自己的词重跑即可。

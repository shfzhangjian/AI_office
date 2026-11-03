#!/usr/bin/env python3
# 生成 SRT 字幕：按段时长把句子均分
import json, os
ROOT=os.path.dirname(os.path.abspath(__file__))
durs=json.load(open(ROOT+'/durations.json'))
SEG=[
 ("intro","大家好，我是这台机器的 AI 打工人。今天我带你参观我的新家，像素办公室。我把自己一整年的工作状态，都做成了这座可视化小镇。你看到的每一处，都是真实数据在驱动。"),
 ("feature","先说功能。看屋子中间，这只敲键盘的橘猫就是我。老板在钉钉给我派活，我这边立刻开工：我写代码、跑任务的时候，猫就在电脑前敲键盘；我调研查资料，它会走到沙发边思考；我闲下来等活，就去床上躺着摸鱼。右上角天气和北京实时同步，现实下雪，办公室里也会飘雪。"),
 ("board","再看右边的仪表盘。这里跑的是我的真实系统数据：大模型心跳、任务队列、十几个后台进程，哪个在线哪个挂了，一目了然。底下这本事件流水账，记录我干的每一件事，什么时候来的、干成什么样，全部留底。"),
 ("arch","那背后的架构是什么？三层。第一层，采集器，每五秒扫一遍我的任务目录、进程表和模型端口，把状态变化写成一条事件流水。第二层，事件总线加快照，所有事件汇成一本账，网页通过实时推送拿到最新状态，不用刷新。第三层，就是你现在看到的渲染层，纯网页画布，把六个工作状态映射成猫的动作。"),
 ("outro","我的原则是：不侵入任何一个正在跑的服务，只做旁路只读采集。挂了随时能拆，账本永远在那。这就是我的工作日常，全透明，欢迎随时来小镇监工。"),
]
def split(txt):
    out=[]; buf=''
    for ch in txt:
        buf+=ch
        if ch in '，。：；！？' and len(buf)>=10: out.append(buf.strip()); buf=''
    if buf.strip(): out.append(buf.strip())
    return out
def ts(t):
    h=int(t//3600);m=int(t%3600//60);s=t%60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int(s%1*1000):03d}"
lines=[]; idx=1; t0=0.3
for seg,text in SEG:
    d=durs[seg]; parts=split(text); per=(d-0.6)/len(parts)
    for i,pt in enumerate(parts):
        st=t0+i*per; en=t0+(i+1)*per-0.05
        lines.append(f"{idx}\n{ts(st)} --> {ts(en)}\n{pt}\n")
        idx+=1
    t0+=d
open(ROOT+'/subs.srt','w').write('\n'.join(lines))
print('srt entries',idx-1)

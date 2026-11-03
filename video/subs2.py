#!/usr/bin/env python3
# 每行字幕→整屏字幕带PNG(1280x140底部带)→34段全片overlay→concat
import json, os, subprocess
from PIL import Image, ImageDraw, ImageFont
ROOT=os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
durs=json.load(open('durations.json'))
SEG=[("intro","大家好，我是这台机器的 AI 打工人。今天我带你参观我的新家，像素办公室。我把自己一整年的工作状态，都做成了这座可视化小镇。你看到的每一处，都是真实数据在驱动。"),
("feature","先说功能。看屋子中间，这只敲键盘的橘猫就是我。老板在钉钉给我派活，我这边立刻开工：我写代码、跑任务的时候，猫就在电脑前敲键盘；我调研查资料，它会走到沙发边思考；我闲下来等活，就去床上躺着摸鱼。右上角天气和北京实时同步，现实下雪，办公室里也会飘雪。"),
("board","再看右边的仪表盘。这里跑的是我的真实系统数据：大模型心跳、任务队列、十几个后台进程，哪个在线哪个挂了，一目了然。底下这本事件流水账，记录我干的每一件事，什么时候来的、干成什么样，全部留底。"),
("arch","那背后的架构是什么？三层。第一层，采集器，每五秒扫一遍我的任务目录、进程表和模型端口，把状态变化写成一条事件流水。第二层，事件总线加快照，所有事件汇成一本账，网页通过实时推送拿到最新状态，不用刷新。第三层，就是现在看到的渲染层，把六个工作状态映射成猫的动作。"),
("outro","我的原则是：不侵入任何一个正在跑的服务，只做旁路只读采集。挂了随时能拆，账本永远在那。这就是我的工作日常，全透明，欢迎随时来小镇监工。")]
FP='/System/Library/Fonts/STHeiti Medium.ttc'
font=ImageFont.truetype(FP,34,index=0)
def split(txt):
    out=[];buf=''
    for ch in txt:
        buf+=ch
        if ch in '，。：；！？' and len(buf)>=10: out.append(buf.strip());buf=''
    if buf.strip(): out.append(buf.strip())
    return out
os.system('mkdir -p band; rm -f band/*.png part_*.mp4')
tasks=[]
for si,(seg,text) in enumerate(SEG):
    d=durs[seg];parts=split(text);per=d/len(parts)
    for i,pt in enumerate(parts):
        st=sum(v for k,v in durs.items() if k in [s for s,_ in SEG[:si]]) + i*per
        en=st+per-0.05
        img=Image.new('RGBA',(1280,110),(0,0,0,0))
        dr=ImageDraw.Draw(img)
        bb=dr.textbbox((0,0),pt,font=font);w=bb[2]-bb[0];x=(1280-w)//2
        dr.text((x+2,38),pt,font=font,fill=(0,0,0,235),stroke_width=4,stroke_fill=(0,0,0,235))
        dr.text((x,36),pt,font=font,fill=(255,255,255,255))
        fn=f'band/b{len(tasks):02d}.png';img.save(fn)
        tasks.append((fn,st,en))
print('bands',len(tasks))
# 每段：stream_loop 视频 + overlay 一次，无 enable
for k,(fn,st,en) in enumerate(tasks):
    cmd=['ffmpeg','-y','-v','error','-stream_loop','400','-i','_muxed.mp4','-loop','1','-framerate','25','-t','1','-i',fn,
         '-filter_complex',f'[0:v]trim=0:{en-st},setpts=PTS-STARTPTS[v];[1:v]scale=1280:110[b];[v][b]overlay=0:H-120[vout]',
         '-map','[vout]','-map','0:a','-ss',f'{st:.2f}','-t',f'{en-st:.2f}','-c:v','libx264','-preset','ultrafast','-crf','24','-c:a','aac','-b:a','96k',f'part_{k:02d}.mp4']
    # -ss 位置错：改输入端 ss
    cmd=['ffmpeg','-y','-v','error','-ss',f'{st:.2f}','-t',f'{en-st:.2f}','-i','_muxed.mp4','-loop','1','-framerate','25','-t','1','-i',fn,
         '-filter_complex',f'[1:v]scale=1280:110[b];[0:v][b]overlay=0:H-120[vout]','-map','[vout]','-map','0:a',
         '-c:v','libx264','-preset','ultrafast','-crf','24','-c:a','aac','-b:a','96k',f'part_{k:02d}.mp4']
    subprocess.run(cmd,check=True)
    print('part',k,flush=True)

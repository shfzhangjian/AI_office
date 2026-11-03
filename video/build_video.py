#!/usr/bin/env python3
# 像素办公室口播视频合成：分段TTS + 浏览器页CDP截图动画 + 字幕烧录 + concat
import asyncio, subprocess, os, json, time, sys
ROOT=os.path.dirname(os.path.abspath(__file__))
AUD=os.path.join(ROOT,'audio'); FR=os.path.join(ROOT,'frames'); PT=os.path.join(ROOT,'parts')
for d in (AUD,FR,PT): os.makedirs(d,exist_ok=True)
VOICE='zh-CN-YunxiNeural'; RATE='+6%'

SEGMENTS=[
 ("intro",  "大家好，我是这台机器的 AI 打工人。今天我带你参观我的新家，像素办公室。我把自己一整年的工作状态，都做成了这座可视化小镇。你看到的每一处，都是真实数据在驱动。"),
 ("feature","先说功能。看屋子中间，这只敲键盘的橘猫就是我。老板在钉钉给我派活，我这边立刻开工：我写代码、跑任务的时候，猫就在电脑前敲键盘；我调研查资料，它会走到沙发边思考；我闲下来等活，就去床上躺着摸鱼。右上角天气和北京实时同步，现实下雪，办公室里也会飘雪。"),
 ("board",  "再看右边的仪表盘。这里跑的是我的真实系统数据：大模型心跳、任务队列、十几个后台进程，哪个在线哪个挂了，一目了然。底下这本事件流水账，记录我干的每一件事，什么时候来的、干成什么样，全部留底。"),
 ("arch",   "那背后的架构是什么？三层。第一层，采集器，每五秒扫一遍我的任务目录、进程表和模型端口，把状态变化写成一条事件流水。第二层，事件总加快照，所有事件汇成一本账，网页通过实时推送拿到最新状态，不用刷新。第三层，就是你现在看到的渲染层，纯网页画布，把六个工作状态映射成猫的动作。"),
 ("outro",  "我的原则是：不侵入任何一个正在跑的服务，只做旁路只读采集。挂了随时能拆，账本永远在那。这就是我的工作日常，全透明，欢迎随时来小镇监工。"),
]

def dur(f):
    out=subprocess.run(['afinfo',f],capture_output=True,text=True).stdout
    for l in out.split('\n'):
        if 'duration' in l: return float(l.split(':')[1].strip().split()[0])
    return 0

def tts(seg,text):
    async def go():
        await asyncio.sleep(0.3)
        await asyncio.wait_for(edge_save(text,os.path.join(AUD,seg+'.mp3')),60)
    import edge_tts
    async def edge_save(t,f):
        await edge_tts.Communicate(t,voice=VOICE,rate=RATE).save(f)
    asyncio.run(go())
    return dur(os.path.join(AUD,seg+'.mp3'))

def cap(txt, n=22):
    return [txt[i:i+n] for i in range(0,len(txt),n)]

def make_sub(seg,d):
    # 用 ffmpeg drawtext 做底部字幕，分句轮换：每条字幕显示 dur 内均分
    lines=cap(seg[1])
    per=max(d/len(lines),1.2)
    filters=[]
    for i,ln in enumerate(lines):
        st=i*per; en=(i+1)*per if i<len(lines)-1 else d
        safe=ln.replace("'","'\\''").replace(':','\\:')
        filters.append(f"drawtext=text='{safe}':fontsize=30:fontcolor=white:borderw=2:bordercolor=black@0.8:x=(w-text_w)/2:y=h-90:enable='between(t,{st:.2f},{en:.2f})'")
    return ','.join(filters)

def ffmpeg_seg(seg,d,vf,part):
    # 视频源：1280x720 纯色底（占位），实际渲染段由调用方给帧视频
    subprocess.run(['ffmpeg','-y','-v','error','-i',os.path.join(AUD,seg+'.mp3'),'-f','lavfi','-i',f'color=c=0x1d1a16:s=1280x720:d={d}:r=30','-c:a','aac','-shortest','-vf',vf,os.path.join(ROOT,f'_a_{seg}.mp4')],check=True)

def main():
    import urllib.request
    durations={}
    for seg,text in SEGMENTS:
        print(f'[tts] {seg}', flush=True)
        durations[seg]=tts(seg,text)
        print('  dur',durations[seg], flush=True)
    total=sum(durations.values())
    print('TOTAL',round(total,1),'s', flush=True)
    json.dump(durations,open(os.path.join(ROOT,'durations.json'),'w'))
    print('NEXT_STAGE=frames', flush=True)

if __name__=='__main__':
    main()

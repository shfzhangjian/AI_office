#!/usr/bin/env python3
# 驱动内置浏览器(Electron CDP 9222)录屏：每段设置状态+镜头，连续截JPEG帧
import asyncio, json, subprocess, os, sys, time, base64
import websockets

ROOT=os.path.dirname(os.path.abspath(__file__))
FR=os.path.join(ROOT,'frames')

async def get_ws():
    import urllib.request
    tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9222/json'))
    page=[t for t in tabs if t['type']=='page' and 'town' in t.get('url','')]
    page=page or [t for t in tabs if t['type']=='page']
    return page[0]['webSocketDebuggerUrl']

async def main():
    durs=json.load(open(os.path.join(ROOT,'durations.json')))
    ws_url=await get_ws()
    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        mid=0
        async def cmd(method, **params):
            nonlocal mid; mid+=1
            await ws.send(json.dumps({'id':mid,'method':method,'params':params}))
            while True:
                r=json.loads(await ws.recv())
                if r.get('id')==mid: return r.get('result',{})
        async def ev(expr):
            r=await cmd('Runtime.evaluate', expression=expr, returnByValue=True)
            return r.get('result',{}).get('value')
        # 开诊断
        await ev('window.__diag=true; 1')
        shots={
          'intro':  "setState('writing','你好，我是小镇打工人'); setDiag(true); setZoom(1.0, 640, 360); setFeed('intro');",
          'feature':"setState('writing','敲键盘中…'); setDiag(true); setZoom(1.0, 640, 360); setFeed('feature');",
          'board':  "setState('writing','看板演示'); setDiag(true); setZoom(1.0, 640, 360); setFeed('board');",
          'arch':   "setState('researching','讲架构'); setDiag(false); setZoom(1.0, 640, 360); setFeed('arch');",
          'outro':  "setState('writing','欢迎来监工'); setDiag(true); setZoom(1.0, 640, 360); setFeed('outro');",
        }
        for seg,d in durs.items():
            print('[rec]',seg,round(d,1),'s',flush=True)
            await ev(shots[seg])
            n=int(d*10)+2
            t0=time.time()
            for i in range(n):
                r=await cmd('Page.captureScreenshot', format='jpeg', quality=58, optimize=True)
                with open(os.path.join(FR,f'{seg}_{i:04d}.jpg'),'wb') as f:
                    f.write(base64.b64decode(r['data']))
                # 维持到 10fps 节拍
                delay=(i+1)/10 - (time.time()-t0)
                if delay>0: await asyncio.sleep(delay)
            print('  frames',n,flush=True)
    print('ALL DONE',flush=True)

asyncio.run(main())

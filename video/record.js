// 像素办公室口播录帧：串行10fps截帧+分段镜头/事件脚本（v2 串行稳态版）
const { chromium } = require('playwright-core');
const fs=require('fs'), path=require('path');
const ROOT=__dirname;
const FR=path.join(ROOT,'frames');
fs.rmSync(FR,{recursive:true,force:true}); fs.mkdirSync(FR,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const durs=JSON.parse(fs.readFileSync(path.join(ROOT,'durations.json')));
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:1280,height:800},locale:'zh-CN'});
  const p=await ctx.newPage();
  const cdp=await ctx.newCDPSession(p);
  await p.goto('http://127.0.0.1:3002/town',{waitUntil:'networkidle',timeout:30000});
  await sleep(2000);
  await p.evaluate("window.__diag=true; setSelf('writing','像素办公室交付'); demo(640,380,1.0);");
  let n=0, dead=false;
  const shotLoop=async(ms,label)=>{
    const end=Date.now()+ms; let last=0;
    while(Date.now()<end && !dead){
      const t=Date.now();
      try{const s=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:60,optimize:true});
        fs.writeFileSync(path.join(FR,`f${String(n++).padStart(5,'0')}.jpg`),Buffer.from(s.data,'base64'));}
      catch(e){console.log('SHOT DEAD at '+label+' n='+n); dead=true; break;}
      const cost=Date.now()-t; await sleep(Math.max(100-cost,5));
    }
  };
  console.log('rec start', new Date().toISOString());
  await shotLoop(durs.intro*1000,'intro'); await p.evaluate("demo(330,420,1.9);");
  await shotLoop(durs.feature*1000,'feature'); await p.evaluate("demo(660,380,1.0);");
  await shotLoop(durs.board*1000,'board'); await p.evaluate("demo(640,380,1.05);");
  for(const st of ['writing','researching','executing','writing','syncing','writing']){
    if(dead)break;
    await p.evaluate(`setSelf('${st}','${st}演示')`).catch(()=>{});
    await shotLoop(4400,'arch:'+st);
  }
  if(!dead){ await p.evaluate("demo(420,400,1.35); setSelf('writing','欢迎随时来小镇监工');"); }
  await shotLoop(durs.outro*1000,'outro');
  console.log('frames='+n);
  await b.close().catch(()=>{});
  fs.writeFileSync(path.join(FR,'done.txt'), String(n));
})().catch(e=>{console.error('FATAL',e.message.split('\n')[0]);process.exit(1);});

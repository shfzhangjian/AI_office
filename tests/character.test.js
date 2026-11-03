const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
test('all work states render the SVG cat without legacy character sheets',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../frontend/town.html'),'utf8');
 assert.ok(!html.includes("loadImg(A+'star-idle"));assert.ok(!html.includes('star-work-clean.png'));
 const calls=[];const ctx=new Proxy({}, {get:(o,k)=>o[k]||((...args)=>{if(k==='drawImage')calls.push(args)})});
 const nodes=new Proxy({}, {get:(o,k)=>o[k]||(o[k]={style:{},getContext:()=>ctx})});
 const context={document:{getElementById:id=>nodes[id]},window:{},Image:class{},fetch:()=>new Promise(()=>{}),setInterval(){},setTimeout(){},requestAnimationFrame(){},console};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 vm.runInContext(`for(const pose of ['idle','blink','typing-left','typing-right'])SPR['cat-'+pose]={pose};
 for(const state of Object.keys(STATE_LABEL)){setSelf(state,'test');drawInner(16);}
 drawOfficeCat(100,200,'writing',false);animFrame=8;drawOfficeCat(100,200,'writing',false);
 let intervals=[];drawInner=dt=>intervals.push(dt);draw(100000);draw(100016);if(intervals.join()!=='0,16')throw Error('frame timing');`,context);
 assert.ok(calls.some(([image])=>image.pose==='typing-left'));assert.ok(calls.some(([image])=>image.pose==='typing-right'));
 for(const pose of ['idle','blink','typing-left','typing-right']){
 const svg=fs.readFileSync(path.join(__dirname,`../frontend/assets/office-cat-${pose}.svg`),'utf8');
 assert.match(svg,/viewBox="0 0 64 64"/);assert.ok(!/<script|<image|href=/.test(svg));
 }
});

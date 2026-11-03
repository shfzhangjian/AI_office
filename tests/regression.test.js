const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {spawn}=require('child_process');
test('collector reports state recovery and preserves sequence after damaged tail',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-test-'));
 try{
 fs.writeFileSync(path.join(dir,'events.jsonl'),JSON.stringify({seq:42,source:'test',subject:'x',status:'up'})+'\n{broken');
 const source=fs.readFileSync(path.join(__dirname,'../collector/collectord.js'),'utf8').split('console.log(`collectord start')[0];
 const context={__dirname:path.join(__dirname,'../collector'),require,process:{env:{TOWN_DIR:dir}},console,setTimeout};vm.createContext(context);vm.runInContext(source,context);
 vm.runInContext("for(const st of ['up','down','up'])ifChanged('hb:test',st,()=>['test','heartbeat','test',st,'','']);writeSnapshot();",context);
 const records=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').split('\n').flatMap(x=>{try{return [JSON.parse(x)]}catch{return []}});
 assert.deepEqual(records.slice(-3).map(x=>x.status),['up','down','up']);assert.equal(records.at(-1).seq,45);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'))).seq,45);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('SSE preserves long UTF-8 events and incomplete appended lines',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-sse-'));const port=19382;
 const record={seq:1,summary:'猫'.repeat(100000)};
 fs.writeFileSync(path.join(dir,'events.jsonl'),JSON.stringify(record)+'\n'+ '{"seq":2');
 const child=spawn(process.execPath,[path.join(__dirname,'../server/town-server.js')],{env:{...process.env,TOWN_DIR:dir,LT_PORT:String(port)},stdio:['ignore','pipe','pipe']});
 const controller=new AbortController();
 try{
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);setTimeout(()=>reject(Error('startup timeout')),5000).unref()});
 const response=await fetch(`http://127.0.0.1:${port}/api/town-events`,{signal:controller.signal});
 const reader=response.body.getReader();let raw='';const decoder=new TextDecoder();
 const timeout=setTimeout(()=>controller.abort(),10000);
 try{
 while(!raw.includes('"seq":2')){
 const {value,done}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});
 if(raw.includes('"seq":1')&&!raw.includes('"seq":2')&&!fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').endsWith('}\n'))fs.appendFileSync(path.join(dir,'events.jsonl'),',"summary":"恢复"}\n');
 }
 const events=raw.split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));
 assert.deepEqual(events.map(x=>x.seq),[1,2]);assert.equal(events[0].summary,record.summary);
 }finally{clearTimeout(timeout)}
 }finally{controller.abort();child.kill();await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true})}
});

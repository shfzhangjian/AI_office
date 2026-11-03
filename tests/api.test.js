const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),{spawn}=require('child_process');
const {validate}=require('../server/ingest');
test('API contract rejects invalid load, missing owners and unsafe numeric values',()=>{for(const e of [{type:'service',subject:'s',status:'up',load:101},{type:'task',subject:'x',status:'running'},{type:'document',subject:'d',agent_id:'a',documents_delta:1.2},{type:'state',subject:'a',status:'cat'}])assert.throws(()=>validate(e));assert.equal(validate({type:'state',subject:'a',status:'thinking'}).agent_id,'a')});
test('HTTP ingestion persists, validates and deduplicates; collector projects reloadable agents',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-api-')),port=19383;
 const child=spawn(process.execPath,[path.join(__dirname,'../server/town-server.js')],{env:{...process.env,TOWN_DIR:dir,LT_PORT:String(port),TOWN_WRITE_TOKEN:'local-test-token'},stdio:['ignore','pipe','pipe']});
 const base='http://127.0.0.1:'+port;
 try{
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);setTimeout(()=>reject(Error('startup timeout')),5000).unref()});
 const send=(data,key,auth=true)=>fetch(base+'/api/town-events',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer local-test-token'}:{}),...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(data)});
 const state={type:'state',subject:'alice',agent_name:'林舟',status:'writing',summary:'处理真实任务',documents_count:4};
 assert.equal((await send(state,'state',false)).status,401);
 assert.equal((await send({...state,status:'invalid'},'invalid')).status,400);
 const first=await send(state,'state');assert.equal(first.status,202);const queued=await first.json();
 assert.equal((await send(state,'state')).status,202);assert.equal((await send({...state,summary:'changed'},'state')).status,409);
 await send({type:'document',subject:'batch',agent_id:'alice',documents_delta:2},'docs');
 await send({type:'service',subject:'llm',status:'up',load:92},'service');
 const source=fs.readFileSync(path.join(__dirname,'../collector/collectord.js'),'utf8').split('console.log(`collectord start')[0];
 const create=()=>{const c={require,process:{env:{TOWN_DIR:dir}},console,setTimeout};vm.createContext(c);vm.runInContext(source,c);return c};
 const c=create();vm.runInContext('drainInbox();writeSnapshot();',c);
 const applied=await(await fetch(base+'/api/town-inbox/'+queued.id)).json();assert.equal(applied.status,'applied');assert.equal(applied.seq,1);
 assert.equal((await send(state,'state')).status,200);
 const snap=await(await fetch(base+'/api/town-snapshot')).json();assert.equal(snap.agents.alice.documents_count,6);assert.equal(snap.agents.alice.name,'林舟');assert.equal(snap.entities['api:llm'].load,92);
 assert.equal((await(await fetch(base+'/api/town-agents')).json()).items.length,1);
 const c2=create();vm.runInContext('drainInbox();writeSnapshot();',c2);const restored=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json')));assert.equal(restored.seq,3);assert.equal(restored.agents.alice.documents_count,6);
 const rows=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n');assert.equal(rows.length,3);
 }finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true})}
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const logs=require('../frontend/assets/message-log'),{validate}=require('../server/ingest');
test('DingTalk input, execution and confirmed response retain original text and session separation',()=>{
 const a={},base={type:'log',agent_id:'worker',provider:'dingtalk',task_id:'t1',conversation_type:'direct',conversation_id:'c1'};
 for(const [i,phase]of ['received','execution','reply'].entries())logs.append(a,{...base,seq:i+1,ts:'2026-11-03T05:04:05Z',message_phase:phase,content:['请生成报告\n保留原始格式','正在检查资料','报告已完成'][i],delivery_status:phase==='reply'?'sent':undefined});
 logs.append(a,{...base,seq:4,conversation_id:'c2',message_phase:'received',content:'另一会话'});
 const groups=logs.groups(a);assert.equal(groups.length,2);const first=groups.find(g=>g.conversation_id==='c1');assert.deepEqual(first.messages.map(m=>m.phase),['received','execution','reply']);assert.equal(first.messages[0].content,'请生成报告\n保留原始格式');assert.equal(first.messages[2].delivery_status,'sent');
 logs.append(a,{...base,seq:1,content:'duplicate'});assert.equal(a.messages.length,4);
});
test('original received request survives trimming of long execution logs',()=>{const a={};logs.append(a,{type:'log',seq:1,task_id:'t',conversation_id:'c',message_phase:'received',content:'原始消息'});for(let i=2;i<250;i++)logs.append(a,{type:'log',seq:i,task_id:'t',conversation_id:'c',content:'执行日志'+i});assert.equal(a.messages.length,200);assert.equal(logs.groups(a)[0].messages[0].content,'原始消息')});
test('explicit phases require correlation and actual reply delivery result',()=>{const base={type:'log',subject:'line-1',agent_id:'worker',task_id:'task-1',conversation_type:'direct',conversation_id:'c1',content:'消息',message_phase:'received'};assert.equal(validate(base).content,'消息');assert.throws(()=>validate({...base,task_id:undefined}));assert.throws(()=>validate({...base,message_phase:'reply'}));assert.equal(validate({...base,message_phase:'reply',delivery_status:'sent'}).delivery_status,'sent')});
test('collector restores original messages, execution and delivered response after restart',()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-chat-'));
 try{const source=fs.readFileSync(path.join(__dirname,'../collector/collectord.js'),'utf8').split('console.log(`collectord start')[0];const create=()=>{const c={__dirname:path.join(__dirname,'../collector'),require,process:{env:{TOWN_DIR:dir}},console,setTimeout};vm.createContext(c);vm.runInContext(source,c);return c};const c=create();
 vm.runInContext(`for(const [i,phase]of ['received','execution','reply'].entries())emit('dingtalk','log','message-'+i,'','summary','',{agent_id:'worker',task_id:'task',conversation_id:'conversation',conversation_type:'direct',message_phase:phase,content:['原始任务','开始执行','反馈结果'][i],...(phase==='reply'?{delivery_status:'sent'}:{})});writeSnapshot();`,c);
 const restored=create();vm.runInContext('writeSnapshot()',restored);const snap=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json')));assert.deepEqual(snap.agents.worker.messages.map(m=>m.content),['原始任务','开始执行','反馈结果']);assert.equal(snap.agents.worker.requests[0].content,'原始任务');assert.equal(snap.agents.worker.messages[2].delivery_status,'sent');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

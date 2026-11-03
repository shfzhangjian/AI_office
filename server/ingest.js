'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const STATES=new Set(['idle','writing','receiving','replying','researching','executing','syncing','error','thinking','anxious','blocked','done']);
const TYPES=new Set(['state','task','document','log','service','schedule','agent','model']);
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected a JSON object');
 if(!TYPES.has(input.type))throw Error('type must be state, task, document, log, service, schedule, agent or model');
 const out={type:input.type,source:'api'};
 for(const [key,max] of Object.entries({subject:100,agent_id:100,agent_name:80,status:40,summary:2000,detail:4000,run_id:100,job_name:160,scheduler:80,scheduled_for:40,started_at:40,finished_at:40,timezone:80,provider:40,tenant_id:150,app_id:150,robot_code:150,conversation_type:20,conversation_id:200,external_subject:200,executor_id:100,message_phase:20,content:8000,task_id:100,message_id:200,delivery_status:20,model_name:120,model_status:20,session_id:200})){
  if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>max||/[\u0000-\u0008]/.test(input[key]))throw Error('Invalid '+key);out[key]=input[key];}
 }
 if(!out.subject||!out.subject.trim())throw Error('subject is required');
 if(out.message_phase!==undefined){if(!['received','execution','reply'].includes(out.message_phase))throw Error('Invalid message_phase');if(!out.task_id||!out.conversation_id||!out.conversation_type||!out.content)throw Error('message_phase requires task_id, conversation_id, conversation_type and content');if(!['direct','group'].includes(out.conversation_type))throw Error('Invalid conversation_type');if(out.message_phase==='reply'&&!['sent','failed'].includes(out.delivery_status))throw Error('reply requires delivery_status sent or failed');if(!['log','task'].includes(out.type))throw Error('message_phase requires log or task event');}
 if(input.type==='agent'){if(out.status!=='registered'||!out.agent_name)throw Error('agent registration requires registered status and agent_name');out.agent_id=out.subject;}
 if(input.type==='state'){if(!STATES.has(out.status))throw Error('Invalid agent status');out.agent_id=out.subject;}
 if(input.type==='task'){if(!out.agent_id)throw Error('task requires agent_id');if(!['queued','pending','running','done','failed','timeout','archived'].includes(out.status))throw Error('Invalid task status');}
 if(['document','log'].includes(input.type)&&!out.agent_id)throw Error('document/log requires agent_id');
 if(out.model_status!==undefined&&!['idle','thinking','generating','error','offline'].includes(out.model_status))throw Error('Invalid model_status');
 if(input.type==='model'&&(!out.session_id?.trim()||!out.model_name?.trim()||!out.model_status))throw Error('model requires session_id, model_name and model_status');
 if(input.type==='service'&&!['up','down','unknown'].includes(out.status))throw Error('Invalid service status');
 for(const [key,min,max,integer] of [['progress',0,100,false],['load',0,100,false],['documents_count',0,12,true],['documents_delta',-12,12,true]]){
  if(input[key]!==undefined){const n=input[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('Invalid '+key);out[key]=n;}
 }
 if(input.type==='schedule'){
  if(!out.run_id||!out.run_id.trim())throw Error('schedule requires run_id');
  if(!['triggered','running','done','failed','missed'].includes(out.status))throw Error('Invalid schedule status');
  for(const field of ['scheduled_for','started_at','finished_at'])if(out[field]!==undefined&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(out[field])||!Number.isFinite(Date.parse(out[field]))))throw Error(field+' must be an ISO timestamp with timezone');
  if(out.timezone!==undefined){try{new Intl.DateTimeFormat('en',{timeZone:out.timezone})}catch{throw Error('Invalid timezone')}}
 }
 if(out.documents_count!==undefined&&out.documents_delta!==undefined)throw Error('Send documents_count or documents_delta, not both');
 if(input.type==='document'&&out.documents_count===undefined&&out.documents_delta===undefined)throw Error('document requires documents_count or documents_delta');
 return out;
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function createIngest(dir){
 const pending=path.join(dir,'inbox','pending'),processed=path.join(dir,'inbox','processed');
 return async function handle(req,res,url){
  if(['/api/town-events','/api/town-dingtalk/events'].includes(url.pathname)&&req.method==='POST'){
   const token=process.env.TOWN_WRITE_TOKEN;
   if(token ? req.headers.authorization!=='Bearer '+token : !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){json(res,401,{error:'Write authentication required'});return true;}
   // Cross-origin browser writes are not accepted, even when running on loopback.
   if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin).host}catch{}if(origin!==req.headers.host){json(res,403,{error:'Cross-origin writes are disabled'});return true;}}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'Content-Type must be application/json'});return true;}
   try{
    let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384){json(res,413,{error:'Request exceeds 16 KiB'});return true;}chunks.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{json(res,400,{error:'Invalid JSON'});return true;}
    let event;try{if(url.pathname==='/api/town-dingtalk/events'){const identity=require('../lib/identity');body=identity.normalizeDingTalk(body,identity.loadRoster(dir));}event=validate(body);if(url.pathname==='/api/town-dingtalk/events')event.source='dingtalk';}catch(e){json(res,400,{error:e.message});return true;}
    let key=req.headers['idempotency-key'];if(key&&url.pathname==='/api/town-dingtalk/events')key=crypto.createHash('sha256').update(JSON.stringify([event.tenant_id,event.app_id,event.robot_code,key])).digest('hex');if(key!==undefined&&(typeof key!=='string'||key.length<1||key.length>200)){json(res,400,{error:'Invalid Idempotency-Key'});return true;}
    const id=key?crypto.createHash('sha256').update(key).digest('hex'):crypto.randomUUID();
    fs.mkdirSync(pending,{recursive:true});fs.mkdirSync(processed,{recursive:true});
    const file=path.join(pending,id+'.json'),receipt=path.join(processed,id+'.json');
    const old=[receipt,file].find(f=>fs.existsSync(f));
    if(old){const existing=JSON.parse(fs.readFileSync(old,'utf8'));if(JSON.stringify(existing.event)!==JSON.stringify(event)){json(res,409,{error:'Idempotency-Key already used with different data'});return true;}json(res,existing.seq?200:202,{id,status:existing.seq?'applied':'queued',seq:existing.seq||null});return true;}
    const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify({id,received_at:new Date().toISOString(),order:process.hrtime.bigint().toString(),event}));fs.renameSync(tmp,file);
    json(res,202,{id,status:'queued',status_url:'/api/town-inbox/'+id});
   }catch(e){console.error('ingest:',e.message);if(!res.headersSent)json(res,503,{error:'Unable to persist event'});}
   return true;
  }
  const match=url.pathname.match(/^\/api\/town-inbox\/([a-f0-9-]{36,64})$/);
  if(match&&req.method==='GET'){
   for(const [folder,status] of [[processed,'applied'],[pending,'queued']]){try{const item=JSON.parse(fs.readFileSync(path.join(folder,match[1]+'.json'),'utf8'));json(res,200,{id:item.id,status,seq:item.seq||null});return true;}catch(e){if(e.code!=='ENOENT'){json(res,503,{error:'Receipt unavailable'});return true;}}}
   json(res,404,{error:'Event not found'});return true;
  }
  return false;
 };
}
module.exports={validate,createIngest};

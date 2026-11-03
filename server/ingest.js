'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const STATES=new Set(['idle','writing','receiving','replying','researching','executing','syncing','error','thinking','anxious','blocked','done']);
const TYPES=new Set(['state','task','document','log','service']);
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected a JSON object');
 if(!TYPES.has(input.type))throw Error('type must be state, task, document, log or service');
 const out={type:input.type,source:'api'};
 for(const [key,max] of Object.entries({subject:100,agent_id:100,agent_name:80,status:40,summary:2000,detail:4000})){
  if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>max||/[\u0000-\u0008]/.test(input[key]))throw Error('Invalid '+key);out[key]=input[key];}
 }
 if(!out.subject||!out.subject.trim())throw Error('subject is required');
 if(input.type==='state'){if(!STATES.has(out.status))throw Error('Invalid agent status');out.agent_id=out.subject;}
 if(input.type==='task'){if(!out.agent_id)throw Error('task requires agent_id');if(!['queued','pending','running','done','failed','timeout','archived'].includes(out.status))throw Error('Invalid task status');}
 if(['document','log'].includes(input.type)&&!out.agent_id)throw Error('document/log requires agent_id');
 if(input.type==='service'&&!['up','down','unknown'].includes(out.status))throw Error('Invalid service status');
 for(const [key,min,max,integer] of [['progress',0,100,false],['load',0,100,false],['documents_count',0,12,true],['documents_delta',-12,12,true]]){
  if(input[key]!==undefined){const n=input[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('Invalid '+key);out[key]=n;}
 }
 if(out.documents_count!==undefined&&out.documents_delta!==undefined)throw Error('Send documents_count or documents_delta, not both');
 if(input.type==='document'&&out.documents_count===undefined&&out.documents_delta===undefined)throw Error('document requires documents_count or documents_delta');
 return out;
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function createIngest(dir){
 const pending=path.join(dir,'inbox','pending'),processed=path.join(dir,'inbox','processed');
 return async function handle(req,res,url){
  if(url.pathname==='/api/town-events'&&req.method==='POST'){
   const token=process.env.TOWN_WRITE_TOKEN;
   if(token ? req.headers.authorization!=='Bearer '+token : !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){json(res,401,{error:'Write authentication required'});return true;}
   // Cross-origin browser writes are not accepted, even when running on loopback.
   if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin).host}catch{}if(origin!==req.headers.host){json(res,403,{error:'Cross-origin writes are disabled'});return true;}}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{error:'Content-Type must be application/json'});return true;}
   try{
    let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384){json(res,413,{error:'Request exceeds 16 KiB'});return true;}chunks.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{json(res,400,{error:'Invalid JSON'});return true;}
    let event;try{event=validate(body)}catch(e){json(res,400,{error:e.message});return true;}
    const key=req.headers['idempotency-key'];if(key!==undefined&&(typeof key!=='string'||key.length<1||key.length>200)){json(res,400,{error:'Invalid Idempotency-Key'});return true;}
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

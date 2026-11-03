'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function rosterPath(dir){return process.env.TOWN_ROSTER||path.join(dir,'roster.json')}
function loadRoster(dir){
 const file=rosterPath(dir);let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code==='ENOENT')return {agents:[],bots:[]};throw Error('Unable to load roster: '+e.message)}
 if(!Array.isArray(value.agents)||!Array.isArray(value.bots))throw Error('roster requires agents and bots arrays');
 const ids=new Set(),bindings=new Set();
 for(const a of value.agents){if(!a||!/^[-a-zA-Z0-9_:.]{1,80}$/.test(a.id)||typeof a.name!=='string'||!a.name||a.name.length>80||ids.has(a.id))throw Error('Invalid or duplicate roster agent');ids.add(a.id)}
 for(const b of value.bots){if(!b||!ids.has(b.agent_id)||['tenant_id','app_id','robot_code'].some(k=>typeof b[k]!=='string'||!b[k]||b[k].length>150))throw Error('Invalid bot binding');const key=JSON.stringify([b.tenant_id,b.app_id,b.robot_code]);if(bindings.has(key))throw Error('Ambiguous bot binding');bindings.add(key)}
 return value;
}
function resolveIdentity(input,roster,{strict=false,fallback='me'}={}){
 const hasBot=['tenant_id','app_id','robot_code'].some(k=>input[k]);
 if(hasBot){const b=roster.bots.find(b=>b.tenant_id===input.tenant_id&&b.app_id===input.app_id&&b.robot_code===input.robot_code);if(!b)throw Error('Unregistered DingTalk bot identity');if(input.agent_id&&input.agent_id!==b.agent_id)throw Error('agent_id conflicts with bot binding');const a=roster.agents.find(a=>a.id===b.agent_id);return {id:a.id,name:a.name}}
 if(strict)throw Error('tenant_id, app_id and robot_code are required');
 const id=input.agent_id||fallback;if(!id)throw Error('Missing agent_id: configure an explicit role or TOWN_DEFAULT_AGENT_ID');const a=roster.agents.find(a=>a.id===id);return {id,name:a?.name||input.agent_name||id};
}
function normalizeDingTalk(body,roster){
 if(!body||typeof body!=='object'||!body.event||typeof body.event!=='object')throw Error('Expected trusted bridge envelope with event');
 const actor=resolveIdentity({...body,agent_id:body.event.agent_id},roster,{strict:true});
 if(!['direct','group'].includes(body.conversation_type)||typeof body.conversation_id!=='string'||!body.conversation_id||body.conversation_id.length>200)throw Error('conversation_type and conversation_id are required');
 const e=body.event;if(!['state','task','document','log','schedule'].includes(e.type))throw Error('Unsupported DingTalk bridge event type');
 const external=e.subject;if(e.type!=='state'&&(typeof external!=='string'||!external))throw Error('event.subject is required');
 if(e.type==='state'&&e.subject&&e.subject!==actor.id)throw Error('State subject must match bound agent_id');
 const subject=e.type==='state'?actor.id:'dt:'+crypto.createHash('sha256').update(JSON.stringify([actor.id,body.conversation_type,body.conversation_id,e.type,external])).digest('hex').slice(0,48);
 if(e.task_id!==undefined&&(typeof e.task_id!=='string'||!e.task_id||e.task_id.length>200))throw Error('Invalid task_id');
 const task_id=e.task_id?'dt-task:'+crypto.createHash('sha256').update(JSON.stringify([actor.id,body.conversation_type,body.conversation_id,e.task_id])).digest('hex').slice(0,48):undefined;
 return {...e,...(task_id?{task_id}:{}),subject,agent_id:actor.id,agent_name:actor.name,provider:'dingtalk',tenant_id:body.tenant_id,app_id:body.app_id,robot_code:body.robot_code,conversation_type:body.conversation_type,conversation_id:body.conversation_id,external_subject:external||actor.id};
}
module.exports={loadRoster,resolveIdentity,normalizeDingTalk};

'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OfficeLogs=factory();})(globalThis,function(){
 function append(agent,event){
  if(!['task','log','document'].includes(event.type))return;
  const content=event.content||event.detail||event.summary;if(!content)return;
  const seq=Number.isSafeInteger(event.seq)?event.seq:null;
  agent.messages=agent.messages||[];if(seq!==null&&agent.messages.some(m=>m.seq===seq))return;
  const message={seq,ts:event.ts||null,phase:event.message_phase||'execution',content:String(content),status:event.status||'',task_id:event.task_id||(event.type==='task'?event.subject:null),conversation_id:event.conversation_id||null,conversation_type:event.conversation_type||null,provider:event.provider||null,delivery_status:event.delivery_status||null};
  if(message.phase==='received'){agent.requests=agent.requests||[];agent.requests.push(message);if(agent.requests.length>20)agent.requests.shift();}
  agent.messages.push(message);if(agent.messages.length>200)agent.messages.splice(0,agent.messages.length-200);
 }
 function groups(agent){
  const recent=agent.messages||[],kept=(agent.requests||[]).filter(m=>!recent.some(n=>n.seq===m.seq&&n.ts===m.ts&&n.content===m.content));const grouped=new Map();for(const m of [...kept,...recent]){const key=JSON.stringify([m.provider,m.conversation_type,m.conversation_id,m.task_id]);let group=grouped.get(key);if(!group){group={conversation_id:m.conversation_id,conversation_type:m.conversation_type,task_id:m.task_id,messages:[]};grouped.set(key,group);}group.messages.push(m);}
  return [...grouped.values()].reverse();
 }
 return {append,groups};
});

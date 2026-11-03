#!/usr/bin/env node
'use strict';
const {spawn}=require('child_process'),{randomUUID,createHash}=require('crypto');
const {validate}=require('../server/ingest');
async function main(){
 const args=process.argv.slice(2),split=args.indexOf('--');
 if(split<0||!args[split+1])throw Error('Usage: node collector/run-scheduled.js --job-id ID [--name NAME] [--agent-id ID] [--scheduler NAME] [--scheduled-for ISO] -- command args');
 const options={};for(let i=0;i<split;i+=2){if(!['--job-id','--name','--agent-id','--scheduler','--scheduled-for'].includes(args[i])||!args[i+1]||i+1>=split)throw Error('Invalid option '+args[i]);options[args[i]]=args[i+1];}
 const job=options['--job-id'];if(!job)throw Error('--job-id is required');
 const run=process.env.TOWN_RUN_ID||randomUUID(),started=new Date().toISOString();
 const base={type:'schedule',subject:job,run_id:run,job_name:options['--name']||job,scheduler:options['--scheduler']||'external',scheduled_for:options['--scheduled-for']||started,timezone:process.env.TOWN_TIMEZONE||'Asia/Shanghai',...(options['--agent-id']?{agent_id:options['--agent-id']}:{})};
 validate({...base,status:'triggered'});
 const url=(process.env.TOWN_URL||'http://127.0.0.1:3002').replace(/\/$/,'');
 async function report(event,phase){
  for(let attempt=0;attempt<2;attempt++){
   try{const headers={'Content-Type':'application/json','Idempotency-Key':`schedule:${run}:${phase}`};if(process.env.TOWN_WRITE_TOKEN)headers.Authorization='Bearer '+process.env.TOWN_WRITE_TOKEN;
    const response=await fetch(url+'/api/town-events',{method:'POST',headers,body:JSON.stringify(event),signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('HTTP '+response.status);return;
   }catch(e){if(attempt===1)console.error(`[office] ${phase} notification failed: ${e.message}`);}
  }
 }
 await report({...base,status:'triggered',summary:'定时任务已触发'},'triggered');
 const command=args[split+1],commandArgs=args.slice(split+2),startedAt=new Date().toISOString();
 const child=spawn(command,commandArgs,{stdio:'inherit',shell:false});
 const outcome=new Promise(resolve=>{child.once('error',error=>resolve({code:1,error:error.message}));child.once('exit',(code,signal)=>resolve({code:code===null?1:code,signal}));});
 const terminate=signal=>{child.kill(signal)};process.once('SIGINT',()=>terminate('SIGINT'));process.once('SIGTERM',()=>terminate('SIGTERM'));
 await report({...base,status:'running',started_at:startedAt,summary:'定时任务正在运行'},'running');
 const taskSubject='scheduled-'+createHash('sha256').update(run).digest('hex').slice(0,40);
 if(base.agent_id)await report({type:'task',subject:taskSubject,agent_id:base.agent_id,status:'running',summary:base.job_name},'task-running');
 const result=await outcome,finished=new Date().toISOString(),status=result.code===0?'done':'failed';
 await report({...base,status,started_at:startedAt,finished_at:finished,summary:status==='done'?'定时任务已完成':'定时任务执行失败',detail:result.error||`exit_code=${result.code}${result.signal?' signal='+result.signal:''}`},status);
 if(base.agent_id)await report({type:'task',subject:taskSubject,agent_id:base.agent_id,status,summary:base.job_name,...(status==='done'?{progress:100}:{})},'task-'+status);
 process.exitCode=result.code;
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

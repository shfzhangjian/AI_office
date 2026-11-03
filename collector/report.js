#!/usr/bin/env node
// Usage: node collector/report.js path/to/event.json (or pipe JSON to stdin).
const fs=require('fs');
async function main(){
 const event=JSON.parse(fs.readFileSync(process.argv[2]||0,'utf8'));
 const url=(process.env.TOWN_URL||'http://127.0.0.1:3002').replace(/\/$/,'');
 const headers={'Content-Type':'application/json'};
 if(process.env.TOWN_WRITE_TOKEN)headers.Authorization='Bearer '+process.env.TOWN_WRITE_TOKEN;
 if(process.env.TOWN_EVENT_KEY)headers['Idempotency-Key']=process.env.TOWN_EVENT_KEY;
 const response=await fetch(url+'/api/town-events',{method:'POST',headers,body:JSON.stringify(event),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'HTTP '+response.status);console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});

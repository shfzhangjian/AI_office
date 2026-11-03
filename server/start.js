#!/usr/bin/env node
// Start one collector and one web server, sharing the same TOWN_DIR.
const {spawn}=require('child_process'),path=require('path');
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();setTimeout(()=>process.exit(code),200).unref();}
for(const file of ['../collector/collectord.js','town-server.js']){
 const child=spawn(process.execPath,[path.join(__dirname,file)],{env:process.env,stdio:'inherit'});children.push(child);
 child.on('error',e=>{console.error(e.message);stop(1)});child.on('exit',code=>{if(!stopping)stop(code||1)});
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());

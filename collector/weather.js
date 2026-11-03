#!/usr/bin/env node
// Run periodically: node collector/weather.js (Node >=18).
const fs = require('fs');
const path = require('path');
const dir = process.env.TOWN_DIR || path.join(require('os').homedir(), 'ai-office-town');
async function update() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({latitude:process.env.TOWN_LAT||'39.9042',longitude:process.env.TOWN_LON||'116.4074',current:'temperature_2m,weather_code',timezone:process.env.TZ_NAME||'Asia/Shanghai'});
  const response = await fetch(url, {signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Weather HTTP '+response.status);
  const data = await response.json();
  if(!data.current) throw Error('Missing weather data');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'weather.json.tmp'),JSON.stringify(data));
  fs.renameSync(path.join(dir,'weather.json.tmp'),path.join(dir,'weather.json'));
}
update().catch(e=>{console.error(e.message);process.exitCode=1;});

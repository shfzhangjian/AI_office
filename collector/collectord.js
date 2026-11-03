#!/usr/bin/env node
// collectord — 像素办公室事件采集器（只读旁路，零侵入）
// 每 5s 采样：后台任务态 / pm2 进程态 / 心跳端口 / 守护日志 / cloudflared 隧道
// 状态【变化才】写一条事件到 <TOWN_DIR>/events.jsonl；全量快照写 <TOWN_DIR>/snapshot.json
// 通常 pm2 常驻。可用环境变量见 README（DTASK_DIR / HB_PORTS / GUARD_LOG / TUNNEL_LOG / COLLECTOR_INTERVAL_MS …）
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { execSync } = require('child_process');

const HOME = os.homedir();
// 小镇数据目录（事件流水 / 快照 / 自报状态 / 天气缓存都在这），默认 ~/ai-office-town
const TOWN = process.env.TOWN_DIR || path.join(HOME, 'ai-office-town');
const EVENTS = path.join(TOWN, 'events.jsonl');
const SNAPSHOT = path.join(TOWN, 'snapshot.json');
const INTERVAL = parseInt(process.env.COLLECTOR_INTERVAL_MS || '5000', 10);

// —— 采集源路径（可用环境变量覆盖，缺失的源会自动跳过，不报错）——
// DTASK 任务目录：每个子目录含 meta.json(+done.json) 视为一个后台任务
const DTASK = process.env.DTASK_DIR || path.join(HOME, '.ai-office/dtask/tasks');
// 进程守护日志（可选，用于捕捉 restart/恢复 事件）
const GUARD_LOG = process.env.GUARD_LOG || path.join(HOME, '.ai-office/guard.log');
// cloudflared quick-tunnel 日志（可选，用于捕捉外网域名变化事件）
const TUNNEL_LOG = process.env.TUNNEL_LOG || '/tmp/town-tunnel.log';

fs.mkdirSync(TOWN, { recursive: true });

let seq = 0;
const history = [];
const entities = {};
const agentRecords = Object.create(null);
const appliedInbox = new Map();
const scheduleRuns = new Map();
try {
  for (const line of fs.readFileSync(EVENTS, 'utf8').split('\n')) {
    try { const e = JSON.parse(line); if (!Number.isSafeInteger(e.seq) || e.seq <= 0) continue; seq = Math.max(seq, e.seq); history.push(e); entities[`${e.source}:${e.subject}`] = e; projectAgent(e); if(e.event_id)appliedInbox.set(e.event_id,e.seq); } catch {}
  }
  // Separate a crash-truncated tail from the next complete record.
  const raw = fs.readFileSync(EVENTS);
  if (raw.length && raw[raw.length-1] !== 10) fs.appendFileSync(EVENTS, '\n');
} catch (e) { if (e.code !== 'ENOENT') throw e; }
const emit = (source, type, subject, status, summary, link, extra = {}) => {
  const ev = { ...extra, seq: seq + 1, ts: new Date().toISOString(), source, type, subject, status, summary: summary || '', link: link || '' };
  fs.appendFileSync(EVENTS, JSON.stringify(ev) + '\n');
  seq = ev.seq;
  projectAgent(ev);if(ev.event_id)appliedInbox.set(ev.event_id,ev.seq);
  history.push(ev); if (history.length > 100) history.shift();
  entities[`${source}:${subject}`] = ev;
  return ev;
};

// Rebuild complete per-agent projections from the durable ledger, including documents.
function projectAgent(e){
 if(e.type==='schedule'){
  const previous=scheduleRuns.get(e.run_id);if(!previous||!['done','failed','missed'].includes(previous.status)||['done','failed','missed'].includes(e.status)){
   scheduleRuns.set(e.run_id,{...previous,...e,triggered_at:previous?.triggered_at||(e.status==='triggered'?e.ts:null)});
   if(scheduleRuns.size>100)scheduleRuns.delete(scheduleRuns.keys().next().value);
  }return;
 }

 if(!['state','task','document','log'].includes(e.type))return;
 const id=String(e.agent_id||(e.type==='state'?e.subject:'me'));
 const a=agentRecords[id]||(agentRecords[id]={id,name:e.agent_name||id,state:'idle',task:'',detail:'',progress:null,documents_count:0,pending_tasks:Object.create(null),history:[],seq:0});
 if(e.agent_name)a.name=e.agent_name;
 if(['state','task'].includes(e.type)){a.state=e.status==='running'?'executing':e.status==='failed'?'error':e.status;if(e.summary)a.task=e.summary;a.detail=e.detail||e.summary||'';a.progress=Number.isFinite(e.progress)?e.progress:null;}
 let delta=0;
 if(Number.isFinite(e.documents_count))a.documents_count=e.documents_count;
 else if(Number.isFinite(e.documents_delta))delta=e.documents_delta;
 else if(e.type==='task'){const pending=['running','queued','pending','receiving'].includes(e.status),old=a.pending_tasks[e.subject];if(pending&&!old){a.pending_tasks[e.subject]=true;delta=2;}else if(!pending&&old){delete a.pending_tasks[e.subject];delta=-2;}}
 else delta=['done','archived','idle'].includes(e.status)?-1:['writing','executing','researching','receiving','replying','running'].includes(e.status)?1:0;
 a.documents_count=Math.max(0,Math.min(12,a.documents_count+delta));a.seq=e.seq;a.updated_at=e.ts;
 a.history.push({ts:e.ts,summary:e.detail||e.summary||e.status||'资料更新'});if(a.history.length>6)a.history.shift();
}
function drainInbox(){
 const pending=path.join(TOWN,'inbox','pending'),processed=path.join(TOWN,'inbox','processed');let files;
 try{files=fs.readdirSync(pending).filter(f=>/^[a-f0-9-]{36,64}\.json$/.test(f));}catch(e){if(e.code==='ENOENT')return;throw e;}
 const items=files.map(file=>({file,item:JSON.parse(fs.readFileSync(path.join(pending,file),'utf8'))})).sort((a,b)=>a.item.received_at.localeCompare(b.item.received_at)||(BigInt(a.item.order||0)<BigInt(b.item.order||0)?-1:1));
 for(const {file,item}of items){
  const e=item.event;let eventSeq=appliedInbox.get(item.id);
  if(!eventSeq){const emitted=emit(e.source,e.type,e.subject,e.status||'',e.summary||'', '',{...e,event_id:item.id});eventSeq=emitted.seq;}
  fs.mkdirSync(processed,{recursive:true});const target=path.join(processed,file);fs.writeFileSync(target+'.tmp',JSON.stringify({...item,seq:eventSeq}));fs.renameSync(target+'.tmp',target);fs.unlinkSync(path.join(pending,file));
 }
}

// —— 工具 ——
const readJsonSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const lastLineMatching = (file, re) => {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return lines[i];
  } catch {}
  return null;
};
const tcpProbe = (port, host, timeout) => new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: timeout || 1200 });
  const done = (v) => { s.destroy(); resolve(v); };
  s.once('connect', () => done(true));
  s.once('timeout', () => done(false));
  s.once('error', () => done(false));
});

// —— 状态记忆（只在变化时 emit）——
const last = {}; // key -> signature
function ifChanged(key, sig, makeEvent) {
  if (last[key] === sig) return null;
  const first = last[key] === undefined;
  if (first && key.startsWith('skipfirst:')) return null; // 首轮静默基线
  const event = emit(...makeEvent());
  last[key] = sig;
  return event;
}

// —— 状态归一（抄 Star-Office-UI normalize_agent_state）——
const VALID_STATES = new Set(['idle', 'writing', 'receiving', 'replying', 'researching', 'executing', 'syncing', 'error','thinking','anxious','blocked','done']);
function normalizeState(s) {
  if (!s) return 'idle';
  s = String(s).toLowerCase().trim();
  if (['working', 'busy', 'write'].includes(s)) return 'writing';
  if (['run', 'running', 'execute', 'exec'].includes(s)) return 'executing';
  if (s === 'sync') return 'syncing';
  if (['research', 'search'].includes(s)) return 'researching';
  if (VALID_STATES.has(s)) return s;
  return 'idle';
}

// —— 自报状态文件（Star Office 协议：<TOWN_DIR>/state.json，由 town_state.sh 写入）——
const SELF_STATE_FILE = path.join(TOWN, 'state.json');
const STALE_TTL_MS = 10 * 60 * 1000; // 10min 不更新自动回 idle（防"假工作中"）
function sampleSelfState() {
  const st = readJsonSafe(SELF_STATE_FILE);
  if (!st) return;
  let state = normalizeState(st.state);
  const updated = Date.parse(st.updated_at || '');
  const stale = !Number.isFinite(updated) || (Date.now() - updated) > STALE_TTL_MS;
  const working = ['writing', 'receiving', 'replying', 'researching', 'executing', 'syncing'].includes(state);
  if (stale && working) state = 'idle';
  ifChanged('self:me', JSON.stringify([state, st.detail||'',st.agent_name,st.progress,st.documents_count]), () => ['self', 'state', 'me', state, st.detail || '', '', {agent_id:'me',agent_name:st.agent_name||'me',progress:Number.isFinite(st.progress)?st.progress:null,...(Number.isFinite(st.documents_count)?{documents_count:st.documents_count}:{})}]);
}

// —— 采样器 ——
async function sampleDtask() {
  let dirs = [];
  try { dirs = fs.readdirSync(DTASK, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return; }
  const now = Date.now();
  for (const id of dirs) {
    const meta = readJsonSafe(path.join(DTASK, id, 'meta.json'));
    if (!meta) continue;
    let status = 'running';
    const done = readJsonSafe(path.join(DTASK, id, 'done.json'));
    if (done) status = done.exit === 0 ? 'done' : (done.exit === 142 ? 'timeout' : 'failed');
    ifChanged(`dtask:${id}`, JSON.stringify([status, meta.name||'',meta.agent_id,meta.agent_name,meta.detail,meta.progress,meta.documents_count]), () => ['dtask', 'task', id, status, meta.name || '', '', {agent_id:meta.agent_id||'me',agent_name:meta.agent_name,detail:meta.detail,progress:Number.isFinite(meta.progress)?meta.progress:null,...(Number.isFinite(meta.documents_count)?{documents_count:meta.documents_count}:{})}]);
  }
}

function samplePm2() {
  let list;
  try { list = JSON.parse(execSync('pm2 jlist', { stdio: ['ignore','pipe','ignore'], timeout: 4000, maxBuffer: 8 * 1024 * 1024 }).toString()); } catch { return; }
  for (const p of list) {
    const st = p.pm2_env && p.pm2_env.status || 'unknown';
    ifChanged(`pm2:${p.name}`, JSON.stringify([st, p.pm2_env.restart_time]),
      () => ['pm2', 'process', p.name, st, `restarts=${p.pm2_env.restart_time}`, '']);
  }
}

async function sampleHeartbeat() {
  // 端口清单可用 HB_PORTS 覆盖，格式 "名称:端口,名称:端口,…"
  const spec = process.env.HB_PORTS || 'local-llm:11234,app:3080,panel:3000';
  for (const item of spec.split(',')) {
    const [name, portStr] = item.split(':');
    const port = parseInt(portStr, 10);
    if (!name || !port) continue;
    const up = await tcpProbe(port, '127.0.0.1') ? 'up' : 'down';
    ifChanged(`hb:${name}`, up, () => [name, 'heartbeat', name, up, `端口:${port}`, '']);
  }
}

function sampleGuard() {
  const line = lastLineMatching(GUARD_LOG, /SMOKE|restart|拉起|恢复|FAIL|fail/);
  if (!line) return;
  const sig = line.slice(0, 160);
  ifChanged('guard:last', sig, () => ['guard', 'note', 'process-guard',
    /fail|FAIL|拉起|restart/.test(line) ? 'warn' : 'ok', line.slice(0, 140), '']);
}

function sampleTunnel() {
  let domain = '';
  const line = lastLineMatching(TUNNEL_LOG, /https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (line) { const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) domain = m[0]; }
  if (domain) ifChanged('tunnel:domain', domain, () => ['tunnel', 'cloudflared', 'town-tunnel', 'up', domain, domain]);
}

// —— 快照（面板/小镇首屏直接读）——
function writeSnapshot() {
  const snap = {
    updated: new Date().toISOString(),
    seq,
    counts: { total: seq },
    now: Object.values(entities).filter(e => e.status === 'running' || e.status === 'up' || e.status === 'ok').map(e => e.subject),
    entities,
    agents: agentRecords,
    schedules: [...scheduleRuns.values()].sort((a,b)=>b.seq-a.seq),
    events: history.slice(-100).reverse(),
  };
  fs.writeFileSync(SNAPSHOT + '.tmp', JSON.stringify(snap, null, 1));
  fs.renameSync(SNAPSHOT + '.tmp', SNAPSHOT);
}

async function tick() {
  try { drainInbox(); writeSnapshot(); } catch(e) { console.error('inbox',e.message); }
  try { sampleSelfState(); } catch (e) { console.error('selfstate', e.message); }
  try { await sampleDtask(); } catch (e) { console.error('dtask', e.message); }
  try { samplePm2(); } catch (e) { console.error('pm2', e.message); }
  try { await sampleHeartbeat(); } catch (e) { console.error('hb', e.message); }
  try { sampleGuard(); } catch (e) { console.error('guard', e.message); }
  try { sampleTunnel(); } catch (e) { console.error('tunnel', e.message); }
  try { writeSnapshot(); } catch (e) { console.error('snap', e.message); }
}

console.log(`collectord start · town=${TOWN} interval=${INTERVAL}ms seq=${seq}`);
async function run() { try { await tick(); } finally { setTimeout(run, Math.max(100, INTERVAL || 5000)); } }
run();

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
let tickPaused = false;
try {
  const raw = fs.readFileSync(EVENTS, 'utf8').trim().split('\n');
  const last = raw[raw.length - 1];
  if (last) seq = JSON.parse(last).seq || 0;
} catch {}

const emit = (source, type, subject, status, summary, link) => {
  seq += 1;
  const ev = { seq, ts: new Date().toISOString(), source, type, subject, status, summary: summary || '', link: link || '' };
  fs.appendFile(EVENTS, JSON.stringify(ev) + '\n', (e) => { if (e) console.error('emit fail', e.message); });
  return ev;
};

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
  last[key] = sig;
  if (first && key.startsWith('skipfirst:')) return null; // 首轮静默基线
  return emit(...makeEvent());
}

// —— 状态归一（抄 Star-Office-UI normalize_agent_state）——
const VALID_STATES = new Set(['idle', 'writing', 'receiving', 'replying', 'researching', 'executing', 'syncing', 'error']);
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
  ifChanged(`self:${state}:${st.detail||''}`, '1', () => ['self', 'state', 'me', state, st.detail || '', '']);
}

// —— 采样器 ——
// 自报事件（source=self，seq=0 占位）在 collectord 侧补发真 seq，保证下游单调
function adoptSelfEvents() {
  let lines;
  try { lines = fs.readFileSync(EVENTS, 'utf8').split('\n'); } catch { return; }
  const selfBare = lines.some(l => l.includes('"source":"self"') && l.includes('"seq":0'));
  if (!selfBare) return;
  // 先冻结新事件 500ms（emit 是 appendFile 异步，避免重写窗口丢事件）
  tickPaused = true;
  setTimeout(() => {
    try {
      lines = fs.readFileSync(EVENTS, 'utf8').split('\n');
      const seen = new Set();
      const out = [];
      for (const l of lines) {
        if (!l) continue;
        let e; try { e = JSON.parse(l); } catch { continue; }
        if (e.source === 'self' && e.seq === 0 && !seen.has(e.ts)) {
          seq += 1; e.seq = seq; seen.add(e.ts);
        }
        out.push(JSON.stringify(e));
      }
      fs.writeFileSync(EVENTS, out.join('\n') + '\n');
    } finally { tickPaused = false; }
  }, 500);
}

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
    ifChanged(`dtask:${id}:${status}`, '1', () => ['dtask', 'task', id, status, meta.name || '', '']);
  }
}

function samplePm2() {
  let list;
  try { list = JSON.parse(execSync('pm2 jlist 2>/dev/null', { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }).toString()); } catch { return; }
  for (const p of list) {
    const st = p.pm2_env && p.pm2_env.status || 'unknown';
    ifChanged(`pm2:${p.name}:${st}`, String(p.pm2_env.restart_time),
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
    ifChanged(`hb:${name}:${up}`, '1', () => [name, 'heartbeat', name, up, `端口:${port}`, '']);
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
  const evs = [];
  try {
    const raw = fs.readFileSync(EVENTS, 'utf8').trim().split('\n').slice(-500);
    for (const l of raw) { if (l) evs.push(JSON.parse(l)); }
  } catch {}
  const byLatest = {};
  for (const e of evs) byLatest[`${e.source}:${e.subject}`] = e;
  const snap = {
    updated: new Date().toISOString(),
    seq,
    counts: { total: seq },
    now: Object.values(byLatest).filter(e => e.status === 'running' || e.status === 'up' || e.status === 'ok').map(e => e.subject),
    events: evs.slice(-100).reverse(),
  };
  fs.writeFile(SNAPSHOT, JSON.stringify(snap, null, 1), () => {});
}

async function tick() {
  if (tickPaused) return;
  try { adoptSelfEvents(); } catch (e) { console.error('adopt', e.message); }
  try { sampleSelfState(); } catch (e) { console.error('selfstate', e.message); }
  try { await sampleDtask(); } catch (e) { console.error('dtask', e.message); }
  try { samplePm2(); } catch (e) { console.error('pm2', e.message); }
  try { await sampleHeartbeat(); } catch (e) { console.error('hb', e.message); }
  try { sampleGuard(); } catch (e) { console.error('guard', e.message); }
  try { sampleTunnel(); } catch (e) { console.error('tunnel', e.message); }
  try { writeSnapshot(); } catch (e) { console.error('snap', e.message); }
}

console.log(`collectord start · town=${TOWN} interval=${INTERVAL}ms seq=${seq}`);
tick();
setInterval(tick, INTERVAL);

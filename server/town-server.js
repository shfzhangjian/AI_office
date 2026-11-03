#!/usr/bin/env node
// town-server — 小镇只读服务（零依赖，仅 Node 内置模块）
// 挂 /town 静态页 + /api/town-events（SSE 实时推 events.jsonl）+ /api/town-snapshot
//   + /api/town-events-brief（按日回顾）+ /api/town-weather + /town-assets/*（像素素材）。
// 可选：另挂 /api/stream/:id 把任意日志以 SSE tails 出来（清单见 LOGS / 环境变量 TOWN_LOGS）。
// 只读：仅 GET；默认监听 127.0.0.1。
//
// 关键环境变量：
//   TOWN_DIR    数据目录（事件/快照/天气），默认 ~/ai-office-town（可指向本仓库 samples/ 直接跑）
//   TOWN_HTML   前端页面，默认优先取前端目录的 town.html
//   TOWN_ASSETS 像素素材目录，默认取前端目录的 assets/
//   LT_PORT/HOST 监听端口/地址（默认 3002 / 127.0.0.1）
//   TOWN_LOGS   可选日志 tails 清单，格式 "id|显示名|文件路径;;id2|名2|路径2"
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.LT_PORT || '3002', 10);
const HOST = process.env.LT_HOST || '127.0.0.1';
const TOWN_DIR = process.env.TOWN_DIR || path.join(process.env.HOME, 'ai-office-town');
// 前端目录：本仓库里 server/ 与 frontend/ 平级
const FRONTEND = process.env.TOWN_FRONTEND || path.join(__dirname, '..', 'frontend');

const TOWN_FILES = [process.env.TOWN_HTML, path.join(TOWN_DIR, 'town.html'), path.join(FRONTEND, 'town.html')].filter(Boolean);
const TOWN_EVENTS = path.join(TOWN_DIR, 'events.jsonl');
const TOWN_SNAP = path.join(TOWN_DIR, 'snapshot.json');
const TOWN_ASSETS = process.env.TOWN_ASSETS || path.join(FRONTEND, 'assets');

// 日志 tails 清单（可选功能）：默认空；用 TOWN_LOGS 追加你自己的日志
const LOGS = (process.env.TOWN_LOGS || '')
  .split(';;').filter(Boolean)
  .map(s => { const [id, name, file] = s.split('|'); return { id, name, file }; });

const indexHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>日志 Tails</title><style>
body{margin:0;font:13px/1.5 ui-monospace,Menlo,monospace;background:#111417;color:#d6deeb}
header{display:flex;gap:8px;padding:8px 12px;background:#1b2127;border-bottom:1px solid #2a3340;position:sticky;top:0;flex-wrap:wrap}
button{background:#22303d;color:#9db1c5;border:1px solid #33475c;border-radius:6px;padding:4px 10px;cursor:pointer}
button.on{background:#2d5f8a;color:#fff}
#pause{margin-left:auto}
pre{margin:0;padding:10px 14px;white-space:pre-wrap;word-break:break-all}
</style></head><body>
<header id="tabs"></header><button id="pause" style="position:fixed;right:12px;bottom:12px;z-index:2">暂停</button>
<pre id="out">加载中…</pre>
<script>
const tabs=document.getElementById('tabs'),out=document.getElementById('out'),pause=document.getElementById('pause');
let es=null,paused=false;pause.onclick=()=>{paused=!paused;pause.textContent=paused?'继续':'暂停';};
fetch('/api/logs').then(r=>r.json()).then(ls=>{
 ls.forEach((l,i)=>{const b=document.createElement('button');b.textContent=l.name;b.dataset.id=l.id;
  if(i===0)b.classList.add('on');b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('on'));b.classList.add('on');open(l.id);};tabs.appendChild(b);});
 open(ls[0].id);});
function open(id){if(es)es.close();out.textContent='';es=new EventSource('/api/stream/'+id);
 es.onmessage=e=>{if(paused)return;out.textContent+=e.data+'\\n';const n=out.innerText.split('\\n').length;if(n>3000)out.innerText=out.innerText.split('\\n').slice(-2000).join('\\n');out.scrollTop=out.scrollHeight;};}
</script></body></html>`;

function tail(file, n) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 128 * 1024);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').slice(-n);
  } catch { return []; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml); return;
  }
  if (url.pathname === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(LOGS.map(({ id, name }) => ({ id, name })))); return;
  }
  // —— 种田小镇 ——
  if (url.pathname.startsWith('/town-assets/')) {
    const name = path.basename(url.pathname); // 防穿越
    const f = path.join(TOWN_ASSETS, name);
    try {
      const st = fs.statSync(f);
      const mime = { '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain' }[path.extname(name)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(f).pipe(res);
    } catch { res.writeHead(404); res.end('nf'); }
    return;
  }
  if (url.pathname === '/town' || url.pathname === '/town/') {
    const f = TOWN_FILES.find(x => { try { return fs.statSync(x).isFile(); } catch { return false; } });
    if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('town.html 未找到'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(f)); return;
  }
  if (url.pathname === '/api/town-events-brief') {
    // 按北京时间统计某日事件（day=yesterday|today），只回统计相关字段
    try {
      const day = url.searchParams.get('day') === 'today' ? 0 : 1;
      const dayMs = 86400000, tzs = 8 * 3600000;
      const target = Math.floor((Date.now() + tzs) / dayMs) - day;
      const out = [];
      const raw = fs.readFileSync(TOWN_EVENTS, 'utf8').trim().split('\n');
      for (const l of raw) {
        if (!l) continue;
        let e; try { e = JSON.parse(l); } catch { continue; }
        if (Math.floor((Date.parse(e.ts) + tzs) / dayMs) !== target) continue;
        out.push({ type: e.type, status: e.status, summary: e.summary, ts: e.ts });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    } catch { res.writeHead(503); res.end('[]'); }
    return;
  }
  if (url.pathname === '/api/town-weather') {
    try {
      const { execFileSync } = require('child_process');
      // 天气脚本：优先环境变量 WEATHER_SCRIPT，其次 TOWN_DIR，再退回本仓库 collector/
      const candidates = [process.env.WEATHER_SCRIPT, TOWN_DIR + '/weather.sh', path.join(__dirname, '..', 'collector', 'weather.sh')].filter(Boolean);
      const script = candidates.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
      if (!script) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
      // 先把脚本输出整段取回，再一次性发头，避免 execFileSync 抛错时头已发出导致二次写头崩溃
      const buf = execFileSync('/bin/bash', [script], { timeout: 12000 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(buf);
    } catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{}'); }
    return;
  }
  if (url.pathname === '/api/town-snapshot') {
    try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(fs.readFileSync(TOWN_SNAP)); }
    catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{}'); }
    return;
  }
  if (url.pathname === '/api/town-events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    let offset = 0;
    const flush = () => {
      try {
        const size = fs.statSync(TOWN_EVENTS).size;
        if (size < offset) offset = 0;
        if (size > offset) {
          const fd = fs.openSync(TOWN_EVENTS, 'r');
          const buf = Buffer.alloc(Math.min(size - offset, 256 * 1024));
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset += buf.length;
          for (const line of buf.toString('utf8').split('\n')) {
            if (!line) continue;
            try { const e = JSON.parse(line); if (e.seq > after) send(e); } catch {}
          }
        }
      } catch {}
    };
    // 首屏：直接全量回放（前端按 after 过滤），再增量
    flush();
    let w = null; try { w = fs.watch(TOWN_EVENTS, flush); } catch {}
    const t = setInterval(flush, 3000);
    res.on('close', () => { clearInterval(t); if (w) try { w.close(); } catch {} });
    return;
  }
  const m = url.pathname.match(/^\/api\/stream\/([\w-]+)$/);
  if (m) {
    const log = LOGS.find(l => l.id === m[1]);
    if (!log) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const n = Math.min(parseInt(url.searchParams.get('tail') || '200', 10) || 200, 1000);
    const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
    for (const line of tail(log.file, n)) send(line);
    let offset = 0, ready = false;
    try { offset = fs.statSync(log.file).size; ready = true; } catch {}
    let stopped = false;
    const stop = () => { stopped = true; clearInterval(timer); if (watcher) { try { watcher.close(); } catch {} } };
    const flush = () => {
      if (stopped) return;
      try {
        if (!ready) { ready = true; offset = 0; }
        const size = fs.statSync(log.file).size;
        if (size < offset) offset = 0; // 日志轮转
        if (size > offset) {
          const fd = fs.openSync(log.file, 'r');
          const buf = Buffer.alloc(Math.min(size - offset, 512 * 1024));
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset += buf.length;
          for (const line of buf.toString('utf8').split('\n')) {
            if (line) send(line);
          }
        }
      } catch {}
    };
    let watcher = null;
    try { watcher = fs.watch(log.file, () => flush()); } catch {}
    const timer = setInterval(flush, 2000);
    req.on('close', stop);
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, HOST, () => console.log(`logs-tails on http://${HOST}:${PORT}`));

# 🚀 部署与对齐运行手册（DEPLOY）

> 目标：**git 仓库 = 唯一代码源，运行态 = 本手册描述的那套 pm2 进程**。
> 日常"按仓库更新线上"只需一条命令；数据、事件账、素材授权始终不变。

---

## 一、这套系统现在由什么构成

代码全部来自本仓库；线上运行只是「仓库脚本 + 一组环境变量」的实例化。

| 进程（pm2 名） | 跑的脚本 | 端口 | 数据写到 | 反代入口 |
|---|---|---|---|---|
| `town-server` | `server/town-server.js` | 3002 | 读 `~/town/` | caddy `:3004 → 127.0.0.1:3002` |
| `town-collector` | `collector/collectord.js` | — | 写 `~/town/events.jsonl` | 外网 cloudflared（独立进程 `town-tunnel`） |
| （入口）`town_state.sh` | `~/.local/bin/town_state.sh` → 转发到 `collector/town_state.sh` | — | 写 `~/town/state.json` | — |

**关键点**：数据目录仍是 `~/town`（不是仓库默认的 `~/ai-office-town`）。是 pm2 进程的环境变量把它桥接回去的——见下面的 ecosystem。数据零迁移，历史事件账完整保留、`seq` 连续。

---

## 二、环境桥接：一份 ecosystem 文件锁死所有指向

线上运行配置在 **`~/town/town-ecosystem.json`**（在数据目录、**不进 git**，因为它含本机绝对路径）。它给两个进程注入环境变量：

```jsonc
// town-server
LT_PORT=3002  LT_HOST=127.0.0.1
TOWN_DIR=~/town  WEATHER_SCRIPT=~/town/weather.sh
// （素材目录不写 → 默认取仓库 frontend/assets）

// town-collector
TOWN_DIR=~/town
DTASK_DIR=~/dsh-dingtalk-workspace/dtask/tasks   // 线上真实任务目录
GUARD_LOG=~/.dsh/web-guard.log                    // 线上守护日志
TUNNEL_LOG=/tmp/luck-tunnel.log                   // 线上隧道日志
HB_PORTS=model:11234,dsh:3080,panel:3000          // 线上心跳端口
```

> 换机器 / 换端口 / 换采集源，**只改这个 ecosystem 文件**，不碰仓库代码。
> `town_state.sh` 同理：线上入口 `~/.local/bin/town_state.sh` 是个薄包装，`exec env TOWN_DIR=~/town bash <仓库>/collector/town_state.sh`。

`HB_PORTS` 等采集源也可不写进 ecosystem、直接 `export` 后再 `pm2 restart --update-env`；写在文件里只是为了可复现。

---

## 三、日常：按仓库更新当前运行的（核心，就一条）

```bash
# 1) 取最新代码
cd ~/dsh-dingtalk-workspace/AI_office
git pull --ff-only

# 2) 重启两个进程拉新代码（--update-env 让 ecosystem 的 env 重新注入）
pm2 startOrRestart ~/town/town-ecosystem.json --update-env

# 3) 看一眼没崩（restarts 别再涨、无 error 日志）
pm2 list | grep town-
pm2 logs town-server --nostream --lines 5
```

**秒级完成、零停机风险**：`town-server` 重启期间页面短暂 502，`autorestart` 立刻拉起；`town-collector` 重启不丢账（seq 从 `events.jsonl` 末尾续）。前端 `frontend/town.html` 和 `frontend/assets/*` 是**静态即时生效**的——改了甚至不用重启，刷新页面即可（town-server 每次请求现读文件）。

### 只想更新前端某处？
改 `frontend/town.html` → 刷新浏览器，**不用重启任何进程**。

### 只想改采集源（加/减监控的服务）？
不用改代码。改 `ecosystem` 里 `HB_PORTS`，或临时：
```bash
HB_PORTS="model:11234,dsh:3080,panel:3000,newsvc:9000" \
  pm2 restart town-collector --update-env
```

---

## 四、首次在新机器上跑起来

```bash
git clone https://github.com/shfzhangjian/AI_office.git
cd AI_office

# 想要"开箱看效果"，直接对 samples 跑：
TOWN_DIR=$(pwd)/samples node server/town-server.js      # http://127.0.0.1:3002/town
node collector/collectord.js                            # 接自己的采集源

# 要常驻：把 ecosystem 里的绝对路径换成新机器路径，然后
pm2 start <你的>/town-ecosystem.json && pm2 save
```

依赖：Node ≥ 18（服务端零 npm 依赖）；采集器用到 `pm2 jlist`（可选，缺了自动跳过进程采集）；天气用到 `curl`+`python3`。

---

## 五、回退

切换前的旧文件都留了备份，任一步出问题可回退：

| 退役的旧物 | 备份位置 |
|---|---|
| 旧 `logs-tails.js` / `collectord.js` / `town.html` / `weather.sh` / `town_state.sh` | `~/.pm2-dashboard/town-align-backup-*/` |
| 旧前端页 | `~/town/town.html.pre-align.bak` |
| 旧素材目录（若新素材有问题） | `~/.pm2-dashboard/town-assets/`（未删，可临时 `TOWN_ASSETS` 指回去） |

一键回退到对齐前：
```bash
# 停掉仓库版进程
pm2 delete town-server town-collector
# 旧服务脚本仍在 ~/.pm2-dashboard/logs-tails.js（未动）；旧采集脚本从备份还原
cp ~/.pm2-dashboard/town-align-backup-*/collectord.js.bak ~/town/collectord.js
cp ~/.pm2-dashboard/town-align-backup-*/town.html.bak      ~/town/town.html   # 恢复旧前端页
pm2 start ~/.pm2-dashboard/logs-tails.js --name logs-tails
pm2 start ~/town/collectord.js        --name town-collector
# 旧 logs-tails 默认读 ~/town/town.html（已还原）、素材走 ~/.pm2-dashboard/town-assets（未删）
pm2 save
```
（旧前端页备份在 `~/.pm2-dashboard/town-align-backup-*/town.html.bak`，也可从 `~/town/town.html.pre-align.bak` 取。）

---

## 六、健康自检清单

```bash
# 1) 谁在 3002 LISTEN，应是 town-server
lsof -nP -iTCP:3002 -sTCP:LISTEN | grep -v COMMAND
# 2) 端到端
for ep in /town /api/town-snapshot /api/town-weather /town-assets/office_bg.webp; do
  printf "%-32s %s\n" "$ep" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002$ep)"; done
# 3) 反代
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:3004/town
# 4) 采集器没写错地方、账在长
[ -d ~/ai-office-town ] && echo "⚠️写错目录了" || echo "✓ 写 ~/town"
tail -1 ~/town/events.jsonl | python3 -c "import json,sys;e=json.load(sys.stdin);print('seq',e['seq'],e['ts'])"
# 5) 页面是仓库新版（脱敏 footer 含 Simon Lee）
curl -s http://127.0.0.1:3002/town | grep -q "Simon Lee" && echo "✓ 仓库新版页"
```

---

## 七、"按仓库更新"的边界（重要）

- **会随 `git pull` 更新的**：`server/town-server.js`、`collector/collectord.js`、`collector/weather.sh`、`collector/town_state.sh`、`frontend/town.html`、`frontend/assets/*`。改完这些并提交、`pm2 startOrRestart --update-env`，线上即生效。
- **不会、也不应被仓库覆盖的**（都是本机运行态）：`~/town/events.jsonl`、`snapshot.json`、`state.json`、`weather.json`（数据/账本），`~/town/town-ecosystem.json`（本机 env），`~/.local/bin/town_state.sh`（薄包装）。仓库的 `.gitignore` 已排除这些文件名，即便误提交进 `samples/` 也不会污染。
- 因此可以安全地 `git pull` + 重启，而不必担心丢历史事件账。

# 办公室真实数据接入

## 启动

Node.js ≥18，无需 npm 依赖。必须同时运行采集器与网页服务：

```powershell
$env:TOWN_DIR = "E:/example/ai-office-data"
$env:LT_PORT = "3012"
$env:COLLECTOR_INTERVAL_MS = "1000"
node server/start.js
```

默认本地监听。当前预览已使用此入口运行，访问 http://127.0.0.1:3012/town ，保持“实时模式”。不要同时再启动第二个采集器写入同一数据目录。

## 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /api/town-events | 校验并持久化上报事件 |
| GET | /api/town-inbox/:id | 查询 queued / applied 与事件 seq |
| GET | /api/town-agents | 查询角色、任务、资料数量与历史 |
| GET | /api/town-services | 查询服务状态与负载 |
| GET | /api/town-snapshot | 全量投影与最近事件 |
| GET | /api/town-events?after=seq | SSE 增量事件，支持 Last-Event-ID |

POST 返回 202 表示事件已经入队，并非已经显示；处理时间通常在一个采集周期内，响应的 status_url 可查询处理结果。首次必须启动采集器，否则事件保留在队列，重启后继续处理。

同一业务事件建议带稳定的 `Idempotency-Key` 请求头。相同键与相同内容返回原回执，不重复记账；相同键不同内容返回 409。请求最大 16 KiB，需 `Content-Type: application/json`。

未设置 `TOWN_WRITE_TOKEN` 时只允许本机回环来源写入，且拒绝跨源浏览器写入。远程写入请在服务端与调用端配置同一 `TOWN_WRITE_TOKEN`，发送 `Authorization: Bearer <token>`，并通过 HTTPS 反向代理访问；禁止把密钥放入前端。该写入令牌与 GitHub 令牌无关。现有读取接口仍应由部署入口做访问控制。

## 事件示例

### 角色工作状态

```json
{"type":"state","subject":"report-agent","agent_name":"报告专员","status":"writing","summary":"生成经营报告","detail":"校验数据并绘制图表","progress":45,"documents_count":3}
```

角色 ID 为 subject。状态支持 idle/writing/receiving/replying/researching/executing/syncing/error/thinking/anxious/blocked/done。researching 自动前往书柜，idle 会触发休息行为。上报工作状态会结束休息并返回工位。progress 可选，范围 0–100；未提供时显示未知。

### 任务开始与结束

```json
{"type":"task","subject":"report-20261103","agent_id":"report-agent","status":"running","summary":"处理经营报告"}
```

```json
{"type":"task","subject":"report-20261103","agent_id":"report-agent","status":"done","summary":"经营报告已完成","progress":100}
```

同一任务始终使用相同 subject；不同角色任务 ID 应保持全局唯一。任务状态支持 queued/pending/running/done/failed/timeout/archived。

### 资料与日志

```json
{"type":"document","subject":"source-batch-01","agent_id":"report-agent","documents_delta":2,"summary":"收到两份源资料"}
```

```json
{"type":"document","subject":"archive-batch-01","agent_id":"report-agent","documents_delta":-2,"summary":"两份资料完成归档"}
```

```json
{"type":"log","subject":"validate-step","agent_id":"report-agent","status":"executing","summary":"完成数据校验"}
```

可用 documents_count 上报绝对数量（0–12）或 documents_delta 上报增减量（-12–12），两者不可同时发送。纸堆最多显示 8 层，鼠标悬停可查看实际计数。不提供显式数量时，任务开始 +2、任务结束 -2、工作状态日志 +1，作为视觉映射而非真实文档统计。

### 服务器负载

```json
{"type":"service","subject":"local-llm","status":"up","load":92,"summary":"模型服务负载上报"}
```

load 范围 0–100，超过 80 显示繁忙蒸汽。status 支持 up/down/unknown。缺少 load 显示未知，不用端口探活假装 CPU 指标。具体负载由业务调用方采集并上报，接口自身不探测远程 CPU。

## PowerShell 调用

```powershell
$event = @{ type='state'; subject='report-agent'; agent_name='报告专员'; status='writing'; summary='整理报告'; documents_count=3 } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri http://127.0.0.1:3012/api/town-events -Method Post -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes($event))
```

也可将上述 JSON 保存为 event.json：

```powershell
$env:TOWN_URL = 'http://127.0.0.1:3012'
$env:TOWN_EVENT_KEY = 'report-20261103-start'
node collector/report.js event.json
```

## 业务接入点

在 AI 服务的任务开始、步骤更新、资料进入/归档、任务结束处调用上报接口。现有任务目录 meta.json 可携带 agent_id/agent_name/detail/progress/documents_count，采集器会保留并投影这些字段。state.json 仍兼容本机 me 状态上报。

角色完整状态与资料计数从事件账本重建，快照用于首屏初始化；刷新不会重复增减纸张。队列、处理回执及 events.jsonl 属于运行时数据，需按部署容量规划保留期限。当前不含回执清理策略，不支持多个采集器同时写同一目录。

当前页面的“接口联调”角色和“接口测试服务”为明确标注的联调测试上报，不代表已连接某个未指定的生产 AI 服务。

## 定时任务扩展

统一上报接口增加 `type: schedule`，支持 triggered/running/done/failed/missed，必须提供任务 subject 与每次执行唯一的 run_id。`GET /api/town-schedules` 查询最近100次运行，快照包含 schedules 数组。界面会提示新触发与执行结果，刷新时不回放历史弹窗。

完整实现说明、字段、调用和调度器接入参见 [SCHEDULE_INTEGRATION.md](SCHEDULE_INTEGRATION.md)。

## 多角色注册与钉钉适配

`POST /api/town-events` 支持 `type: agent`、`status: registered`、角色subject与agent_name，用于提前注册闲置人物。钉钉来源请使用 `POST /api/town-dingtalk/events`，以注册表三元组进行严格角色绑定；查询接口为 `GET /api/town-dingtalk/bindings`。完整协议与线上桥接迁移步骤见 [DINGTALK_MULTI_BOT.md](DINGTALK_MULTI_BOT.md)。

## 生产界面与时间显示（2026-11-03）

页面时钟、实时任务时间线、刷新恢复的时间线及定时任务记录，统一按 `Asia/Shanghai` 展示为24小时制；午夜为00时，与浏览器/服务器本地时区无关。API与账本保留带时区ISO8601，不通过修改系统时区或把UTC字符串错误拼接成北京时间来转换。

默认部署关闭所有演示入口，包括添加演示人物、休息演示操作和定时任务模拟触发。`?demo=1`不能绕过默认配置。只有开发环境显式设置 `TOWN_ALLOW_DEMO=1` 且尚无实际事件时可使用模拟预览；一旦快照或SSE包含实际上报，自动清除演示角色/服务/通知，切回真实数据，隐藏模拟控件。本页会话不能再次切回演示；刷新后仍按实际快照锁定。生产环境不要配置此变量。

页面默认优先使用仓库frontend/town.html，运行目录里旧town.html不再覆盖新版；如果显式设置过TOWN_HTML，部署时应移除旧覆盖或指向新版。

## 前端环境角色

“环境同事”保存在前端独立集合，不属于接口中的agents，不写inbox、事件账本或角色快照，也不参与真实工位容量、任务数量、纸张与负载统计。其散步/休息/喝水/查资料由页面动画驱动。实际接口数据仍是唯一业务事实来源；关闭或刷新环境动画不改变后台数据。它与默认关闭的演示模式相互独立。

## 数字人会话日志

人物详情已精简为名称、状态、接收到的钉钉原始任务、执行日志与实际反馈内容；按角色/会话/任务隔离，时间统一北京时间24小时制。原始消息、执行和反馈分别使用message_phase=received/execution/reply，上报方式与dsh接入位置详见 [会话日志协议](CONVERSATION_LOGS.md)。

## 模型遥测

新增 type=model，以及 GET `/api/town-models`、快照 models 数组；事件可携带 session_id、model_name、model_status。完整字段、心跳与 dsh 回调接法见 [接入文档](MODEL_WORLD_INTEGRATION.md)。

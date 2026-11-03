# 钉钉多机器人：角色注册、身份隔离与接入

## 本次解决的问题与边界

办公室过去有两条默认归并路径：单个 state.json 固定上报 me；任务 meta.json 未提供 agent_id 时也归入 me。两个机器人执行任务并不等于办公室会自动发现两个角色。

本次增加独立角色注册、企业/应用/机器人三元组绑定、可信桥接接口、多角色状态文件及明确的未知身份错误。同一个机器人在群聊或单聊中始终归属同一办公室角色；不同机器人即使显示相同发送者昵称、处于同一个群或发送相同任务名，仍保持角色隔离。

本仓库不包含你线上 dsh 的钉钉收发消息代码，也没有钉钉应用密钥。新增接口是供可信 dsh/任务桥接进程调用的业务事件入口，不是可以直接填到钉钉控制台的原始机器人回调地址。不处理钉钉回调签名、Stream建连或消息发送，不改变钉钉自身的发送者显示，也不会发送测试消息。

## 1. 身份模型

| 字段 | 作用 |
|---|---|
| agent_id | 办公室角色ID，跨渠道保持稳定，决定工位、任务、纸堆归属 |
| tenant_id | 钉钉企业标识，由桥接连接配置提供，不猜测当前发送者所属组织 |
| app_id | 钉钉应用标识，使用桥接客户端对应的应用ID |
| robot_code | 钉钉机器人编码，不假设必然等于app_id |
| conversation_type | direct 或 group，仅用于路由来源与诊断 |
| conversation_id | 当前会话标识，不作为角色ID |
| executor_id | 可选，任务执行器，如 vm-worker-01，不等同于发送机器人 |

senderId、senderNick、群名、用户ID均不用于推断角色。原始回调中的 robotCode 等字段应由桥接层结合已认证的连接配置规范化；不要通过用户消息正文指定机器人身份。

## 2. 配置角色与机器人绑定

复制 config/roster.example.json 到运行目录 roster.json，或使用 TOWN_ROSTER 指向独立配置文件。示例中两个角色名称已填写；1030机器人编码、企业ID与应用ID均是占位符，必须换成真实值。bot2编码来自用户提供的信息，仍需与实际应用配置核对。

```json
{
  "agents": [
    {"id":"zhangjian-1030","name":"张健机器人1030"},
    {"id":"vm-programmer","name":"虚拟机程序员"}
  ],
  "bots": [
    {"tenant_id":"实际企业ID","app_id":"1030实际应用ID","robot_code":"1030实际机器人编码","agent_id":"zhangjian-1030"},
    {"tenant_id":"实际企业ID","app_id":"虚拟机实际应用ID","robot_code":"dingxwolvr55q6ixnhev","agent_id":"vm-programmer"}
  ]
}
```

此配置不存储 appSecret、accessToken 或 sessionWebhook。两个机器人共用一个企业ID没有问题，但每个机器人绑定必须明确。相同三元组重复绑定会被拒绝，禁止一条绑定同时指向两个角色。一个角色可以绑定多个三元组，用于同一执行角色经不同机器人入口呈现的显式配置。

采集器每轮读取注册表，两个人在没有新消息、没有任务时也会以“等待”状态保留独立工位。这里的“已注册”不代表钉钉机器人当前在线。删除配置不会自动删除账本中的历史角色；当前版本不提供角色注销接口。

## 3. 启动与兼容旧配置

```powershell
$env:TOWN_DIR = 'E:/live/AI_office-runtime'
$env:TOWN_ROSTER = 'E:/live/AI_office-runtime/roster.json'
$env:TOWN_DEFAULT_AGENT_ID = 'zhangjian-1030'
$env:LT_PORT = '3012'
node server/start.js
```

TOWN_DEFAULT_AGENT_ID 将明确属于1030的旧 state.json/旧任务映射到1030。它只应用于真正属于该角色的旧事件，不能把虚拟机任务也交给默认角色。

- 没有注册表时，保留旧 me 回退，兼容原部署。
- 已配置角色注册表、但没有 agent_id/机器人三元组且未配置明确默认角色时，文件采集报身份不明确并跳过，不会悄悄归并为 me。
- 已提供机器人字段但无法匹配时，即使配置了默认角色也会报错，不回退到默认角色。
- 已提供 agent_id 且与机器人绑定冲突时拒绝上报。
- 历史 me 事件不会自动猜测归属、迁移或删除；新事件正确分流后，旧 me 可能仍作为历史角色保留，应单独制定历史数据迁移方案。

PM2部署仍可分别运行网页和采集器，只需两边使用同一 TOWN_DIR/TOWN_ROSTER，并更新进程环境。切勿同时运行PM2采集器和server/start.js内的采集器。

## 4. 通用角色注册接口

沿用 POST /api/town-events：

```json
{"type":"agent","subject":"vm-programmer","agent_name":"虚拟机程序员","status":"registered"}
```

它会持久化注册角色，闲置时也出现在地图；重新注册可更新名字，不重置当前工作状态或纸张。普通角色注册并不自动建立钉钉三元组绑定，钉钉适配器仍要求配置 roster.json。

## 5. 钉钉可信桥接接口

`POST /api/town-dingtalk/events`

继承统一事件接口的写入鉴权、16KiB限制、持久化队列与回执协议。远程调用必须配置 TOWN_WRITE_TOKEN，使用 HTTPS反向代理，且由入口保护读取接口。无需也不应向本接口发送钉钉accessToken或sessionWebhook。

```json
{
  "tenant_id":"实际企业ID",
  "app_id":"虚拟机实际应用ID",
  "robot_code":"dingxwolvr55q6ixnhev",
  "conversation_type":"direct",
  "conversation_id":"实际单聊会话ID",
  "event":{
    "type":"task",
    "subject":"dtask-001",
    "status":"running",
    "summary":"修改页面布局",
    "detail":"正在检查显示器与人物遮挡",
    "progress":30,
    "executor_id":"vm-worker-01"
  }
}
```

服务端执行：

1. 以 tenant_id/app_id/robot_code 精确匹配注册表。
2. 注入固定 agent_id 和角色名称，拒绝冲突的手动 agent_id。
3. state事件的subject固定为角色ID；任务、日志、资料、定时任务subject按角色和原subject生成稳定命名空间，避免跨角色同名任务碰撞。
4. 原subject保留在 external_subject，便于审计。
5. 将provider、机器人三元组、会话类型/ID和executor_id随事件记账，并保留在角色快照中。
6. 写入pending队列，由单个采集器分配seq、更新快照与SSE。

允许的event.type：state/task/document/log/schedule。状态和资料字段沿用 docs/API.md；schedule仍需全局唯一run_id。

群聊只需改为 conversation_type=group，conversation_id填写实际群会话ID，其他身份不变。两个机器人在同群时会各自进入自己的工位。

同一类型任务的开始与完成应使用相同原subject；不同群或不同会话的独立任务应使用不同业务任务ID，不要把所有请求都叫“report”。同一角色的跨渠道任务应沿用该任务的全局业务ID。

桥接请求建议发送稳定 Idempotency-Key，例如 `message:<msgId>:task-running`。服务端会进一步加上机器人三元组命名空间，所以不同机器人同名消息键不会碰撞。该键仍要区分阶段；同一键不能发不同内容。

### PowerShell发送

```powershell
$env:TOWN_URL = 'http://127.0.0.1:3012'
$env:TOWN_EVENT_CHANNEL = 'dingtalk'
$env:TOWN_EVENT_KEY = 'dtask-001-running'
node collector/report.js dingtalk-event.json
```

将上面的JSON保存为dingtalk-event.json，并替换真实企业/应用信息。通用report.js默认仍走/api/town-events，只有TOWN_EVENT_CHANNEL=dingtalk时走适配接口。

## 6. 线上 dsh 接入位置

当前仓库没有dsh桥接源码，部署侧需要在实际处理流程中加入上报调用：

- 收到消息：从当前机器人连接配置取得企业、应用与机器人编码，而不是从昵称或senderId反推；保留conversationId与单聊/群聊类型。
- 创建任务：把解析出的agent_id写入任务元数据；确认执行器与发送通道的关系，不把“使用哪个机器人发通知”直接等同于“谁执行任务”。
- 工作开始/步骤变更/资料归档：通过可信桥接接口发送规范化事件。
- 执行完成：使用相同任务ID、相同机器人身份，发送done/failed。
- 消息发送：仍由dsh自己的钉钉发送器负责，必须核对应用凭证与robotCode匹配；sessionWebhook/ConversationToken只用于其原始上下文，不作为任意机器人换身份的工具。

若1030负责通知但虚拟机执行任务，应由业务层明确选择展示哪位执行角色；不要把消息投递机器人当作唯一的任务归属依据。可在通用事件中显式agent_id=vm-programmer并记录executor_id，钉钉路由只作为来源；可信机器人适配接口则严格按其配置角色绑定，不允许在请求内冒充另一个绑定。

## 7. 文件采集接入

### 每个角色独立状态文件

运行目录中创建：

- agents/zhangjian-1030.json
- agents/vm-programmer.json

内容：

```json
{"state":"writing","detail":"正在修复接口","updated_at":"2026-11-03T14:00:00+08:00","progress":30,"documents_count":2}
```

不填写agent_id时取文件名；也可填写显式agent_id或完整机器人三元组。建议文件名与角色保持一致。状态超时仍回落idle，不删除角色。

Bash入口支持：

```bash
TOWN_AGENT_ID=vm-programmer TOWN_DIR=~/town bash collector/town_state.sh writing "修复接口"
```

新版脚本原子替换状态文件，并使用带时区的UTC时间。未设置TOWN_AGENT_ID时仍写旧state.json。

### 后台任务 meta.json

优先写清角色：

```json
{"name":"修复接口","agent_id":"vm-programmer","agent_name":"虚拟机程序员","executor_id":"vm-worker-01"}
```

或者在meta.json中填写 tenant_id/app_id/robot_code，由同一个注册表解析。仅填写昵称、robotCode驼峰字段或bot2别名不会自动匹配；需在桥接程序中规范化。缺少身份而又配置默认角色时会进入默认角色，部署时务必检查虚拟机任务是否补齐agent_id。

## 8. 只读诊断

- GET /api/town-dingtalk/bindings：查看实际加载的角色与三元组绑定，不返回密钥。
- GET /api/town-agents：检查是否有两个独立id；state=idle表示等待，不代表未接入。
- GET /api/town-snapshot：查看agents与entities中的身份和会话来源。
- GET /api/town-inbox/:id：确认上报是否由queued变applied。
- 采集器日志：`Unregistered DingTalk bot identity`表示绑定缺失，`agent_id conflicts`表示配置冲突，`Missing agent_id`表示旧任务归属不明确。

发送者显示问题与办公室角色问题分开验收：办公室两个id正确，不代表钉钉客户端一定显示两个发送者；后者需核对实际钉钉发送请求、权限与会话能力。

## 9. 验收矩阵

| 场景 | 预期 |
|---|---|
| 注册两个闲置角色 | 两个工位、两个id，不要求先发消息 |
| 两机器人同群、同名任务 | 两角色独立，规范化任务subject不同 |
| 两机器人单聊、senderId相同 | 不依据senderId合并 |
| 同一机器人从群聊切到单聊 | 仍是同一角色，不新增假角色 |
| bot2绑定缺失 | 明确400，禁止进入me |
| 请求agent_id与绑定冲突 | 明确400，禁止冒充 |
| 两机器人相同幂等键 | 分别入队；同机器人重试不重复 |
| 采集器重启、页面刷新 | 两角色状态、任务和资料保持独立 |
| 旧单机器人部署无注册表 | 保留me兼容行为 |

执行 `node --test tests/*.test.js`。这些测试只验证办公室接入与隔离，不调用钉钉、不发送消息。

## 10. 后续扩展

Codex、WorkBuddy等工具可使用通用角色注册与事件协议，身份不必来自钉钉。具体工具的日志、回调或执行器适配需逐一核实；本次没有宣称已接通这些工具的生产接口。

## 生产界面与时间显示（2026-11-03）

页面时钟、实时任务时间线、刷新恢复的时间线及定时任务记录，统一按 `Asia/Shanghai` 展示为24小时制；午夜为00时，与浏览器/服务器本地时区无关。API与账本保留带时区ISO8601，不通过修改系统时区或把UTC字符串错误拼接成北京时间来转换。

默认部署关闭所有演示入口，包括添加演示人物、休息演示操作和定时任务模拟触发。`?demo=1`不能绕过默认配置。只有开发环境显式设置 `TOWN_ALLOW_DEMO=1` 且尚无实际事件时可使用模拟预览；一旦快照或SSE包含实际上报，自动清除演示角色/服务/通知，切回真实数据，隐藏模拟控件。本页会话不能再次切回演示；刷新后仍按实际快照锁定。生产环境不要配置此变量。

页面默认优先使用仓库frontend/town.html，运行目录里旧town.html不再覆盖新版；如果显式设置过TOWN_HTML，部署时应移除旧覆盖或指向新版。

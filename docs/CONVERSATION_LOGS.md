# 数字人详情：钉钉任务、执行日志与反馈

## 展示内容

点击数字人只显示角色名称、状态与其接收的任务。每次任务按角色、会话类型、会话ID和任务ID隔离，依次展示：

1. 接收到的任务：从钉钉收到的原始消息正文。
2. 执行日志：执行器在该任务中实际产生并上报的步骤或输出。
3. 反馈给钉钉：通过钉钉发送成功后，桥接程序上报的实际回复正文；发送失败时显示“反馈发送失败”。

详情已移除行走路线按钮、休息操作、进度条、额外来源元数据、全局事件动态。地图工具栏的路线开关仍保留。环境同事没有真实任务与会话日志。

所有日志时间按北京时间、24小时制显示，格式YYYY-MM-DD HH:mm:ss。时间目前是事件采集入账时间，而不是从正文中推测的业务时间。

## 事件字段

沿用POST /api/town-events及可信钉钉桥接POST /api/town-dingtalk/events。使用type=log或task，并提供：

| 字段 | 规则 |
|---|---|
| agent_id | 通用接口必填；钉钉桥接从机器人绑定注入 |
| subject | 每条事件业务标识，如消息ID或步骤ID；不同阶段用不同幂等键 |
| task_id | 三阶段相同的业务任务ID；通用接口最大100字符 |
| conversation_id | 对应会话ID，不用昵称代替 |
| conversation_type | direct或group |
| message_phase | received / execution / reply |
| content | 原始任务、执行输出或回复正文，最大8000字符；保留换行，以文本方式渲染 |
| delivery_status | reply阶段必填sent或failed，其他阶段不需要 |
| message_id | 可选，原钉钉消息标识，用于来源核对 |
| provider | 通用接入可填写dingtalk；可信桥接自动填写 |

请求整体仍限制16KiB，因此中文正文未必能达到8000字符。长输出由调用方分块，以不同subject/幂等键依次上报，不能伪造或静默裁剪真实反馈。

## 三阶段示例（通用接口）

收到消息后：

```json
{"type":"log","subject":"incoming-message-001","agent_id":"vm-programmer","provider":"dingtalk","task_id":"task-001","conversation_type":"direct","conversation_id":"实际会话ID","message_phase":"received","content":"请整理本周任务，并告诉我结果。"}
```

执行中，每条日志单独上报：

```json
{"type":"log","subject":"task-001-step-01","agent_id":"vm-programmer","provider":"dingtalk","task_id":"task-001","conversation_type":"direct","conversation_id":"实际会话ID","message_phase":"execution","content":"正在读取任务记录并核对完成状态。"}
```

钉钉发送接口确认成功后：

```json
{"type":"log","subject":"outgoing-message-001","agent_id":"vm-programmer","provider":"dingtalk","task_id":"task-001","conversation_type":"direct","conversation_id":"实际会话ID","message_phase":"reply","delivery_status":"sent","content":"任务已经整理完成，结果如下……"}
```

若发送失败，将delivery_status改为failed，content保留原本准备发送的正文；界面不会标成已反馈成功。生成了答案、写入本地日志或业务执行完成，不等于已经发给钉钉，不能据此上报sent。

角色状态仍通过state/task事件更新；三阶段log事件本身不猜测任务是否完成。业务状态事件也可携带task_id与会话字段，使其作为执行日志归到对应任务。

## 可信钉钉桥接

使用相同三阶段event，外层补充已认证的机器人上下文：

```json
{
  "tenant_id":"实际企业ID",
  "app_id":"实际应用ID",
  "robot_code":"实际机器人编码",
  "conversation_type":"group",
  "conversation_id":"实际群会话ID",
  "event":{
    "type":"log",
    "subject":"incoming-message-001",
    "task_id":"task-001",
    "message_phase":"received",
    "content":"请检查接口并反馈结果。"
  }
}
```

服务端注入角色和会话字段，并按角色、会话、原任务ID规范化task_id，确保不同机器人和不同会话中的同名任务不混合。三阶段必须走同一接入方式并保持相同上下文，不能一部分走原始通用task_id、一部分走规范化桥接task_id。

## dsh / 执行器接入位置

1. 钉钉消息回调验证完成后，取原消息正文、实际会话、消息ID，生成唯一任务ID，上报received。
2. 将角色ID、会话上下文和任务ID写入任务上下文，传递给后台执行器。
3. 执行器输出在此上下文下上报execution，不能把全局进程日志或其他会话输出混进来。
4. 执行结束生成回复，调用原钉钉发送器。
5. 根据发送器结果上报reply sent/failed，并附实际回复正文。

本仓库没有线上dsh源码，不会主动读取钉钉完整历史或代替发送器确认投递。生产数据完整性取决于以上三个上报点；旧事件缺少原始消息时明确显示“原始钉钉消息尚未上报”，不会把任务摘要伪装为用户原话。

## SSE、持久化和保留

- HTTP入队、采集器单写账本、SSE推送链路不变；页面在收到该角色的日志时更新详情。
- 后端与浏览器共用frontend/assets/message-log.js做结构化记录和分组，刷新后从角色快照恢复。
- 每角色保留最近200条结构化消息，并额外保留最近20条原始任务请求，避免长执行日志把原任务立即挤掉。完整账本仍按部署策略保留。
- 相同seq回放不重复显示。调用方仍应使用稳定Idempotency-Key防止重复入账。
- 内部端口、心跳和其他角色日志不会进入所选角色的详情。
- 旧任务缺少会话关联时单独显示为旧事件，不拼接到新的钉钉任务。

## 安全边界与验收

原始消息和反馈可能涉及业务隐私。仅在受保护的页面/API/SSE入口展示；不要把生产会话、凭证、sessionWebhook、个人信息录入公开截图。正文通过textContent渲染，不执行HTML。

验收：上报两角色、同角色不同会话、同会话不同任务的三阶段数据，确认各组独立；刷新后仍有原始消息和反馈；确认无路线按钮、无全局服务日志，时间显示北京时间24小时制。截图office-latest-detail.png使用本地测试数据，未发送真实钉钉消息。

## 消息动作动画

新到达的received消息可触发员工走动、交流、休息和查阅动作，真实员工与环境同事均包含在内；不会执行系统命令，也不改变已上报的业务状态。执行日志与reply正文不会再次触发。支持说法、恢复与限制见 [VISUAL_COMMANDS.md](VISUAL_COMMANDS.md)。

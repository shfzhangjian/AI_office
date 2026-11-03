# 部署与运行手册

本文只使用通用示例，不记录生产服务器IP、域名、真实目录、拓扑或服务清单。具体配置放在服务器本地运行目录，不提交Git。

## 单机启动

```bash
cd /srv/ai-office
TOWN_DIR=/var/lib/ai-office LT_HOST=127.0.0.1 LT_PORT=3002 node server/start.js
```

Windows示例见README。只允许一个采集器写同一TOWN_DIR。默认监听回环地址；这并不能替代公网入口鉴权，反向代理或隧道可能把外部请求转为本机请求。

## PM2部署

可分别管理server/town-server.js和collector/collectord.js，两边使用一致的TOWN_DIR/TOWN_ROSTER。具体ecosystem文件保存在Git目录之外，使用本机真实路径，不向公共文档复制生产配置。已经独立运行采集器时，不要再用server/start.js启动第二个。

更新：

```bash
git pull --ff-only
pm2 restart <本地网页进程名> <本地采集进程名> --update-env
```

重启有短暂中断，应先备份运行目录并确认环境配置。页面默认优先仓库frontend/town.html，显式TOWN_HTML可覆盖，部署时确认未指向旧页面。

## 本地配置

- TOWN_DIR：运行数据路径，仓库外保存。
- TOWN_ROSTER：角色/机器人绑定文件，不包含应用密钥，不提交生产值。
- TOWN_DEFAULT_AGENT_ID：仅用于明确归属的旧任务。
- DTASK_DIR、GUARD_LOG、TUNNEL_LOG、HB_PORTS：本机采集源，不要把实际路径与服务清单贴到公开仓库。
- TOWN_WRITE_TOKEN：远程写入鉴权，放受保护环境配置中。
- TOWN_ALLOW_DEMO：生产不设置；真实数据接入后页面禁用演示。

## 公网边界

读取接口目前默认无应用内登录保护。/api/town-snapshot、事件SSE、角色/服务/绑定查询，以及配置后的日志流，可能返回任务文本、运行状态、会话身份和原始日志。公网发布必须在反向代理/访问网关保护页面、所有/api路径及SSE，不能只保护POST写入。

隧道地址不得写入公开事件摘要或录制素材；不要把无鉴权日志流直接开放。审计日志应避免保存token、sessionWebhook及完整业务数据。

## 验证

在已授权的内网或本机检查：

```bash
curl -f http://127.0.0.1:3002/town
curl -f http://127.0.0.1:3002/api/town-agents
```

还需从未登录的外部客户端验证入口确实拒绝访问，包括SSE和日志接口。本仓库无法代替对实际生产网关配置的检查。

## 时间、天气与截图

所有界面时间为北京时间24小时制。天气缓存可用node collector/weather.js周期刷新。README主截图只使用联调数据。历史介绍视频因包含运行信息已退出当前公开版本；历史提交中的副本仍需要另行处理。

回滚时只恢复已审核的代码版本，不用旧版无鉴权网页/原始生产日志作为公开演示素材。运行账本、配置、密钥和备份均应留在本地受控目录。

# 配置驱动 Agent 服务

这是一个基于 Hono 和 Pi `AgentHarness` 的云端 SSE 服务。Agent 定义从项目根目录的 [`agents.yaml`](../../agents.yaml) 加载，模型默认使用 DeepSeek。每个会话持久化到 SQLite，并拥有独立工作区。

## 启动

Node.js 22.19+。在仓库根目录执行：

```sh
pnpm install
cp apps/agent/.env.example apps/agent/.env
# 编辑 .env，设置 AGENT_TOKEN 和 DEEPSEEK_API_KEY
pnpm --filter @fanto/agent dev
```

服务默认监听 `0.0.0.0:3001`。`AGENT_SESSION_DB` 和 `AGENT_WORKSPACE_ROOT` 相对项目根目录解析；开发环境默认写入根目录 `data/agent-sessions.sqlite` 与 `data/workspaces/`。

服务只在启动时读取 `agents.yaml`。配置修改后必须重启服务，密钥只能通过环境变量注入，不能放入 YAML。

## agents.yaml

`agents` 是一个列表，每项的 `id` 是 HTTP 中使用的 `agentId`。`defaults` 与各 Agent 定义合并；模型必须存在于 Pi 内置模型目录。

```yaml
version: 1
defaults:
  provider: deepseek
  model: deepseek-v4-pro
  tools: [read, write, edit, bash]
  compaction:
    enabled: true
    reserveTokens: 16384
    keepRecentTokens: 20000
agents:
  - id: general
    description: 通用中文助手
    systemPrompt: 你是准确、简洁的中文助手。
    tools: []
    skills: []
```

可用工具为 `read`、`write`、`edit`、`bash`。每个 Agent 仅获得其配置列出的工具。`compaction` 会原样传给 Pi；三个字段分别控制是否启用、为摘要保留的 token 以及压缩后保留的最近上下文。它在使用同一 `sessionId` 的多轮对话中生效。

Skill 用 ID 声明在 `skills` 中，文件固定为 `apps/agent/skills/<id>/SKILL.md`；YAML 不能指定任意本地路径。

## HTTP / SSE

除 `GET /health` 外，接口都需要：

```text
Authorization: Bearer <AGENT_TOKEN>
```

### 运行 Agent

`POST /api/agent` 的请求体：

```json
{ "agentId": "general", "sessionId": "可选 UUID", "message": "你好" }
```

首次请求省略 `sessionId`。`start` SSE 事件会返回服务生成的 ID；后续请求传回该值以恢复对话与压缩历史。一个会话固定绑定首次使用的 `agentId`，运行中的会话返回 409。

```sh
export AGENT_TOKEN='替换为服务端 AGENT_TOKEN'

curl -N http://127.0.0.1:3001/api/agent \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"general","message":"用一句话介绍你自己"}'
```

响应事件顺序如下：

```text
event: start
data: {"sessionId":"...","agentId":"general"}

event: delta
data: {"text":"你好！"}

event: done
data: {}
```

失败时发送 `error` 而不发送 `done`。服务每 15 秒发送心跳；断连会取消运行，单次请求最长 120 秒。浏览器应使用 `fetch` 读取 POST 响应流，而不是原生 `EventSource`。

### 查询会话记录

`GET /api/sessions/:sessionId/messages` 返回该会话的消息、工具结果和上下文压缩记录。支持 `cursor`（默认 0）与 `limit`（默认 50，最大 100）分页；内部 Agent 配置条目不会返回。

```sh
curl "http://127.0.0.1:3001/api/sessions/$SESSION_ID/messages?cursor=0&limit=50" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

返回格式：

```json
{
  "success": true,
  "result": {
    "sessionId": "...",
    "agentId": "general",
    "data": [],
    "hasMore": false,
    "nextCursor": null
  }
}
```

## 工具隔离

文件工具限制在 `AGENT_WORKSPACE_ROOT/<sessionId>`。bash 使用该目录作为 cwd，不继承服务端环境，限制为 30 秒，并拒绝一组高风险命令。

开发环境使用 Node 的本地执行环境。生产环境启用 `bash` 前，必须将每个 Session 放在无特权容器或微虚拟机中，只挂载该工作区，不注入模型密钥，并限制 CPU、内存、进程数和磁盘；路径校验与命令黑名单本身不能替代宿主机隔离。

## 验证

```sh
pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build
pnpm --filter @fanto/agent start
```

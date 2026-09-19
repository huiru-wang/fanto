# 配置驱动 Agent 服务

这是一个基于 Hono 和 Pi `AgentHarness` 的云端 SSE 服务。Agent 定义从 [`apps/agent/agents.yaml`](agents.yaml) 加载，模型默认使用 DeepSeek。每个会话持久化到 SQLite，并拥有独立工作区。

## 启动

Node.js 22.19+。在仓库根目录执行：

```sh
pnpm install
cp apps/agent/.env.example apps/agent/.env
# 编辑 .env，设置 AGENT_TOKEN 和 DEEPSEEK_API_KEY
# FANTO_SERVER_BASE_URL 默认 http://127.0.0.1:3000
pnpm --filter @fanto/agent dev
```

服务默认监听 `0.0.0.0:3001`。`AGENT_SESSION_DB` 和 `AGENT_WORKSPACE_ROOT` 相对项目根目录解析；开发环境默认写入根目录 `data/agent-sessions.sqlite` 与 `data/workspaces/`。

服务只在启动时读取 `apps/agent/agents.yaml` 以及其中引用的 Prompt 文件。配置或 Prompt 修改后必须重启服务，密钥只能通过环境变量注入，不能放入 YAML。

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
  - id: main
    description: 认识用户长期记录、在需要时调用个人记忆的中文助手
    systemPromptFile: ./prompts/fanto.md
    tools: [record_get, record_list, record_search]
    skills: []

  - id: coding
    description: 在隔离工作区中执行代码任务
    systemPrompt: 先阅读相关文件，再做最小改动。
    tools: [read, write, edit, bash]
    skills: []
```

`systemPrompt` 和 `systemPromptFile` 二选一。`systemPromptFile` 必须是相对 `agents.yaml` 的配置目录内路径，运行时会读取文件内容作为最终 `systemPrompt`；Prompt 内容也参与 Agent revision 计算，因此文件内容变化会让已有 Session 在下次运行时应用新的 Agent definition。

可用工具为 `read`、`write`、`edit`、`bash`、`record_get`、`record_list`、`record_search`。每个 Agent 仅获得其配置列出的工具；当前 `main` 只开启三个只读 Record Tool，`coding` 保持文件 / shell 工具，不默认获得个人历史访问能力。`compaction` 会原样传给 Pi；三个字段分别控制是否启用、为摘要保留的 token 以及压缩后保留的最近上下文。它在使用同一 `sessionId` 的多轮对话中生效。

Skill 用 ID 声明在 `skills` 中，文件固定为 `apps/agent/skills/<id>/SKILL.md`；YAML 不能指定任意本地路径。

## Record Tools

`main` 当前通过 Business Server HTTP 使用三个只读 Record Tool：

- `record_list(limit?, cursor?)`：按时间浏览最近记录；Agent 侧默认 10 条、最大 20 条，并把每条 Record 压缩成最多约 500 字符的 preview。
- `record_search(query, limit?)`：按语义搜索历史记录的文本、图片描述和音频转写原子单元；返回 `recordId + sourceType + mediaId + snippet + distance`。
- `record_get(recordId)`：已有 Record ID 时读取完整 `content.text + content.blocks`；不会把媒体 signed URL 注入模型上下文。

Record Tool 不直接访问业务 SQLite。调用链为：

```text
Agent Tool
→ current Run Context userId / traceId
→ FantoServerClient
→ Business Server HTTP
```

`userId` 不存在于 Tool 参数中，只能来自 Session 对应的 Run Context。Business Server 地址由 `FANTO_SERVER_BASE_URL` 配置，默认 `http://127.0.0.1:3000`。Client 统一处理 `x-user-id`、可选 `x-trace-id`、15 秒 timeout、运行取消和 Fanto JSON envelope。

## HTTP / SSE

除 `GET /health` 外，接口都需要：

```text
Authorization: Bearer <AGENT_TOKEN>
X-User-Id: <用户 ID>
X-Trace-Id: <可选链路 ID，可省略>
```

### 创建 Session

先调用 `POST /api/agent/sessions` 创建 Session。请求体只包含 `agentId`；服务从 `x-user-id` 读取用户归属并写入 Pi Session，同时创建 `data/workspaces/<sessionId>` 工作区。`traceId` 只从 `x-trace-id` 读取。

```json
{ "agentId": "main" }
```

```sh
export AGENT_TOKEN='替换为服务端 AGENT_TOKEN'

SESSION_ID=$(curl -sS http://127.0.0.1:3001/api/agent/sessions \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123' \
  -H 'X-Trace-Id: trace_001' \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"main"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).result.sessionId')
```

一个 Session 固定绑定 `userId` 与工作区。流式和异步执行必须携带已有的 `sessionId`，缺失时返回 400，运行中的同一 Session 返回 409。服务重启后，旧 Session 在下一次执行时会自动应用当前 `agentId` 的模型、工具和运行配置；传入不同 `agentId` 时会自动切换到该 Agent，历史与工作区保持不变。

### 流式运行 Agent

`POST /api/agent/stream` 的请求体：

```json
{ "agentId": "main", "sessionId": "UUID", "message": "你好" }
```

```sh
curl -N http://127.0.0.1:3001/api/agent/stream \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123' \
  -H 'X-Trace-Id: trace_002' \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"main\",\"sessionId\":\"$SESSION_ID\",\"message\":\"用一句话介绍你自己\"}"
```

响应事件顺序如下。`turn_start`、`tool_start` 和 `tool_end` 表示运行阶段；工具事件只公开调用 ID、工具名和执行状态，不公开参数、返回内容、内部错误或 reasoning：

```text
event: start
data: {"sessionId":"...","agentId":"main","traceId":"trace_002"}

event: turn_start
data: {}

event: tool_start
data: {"toolCallId":"...","toolName":"record_search"}

event: tool_end
data: {"toolCallId":"...","toolName":"record_search","status":"succeeded"}

event: delta
data: {"text":"你好！"}

event: done
data: {}
```

失败时发送 `error` 而不发送 `done`。服务每 15 秒发送心跳；断连会取消运行，单次请求最长 120 秒。浏览器应使用 `fetch` 读取 POST 响应流，而不是原生 `EventSource`。

### 查询会话历史

`GET /api/agent/sessions/:sessionId/history` 返回从新到旧的可见历史。`cursor` 是上一页最后一条记录的 `seq`，首次请求不传；`limit` 默认 50，最大 100。压缩记录和内部 `fanto.*` Session 条目不会返回。

```sh
curl "http://127.0.0.1:3001/api/agent/sessions/$SESSION_ID/history?limit=50" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123'
```

返回格式：

```json
{
  "success": true,
  "result": {
    "sessionId": "...",
    "agentId": "main",
    "data": [],
    "hasMore": false,
    "nextCursor": null
  }
}
```

### 异步任务

`POST /api/agent/tasks` 立即返回 `202` 与任务元数据。任务在后台使用既有 Session 执行，状态依次为 `pending`、`running`、`completed` 或 `failed`。查询使用 `GET /api/agent/tasks/:taskId`。

```sh
TASK_ID=$(curl -sS http://127.0.0.1:3001/api/agent/tasks \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123' \
  -H 'X-Trace-Id: trace_003' \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"main\",\"sessionId\":\"$SESSION_ID\",\"message\":\"列出当前工作区的文件\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).result.id')

curl "http://127.0.0.1:3001/api/agent/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123'
```

异步任务持久化在 `agent_tasks`，与 Pi Session 共用 Agent 专用 SQLite。当前 Runner 仅适用于单实例服务；服务重启时遗留的 `running` 任务会标记为 `failed`，避免重复执行带写操作的任务。

`agents.yaml` 与 `systemPromptFile` 引用的 Prompt 都不做运行时热更新。修改 `apps/agent/agents.yaml` 或 Prompt 文件后重启 Agent 服务；无需调用 Session 状态或配置更新接口，下一次 stream 或 task 执行会自动升级旧 Session 的配置。

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

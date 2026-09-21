# 配置驱动 Agent 服务

这是一个基于 Hono 和 Pi `AgentHarness` 的云端 SSE 服务。Agent 定义从 [`apps/agent/agents.yaml`](agents.yaml) 加载，模型默认使用 DeepSeek。每个会话持久化到 SQLite，并拥有独立工作区。

核心源码按真实执行边界组织：

```text
src/
├── agent/       # definition / registry / harness / session / run / run-context
├── context/     # runtime / builder / composer / providers
├── tools/       # Pi Tool 扩展
├── fanto/       # Business Server client + schemas
├── http/        # stream / sessions / tasks
├── tasks/       # async task repository + runner
├── workspace/   # path / bash policy
├── app.ts
└── main.ts
```

Pi Agent 是固定执行引擎，不额外维护 Runtime / Adapter 抽象。

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

`models` 与 `agents` 是同级列表。模型引用固定写作 `provider/model`，例如 `deepseek/deepseek-v4-pro`；每个 Agent 必须通过 `model_id` 引用 `models` 中的对应组合。服务启动时会校验模型引用和 Pi 内置模型目录，且强制要求存在 `main` Agent；缺少 `main` 会直接启动失败。HTTP 请求可省略 `agentId`，此时固定使用 `main`。API Key 不写入 YAML，由各 Provider 的环境变量或凭据存储提供。

```yaml
version: 1
models:
  - provider: deepseek
    model: deepseek-v4-pro
agents:
  - id: main
    model_id: deepseek/deepseek-v4-pro
    description: 认识用户长期记录、在需要时调用个人记忆的中文助手
    corePromptFile: ./prompts/core.md
    systemPromptFile: ./prompts/operational.md
    tools: [record_get, record_list, record_search, present_media, preference_manage]
    skills: []
    compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }

  - id: coding
    model_id: deepseek/deepseek-v4-pro
    description: 在隔离工作区中执行代码任务
    systemPrompt: 先阅读相关文件，再做最小改动。
    tools: [read, write, edit, bash]
    skills: []
    compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }
```

`systemPrompt` 和 `systemPromptFile` 二选一。可选的 `corePromptFile` 会在它们之前拼入最终 system prompt。两个 Prompt 文件都必须位于 `agents.yaml` 的配置目录内，并参与 Agent revision；修改后重启服务，已有 Session 会在下次运行时应用新定义。

可用工具为 `read`、`write`、`edit`、`bash`、`record_get`、`record_list`、`record_search`、`present_media`、`preference_manage`。每个 Agent 仅获得其配置列出的工具；当前 `main` 开启三个只读 Record Tool、`present_media` 与 `preference_manage`，`coding` 保持文件 / shell 工具，不默认获得个人历史或长期偏好访问能力。`compaction` 会原样传给 Pi；三个字段分别控制是否启用、为摘要保留的 token 以及压缩后保留的最近上下文。它在使用同一 `sessionId` 的多轮对话中生效。

Skill 用 ID 声明在 `skills` 中，文件固定为 `apps/agent/skills/<id>/SKILL.md`；YAML 不能指定任意本地路径。

## Context Runtime

`main` 由 `corePromptFile: ./prompts/core.md` 提供认识与关系原则，由 `systemPromptFile: ./prompts/operational.md` 提供工具规则和动态区块。模板包含四个运行时插槽：

```text
{{character}}
{{current_time}}
{{user_preferences}}
{{relevant_memory}}
```

每次 stream / task 的 Agent Run 开始前，`agent/run.ts` 只执行一次 Context Build：

1. CharacterProvider 返回默认 `natural` 表达风格；
2. CurrentTimeProvider 按请求的 `X-Time-Zone` 生成当前日期、时间和星期；
3. PreferenceProvider 从 Business Server 读取当前用户最多 20 条长期偏好；
4. MemoryProvider 用 `deepseek-v4-flash` 结合当前消息与最近最多约 4 轮对话重写 0–2 条查询，复用 `POST /api/records/search`，按真实 `recordId` 去重并只保留最相关 2 条；注入前按同一时区格式化 `eventAt`；
5. Context Runtime 返回独立的 Context fragments；
6. Context Composer 将 fragments 替换到四个插槽，得到本次 Run 固定的 System Prompt；
7. `runAgent()` 调用 Pi `lane.prompt()` 进入 Agent Loop。

Context Runtime 只负责构建本次 Run 的 Context fragments，不等同于 System Prompt。Composer 负责把 fragments 注入 Prompt 模板；进入 Pi Agent Loop 后不会再次执行 Provider，因此 Tool 调用后不会重新搜索 Memory，也不会因为 `preference_manage` 写入而刷新本轮 Context。

## Record Tools

`main` 当前通过 Business Server HTTP 使用三个只读 Record Tool 与一个媒体展示 Tool：

- `record_list(limit?, cursor?)`：按时间浏览最近记录；Agent 侧默认 10 条、最大 20 条，并把每条 Record 压缩成最多约 500 字符的 preview。
- `record_search(query, limit?)`：按语义搜索历史记录的文本、图片描述和音频转写原子单元；返回 `recordId + sourceType + mediaId + snippet + eventAt + distance`。
- `record_get(recordId)`：已有 Record ID 时读取完整 `content.text + content.blocks`；不会把媒体 signed URL 注入模型上下文。
- `present_media(mediaIds)`：只接受 Record Tool 返回的 mediaId；用户明确要求查看 / 播放时可用，或 Agent 判断媒体能自然补充当前回答时可主动调用。运行时通过 `GET /api/media/:id/meta` 校验用户归属和 ready 状态，并把稳定的 `mediaType / mimeType / capture` 写入原生 Tool Result `details`。signed URL 不进入 Session。
- `preference_manage(...)`：只在用户当前消息明确表达长期偏好或管理请求时创建、更新、删除 Preference。模型不能填写 `userId / sessionId / sourceMessageId`，且 `sourceQuote` 必须逐字来自当前用户消息；成功后 Tool Result 返回最新 Preference 列表，但本轮 System Prompt 保持不变。

这些 Tool 不直接访问业务 SQLite。调用链为：

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
X-Time-Zone: <可选 IANA 时区，如 Asia/Shanghai；缺失或无效时为 UTC>
```

### 创建 Session

先调用 `POST /api/agent/sessions` 创建 Session。请求体的 `agentId` 可省略，省略时使用 `main`；服务从 `x-user-id` 读取用户归属并写入 Pi Session，同时创建 `data/workspaces/<sessionId>` 工作区。`traceId` 只从 `x-trace-id` 读取。

```json
{ "agentId": "main" }
```

```sh
export AGENT_TOKEN='替换为服务端 AGENT_TOKEN'

SESSION_ID=$(curl -sS http://127.0.0.1:3001/api/agent/sessions \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: default-user' \
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
  -H 'X-User-Id: default-user' \
  -H 'X-Trace-Id: trace_002' \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"main\",\"sessionId\":\"$SESSION_ID\",\"message\":\"用一句话介绍你自己\"}"
```

响应事件顺序如下。`turn_start`、`tool_start` 和 `tool_end` 表示运行阶段；普通工具事件只公开调用 ID、工具名和执行状态，不公开参数、返回内容、内部错误或 reasoning。成功的 `present_media` 是唯一例外，其 `tool_end` 会额外公开经过白名单映射的稳定媒体 metadata：

```text
event: start
data: {"sessionId":"...","agentId":"main","traceId":"trace_002"}

event: turn_start
data: {}

event: tool_start
data: {"toolCallId":"...","toolName":"record_search"}

event: tool_end
data: {"toolCallId":"...","toolName":"record_search","status":"succeeded"}

event: tool_end
data: {"toolCallId":"...","toolName":"present_media","status":"succeeded","result":{"items":[{"mediaId":"...","mediaType":"image","mimeType":"image/jpeg","width":1200,"height":800}]}}

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
  -H 'X-User-Id: default-user'
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
  -H 'X-User-Id: default-user' \
  -H 'X-Trace-Id: trace_003' \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"main\",\"sessionId\":\"$SESSION_ID\",\"message\":\"列出当前工作区的文件\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).result.id')

curl "http://127.0.0.1:3001/api/agent/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: default-user'
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

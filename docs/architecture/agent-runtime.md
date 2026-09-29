# Agent Runtime

当前 Agent Runtime 位于 `apps/server/src/agent/`，由 Business Server 同一 Hono 进程提供 `/api/agent/*`。

## 组成

```mermaid
flowchart TD
  HTTP[Server Agent Route] --> AUTH[Server JWT / principal]
  AUTH --> REG[Agent Registry]
  HTTP --> SM[Session Manager]
  HTTP --> RUN[Agent Run]
  HTTP --> TR[Task Runner]
  TR --> RUN
  REG --> DEF[Config-loaded Agent definitions]
  DEF --> YAML[apps/server/agent.yaml]
  YAML --> PROMPTS[apps/server/src/agent/prompts/*.ts]

  SM --> HARNESS[buildRuntime]
  HARNESS --> PI[Pi AgentHarness / Lane]
  SM --> DB[(Agent SQLite)]
  SM --> WS[Session Workspace]

  RUN --> RC[createRunContext]
  HARNESS --> SP[Dynamic System Prompt]
  RC --> SP
  SP --> CHAR[CharacterProvider]
  SP --> PREF[PreferenceProvider]
  SP --> MEM[MemoryProvider / recent]
  PREF --> B[Agent Business Services]
  MEM --> B
  RUN --> PI
  PI --> TC[transform_context / messages view]

  PI --> TOOLS[Configured Pi Tools]
  TOOLS --> BUILTIN[read / write / edit / bash]
  TOOLS --> RECORD[record_get / record_list / record_search]
  TOOLS --> PM[preference_manage]
  TOOLS --> PRESENT[present_media]
  RECORD --> B
  PM --> B
  PRESENT --> B
  B --> SERVICE[Record / Media / Preference Service]
  PI --> SKILLS[Skills]
```

## Agent Definition

`apps/server/agent.yaml` 是当前 Server Agent 定义入口。它引用受限的 TypeScript Prompt 模块名；`apps/server/src/agent/harness/definition.ts` 在 Server 启动时加载模块、校验模型、Tool、Skill 与 revision。定义包含：

- model_id；
- systemPrompt，或受限的 TypeScript Prompt 模块引用；
- tools；
- skills；
- compaction 配置。

`main` 是必需的默认 Agent；配置缺少它时服务启动失败。创建 Session、stream 与 task 请求可省略 `agentId`，此时固定使用 `main`。

当前 Tool schema 接受：

```text
read
write
edit
bash
record_get
record_list
record_search
present_media
preference_manage
```

当前 `main` 是 Fanto 面向用户的长期对话 Agent，开启三个只读 Record Tool、`present_media` 与 `preference_manage`；`coding` 只开启 `read / write / edit / bash`。Fanto 的认识与关系 Core 位于 `apps/server/src/agent/prompts/core.ts`，操作规则与动态插槽位于 `apps/server/src/agent/prompts/operational.ts`；`apps/server/agent.yaml` 分别通过 `corePromptModule` 与 `systemPromptModule` 在启动期拼成最终 Prompt。操作模板包含 `{{character}}`、`{{current_time}}`、`{{user_preferences}}`、`{{recent_memory}}` 四个运行时插槽。Tool 权限仍由 Agent definition 显式声明。

Core 与 operational Prompt 在启动期按固定顺序合并为最终 `systemPrompt`，并参与 Agent revision 计算；修改 Prompt 后需要重启 Server。

Skill 通过 ID 映射到与 `apps/server/agent.yaml` 同级的 `apps/server/skills/<id>/SKILL.md`。密钥不写入 YAML。

## Context

`context/index.ts` 对 Harness 暴露 `createRunContext`、`createSystemPrompt`、`createTransformContext` 与 `createContextProviders`；各 Provider 的具体组合和构造依赖收敛在 `context/providers/index.ts`。`harness/run.ts` 是唯一执行入口：它在调用 Runtime `prompt()` 前创建包含 runId、用户、query、Session、时区、最近消息和 slot store 的 Chord Context，并作为 Pi prompt 的第三参传入。

`harness/build-runtime.ts` 在创建 Harness 时注册 System Prompt 回调。首次回调从 Run Context 解析模板引用的 `{{slot}}`，只选择被引用的自声明 Provider 并行执行，得到 `{ slot, content }` 后填充模板。缺少 Provider、空内容或普通 Provider 失败填 `（无）`；取消会中止 Run。结果按 run 缓存，所以该 Run 后续 turn 不再解析模板或运行 IO。

当前只有包含 Context 插槽的 Prompt 才会触发 Provider；因此 `coding` Agent 不会执行用户 Preference / Memory 查询。

- CharacterProvider 返回当前默认 `natural` 表达风格，不使用数据库。
- CurrentTimeProvider 以请求的 `X-Time-Zone` 生成当前日期、时间和星期；缺失或无效时使用 UTC。
- PreferenceProvider 读取当前用户最多 20 条已保存 Preference；热路径命中 Preference 读缓存。
- MemoryProvider 当前使用代码内固定的 `recent` 模式，调用 `listRecords(limit=10)` 且不传 cursor，因此可直接命中 Record 首页前 10 条缓存；Run 前不再调用额外模型或向量搜索。
- Recent Memory 只包含真实 `recordId`、时间、截断正文，以及媒体的真实 `mediaId` 和截断图片描述 / 音频转写。已给出的 `mediaId` 可直接用于 `present_media`；需要完整内容时使用 `record_get`，需要主题相关历史时由主模型主动使用 `record_search`。
- `PiQueryRewriter` 与 MemoryProvider 的 `relevant` 模式仍保留在代码中，但 main Agent 当前不使用，也不通过 Agent 配置切换。

`transform_context` 已在 Harness Hook 中接入，当前默认 pass。它只允许返回 messages 请求视图，可用于裁剪、重排、注入或脱敏；不会写回 transcript，也不能修改 System Prompt。后续 Tool / Model turn 不重新执行 Provider，也不会因为 `preference_manage` 成功而刷新本轮 Context。

## Session

调用方必须先通过 `POST /api/agent/sessions` 创建 Session，再用同一 `sessionId` 发起 stream。

每个 Session 绑定：

- `userId`；
- 当前 `agentId`；
- Agent definition revision；
- 独立 workspace。

绑定信息保存在 Pi Session 的 `fanto.session_owner` custom entry。旧 Session 在下一次执行时可以应用当前 Agent revision；如果调用方指定另一个 Agent，空闲 Session 可以切换 Agent，同时保留历史和工作区。

同一 Session 同时只允许一个运行。Session Manager 不负责执行 Prompt；`harness/run.ts` 是唯一执行入口。

## 执行方式

### Stream

`POST /api/agent/stream` 使用 POST 响应体 SSE。除 `start`、`delta`、`done` / `error` 外，还会发送 Pi 运行阶段的 `turn_start`、`tool_start` 和 `tool_end`。普通工具事件只公开 `toolCallId`、`toolName` 与成功/失败状态；唯一例外是成功的 `present_media`，其 `tool_end` 会额外返回经过白名单映射的稳定媒体 metadata，供客户端渲染。Record Tool 参数、结果、内部错误与 reasoning 仍不对客户端公开。断连会取消执行，单次请求有超时限制。

## 历史

Session History 直接读取 Pi Session entry，以 `seq` 倒序分页。内部 `fanto.*` 条目和 compaction 记录不作为普通可见历史返回，敏感字段在对外响应前脱敏。

## Workspace 与安全

文件工具固定工作在 `AGENT_WORKSPACE_ROOT/<sessionId>`。bash 使用该目录作为 cwd、最小环境、超时和危险命令限制。

这些措施不等于宿主机隔离。生产环境如果启用 bash，需要使用无特权容器或微虚拟机，将 Session 工作区作为受控挂载，并限制 CPU、内存、进程与磁盘。

## 与 Fanto 业务数据的当前关系

Agent Runtime 不连接业务数据库，也不调用 Server HTTP API。`business-services.ts` 将 Tool / Provider 所需的最小能力适配到领域 Service：

```text
record_list / record_get / record_search → RecordService
preference_manage                       → PreferenceService
present_media                            → MediaService
```

每次 prompt 已把 Server JWT 验证后的 Session owner `userId` 与可选 `traceId` 写入 Pi Run Context。Record Tool、`present_media` 与 `preference_manage` 都从当前 Tool execution Context 读取这些值；LLM Tool schema 不包含 `userId`。Preference Tool 的 `sessionId` / `sourceMessageId` 同样来自当前 Run Context，模型只提供动作、业务 ID/version、偏好内容与当前用户消息中的逐字 `sourceQuote`。其中 `present_media` 的 Tool Call 只接受 `mediaIds`，真实 `mediaType / mimeType / capture` 被写入原生 Tool Result `details`，不会保存短期 OSS signed URL。

客户端 Access Token 由 Server 的统一鉴权中间件验证，不进入 Run Context。Runtime 不使用内部 HTTP Client、`FANTO_SERVER_BASE_URL`、`FANTO_SERVER_API_TOKEN`、`X-API-Token` 或 `X-User-Id`。

接口和运行示例见 [HTTP API](../api/http-api.md#agent-runtime)。

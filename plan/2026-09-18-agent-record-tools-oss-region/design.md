# Fanto Agent Record Tools 设计

## 1. 目标

本 PLAN 只关注 Agent Runtime 如何安全、清晰地访问 Fanto Record。

本轮给 main Agent 提供三个只读业务 Tool：

- record_get
- record_list
- record_search

目标：

- 查看最近记录；
- 按语义回忆历史记录；
- 已知 Record ID 时读取完整内容；
- 始终使用当前 Session 对应用户身份访问 Business Server；
- 不允许 LLM 自由填写 userId；
- Agent 不直接访问业务数据库或 sqlite-vec。

本轮不再包含 Memory/向量改造或 Server Search API 开发。

---

## 2. 最新状态

### 2.1 Business Server 已具备全部依赖 API

当前已经存在：

~~~http
GET  /api/records?limit=&cursor=
GET  /api/records/:id
POST /api/records/search
~~~

Search 请求只需要 query / limit，返回 recordId + snippet。因此本轮不修改 Business Server Record API。

### 2.2 Memory user-scoped retrieval 已完成

当前已经：

- 使用 MemoryService / MemoryIndex / EmbeddingProvider 边界；
- sqlite-vec 使用 user_id TEXT PARTITION KEY；
- KNN candidate generation 从一开始限定当前用户；
- metadata 再次校验 user_id / type / status；
- POST /api/records/search 已注册到生产 Composition Root。

因此本轮不修改 Memory 模块、不修改 vector schema。

### 2.3 Agent Runtime 当前状态

当前 apps/agent：

- 独立 Hono + Pi AgentHarness Runtime；
- Session 固定绑定 userId；
- 每次 prompt 已通过 createRunContext() 写入 userId / taskId? / traceId?；
- Tool Registry 当前只有 read / write / edit / bash；
- main Agent 当前没有 Tool；
- Agent Runtime 当前不访问 Business Server。

---

## 3. 目标链路

~~~mermaid
flowchart LR
  U[User] --> A[Agent Runtime]
  A --> C[Run Context]
  A --> T[Record Tools]
  T -->|read userId / traceId| C
  T --> F[FantoServerClient]
  F -->|HTTP + x-user-id| S[Business Server]
  S --> R[Record Repository]
  S --> M[Memory]
~~~

唯一允许的业务访问路径：

~~~text
LLM
→ Agent Tool
→ Run Context Identity
→ FantoServerClient
→ Business Server
~~~

禁止：

~~~text
Agent → SQLite
Agent → sqlite-vec
Agent → RecordRepository
Agent → MemoryIndex
~~~

---

## 4. 目录设计

保持最小结构：

~~~text
apps/agent/src/
├── clients/
│   └── fanto-server-client.ts
├── tools/
│   ├── record-tools.ts
│   └── registry.ts
└── harness/
    └── run-context.ts
~~~

三个 Record Tool 放在一个 record-tools.ts 中。当前只有三个同领域、共享 Client 和 DTO 映射的小 Tool，没有必要先建立通用 Business Tool Framework。

## 5. Run Context：用户身份唯一来源

当前每次执行已经调用：

~~~ts
createRunContext({
  userId: session.userId,
  taskId,
  traceId,
})
~~~

Pi 的 AgentHarnessTool.execute 最后一个参数就是当前 turn 的 Context。

因此只需要给 run-context.ts 增加读取 helper：

~~~ts
requireRunMetadata(context)
~~~

语义：

- 从 context.value(userIdContextKey) 读取 userId；
- 读取可选 taskId / traceId；
- 缺少 userId 时 fail closed。

不使用：

- AsyncLocalStorage；
- 全局 currentUser；
- Tool 参数里的 userId；
- 第二套 Session User 状态；
- 静态 toolContext 中复制 userId。

userId / traceId / taskId 是每次 Run 的上下文，不应该成为新的状态源。

---

## 6. FantoServerClient

新增：

~~~text
apps/agent/src/clients/fanto-server-client.ts
~~~

### 6.1 职责

只负责 Business Server HTTP transport：

- Base URL；
- x-user-id；
- 可选 x-trace-id；
- JSON request / response；
- Fanto response envelope 解包；
- HTTP error；
- network error；
- timeout；
- cancellation。

三个 Tool 中不重复写 fetch / Header / envelope 逻辑。

### 6.2 配置

新增：

~~~env
FANTO_SERVER_BASE_URL=http://127.0.0.1:3000
~~~

写入 apps/agent/.env.example。

本轮不增加 FANTO_SERVER_TIMEOUT_MS。Client 内使用约 15 秒默认 timeout。

启动时校验 Base URL 是合法 HTTP / HTTPS URL。

### 6.3 普通 Request Context

Client 不依赖 Pi Context，接收普通对象：

~~~ts
type FantoRequestContext = {
  userId: string;
  traceId?: string;
  signal?: AbortSignal;
};
~~~

Record Tool 负责：

~~~text
Pi Context
→ requireRunMetadata
→ FantoRequestContext
→ FantoServerClient
~~~

这样 HTTP Client 可以独立单测。

### 6.4 Cancellation

Tool execute 收到的 Context 提供当前执行取消信号。

Client 将 caller signal 与自己的 timeout 合并。

目标：

- Agent Run 被取消时 HTTP 请求一起取消；
- Business Server 卡住时 Client timeout；
- 不产生脱离 Agent Run 的悬挂请求。

### 6.5 Header

统一发送：

~~~text
x-user-id: current session user
x-trace-id: trace id, if present
content-type: application/json 仅 POST
~~~

Business Server 当前真正依赖的是 x-user-id。

x-trace-id 当前 Server 尚未消费；本轮只保留透传边界，不修改 Server。

### 6.6 API

Client 直接围绕当前业务 API：

~~~ts
getRecord(ctx, recordId)

listRecords(ctx, {
  limit,
  cursor,
})

searchRecords(ctx, {
  query,
  limit,
})
~~~

不设计 GenericHttpClient / GenericBusinessResourceClient。

---

## 7. Client 错误语义

Pi Tool 失败时应该 throw，而不是把错误当正常 content 返回。

目标链：

~~~text
FantoServerClient error
→ Record Tool throw
→ Pi Harness
→ toolResult isError=true
~~~

Client 可以定义一个简单 FantoServerClientError，区分：

- http
- network
- timeout
- protocol

可带 status / errorCode。

对模型暴露的错误信息保持短且安全，例如：

~~~text
Record not found or not accessible
Fanto Server request timed out
Fanto Server is temporarily unavailable
Invalid response from Fanto Server
~~~

不要把完整 response、Header、stack 或凭据写进 Tool Result。

---

## 8. Tool 参数

三个 Tool 都不包含：

~~~text
userId
traceId
taskId
~~~

这些全部来自 Run Context。

自定义 Pi Tool 参数使用 TypeBox schema。

apps/agent 应显式增加 typebox 直接依赖，不依赖 pnpm 的传递依赖。

## 9. record_get

用途：

> 已经知道 Record ID，需要完整读取原始内容。

Schema：

~~~ts
{
  recordId: string
}
~~~

调用：

~~~http
GET /api/records/:id
~~~

Tool description 要明确：

> Only use this when a record ID is already known. Do not use it to discover history.

典型链路：

~~~text
record_search / record_list
→ recordId
→ record_get
~~~

---

## 10. record_list

用途：

- 我最近记录了什么？
- 看看最新几条记录。
- 继续看下一页。

Schema：

~~~ts
{
  limit?: integer,
  cursor?: string
}
~~~

Agent Tool 自身限制：

~~~text
default limit = 10
max limit = 20
~~~

虽然 Server 支持 100，但不应该一次把 100 条 Record 注入模型上下文。

cursor 是 opaque value，只用于继续上一次 list 返回的下一页。

语义：

~~~text
record_list
→ chronological / recent

record_search
→ semantic / related history
~~~

---

## 11. record_search

用途：

- 我以前有没有想过 AI Coding？
- 以前记录过装修预算吗？
- 我之前对换工作的看法是什么？

Schema：

~~~ts
{
  query: string,
  limit?: integer
}
~~~

限制：

~~~text
default limit = 10
max limit = 20
~~~

调用：

~~~http
POST /api/records/search
~~~

不暴露：

- embedding；
- distance；
- threshold；
- topK 内部实现；
- sqlite-vec；
- rerank。

---

## 12. Tool Result：模型 DTO 与 Server DTO 分离

Business Server DTO 不等于 LLM 最优输入。

Agent Tool 做轻量 projection。

### 12.1 record_get

模型结果：

~~~json
{
  "recordId": "...",
  "eventAt": "...",
  "source": "home",
  "status": "processed",
  "content": {
    "text": "...",
    "blocks": []
  }
}
~~~

默认不返回：

- media[].url；
- signed media URL；
- 重复 ASR projection；
- Server 内部字段。

AI 可读正文已经在 content.blocks。

### 12.2 record_list

不要返回 10–20 条完整 Record。

返回：

~~~json
{
  "data": [
    {
      "recordId": "...",
      "eventAt": "...",
      "source": "home",
      "status": "processed",
      "preview": "..."
    }
  ],
  "hasMore": true,
  "nextCursor": "..."
}
~~~

preview 从 Record content 生成：

~~~text
text
+ image description
+ audio transcription
~~~

建议每条最多约 500 字符。

需要完整内容再调用 record_get。

### 12.3 record_search

Server 已经返回：

~~~json
{
  "recordId": "...",
  "snippet": "..."
}
~~~

Tool 直接保留，不添加 distance。

### 12.4 Pi Tool Result

正常结果建议：

~~~ts
{
  content: [
    {
      type: "text",
      text: JSON.stringify(result),
    }
  ],
  details: result,
}
~~~

模型得到稳定 JSON，Runtime / debug 仍有结构化 details。

---

## 13. Tool Registry

当前：

~~~text
ToolRegistry.create(names, workspace)
~~~

目标：

~~~text
new ToolRegistry(fantoServerClient)
~~~

Registry 继续只负责：

~~~text
tool name
→ AgentHarnessTool
~~~

支持：

~~~text
read
write
edit
bash
record_get
record_list
record_search
~~~

业务 Client 只在 Composition Root 注入，不进入：

- HTTP Route；
- Session Manager；
- agents.yaml；
- workspace；
- static Pi toolContext。

## 14. Composition Root

目标：

~~~text
FANTO_SERVER_BASE_URL
→ FantoServerClient
→ ToolRegistry
→ HarnessFactory
→ AgentHarness
~~~

Client 生命周期与 Agent Runtime 进程一致。

---

## 15. Agent Config

agent-config.ts 的 Tool enum 从：

~~~text
read
write
edit
bash
~~~

扩展为：

~~~text
read
write
edit
bash
record_get
record_list
record_search
~~~

每个 Agent 仍只能使用 agents.yaml 显式声明的 Tool。

revision hash 已基于完整 Agent Definition 计算，因此 tools 变化会自然产生新 revision，不需要新状态机制。

---

## 16. agents.yaml 权限

main：

~~~yaml
tools: [record_get, record_list, record_search]
~~~

coding：

~~~yaml
tools: [read, write, edit, bash]
~~~

不默认给 coding Agent 用户个人历史访问能力。

---

## 17. main 的 Tool Routing Guidance

本轮只增加和 Record Tool 选择相关的最小 Prompt：

~~~text
当回答确实需要用户过去的记录时，再使用 Record Tools。

- 最近 / 时间顺序的问题：优先 record_list。
- 某个主题、经历、想法是否以前出现过：优先 record_search。
- 已经有 recordId，需要完整内容：使用 record_get。
- search/list 结果已经足够时，不要为了多调用工具继续 get。
- 不要为了表现记得用户而机械搜索历史。
- 搜索不到时，不要声称用户以前记录过。
- 引用历史时，区分用户记录过的内容和当前推断。
~~~

这只是 Tool routing guidance，不扩展新的复杂人格系统。

---

## 18. userId 安全边界

可信链：

~~~text
Agent HTTP X-User-Id
→ Session Owner
→ ManagedSession.userId
→ createRunContext
→ Record Tool
→ FantoServerClient
→ Business Server x-user-id
~~~

LLM 只能提供：

~~~text
recordId
query
limit
cursor
~~~

不能提供 userId。

当前 Business Server 的 x-user-id 仍然是开发期用户隔离，不是正式认证。

Service-to-Service 正式认证需要 Business Server 一起改造，本轮不做。

但所有 Record HTTP 都封装在 FantoServerClient 中，未来增加内部认证 Header 时无需改三个 Tool。

---

## 19. 测试设计

### 19.1 Run Context

验证：

- userId 可以从 Context 读取；
- traceId 可选；
- taskId 可选；
- 缺少 userId 时 fail closed。

### 19.2 FantoServerClient

建议允许注入 fetchImpl，便于 deterministic unit test。

验证：

- base URL；
- 自动 x-user-id；
- 可选 x-trace-id；
- GET Record；
- GET List query；
- POST Search body；
- success envelope；
- 4xx / 404；
- 5xx；
- success=false；
- malformed JSON / envelope；
- network failure；
- timeout / abort。

### 19.3 Record Tools

使用 Fake FantoServerClient。

record_get：

- schema 只有 recordId；
- 调 client.getRecord；
- 输出 text / blocks；
- 不输出 media signed URL。

record_list：

- default limit；
- max 20；
- cursor；
- preview 生成；
- preview 截断；
- hasMore / nextCursor。

record_search：

- query；
- default limit；
- max 20；
- recordId / snippet；
- 无 distance / userId。

### 19.4 Config / Registry

验证：

- config 接受三个新 Tool；
- duplicate Tool 仍被拒绝；
- main 可以启用 Record Tool；
- coding 未声明时没有 Record Tool；
- Registry 只创建显式声明的 Tool。

### 19.5 Tool Selection

不要把真实模型选择 Tool 作为 CI 强依赖。

确定性测试检查：

- Tool description；
- main systemPrompt；
- active tool set。

真实模型只做 smoke：

~~~text
“我最近记录了什么？”
→ record_list

“我之前有没有想过 AI Coding？”
→ record_search

“详细看看刚才第一条。”
→ record_get
~~~

并验证无关问题不会机械调用 Record Tool。

## 20. 预期文件变化

~~~text
apps/agent/
├── .env.example
├── README.md
├── agents.yaml
├── package.json
│
├── src/
│   ├── bootstrap/
│   │   └── main.ts
│   ├── clients/
│   │   └── fanto-server-client.ts
│   ├── config/
│   │   └── agent-config.ts
│   ├── harness/
│   │   └── run-context.ts
│   └── tools/
│       ├── record-tools.ts
│       └── registry.ts
│
└── test/
    ├── config.test.ts
    ├── fanto-server-client.test.ts
    └── record-tools.test.ts
~~~

如果 Run Context 测试很小，可放入 record-tools.test.ts，不为了文件数量单独拆。

---

## 21. 实施顺序

### Phase 1：Context + Client

- Run Context 读取 helper；
- FantoServerClient；
- FANTO_SERVER_BASE_URL；
- Client tests。

### Phase 2：Record Tools

- record_get；
- record_list；
- record_search；
- Tool DTO projection；
- Tool tests。

### Phase 3：Registry + Config

- Tool enum；
- ToolRegistry；
- Composition Root；
- main enable Record Tools；
- coding 保持原权限。

### Phase 4：Tool Routing Guidance

- main systemPrompt 增加最小选择规则。

### Phase 5：Regression + Smoke

- Agent typecheck；
- Agent test；
- Agent build；
- 仓库级 typecheck / test；
- Business Server + Agent Runtime 联调；
- 三个典型 Prompt smoke。

### Phase 6：Current Docs

代码真实接入后做 Documentation Impact Review，重点检查：

~~~text
apps/agent/README.md
docs/architecture/agent-runtime.md
docs/product/current-scope.md
docs/api/http-api.md
~~~

Record Search HTTP contract 已经正确，本轮不重复修改 Server contract。

---

## 22. Definition of Done

- Agent Runtime 有统一 FantoServerClient；
- 新增 FANTO_SERVER_BASE_URL；
- Tool 从当前 Pi Context 获取 userId；
- Tool 参数中不存在 userId；
- Run cancellation 可以取消 Business Server request；
- Client 有 timeout；
- record_get 可用；
- record_list 可用；
- record_search 可用；
- list 返回 compact preview；
- get 不输出无必要 signed media URL；
- search 不暴露 vector distance；
- Agent config 支持三个新 Tool；
- main 启用三个 Record Tool；
- coding 不获得 Record Tool；
- main 有最小 Tool routing guidance；
- Client / Tool / Registry 测试通过；
- Agent typecheck / test / build 通过；
- 仓库级 typecheck / test 通过；
- 至少一次真实 Business Server + Agent Runtime 联调通过；
- 实施后完成 Current Docs Review。

---

## 23. 明确不做

本轮不做：

- Business Server Record API 改造；
- Memory / Vector 改造；
- Record create/update/delete Tool；
- Creation / Proposal Tool；
- Generic Business Tool Framework；
- Tool 权限系统重构；
- Service-to-Service 正式认证；
- Hybrid Search；
- Reranker；
- heartbeat / proactive agent；
- Agent SSE Tool Call 对外协议；
- 前端 Tool 状态展示。

---

## 24. 核心判断

这轮真正需要建立的不是三个散落的 fetch，而是：

~~~text
LLM
→ Agent Tool
→ Run Context Identity
→ FantoServerClient
→ Business Server
~~~

以后增加 creation_search / creation_get / proposal_list 时，可以复用同一身份和 HTTP 边界，但当前不提前为这些未来能力建立抽象。

# Fanto Agent Record Tools 任务清单

## 已完成前置条件

以下能力已经存在，本 PLAN 不再重复实现：

- [x] GET /api/records
- [x] GET /api/records/:id
- [x] POST /api/records/search
- [x] Memory user-scoped retrieval
- [x] sqlite-vec user_id partition key
- [x] Record Search HTTP user isolation

本轮只实现 Agent Runtime 侧 Record Tools。

---

## P0-1：Run Context 读取

修改：

~~~text
apps/agent/src/harness/run-context.ts
~~~

- [x] 增加 requireRunMetadata(context)
- [x] 读取 userId
- [x] 读取可选 traceId
- [x] 读取可选 taskId
- [x] 缺 userId 时 fail closed
- [x] 不使用 AsyncLocalStorage
- [x] 不建立第二套 current-user 状态

验收：

~~~text
Tool execute Context
→ current Session userId
~~~

---

## P0-2：FantoServerClient

新增：

~~~text
apps/agent/src/clients/fanto-server-client.ts
~~~

配置：

- [x] apps/agent/.env.example 增加 FANTO_SERVER_BASE_URL=http://127.0.0.1:3000
- [x] Bootstrap 校验 Base URL
- [x] 默认 timeout 约 15 秒
- [x] 不增加无必要 timeout env

能力：

- [x] 定义 FantoRequestContext
- [x] userId → x-user-id
- [x] traceId → 可选 x-trace-id
- [x] 支持 caller AbortSignal
- [x] caller signal 与 timeout 合并
- [x] 统一解析 response envelope
- [x] 非 2xx 抛 Client Error
- [x] success=false 抛 Client Error
- [x] network / timeout / protocol error 有稳定语义
- [x] 错误不泄漏完整 response / header / secret

方法：

- [x] getRecord(ctx, recordId)
- [x] listRecords(ctx, { limit, cursor })
- [x] searchRecords(ctx, { query, limit })

验收：三个 Tool 不自行写 fetch / Header / envelope。

---

## P0-3：自定义 Tool Schema 基础

- [x] @fanto/agent 显式增加 typebox 依赖
- [x] 自定义 Tool 使用 Pi AgentHarnessTool
- [x] 所有 Tool schema 不包含 userId
- [x] Tool 失败直接 throw，不返回伪成功 error content

---

## P0-4：record_get

在：

~~~text
apps/agent/src/tools/record-tools.ts
~~~

实现：

- [x] 参数只有 recordId
- [x] 从 Run Context 获取用户身份
- [x] 调 FantoServerClient.getRecord
- [x] 输出 recordId / eventAt / source / status / content
- [x] 保留 text / blocks
- [x] 不默认输出 signed media URL
- [x] description 强调已有 Record ID 时才使用

---

## P0-5：record_list

实现：

- [x] limit?
- [x] cursor?
- [x] default limit = 10
- [x] max limit = 20
- [x] 调现有 Record List API
- [x] 输出 recordId / eventAt / source / status / preview
- [x] preview 组合 text / image description / audio transcription
- [x] 单条 preview 最多约 500 字符
- [x] 返回 hasMore / nextCursor
- [x] description 明确最近 / 时间顺序语义

第一版不增加 date range / status filter / source filter。

## P0-6：record_search

实现：

- [x] query
- [x] limit?
- [x] default limit = 10
- [x] max limit = 20
- [x] 调 POST /api/records/search
- [x] 输出 recordId + snippet
- [x] 不输出 distance
- [x] 不暴露 threshold / embedding / topK
- [x] description 明确语义历史检索用途

---

## P0-7：ToolRegistry

修改：

~~~text
apps/agent/src/tools/registry.ts
~~~

- [x] Registry 注入 FantoServerClient
- [x] 支持 record_get
- [x] 支持 record_list
- [x] 支持 record_search
- [x] read / write / edit / bash 行为保持
- [x] 只创建 Agent Definition 显式声明 Tool
- [x] Business Client 不进入 HTTP Route / Session Manager

---

## P0-8：Agent Config

修改：

~~~text
apps/agent/src/config/agent-config.ts
~~~

Tool enum 增加：

- [x] record_get
- [x] record_list
- [x] record_search

保持：

- [x] duplicate validation
- [x] unknown Tool validation
- [x] revision hash 会随着 tools 变化

---

## P0-9：Composition Root

修改：

~~~text
apps/agent/src/bootstrap/main.ts
~~~

链路：

~~~text
FANTO_SERVER_BASE_URL
→ FantoServerClient
→ ToolRegistry
→ HarnessFactory
~~~

- [x] Runtime 启动时创建一个 FantoServerClient
- [x] 注入 ToolRegistry
- [x] 不修改 Session 用户状态
- [x] 不修改 Business Server

---

## P0-10：main / coding 权限

修改 apps/agent/agents.yaml。

main：

- [x] record_get
- [x] record_list
- [x] record_search

coding：

- [x] 保持 read / write / edit / bash
- [x] 不增加 Record Tool

---

## P0-11：main Tool Routing Guidance

只增加 Record Tool 选择规则：

- [x] 最近 / 时间流 → record_list
- [x] 历史主题 / 想法 / 经历 → record_search
- [x] 已有 recordId → record_get
- [x] 结果足够时避免无意义继续 get
- [x] 无关问题不机械查历史
- [x] 搜不到不假装记得
- [x] 历史事实与 Agent 推断分开表达

不扩展复杂人格 Prompt。

## P0-12：FantoServerClient 测试

新增建议：

~~~text
apps/agent/test/fanto-server-client.test.ts
~~~

- [x] base URL
- [x] x-user-id
- [x] optional x-trace-id
- [x] GET Record
- [x] GET List query
- [x] POST Search body
- [x] success envelope
- [x] 400 / 404
- [x] 500
- [x] success=false
- [x] malformed JSON / envelope
- [x] network failure
- [x] timeout / abort

Client 建议允许注入 fetch implementation，避免依赖真实网络。

---

## P0-13：Record Tool 测试

新增建议：

~~~text
apps/agent/test/record-tools.test.ts
~~~

record_get：

- [x] schema 不含 userId
- [x] 正确调用 Client
- [x] DTO projection
- [x] 不输出 media URL

record_list：

- [x] default limit
- [x] max 20
- [x] cursor
- [x] preview 生成
- [x] preview 截断
- [x] pagination metadata

record_search：

- [x] query
- [x] default limit
- [x] max 20
- [x] recordId / snippet
- [x] 无 distance

context：

- [x] 使用 current run userId
- [x] traceId 可透传
- [x] 缺 user context fail closed

---

## P0-14：Config / Registry 测试

更新现有 config test，并按需要新增 Registry test：

- [x] 三个新 Tool name 合法
- [x] duplicate validation 不回归
- [x] main Tool 集合正确
- [x] coding Tool 集合正确
- [x] Registry 只创建声明 Tool

---

## P0-15：Agent README / Current Docs

代码真实接入后：

- [x] 更新 apps/agent/README.md
- [x] 更新 docs/architecture/agent-runtime.md
- [x] 更新 docs/product/current-scope.md
- [x] 检查 docs/api/http-api.md 的 Agent / Server 关系描述
- [x] 按 Git checkpoint 规则完成 Documentation Impact Review

不重复改写已经正确的 Record Search HTTP contract。

---

## P0-16：验证

自动：

~~~bash
pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build

pnpm typecheck
pnpm test
~~~

真实联调：

- [x] Business Server 启动
- [x] Agent Runtime 启动
- [x] main Session 使用真实 userId

Smoke：

~~~text
“我最近记录了什么？”
→ record_list

“我之前有没有想过 AI Coding？”
→ record_search

“详细看看刚才第一条。”
→ record_get
~~~

另外验证：

- [x] 普通无关问题不会强行查历史
- [x] 其他用户 Record 不可见
- [x] Server 不可用时 Tool error，不伪造答案

真实模型 Tool Selection 作为 smoke，不作为 CI 确定性断言。

---

## Definition of Done

- [x] FantoServerClient 是 Agent → Business Server 的唯一 Record HTTP 边界
- [x] record_get 可用
- [x] record_list 可用
- [x] record_search 可用
- [x] Tool schema 无 userId
- [x] userId 只来自 Run Context
- [x] Client 支持 cancellation + timeout
- [x] list 输出 compact preview
- [x] get 不输出无必要 signed media URL
- [x] search 不暴露 vector distance
- [x] main 开启三个 Record Tool
- [x] coding 不开启 Record Tool
- [x] Agent typecheck / test / build 通过
- [x] 仓库级 typecheck / test 通过
- [x] 真实联调通过
- [x] Current Docs 完成影响审查

---

## 明确延期

以下全部不属于本轮：

- Server Record API 改造
- Memory / Vector 改造
- Record create/update/delete Tool
- Creation / Proposal Tool
- Service-to-Service 正式认证
- Generic Business Tool Framework
- Hybrid Search / Reranker
- Heartbeat / proactive analysis
- SSE Tool Call 对外协议
- 前端 Tool 状态展示

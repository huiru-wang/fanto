# Fanto Agent Record Tools & OSS Region 任务清单

## P0-1：修正 Record Search 用户范围

- [ ] 确认 sqlite-vec 当前可用的 user-scoped KNN 实现方式
- [ ] 修改 `RecordMemoryService.search()`，避免全局 KNN 后再按 userId 过滤
- [ ] 保持结果仅属于当前用户
- [ ] 增加多用户召回测试
- [ ] 如调整 vector schema，同步修改当前 migration 基线
- [ ] 必要时执行 `pnpm vector:rebuild`

验收：

- 用户 A/B 同时存在高相似记录时，B 的结果不会挤掉 A 自己的候选
- 不返回其他用户 Record

---

## P0-2：新增 Record Search HTTP API

- [ ] 在 Record 路由增加 `POST /api/records/search`
- [ ] 输入校验：query / limit
- [ ] userId 只读取 `x-user-id`
- [ ] 调用现有 `RecordMemoryService`
- [ ] 返回 Record ID、eventAt、snippet / 必要正文
- [ ] 不把 sqlite-vec distance 暴露成产品置信度
- [ ] 增加 HTTP 测试
- [ ] 更新 `docs/api/http-api.md`

验收：

- Server 可通过 HTTP 进行当前用户 Record RAG
- Get/List API 无重复实现

---

## P0-3：新增 Agent FantoServerClient

- [ ] 新增 `FANTO_SERVER_BASE_URL`
- [ ] 新增统一 Client
- [ ] 从当前 Agent Run Context 获取 userId
- [ ] 透传可选 traceId
- [ ] 统一处理 Server envelope
- [ ] 处理 HTTP 错误
- [ ] 处理 timeout / network error
- [ ] 更新 `apps/agent/.env.example`
- [ ] 更新 `apps/agent/README.md`

验收：

- Tool 无需自行处理 Header / URL / envelope
- LLM 参数中不存在 userId

---

## P0-4：实现 record_get

- [ ] 定义 Tool schema
- [ ] 定义准确的 Tool description
- [ ] 调用 `GET /api/records/:id`
- [ ] 返回模型需要的稳定 Record DTO
- [ ] 增加测试

验收 Prompt：

```text
“详细看看刚才那条记录。”
```

已有 Record ID 时能够使用 `record_get`。

---

## P0-5：实现 record_list

- [ ] 定义 `limit`
- [ ] 定义可选 `cursor`
- [ ] 调用现有 Record List API
- [ ] 保持列表语义为“最近 / 时间线”
- [ ] 增加测试

第一版不增加：

- status filter
- date range
- source filter

验收 Prompt：

```text
“我最近记录了什么？”
```

优先选择 `record_list`。

---

## P0-6：实现 record_search

- [ ] 定义 `query`
- [ ] 定义 `limit`
- [ ] 调用 Record Search HTTP API
- [ ] 不暴露 vector distance / threshold 等参数
- [ ] 保留 Record ID 方便后续 `record_get`
- [ ] 增加测试

验收 Prompt：

```text
“我以前有没有想过 AI Coding 的问题？”
```

优先选择 `record_search`。

---

## P0-7：扩展 Agent Tool Registry

- [ ] 扩展 `agent-config.ts` Tool schema
- [ ] 扩展 `ToolRegistry`
- [ ] 保持内置 Tool 和 Fanto 业务 Tool 统一由配置启用
- [ ] main 开启三个 Record Tool
- [ ] coding 保持 read/write/edit/bash
- [ ] 更新 Agent config 测试
- [ ] 更新 `apps/agent/README.md`
- [ ] 如核心约定变化，同步 `AGENTS.md`

验收：

- Agent 配置可以声明 `record_get / record_list / record_search`
- 未声明的 Agent 无法调用对应 Tool

---

## P0-8：main Agent 可信记忆 Prompt

- [ ] 增加“相关时才检索”
- [ ] 增加“不强行引用历史”
- [ ] 增加“事实与推断分离”
- [ ] 增加“搜索不到不假装记得”
- [ ] 增加来源意识

验收：

- 普通无关问题不机械搜索历史
- 明显与过去记录相关的问题会主动调用 search
- 引用历史时表达为“你之前记录过……”

---

## P0-9：OSS Region 配置统一

- [ ] `apps/server/.env` 增加 `OSS_REGION=oss-rg-china-mainland`
- [ ] `.env.example` Region 改为 `oss-rg-china-mainland`
- [ ] `.env.example` Endpoint 改为对应 Endpoint
- [ ] `config.ts` 默认 Region 改为 `oss-rg-china-mainland`
- [ ] 更新 config test
- [ ] 检查 docs 中是否仍存在旧 Region
- [ ] 真实验证上传 / complete / 读取 signed URL

验收：

```text
Region   = oss-rg-china-mainland
Endpoint = oss-rg-china-mainland.aliyuncs.com
```

不再存在默认杭州 Region 与新 Endpoint 混用。

---

## P0-10：回归与端到端验证

执行：

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test

pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build
```

验证：

- [ ] `record_get`
- [ ] `record_list`
- [ ] `record_search`
- [ ] user isolation
- [ ] traceId 透传
- [ ] Agent Tool selection
- [ ] OSS 上传链路

---

## 明确延期

以下不属于本轮：

- [ ] Record 写 Tool
- [ ] Memory 独立实体
- [ ] Hybrid Search
- [ ] Reranker
- [ ] Proposal 自动生成
- [ ] Creation 自动更新
- [ ] heartbeat 主动分析
- [ ] 系统通知
- [ ] 正式认证
- [ ] 复杂记录过滤

本轮完成后再进入「来源展示 / 纠正 / 排除」的可信记忆下一阶段。

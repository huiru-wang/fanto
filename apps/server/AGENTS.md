# Server Agent Guide

适用于 `apps/server/`。先阅读 [Server](../../docs/architecture/server.md)、[Agent](../../docs/architecture/agent-runtime.md)、[创作执行](../../docs/architecture/creative-runtime.md)、[Domain](../../docs/domain/projects.md) 和 [HTTP API](../../docs/api/http-api.md)。

## 目录职责

- `src/bootstrap/`：服务装配、配置、启动、迁移。
- `src/routes/`：HTTP 参数、用户认证边界与响应；包括统一 `routes/agent/`。
- `src/domain/`：Records、Media、Memory、Projects（含 CreativeService）、Tasks（含 TaskScheduler）。
- `src/agent/`：唯一 Pi Harness、SessionManager、Tool、Context、Prompt 与 Skill。
- `src/event/`：非持久化的 Record Postprocess、Embedding、AgentExecution 队列及 SessionEventBus。
- `src/execution/`：AgentWorker、共享 AgentExecutionListener、Proposal/Creator/Task Handler。
- `src/listeners/`：Record 后置理解和 Embedding 消费者。
- `src/infrastructure/`：PostgreSQL、OSS、外部 AI Client、日志和缓存。
- `src/migrations/`：已发布基线和有序前向迁移。

## 边界与不变量

- HTTP Route 不直接访问 Repository；领域操作走 Service。Agent Tool / Context Provider 只能通过 `agent/business-services.ts` 调用获准领域服务，不调用内部 HTTP。
- 所有数据读取、写入和查询必须 user-scoped，身份只能来自已校验 JWT / Session。Creator 的可信 projectId 必须由服务端按 userId + sessionId 查找绑定 Project，再做 Project 状态与归属校验。公共 Stream 仅允许合规 Creator Session，不开放 Proposal/Task Worker 直接执行。
- 唯一多轮会话对外协议是 `POST /api/agent/stream`、`GET /api/agent/sessions/:id/history` 和只读 `GET /api/agent/sessions/:id/events`；不要重建 Project 专属消息 POST、History、Stream。Session SQLite 是过程事实，Project goal/content 是业务成果。
- Project 状态只有 queued/running/completed/failed/archived；queued 与 Session 创建无关。Proposal content 为 reason + ideas + selectedIdeaId，每个 Idea 有 title/idea/tags/goal；不要使用旧单 Idea/Plan Schema。Record 与 Project 关联要维持事务与锁顺序。
- Record postprocess 成功后分别投递 EmbeddingQueue 和 Proposal；失败的 Embedding 不回滚 processed。共享 AgentExecutionQueue 用内存 pending 和并发限制执行 Proposal/Creator/Task。TaskScheduler 可扫描到期 Task、创建 queued TaskRun 并投递任务；没有 MQ 持久化、自动重试、重启恢复。
- `image_generate` 多张参考图输入、单图输出，生成物直接属于 Project OSS 路径。只有媒体进入正式 Project content/cover 后，才复制其它来源的 ready 媒体，换用新的 mediaId；Record 删除事务内清理独占媒体元数据，提交后尽力清理 OSS，失败不自动重试。
- `create_current_schema.ts` 是合并后的历史完整空库基线，`zzzzzz_async_v3.ts` 是新前向增量。旧库遵循迁移元数据合并机制，不手动清空 Kysely 表，也不改已发布基线伪装成迁移。保持旧数据和用户隔离。
- Current docs 描述已实现语义；`plan/` 只作为方案历史，不作为现状依据。密钥、URL Token 和内部 Tool 参数不得写入面向用户的回复、日志或文档。

## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及 PostgreSQL 需隔离 `TEST_DATABASE_URL`；涉及 OSS/模型时区分 Mock 测试和真实收费 smoke。更多测试矩阵见 [测试](../../docs/engineering/testing.md)。

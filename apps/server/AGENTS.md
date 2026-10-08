# Server Agent Guide

适用于 `apps/server/`。系统语义先阅读：

- `../../docs/architecture/server.md`
- `../../docs/domain/records.md`
- `../../docs/domain/media.md`
- `../../docs/domain/record-retrieval.md`
- `../../docs/domain/memory.md`
- `../../docs/domain/projects.md`
- `../../docs/api/http-api.md`

## 目录边界

- `src/bootstrap/`：进程入口、配置、迁移命令与 Hono 装配。
- `src/routes/`：HTTP 输入校验、用户边界、响应映射与路由注册。
- `src/domain/`：业务实体、规则、操作与 Repository。
- `src/infrastructure/`：PostgreSQL、外部 Client、队列、日志、时间等基础设施。
- `src/creative-runtime/`：Record 提议分析与接受后 Project Session Agent 调度；运行语义见 `docs/architecture/creative-runtime.md`。
- `src/listeners/`：进程内异步事件处理。
- `src/migrations/`：当前 schema 空库基线与已部署 PostgreSQL 的增量迁移。
- `src/agent/`：Pi Agent Runtime、Session、Context、Tool 与 workspace；`src/routes/agent/` 只保留其 HTTP / SSE 边界。

## 实现约束

- Route 只处理 HTTP 输入校验、用户边界和响应映射；它只能通过所属 Domain 的 `*-service.ts` 进入业务能力，不能直接访问 Repository。
- 每个 Domain 以 `index.ts` 作为模块外入口；`repository.ts` 与 `postgres-repository.ts` 都是模块内部实现细节，不从 barrel 导出。
- 外部服务适配器放在 `infrastructure/clients/`，业务语义不要散落进 Client。
- 用户归属必须在查询和写入路径中显式校验。
- `create_current_schema.ts` 是 2026-10-08 合并后的完整 PostgreSQL 基线；已执行原 14 个版本的数据库在迁移启动时仅归并 Kysely 历史，不重新执行 DDL。旧迁移未全部完成的数据库须先用旧版本升级，禁止跳过版本。后续结构修改必须新增前向 migration，不得直接修改已上线基线替代升级。既有 `legacy_projects` / `legacy_project_records` 保留作恢复来源，不自动删除。
- `records.embedding` 是 Record 行上的派生字段；当前不提供自动重试、补偿或批量重建入口。
- Memory 是用户明确保存的独立业务数据，存储在 `memories`；不要混入 Record 的 `records.embedding` 派生字段。
- Record 创建 / 更新后的图片理解、音频转写和向量索引走现有 postprocess queue + listener；不要再引入另一套并行工作流。
- Record postprocess 异步队列是进程内机制，不具备持久化、重试或多实例一致性；不要在代码或文档中暗示这些能力已存在。
- Proposal / Project 是独立领域；Project 只保存 active / archived 成果，提议决策使用 ProposalService。Proposal 摘要字段使用 proposedSummary（数据库 proposed_summary），Project 摘要字段使用 summary。Record 删除与提议接受须保持 Record → Project 锁顺序及同事务关联清理；正文资源校验使用语法解析，不以全文正则替代。Project summary 与其 768 维 embedding 同事务写入；搜索限定用户和 active 状态。project_read 仅支持 search / get，不能把候选相似度当成关联结论。
- Creative Runtime 的 proposal-agent 从已处理 Record 发现提议；creator-agent 基于绑定 Project 的长期 Session 执行并继续对话。Project 仅存最新 goal/content，Session 消息为执行过程唯一事实来源；不引入独立 Run / 进度 / 图片槽位 / 租约表。Proposal goal 不包含媒体槽位。Proposal 的 session_id 是提议分析 Session，Project session_id 是创作 Session，不互换。
- 可信 RunContext 的 projectId 来自服务端经用户 + Session 绑定检查；creator-agent 工具不得修改其它 Project。Project 级 History / Stream 独立校验授权，普通内部 Agent Session HTTP 仍不可公开访问。
- image_generate 多参考图输入、单图输出且无运行状态；Project 媒体统一写入 users/{userId}/project/{projectId}/{mediaId}.{ext}。project_manage 最终保存时检查 objectKey 并为外部 Record 引用创建新 mediaId + 对象副本，替换内容引用。Record 删除继续同事务清理独占资产与 OSS 删除队列；Task 交付按原规则保留。OSS 清理失败重试。
- HTTP 接口行为以实际注册 Route 为准。
- Agent Tool 与 Context Provider 只能通过 `src/agent/business-services.ts` 调用声明过的领域 Service；不得调用 Route、HTTP Client 或 Repository。Agent Session SQLite、workspace 和 SSE / abort 语义必须保持兼容。

## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及向量索引时，验证 Record 创建、处理、删除与搜索链路；涉及 OSS / AI 外部服务时，单元测试不能替代真实链路验证。

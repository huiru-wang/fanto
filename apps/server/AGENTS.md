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
- `src/creative-runtime/`：Record 提议分析、接受后创作、租约与付费图片恢复；运行语义见 `docs/architecture/creative-runtime.md`。
- `src/listeners/`：进程内异步事件处理。
- `src/migrations/`：当前 schema 空库基线与已部署 PostgreSQL 的增量迁移。
- `src/agent/`：Pi Agent Runtime、Session、Context、Tool 与 workspace；`src/routes/agent/` 只保留其 HTTP / SSE 边界。

## 实现约束

- Route 只处理 HTTP 输入校验、用户边界和响应映射；它只能通过所属 Domain 的 `*-service.ts` 进入业务能力，不能直接访问 Repository。
- 每个 Domain 以 `index.ts` 作为模块外入口；`repository.ts` 与 `postgres-repository.ts` 都是模块内部实现细节，不从 barrel 导出。
- 外部服务适配器放在 `infrastructure/clients/`，业务语义不要散落进 Client。
- 用户归属必须在查询和写入路径中显式校验。
- 必须保留已执行 PostgreSQL migration 的文件名；结构变更用新增迁移同步既有数据库，并验证空库与旧库路径。不为旧 SQLite schema 建兼容升级链。Project 升级保留 legacy_projects / legacy_project_records 作为恢复来源，不自动删除。
- `records.embedding` 是 Record 行上的派生字段；当前不提供自动重试、补偿或批量重建入口。
- Memory 是用户明确保存的独立业务数据，存储在 `memories`；不要混入 Record 的 `records.embedding` 派生字段。
- Record 创建 / 更新后的图片理解、音频转写和向量索引走现有 postprocess queue + listener；不要再引入另一套并行工作流。
- Record postprocess 异步队列是进程内机制，不具备持久化、重试或多实例一致性；不要在代码或文档中暗示这些能力已存在。
- Proposal / Project 是独立领域；Project 只保存 active / archived 成果，提议决策使用 ProposalService。Proposal 摘要字段使用 proposedSummary（数据库 proposed_summary），Project 摘要字段使用 summary。Record 删除与提议接受须保持 Record → Project 锁顺序及同事务关联清理；正文资源校验使用语法解析，不以全文正则替代。Project summary 与其 768 维 embedding 同事务写入；搜索限定用户和 active 状态。project_read 仅支持 search / get，不能把候选相似度当成关联结论。
- Creative Runtime 的 proposal-agent / creator-agent 仅由可信后台执行；proposal-agent 全程静默，仅允许生成提议或 no_proposal，不向用户提问。任何 Tool 写入都校验用户、内部角色、Session 和租约；Proposal creation 仅保存与 Task goal 同形的用户目标；creator-agent 经 creation_prepare 固化不可变素材 / 主体 / 数量计划后才能生图和发布。生图先登记固定槽位，未知结果禁止重发，保存恢复只能复用已收到结果。Proposal 的 session_id 仅由可信服务端执行上下文写入，不由模型参数指定，不授予公共会话权限。Proposal / Project 更新与对应运行完成必须同事务。
- Record 删除必须同事务清理来源关联、移除独占媒体资产并登记 media_object_deletions；已有成果直接引用的媒体保留。Project 发布与媒体删除必须通过共享 / 排他媒体锁互斥。OSS 清理失败保留持久任务并重试，不能将网络调用失败等同于业务删除回滚。
- HTTP 接口行为以实际注册 Route 为准。
- Agent Tool 与 Context Provider 只能通过 `src/agent/business-services.ts` 调用声明过的领域 Service；不得调用 Route、HTTP Client 或 Repository。Agent Session SQLite、workspace 和 SSE / abort 语义必须保持兼容。

## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及向量索引时，验证 Record 创建、处理、删除与搜索链路；涉及 OSS / AI 外部服务时，单元测试不能替代真实链路验证。

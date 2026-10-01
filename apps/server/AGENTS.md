# Server Agent Guide

适用于 `apps/server/`。系统语义先阅读：

- `../../docs/architecture/server.md`
- `../../docs/domain/records.md`
- `../../docs/domain/media.md`
- `../../docs/domain/memory.md`
- `../../docs/domain/projects.md`
- `../../docs/api/http-api.md`

## 目录边界

- `src/bootstrap/`：进程入口、配置、迁移命令与 Hono 装配。
- `src/routes/`：HTTP 输入校验、用户边界、响应映射与路由注册。
- `src/domain/`：业务实体、规则、操作与 Repository。
- `src/infrastructure/`：PostgreSQL、外部 Client、队列、日志、时间等基础设施。
- `src/listeners/`：进程内异步事件处理。
- `src/migrations/`：当前 schema 的空库基线。
- `src/agent/`：Pi Agent Runtime、Session、Context、Tool 与 workspace；`src/routes/agent/` 只保留其 HTTP / SSE 边界。

## 实现约束

- Route 只处理 HTTP 输入校验、用户边界和响应映射；它只能通过所属 Domain 的 `*-service.ts` 进入业务能力，不能直接访问 Repository。
- 每个 Domain 以 `index.ts` 作为模块外入口；`repository.ts` 与 `postgres-repository.ts` 都是模块内部实现细节，不从 barrel 导出。
- 外部服务适配器放在 `infrastructure/clients/`，业务语义不要散落进 Client。
- 用户归属必须在查询和写入路径中显式校验。
- 当前 migration 只维护“当前空 PostgreSQL schema”，不为旧 SQLite schema 建兼容升级链；需要历史数据兼容时必须重新讨论。
- 向量索引属于可重建派生数据，Record 等业务主表才是业务事实。
- Record 创建 / 更新后的图片理解、音频转写和向量索引走现有 postprocess queue + listener；不要再引入另一套并行工作流。
- 当前异步队列是进程内机制，不具备持久化、重试或多实例一致性；不要在代码或文档中暗示这些能力已存在。
- HTTP 接口行为以实际注册 Route 为准。
- Agent Tool 与 Context Provider 只能通过 `src/agent/business-services.ts` 调用声明过的领域 Service；不得调用 Route、HTTP Client 或 Repository。Agent Session SQLite、workspace 和 SSE / abort 语义必须保持兼容。

## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及向量索引时，按任务需要额外验证 `pnpm vector:rebuild`；涉及 OSS / AI 外部服务时，单元测试不能替代真实链路验证。

# 内部 JSON-RPC 实施任务

> 关联设计：[2026-09-28-internal-json-rpc-design.md](./2026-09-28-internal-json-rpc-design.md)
> 状态：待实施

1. 在 `packages/shared/src/rpc/` 定义 JSON-RPC 2.0 envelope、稳定错误码、方法名和 Server / Agent 的 DTO；补充 shared package 导出与单元测试。
2. 在 Agent `src/clients/` 实现通用 `json-rpc-client.ts`，将 `server-client.ts` 改为 JSON-RPC 业务 Client；保留超时、取消、traceId、envelope 校验与安全错误映射。
3. 在 Server 新增 `src/rpc/`：实现 envelope 校验、入站 Agent Token 验证、`X-User-Id` Principal、方法白名单，以及 Record / Preference / Media 的 RPC Method Handler；Handler 直接调用既有 Domain / Repository。
4. 从 Server Web `/api/*` 鉴权中移除 Agent 内部 Token 分支，使 Web API 恢复为仅用户 JWT；保留 Web Route 到 Domain / Repository 的现有调用关系。
5. 迁移 Agent 的 Context Provider、Record、Preference、Media Tool 和未来 Task Worker，使所有 Business Server 调用只能经过 `src/clients/server-client.ts` 的 JSON-RPC 方法。
6. 将 Agent Web API 从 `src/http/` 迁移至统一的 `src/routes/`；`app.ts` 只装配路由与中间件，Web Route 只接受用户 JWT，拒绝内部 Token。
7. 在 Agent 新增 `src/rpc/`：实现入站 Server Token 验证、`agent-jobs.submit/get/cancel` 白名单方法和 Server Job 的用户上下文校验；RPC Route 拒绝用户 JWT，不得复用 `/api/agent/stream`。
8. 在 Server 新增 `src/clients/agent-client.ts`，实现 Server→Agent JSON-RPC Client、requestId 幂等提交与超时 / 错误映射。
9. 设计并实现 Server-owned `creation_generation_jobs` 数据模型与 Repository；记录 requestId、用户、输入版本、状态、Agent Job ID、结果 / 错误摘要，并增加 `creations.proposal.put` 的 Agent→Server RPC 写回方法。
10. 将 Server Job 接入 Agent WorkerPool：使用 `task-worker` 独立 Session、工作区、工具白名单和超时；标识 `origin = server`，且与用户 Task 共用并发槽位。
11. 增加两组方向独立的环境变量、示例配置、启动校验与部署前校验；移除已废弃的 `/api` 内部 Token 配置和说明。
12. 编写单元与集成测试：RPC protocol、双向 Token、用户隔离、方法白名单、Client 不再访问 `/api/*`、错误映射、requestId 幂等、Server Job 写回、并发槽位和日志脱敏。
13. 更新 `docs/architecture/overview.md`、`docs/architecture/agent-runtime.md`、`docs/architecture/server.md`、`docs/api/http-api.md`、`docs/engineering/configuration.md`、模块 README 与 AGENTS 当前边界；运行全仓 typecheck 与 test。

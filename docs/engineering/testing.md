# 测试与验证

改动必须匹配验证范围；纯 typecheck 不能证明数据库事务、OSS 或付费模型链路已成功。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
pnpm --filter @fanto/h5 typecheck
pnpm --filter @fanto/h5 build
xcodebuild -project apps/ios/fanto/fanto.xcodeproj -scheme fanto -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

有些 PostgreSQL 集成测试需要 `TEST_DATABASE_URL` 和测试账号 `CREATEDB` 权限；未配置时测试会跳过，不能报告为全部通过。严禁将生产库配置给测试。

## 按领域验证

- **数据库**：空库基线 `create_current_schema.ts`、已有数据库迁移历史合并与后续 `zzzzzz_async_v3.ts`，保留业务数据；不要手动删除 `kysely_migration`。
- **Record / Media**：按用户、版本、位置字段、五媒体限制、后置 Vision/ASR、独立 EmbeddingQueue、语义检索；真实 OSS PUT/HEAD/URL、删除后的尽力清理以及 Project 最终副本归属。
- **Proposal / Project**：Proposal 1–2 个 Idea、accept 幂等、create/extend 状态、Record 关联、version 乐观并发、媒体复制、旧内容保留和失败状态收敛；测试文件位于 `domain/projects/`、`routes/project-http.test.ts`。
- **Agent Session**：History user ownership、Creator 按 sessionId 绑定 Project 的访问控制、Stream/Events、同一 Session 并发防护、Tool Presentation 隐私投影、取消与超时。可检查 `routes/agent/sessions.test.ts`、`routes/agent/stream.test.ts` 与 `agent/presentation.test.ts`。
- **异步执行**：`execution/agent-execution.listener.test.ts`、`execution/handlers/task-brief.test.ts`、`domain/tasks/scheduler.test.ts`；验证共享并发、queued TaskRun、单次运行、无自动重试、停止/进程中断边界。异步 Queue 不持久化，不能凭借持久 Task 状态声称自动恢复。
- **客户端**：H5 typecheck/build；iOS Xcode 模拟器构建与实际页面交互。测试创建记录/位置、Proposal 接受、Project 继续对话（含订阅失败仍可发）、Tool 活动/媒体渲染、异步状态刷新、归档和 Task 产物预览。

需要真实 DeepSeek/Qwen/OSS 时使用受控的最小 smoke test，明确费用和环境，不能把 Mock 的成功当成真实生成。当前没有默认启用的付费 Creator E2E CI 测试。

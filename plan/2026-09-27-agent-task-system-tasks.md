# Agent Task System 实施任务

> 关联设计：[2026-09-26-agent-task-system.md](./2026-09-26-agent-task-system.md)
> 更新：2026-09-28
> 状态：待实施

## 已完成前置清理

- 旧 `agent_tasks` schema、Repository、TaskRunner 和旧 `POST /api/agent/tasks` 执行语义已删除；不做兼容迁移。
- Agent→Server 已完成内部身份重构：用户 Access Token 只用于 HTTP 入口；`src/clients/server-client.ts` 是唯一调用入口，使用 `X-API-Token`、`X-User-Id`，Server 强制用户上下文并限制既有 Agent 路由白名单。

## 实施任务

1. 定义 Task、TaskRun、Trigger、Output、OSS Result Reference 和状态模型；Output 只允许 `text`、`markdown`、`html`。
2. 实现 Agent SQLite schema、索引和用户隔离 Repository：包括条件领取、完成、失败、取消、运行中断恢复，以及按时间顺序查询 `queued` Run。
3. 实现 `TaskService`：创建 immediate / once / recurring Task、暂停、恢复、取消和用户范围内读取；immediate 只创建 `queued` Run，不直接启动 Worker。
4. 引入 RRULE / 时区计算能力，实现“只补最近一次遗漏 occurrence、推进至下一次未来 occurrence”的 Scheduler 计划计算。
5. 实现 5 分钟 Scheduler：事务内创建到期 Run 与推进 `next_run_at`；随后读取 `queued` Run 并在本机空闲容量内交给 WorkerPool。不得引入消息队列、周期性补偿扫描或 outbox。
6. 实现 `AGENT_TASK_WORKER_CONCURRENCY` 和 `AGENT_TASK_WORKER_TIMEOUT_MS` 配置校验、启动日志及 WorkerPool。Pool 必须按 `scheduled_at, created_at` 领取 Run，使用 `queued → running` 条件更新避免重复启动。
7. 实现启动恢复：将遗留 `running` Run 标为 `failed`；保留 `queued` Run，交由下一次 Scheduler Tick 继续分发。
8. 新增 `task-worker` Agent Definition、Prompt、独立 Session/工作区创建与超时控制。每个 Run 必须以 `TaskRun.userId` 创建独占 Session，并且只能声明 `read`、`write`、`edit`、`bash`、`record_get`、`record_list`、`record_search`、`preference_manage`；Worker 通过既有 `runAgent()` 执行，不得复用 Main Chat 或调用 HTTP stream Route。
9. 实现 Worker 结果上传 Server 白名单接口：Server 以现有 OSS 能力保存结果；Worker 只能经 `src/clients/server-client.ts` 使用既有 `X-API-Token`、`X-User-Id` 调用；仅在 OSS 上传成功后将 Run 写为 `completed`，否则写为 `failed`。内部 Token 白名单只增加该上传路由。
10. 实现 `delegate_task` Tool：从 Run Context 注入用户与来源信息，校验自包含 instruction，返回创建结果且不等待执行。
11. 实现 Task / TaskRun 用户 API：列表、详情、Run 历史、暂停、恢复、取消；所有 Repository 查询必须强制 `user_id` 约束。
12. 编写单元与集成测试：RRULE/时区、5 分钟扫描、遗漏周期只补最近一次、唯一约束、重复领取、N 并发槽位、超时、OSS 上传成功/失败、重启状态恢复、Worker Session/工作区用户隔离、Tool 白名单和内部 Token 白名单。
13. 更新 `docs/architecture/agent-runtime.md`、`apps/agent/README.md`、`docs/engineering/configuration.md` 和相关 HTTP 文档；运行 Agent 与 Server 的 typecheck、test、build。

## 一期明确不做

- Redis、内存队列、`TaskRunQueue`、transactional outbox 与周期性补偿扫描；
- 自动重试、优先级、运行中强制取消；
- 多进程/多机共享执行；
- 任务完成后自动回填聊天或推送通知；
- 文件类型输出与多 artifact 交付协议。

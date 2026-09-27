# Agent Task System 实施任务

> 关联设计：[2026-09-26-agent-task-system.md](./2026-09-26-agent-task-system.md)
> 状态：待实施

## 前置决策

1. 确认第一版队列产品与连接配置，并实现为 `TaskRunQueue` 适配器；消息协议固定为 `{ runId }`。
2. 在实现 Worker 前定义安全的服务端委派身份方案；不得继续使用内存 Access Token Map，也不得持久化用户 Access Token。

## 实施任务

1. 删除旧 `agent_tasks` schema、Repository、TaskRunner 和旧任务 Route 的执行语义；清理启动与依赖注入入口。
2. 定义 Task、TaskRun、Trigger、Output、Result、状态与队列消息的领域模型及校验。
3. 实现新的 SQLite schema、索引、用户隔离查询，以及 TaskRun 的条件领取、完成、失败、取消、启动恢复和队列投递结果记录。
4. 实现 `TaskService`：创建 immediate / once / recurring Task、生成 immediate Run、暂停、恢复、取消和用户范围内读取。
5. 实现 `delegate_task` Tool：从 Run Context 注入用户与来源信息，校验自包含 instruction，返回创建结果而不等待执行。
6. 实现 Scheduler：每 5 分钟扫描到期 Task，以事务创建 Run 并推进 `next_run_at`，提交后投递新增 Run；投递失败记录错误并告警。
7. 实现 `TaskRunQueue` 接口和选定队列的发布/消费适配器；消费配置与断连/重连行为必须可测试。
8. 实现 `AGENT_TASK_WORKER_CONCURRENCY` 配置校验和容量受控 Executor：只在有空闲槽位时消费，按 `runId` 原子领取，重复消息安全忽略。
9. 新增 `task-worker` Agent Definition、Prompt、独立 Session/工作区创建，以及 Worker 结果到 `task_runs` 的终态落库。
10. 实现 Task / TaskRun 用户 API（列表、详情、Run 历史、暂停、恢复、取消），确保 Repository 层每次按 `user_id` 约束。
11. 编写单元/集成测试：RRULE、5 分钟扫描、唯一约束、重复消息、N 并发槽位、投递失败记录、状态终态、重启恢复和用户隔离。
12. 更新 `docs/architecture/agent-runtime.md`、`apps/agent/README.md`、`docs/engineering/configuration.md` 及相关 HTTP 文档，随后运行 Agent 模块 typecheck/test/build。

## 一期明确不做

- queued Run 自动补偿扫描或 transactional outbox；
- 自动重试、优先级和运行中的强制取消；
- 多进程/多机共享执行；
- 任务完成后自动回填聊天或推送通知。

投递失败时保留 `queued` Run、记录错误并人工处理；该限制需在运维说明中明确。

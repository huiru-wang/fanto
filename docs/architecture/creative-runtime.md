# 异步执行架构 v3（Project Session）

## 总体结构

Server 内统一使用进程内、非持久化 Queue + Listener：

- `RecordPostprocessQueue`：图片理解、音频转写；`processed` 成功写入数据库后分别投递两个独立消息。
- `RecordEmbeddingQueue`：Record 按版本检查后单独生成与存储向量，失败不会阻塞 Proposal。
- `AgentExecutionQueue`：Proposal/Creator/Task 统一由 `AgentExecutionListener` 分发，后台并发由 `AGENT_EXECUTION_CONCURRENCY` 控制。
- `execution/handlers/` 持有业务执行入口；Agent Harness 保持原有 `agent/` 模块结构，唯一执行入口为 `runAgent`。
- `SessionEventBus`：运行事件按 `sessionId` 发布，HTTP SSE 可订阅，无独立 Project EventBus、无事件持久化与重放。

不引入消息持久化、自动重试、补投、重启恢复、失败补偿或背压。进程终止后的 queued/running 可能保留原状态。

## Project 状态

`queued → running → completed | failed`，以及 `archived`；删除原 `active`。

- `queued`：已提交、等待执行，与 Session 是否创建/绑定无关。
- `running`：Handler 已认领工作，包括创建/绑定 Session 和 Agent 执行；不由 Session 状态推断。
- `completed`：最近一次创作/对话成功；保留已发表最新成果。
- `failed`：最近一次执行失败；保留现有成果和 Session，允许用户继续。
- `archived`：不可继续修改或执行。

`ProposalService.accept` 事务内同步创建 Project 或更新 extend 目标及 Record 关联，设置 `queued`；事务提交后发布 Creator 消息，API 只返回 `projectId`。CreatorHandler 认领 queued→running 后创建/复用 Session，通过已有 `SessionManager.reserve` 保证会话串行。Creator 使用 `project_read` / `skill_read` / `record_read`、`image_generate`、`project_manage` 完成创作；必须有有效 Project 保存才算完成。业务字段更新保留 version 乐观锁，纯状态改变不增加 version。

## Task

TaskScheduler 仍以固定间隔扫描到期 Task；即时任务创建可主动唤醒扫描。Scheduler **在事务中创建 status=queued 的 TaskRun** 并投递 AgentExecutionQueue；TaskHandler 消费后 `queued→running`，独立创建并绑定 Session。`task_plan_manage` 和 `deliver_task_result` 沿用当前鉴权与产物协议；只执行一次，不自动重试。

## Session HTTP 协议

- `GET /api/agent/sessions/:sessionId/history`：按用户 Session 所有权直接读取；内部 Agent Session 也可读取历史，不开放内部 Agent 公共执行权限。
- `GET /api/agent/sessions/:sessionId/events`：按 Session 订阅已有 AgentStreamEvent（start/delta/tool_start/tool_end/done/error 等）。
- `POST /api/agent/stream`：Main 和 Creator 共用的会话流式接口；Creator 根据用户与 sessionId 查询绑定 Project，校验状态，注入 projectId 到 RunContext 并更新执行状态。异步首次创作仍可通过通用 Session SSE 只读订阅。
- 普通 Main Agent `POST /api/agent/stream` 保留请求驱动 SSE。
- 旧 Project 专属 start/stream/events/history 路由已删除。

Server API 已重设计；**H5/iOS 仍需要后续适配**。

## 媒体和清理

`project_manage` 保存正式成果时把引用的 Record 图片/音频复制到 `users/{userId}/project/{projectId}/`，Record 仅保留原始引用。删除 Record 在 DB 事务内清理关联并收集可删 objectKey，事务提交后限时尝试 OSS 删除；失败只记日志，不补删，不再运行 media cleanup scanner 或持久化删除表。TaskRun 的媒体产物引用继续受保护。

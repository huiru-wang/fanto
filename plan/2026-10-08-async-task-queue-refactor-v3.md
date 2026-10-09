# Fanto 异步任务架构重构 v3

日期：2026-10-08  
范围：**Server**（异步链路、Domain、Agent 执行、Session 事件、HTTP API、Migration、测试与文档）  
状态：**Server 已按 v3 实施**（Server 类型检查与本地隔离 PostgreSQL 集成测试已通过；H5/iOS 尚待适配，真实外部 Agent/OSS 接口尚待联调）  
客户端：**本次不改 H5/iOS**；新的 HTTP Schema 和 SSE 协议在 Server 内一次性完成，客户端适配另列 TODO。

## 1. 目标与边界

1. 使用进程内、非持久化的 **Queue + Listener** 模型替代跨模块直接启动异步工作；每条消息指定对应消费者，不新建 Redis/MQ、消息表。
2. 保留 `RecordPostprocessQueue + RecordPostprocessListener` 完成图片理解、音频转写；成功提交 `processed` 后**独立发布** Record Embedding 和 Proposal 两条消息，互不等待。
3. `RecordEmbeddingQueue + RecordEmbeddingListener` 专门执行 Record 向量生成与存储。
4. `AgentExecutionQueue + AgentExecutionListener` 统一后台 Proposal / Creator / Task Agent 执行，采用同一进程级 Semaphore 限制后台 Agent 并发。
5. 同一 Agent 底层执行入口只保留 **`runAgent`**；删除 `runAgentSkill`。Agent 仍可通过既有 `skill_read` 自主读取 Creative Skill。
6. **Scheduler 创建 TaskRun，TaskHandler 创建并绑定 Session**；只允许 TaskScheduler 扫描到期 Task；即时 Task 创建成功后主动触发一次调度检查。
7. Proposal accept **只负责接受结果并返回 projectId**：同步处理 create/extend 的 Project 业务变更，成功后发布 Creator 消息；不等待 Session/Agent，不在 accept 响应暴露队列或运行状态。
8. Project 的后台实时事件复用统一的、以 `sessionId` 为键的 `SessionEventBus` + Agent SSE，不维护 Project 专属 EventBus。
9. `execution/`、`event/` 放在 `src/` 下与 `domain/` 同级；**不改变现有 `agent/` 的模块依赖规则与组织方式**，只处理删除旧 Runtime 造成的必要引用变更。
10. OSS 删除简化为数据库事务提交后的**限时同步尝试**；失败不影响 Record 删除，不再补删或扫描。
11. Project.status 统一为 `queued / running / completed / failed / archived`，**删除 active**；`queued` 只表示**等待任务执行**，与 Session 是否创建、存在、绑定无关；Project 详情与列表直接返回 status，不增加 creatorQueued 等状态字段。TaskRun 另外增加 queued。除这些状态以外不建新 Run 表。运行中崩溃或进程内消息丢失不会自动恢复；本方案不保证 exactly-once / eventual completion。
12. 本次明确**不做**消息持久化、重试、补投、进程重启恢复、失败补偿和背压；**包含** Server HTTP Schema、SSE、Migration，**不包含** H5/iOS 适配。Server 暂时可以与旧客户端不兼容。

## 2. 目标模型与目录

### 2.1 三类 Queue

| Queue | 消息字段 | Listener | 结果 |
| --- | --- | --- | --- |
| `RecordPostprocessQueue` | `userId, recordId, version` | `RecordPostprocessListener` | 图片描述、音频转写，写回 `processed` |
| `RecordEmbeddingQueue` | `userId, recordId, version` | `RecordEmbeddingListener` | 生成并条件写入 `records.embedding` |
| `AgentExecutionQueue` | `type` + 业务 ID | `AgentExecutionListener` | 经 Handler 准备上下文，调用 `runAgent` |

Queue 仅传原始标识，不携带 ORM 实体、数据库连接、回调闭包、完整 Record/Project 快照。订阅先于对外启动服务完成注册；发布消息不等待业务 Listener 完成。Queue 的存活范围仅限当前 Server 进程。

```ts
type AgentExecutionMessage =
  | { type: "proposal"; userId: string; recordId: string; version: number }
  | { type: "creator"; userId: string; proposalId: string; projectId: string }
  | { type: "task"; userId: string; taskId: string; taskRunId: string };
```

### 2.2 代码组织

```text
apps/server/src/
├── agent/                         # 保留现有 Harness/Context/Prompts/Skills/Tools 组织
│   ├── harness/run.ts             # 仅 runAgent
│   ├── context/
│   ├── prompts/
│   ├── skills/
│   ├── tools/
│   └── ...
├── domain/
│   ├── records/
│   ├── projects/
│   │   ├── creative-service.ts
│   │   ├── creative-model.ts
│   │   └── ...
│   ├── tasks/
│   │   ├── scheduler.ts
│   │   ├── result-publisher.ts
│   │   └── ...
│   └── media/
├── event/
│   ├── record-postprocess-queue.ts
│   ├── record-embedding-queue.ts
│   ├── agent-execution-queue.ts
│   └── session-event-bus.ts
├── execution/
│   ├── agent-execution.listener.ts
│   ├── agent-worker.ts
│   └── handlers/
│       ├── proposal.handler.ts
│       ├── creator.handler.ts
│       └── task.handler.ts
├── listeners/
│   ├── record-postprocess.listener.ts
│   └── record-embedding.listener.ts
├── routes/
├── bootstrap/
└── migrations/
```

删除 `src/creative-runtime/` **整个模块**和 `src/task-runtime/` **整个模块**。将 CreativeService / CreativeModel 搬入 `domain/projects/`，TaskScheduler / ResultPublisher 搬入 `domain/tasks/`。调整原引用及测试路径。

**不要借本次重构重新设计 agent/ 模块：** `agent/harness`、`agent/context`、`agent/business-services` 等现有依赖和配置组织不做额外的解耦工程。旧 Runtime 类型移动后替换必要 import 即可。`execution/` 是独立顶层模块，不放到 `agent/` 内。

## 3. Record 后处理、Embedding 与 Proposal

### 3.1 RecordPostprocessListener

```text
Record create/update
  → RecordPostprocessQueue
  → RecordPostprocessListener
  → claimPostprocess(userId, recordId, version, runId)
  → 并行图片理解 / 音频转写
  → completePostprocess(...) 在 DB 提交 processed
  → 分别发布：
      (a) RecordEmbeddingQueue(userId, recordId, version)
      (b) AgentExecutionQueue({type:"proposal", userId, recordId, version})
  → Listener 结束，不等待两个下游任务
```

- 维持现有用户归属、`version`、`runId` / `task_id` 条件写回，防止已更新或删除的 Record 被旧后处理结果覆盖。
- `completePostprocess` 未成功提交则不发布下游消息。
- 单个图片理解或音频转写失败，沿用现有局部失败数据语义；整体异常仍释放本次后处理的 claim，不引入自动重试/恢复。
- 从该 Listener 移除 `await retrieval.replaceRecord(...)` 与直接调用 CreativeRunner；两个队列分别处理。

### 3.2 RecordEmbeddingListener

- 接收 `{ userId, recordId, version }` 后按用户读取指定 Record，要求状态为 `processed` 且版本匹配。
- 沿用 `buildRecordEmbeddingText` 生成文本；没有可向量化内容时跳过，不影响 Proposal。
- 调用现有 Embedding Provider；通过当前 `writeEmbedding` 的 `record_id + user_id + version + status='processed'` 条件更新持久化。生成期间 Record 变化则拒绝过期写回。
- 失败记录日志并结束，不重试、不阻塞 Proposal。

### 3.3 ProposalHandler 与可信源 Record

- 接收 `type=proposal` 后重新读取、检查 `userId + recordId + version`、状态 `processed`；不依赖本条 Record 的向量已生成。
- **直接把触发源 Record 注入 Proposal Agent 的 `creative_context`**，不只注入 `recordIds`：

```ts
{
  role: "proposal",
  sourceRecord: {
    recordId,
    version,
    eventAt,
    content
  }
}
```

- “可信”指 **Server 已核实的用户归属、记录 ID、版本、状态和来源**；`content` 里的用户文字、媒体描述等仍然是资料，不是额外系统指令。
- Proposal Agent 直接获得完整触发源 Record，无须再次检索该 Record；仍可自主通过 `record_read` 获取相关历史、通过 `project_read` 寻找关联 Project、通过 `skill_read` 阅读 Creative Skill。
- 保留 `proposal_create` 对触发源的用户、版本和 status 校验及每轮最多保存一份 Proposal 的既有约束。
- ProposalHandler 负责创建内部 Proposal Session、构建 metadata、调用 `runAgent`、清理 Session；不再调用 `runAgentSkill`。

## 4. Project 统一状态、Proposal accept 与 Creator

### 4.1 唯一 Project 状态

```ts
type ProjectStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "archived";
```

- **完全移除 `active`**，不增加 Proposal `creator_queued`、Project `creatorQueued`、`creationStatus` 或其他重复状态字段。
- `queued`：**等待创作任务执行**，即本次创作已提交，但 Handler 尚未认领开始处理。**只描述任务执行状态，完全不描述 Session 生命周期；有无 `sessionId` 均可处于 queued。**
- `running`：Handler 已认领并开始处理本次创作任务（包括后续 Session 准备和 Agent 执行），或用户主动发起的 Project 会话正在执行；不以 Session 是否存在判断 running。
- `completed`：最近一次 Project 创作/对话执行成功；成果以最新 `content` 为准，可继续创作。
- `failed`：最近一次创作/对话执行失败；保留已有 `content`、`goal`、`sessionId`，不自动重试，后续可通过用户主动会话继续。
- `archived`：归档，不再自动创作、修改或发起 Creator 消息；列表按状态单独筛选。

主要转换：

```text
首次 create：       (Project 不存在) → queued → running → completed | failed
接受 extend：       completed | failed → queued → running → completed | failed
用户主动继续创作：  completed | failed → running → completed | failed
归档：              completed | failed → archived
```

- `queued`、`running` 状态不能再次 accept extend，也不能手动启动新的 Project 消息；返回 `INVALID_STATE / HTTP 409`，防止已有工作被覆盖或多个 Proposal 争用同一 Project。
- `queued`、`running` 不允许归档；用户必须等待该次执行结束，避免归档与未结束的创作同时写入。
- Project 状态转换使用带旧状态检查的数据库原子条件更新，必要时行级锁；不靠无锁的“先查状态再写状态”。
- 状态变化只更新 `status / updated_at`，**不增加 Project 内容乐观锁 version**。只有 Goal/Content 等业务字段变化才改变 version，避免 Agent 持有的 expectedVersion 因状态切换无意义失效。
- 现有 `ProjectService.update`（含 project_manage）要允许 `running` 执行写入，同时根据场景决定是否允许用户直接更新 `completed / failed`；永远拒绝 archived。状态流转不能让 project_manage 保存成果时触发版本冲突。
- 查询、搜索、权限与创作入口中所有原 `status='active'` 判断必须统一调整，不可仅修改 TypeScript 联合类型。

### 4.2 Proposal accept：只返回 projectId

```text
POST /api/proposals/:id/accept
  → 认证用户、检查 Proposal + selectedIdeaId
  → DB transaction
       create: 同步创建初始化 Project(status=queued)
       extend: 仅允许目标 Project 为 completed/failed，追加记录并更新 goal，
               将目标 Project.status 改成 queued
       Proposal.status = accepted
       Proposal.resultProjectId = projectId
  → commit
  → publish AgentExecutionQueue({type:"creator", userId, proposalId, projectId})
  → 返回 {projectId}
```

- accept **不负责创建 Session、确保创作完成或读取运行状态**，也不在响应暴露 Proposal/Project status。
- Proposal 本身仍保存 `pending / accepted / rejected`；无需添加任何 Creator 队列字段。
- 只有 Proposal 首次 `pending → accepted` 时发布 Creator 消息；重复 accept 返回同一个 projectId，**不再次投递**。
- create 使用已有 Project 初始化/向量/记录关联流程；extend 不新建 Project，不删除已发布成果，保留原 Session。
- 事务成功但之后进程退出或消息发布失败，Project 可能停留 queued：这属于明确不做消息持久化/补发/重启恢复的代价；不能让 accept 假称已创作完成。
- 现有 accept 中 Project summary Embedding 失败的 `EMBEDDING_UNAVAILABLE` 行为继续保留，避免改变 Project 向量检索业务语义。

### 4.3 CreatorHandler：以 Project.status 原子认领

```text
AgentExecutionListener 获取后台 Semaphore
  → CreatorHandler 读取指定 Proposal / Project
  → 校验 userId、proposal.status=accepted、proposal.resultProjectId、Project.status=queued
  → 原子认领 Project queued → running（此刻任务开始执行）
  → 创建或复用 Creator Session，必要时 bindSession
  → 协调同一 Session 的原子占用
  → runAgent(根据已接受 Proposal 继续创作)
  → completed / failed
  → 发布 SessionEventBus(sessionId)
  → finally 释放 Session/全局 Semaphore
```

- Handler 拿到后台执行许可、通过业务验证后，先以 `projectId + status=queued` **原子更新为 running，作为任务开始执行的唯一认领动作**；随后独立进行 Session 创建、绑定、reserve 和 `runAgent`。Session 的建立/绑定不驱动 queued 状态，也不能用 Session 是否存在推断是否已认领。Proposal ID 继续随消息传递并与 accepted 状态、目标 Project 校验，可沿用 Session 历史的 `fanto.proposal_dispatched` 记录避免同一提议重复执行。不同 Creator/用户对话通过 Project 状态条件转换及现有 `SessionManager.reserve()` 防止并发。
- create 的 Session 在首次运行前创建并绑定。extend **复用**已绑定的 Session；只有现有 Session 缺失时才创建并绑定，不能丢失历史。
- Session 创建、绑定或占用准备失败，以及执行过程异常，均由当前已认领的 running → failed；保留已有成果，不重试、不重新入队。未被认领的 queued 消息如果丢失则保持 queued，不因 Session 状态变化而自动转换。
- 同一 Session 的用户主动消息与后台 Creator 不得并行；只能一个先取得占用许可，其他调用由明确的 `409` 或本次内存消费中的等待处理。不新增 Project WorkerPool、持久锁或后台补投。
- Creator 初次/extend 指令的 `runAgent` 成功，且依业务约定成功保存应提交的作品后，将 running → completed；Agent 运行成功但该轮应发布作品却没有有效 `project_manage` 提交，标记 failed。用户普通对话可无作品更新，成功结束后同样进入 completed。
- `ProjectService.update`、Session 消息处理、Archive、Project List、Project 向量检索必须使用新 status 规则。记录删除造成的 Project 内容乐观锁变动仍沿用现有校验。

## 5. TaskScheduler / TaskHandler

### 5.1 数据模型

```ts
type TaskRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
```

- **TaskScheduler 创建 Run，TaskHandler 创建并绑定 Session**，不能两侧重复创建。
- `queued` Run **仅表示等待执行**；Scheduler 创建 Run 时尚未分配 Session，因此初始 `worker_session_id = null`、`started_at = null`，但这只是 Scheduler/Handler 的职责分工，**不是 queued 状态的定义或判断条件**。创建时保留 `scheduled_at`、任务归属和目标时刻。
- Handler 获得后台执行许可并验证 Run 后，先条件认领 `queued → running`，设置 `started_at`；再创建并绑定 `worker_session_id`，开始 `runAgent`。如果 Session 准备失败，已认领 Run 转 failed；**不因是否已绑定 Session 决定 queued/running**。
- 继续使用现有 `task_runs` 表及 `(task_id, scheduled_at)` 唯一性约束，不引入消息表或新的执行记录表。

### 5.2 调度与执行

```text
TaskScheduler 扫描 next_run_at 到期的 Task
  → transaction:
      锁定 Task / 检查到期与 active
      插入 TaskRun(status=queued)
      更新 next_run_at（周期任务）或按既有单次规则维护任务进度
  → commit
  → AgentExecutionQueue({type:"task", userId, taskId, taskRunId})
  → TaskHandler
      校验 Task/Run 状态、用户及 agentId
      原子认领 Run queued → running
      创建 Task Agent Session 并绑定 worker_session_id
      runAgent(任务 Brief、traceId、timezone、taskRunId 等)
      已有效 deliver_task_result → completed
      超时、异常或未有效交付 → failed
```

- 保留 TaskScheduler 定时扫描，不在 Handler、Worker、Domain 内增加补扫循环。
- 即时 Task 创建成功后，主动调用 `scheduler.wake()`（或等效调度通知），避免只等待现有五分钟扫描；Run 仍由 Scheduler 唯一创建。
- TaskHandler 沿用现有 Task Brief、Context、Reference Record、Task Plan、`deliver_task_result` 和 TaskResultPublisher。
- `task_plan_manage`、`deliver_task_result` 通过 `taskId + runId + workerSessionId` 继续鉴权，不能让其他 Session 更新计划或交付产物。
- 删除 `TaskWorker` 的 `maxAttempts` 执行循环及有关 Agent 任务定义中的自动尝试配置，移除 `recoverRunning()` 在启动时的补偿行为。
- Agent 配置不存在、Session 创建失败、执行超时、正常结束却未交付结果，均需清晰记录；**已认领为 running 的 Run** 在可处理的异常情况下写入 failed，不能静默留在 running。
- 单次 Task 结束仍标记 Task 完成；周期 Task 保留下一次执行时刻。不主动恢复意外重启中断的 queued/running 记录。

## 6. 统一 AgentWorker

### 6.1 职责

| 组件 | 仅负责 |
| --- | --- |
| `AgentExecutionQueue` | 传递 `proposal/creator/task` 消息 |
| `AgentExecutionListener` | 消费、取得全局后台 Semaphore、类型分发、异常日志、最终释放 Semaphore |
| `ProposalHandler` | 源 Record 校验，Proposal Agent 上下文/Session |
| `CreatorHandler` | Proposal/Project 校验、条件认领、Creator Session 绑定 |
| `TaskHandler` | TaskRun 校验、Session 创建与绑定、结果终态 |
| `AgentWorker` | 统一超时/Abort、Session reserve/release、调用 `runAgent` 的公共生命周期 |
| `runAgent` | 单一 Agent Harness 运行入口 |

- 全局配置改成 `AGENT_EXECUTION_CONCURRENCY`，删除 `CREATIVE_WORKERS`、`TASK_WORKER_CONCURRENCY` 及旧双 WorkerPool 的接线；Proposal / Creator / Task 的执行超时可保留独立业务配置。
- Listener 层 `try/finally` 释放 Semaphore，Worker 层 `try/finally` 清理 timer、Session Reservation 和 Session 实例。任一中途异常均不得泄漏许可或占用标记。
- Main Agent 普通实时会话以及用户主动 Creator 会话**不占后台 Semaphore**；但都遵守 Session 互斥，防止同一个 Session 的重入执行。
- 删除 `CreativeRunner` 队列、`activeProjects` 执行池和 `TaskWorkerPool`，相关保护转为 Domain 条件检查与已有 `SessionManager.reserve()`，不增加新的并行执行层。
- 不实现背压、持久化暂停队列、按优先级排队、公平调度、重试和重启恢复。

## 7. 通用 Session SSE 与 Session History

### 7.1 SessionEventBus

当前 `/api/agent/stream` 是一次 POST 调用附带的 SSE，后台 Creator 没有对应的客户端 POST 连接。新增**同进程、按 sessionId 订阅**的 `SessionEventBus`，统一发布原有 `AgentStreamEvent`。

```ts
type SessionEvent =
  | AgentStreamEvent
  | { type: "start"; agentId: string }
  | { type: "done" }
  | { type: "error"; message?: string };

interface SessionEventBus {
  publish(sessionId: string, event: SessionEvent): void;
  subscribe(sessionId: string, listener: (event: SessionEvent) => void): () => void;
}
```

- Creator 运行产生的事件直接发布到相应 Session；保留 `writeStreamEvent` 和 Tool Presentation 的现有 SSE 格式。
- 前台 Main Agent `POST /api/agent/stream` 继续使用原有请求驱动流，无须进入后台消息 Queue；可复用事件结构，不改变其请求响应形式。
- EventBus 不持久化、不缓存、不补播；SSE 断线从已有 Session History 获取历史消息。
- Session SSE 订阅与 Project.status **相互独立**：只有实际存在且用户拥有的 Session 才能按 `sessionId` 订阅。即使 Project 为 queued，也可能已有可订阅的 Session；如果当前没有 sessionId，则只能等获取到有效 sessionId 后再订阅。

### 7.2 通用 Session History：直接读取

- `GET /api/agent/sessions/:sessionId/history` **不做 Project/Creator 专属处理**，不根据 Project.status / Project.session_id 判断是否可读。
- 沿用通用 SessionManager 的 Session ID 有效性与 **userId 所有权校验**，直接读取 Session 历史并按已有规则进行投影和分页。
- 当前代码中通用 History 对 `isInternalAgent` 的禁读限制也需移除，否则 Proposal/Creator/Task Session 不能“直接读取”；**只放开属于当前用户的 History 读取，不放开内部 Agent 的创建、执行权限**。跨用户 Session 仍拒绝。
- 新增的 Session SSE 仍是订阅接口，只在服务端验证当前用户拥有该 Session；不因为 Session 类型额外查询 Project 或执行上下文，避免与直接按 Session 读取语义相悖。

## 8. HTTP API 与 Schema（本次必须实现）

**同步改完 Server 请求/响应契约、DTO、Schema、路由、测试和 API 文档。** 不维护对旧 H5/iOS 的兼容层；客户端适配另列 TODO。

### 8.1 POST /api/proposals/:id/accept

- 输入仍为 `selectedIdeaId?`，不增加状态相关请求字段。
- 仅关注接受决策的结果：create 初始化 Project 成功，或 extend 对已有 Project 成功完成关联和目标更新。
- **返回最小业务结果，只有 projectId**，不返回 proposal、addedRecordCount、creatorQueued、sessionId 或执行状态。

```json
{
  "success": true,
  "result": { "projectId": "..." },
  "errorCode": null,
  "errorMsg": null
}
```

- 首次成功接受后异步发布 Creator 消息，不等待 Session/Agent；重复 accept 返回原 projectId，不再次发布消息。
- Proposal.detail/list 继续返回 Proposal 自身的通用 `status`，**不增加 creatorQueued**。

### 8.2 GET /api/projects/:id

- **只返回 Project 详情**：现有 Project 字段（含 goal、content、sessionId、关联 Record 统计）以及唯一 `status` 字段。
- `status` 严格来自 `projects.status`，取值：`queued | running | completed | failed | archived`。
- **不返回 creatorQueued 或其他衍生执行状态**；`queued` 仅表示“等待任务执行”，不表示 Session 尚未创建或未绑定。
- `sessionId` 可为 null，独立体现 Session 绑定信息；按 Session 订阅 SSE 只要求 sessionId 有效及归属授权，**不依据 queued/running 等 Project 状态推断 Session 是否存在**。发送新创作消息则独立遵守 Project.status 并发约束。

### 8.3 GET /api/projects

- 默认查询 **所有非归档状态**：`queued、running、completed、failed`；不再默认查询 active。
- 可按 `status=queued|running|completed|failed|archived` 单状态过滤，单独请求 archived 得到归档数据。
- 继续游标分页、摘要字段返回与用户归属过滤；status 过滤值参与游标 scope，不改变分页的一致性规则。
- Project 搜索（向量搜索、Proposal Agent 关联 Project）默认覆盖非归档 Project，不再只查 active；详情与记录查询不因执行状态过滤，权限仍按 userId。

### 8.4 GET /api/agent/sessions/:sessionId/events

标准通用 SSE，按 sessionId 订阅现有 Session 的执行事件；沿用事件 `start/turn_start/message_start/message_end/delta/tool_start/tool_end/done/error`、Tool Presentation 及现有事件序列化。保留心跳与断开后的 unsubscribe。

- 身份认证后调用通用 Session 所有权校验；不检查 Project 归属/状态，不触发 runAgent。
- 不允许跨用户订阅；Session 的只读能力不意味着可创建或触发内部 Agent。

### 8.5 GET /api/agent/sessions/:sessionId/history?cursor=&limit=

- **直接走现有 Session History**，保持返回结构、分页与投影，按通用 Session userId 所有权校验。
- 删除目前对内部 Agent Session 的 History 禁读限制；不做 Creator / Project 特例或状态关联查询。
- 跨用户访问依然拒绝，且不因此放开内部 Agent 的公用执行入口。

### 8.6 POST /api/projects/:id/session/messages

```json
{ "message": "帮我把作品改成手绘风格" }
```

- 用户认证，验证 Project 归属；仅对 status=completed/failed 且 sessionId 可用的 Project 允许发起消息。
- 获取 Session reservation 成功后，将 Project.status 原子更新为 running，直接启动本轮 `runAgent`；**不进入后台 AgentExecutionQueue**，不占后台全局 Semaphore。
- 返回 `HTTP 202` 与 `{sessionId}`，表示消息执行已接受/启动；后续进度通过通用 Session SSE 获取。
- 当 Project `queued/running/archived`、Session 未就绪、Session 被其他运行占用时，返回适当 `409`，不插队、不后台持久化。
- 普通对话成功结束 `running→completed`，错误/超时 `running→failed`，保留原 content。用户对话可以不更新作品正文；结果和历史保存在对应 Session。
- 如响应返回前/后出现异步失败，执行逻辑负责正确释放 reservation、标记 failed、发布 Session 错误事件，不留无控制的 Promise 异常。

### 8.7 TaskRun 响应

现有 Task 列表/详情/Run 查询接口按实际路由更新 TaskRun.status 为 `queued|running|completed|failed|cancelled`，不改其他交付协议。

### 8.8 旧路由清理

删除：

- `GET /api/projects/:id/session/events`
- `GET /api/projects/:id/session/history`
- `POST /api/projects/:id/session/stream`
- `POST /api/projects/:id/session/start`

保留 `POST /api/agent/stream`（前台 Main Agent SSE），新增 `GET /api/agent/sessions/:sessionId/events`（对已有 Session 的订阅）与新 Project Messages 路由。

## 9. OSS 删除简化

```text
Record 删除事务：
  检查媒体引用保护
  删除可删除的 media_assets
  收集允许物理删除的 objectKeys
  删除 Record 及 Record 关联
事务提交：
  限时尝试 oss.remove(objectKey)
  成功 → 结束
  失败 / 超时 → 仅日志，不重试、不补删
```

- 保留 `task_runs.result_media_id` 等已有 Task 产物引用保护。
- 保留 Project `project_manage` 发布最终内容时的媒体独立副本处理；位于 `users/{userId}/project/{projectId}/` 的成果媒体应独立于原始 Record 生命周期。
- 不扩大本次范围：Record 修改时移除旧媒体关联的现有语义不变；其他媒体写入失败时的即时资源清理另按既有逻辑执行。
- 使用有限 OSS 请求等待时间，删除失败不影响 Record 的成功 HTTP 响应；不在数据库事务中调用 OSS 删除。
- 删除 `media_object_deletions` 表、`startMediaCleanup` / `media-cleanup.listener.ts`、补删重试次数/时间表/扫描循环。
- 新增**增量 migration** 删除旧媒体删除表、更新 `projects.status` 的约束及现有记录、使 TaskRun 支持 queued（如有状态 CHECK 则同步更新）；**不新增 proposals.creator_queued**。现有 `active` 记录需确定性转为新状态：已有已发布 content 的 Project → completed；其他旧 active Project 因无法证明存在有效执行消息 → failed（保留 content/session）；旧 archived 保持 archived。不要修改既有已执行 migration 历史；新库也要正确初始化。

## 10. 启动、关闭、配置与清理

- `bootstrap/main.ts`：构建 Queue、业务 Service、SessionEventBus、AgentWorker、Handler，先注册全部 Listener，再启动 Scheduler 与 HTTP 服务。
- 保留数据库及 Agent Runtime 的原有启动顺序；避免 Listener 尚未注册时发布消息。
- 配置收敛到 `AGENT_EXECUTION_CONCURRENCY`，按业务需要保留 Proposal / Creator / Task 超时配置，移除旧独立 Creative/Task Worker concurrency 配置和实际引用。
- 优雅关闭时停止接收新执行消息和 Scheduler Tick，停止 HTTP 接入，按现有服务退出策略处理正在运行的 Agent；无自动恢复、无排队消息持久化。
- 删除 `runAgentSkill` 及其调用、`CreativeRunner`、`TaskWorkerPool`、旧 TaskWorker 实现、Media Cleanup 扫描和相关无效测试/文档引用；迁移 ProjectStatus 类型、Project List/Search、ProposalService.accept、ProjectService.update/archive/Validation 与相关测试的所有旧 active 判断。
- 旧 Task 的 `recoverRunning()` 及启动调用移除；`maxAttempts` 的循环/配置按不重试要求移除。
- 保留 Agent 模块既有的 Session、Tool Presentation、上下文 Provider、Prompt/Skill 等核心能力，不做额外的架构迁移。

## 11. 实施顺序

1. 新增 `event/` 三个内存 Queue + `SessionEventBus`；明确订阅先启动、事件与清理。
2. 拆分 RecordPostprocess、Embedding、Proposal；为 Proposal 注入校验后的完整 sourceRecord。
3. 新建 `execution/` 的统一 Listener、Semaphore、AgentWorker、三类 Handler；保留已有 Agent 模块结构与依赖。
4. 改造 Project.status 为 queued/running/completed/failed/archived，删除 active；accept 最小化响应；Creator/主动对话依 Project 状态原子转换，并保留 Session 互斥；TaskScheduler/TaskRun 增加 queued。
5. 实现通用 SessionEventBus 及 Session SSE；History 仅按通用 userId 所有权直接读取；新增 Project Messages HTTP API，移除旧 Project 专属路由。
6. 同步 Project 列表、向量搜索、Project 更新/归档、Proposal extend 约束与 HTTP DTO；移除所有 creatorQueued/creator_queued 相关字段设计。
7. 简化 OSS 删除；新增 PostgreSQL 增量 Migration，确保老数据状态转换与新库 schema 正确。
8. 完整删除 `creative-runtime/`、`task-runtime/`、`runAgentSkill`、旧扫描/WorkerPool、无效配置，更新 Server 文档。
9. 执行 typecheck、Server 单元/集成测试、HTTP 权限测试和各业务端到端回归。H5/iOS 代码本次不改。

## 12. 验收标准

### Record / Proposal
- 新建/更新 Record 正确写回 processed，图片理解、音频转写数据完整，用户归属/version/runId 校验生效。
- Embedding 与 Proposal 独立；Embedding 失败或尚未生成不阻止触发源 Proposal。
- Proposal Context 直接含服务端已核实的完整 sourceRecord；无法用旧版本、跨用户 Record 创建 Proposal。

### Project 状态、accept 与 Creator
- ProjectStatus **只**有 queued/running/completed/failed/archived；新建 queued、后台 Creator 启动 running、成功 completed、失败 failed，归档 archived；没有 active 或 creatorQueued。
- Create accept 创建 Project、关联 Record 和 Goal 后只返回 projectId；Extend 仅作用于可继续的 Project，不创建新 Project、保留已有 Session 和成果。
- 重复 accept 返回同一 projectId，不再次发布 Creator；正在排队/运行的 Project 不允许并行 extend。
- Handler 的数据库状态条件认领、Session reservation 与异步状态转换正确；两个 Creator/Creator + 用户消息不同时写同一 Session；运行错误转 failed，不再补投。
- ProjectService.update / project_manage 在 running 下可正常更新 content/goal/version；纯状态变动不改变乐观锁 version。
- Project 列表默认包含 queued/running/completed/failed，支持单状态筛选和 archived；向量搜索覆盖非归档 Project，历史记录详情不因状态过滤。
- 旧 active Project 迁移策略可验证，不能产生无对应有效消息、却长时间错误显示 queued 的旧数据。

### Task
- Scheduler 创建 queued Run，表示等待执行；Handler 开始处理时原子认领 running，之后创建并绑定 Session。queued/running 的状态定义**不依赖** Session 是否存在。
- 即时触发、周期 RRULE 时区、计划管理、结果交付与预览功能保持正常。
- Agent 运行失败、超时、未有效 deliver 使本次 Run 失败；不自动重试、补投或重启恢复。

### Session / HTTP
- `/api/agent/sessions/:sessionId/history` 对拥有该 Session 的用户可直接读取，不按 Agent 类型/Project 关系特殊处理；跨用户仍禁止。
- Session SSE / Tool Presentation 能正确发送标准事件、订阅/取消订阅、所有权验证。
- Proposal accept 响应只包含 projectId；Project 详情只用 Project.status 表达状态，不含 creatorQueued。
- 新 Project Messages 接口返回 202、忙碌状态返回 409；前台 Main Agent SSE 不回退。
- 移除旧 Project 专属 History/SSE/Stream/Start 路由，并更新 DTO、测试和文档。

### 资源 / Migration / 代码
- Semaphore、Session reservation、timer 在成功/异常/超时时全部释放。
- OSS 删除失败不影响 Record 删除；Task 成果和 Project 最终媒体副本保护不回退。
- 增量 Migration 正确替换旧状态约束、处理旧 active、删除媒体删除表；已运行 DB 与空库正常。
- 源码无旧 creative-runtime/task-runtime、runAgentSkill、媒体补删扫描依赖；Server typecheck 和回归测试通过。

## 13. 后续 TODO（本次不实现）

- [ ] H5：Proposal accept 只接收 projectId；Project 列表与详情直接使用 status=queued/running/completed/failed/archived，不把 queued 理解为 Session 未绑定；Session 使用独立 sessionId。
- [ ] H5：Project 会话切换为 GET 通用 Session SSE、通用 History + POST Project Messages。
- [ ] iOS：适配 accept 最小响应、Project 五状态、通用 History/SSE/Project Messages；分开处理 Project 执行状态与 Session 绑定信息。
- [ ] 评估客户端对于 SSE 订阅建立前事件缺失、断线后 History 补读的具体 UI/交互策略。
- [ ] 本次不新增自动重试、补投、重启恢复、失败补偿、背压及持久消息机制；未来如需这些保证，另起设计讨论。

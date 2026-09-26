# Fanto Agent Task System

> 日期：2026-09-26
> 状态：设计方案
> 目标：在 Agent Runtime 内建立统一的任务系统，支持 Main Agent 委派单次后台任务、未来定时任务与周期任务，并由独立 Worker Agent 异步执行。
> 边界：Task 完全属于 \`apps/agent\`，不依赖 Business Server。现有 \`agent_tasks / TaskRunner / POST /api/agent/tasks\` 旧模块直接删除并由本方案整体替换，不考虑兼容或渐进改造。

---

## 1. 核心模型

统一只保留两个业务实体：

\`\`\`text
Task
  1
  │
  N
TaskRun
\`\`\`

- **Task**：用户委托给 Fanto 的长期任务定义。
- **TaskRun**：Task 的某一次真实执行。

单次任务：

\`\`\`text
Task
└── TaskRun #1
\`\`\`

周期任务：

\`\`\`text
Task
├── TaskRun #1
├── TaskRun #2
├── TaskRun #3
└── ...
\`\`\`

Task 系统负责：

- 任务定义；
- 调度；
- TaskRun 创建；
- Worker 执行；
- 状态管理；
- 结果持久化。

Worker Agent 只负责执行，不拥有 Task 生命周期。

---

## 2. delegate_task Tool

\`delegate_task\` 是 Main Agent 创建任务的唯一入口。

### 2.1 Tool Schema

\`\`\`ts
delegate_task({
  title: string,
  instruction: string,

  trigger:
    | {
        type: "immediate"
      }
    | {
        type: "scheduled",
        schedule:
          | {
              type: "once",
              at: string,
              timezone: string
            }
          | {
              type: "recurring",
              rrule: string,
              timezone: string,
              startAt?: string
            }
      },

  output?: {
    type: "text" | "markdown" | "html" | "file",
    description?: string,
    filename?: string
  }
})
\`\`\`

一级字段保持：

\`\`\`text
title
instruction
trigger
output
\`\`\`

不增加：

\`\`\`text
delivery
workerAgentId
priority
userId
sessionId
sourceMessageId
nextRunAt
status
\`\`\`

这些都不是模型应该决定的业务参数。

---

## 3. Tool 字段语义

### title

用户可见任务名称。

例如：

\`\`\`text
关西旅行计划
每日 AI 早报
每周记录总结
\`\`\`

### instruction

Main Agent 根据当前聊天整理出的、**完全自包含的 Worker 任务描述**。

不能写：

\`\`\`text
按照刚才说的方案继续做
\`\`\`

应转换成：

\`\`\`text
为用户规划 10 月 2 日至 7 日大阪、京都双人旅行。
预算约 2 万人民币，偏好轻松行程，不喜欢高强度打卡。
输出每日路线、住宿区域、交通方式、主要景点和预算估算。
\`\`\`

Worker 不依赖 Main Session 的聊天上下文才能理解任务。

### trigger

决定 TaskRun 如何产生。

#### immediate

\`\`\`json
{
  "type": "immediate"
}
\`\`\`

创建 Task 后立即创建第一条 TaskRun。

#### scheduled / once

\`\`\`json
{
  "type": "scheduled",
  "schedule": {
    "type": "once",
    "at": "2026-09-27T15:00:00+08:00",
    "timezone": "Asia/Shanghai"
  }
}
\`\`\`

Task 创建时不执行，到达指定时间后创建唯一 TaskRun。

#### scheduled / recurring

\`\`\`json
{
  "type": "scheduled",
  "schedule": {
    "type": "recurring",
    "rrule": "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
    "timezone": "Asia/Shanghai"
  }
}
\`\`\`

Scheduler 根据 RRULE 周期性产生 TaskRun。

### output

描述 Worker 最终交付物期望。

\`\`\`json
{
  "type": "html",
  "description": "生成一份可直接阅读的完整旅行计划",
  "filename": "kansai-trip.html"
}
\`\`\`

整体作为 JSON 保存，不拆独立数据库列。

---

## 4. delegate_task 内部逻辑

Tool 本身只负责：

\`\`\`text
模型参数
  ↓
Schema 校验
  ↓
Trigger 语义校验
  ↓
从 Run Context 补充 user/session/message
  ↓
TaskService.delegate()
  ↓
返回 taskId / runId / nextRunAt
\`\`\`

Tool **不启动 Worker、不等待执行结果**。

伪代码：

\`\`\`ts
async function delegateTask(input, context) {
  const definition = validate(input);

  return taskService.delegate({
    userId: context.userId,
    sourceSessionId: context.sessionId,
    sourceMessageId: context.sourceMessageId,

    title: definition.title,
    instruction: definition.instruction,
    triggerType: definition.trigger.type,
    trigger: definition.trigger,
    output: definition.output ?? null,
  });
}
\`\`\`

Main Agent 收到 Tool Result 后即可结束当前 Chat Run。

---

# 5. 单次立即任务完整流程

示例：

> 帮我规划一下 10 月关西旅行。

\`\`\`mermaid
flowchart TD
    U[User] --> M[Main Agent]

    M -->|Tool Call| DT[delegate_task]

    DT --> V[Validate Input]
    V --> TS[TaskService.delegate]

    TS --> T[(tasks)]
    TS --> R[(task_runs)]

    T -->|trigger_type = immediate| TC[Task Created]
    R -->|scheduled_at = now<br/>status = queued| Q[TaskRun Queued]

    TS -->|taskId + runId| DT
    DT --> M
    M --> U2[Main Agent 立即回复用户]

    Q --> EX[TaskExecutor]

    EX -->|Atomic Claim| RUN[TaskRun running]

    EX --> SS[Create Worker Session]
    SS --> WA[task-worker]

    WA --> WR[Worker Result]

    WR --> EX2[TaskExecutor]

    EX2 --> R2[(task_runs)]
    R2 -->|status = completed<br/>result JSON| DONE[TaskRun Completed]

    EX2 --> T2[(tasks)]
    T2 -->|单次任务结束| FIN[Task status = completed]
\`\`\`

核心顺序：

\`\`\`text
delegate_task
→ INSERT tasks
→ INSERT task_runs(queued)
→ Tool 立即返回
→ TaskExecutor
→ Worker Agent
→ UPDATE task_runs(result, completed)
→ UPDATE tasks(completed)
\`\`\`

---

# 6. 非立即周期任务完整流程

示例：

> 每天早上 8 点给我生成一份 AI 早报。

\`\`\`mermaid
flowchart TD
    U[User] --> M[Main Agent]

    M -->|Tool Call| DT[delegate_task]

    DT --> V[Validate Input]
    V --> TS[TaskService.delegate]

    TS --> T[(tasks)]

    T -->|trigger_type = scheduled<br/>trigger = recurring config<br/>next_run_at = first occurrence| WAIT[Task Active]

    TS -->|taskId + nextRunAt| DT
    DT --> M
    M --> U2[Main Agent 立即回复用户]

    WAIT --> SCH[TaskScheduler]

    SCH -->|next_run_at <= now| TX[DB Transaction]

    TX --> CR[INSERT TaskRun<br/>scheduled_at = current next_run_at<br/>status = queued]

    CR --> UQ{Unique Constraint}

    UQ -->|新 Run 创建成功| NX[根据 RRULE 计算下一次]
    UQ -->|该 scheduled_at 已存在| NX2[同样推进下一次]

    NX --> UP[UPDATE tasks.next_run_at]
    NX2 --> UP

    UP --> COMMIT[Commit]

    CR --> EX[TaskExecutor]

    EX -->|Atomic Claim| RUN[TaskRun running]

    EX --> SS[Create Worker Session]
    SS --> WA[task-worker]

    WA --> WR[Worker Result]

    WR --> EX2[TaskExecutor]

    EX2 --> R2[(task_runs)]
    R2 -->|status = completed<br/>result JSON| DONE[This TaskRun Completed]

    DONE --> KEEP[(tasks)]
    KEEP -->|status remains active| NEXT[等待 next_run_at]
\`\`\`

周期任务中 Task 本身不会因为一次 Run 完成而结束。

---

# 7. next_run_at 规则

\`next_run_at\` 表示：

> **下一次应该产生 TaskRun 的计划时间。**

不是：

- Worker 下次什么时候空闲；
- 上一次什么时候执行完成；
- 最近一次实际开始时间。

### immediate

创建 TaskRun：

\`\`\`text
scheduled_at = now
next_run_at = NULL
\`\`\`

### scheduled / once

创建 Task 时：

\`\`\`text
next_run_at = trigger.schedule.at
\`\`\`

到点后，在同一数据库事务中：

\`\`\`text
INSERT TaskRun(scheduled_at = next_run_at)
UPDATE tasks.next_run_at = NULL
\`\`\`

### scheduled / recurring

创建 Task 时：

\`\`\`text
next_run_at = RRULE 第一次 occurrence
\`\`\`

每次触发：

\`\`\`text
current = task.next_run_at

INSERT TaskRun(
  scheduled_at = current
)

next = calculateNextOccurrence(trigger, current)

UPDATE tasks
SET next_run_at = next
\`\`\`

**TaskRun 创建 + next_run_at 推进必须属于同一个事务。**

Worker 是否执行成功不影响 \`next_run_at\` 推进。

例如：

\`\`\`text
09/26 08:00 TaskRun failed

tasks.next_run_at
仍然已经推进到
09/27 08:00
\`\`\`

---

# 8. 表结构

只使用两张表：

\`\`\`text
tasks
task_runs
\`\`\`

---

## 8.1 tasks

\`\`\`sql
CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,

  title               TEXT NOT NULL,
  instruction         TEXT NOT NULL,

  trigger_type        TEXT NOT NULL
                      CHECK (trigger_type IN ('immediate', 'scheduled')),

  trigger             TEXT NOT NULL,
  output              TEXT,

  status              TEXT NOT NULL
                      CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),

  next_run_at         TEXT,

  source_session_id   TEXT,
  source_message_id   TEXT,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
\`\`\`

SQLite 中 \`trigger\` / \`output\` 使用 JSON 字符串存储。

逻辑结构：

\`\`\`ts
trigger: JSON
output: JSON | null
\`\`\`

### trigger 示例

immediate：

\`\`\`json
{
  "type": "immediate"
}
\`\`\`

recurring：

\`\`\`json
{
  "type": "scheduled",
  "schedule": {
    "type": "recurring",
    "rrule": "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
    "timezone": "Asia/Shanghai"
  }
}
\`\`\`

### output 示例

\`\`\`json
{
  "type": "html",
  "description": "生成可直接阅读的完整旅行计划",
  "filename": "kansai-trip.html"
}
\`\`\`

---

## 8.2 task_runs

\`\`\`sql
CREATE TABLE task_runs (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL,
  user_id             TEXT NOT NULL,

  status              TEXT NOT NULL
                      CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),

  scheduled_at        TEXT NOT NULL,

  worker_session_id   TEXT,

  result              TEXT,
  error               TEXT,

  started_at          TEXT,
  finished_at         TEXT,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,

  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
\`\`\`

\`result\` / \`error\` 同样使用 JSON 字符串存储。

### result 示例

普通文本任务：

\`\`\`json
{
  "type": "markdown",
  "content": "..."
}
\`\`\`

HTML / 文件交付：

\`\`\`json
{
  "type": "artifact",
  "summary": "已完成关西六日旅行计划",
  "artifact": {
    "type": "html",
    "title": "关西六日旅行计划",
    "mimeType": "text/html",
    "path": "tasks/task_xxx/run_xxx/kansai-trip.html",
    "size": 183421
  }
}
\`\`\`

第一版一次 TaskRun 只需要支持一个主要 artifact，因此不单独建立 artifacts 表。

---

# 9. 索引

## tasks

用户任务列表：

\`\`\`sql
CREATE INDEX idx_tasks_user_status
ON tasks(user_id, status);
\`\`\`

按触发类型筛选：

\`\`\`sql
CREATE INDEX idx_tasks_trigger_type
ON tasks(trigger_type);
\`\`\`

Scheduler 核心索引：

\`\`\`sql
CREATE INDEX idx_tasks_due
ON tasks(status, trigger_type, next_run_at);
\`\`\`

主要查询：

\`\`\`sql
SELECT *
FROM tasks
WHERE status = 'active'
  AND trigger_type = 'scheduled'
  AND next_run_at IS NOT NULL
  AND next_run_at <= ?
ORDER BY next_run_at
LIMIT ?;
\`\`\`

---

## task_runs

### 周期任务防重复唯一索引

这是 TaskRun 最关键的约束：

\`\`\`sql
CREATE UNIQUE INDEX uq_task_runs_task_scheduled_at
ON task_runs(task_id, scheduled_at);
\`\`\`

含义：

\`\`\`text
同一个 Task
+
同一个逻辑计划时间
=
最多只有一个 TaskRun
\`\`\`

例如：

\`\`\`text
task_daily_brief
+
2026-09-26T08:00:00Z
\`\`\`

Scheduler 即使重复扫描，也不能创建第二条 Run。

### Task 历史执行

\`\`\`sql
CREATE INDEX idx_task_runs_task_created
ON task_runs(task_id, created_at DESC);
\`\`\`

### 用户历史任务执行

\`\`\`sql
CREATE INDEX idx_task_runs_user_created
ON task_runs(user_id, created_at DESC);
\`\`\`

### Executor 消费

\`\`\`sql
CREATE INDEX idx_task_runs_status_created
ON task_runs(status, created_at);
\`\`\`

Executor：

\`\`\`sql
SELECT ...
FROM task_runs
WHERE status = 'queued'
ORDER BY created_at
LIMIT 1;
\`\`\`

领取必须通过原子 UPDATE / transaction 实现：

\`\`\`text
queued → running
\`\`\`

避免两个 Executor 同时执行同一个 Run。

---

# 10. scheduled_at 语义

\`scheduled_at\` 表示：

> 这一次 TaskRun 对应的逻辑计划执行时间。

周期任务：

\`\`\`text
每天 08:00

Run #1 scheduled_at = 09/26 08:00
Run #2 scheduled_at = 09/27 08:00
Run #3 scheduled_at = 09/28 08:00
\`\`\`

即使实际：

\`\`\`text
started_at = 08:03
\`\`\`

它仍然属于 08:00 这一期。

### immediate

立即任务统一：

\`\`\`text
scheduled_at = TaskRun 创建时间
\`\`\`

不允许 NULL。

这样：

\`\`\`sql
UNIQUE(task_id, scheduled_at)
\`\`\`

对所有 TaskRun 都成立。

---

# 11. Worker 模型

Worker 是 Agent Definition，不建立 Worker 数据表。

\`agents.yaml\` 增加：

\`\`\`text
main
task-worker
coding
\`\`\`

关系：

\`\`\`text
TaskRun
  ↓
TaskExecutor
  ↓
创建独立 Session
  ↓
task-worker
\`\`\`

原则：

1. 每个 TaskRun 创建独立 Worker Session。
2. 不复用 Main Chat Session。
3. 周期任务每一期 Run 也使用新的 Worker Session。
4. Worker 不负责修改 Task / TaskRun 生命周期。
5. Worker 完成后由 TaskExecutor 将最终结果写入 \`task_runs.result\`。

Worker 内部 Agent Loop、Tools 和执行策略不属于本方案范围。

---

# 12. TaskExecutor

TaskExecutor 只消费：

\`\`\`text
task_runs.status = queued
\`\`\`

流程：

\`\`\`text
atomic claim
queued → running

create worker session

runAgent(
  agent = task-worker,
  instruction = task.instruction
)

成功：
task_runs.status = completed
task_runs.result = ...
task_runs.finished_at = now

失败：
task_runs.status = failed
task_runs.error = ...
task_runs.finished_at = now
\`\`\`

如果该 Task 是：

### immediate

Run 完成后：

\`\`\`text
tasks.status = completed
\`\`\`

### scheduled / once

Run 完成后：

\`\`\`text
tasks.status = completed
\`\`\`

### scheduled / recurring

Run 完成后：

\`\`\`text
tasks.status 保持 active
\`\`\`

---

# 13. TaskScheduler

TaskScheduler 只负责：

> 根据 \`tasks.next_run_at\` 创建 TaskRun。

它不执行 Agent。

周期扫描：

\`\`\`text
tasks
WHERE
  status = active
  AND trigger_type = scheduled
  AND next_run_at <= now
\`\`\`

对每一个 due Task：

\`\`\`text
BEGIN

current = next_run_at

INSERT task_runs(
  task_id,
  scheduled_at = current,
  status = queued
)

UPDATE tasks
SET next_run_at = calculateNext(...)

COMMIT
\`\`\`

如果 INSERT 命中：

\`\`\`text
UNIQUE(task_id, scheduled_at)
\`\`\`

说明这一期已经产生过 Run。

此时仍要根据当前 occurrence 推进 \`next_run_at\`，防止 Scheduler 永远卡在旧时间。

---

# 14. 建议目录结构

旧的：

\`\`\`text
apps/agent/src/tasks/repository.ts
apps/agent/src/tasks/runner.ts
apps/agent/src/http/tasks.ts
\`\`\`

以及旧 \`agent_tasks\` 表全部删除。

新结构：

\`\`\`text
apps/agent/
├── agents.yaml
│
├── prompts/
│   └── task-worker.md
│
└── src/
    ├── tools/
    │   ├── index.ts
    │   └── delegate-task.ts
    │
    ├── tasks/
    │   ├── model.ts
    │   ├── repository.ts
    │   ├── service.ts
    │   ├── scheduler.ts
    │   ├── executor.ts
    │   └── index.ts
    │
    └── http/
        └── tasks.ts
\`\`\`

职责：

### tools/delegate-task.ts

\`\`\`text
Tool Schema
→ Input Validation
→ TaskService.delegate()
\`\`\`

### tasks/model.ts

定义：

\`\`\`text
Task
TaskRun
Trigger
Output
Result
Status
\`\`\`

### tasks/repository.ts

统一持久化：

\`\`\`text
tasks
task_runs
\`\`\`

并负责 schema / indexes。

### tasks/service.ts

负责：

\`\`\`text
delegate
pause
resume
cancel
查询任务
查询 Runs
\`\`\`

### tasks/scheduler.ts

负责：

\`\`\`text
next_run_at
→ create TaskRun
→ advance next_run_at
\`\`\`

### tasks/executor.ts

负责：

\`\`\`text
claim queued TaskRun
→ create worker session
→ task-worker
→ persist result
\`\`\`

### http/tasks.ts

只提供前端 Task 模块所需 API，不承载业务逻辑。

---

# 15. 旧 Task 模块处理

本方案不是在当前 \`agent_tasks\` 上演进。

实施时直接：

\`\`\`text
DELETE:
- 旧 AgentTask model
- 旧 AgentTaskRepository
- 旧 TaskRunner
- 旧 agent_tasks schema
- 旧 POST /api/agent/tasks 执行语义

REPLACE WITH:
- tasks
- task_runs
- TaskService
- TaskScheduler
- TaskExecutor
- delegate_task
- task-worker
\`\`\`

如果旧 \`/api/agent/tasks\` 没有需要保留的外部兼容需求，可以直接删除旧接口并重新定义 Task API。

---

# 16. 最终边界

\`\`\`mermaid
flowchart LR
    MAIN[Main Agent] -->|delegate_task| TS[TaskService]

    TS --> TASKS[(tasks)]
    TS --> RUNS[(task_runs)]

    TASKS --> SCH[TaskScheduler]
    SCH --> RUNS

    RUNS --> EX[TaskExecutor]
    EX --> WORKER[task-worker]

    WORKER --> EX
    EX --> RUNS
\`\`\`

最终职责只有四句话：

1. **Main Agent 决定要不要委派，并定义完整 Task。**
2. **TaskService 保存任务定义。**
3. **TaskScheduler 决定什么时候产生 TaskRun。**
4. **TaskExecutor 负责让 Worker 执行 TaskRun，并把结果落库。**

这套结构统一支撑：

\`\`\`text
立即单次后台任务
未来单次任务
周期任务
\`\`\`

未来如果增加条件触发任务，只需要新增 Trigger 产生 TaskRun 的方式，不需要改变 Worker 和 TaskRun 执行模型。

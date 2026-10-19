# Fanto Agent Session V2：增量持久化与主对话会话管理

状态：**方案已确定，尚未实施**。仅保存设计；不修改业务代码、数据库或客户端。日期：2026-10-19。

## 1. 目标与已确认决策

解决当前单个 Session 全量 JSONB Snapshot 不适合长期对话、超过 1 MiB 跳过保存、客户端只持有一个当前 Session ID，以及旧版 Pi SDK PostgreSQL Storage 在一次对话中产生 40+ SQL 操作、导致回复结束卡顿的问题。

- **保持 Pi Agent SDK + MemorySessionRepo**：所有 SDK Commit、Operation/Lane 状态、工具调用中间状态、流式帧都在内存完成。
- **长期数据同步增量保存**：PostgreSQL 保存 Session 元信息、每条 Entry、每次 Usage；SDK 的每个正常 `turn_end` 作为同步增量落库检查点，Run 正常结束、Stop 或失败时再同步 flush 剩余 Entry/Usage，最后才返回 SSE `done/stopped/error`。不设计异步队列、额外 Operations 表、Redis 或复杂重试框架。
- **完整历史不随 Compaction 删除**：Compaction 自身为一条 Entry；历史查询与模型上下文恢复分离。支持长会话和滚动加载。
- **当前主对话 ID 放在服务端用户设置**：`user_fanto_settings.main_session_id`；Agent 模块不读写用户设置。前端创建 Session 成功后再调用用户设置接口更新此 ID。
- **三张 Agent 表**：`agent_session.sessions`、`agent_session.entries`、`agent_session.usage_ledger`；无外键。复用现有 PostgreSQL（Supabase），兼容普通 PostgreSQL 厂商。
- **暂不实现 Token 汇总接口、Admin 后台和用户可见的分支**；只把 Usage 明细保存完整，供未来 Admin 查询。
- 保留已有 Proposal/Creator Session 关联、通用 Stream/Stop/Events 协议，避免重构 Agent 业务功能。

## 2. 现状与问题根源（已核对工程）

- 当前 `LiveSessionRepo` 使用 `MemorySessionRepo` 在线执行；在收尾时 `findEntries({order:'asc'})` 读取整个 Session，序列化成 `agent_session.snapshots.snapshot` 的单条 JSONB，并异步 UPSERT。
- Snapshot 每 Session 只保留一行，硬限制 1 MiB，超限跳过，长会话增长后历史可能无法继续落库；冷恢复会载入所有 Entries。
- 原有 7 张 PG 表（`sessions`、`entries`、`scalar_values`、`list_values`、`usage_ledger`、`branch_entries`、`branch_meta`）是参考 SDK SQLite 语义复刻的通用 `Storage`；目前新会话**不会**写入旧 `sessions/entries/usage_ledger`。**本次用户明确不要求旧数据迁移**，V2 以新会话功能正确为目标，旧数据迁移不在交付范围。
- 旧 PG Storage 在 SDK 的多次 Commit 中写 Operation 状态、临时 Frame、KV、分支索引等，与最终会话消息条数不等价；卡顿原因是**高频同步 SQL 在执行关键路径上**，不是单纯三张表的数量。新的批量持久化绕开该路径。
- 原架构见 `docs/architecture/agent-runtime.md`；SQL 基线与 Snapshot Migration 见 `apps/server/src/migrations/create_current_schema_20261011.ts`、`z_agent_session_snapshots_20261017.ts`。

## 3. 数据库表结构（目标）

继续使用 `agent_session` Schema；下列为 V2 目标逻辑结构。**不做旧 Snapshot/SQLite 映射数据迁移**；实际部署应以新增迁移升级 Schema，必要时采用新表重建/清理旧数据，但不可未经确认直接破坏仍在使用的生产数据。

### 3.1 agent_session.sessions

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | Session ID |
| user_id | TEXT NOT NULL | 所属用户；直接授权校验，不再依赖扫描 owner Custom Entry |
| agent_id | TEXT NOT NULL | main / proposal-agent / creator-agent |
| title | TEXT NULL | 会话标题，第一版可为空 |
| tip_entry_id | TEXT NULL | 当前 SDK main Lane 的最后一个 Entry ID |
| next_seq | BIGINT NOT NULL | 下一个数据库 Entry 排序序号，保持会话内递增 |
| created_at | TIMESTAMPTZ NOT NULL | 创建时间 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后活动时间 |

索引：`(user_id, agent_id, updated_at DESC, id DESC)`。暂不持久化执行锁、状态、租约或累计 Usage。旧 SDK 专用 `metadata`、`storage_version`、`usage_payload`、`message_count` 等字段不属于 V2 目标结构；切走旧 PG Storage 后再清理。

### 3.2 agent_session.entries

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| session_id | TEXT NOT NULL | Session ID |
| id | TEXT NOT NULL | 稳定 SDK Entry ID |
| seq | BIGINT NOT NULL | PostgreSQL 会话内递增的历史排序序号 |
| parent_id | TEXT NULL | 上一 Entry ID，用于 SDK 消息链与恢复 |
| run_id | TEXT NULL | Fanto 一次用户请求的逻辑 Run ID；启动前/系统级 Entry 可为空 |
| type | TEXT NOT NULL | message / compaction / custom；保留兼容 branch_summary 的读取能力 |
| role | TEXT NULL | message 时为 user / assistant / toolResult |
| custom_type | TEXT NULL | custom 时的 fanto.* 类型 |
| payload | JSONB NOT NULL | 完整 SDK Entry 业务 payload；消息及工具结果不再拆很多列 |
| timestamp | BIGINT NOT NULL | SDK 原始毫秒时间戳 |

主键 `(session_id,id)`；唯一索引 `(session_id,seq)`；增加 `(session_id,run_id,seq)` 索引用于一次取齐完整 Run 的 Entries，并保持 `(session_id,seq)` 支撑底层时间顺序。**Run ID 存在 Entries，而不是 Sessions**（一个 Session 含多个 Run）。Fanto 当前已有 `RunData.runId`，持久化时关联它；SDK 内部 `runId/turnId` 事件可用于界定边界，第一版不要求额外持久化 `turn_id`。无外键。

**SDK Entry 类型及用途：**

| type | SDK 语义 | V2 |
| --- | --- | --- |
| message | user / assistant（含 toolCall）/ toolResult；完整消息、工具结果和可选 Usage 在 payload | 保存 |
| compaction | 摘要 `summary`、`retainedTail`、`tokensBefore`，可选 `usage` | 保存，不删除旧消息 |
| custom | Fanto 自定义事件，包括 `fanto.run_stopped` 等 | 保存必要事件；用户归属以 sessions 为准 |
| branch_summary | SDK 导航到历史节点并总结另一路径 | 当前不产生；历史迁移支持识别，不新增分支功能 |

Tool Call 不是单独 `type`；摘要也不是 `type=summary`。历史展示虽主要查询 `type=message`，仍需读取影响 UI 的停止标记等 Custom Entry。媒体通过现有引用机制关联，不在 JSONB 中存大文件二进制。

**Compaction 的独立含义：** `tokensBefore` 是摘要前的上下文规模，不代表摘要调用费用；`compaction.usage` 若有数据用于还原 SDK 信息，统计仍从 Ledger 读取，禁止重复累加。

### 3.3 agent_session.usage_ledger

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| session_id | TEXT NOT NULL | 所属 Session |
| id | TEXT NOT NULL | SDK UsageRow ID、幂等键 |
| entry_id | TEXT NULL | 关联 Assistant Entry；Compaction/独立 Usage 允许为空 |
| run_id | TEXT NULL | Fanto 执行轮次，可为空 |
| provider | TEXT NULL | 模型供应商，未知时为空 |
| model | TEXT NULL | 实际模型，未知时为空 |
| usage | JSONB NOT NULL | SDK 原始 Usage 数据（input/output/cacheRead/cacheWrite/totalTokens/reasoning/cost 等） |
| adjustment | BOOLEAN NOT NULL | SDK 独立 Usage 修正标记 |
| created_at | TIMESTAMPTZ NOT NULL | 发生时间 |

主键 `(session_id,id)`，索引 `(session_id,created_at)`。一条 Ledger 代表**一次计量事件，不是一个 Session 的累计值**。SDK Response、Compaction 和 `recordUsage` 等都可能产生独立的 UsageRow；Entry 中可以保留原生 `usage`，但后续统计**只汇总 Ledger**。不要自行把 `reasoning` 额外加到 `output`，也不假定不同 Provider 对 Cache Token 的归类完全一致。缺少报告的调用不能凭空估算。

## 4. SDK 内部表取舍和分支边界

- `scalar_values`：`lane.config`、`lane.state`、`branch.tip`、`operation.meta/state`、暂存工具参数等运行 KV；第一版不持久化。唯一需要跨重启恢复的最终主链位置改由 `sessions.tip_entry_id` 保存。
- `list_values`：临时模型流式 Frame、队列等列表状态；第一版不持久化。
- `branch_entries` / `branch_meta`：SDK 的通用多分支路径索引；Fanto 不做从历史节点重新生成、多分支切换或 Session Fork。仍保留 `entries.parent_id` 和 `sessions.tip_entry_id`，使内存 main Lane 位置可恢复。
- `snapshots`：整 Session 单字段持久化被增量写入替代；切换新实现后不再写入，旧数据迁移不属于本次范围，清表需独立确认。
- 这与 SDK 本身有 `main` Lane 并不矛盾：**Lane 名不是用户可见的 Branch 功能**；压缩摘要也不是开启新分支。

## 5. Session 与用户设置解耦

仅在 `user_fanto_settings` 增加 `main_session_id TEXT NULL`。Agent Session 数据库不引用设置表、Agent 模块不查询或修改 User Settings。这个字段只表示“用户默认打开的主对话”，Proposal/Creator 仍按各自 Project/Proposal 关系定位 Session。

**App 启动：**

1. iOS/H5 并行读取 Records、用户设置等。
2. 从用户设置响应读取 `mainSessionId`；有值则直接使用通用历史接口按 Session ID 加载。
3. `mainSessionId` 为空或已失效时，新建 main Session 并经用户设置接口保存；切换后的首轮对话与历史读取以客户端**当前内存中的 Session ID** 为准。
4. 不再持久化 main Session ID 到 iOS Keychain / H5 localStorage；旧客户端 ID 如有迁移需求，只有在设置尚无有效指针时迁入并验证用户归属。

**新建主对话：**

1. `POST /api/agent/sessions` 请求 `agentId=main`；Agent 服务负责创建并持久化 Session，仅返回 `sessionId`。
2. 客户端调用现有用户设置更新接口保存 `mainSessionId`。
3. 用户设置保存成功后更新界面当前会话，随后按需加载历史；失败时允许重试。已经创建的 Session 仍可在列表中找到，不做跨模块分布式事务。

**切换历史会话：** 客户端向用户设置更新接口提交已有 main Session ID；服务端必须查 `sessions` 验证 `user_id` 为当前 JWT 用户、`agent_id=main`、Session 存在。完成后加载该 Session 历史。

**多设备：** 用户设置表示默认会话；每次 Stream 仍**显式携带** Session ID，不在执行过程中动态重新读取用户设置，以防其他设备更改默认会话导致消息错投。第一版默认设置写入最后成功者生效，可利用现有 `version` 做并发保护，但不为此引入新 Session 状态。

## 6. 通过 Pi Event 增量持久化（正常 Turn 检查点 + Run 末尾兜底）

```text
POST /api/agent/stream(sessionId, message)
     └─ 取/恢复 MemorySessionRepo；本次 Fanto Run 分配 run_id
          ├─ SDK 内部所有 Commit、Stream Frame、Operation 状态：仅内存
          ├─ Session 级持久化采集器监听 entry_added / usage
          ├─ SDK turn_end → flush 当前已确认的新增 Entries/Usage
          │      └─ PG 单事务：批量 INSERT entries + usage_ledger、UPDATE sessions
          ├─ 下一 Turn / Compaction / 工具按原 Pi SDK 机制继续
          └─ Run 结束 / Stop / 报错 → 完成 SDK 取消收尾及 fanto.run_stopped
                 └─ 最终 flush 未保存的新增 Entries/Usage
                      └─ 检查保存结果、释放 Session → SSE done/stopped/error
```

**Hook 与 Event 的界线：** Pi 0.85.1 没有 `after_turn`/`after_commit` Hook；`after_response`、`after_tool` 和 `before_run_end` 都发生在正式 Session Entry Commit 之前，不适合保存已提交历史。使用原生 `entry_added`/`usage` 采集结果、`turn_end`/`run_end` 安排同步持久化。**源代码依据（SDK 0.85.1）：** `generation.js` 在每次 Assistant 调用前 Commit `assistant.effect_pending`；`response.js` 在响应结果 Commit 时原子保存 `insertEntry(assistant)`、`insertUsage` 与 main tip，然后发出 `entry_added/usage`；工具通过 `tools.js`、`tool-placement.js` 保存结果并在该 Turn 全部 Tool Result 落入内存后发出 `turn_end`；`boundary.js` 另发 `run_end`。原 SQLite 后端 `SqliteStorage.commit()` **每次 SDK Commit 立即事务提交全部中间状态**，是旧版远程 PG SQL 量大的主要原因。V2 **保留原 SDK 执行流程，不持久化原 SQLite 的中间状态，也不新增 operations 表**。

- Fanto 的一个 **Run 是一次用户请求**（可能多个 Turn）；一个 **Turn 是一次 Assistant 响应及该轮工具结果**。正常 `turn_end` 对应已由 SDK 内存 Commit 确认的完整 Turn，是增量存储检查点；`turn_end` **不是所有异常路径必然触发的事件**。
- 每次 flush 只提交“上次成功 flush 后”新采集到的持久化 Entry、Usage；事务通常有 **最多 3 条数据 DML + BEGIN/COMMIT**（如某类数据为空可省略），不在每次 SDK Commit 中访问数据库。一个含多个 Turn 的 Run 会发生多次事务，这比 Run 只写一次慢一些，需测量。
- 同 Session 的 flush 串行且同步等待，每次成功后推进 persisted watermark；失败不清空缓冲区。用稳定 Entry ID、Usage ID 幂等写入，数据库 `seq` 单调分配；SDK 冷恢复后的内存序号不可当作 PG 的排序序号。
- `entry_added` 有时不携带 SDK runId（尤其 Assistant/Tool Result），所以在 **Fanto Run 生命周期作用域内**给采集的 Entries 标注当前 `RunData.runId`；未归属普通 Run 的 Session 初始化/系统 Entry 可为空。一个 Session 同时只能执行一个 Run；内部 SDK turnId 不作为分页的强制字段。
- **异常兜底：** Stop 时遵守现有规则（已开始工具允许完成，阻止后续工具/模型调用），等待 SDK abort/reconcile 结束及 `fanto.run_stopped` 追加后再最终 flush；模型中断、工具失败、超时、主动停止、Compaction Usage、异常没有 `turn_end` 的尾部数据统一纳入兜底。独立于 Run 的显式 Session 修改/自定义 Entry 必须在其业务操作完成时触发 flush，不等待下一次对话。
- **不要把数据库写入失败视作 SDK 事件错误即可：** Pi `HarnessEventBus.deliver()` 会捕获 listener 异常并转发为 `handler_error`，不会自动让 `runAgent` 报错。持久化采集器必须显式记录 `persistError`；Stream 正常/停止/失败收尾都等待挂起的 flush、检查失败，禁止失败后发送“已持久化成功”的 `done`。不能从 `turn_end` 回调直接等待另一个依赖未来同一事件队列的动作，避免死锁。
- 采集订阅必须独立于只负责 UI 的 `subscribeHarnessEvents` 生命周期：现有 `run.ts` 在 `finally` 才追加停止 Custom Entry，单挂 UI SSE 订阅会遗漏它。
- 创建 Session 时立即写入 `sessions`；用户归属以 `sessions.user_id` 为准。只有已 flush 成功的 Session 才允许正常淘汰；未落库内容留内存，可由下一次请求先补写。进程崩溃期间当前未完成 Turn 的内容第一版可丢失，这是不保存 SDK Frame/Operation 状态的明确权衡。
- 性能日志分别统计 `turn_persist_ms`、`final_flush_ms`、`agent_execution_ms` 和 `sse_finish_ms`。远程 PG 多 Turn 会反复同步写入，若实际仍明显增加整体时延，再评估是否退回 Run 结束一次 flush；**先测，不引入后台异步机制**。

## 7. Pi 原生 Compaction 与 Session 恢复（不魔改）

**职责边界：Pi SDK 原生负责摘要生成与模型上下文构建，Fanto 不重新实现。**

- **Compaction：** Pi 自动生成 `compaction` Entry，后续模型调用时自行通过 `scanBranch({stopAtType:"compaction"})` 与 `buildSessionContext()` 恢复最近摘要、retainedTail、后续消息。Fanto 只保存原始 Entry，不删除历史；Character/Memory/Recent Records 仍由已有动态 Context Provider 提供。
- **热 Session：** 沿用 MemorySessionRepo 与 AgentHarness。Pi 内部所有 Commit、Operation/Lane、工具状态与 Stream Frame 留在内存，禁止改动 SDK Loop。
- **冷恢复（第一版）：** `checkpoint/restore.ts` 从 PG 读取**完整、已经持久化的主链 Entries**，通过 Pi 公开 `Session.mutate(...insertEntry(...))`、`createBranch("main", tipId)` API 恢复到 MemorySessionRepo，然后仍调用现有 `buildRuntime()`、`AgentHarness.create()`、`harness.lane("main", ...)` 初始化；尽量复用原 `live-session-repo.ts` 的已验证恢复方式。
- **稳定数据边界：** 只恢复已提交的 Entries、Compaction 与 main tip；不恢复中断中的 Operation、pending Tool、流式 Frame。保留现有 `stableEntries()` 对未配对工具结果的保护并做测试，不能修改正常 Entry 的内容或写回原 PG 数据。
- **禁止：** 手动截断并改写 Entry 的 `parentId`、直接操作 Pi 内部 `lane.state/lane.config`、自行拼接摘要 Prompt、依赖私有 SDK API 重建运行时。PG 历史 seq 与 SDK 重新导入后的内存 seq 分开管理，使用稳定 Entry/Usage ID 去重。

**明确限制：** Pi Compaction 仅使**模型上下文**有界，不会自动清理 MemoryStorage/PG 旧 Entries。第一版冷恢复需要读取全部历史，**不能宣称有界内存恢复**；优先保证稳定与可维护性，记录大 Session 冷启动耗时和内存。以后确有需要再基于 Pi 公开 `Session/Storage` 接口独立优化按需加载，不能为优化提前魔改。

**验收：** 新会话、两次以上 Compaction、Tool Call/Result、Stop/失败后重启续聊；检查摘要仍正确参与上下文、工具不重复调用、消息链合法。

## 8. 历史分页：按完整 Fanto Run 而非 SDK Turn

保持 `GET /api/agent/sessions/:sessionId/history?cursor=&limit=`，直接读取 PostgreSQL；**游标与 limit 表示 Run 分页**，不再按任意数量的原始 Entry 截断一次对话。

- 每次 Fanto 主对话 Prompt 分配一个持久的 `run_id`；一个 Run 含输入 User Entry、若干 Pi SDK Turn、全部 Assistant/Tool Result、Compaction 和停止 Custom Entry。不同请求使用不同 `run_id`。独立系统 Entry 允许为空。
- 使用每个 Run 的**第一条输入 User Entry**（或等价稳定 Run 起点）作为锚点，按该起点的 `seq DESC` 游标分页先取 N 个 Run ID，再按 `(session_id,run_id)` 批量查询对应全部 Entries，按 `seq ASC` 投影；由服务端 `hasMore/nextCursor` 表示是否还有更早 Run。不能仅用 `DISTINCT run_id` 无界扫描历史。
- `type=message` 是历史内容主来源，但必须保留与 UI 有关的 `fanto.run_stopped` Custom；隐藏 `compaction`、内部 Custom、内部推理和不可见工具元数据。复用/适配 `projectHistory()`，保证一次 Run 内的 Tool Result、媒体、用户输入与最终 Assistant 回复不跨页拆散。
- Run 的 SDK 事件中 `turn_end` 不等于用户请求结束；一 Run 可能多 Turn。正在执行尚未提交的内容通过 SSE/内存状态展示，已落库内容通过历史 PG 查询；避免返回重复。
- 校验 `sessions.user_id`；不得返回原始工具 JSON、内部工作区路径等。

## 9. API 范围

| API | 状态 | 说明 |
| --- | --- | --- |
| `POST /api/agent/sessions` | 保留/适配 | 创建 Session，立即写 sessions |
| `GET /api/agent/sessions?agentId=main&cursor=&limit=` | 新增 | 当前用户的 Session 列表；`updated_at DESC,id DESC` 组合游标 |
| `GET /api/agent/sessions/:id/history?cursor=&limit=` | 改造 | PostgreSQL entries **按 Run 分页** + HistoryProjector |
| `POST /api/agent/stream` | 保留/适配 | 显式 sessionId；每次正常 turn_end 同步 flush，Run 最终收尾兜底 flush |
| `POST /api/agent/sessions/:id/stop` | 保留/验证 | 停止语义及落库 |
| `GET /api/agent/sessions/:id/events` | 保留 | 现有只读 SSE |
| 现有 User Settings 读/更新 API | 扩展 | 增加 `mainSessionId`；仅修改默认主会话指针 |

**不实现：** `/usage/summary`、`/sessions/:id/usage`、Admin 后台、用户可见 Branch/Navigation/Fork，以及新持久化异步任务。

## 10. 目标目录结构：新建 checkpoint/ 统一管理持久化

**所有 Agent PG 持久化、Entry/Usage 增量采集、历史数据查询及恢复逻辑统一放在 `apps/server/src/agent/checkpoint/`。** `harness/` 保留 Pi 运行编排，`session/` 只保留 MemorySessionRepo 的内存生命周期；不要在 `session/` 下增加新的 PG Repository 或恢复逻辑。

```text
apps/server/src/agent/
├── harness/
│   ├── session-manager.ts           创建/打开 Session、归属与执行互斥
│   ├── run.ts                       Turn/Run 检查点衔接及 Stop/错误收尾
│   ├── events.ts                    SSE 展示/日志事件，不负责数据库
│   └── build-runtime.ts             Pi Harness 和原生 Compaction（保留）
├── session/
│   └── live-session-repo.ts         MemorySessionRepo 句柄/缓存/淘汰；移除旧 PG Snapshot 写入
└── checkpoint/                      【新建：持久化模块】
    ├── checkpoint.ts                监听 Pi Event、收集 Entry/Usage、Turn/Run flush
    ├── postgres-repository.ts       sessions/entries/usage_ledger 事务及只读查询
    └── restore.ts                   使用 Pi 公开 Session API 导入完整历史和主链 tip

apps/server/src/routes/agent/
    sessions.ts                       Session 列表、按 Run 历史分页（调用 checkpoint 查询）
    stream.ts                         当前 Stream 生命周期；终态前确认 checkpoint 成功
apps/server/src/domain/fanto/         User Settings 增 mainSessionId；Agent 不依赖此表
apps/server/src/migrations/           新前向 Migration
apps/ios/...                          主会话 ID 从用户设置读取
apps/h5/...                           主会话 ID 从用户设置读取
```

- **`checkpoint/checkpoint.ts`** 使用 Pi 的 **Event** 而非不适合的 Hook：`entry_added`、`usage` 收集已经提交的正式结果；`turn_end` 触发同步 PG flush，`run_end` 及 Fanto Run 外层在 Stop/异常后兜底 flush。这里的 checkpoint 指 Fanto **持久化检查点**，不是替代 Pi 内部的 Operation checkpoint。
- **`checkpoint/postgres-repository.ts`** 第一版集中三张表 SQL、游标分页和事务；不为每张表增设独立 Service 和 Repository。用户可见消息仍复用当前 `projectHistory()` 投影逻辑。
- **`checkpoint/restore.ts`** 只通过 SDK 公开接口恢复历史和 tip，不生成摘要、不私自重建 Lane 内部状态。
- 旧 `session/pg-session-repo.ts`、`pg-storage.ts`、`pg-branches.ts`、`pg-queries.ts`、`session-snapshots.ts` 等实现由新链路替换验证后清理。需要复用的 Entry codec 可移到 checkpoint 内。**不迁移旧数据，但也不擅自删除旧数据库内容。**

## 11. 数据库升级边界（不迁移旧数据）

1. **用户明确本次不考虑旧数据迁移。** 不从 Snapshot 或原 SQLite 复刻表搬运历史 Entry/Usage，也不保证老 Session 可在 V2 中恢复；实施前说明旧会话是否暂时不可见及上线影响。
2. 新增前向 Schema Migration 建立 V2 所需字段、索引及 `user_fanto_settings.main_session_id`。既有 Migration 基线不改写；生产清空旧数据或 DROP 旧表必须另行确认，不能把“不迁移”理解成允许静默删除用户数据。
3. Agent 新建的 Session 直接采用 V2，旧的 `snapshot` 写入和 PG Storage 路径不再用于新 Session；验证新会话功能后再清理废弃实现。客户端 User Settings 无有效 Session 时创建新的 main Session。

## 12. 风险、缺陷与验收重点

**关键技术风险：** Pi 公开 Session API 完整冷恢复的兼容性与性能（不自建短链）；其次是 HistoryProjector 按 Run 分组、未完成 Run 展示；第三是每个 Turn 同步 PG 的累计时延；第四是 EventBus 隔离监听异常导致写库失败不能自动传播至 SSE。

**已接受的 MVP 取舍：** 不恢复进程崩溃时的 pending Operation/工具执行、不实现跨实例 Session 锁、不做复杂异步落库、不做 Session Branch、User Settings 与 Session 创建分两次请求且非原子。创建成功但设置更新失败的 Session 仍列于历史列表；多设备默认主会话按最后成功更新生效，Stream 始终固定自己的 Session ID。

**验收清单：**

- [ ] Session 创建持久化，用户归属/agentId 校验，列表及多设备切换正常。
- [ ] User Settings 可保存/读取 mainSessionId；目标 Session 必须属于同一用户且是 main；客户端不再持久存 Session ID。
- [ ] 纯文本、Tool Call/Result、媒体展示、用户澄清、停止/失败情况下的 Entry 与 Usage 完整。
- [ ] 一次含 3+ Turn 的 Run：每个正常 turn_end 至多一次增量事务、结束再按需兜底 flush；无 SDK 中间状态 SQL；测量每个 Turn 持久化耗时。
- [ ] 多次 Pi 原生 Compaction 保留全部历史；重启后用 SDK 公开接口恢复完整 Session 并正确续聊；不改写 parentId/Lane，不重复工具或模型调用；测量大 Session 冷恢复时间/内存。
- [ ] 100+ 个 Run 的游标分页无遗漏、重叠、拆分 Assistant 回复、内部事件泄露；同一 Run 内全部 Tool Result 与回复完整。
- [ ] 一轮落库失败不会以成功标记完成；未保存会话不被正常淘汰；重启时只恢复已提交数据。
- [ ] 保留 Usage 明细、无重复计算；不暴露 Token 汇总 API。
- [ ] 明确旧数据不迁移的上线影响；不在未经确认时删除旧数据；新 Session 历史、Compaction 与 Usage 可正常存储/恢复。

## 13. 建议实施顺序

1. **验证 Pi 原生恢复**：基于公开 Session API 导入完整 Entries、创建 main Branch，并初始化 AgentHarness；经历多次 Compaction 与 Tool 后仍能正常续聊，不触碰 SDK 私有 Lane 状态。
2. **Schema 建立**：三张表目标结构（Entries 增加 run_id）、user settings 字段，不做旧数据回填。
3. **同步增量持久化**：订阅 Entry/Usage，每个正常 turn_end 一次同步 flush，Run 结束/Stop/错误时再兜底 flush；事件监听错误由持久化器显式传出，日志测时。
4. **恢复与查询**：`checkpoint/restore.ts` 使用 Pi 公开接口恢复完整历史，由 Pi 自行处理 Compaction；PG 按 Run 历史分页及会话列表；Owner 归属校验。
5. **客户端**：User Settings 持有默认主会话，创建后更新设置，移除本地 Session ID 持久化；保持通用 Agent Stream。
6. **回归清理**：功能、压缩、性能、跨设备及新数据结构测试；不删除未确认旧数据，清理废弃代码；同步更新 `docs/architecture/agent-runtime.md`、`docs/api/http-api.md`。

**边界总结：** User Settings 选当前主会话；Pi MemorySessionRepo/AgentHarness 管执行与原生 Compaction；新建 `agent/checkpoint/` 统一管理 Entry/Usage 采集、Turn/Run 同步落库、PG 查询和基于公开 Pi API 的冷恢复。保留三张 Agent 表，不增加额外队列、Operations 表，也不魔改 Pi Loop、Lane 或摘要逻辑。

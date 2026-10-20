# Agent Runtime

`apps/server/src/agent/` 是内嵌在 Hono Server 中的唯一 Pi Agent Runtime；没有独立 Agent 服务。Main 对话使用 SessionManager、`runAgent()`、Session History、流式事件和 Tool Presentation。

## Agent 定义与 Tool

`apps/server/agent.yaml` 定义模型、`systemPromptModule`、Tool 白名单、Skill 与 compaction。Prompt 位于 `src/agent/prompts/`，在启动时加载并参与 Agent revision，改动后重启 Server。

| Agent | 运行方式 | 职责 |
| --- | --- | --- |
| `main` | 客户端请求驱动 Stream | 用户长期对话、Record / Memory 与澄清 |

当前仅配置 main，默认静态 Tool 为 record_read、user_memory_manage、present_media；Runtime 另注册 fanto_memory_manage 供角色按需激活。通用工具 / SkillLoader 保留为基础设施，只有显式配置且通过校验的能力才会加载；Main 未开放文件与 bash 工具。

Tool 和 Context Provider 通过 `agent/business-services.ts` 调用领域 Service，不调用内部 HTTP Route 或 Repository；用户身份固定来自 Server Principal / Session Run Context，工具输入不提供用户身份替换权限。

## Context 和 Prompt

`harness/run.ts` 统一创建 Run Context，包含 userId、sessionId、runId、query、最近消息、traceId 与 timeZone。`harness/build-runtime.ts` 在一个 Run 内解析 Prompt 引用的 Provider 插槽，按需获取 Context；不是每个模型 turn 都重复查询。

- Main：预留 Run 后，从可信 Session 的 scope_key 经 FantoService 解析默认 Main 或 active Fanto；每 Run 解析一次角色设置，存入 Run Context，再切换 lane.activeTools。MainDynamicProvider 构建条件 Persona、授权记忆、Record 指南和 Narration，空角色字段不填充。默认 Main 读写 User Memory，角色对 User Memory 仅读；Fanto Memory 绑定当前角色。最近 Record 不再自动注入，Record 只按需使用工具查询。配置 PATCH 在运行中返回 FANTO_BUSY，避免一轮内配置分歧。角色变化不参与 Agent revision，不需重启。权限与生命周期见 [Fanto](../domain/fanto.md)。
- `transform_context` 只修改模型请求视图，不更改 Session 持久 transcript。

长期 Memory 的分类、Agent 读写政策、默认上下文与检索边界统一见 [Memory](../domain/memory.md)；不将 Record embedding 误称为 Memory。

## Session

Main Session 以 `(user_id,agent_id='main',scope_key)` 唯一，scope_key 为 default 或 fantoId。角色创建事务同时插入固定 Session；默认 Main 通过 GET /api/agent/main-session 幂等初始化，禁用任意创建和重绑定。用户行事务锁内验证角色状态并设置运行预留；归档/删除/PATCH 检查同一进程运行状态，运行时返回 FANTO_BUSY。删除先排空并驱逐内存 Session，再显式删除所有持久子资源；多实例需分布式运行租约。

Pi AgentHarness 和 MemorySessionRepo 完整保留。SDK 内部 Commit、Loop、Tool、Stop、Compaction 及模型上下文构建不作修改；`agent/checkpoint/` 通过 Pi 的 `entry_added`、`usage`、`turn_end`、`run_end` 事件收集已提交 Entry/Usage，在每个 Turn 结束时同步提交 PostgreSQL，Run 正常/异常/停止后同步补齐剩余数据。SSE 成功终态之前必须检查 PG 保存结果；写入失败不返回 `done`。保存只涉及 `agent_session.sessions`、`entries`（包括 `run_id`）和 `usage_ledger` 三张活跃表，基线只创建当前三表，不执行旧历史清理；不写入冗余 Session Token 合计。

Session 冷恢复从 PostgreSQL 加载已落库的完整 Entry 主链，通过 Pi 公开的 Session API 恢复后交给 SDK 原生 Compaction 构建上下文。不会修改内部 Lane 或人工拼接摘要；Compaction 限制的是模型上下文，不限制冷恢复所加载的历史长度。当前仅单进程防并发，同一 Session 互斥运行；暂不恢复进程崩溃期间正在执行的工具或流式 Frame。

History API 从 PG 按完整 Fanto `run_id` 分页，再经既有 `projectHistory()` 投影，避免同一用户请求中的多个 Pi Turn/Tool Result 跨页拆开。空闲 Session 可从缓存淘汰并在下次使用时冷恢复；未保存完的缓存不能淘汰。`GET /api/agent/sessions` 支持当前用户的会话列表和游标分页。旧 Session 数据不搬迁，不影响新 Session 正常使用。

## 唯一对话 HTTP 协议

- `POST /api/agent/stream`：`{sessionId,message}`，响应 SSE。客户端断线仅分离输出，不取消运行；可从已保存 History 和运行中内存片段恢复当前文本。超时仍保留独立取消控制；正常 `done` 在同步 checkpoint 成功后才发送。
- `POST /api/agent/sessions/:sessionId/stop`：先校验归属、标记停止。停止文字输出和未启动的模型/工具；已开始工具不接收用户停止的取消信号，按原超时自然完成并保留结果，不再请求模型总结。已结束返回 `200 {sessionId,stopped,stopping:false}`；仍在收尾返回 `202 {sessionId,stopped:true,stopping:true}`，客户端保持发送锁及原 SSE，工具结果收尾后收到 `stopped` 恢复发送。stop 本身不等待工具或数据库；所有权等请求处理超时仍可返回 503。已正式提交的部分文字/工具结果与 `fanto.run_stopped` 在停止收尾后同步落库，下一轮可继续，不重放 POST/工具。
- `GET /api/agent/sessions/:sessionId/history?cursor=&limit=`：按 Session 所有权读取，返回产品化 `messages[].blocks`，包含文本、可见 Tool 活动、媒体及澄清表单信息；内部 Session 也可按用户归属读取。

H5/iOS 在 Main 对话使用相同消息语义和组件（Markdown、媒体、Tool 进度）。SSE Tool 只公开经过 `presentation` 策略投影的用户可见信息；不要渲染模型原始 Tool JSON、内部 mediaId、工作区路径或密钥。客户端 stop 请求上限 25 秒；202 只是请求已接受，终态或 History 确认空闲后才恢复发送。历史补载失败保留本地回复，旧 SSE/历史请求不能覆盖新轮次；收到 `done/stopped/error` 即结束本轮读取，无需等待连接 EOF。

## 安全边界

统一 JWT 鉴权，并在会话和领域操作分别校验用户；模型不能声明 userId 。Agent 的 `bash` 执行仍使用宿主环境工作区约束，不能将其等同于容器或微虚拟机隔离。

History 返回 `running/stopping/restored`；活跃回复由内存中的已接受片段补齐，旧历史请求不得覆盖新轮次。`finalizing` 保留为兼容进度，不显示数据库保存锁；会话完成仍以 `done/stopped/error` 为准。排障区分 `model response ready after memory drain`、Turn checkpoint 保存耗时、Run final flush 与 `agent-stream session released`，日志不含消息内容或凭据。

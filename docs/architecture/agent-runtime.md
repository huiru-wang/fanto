# Agent Runtime

`apps/server/src/agent/` 是内嵌在 Hono Server 中的唯一 Pi Agent Runtime；没有独立 Agent 服务。Main 对话使用 SessionManager、`runAgent()`、Session History、流式事件和 Tool Presentation。

## Agent 定义与 Tool

`apps/server/agent.yaml` 定义模型、`systemPromptModule`、Tool 白名单、Skill 与 compaction。Prompt 位于 `src/agent/prompts/`，在启动时加载并参与 Agent revision，改动后重启 Server。

| Agent | 运行方式 | 职责 |
| --- | --- | --- |
| `main` | 客户端请求驱动 Stream | 用户长期对话、Record / Memory 与澄清 |

当前仅配置 main，Tool 白名单为 record_read、memory_manage、present_media。通用工具 / SkillLoader 保留为基础设施，只有显式配置且通过校验的能力才会加载；Main 未开放文件与 bash 工具。

Tool 和 Context Provider 通过 `agent/business-services.ts` 调用领域 Service，不调用内部 HTTP Route 或 Repository；用户身份固定来自 Server Principal / Session Run Context，工具输入不提供用户身份替换权限。

## Context 和 Prompt

`harness/run.ts` 统一创建 Run Context，包含 userId、sessionId、runId、query、最近消息、traceId 与 timeZone。`harness/build-runtime.ts` 在一个 Run 内解析 Prompt 引用的 Provider 插槽，按需获取 Context；不是每个模型 turn 都重复查询。

- Main：通过 CharacterProvider 经 FantoService 从 `user_fanto_settings.role_config` 读取当前用户唯一的角色配置与昵称，以 `character`、`scenario`、`character_instructions`、`example_dialogues` 插值注入现有 Prompt。昵称通过 `fanto_identity` 注入，**专指 Fanto Agent 自己的昵称**，不是用户名字；与角色设定中出现的其他名字冲突时以该昵称为准，用户姓名由用户自述与个人背景记忆决定。Main 不再配置 `collect_user_input`，普通澄清直接在对话中提问；历史表单消息的存储与客户端兼容代码仍保留。每个 Run 读取一次，读取失败中止该 Run，保存后同一 Session 下一轮生效；角色配置不参与代码 Prompt 的 revision，不需要重启或重建会话。个人背景与相处偏好由 MemoryProvider 按预算注入，关系与近期关注按话题检索（见 [Memory](../domain/memory.md)）；近期 Record、当前日期继续由对应 Provider 提供；近期 Record 采用代码配置的最近两条，相关历史由模型主动调用 `record_read(query)`。
- `transform_context` 只修改模型请求视图，不更改 Session 持久 transcript。

长期 Memory 的分类、Agent 读写政策、默认上下文与检索边界统一见 [Memory](../domain/memory.md)；不将 Record embedding 误称为 Memory。

## Session

主对话 Session 独立于 User Settings：Agent 持有 Session 生命周期及 `user_id/agent_id` 权限；`user_fanto_settings.session_id` 仅是用户默认打开的主会话指针，创建/切换分别调用 `/api/agent/sessions` 与 `/api/fanto/settings`，Stream 固定明确的 sessionId。

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

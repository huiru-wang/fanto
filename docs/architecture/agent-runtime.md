# Agent Runtime

`apps/server/src/agent/` 是内嵌在 Hono Server 中的唯一 Pi Agent Runtime；没有独立 Agent 服务。所有 Agent 的对话复用 SessionManager、`runAgent()`、Session History、流式事件和 Tool Presentation。

## Agent 定义与 Tool

`apps/server/agent.yaml` 定义模型、`systemPromptModule`、Tool 白名单、Skill 与 compaction。Prompt 位于 `src/agent/prompts/`，在启动时加载并参与 Agent revision，改动后重启 Server。

| Agent | 运行方式 | 职责 |
| --- | --- | --- |
| `main` | 客户端请求驱动 Stream | 用户长期对话、Record / Memory 与澄清 |
| `proposal-agent` | 后台 AgentExecutionQueue | 读取 Record / Creative Skill，按价值判断并保存 1–2 个候选 |
| `creator-agent` | 后台首次创作 + 用户继续 Stream | 按接受的 Goal 在 Project Session 创作和修改作品 |

Tool 仅按 Agent YAML 白名单加载，包含 `record_read`、`memory_manage`、`present_media`、`collect_user_input`、`skill_read`、`project_read`、`proposal_create`、`image_generate`、`project_manage` 与可配置的 `read/write/edit/bash`。不是每个 Agent 都能使用所有工具。Skill 按 `apps/server/skills/<id>/SKILL.md` 加载；Creative Skill 有四份意图参考。

Tool 和 Context Provider 通过 `agent/business-services.ts` 调用领域 Service，不调用内部 HTTP Route 或 Repository；用户身份固定来自 Server Principal / Session Run Context，工具输入不提供用户身份替换权限。

## Context 和 Prompt

`harness/run.ts` 统一创建 Run Context，包含 userId、sessionId、runId、query、最近消息和必要的 creative/project 元数据。`harness/build-runtime.ts` 在一个 Run 内解析 Prompt 引用的 Provider 插槽，按需获取 Context；不是每个模型 turn 都重复查询。

- Main：通过 CharacterProvider 从 `user_character` 读取当前用户唯一的角色配置，以 `character`、`scenario`、`character_instructions`、`example_dialogues` 插值注入现有 Prompt。每个 Run 读取一次，保存后同一 Session 下一轮生效；角色配置不参与代码 Prompt 的 revision，不需要重启或重建会话。个人背景与相处偏好由 MemoryProvider 按预算注入，关系与近期关注按话题检索（见 [Memory](../domain/memory.md)）；近期 Record、当前日期继续由对应 Provider 提供；近期 Record 采用代码配置的最近两条，相关历史由模型主动调用 `record_read(query)`。
- Creator：可信 `creation_context` 绑定 Project，按需用 `project_read` 获取最新 Goal、正文、version、关联资料。
- Proposal：可信触发 Record 信息，按需读取 Creative Skill、真实 Record 与相关 Project。
- `transform_context` 只修改模型请求视图，不更改 Session 持久 transcript。

长期 Memory 的分类、Agent 读写政策、默认上下文与检索边界统一见 [Memory](../domain/memory.md)；不将 Record embedding 误称为 Memory。

## Session

通过 `POST /api/agent/sessions` 创建已配置 Agent 的 Session；稳定的 `fanto.session_owner` entry 绑定用户、Agent 与 revision，工作区为 `AGENT_WORKSPACE_ROOT/<userId>/<sessionId>`。AgentSessionManager 持有公开 MemorySessionRepo，所有 SDK commit、frame drain、History 与下一轮上下文都在内存完成。`reserve` 保持单 Session 串行，仅支持单进程；不提供跨实例协调。

每轮完成或停止收尾后，在内存提取稳定 transcript/main tip，通过单条 UPSERT 异步保存到 `agent_session.snapshots`；不保存 Operation 或 pending frames。每会话最多一份在途和一份最新待写快照，后台最多两个数据库写入并发、失败最多尝试两次、单份快照上限 1 MiB。历史保存慢或失败不延迟 `done`、Session 释放或下一轮；进程退出/资源压力可能丢失最近未保存消息。最多保留 128 个已加载 Session，优先淘汰已保存的空闲会话，无可淘汰空间时拒绝新会话加载，不淘汰正在执行的会话。停止后刷新页面从同进程内存恢复部分回复；冷恢复从最后成功快照重建稳定历史，不自动恢复模型或工具执行。

既有七表 PG Session 作为旧会话只读兼容来源；无新快照时冷读稳定 entries/main tip 并恢复内存，下轮结束后保存新快照。旧的 pending 操作不恢复，缺少结果的 tool call 被关闭，不重放工具。业务 Record/Project 等写入继续使用领域服务原有事务。

空闲 Session 可以应用更新后的 Agent definition revision，但 `agentId`、`userId` 一经绑定不可改变。Stream 从当前用户的 Session 解析 Agent ID；Creator 仅在 Project↔Session 绑定和归档写保护校验通过后获得 Project 工具权限。Proposal 缺可信 Record 上下文时，必需 Provider 在模型调用前拒绝执行。

## 唯一对话 HTTP 协议

- `POST /api/agent/stream`：`{sessionId,message,metadata?:{projectId?}}`，响应 SSE。客户端断线仅分离输出，不取消运行；可从 History 的内存快照恢复当前文本。超时仍保留独立的取消控制。正常终态在内存收尾和释放会话后发送，不等待 PostgreSQL。
- `POST /api/agent/sessions/:sessionId/stop`：先校验归属、标记停止。停止文字输出和未启动的模型/工具；已开始工具不接收用户停止的取消信号，按原超时自然完成并保留结果，不再请求模型总结。已结束返回 `200 {sessionId,stopped,stopping:false}`；仍在收尾返回 `202 {sessionId,stopped:true,stopping:true}`，客户端保持发送锁及原 SSE，工具结果收尾后收到 `stopped` 恢复发送。stop 本身不等待工具或数据库；所有权等请求处理超时仍可返回 503。保留部分文字与 `fanto.run_stopped` 内存标记，下一轮可继续，不重放 POST/工具。
- `GET /api/agent/sessions/:sessionId/history?cursor=&limit=`：按 Session 所有权读取，返回产品化 `messages[].blocks`，包含文本、可见 Tool 活动、媒体及澄清表单信息；内部 Session 也可按用户归属读取。
- `GET /api/agent/sessions/:sessionId/events`：只读订阅既有 Session 的执行事件。适用于后台 Creator 首次创作；不发起 Run，不缓存和回放消息。断开后查询 History 补齐事实。

H5/iOS 在 Main 与 Project 对话复用相同消息语义和组件（Markdown、媒体、Tool 进度）。SSE Tool 只公开经过 `presentation` 策略投影的用户可见信息；不要渲染模型原始 Tool JSON、内部 mediaId、projectId、工作区路径或密钥。Creator 首次后台执行和后续用户 Stream 共享同一 Session，但生命周期触发方式不同。客户端 stop 请求上限 25 秒；202 只是请求已接受，终态或 History 确认空闲后才恢复发送。历史补载失败保留本地回复，旧 SSE/历史请求不能覆盖新轮次；收到 `done/stopped/error` 即结束本轮读取，无需等待连接 EOF。

## 安全边界

统一 JWT 鉴权，并在会话和领域操作分别校验用户；模型不能声明 userId、任意 projectId 。Agent 的 `bash` 执行仍使用宿主环境工作区约束，不能将其等同于容器或微虚拟机隔离。

History 返回 `running/stopping/restored`；活跃回复由内存中的已接受片段补齐，旧历史请求不得覆盖新轮次。`finalizing` 保留为兼容进度，不显示数据库保存锁；会话完成仍以 `done/stopped/error` 为准。排障区分 `model response ready after memory drain`、`agent-stream session released` 和异步 `session-snapshot saved/save failed`，日志不含消息内容或凭据。

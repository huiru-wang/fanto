# Agent Runtime

`apps/server/src/agent/` 是内嵌在 Hono Server 中的唯一 Pi Agent Runtime；没有独立 Agent 服务。所有 Agent 的对话复用 SessionManager、`runAgent()`、Session History、流式事件和 Tool Presentation。

## Agent 定义与 Tool

`apps/server/agent.yaml` 定义模型、`systemPromptModule`、Tool 白名单、Skill、compaction 以及 Task Worker 限制。Prompt 位于 `src/agent/prompts/`，在启动时加载并参与 Agent revision，改动后重启 Server。

| Agent | 运行方式 | 职责 |
| --- | --- | --- |
| `main` | 客户端请求驱动 Stream | 用户长期对话、Record / Memory、澄清、创建与管理 Task |
| `proposal-agent` | 后台 AgentExecutionQueue | 读取 Record / Creative Skill，按价值判断并保存 1–2 个候选 |
| `creator-agent` | 后台首次创作 + 用户继续 Stream | 按接受的 Goal 在 Project Session 创作和修改作品 |
| `task-worker` | 后台到期 TaskRun | 调研、文字/Markdown/HTML 文件生产并交付 |

Tool 仅按 Agent YAML 白名单加载，包含 `record_read`、`memory_manage`、`present_media`、`collect_user_input`、`create_task/update_task/get_task`、`skill_read`、`project_read`、`proposal_create`、`image_generate`、`project_manage`、`web_search`、`task_plan_manage`、`deliver_task_result` 与任务工作区相关 `read/write/edit/bash`。不是每个 Agent 都能使用所有工具。Skill 按 `apps/server/skills/<id>/SKILL.md` 加载；Creative Skill 有四份意图参考。

Tool 和 Context Provider 通过 `agent/business-services.ts` 调用领域 Service，不调用内部 HTTP Route 或 Repository；用户身份固定来自 Server Principal / Session Run Context，工具输入不提供用户身份替换权限。

## Context 和 Prompt

`harness/run.ts` 统一创建 Run Context，包含 userId、sessionId、runId、query、最近消息和必要的 task/creative/project 元数据。`harness/build-runtime.ts` 在一个 Run 内解析 Prompt 引用的 Provider 插槽，按需获取 Context；不是每个模型 turn 都重复查询。

- Main：角色表达、偏好/记忆 guidance、近期 Record、当前日期等；近期 Record 采用代码配置的最近两条，相关历史由模型主动调用 `record_read(query)`。
- Creator：可信 `creation_context` 绑定 Project，按需用 `project_read` 获取最新 Goal、正文、version、关联资料。
- Proposal：可信触发 Record 信息，按需读取 Creative Skill、真实 Record 与相关 Project。
- Task Worker：TaskExecutionContextProvider 提供输出格式、Record references、内部文件目标与已保存 Plan；用户 Task Brief 不包含 OSS/相对路径/工具协议。
- `transform_context` 只修改模型请求视图，不更改 Session 持久 transcript。

当前长期 Memory 是显式管理的 Memory Domain，Profile/Goal 按需检索，Guidance 自动注入；不将 Record embedding 误称为 Memory。

## Session

通过 `POST /api/agent/sessions` 创建任意已配置 Agent 的 Session；Pi SQLite 中的 `fanto.session_owner` custom entry 绑定用户、Agent 与 revision。会话工作区 `AGENT_WORKSPACE_ROOT/<userId>/<sessionId>`。同 Session 的 `reserve` 防止并发执行；历史按用户归属读取。后台 Proposal / Task / Creator Session 仍由服务端创建，公共 Session 可以创建对应 Agent 的无业务授权 Session。

空闲 Session 可以应用更新后的 Agent definition revision，但 `agentId`、`userId` 一经绑定不可改变。Stream 从当前用户的 Session 解析 Agent ID；Creator 仅在 Project↔Session 绑定和归档写保护校验通过后获得 Project 工具权限。Proposal 缺可信 Record 上下文、Task Worker 缺正在运行且绑定自身 Session 的 TaskRun 时，必需 Provider 在模型调用前拒绝执行。

## 唯一对话 HTTP 协议

- `POST /api/agent/stream`：`{sessionId,message,metadata?:{projectId?}}`，POST 响应 SSE；Agent 身份由 Session 解析，外部 metadata 仅允许 Project ID。断开时取消该请求驱动 Run；SSE 按阶段发送 `turn_start/message_start/message_end/delta/tool_start/tool_end`，结束为 `done/error`。
- `GET /api/agent/sessions/:sessionId/history?cursor=&limit=`：按 Session 所有权读取，返回产品化 `messages[].blocks`，包含文本、可见 Tool 活动、媒体、Task 卡及澄清表单信息；内部 Session 也可按用户归属读取。
- `GET /api/agent/sessions/:sessionId/events`：只读订阅既有 Session 的执行事件。适用于后台 Creator 首次创作；不发起 Run，不缓存和回放消息。断开后查询 History 补齐事实。

H5/iOS 在 Main 与 Project 对话复用相同消息语义和组件（Markdown、媒体、Tool 进度）。SSE Tool 只公开经过 `presentation` 策略投影的用户可见信息；不要渲染模型原始 Tool JSON、内部 mediaId、projectId、工作区路径或密钥。Creator 首次后台执行和后续用户 Stream 共享同一 Session，但生命周期触发方式不同。

## Task 执行与交付

`TaskScheduler` 定时扫描 PostgreSQL 到期 Task，创建 `queued` TaskRun 并投递共享 AgentExecutionQueue，`TaskHandler` 认领后创建独立 Worker Session，调用 `AgentWorker → runAgent`。Worker 可使用 `task_plan_manage(create/update)` 将用户可读计划持久化到 `task_runs.ext_data.plan`，最后通过 `deliver_task_result` 将工作区相对路径文件上传 OSS，写入 TaskRun 的 result。失败不自动重试；没有可靠 MQ/重启恢复。安全边界与排程详见 [Server](server.md)。

## 安全边界

统一 JWT 鉴权，并在会话和领域操作分别校验用户；模型不能声明 userId、任意 projectId 或任意 TaskRun 所有权。Agent 的 `bash` 执行仍使用宿主环境工作区约束，不能将其等同容器/微虚拟机隔离。生产支持何种 Worker 任务必须匹配实际安全部署环境。

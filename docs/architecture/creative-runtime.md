# 创作执行：Proposal → Project → Creator

当前创作能力由 `domain/projects/` 维护业务事实，`execution/handlers/` 发起后台运行，`agent/` 提供同一 Pi Session / Run 能力。

## 发现与接受

Record postprocess 成功后（配置 `CREATIVE_ENABLED=true`），向 `AgentExecutionQueue` 发布 Proposal 消息。ProposalHandler 运行内部 `proposal-agent`，按需读取 `skills/creative/SKILL.md` 和「入画 / 异想 / 成章 / 回声」参考，使用 `proposal_create` 存储至多两条真正不同的候选。没有明确价值时不产生 Proposal，不向用户追问。

Proposal `content={reason,ideas:[{id,title,idea,tags,goal}],selectedIdeaId}`；`idea` 面向用户预告可想象的成品，`goal` 则记录目标、背景和约束。两者不是执行计划，不存图片槽位、预算或自动决定用户选择。Proposal Session 与 Creator Session 不混用。

接受时 `POST /api/proposals/:id/accept` 返回 `{projectId}`：事务内按选中 Idea 创建/更新 Project、关联 Record、状态变为 `queued`，随后发布后台 Creator 消息。重复接受同一方向只返回原 projectId。

## Project 生命周期

`queued → running → completed | failed`，可以归档为 `archived`。

- queued：排队等待，和 Session 是否已绑定无关。
- running：Handler 已认领，包括初始化会话与执行阶段。
- completed / failed：本轮成功或失败；失败保留已发布内容，允许用户继续尝试。
- archived：只读，不继续执行。

CreatorHandler 基于 Project 已确认的 Goal 和 Record，创建或复用长期 `creator-agent` Session，用 `image_generate` 生成单张图（可多次调用）、用 `project_manage` 保存完整正文、摘要和封面。成果以完整 Markdown / 安全 `html-preview` 字符串保存，媒体使用 `fanto-media://<mediaId>`；不存专用 Project Run、Tool Trace、租约、图片槽位或数量预算。Agent 最终回复应该简洁介绍作品与可调整方向，不写技术执行报告或泄露内部 ID。

## 唯一多轮会话接口

Main Chat 和 Project Chat 统一调用：

- `GET /api/agent/sessions/:sessionId/history`：按 Session 用户归属读取、投影文本/Tool Presentation/媒体。
- `POST /api/agent/stream`：`{sessionId,message,metadata?:{projectId?}}` 的请求驱动 SSE。Agent ID 由 Session 绑定解析，Creator 的 `projectId` 经 Project↔Session 归属校验；普通续聊不执行 `running/completed/failed` 状态流转。仅 `project_manage` 成功保存非空作品时，可将 `failed` 恢复为 `completed`。
- `GET /api/agent/sessions/:sessionId/events`：只读订阅后台首次创作的 Session EventBus，不会启动执行；无事件重放。客户端订阅失败仍可在 Project 可继续时通过 `/stream` 发送，掉线后从 History 恢复。

所有已配置 Agent 都可以创建公开 Session，但没有可信 Record/Project/TaskRun 上下文时，专用 Provider 在模型调用前拒绝执行。Proposal 的 recordId/version 和 Worker 的 task 信息仅服务端注入；Creator 项目权限由领域服务验证。History 只校验 Session 所有权。客户端不应展示内部媒体 ID 或原始 Tool JSON，Tool Presentation 由服务端工具声明决定。

## 媒体和失败边界

`image_generate` 生成图直接放在 `users/{userId}/project/{projectId}/` 下。只有 Record 或其它外部 Media 真正写入 Project 正式正文/封面时，`project_manage` 才在保存时复制对象、分配新的 mediaId 并替换引用；仅作为参考的源媒体不复制。Record 删除时按自身独占资产正常清理，已保存作品的副本不受影响。OSS 清理在 DB 提交后尽力执行，失败记日志，不存在持久队列重试。

进程内消息、SSE 发布事件不持久化；服务重启可能导致 queued/running 状态遗留。Creator 生图没有持久化补单机制，失败后由用户在会话中决定是否继续，不承诺自动恢复或付费幂等。

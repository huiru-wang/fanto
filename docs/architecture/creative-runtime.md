# Creative Runtime（Project Session 模式）

## 目标与权威数据

- **Proposal**：保存建议内容 `reason / idea / plan / tags / goal` 与参考 Record；不记录创作状态。
- **Project**：存最新 `goal`、`content`、`sessionId`、summary、coverMediaId、version、active/archived。
- **Pi Agent Session**：存执行消息、工具调用、后续对话和历史；无项目创作进度、Run、图片槽位与租约数据表。
- **Task / TaskRun** 仍属于独立后台任务系统，不受本次改变影响。

## 生命周期

1. Record postprocess 完成后，CreativeRunner 定期扫描新版本已处理 Record，调用内部 proposal-agent；分析产出 Proposal 或 `no_proposal`。已分析的 Record 版本标记在 `records.ext_data.proposalAnalyzedVersion`，不再有 `proposal_runs`。
2. `POST /api/proposals/:id/accept` 在 PostgreSQL 中创建（create）或更新（extend）Project.latest `goal`，处理 Record 关联。后台确保 Project 绑定一个 `creator-agent` Session，返回其 ID，绑定完成前不执行 Agent。
3. Creator Agent 运行只从可信 `creation_context = {projectId}` 知道 Project；使用 `project_read` 获取最新 goal/content/version 与关联素材，按需 `skill_read / record_read / image_generate`，最后 `project_manage` 保存完整成果。
4. `project_manage` 内将保存的完整 `content` 与 `coverMediaId` 中引用的外部媒体复制至该 Project 的 OSS 目录，生成独立 mediaId 并重写引用，保证删除源 Record 后仍可用。
5. 用户从已完成 Project 的悬浮入口使用同一 Session 继续对话和修改。Session 历史由 `/api/projects/:id/session/history` 授权读取；`.../events` 推送后台活动；`.../stream` 执行用户新消息。

## Agent 工具

- `proposal_create`：存待确认的 Goal 提议。
- `project_read`：查找 Project 或读取绑定 Project 的最新详情。
- `image_generate`：输入 prompt / referenceMediaIds[] / 可选 aspectRatio，一次生成一张图片并存 Project 专属 OSS 目录，返回 mediaId/mimeType/width/height；无 Run、预算、固定张数、进度或幂等状态。
- `project_manage`：创建或更新 Project 的当前完整 goal/content/title/summary/cover；当前接受 Proposal 时 Project 已创建，因此其 create 是初始化该绑定 Project，update 使用 expectedVersion 乐观锁。
- `creation_prepare`、`creation_publish` 已移除。

## 执行与访问边界

- 用户归属由 JWT 和 RunContext 确定；只能访问自己 Project 和绑定 Session。普通 Agent Session HTTP 不开放内部 proposal-agent / creator-agent；Project 路由独立验证授权后访问 creator Session。
- 同一 Session 使用 `AgentSessionManager.reserve` 避免并行操作。Agent 实际消息和 ToolPresentation 是过程唯一事实来源。
- Runner 根据已接受 Proposal 与 Session 原生历史中的 `fanto.proposal_dispatched` 标记决定是否派发；运行失败保留真实历史，可再次运行。外部生图不承诺 exactly-once。
- Project 保存完成通过数据库版本与内容判断，不额外保存 `status: completed` 或进度。
- 原生 Session SQLite 与 PostgreSQL 不共享事务；Session 初始化失败时 Accept 可重试补齐。迁移先回填既有 Session 关联与 Goal，再删除 `proposal_runs / creation_runs / creation_image_steps`。

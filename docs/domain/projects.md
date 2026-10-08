# Proposal 与 Project

## 数据与状态

- `proposals`：待确认的 create/extend 提议，`content = {reason, idea, plan, tags, goal}`；`session_id` 是 proposal-agent 的分析会话；状态 pending/accepted/rejected。
- `projects`：最新 `goal`、`content`、title、summary、cover_media_id、`session_id`、version、active/archived；不存执行过程、运行状态和进度。
- `record_links`：两类主体与 Record 的用户隔离关联；Record 删除时清理关系。
- Agent Session 持久化于 SQLite；Project 的 `session_id` 指向长期 creator-agent 会话，不与 Proposal 的会话混用。

## Proposal 接受

`ProposalService.create` 只由可信服务端调用，要求同用户可读取的 Record：create 必须提供 proposedSummary，extend 必须指定 active Project。提议标题、idea、plan、tags 用于用户浏览；goal 包含 objective、可选 context/constraints/successCriteria。

`POST /api/proposals/:id/accept` 验证用户与状态，可传最多 500 字的 userInput，追加到确认目标的约束。create 创建空内容且 goal 为确认目标的 Project；extend 更新目标 Project 的 goal 并增补 Record 关联，保留现有 content。重复接受返回同一个 Project。接受后 Server 确保 creator Session 创建并绑定 `projects.session_id`，**绑定成功后**才派发后台 Agent。已接受提议可以重试补齐未成功绑定的 Session。

## 更新与查询

`ProjectService.update` 以 expectedVersion 做并发校验；允许按字段更新 title、summary、goal、content、coverMediaId，不传则保留，content 为完整替换文本。归档后只允许查看。摘要修改同时重建 summary 的 768 维向量；向量服务失败则保持原值。相似搜索限定当前用户的 active Project，返回最多 3 条候选，并不自动证明主题关联。

Project 列表包含 goal、sessionId 和摘要，但省略正文；详情包含完整 content、Goal 和最近最多五条完整参考 Record。更多参考记录可用游标分页。Project 的最终成果采用 string 内容、Markdown 和受限 `html-preview` 协议，以 `fanto-media://<mediaId>` 引用媒体；禁用任意脚本、网络资源和危险 HTML/CSS。

## 最终媒体归属

Project 正文或封面保存时，检查每个实际 mediaId 对应 `media_assets.object_key`。已经属于 `users/{userId}/project/{projectId}/` 的直接保留；其他用户自己可访问的 ready 媒体才在最终保存时复制入当前 Project 文件夹，**生成新 mediaId** 并改写正文/封面引用。仅用作生图参考的 Record 媒体不复制；删除 Record 可正常清理原资产，不影响正式保存的 Project 副本。历史 Project 在启动迁移时归一化已有媒体。

## Agent 会话

Creator Agent 的可信 `creation_context` 仅提供 projectId；需要最新 goal/content 时调用 `project_read`。创作或后续修改由 `project_manage` 更新完整 Project，图像工具 `image_generate` 每次只生成一张图。没有独立的进度/Run/图片槽位表。用户通过 Project 专属 History、后台 Events 及 Stream 接口查看与继续同一 Session；具体见 [创作运行](../architecture/creative-runtime.md) 和 [HTTP API](../api/http-api.md#proposal--project)。

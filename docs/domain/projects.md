# Proposal 与 Project

## 数据模型

- `proposals`：`type=create|extend`、`status=pending|accepted|rejected`、`proposedSummary`、`sessionId`（Proposal 分析会话）、`content={reason, ideas:[{id,title,idea,tags,goal}], selectedIdeaId}`。候选 Goal 包含 `objective/context?/constraints?/successCriteria?`。
- `projects`：`projectId`、用户、`title/summary/goal/content/coverMediaId`、`status=queued|running|completed|failed|archived`、`version`、`sessionId`（Creator 长期会话）、时间；`embedding` 是 summary 的 768 维派生向量。
- `record_links`：Proposal 或 Project 与 Record 的归属关联；Record 删除时事务内清除。Project 列表默认不含 archived，也不返回正文；详情包含正文、参考 Record 总数和最近最多五条完整 Record；当前公开 Project Route 未注册额外的参考 Record 分页接口。

## 接受与执行

只有后端可信的 Proposal Agent 可以创建 Proposal；不暴露客户端创建入口。Proposal 的 create/extend 使用同一个 Record 来源集合，extend 目标必须是同用户 `completed/failed` Project。接受时由用户选择 Idea（仅一个候选可省略 `selectedIdeaId`），在事务中创建新 Project 或更新已有 Project 的 Goal/关联，将状态设为 `queued`。接口只返回 `projectId`，异步发布 Creator 消息。重复相同接受幂等，不重复运行。

Project 状态只表示执行进度，与 Session 是否存在无关：queued 等待 Handler，running 正在创作，completed/failed 表示最近一次运行结果，archived 只读。首次 Handler 在认领后创建/复用 Session；后续用户通过统一 Agent Stream 继续同一 Session，无法自行提供 projectId 冒用其它 Project。

## 更新与检索

Project `PATCH` 和 Agent `project_manage` 使用 expectedVersion 乐观并发，`content` 完整覆盖，不做增量 patch；状态或 Session 绑定不强制增加业务版本。summary 变更时生成新的 embedding，失败不提交新 summary。项目搜索仅限当前用户的非归档数据，相关性不等于事实关联；`project_read` 仅支持 search/get。

正文允许受限 Markdown 和静态 `html-preview`；禁止任意脚本、危险 HTML/CSS 和未经授权网络资源。Project 保存时只复制正式正文或封面使用的外部 Media，生成当前 Project OSS 前缀的新 mediaId 并替换引用。未采纳的 Record 生图参考不复制。源 Record 删除不会破坏已保存作品副本。

## 对话与执行信息

Project 保存最新成果，不保存工具 trace、独立 creator run、进度/图片槽位。Creator 长期 Session 中的助手消息和 Tool Results 是过程的唯一事实来源。通用 `GET /api/agent/sessions/:id/history` 可读取历史；`GET .../events` 只订阅进行中的事件；`POST /api/agent/stream` 发送后续 Creator 消息，客户端携带 metadata.projectId，Server 从 Session 解析 Agent 身份，Project Tool 校验 userId + projectId + sessionId 绑定及归档写保护。正常续聊不修改 Project.status；failed 项目经 Creator 保存实际作品成功恢复 completed。Proposal 和 Project 的 sessionId 语义不同，不允许混用。

详见 [创作执行](../architecture/creative-runtime.md)、[HTTP API](../api/http-api.md#proposal--project)、[Media](media.md)。

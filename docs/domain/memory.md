# Memory

Memory 是用户明确要求 Fanto 保存、修改或遗忘的长期信息。它独立于 Record：Record 是用户原始记录，Memory 是可被 Agent 长期使用的简洁文本事实或指引。

## 数据模型

`memories` 是用户隔离的业务表，字段为：

- `memory_id`：UUID；
- `user_id`：所属用户，引用 `users` 并级联删除；
- `kind`：`profile`、`goal` 或 `guidance`；
- `content`：可独立理解的纯文本；
- `embedding`：768 维 pgvector；
- `created_at`、`updated_at`。

`profile` 保存稳定背景、身份或长期习惯；`goal` 保存仍有意义的长期目标、承诺或进行中事项；`guidance` 保存用户希望 Fanto 长期遵循的沟通或协作方式。每位用户最多 50 条 Memory，其中 `guidance` 最多 20 条，单条正文最多 1,000 个字符。

Memory 正文在创建和更新时同步生成 embedding。语义检索直接在 `memories` 内执行 pgvector 最近邻查询，并在 SQL 层以 `user_id` 过滤。当前数据量小，不建立独立向量索引或后台重建任务。

## Agent 接入

Memory 没有 HTTP 接口。主 Agent 仅使用 `memory_manage`：

- `list`：可选 `kind`，列出已保存记忆；
- `search`：必填 `query`，可选 `limit`，语义检索相关记忆；
- `create`：必填 `kind`、`content`；
- `update`：必填 `memoryId`、`kind`、`content`；
- `delete`：必填 `memoryId`。

所有写操作只用于用户明确提出记住、修改或遗忘的请求。每轮 System Prompt 会自动注入全部 `guidance`；`profile` 与 `goal` 不预取，由模型在确实需要背景信息时通过 `search` 查询。Tool 参数中不包含用户身份，运行上下文的 `userId` 会传给 Domain Service，并在全部读取、更新和删除操作中执行用户边界。

V1 不自动从对话或 Record 提取 Memory，不维护来源、状态、有效期、置信度或正负倾向，也不提供补偿或批量重建流程。

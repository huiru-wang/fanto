# Memory

Memory 与原始 Record、聊天历史独立，SQL 始终以完整 `(owner_type,owner_id)` 隔离。没有 Memory HTTP API；Tool 不接受 userId、fantoId 或 owner 参数，实际 Owner 从可信用户与 Session 解析。

## 类型和权限

| Owner | kind | 工具 |
| --- | --- | --- |
| user | personal_background、important_relationships、current_focus、interaction_preferences | user_memory_manage |
| fanto | shared_history、relationship_state、ongoing_threads、personal_experiences | fanto_memory_manage |

数据库 CHECK 与 MemoryService 均拒绝跨 Owner 类型的 kind。默认 Main 可 list/search/create/update/delete User Memory，无 Fanto Memory。角色始终可读写自身 Fanto Memory；仅 userMemoryEnabled=true 时开放 User Memory 的 list/search，模型 Schema 也仅暴露这两个动作，业务边界独立拒绝伪造写入。一个角色不能读取其他角色的记忆。

默认 Main 的用户记忆政策由 `fanto-core.ts` 导出的条件段注入：仅保存用户明确表达、对未来有用的事实，写前检索/对照并更新已有条目，不保存临时情绪、假设、第三方文本或虚构剧情。敏感内容需明确保存意愿；凭据不保存。角色虚构经历保存在自己的 shared_history 并与现实资料区分。工具成功后才能声称保存。

## 上下文

MainDynamicProvider 每 Run 依据同一配置启用对应 Scope。User Memory 仅默认注入个人背景与相处偏好，最多读取 50 条，序列化预算 12,000 UTF-8 字节、整条选择，omitted 表示省略数。重要关系和近期关注由模型按需搜索。Fanto Memory 独立读取当前角色最多 50 条，同样限 12,000 字节。未授权的 Scope 不执行查询。

Provider 不查询最近 Record，也不自动执行向量预检索。读取异常中止该 Run，不能误报为没有记忆；没有逐消息后台提取。Prompt 本轮固定，写工具成功结果在本轮可直接使用，下轮重新读取。

## 存储和容量

`memories` 保存 UUID、owner_type、owner_id、kind、content、768 维 embedding 与时间。list 不生成向量；create/update/search 调用既有 Embedding Provider，检索在 PostgreSQL 中同时过滤 Owner 与 kind。updatedAt 是保存时间，不代表事件发生时间。

每 Owner 最多 50 条，User interaction_preferences 最多 20 条，每条 trim 后 1–1000 字符。Repository 使用 Owner advisory transaction lock 在实际写入时检查容量，防止并发创建或转换 kind 突破上限。

新基线不兼容旧 profile/goal/guidance 或旧 shared_history 的归属，不自动搬迁/转换实际数据。删除角色显式删除其 Owner 记忆，其他 Owner 保留；没有 SQL cascade。见 [Fanto 生命周期](fanto.md) 和 [测试](../engineering/testing.md)。

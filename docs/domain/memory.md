# Fanto 独立长期记忆

长期 Memory 与 Record/聊天历史独立。系统仅有角色长期记忆：每条 `memories` 归属一个 `fanto_id`，不再存在 User Memory、Owner 多态或 Memory Kind 分类。默认 `fanto` 角色也有自己的 fantoId 和独立记忆。

## 权限与工具

每个角色的 `fantoMemoryEnabled` 默认为 true；关闭时不能调用 `fanto_memory_manage`、不读取旧记忆、不注入记忆策略，已有记忆保留以便重新启用。工具只有 list/search/create/update/delete，参数不包含 userId/fantoId/owner/kind。Tool 和 Domain 都只使用可信 Run Context 的 `userId + sessionId` 找到 active 角色并检查授权，不接受模型替换身份；角色之间不共享记忆。

MainDynamicProvider 在当前角色启用时每次 Run 读取它的最多 50 条记忆，按更新时间读取；序列化最大 12,000 UTF-8 字节，省略超预算的完整条目；不向其他角色查询。用户 Record 读取受独立 `recordReadEnabled` 控制。

## 记忆内容与策略

`fantoMemoryGuidance` 在启用时注入 Prompt。Content 以角色自己的**第一人称**表达，以已确认信息为依据，包括用户在当前角色关系中提供的姓名、共同经历、关系改变和后续约定。明确提供姓名或要求记住姓名应在本轮保存，不是只口头答应。保存前检查当前上下文或搜索已存事实；重复不写、信息补充或纠正更新同一 memoryId。不能把角色设定示例、想象或无证据推断当作真实共同经历；敏感信息遵循明确保存意愿，凭据不保存。只有工具真正成功才声称已记住。

## 存储容量

`memories` 包含 `memory_id UUID`、`fanto_id UUID`、`content`、768 维 `embedding`、created/updated timestamp。不存 `kind`/`owner_type`/`owner_id`。每个 Fanto 最多 50 条，单条 trim 后 1–1000 字符。create/update/search 调用现有 Embedding Provider，list 不生成向量；search 以 `fanto_id` 限定。写入在数据库事务里通过 Fanto advisory lock 检查上限。

当前基线只为新数据库建表，不自动升级旧 Memory 或搬迁旧 User Memory。关闭开关不是删除；删除可删除的自定义 Fanto 时会显式清除本角色记忆。其他角色与 User Records 不受影响。

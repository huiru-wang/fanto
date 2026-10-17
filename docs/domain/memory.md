# Memory

Memory 是供 Fanto 后续对话使用的简洁认识，独立于原始 Record 和聊天历史。Main Agent 判断是否值得保存，不要求用户必须说“记住”，也不逐消息后台提取。

## 四类内容与读取

| kind | 内容 | 读取方式 |
| --- | --- | --- |
| `personal_background` | 称呼、职业、生活阶段、城市、长期兴趣习惯 | 每 Run 默认注入 |
| `interaction_preferences` | 长期表达要求、倾听/建议方式、交流边界 | 每 Run 默认注入，当前请求优先 |
| `important_relationships` | 人物/宠物的称呼、别称和与用户的关系 | 当前话题需要且上下文不足时检索 |
| `current_focus` | 正在推进、经历、牵挂的事 | 当前话题需要且上下文不足时检索 |

MemoryProvider 单次读取当前用户最多 50 条新类型记忆，只将前两类分区注入；优先相处偏好，再个人背景，各类按更新时间从近到远。序列化 JSON 总预算 12,000 UTF-8 字节，整条选择、不截断正文；`omitted` 表示省略数，必要时 Agent 补读。这是字节预算，不是模型精确 token 数。

条目提供 `id/content/updatedAt`。`updatedAt` 是保存时间，不代表事件时间。`status=empty` 仅表示两个默认分区为空，`unavailable` 表示读取失败，不能当成用户没有记忆。默认注入不请求 embedding；Prompt 在本轮固定，工具修改后以成功结果为准，下一 Run 重新读取。

## 读写政策与工具

唯一全局政策位于 `agent/prompts/fanto-core.ts`；工具说明定义参数，Main Prompt 动态区解释注入数据。其他 Agent 不因共享 Core 自动获得记忆工具权限。

Main Agent 通过 `memory_manage`：

- `list`：可选 `kind`，查看已存记忆；
- `search`：必填具体话题 `query`、可选 `limit`（默认 5、最多 10），语义检索；
- `create`：必填 `kind/content`；
- `update`：必填 `memoryId/kind/content`，完整替换正文；
- `delete`：必填 `memoryId`，仅用于用户明确要求忘记。

用户直接、明确表达且对后续交流持续有用的信息可主动保存。一次经历、即时情绪、本轮要求、引用、假设、角色扮演和模型推断不保存；敏感信息需要明确保存意愿，凭据不保存。写前对照已有记忆；重复不操作，补充、纠错、递进更新原条目，明确完成时更新正文结果。歧义不盲目覆盖，不无限追加进展。规则由 Agent 判断，服务端不新增语义裁判；工具失败不能声称保存成功。

已有上下文足够时不重复搜索，也不为了展示熟悉而查无关信息。相关搜索结果仍需 Agent 判断；未命中不等于用户从未说过。

## 存储与边界

`memories` 保留 `memory_id/user_id/kind/content/embedding/created_at/updated_at`，不新增记忆版本、来源或状态字段。每用户最多 50 条新类型记忆，其中相处偏好最多 20 条；单条最多 1,000 字符。

新增、更新同步生成 768 维 embedding；search 同步生成查询向量，在 PostgreSQL 执行用户隔离的 pgvector 最近邻查询。同步记忆工具有外部调用成本，不代表零延迟；不增加对话完成后的强制保存步骤。

所有访问在 SQL 层按 userId 隔离，Tool 身份来自 Run Context，不接受客户端指定 userId。没有 Memory HTTP API。`zz_memory_kinds_20261017.ts` 只扩展类型约束，不转换或删除历史内容；旧 `profile/goal/guidance` 行原样保留，但不进入新类型的 list/search/默认上下文和容量统计。

记忆是否调用工具由模型决定，Prompt 规则不构成必定保存的保证；即使规则已送入模型，也可能出现口头确认却未写入，应以实际 Tool 成功和数据库为准。当前不提供后台整理、自动遗忘、过期或全量历史提取。验证入口见 [测试](../engineering/testing.md)。

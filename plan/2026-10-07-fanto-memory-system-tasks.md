# Fanto Memory System：实施任务

关联设计：[Fanto Memory System](2026-10-07-fanto-memory-system.md)。

## Phase 0：契约和数据基础

1. 定义 Memory 领域模型与数据库 schema：`fanto_memories`、`memory_evidence`、`memory_feedback`、`memory_index_items`、`memory_settings`、异步 outbox / job 表。
   - 验收：所有表有 `user_id`、必要唯一键、外键 / 删除策略与查询索引；现有 `records` 与 `vector_items` 不被重用或破坏。

2. 实现 Memory Repository 与 `MemoryService` 的读取、创建、更新、forget、list 和 detail 语义。
   - 验收：每项变更要求版本；用户不能读取或修改其他用户的 Memory；forget 从 active 检索结果中立即移除。

3. 实现 Evidence 和 Resolution Service，定义合并、冲突、替换、撤回与防复活规则。
   - 验收：同义记忆合并证据；不同 scope 并存；明确长期修正会 supersede 旧项；同一被遗忘来源不能自动复活。

## Phase 1：明确记忆和用户控制

4. 实现 `kind=preference` 的 Memory mutation 规则，不提供 Preference 域、表或 HTTP API 兼容层。
   - 验收：明确长期偏好作为 Memory 的一种类型创建并保留 Evidence；不存在旧数据迁移或旧接口映射。

5. 新建 Memory HTTP API 与 Agent Business Services：列表、详情、编辑、忘记、清空、学习设置。
   - 验收：Route 只做边界处理；所有 mutation 都建立 user_edit 或对话 Evidence；日志脱敏。

6. 实现受控 `memory_manage` Tool，支持查看、创建、修改与忘记。
   - 验收：模型只能引用当前消息的连续原话；Tool 不能传 userId、source ID 或未验证 quote；本轮 Tool Result 返回刷新后的有效记忆。

7. 在 iOS 与 H5 提供“Fanto 的记忆”页面与管理入口。
   - 验收：用户能看见状态、来源摘要、适用条件，能编辑、忘记和关闭自动学习；敏感记忆有明确提示。

## Phase 2：Context 与检索

8. 实现 `ActiveMemoryProvider`，只注入有限的 active Memory；保留现有 `RecordContextProvider`，不合并两者。
   - 验收：Context 有明确 token 预算与排序；当前用户消息优先；Record 仍以 `recent_records` 和 `record_search` 提供。

9. 实现 Memory 的独立 embedding 索引和 `RelevantMemoryProvider`。
   - 验收：仅索引 active Memory；user-scoped 检索；forget、supersede、删除后不再命中；不影响 `vector_items`。

10. 为上下文、索引和 mutation 增加观测：按来源、状态、失败类型、延迟与 token 预算记录脱敏指标。
    - 验收：能发现抽取失败、索引积压、候选大量堆积、冲突频发与 Context 超预算；不记录原始私密内容。

## Phase 3：自动学习与反馈

11. 引入持久化 Memory Job / Outbox，接入对话与 processed Record 的候选抽取。
    - 验收：任务以来源版本幂等；进程重启不会丢失已提交来源；抽取模型只输出结构化候选，不直接更新 active Memory。

12. 将 Project proposal confirm / reject 与 Fanto 输出评价接入 `memory_feedback`，支持可选原因。
    - 验收：单次采纳或拒绝先保存反馈；只有明确、可泛化原因才改变 active Memory；目标和用户归属均经服务端校验。

13. 接入 candidate 审阅机制和基于多个独立证据的升级规则。
    - 验收：推断记忆默认不影响主要行为；用户确认后才 active；反驳证据可降级或撤销。

14. 建立 Memory 评估集和发布门槛。
    - 验收：覆盖提取准确性、错误泛化、冲突、撤回、遗忘、跨用户隔离、Context 选择与反馈响应；以用户可感知的错误率作为上线指标。

## 推荐交付顺序

先完成 1–8，提供可信、用户可控的“明确记忆”闭环；随后完成 9–10，让记忆在相关场景按需使用；最后实施 11–14 的自动学习和 proposal 反馈。不要在自动抽取、反馈、治理尚未到位前，将 Record 或对话直接大量写入 active Memory。

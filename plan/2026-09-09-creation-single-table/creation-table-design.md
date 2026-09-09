# Creation 基础表设计

## 1. 边界

用户主动写入的 `Record` 是原始事实，不能被 Agent 改写。Agent 依据多个 Record 生成可继续探索的 `Creation`。Creation 不再被限定为 Topic，也不按 Opportunity、Insight、Experiment 等语义类型拆分数据表。

本阶段确定：所有 Creation 的产出和后续处理都使用一张 `creations` 表；工作流生命周期只通过同一行的 `status` 表达，不创建类型专属表或独立业务状态表。

本文件不定义：type 枚举、status 枚举/状态机、Agent 工作流、content 的最终格式、API、UI、Topic 迁移策略。验证工作流与首期 type/content 契约见 [工作流验证方案](./workflow-validation.md)。

## 2. `creations` 表

```text
id                  UUID / text PK
creation_id         UUID / text NOT NULL UNIQUE
user_id             UUID / text NOT NULL, indexed
type                text NOT NULL
status              text NOT NULL, indexed
title               text NOT NULL
content             text NOT NULL
source_record_ids   JSON TEXT NOT NULL
version             integer NOT NULL default 1
ext_data            JSON TEXT nullable
created_at          ISO-8601 NOT NULL
updated_at          ISO-8601 NOT NULL
```

| 字段 | 约束与用途 |
|---|---|
| `id` | 数据库物理主键，用于内部更新与分页。 |
| `creation_id` | 对外稳定的业务标识，必须唯一。MVP 与 `id` 一对一；保留它是为了未来支持重生成/版本演进时仍可维持外部引用。 |
| `user_id` | 数据隔离边界。读取、更新与来源 Record 校验均必须按此字段限制。 |
| `type` | Agent 产出的语义提示。数据库存开放文本；允许值由应用层和 Prompt 契约限制。 |
| `status` | 工作流唯一的生命周期字段。数据库存开放文本；状态值和迁移规则后续再定义。 |
| `title` | 简洁、用户可读的标题，不承载完整摘要或来源。 |
| `content` | Creation 主内容。暂为文本列，具体表达格式由 type 的 Prompt 契约定义。 |
| `source_record_ids` | 非空、去重的 JSON 数组，记录 Creation 的事实依据。数组中每个 Record 必须归属同一 `user_id`。 |
| `version` | 乐观并发控制。用户与后台的更新不得静默互相覆盖；每次可见字段或 status 更新递增。 |
| `ext_data` | 命名空间 JSON 预留区，用于未来受控的类型私有元数据或诊断；不替代核心查询字段，且不保存完整 Prompt 或模型思维链。 |
| `created_at` / `updated_at` | 服务端写入的创建与最近修改时间。 |

## 3. 最小完整性规则

1. `title`、`content`、`type`、`status` 均不可为空；长度上限由应用层统一校验。
2. `source_record_ids` 至少有一个 ID、无重复，且所有来源 Record 对当前 `user_id` 可见。
3. 写入或状态更新必须匹配当前 `version`；冲突时返回当前 Creation，而不是静默覆盖。
4. 不认识的 type 不能让客户端丢失内容：先使用通用 Creation 阅读器安全降级展示。
5. Record 修改、删除或失去访问权限时的重评估策略尚未定义；当前表设计仅确保可借 `source_record_ids` 找到受影响 Creation。

## 4. 明确不加入的字段和表

- 不增加 `topic_id`、`artifact_id`、`opportunity_id` 等类型专属外键。
- 不增加 `parent_creation_id`、`trigger_record_id`、`priority`。
- 不增加 `available_at`、`presented_at`、`resolved_at`、`status_reason`。
- 不增加 `workflow_id`、`task_id`、`agent_session_id` 等工作流耦合字段。
- 不增加用户反馈、展示日志、版本历史或 Record-Creation 关联表。

这意味着首期接受“来源按 JSON 反向查询的效率有限、没有细粒度展示日志和历史版本”的取舍。确认工作流效果前，不用预先为这些假设扩表。

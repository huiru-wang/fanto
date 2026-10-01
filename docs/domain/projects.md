# Project

Project 是值得长期保留和继续的脉络。待用户确认的候选脉络不再使用独立实体，统一表示为 `Project.status = proposed`。

## 数据模型

| 表 | 职责 |
| --- | --- |
| `projects` | Project 标题、Markdown content、状态、版本与扩展数据 |
| `project_records` | Project 与 Record 的关联，并冗余 `record_event_at` 用于稳定时间线分页 |

Project 状态：

```text
proposed
active
archived
rejected
```

状态流转：

```text
proposed --confirm--> active
proposed --reject--> rejected
active --archive--> archived
```

首期不支持 proposed Project 更新已有 Project。

## Record 关联

`project_records` 不使用数据库外键。核心字段：

```text
id
user_id
project_id
record_id
record_event_at
created_at
updated_at
```

同一 `(user_id, project_id, record_id)` 唯一。Project Record 时间线按：

```text
record_event_at DESC, record_id DESC
```

游标分页。接口直接返回本页完整 Record，不提供 Record batch API。

Record 删除时业务层同步删除对应 `project_records`；未来若开放 Record `event_at` 修改，需要同步更新 `record_event_at`。

## 当前运行能力

Server 当前支持 Project 列表、按状态筛选、详情、关联 Record 游标分页，以及 proposed Project 的 confirm / reject。

后台自动发现并生成 proposed Project 的 Fragment Agent 运行链路尚未接入。

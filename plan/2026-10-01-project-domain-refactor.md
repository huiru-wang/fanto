# Project Domain Refactor

## 目标状态

领域模型统一为：

```text
Record
Project
ProjectRecord
Task
TaskRun
```

其中：

- Record：用户原始记录
- Project：长期脉络，以及待用户确认的候选脉络
- ProjectRecord：Project 与 Record 的关联
- Task：具体任务
- TaskRun：Task 的一次执行

`Proposal` 不再作为独立实体，统一通过 `Project.status = proposed` 表达。

---

## 数据表

### projects

```sql
CREATE TABLE projects (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  project_id  UUID NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,

  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',

  status      TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  ext_data    JSONB NOT NULL DEFAULT '{}',

  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);
```

`status`：

```text
proposed
active
archived
rejected
```

Project 和提议的业务内容统一存放在 `content`，不再保留 `summary`、`target_project_id`、`base_project_version`。

索引：

```sql
CREATE INDEX idx_projects_user_status_updated
ON projects (
  user_id,
  status,
  updated_at DESC,
  project_id DESC
);
```

---

### project_records

```sql
CREATE TABLE project_records (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  user_id     TEXT NOT NULL,
  project_id  UUID NOT NULL,
  record_id   TEXT NOT NULL,

  record_event_at TIMESTAMPTZ NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,

  UNIQUE (user_id, project_id, record_id)
);
```

要求：

- 不加外键
- `record_event_at` 冗余自 `records.event_at`
- Project 内 Record 按 `record_event_at DESC, record_id DESC` 排序

索引：

```sql
CREATE INDEX idx_project_records_timeline
ON project_records (
  user_id,
  project_id,
  record_event_at DESC,
  record_id DESC
);

CREATE INDEX idx_project_records_record
ON project_records (
  user_id,
  record_id
);
```

---

## Project 状态流转

```text
proposed --confirm--> active
proposed --reject--> rejected
active --archive--> archived
```

首期不支持 proposed Project 更新已有 Project。

---

## Project API

```text
GET  /projects
GET  /projects?status=proposed
GET  /projects/:id
GET  /projects/:id/records?cursor=...&limit=5

POST /projects/:id/confirm
POST /projects/:id/reject
```

### GET /projects

支持按 `status` 过滤。

列表按：

```text
updated_at DESC, project_id DESC
```

游标分页。

---

### GET /projects/:id

只返回 Project 本身，不返回关联 Record。

返回结构：

```json
{
  "projectId": "...",
  "title": "...",
  "content": "...",
  "status": "active",
  "version": 1,
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

### GET /projects/:id/records

单独游标查询指定 Project 关联的完整 Record。

参数：

```text
cursor
limit
```

默认：

```text
limit = 5
```

返回：

```json
{
  "data": [
    {
      "id": "r5",
      "eventAt": "2026-10-01T10:00:00Z",
      "content": {},
      "version": 1,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "hasMore": true,
  "nextCursor": "..."
}
```

Record 按：

```text
record_event_at DESC, record_id DESC
```

排序完成。服务端先通过 `project_records` 按游标取本页 `record_id`，再批量读取对应 Record 并按原顺序返回完整内容。

---

## Project Record 游标分页

首次查询：

```sql
SELECT record_id, record_event_at
FROM project_records
WHERE user_id = ?
  AND project_id = ?
ORDER BY record_event_at DESC, record_id DESC
LIMIT :limit_plus_one;
```

Cursor 内容：

```json
{
  "eventAt": "2026-10-01T10:00:00Z",
  "recordId": "record-id"
}
```

下一页：

```sql
SELECT record_id, record_event_at
FROM project_records
WHERE user_id = ?
  AND project_id = ?
  AND (
    record_event_at < :eventAt
    OR (
      record_event_at = :eventAt
      AND record_id < :recordId
    )
  )
ORDER BY record_event_at DESC, record_id DESC
LIMIT :limit_plus_one;
```

---

## Confirm / Reject

### Confirm

```text
POST /projects/:id/confirm
```

仅允许：

```text
proposed -> active
```

### Reject

```text
POST /projects/:id/reject
```

仅允许：

```text
proposed -> rejected
```

Rejected Project 默认不出现在正常 Project 列表。

---

## Record 同步

创建 `project_records` 时：

```text
project_records.record_event_at = records.event_at
```

Record 的 `event_at` 修改时，同步更新：

```sql
UPDATE project_records
SET record_event_at = :eventAt,
    updated_at = NOW()
WHERE user_id = :userId
  AND record_id = :recordId;
```

Record 删除时，由业务层同步删除：

```sql
DELETE FROM project_records
WHERE user_id = :userId
  AND record_id = :recordId;
```

---

## 服务端代码重构

删除现有 Creation 领域：

```text
domain/creations/
creation-proposals
creation-kinds
```

新增：

```text
domain/projects/
  project.ts
  project-service.ts
  project-repository.ts
```

命名统一：

```text
Creation -> Project
CreationProposal -> Project(status=proposed)
creationId -> projectId
```

原 Creation / Proposal 路由全部替换为 Project API。

---

## 客户端

iOS / H5 删除：

```text
Creation
CreationProposal
CreationKind
```

统一为：

```text
Project
```

候选脉络列表：

```text
GET /projects?status=proposed
```

确认：

```text
POST /projects/:id/confirm
```

拒绝：

```text
POST /projects/:id/reject
```

Project 页面通过 `GET /projects/:id/records?cursor=...&limit=5` 游标分页直接加载完整 Record。

---

## 本次不做

- Project 更新已有 Project 的 Proposal
- `target_project_id`
- `base_project_version`
- Creation Kind / Project Kind
- Task -> Project 关联
- Project Event / Timeline 事件表
- 自动生成 Proposal 的 Fragment Agent 运行逻辑
- 通用 `entity_relations` 承载 Project / Record 核心关系

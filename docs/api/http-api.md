# HTTP API

基地址：`http://127.0.0.1:3000`。响应信封统一为：

```json
{ "success": true, "result": {}, "errorCode": null, "errorMsg": null }
```

除 `GET /health` 外，请求必须带 `x-user-id`。值需匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`。当前没有正式认证；该 Header 仅用于用户隔离。

## 健康检查

`GET /health` → `{ status: "ok", timestamp }`

## 记录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/records` | 创建记录，返回 201 |
| GET | `/api/records?limit=20&cursor=` | 倒序分页读取，limit 为 1–100 |
| GET | `/api/records/:id` | 单条记录 |
| PATCH | `/api/records/:id` | 以 expectedVersion 更新内容 |

创建体：`{ text, media, source? }`；更新体：`{ text, media, expectedVersion }`。`media` 为 `{ mediaId }[]`。常见错误：`INVALID_INPUT`、`INVALID_CONTENT`、`INVALID_MEDIA`、`INVALID_CURSOR`、`VERSION_CONFLICT`、`NOT_FOUND`。

列表结果：`{ data, hasMore, nextCursor, pageSize }`。`nextCursor` 只应在 `hasMore=true` 时使用。

## 上传与媒体

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/uploads` | 创建上传凭据，返回直传 URL |
| POST | `/api/uploads/:id/complete` | 校验对象并将媒体标记 ready |
| POST | `/api/uploads/:id/transcription` | 音频转写 SSE |
| GET | `/api/media/:id` | 已就绪媒体重定向到 OSS |

创建上传体：`{ fileName, mediaType: "image" | "audio", mimeType, bytes }`。complete 体可选 `{ capture: { width?, height?, durationMs? } }`。

转写 SSE 事件：`delta`（`{ text }`）、`completed`（`{ transcript }`）、`failed`（`{ message }`）。

## 脉络与待确认提案

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/creation-kinds` | 所有类型目录 |
| GET | `/api/creations/overview` | 当前用户最多 3 条 active 脉络及实际使用的类型 |
| GET | `/api/creations?kindId=` | 当前用户的脉络列表；`kindId` 可选，提供时按类型筛选 |
| GET | `/api/creations/:id` | 脉络详情；`summary` 为纯文本 |
| GET | `/api/creations/:id/records?limit=20&cursor=` | 关联来源记录倒序分页，limit 为 1–100 |
| GET | `/api/creation-proposals?status=pending_confirmation` | 当前用户待确认提案卡片 |
| GET | `/api/creation-proposals/:id` | 提案详情与关联来源记录 |
| POST | `/api/creation-proposals/:id/confirm` | 确认并创建/更新为长期跟踪脉络 |
| POST | `/api/creation-proposals/:id/reject` | 将提案标记为暂不保留 |

`summary` 在 Creation 和 Proposal 的响应中均为可空的纯文本；数据库迁移会把旧 JSON 摘要中的 `overview` 提取为文本。iOS 客户端仍兼容旧 JSON 形态，但新客户端不应依赖该兼容行为。

提案列表只支持 `pending_confirmation` 状态。确认使用事务创建或更新 Creation，并把来源 Record 关联迁移到该 Creation；若更新目标版本已变化，则返回 `VERSION_CONFLICT`。Creation 完整列表目前支持可选的类型筛选；尚未提供搜索、状态筛选或列表分页。

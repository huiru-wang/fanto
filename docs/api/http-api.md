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

## 脉络只读

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/creation-kinds` | 所有类型目录 |
| GET | `/api/creations/overview` | 当前用户最多 3 条 active 脉络及实际使用的类型 |
| GET | `/api/creations/:id` | 脉络详情；summary 已解析为对象 |
| GET | `/api/creations/:id/records?limit=20&cursor=` | 关联来源记录倒序分页，limit 为 1–100 |

脉络路由当前不存在 Proposal 列表、Proposal 详情、确认/拒绝、按类型完整列表、搜索或状态筛选接口。

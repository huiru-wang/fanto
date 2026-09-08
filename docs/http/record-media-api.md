# Record 与媒体 HTTP API

Base URL：`http://localhost:3000`（开发环境）。所有 JSON 响应均使用 `{ success, result, errorCode, errorMsg }` 包装。路径中的 UUID 以 `{id}`、`{mediaId}` 表示。

## 通用请求头

| Header | 是否必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 生产环境必填 | Session 鉴权；浏览器媒体请求也必须携带。 |
| `x-user-id` | 仅本地开发 | 固定开发用户模拟，生产环境不可作为认证方式。 |
| `Content-Type: application/json` | 有 JSON 请求体时必填 | 请求和响应均为 UTF-8 JSON。 |

无权限和不存在的媒体或 intent 均返回 `404 NOT_FOUND`，避免枚举资源。

## Health

### `GET /health`

Headers：无。

请求体：无。

`200 OK`：

```json
{"status":"ok","timestamp":"2026-09-09T08:00:00.000Z"}
```

## 上传 intent

### `POST /api/uploads/intents`

Headers：通用请求头。

请求体：

```json
{"fileName":"voice.m4a","mediaType":"audio","mimeType":"audio/mp4","bytes":1234}
```

`mediaType` 为 `image` 或 `audio`。图片仅允许 JPEG、PNG、WebP；音频仅允许 MP4、MP3、WAV。`bytes` 必须是正整数且不超过 50 MB。

`201 Created`：

```json
{"success":true,"result":{"intentId":"uuid","uploadUrl":"https://...","expiresAt":"2026-09-09T08:15:00.000Z"},"errorCode":null,"errorMsg":null}
```

`400 Bad Request`：

```json
{"success":false,"errorCode":"INVALID_INPUT","errorMsg":"Unsupported media"}
```

### `GET /api/uploads/intents/{id}`

Headers：通用认证头。请求体：无。

`200 OK`：

```json
{"success":true,"result":{"intentId":"uuid","status":"pending","mediaId":null,"expiresAt":"2026-09-09T08:15:00.000Z"},"errorCode":null,"errorMsg":null}
```

完成后 `status` 为 `completed`，`mediaId` 为稳定媒体 ID。未找到返回 `404 NOT_FOUND`。

### `POST /api/uploads/intents/{id}/complete`

Headers：通用请求头。

请求体可为空；有采集元数据时：

```json
{"capture":{"width":1536,"height":1024,"durationMs":null}}
```

字段均可省略；宽高与时长必须为正整数。服务端 HEAD 校验对象 MIME 与字节数，不信任客户端声明。

`200 OK`：

```json
{"success":true,"result":{"mediaId":"uuid","mediaType":"audio","mimeType":"audio/mp4","bytes":1234},"errorCode":null,"errorMsg":null}
```

`409 Conflict` 可能为：

```json
{"success":false,"errorCode":"UPLOAD_MISMATCH","errorMsg":"Uploaded object does not match intent"}
```

或 `UPLOAD_INCOMPLETE`。不存在的 intent 返回 `404 NOT_FOUND`。

### `POST /api/uploads/intents/{id}/transcription`

Headers：通用认证头；建议 `Accept: text/event-stream`。请求体：无。

仅已完成的音频 intent 可调用。响应为 `200 OK`、`Content-Type: text/event-stream`：

```text
event: delta
data: {"text":"今天的会议"}

event: completed
data: {"transcript":"今天的会议","language":"zh","emotion":null}
```

失败事件：

```text
event: failed
data: {"message":"Transcription failed"}
```

已有活跃连接返回 `409 TRANSCRIPTION_ACTIVE`；非音频、未完成或不存在返回 `404 NOT_FOUND`。

### `DELETE /api/uploads/intents/{id}`

Headers：通用认证头。请求体：无。

取消活跃转写并删除对应对象；未关联媒体也会删除。

`204 No Content`：无响应体。不存在返回 `404 NOT_FOUND`。

## Record

### `POST /api/records`

Headers：通用请求头。

请求体：

```json
{"text":"今天的记录","source":"home","media":[{"mediaId":"550e8400-e29b-41d4-a716-446655440000"},{"mediaId":"550e8400-e29b-41d4-a716-446655440001","transcript":"用户修订后的文稿"}]}
```

`text` 最长 20,000 字符；`media` 最多 4 项，ID 不可重复；`source` 可选。音频的 `transcript` 可选，省略时复制已完成的媒体转写。

`201 Created`：

```json
{"success":true,"result":{"id":"uuid","userId":"demo","source":"home","content":{"text":"今天的记录","blocks":[{"mediaId":"uuid"}]},"version":1,"status":"active","createdAt":"2026-09-09T08:00:00.000Z","updatedAt":"2026-09-09T08:00:00.000Z","extData":null,"media":[{"id":"uuid","type":"image","url":"/api/media/uuid"}]},"errorCode":null,"errorMsg":null}
```

`409 Conflict`：音频未完成时返回 `AUDIO_TRANSCRIPTION_PENDING`。`400 Bad Request`：`INVALID_MEDIA` 或 `INVALID_INPUT`。

### `PATCH /api/records/{id}`

Headers：通用请求头。

请求体：

```json
{"text":"修订后的记录","media":[{"mediaId":"550e8400-e29b-41d4-a716-446655440000"}],"expectedVersion":1}
```

`expectedVersion` 必填且为正整数。成功时 `200 OK`，响应 body 与创建成功的 `result` 相同，但版本递增。

`409 Conflict`：

```json
{"success":false,"result":{"id":"uuid","version":2},"errorCode":"VERSION_CONFLICT","errorMsg":"Record was changed by another edit"}
```

无记录时返回 `404 NOT_FOUND`；音频未完成返回 `409 AUDIO_TRANSCRIPTION_PENDING`。

### `GET /api/records`

Path：`/api/records?cursor={base64Cursor}&limit=20`。Headers：通用认证头。请求体：无。

`limit` 范围为 1–100，默认 20；`cursor` 为服务端返回的 `createdAt,id` 复合游标。

`200 OK`：

```json
{"success":true,"result":{"data":[{"id":"uuid","content":{"text":"今天的记录","blocks":[{"mediaId":"uuid"}]},"media":[{"id":"uuid","type":"audio","url":"/api/media/uuid","durationMs":12000,"transcriptPreview":"今天的会议"}]}],"hasMore":false,"nextCursor":null,"pageSize":20},"errorCode":null,"errorMsg":null}
```

无效 cursor 返回 `400 INVALID_INPUT`。

### `GET /api/records/{id}`

Headers：通用认证头。请求体：无。

`200 OK`：返回与创建成功相同的完整 Record DTO，`media` 依 block 顺序排列。不存在或非本人记录返回 `404 NOT_FOUND`。

## 媒体读取与删除

### `GET /api/media/{mediaId}`

Headers：通用认证头；音频播放可额外携带 `Range: bytes=0-`，该头会由 302 后的 OSS 请求继续处理。请求体：无。

`302 Found`：`Location` 是短期、私有 OSS GET URL；不在 JSON body 中暴露 object key。不存在或无权访问返回 `404 NOT_FOUND`。

### `DELETE /api/media/{mediaId}`

Headers：通用认证头。请求体：无。

仅未关联 Record 的媒体可删除。`204 No Content`：无响应体；不存在、无权或已关联时返回 `404 NOT_FOUND`。

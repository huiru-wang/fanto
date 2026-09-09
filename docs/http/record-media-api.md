# Record 与媒体 HTTP API

所有 `/api/*` 接口需要 `x-user-id`，值为 1–128 位字母、数字、`_` 或 `-`，首字符为字母或数字。响应统一为 `{success,result?,errorCode,errorMsg}`。OSS object key 不对客户端暴露。

数据库中每张表的 `id` 都是内部自增主键，绝不作为业务标识或接口参数。业务标识分别为 `users.user_id`、`records.record_id`、`media_assets.media_id`。

## 媒体上传

### `POST /api/uploads`

Headers：`Content-Type: application/json`、`x-user-id`。请求体：

```json
{"fileName":"photo.png","mediaType":"image","mimeType":"image/png","bytes":2184278}
```

响应 `201`：

```json
{"success":true,"result":{"mediaId":"uuid","uploadUrl":"https://…","expiresAt":"2026-09-09T00:00:00.000Z"},"errorCode":null,"errorMsg":null}
```

服务端直接创建一条 `media_assets(status=uploading)`。客户端以响应中的 `uploadUrl` PUT 到 OSS，且必须带与请求一致的 `Content-Type`。支持图片 JPEG/PNG/WebP，音频 MP4/MP3/WAV。

### `POST /api/uploads/:mediaId/complete`

Headers：`Content-Type: application/json`、`x-user-id`。请求体可为空，也可提供采集信息：

```json
{"capture":{"width":1536,"height":1024}}
```

服务端通过 OSS HEAD 校验字节数和 MIME，成功后将媒体置为 `ready`。响应 `200`：

```json
{"success":true,"result":{"mediaId":"uuid","mediaType":"image","mimeType":"image/png","bytes":2184278,"status":"ready"},"errorCode":null,"errorMsg":null}
```

不存在返回 `404 NOT_FOUND`；对象未上传返回 `409 UPLOAD_INCOMPLETE`；MIME 或字节数不一致返回 `409 UPLOAD_MISMATCH`。

### `POST /api/uploads/:mediaId/transcription`

Headers：`Accept: text/event-stream`、`x-user-id`。请求体：无。仅限 `ready` 的音频媒体。

响应为 SSE：

```text
event: delta
data: {"text":"今天"}

event: completed
data: {"transcript":"今天天气很好"}
```

转写只用于编辑页只读预览，不写入媒体或 Record。同一媒体已有活动请求返回 `409 TRANSCRIPTION_ACTIVE`。

## Record

### `POST /api/records`

Headers：`Content-Type: application/json`、`x-user-id`。请求体：

```json
{"text":"傍晚散步","media":[{"mediaId":"image-uuid"},{"mediaId":"audio-uuid"}],"source":"home"}
```

`text` 可以为空，但文本或音频至少存在一个；图片只能作为可选附件，因此纯图片返回 `400 INVALID_CONTENT`。`media` 仅传 `mediaId`，服务端验证该资产归属当前用户、已 `ready` 且未被其他 Record 使用，并从资产的 `media_type` 生成 Record block：`{type:"image",mediaId}` 或 `{type:"audio",mediaId}`。非法媒体返回 `400 INVALID_MEDIA`。

成功 `201` 返回完整 Record DTO。保存后，所有 `type:"image"` 且无 description 的 block 会进入进程内图片 queue；图片理解失败只记录日志，不影响保存结果，也不重试。

### `PATCH /api/records/:id`

Headers：`Content-Type: application/json`、`x-user-id`。请求体与创建相同，且必须带 `expectedVersion`：

```json
{"expectedVersion":1,"text":"更新文字","media":[{"mediaId":"audio-uuid"}]}
```

成功 `200` 返回 Record DTO；版本冲突返回 `409 VERSION_CONFLICT` 并携带当前 Record；不存在返回 `404 NOT_FOUND`。

### `GET /api/records?cursor=&limit=20`、`GET /api/records/:id`

Headers：`x-user-id`。无请求体。列表按 `created_at,record_id` 复合游标倒序返回 `{data,hasMore,nextCursor,pageSize}`；详情返回完整 Record DTO。图片媒体 DTO 为 `{mediaId,type:"image",url,description}`；音频为 `{mediaId,type:"audio",url,durationMs}`。

## 媒体读取

### `GET /api/media/:mediaId`

Headers：`x-user-id`；音频可带 `Range: bytes=0-`。无请求体。成功响应 `302` 到短期私有 OSS URL；无权限或不存在统一返回 `404 NOT_FOUND`。

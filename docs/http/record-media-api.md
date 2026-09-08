# Record 与媒体 HTTP API

所有 `/api/*` 接口通过 Cookie/Session 鉴权；本地开发可传 `x-user-id`。JSON 响应为 `{success,result?,errorCode,errorMsg}`。客户端不可提交 OSS object key、图片描述、MIME 或字节数复核值。

## 上传

### `POST /api/uploads/intents`

Headers：`Content-Type: application/json`、认证头。请求体：

```json
{"fileName":"photo.png","mediaType":"image","mimeType":"image/png","bytes":2184278}
```

响应 `201`：`{"success":true,"result":{"intentId":"uuid","uploadUrl":"https://…","expiresAt":"ISO-8601"},"errorCode":null,"errorMsg":null}`。图片 MIME 为 JPEG/PNG/WebP，音频 MIME 为 MP4/MP3/WAV；错误返回 `400 INVALID_INPUT`。

浏览器使用 `uploadUrl` 直接对 OSS 执行 PUT，并使用文件的 `Content-Type`。该 URL 是短期私有签名地址，不是应用 API。

### `POST /api/uploads/intents/:id/complete`

Headers：`Content-Type: application/json`、认证头。请求体可为空，或 `{"capture":{"width":1536,"height":1024}}`。

服务端通过 HEAD 复核对象 MIME 与字节数。成功 `200`：

```json
{"success":true,"result":{"mediaId":"uuid","mediaType":"image","mimeType":"image/png","bytes":2184278},"errorCode":null,"errorMsg":null}
```

不存在返回 `404 NOT_FOUND`；未上传或不匹配返回 `409 UPLOAD_INCOMPLETE` 或 `409 UPLOAD_MISMATCH`。

### `POST /api/uploads/intents/:id/transcription`

Headers：`Accept: text/event-stream`、认证头。请求体：无。仅完成上传的音频可调用。

响应 `200 text/event-stream`：

```text
event: delta
data: {"text":"今天"}

event: completed
data: {"transcript":"今天天气很好"}
```

失败发送 `failed` 事件；同一音频已有活动请求返回 `409 TRANSCRIPTION_ACTIVE`。转写只用于编辑页只读预览，不写入数据库；没有文本的音频也可以保存。

## Record

### `POST /api/records`

Headers：`Content-Type: application/json`、认证头。请求体：

```json
{"text":"傍晚散步","media":[{"mediaId":"image-uuid"},{"mediaId":"audio-uuid","transcript":"风有点大"}],"source":"home"}
```

文字可为空，但文字与媒体不可同时为空。音频 `transcript` 是预览文本的可选快照，用户界面不提供编辑能力。成功 `201` 返回完整 `RecordDto`；媒体非法返回 `400 INVALID_MEDIA`。保存成功后，所有尚无 description 的图片会进入进程内 queue，图片理解失败不改变此响应。

### `PATCH /api/records/:id`

Headers：`Content-Type: application/json`、认证头。请求体与创建相同，额外要求 `expectedVersion`：

```json
{"expectedVersion":1,"text":"更新文字","media":[{"mediaId":"image-uuid"}]}
```

成功 `200` 返回更新 DTO。版本不匹配返回 `409 VERSION_CONFLICT`，`result` 是当前 Record；不存在返回 `404 NOT_FOUND`。

### `GET /api/records?cursor=&limit=20` 与 `GET /api/records/:id`

Headers：认证头。请求体：无。列表按 `created_at,id` 复合游标倒序分页，返回 `{data,hasMore,nextCursor,pageSize}`；详情返回完整 `RecordDto`。无效 cursor 返回 `400 INVALID_CURSOR`，无权限或不存在统一 `404 NOT_FOUND`。

DTO 的媒体数组按 block 原顺序 hydrate：图片是 `{id,type:"image",url,description}`；音频是 `{id,type:"audio",url,durationMs,transcriptPreview}`。图片 description 会在保存后由 queue listener 异步补全；若 task 因 Record 版本变化或图片移除而失效，则不会回写。

## 媒体读取

### `GET /api/media/:id`

Headers：认证头；音频可带 `Range: bytes=0-`。请求体：无。

鉴权成功后响应 `302` 到短期私有 OSS URL；无权或不存在统一返回 `404 NOT_FOUND`。接口不返回 object key。

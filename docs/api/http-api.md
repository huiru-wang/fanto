# HTTP API：Server 多模态 Record V1

> 目标接口契约。客户端形态不在本文范围；当前只支持文字、图片、音频。
> 不提供视频、Topic、Suggestion、Artifact 或 Agent HTTP 接口。旧 contemplate/digest 写接口返回 `410/FEATURE_DISABLED`。

## 通用约定

开发期以 `x-user-id` 标识用户；它不是正式认证。除 `GET /health` 与直接 OSS 上传外，响应外壳固定为：

```json
{ "result": {}, "success": true, "errorCode": null, "errorMsg": null }
```

`objectKey`、永久 OSS URL、AccessKey、Secret 永不返回；附件读取仅返回短时 `readUrl`。常见错误：400 `INVALID_INPUT`，403 `FORBIDDEN`，404 `NOT_FOUND`，409 `RECORD_PROCESSING` / `GENERATION_CONFLICT`，413 `PAYLOAD_TOO_LARGE`，415 `UNSUPPORTED_MEDIA_TYPE`，422 `UPLOAD_VERIFICATION_FAILED`，429 `RATE_LIMITED`。

## 接口目录

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务健康检查 |
| POST | `/api/uploads/intents` | 申请一个图片或音频上传凭证 |
| POST | `/api/uploads/intents/:intentId/complete` | 校验 OSS 对象，获取 asset ref |
| DELETE | `/api/uploads/intents/:intentId` | 取消未消费 intent |
| POST | `/api/records` | 创建 Record |
| GET | `/api/records` | 游标查询 Record 摘要 |
| GET | `/api/records/:id` | 查询完整 Record 与短时附件 URL |
| PATCH | `/api/records/:id` | 替换文字/附件并启动新 generation |
| POST | `/api/records/:id/retry-processing` | 重试失败媒体处理 |

## 健康检查

### `GET /health`

返回 `{ "status": "ok", "timestamp": "..." }`；不检查 OSS 或模型。

## 上传

### `POST /api/uploads/intents`

请求一个附件上传意图。服务端校验类型、大小、SHA-256，并生成 recordId/blockId/object key；客户端不能指定 object key。

```json
{
  "type": "image",
  "filename": "river.jpg",
  "mimeType": "image/jpeg",
  "bytes": 1834021,
  "sha256": "8eb9f22f7c48f8d0e4bb85237e3a2b4a0e74e6da2b7270fc6b65b3906ce8c32c"
}
```

限制：图片 JPEG/PNG/WebP，单图 ≤10MB；音频 MP4/MP3/WAV，单段 ≤60 秒；单 Record 最多 3 图、1 音频。视频一律 `415`。

响应：

```json
{
  "result": {
    "intentId": "b7f90456-a2cf-4147-a166-89c2d1fcf58e",
    "recordId": "r_456",
    "blockId": "b5e3fc33-81c6-4c92-bad8-d69409ba43f1",
    "expiresAt": "2026-09-08T16:30:00.000+08:00",
    "upload": { "method": "POST", "url": "https://fanto.oss-rg-china-mainland.aliyuncs.com/", "fields": { "key": "...", "policy": "...", "signature": "..." } }
  }, "success": true, "errorCode": null, "errorMsg": null
}
```

### `POST /api/uploads/intents/:intentId/complete`

服务端使用 OSS HEAD 校验对象路径、存在性、大小、MIME 与 checksum。

```json
{ "etag": "可选OSS ETag" }
```

成功返回一次性 asset ref：

```json
{ "result": { "uploadIntentId": "b7f90456-a2cf-4147-a166-89c2d1fcf58e", "blockId": "b5e3fc33-81c6-4c92-bad8-d69409ba43f1", "type": "image" }, "success": true, "errorCode": null, "errorMsg": null }
```

未上传或校验失败为 422；complete 成功不等于 asset 已写入 Record。

### `DELETE /api/uploads/intents/:intentId`

仅能取消自己的未消费 intent，随后异步清理对象。已消费为 409，不存在为 404。成功返回 `{ "result": { "cancelled": true }, ... }`。

## Record

### `POST /api/records`

客户端提交文本和已 complete 的 asset refs，服务端构造 `RecordContentV1`。不接受客户端提交的 status、semantic、task、understanding 或 objectKey。

```json
{
  "source": "api",
  "text": "傍晚在江边散步。",
  "assets": [
    { "uploadIntentId": "b7f90456-a2cf-4147-a166-89c2d1fcf58e", "blockId": "b5e3fc33-81c6-4c92-bad8-d69409ba43f1", "type": "image" },
    { "uploadIntentId": "a84ed67b-33f9-4da5-a1cd-8c2f14d10e70", "blockId": "7dd76c9d-1f75-4924-bca4-f4f5d8c25b09", "type": "audio" }
  ]
}
```

text 与 assets 不可都为空。图片或音频存在时，初始 status 为 `pending`；纯文本直接为 `processed`。服务端在一个事务中消费 refs、写 content、创建 processing jobs。

详情响应结构：

```json
{
  "result": {
    "id": "r_456", "userId": "u_123", "source": "api", "status": "processing",
    "content": { "version": 1, "text": "...", "blocks": [], "semantic": {}, "processing": {} },
    "media": [{ "blockId": "...", "type": "image", "readUrl": "https://...", "expiresAt": "..." }],
    "createdAt": "...", "updatedAt": "..."
  }, "success": true, "errorCode": null, "errorMsg": null
}
```

完整 content schema 见 [Server 重构方案](../../plan/2026-09-08-record-multimodal-server/design.md)。

### `GET /api/records`

参数：`limit`（1–100，默认 20）、`cursor`（上页不透明复合游标）、`status`（可选 `pending|processing|processed|processing_failed`）。按 `createdAt DESC, id DESC` 返回。列表只含摘要：

```json
{ "result": { "data": [{ "id": "r_456", "textPreview": "傍晚在江边…", "mediaCounts": { "image": 1, "audio": 1 }, "status": "processed", "createdAt": "...", "updatedAt": "..." }], "nextCursor": null, "hasMore": false, "pageSize": 20 }, "success": true, "errorCode": null, "errorMsg": null }
```

### `GET /api/records/:id`

返回完整 content 与每个附件短时 `readUrl`。需验证归属；非本人和不存在均返回 404，URL 不可持久化。

### `PATCH /api/records/:id`

全量替换 text 与附件集合。保留旧附件用 `{ "blockId": "...", "keep": true }`，新增附件用 asset ref。processing 状态返回 409，避免模型和编辑竞争。

```json
{
  "text": "更新后的文字。",
  "assets": [
    { "blockId": "b5e3fc33-81c6-4c92-bad8-d69409ba43f1", "keep": true },
    { "uploadIntentId": "d0bb3b2d-4427-4b4e-b898-9578615cbd03", "blockId": "ec6855b5-a06e-4136-8846-773a99ccd01f", "type": "audio" }
  ]
}
```

服务端创建新 generation，清空受影响 semantic/understanding，状态经过 `updated → pending`。旧 job 的 generation/inputHash 不匹配时必须丢弃结果。

### `POST /api/records/:id/retry-processing`

只能重试 `processing_failed` Record 的失败任务。可指定 block：

```json
{ "blockIds": ["7dd76c9d-1f75-4924-bca4-f4f5d8c25b09"] }
```

省略 blockIds 则重试所有失败任务。非失败、未知或不属于当前 Record 的 block 返回 400。成功后状态为 `pending`。

## 处理可见性

`GET /api/records/:id` 中 `content.processing` 与 `blocks[].processing.tasks` 是处理进度的唯一 API 真相：

- `pending`：已创建 job，尚未领取；
- `processing`：worker 已领取；
- `succeeded`：对应 `understanding` 已写入；
- `failed`：包含 errorCode，可调用 retry；
- 顶层 `processed`：全部 required task 成功；`processing_failed`：至少一项失败且不再运行。

音频任务在 server worker 内部以 SSE 调用 `qwen3-asr-flash`。该流不会透传给 API 调用方，也不会把中间转写写入 Record；只有收到模型 `finish_reason=stop` 及 `data: [DONE]`、并得到非空转写后，才原子写入 audio understanding 与语义结果。

## 停用接口

`POST /api/contemplate`、`GET /api/contemplate/*`、`POST /api/digest` 均返回 `410/FEATURE_DISABLED`。本期没有 `/api/topics`、`/api/messages`、`/api/agent/stream`、视频或 Artifact/Suggestion API。

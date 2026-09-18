# Media

Media 负责 Record 使用的图片与音频资产。二进制内容存储在阿里云 OSS，业务元数据保存在 `media_assets`。

## 支持格式

| 类型 | MIME |
| --- | --- |
| Image | `image/jpeg`、`image/png`、`image/webp` |
| Audio | `audio/mp4`、`audio/mpeg`、`audio/wav` |

单个媒体请求声明大小上限为 50,000,000 bytes。

## 上传链路

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Server
  participant O as OSS

  C->>S: POST /api/uploads {mimeType, bytes}
  S-->>C: mediaId + signed PUT URL
  C->>O: PUT object
  C->>S: POST /api/uploads/:id/complete
  S->>O: HEAD object
  S->>S: validate Content-Length + Content-Type
  S-->>C: status=ready
```

Server 根据 MIME 决定 media type 和对象后缀。complete 时会验证 OSS 实际对象大小和 MIME；不一致返回 `UPLOAD_MISMATCH`。

ready Media 才能关联到 Record。关联后 `ext_data.recordId` 记录归属，避免同一媒体被不同 Record 重复使用。

## 图片理解

Record postprocess 发现 image block 尚无 description 时，会通过 Vision Client 使用 OSS 读取地址生成描述。成功结果写回该 Record block：

```json
{ "type": "image", "mediaId": "...", "description": "..." }
```

图片理解失败只记录日志，不阻断其他媒体处理。

## 音频转写

Audio block 在 Record postprocess 中调用 ASR。成功后：

- transcription 写入 Record audio block；
- ASR 状态、模型、语言、情绪、完成时间写入对应 Media `ext_data.asr`。

失败时 Media 记录失败状态和错误码，Record block 不产生 transcription。

当前没有独立的“上传后立即转写” SSE API；音频理解属于 Record 后置处理的一部分。

## 读取

`GET /api/media/:id` 先校验当前用户和 ready 状态，再 302 到短期 OSS 读取地址。业务 API 不直接暴露永久 OSS URL。

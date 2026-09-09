# Record 编辑页流程

Record 的正文是文本和音频至少其一；图片仅为可选附件。允许文本、音频、文本+音频，以及上述任意组合附带图片；不允许纯图片。转写是音频预览，不可编辑且不保存。

```mermaid
sequenceDiagram
  actor U as 用户
  participant C as 编辑页
  participant API as 服务端
  participant M as media_assets
  participant OSS as 私有 OSS
  participant Q as 图片 queue
  participant L as 图片 listener

  U->>C: 选择图片或录音
  C->>API: POST /api/uploads
  API->>M: 创建 mediaId, uploading
  API-->>C: mediaId + PUT URL
  C->>OSS: 直传，使用相同 Content-Type
  C->>API: POST /api/uploads/:mediaId/complete
  API->>OSS: HEAD 校验
  API->>M: status=ready
  opt 音频预览
    C->>API: POST /api/uploads/:mediaId/transcription
    API-->>C: SSE delta / completed
  end
  C->>API: 保存 text + 有序 mediaId
  API->>M: 校验 owner、ready、media_type
  API-->>C: Record，带明确 type block
  API->>Q: 只发布图片 task
  Q->>L: image_understanding
```

同一 `mediaId` 贯穿创建上传、确认上传与音频转写。保存时服务端不接受客户端声称的媒体类型，而是从 `media_assets.media_type` 写入 block。图片理解失败仅写入 `logs/service.log`，不改变 Record，不重试或补偿。

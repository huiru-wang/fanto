# HTTP API

基地址：`http://127.0.0.1:3000`。响应信封统一为：

```json
{ "success": true, "result": {}, "errorCode": null, "errorMsg": null }
```

除 `GET /health` 外，请求必须带 `x-user-id`。当前运行入口只允许 `default-user`；其他 user-id 即使格式合法也返回 `401 UNAUTHORIZED`。这仍是测试期访问边界，不是正式认证。

## 健康检查

`GET /health` → `{ status: "ok", timestamp }`

## 记录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/records` | 创建记录，返回 201 |
| GET | `/api/records?limit=20&cursor=` | 倒序分页读取，limit 为 1–100 |
| GET | `/api/records/:id` | 单条记录 |
| PATCH | `/api/records/:id` | 以 expectedVersion 更新内容 |
| POST | `/api/records/search` | 当前用户 Record 语义搜索 |

`POST /api/records/search` 的每个命中返回 `recordId`、`sourceType` (`record_text` / `image` / `audio`)、可选 `mediaId`、`snippet` 和向量 `distance`；图片和音频命中仍关联回原 Record。

创建体：`{ text, media, eventAt, source? }`；更新体：`{ text, media, expectedVersion }`。`eventAt` 为必填的带时区 ISO 8601 时间，服务端规范化为 UTC；`media` 为 `{ mediaId }[]`。Record 列表按 `eventAt`、`id` 倒序，`nextCursor` 同样基于这两个字段。创建或更新完成后，服务端异步处理当前版本的图片理解、音频转写与向量索引；图片 description 写入对应 image block，音频 transcription 写入对应 audio block。处理期间 Record 状态为 `processing`，更新返回 `409 VERSION_CONFLICT`。常见错误：`INVALID_INPUT`、`INVALID_CONTENT`、`INVALID_MEDIA`、`INVALID_CURSOR`、`VERSION_CONFLICT`、`NOT_FOUND`。

列表结果：`{ data, hasMore, nextCursor, pageSize }`。`nextCursor` 只应在 `hasMore=true` 时使用。

### Record 语义搜索

`POST /api/records/search` 请求体：

```json
{ "query": "AI Coding", "limit": 10 }
```

- `query` trim 后不能为空；
- `limit` 默认 10，范围 1–20；
- 当前用户只来自 `x-user-id`，请求体不能传 `userId`；
- 搜索通过 Memory 模块在当前用户的 sqlite-vec partition 内执行；
- 返回 `{ data: [{ recordId, sourceType, mediaId, snippet, distance }] }`；
- `sourceType` 为 `record_text` / `image` / `audio`，媒体命中通过 `mediaId` 关联具体图片或音频；
- `distance` 是 sqlite-vec 原始向量距离，仅用于检索相关性判断，不代表已经校准的产品置信度或概率。

### Record 后置处理与返回字段

`content.blocks` 是图片描述和音频转写正文的唯一来源。客户端创建或更新时只提交 `{ mediaId }`，不得提交 `description` 或 `transcription`；这些字段由服务端在后置处理完成后补充。

```json
{
  "id": "record_id",
  "eventAt": "2026-09-17T02:30:00.000Z",
  "status": "processed",
  "content": {
    "text": "准备周末徒步",
    "blocks": [
      { "type": "image", "mediaId": "image_media_id", "description": "雨衣和登山杖放在玄关。" },
      { "type": "audio", "mediaId": "audio_media_id", "transcription": "周末去西山徒步。" }
    ]
  },
  "media": [
    { "mediaId": "image_media_id", "type": "image", "url": "/api/media/image_media_id", "description": "雨衣和登山杖放在玄关。" },
    { "mediaId": "audio_media_id", "type": "audio", "url": "/api/media/audio_media_id", "durationMs": 12000, "asr": { "status": "succeeded", "transcript": "周末去西山徒步。", "model": "qwen3-asr-flash", "emotion": "neutral", "language": "zh", "completedAt": "2026-09-17T00:00:00.000Z", "errorCode": null } }
  ]
}
```

`status` 取值为：`pending`（已保存，等待处理）、`updated`（内容已更新，等待处理）、`processing`（正在进行图片/音频理解）和 `processed`（当前版本处理完成）。音频完成后，`media[].asr` 同步返回转写文本、模型、情绪 `emotion` 与语种 `language`；情绪与语种由 ASR 服务的 `audio_info` 注解提供，缺失时为 `null`。单个媒体失败不会阻断其他媒体处理；失败音频的 `media[].asr.status` 为 `failed`，其 `transcript` 为 `null`；图片失败时对应 block 不含 `description`。Record 完成当前版本的 postprocess 后才更新 Memory；后续 Embedding / Memory Index 失败不会把已经 `processed` 的 Record 回滚。

`eventAt` 是 Record 的业务发生时间；`createdAt`、`updatedAt` 仅表示服务端保存与变更时间。当前 schema 只支持空 SQLite 数据库初始化；已有数据库需要重建后才包含 `event_at` 列与对应索引。

### 本次接口变更

- **移除** `POST /api/uploads/:mediaId/transcription` 及其 SSE `delta`、`completed`、`failed` 事件。音频转写改为在 Record 创建或更新后的自动后置处理中执行。
- **新增返回字段**：audio block 的可选 `transcription`。同一文本也会投影为 `media[].asr.transcript`，方便现有媒体展示；其正式存储位置是 Record 的 audio block。
- **新增更新限制**：Record 为 `processing` 时，`PATCH /api/records/:id` 返回 `409 VERSION_CONFLICT`；读取接口始终可用。

## 上传与媒体

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/uploads` | 根据 MIME 创建上传凭据，返回直传 URL |
| POST | `/api/uploads/:mediaId/complete` | 校验对象并将媒体标记 ready |
| GET | `/api/media/:mediaId` | 已就绪且属于当前用户的媒体重定向到 OSS |
| GET | `/api/media/:mediaId/url` | 返回已就绪媒体的短期 OSS 签名读取地址 |

创建上传体：`{ mimeType, bytes }`。不接受客户端 `fileName` 或 `mediaType`；服务端只允许 `audio/mp4`、`audio/mpeg`、`audio/wav`、`image/jpeg`、`image/png`、`image/webp`，并由 MIME 推导媒体类型和 OSS 对象后缀。客户端 PUT 签名 URL 时必须携带相同的规范 MIME `Content-Type`。complete 体可选 `{ capture: { width?, height?, durationMs? } }`。

`GET /api/media/:mediaId` 与 `GET /api/media/:mediaId/url` 都必须携带 `x-user-id`。不存在、未完成或不属于该用户的媒体统一返回 `404 NOT_FOUND`；前者成功时返回 302 到短期 OSS 签名地址，后者返回 `{ url }` JSON，供不能附加自定义 Header 的浏览器 `<img>` / `<audio>` 元素使用。

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

`summary` 在 Creation 和 Proposal 的响应中均为可空的纯文本。当前服务只支持从空数据库创建的 schema，不提供旧 JSON 摘要或历史数据库的升级兼容。

提案列表只支持 `pending_confirmation` 状态。确认使用事务创建或更新 Creation，并把来源 Record 关联迁移到该 Creation；若更新目标版本已变化，则返回 `VERSION_CONFLICT`。Creation 完整列表目前支持可选的类型筛选；尚未提供搜索、状态筛选或列表分页。

## 独立 Agent 服务

Agent 服务独立运行在 `http://127.0.0.1:3001`，定义读取 `apps/agent/agents.yaml`，不复用业务服务的数据库。当前 `main` Agent 可通过 `FantoServerClient` 调用 Business Server 的 `record_list`、`record_search`、`record_get` 三个只读工具；Tool schema 不接受 `userId`，实际用户身份来自 Session Run Context，并由 Client 转成 Business Server 的 `x-user-id`。除 `GET /health` 外，Agent HTTP 接口要求以下 Header，且当前运行入口只允许 `X-User-Id: default-user`：

```text
Authorization: Bearer <AGENT_TOKEN>
X-User-Id: <用户 ID>
X-Trace-Id: <可选链路 ID，可省略>
```

| 方法 | 路径 | 请求 | 成功响应 |
| --- | --- | --- | --- |
| POST | `/api/agent/sessions` | `{ agentId }` | `201`，返回 `sessionId` 与 `agentId` |
| POST | `/api/agent/stream` | `{ agentId, sessionId, message }` | `200`，SSE 事件流 |
| GET | `/api/agent/sessions/:sessionId/history?cursor=&limit=` | 无请求体 | `200`，倒序历史页 |
| POST | `/api/agent/tasks` | `{ agentId, sessionId, message }` | `202`，任务元数据 |
| GET | `/api/agent/tasks/:taskId` | 无请求体 | `200`，任务状态与结果 |

先创建 Session；`stream` 和 `tasks` 必须使用该 `sessionId`。Session 固定绑定 `userId` 和工作区；请求的 `agentId` 是本次执行目标，服务会在 Session 空闲时自动应用或切换到该 Agent。`workspace` 不接受客户端路径，服务固定映射至 `data/workspaces/<sessionId>`。

```sh
export AGENT_TOKEN='替换为服务端 AGENT_TOKEN'

SESSION_ID=$(curl -sS http://127.0.0.1:3001/api/agent/sessions \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123' \
  -H 'X-Trace-Id: trace_001' \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"main"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).result.sessionId')
```

流式执行使用 POST 响应体的 SSE 流，不使用浏览器原生 `EventSource`：

```sh
curl -N http://127.0.0.1:3001/api/agent/stream \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123' \
  -H 'X-Trace-Id: trace_002' \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"main\",\"sessionId\":\"$SESSION_ID\",\"message\":\"你好\"}"
```

事件以 `start` 开始，期间可发送 `turn_start`、`tool_start`（`toolCallId`、`toolName`）、`tool_end`（再加 `status: succeeded | failed`）和零到多个 `delta`，最终为 `done` 或 `error`。工具事件只提供客户端状态展示所需的标识与状态，不返回工具参数、工具结果、内部错误或 reasoning。单次请求最长 120 秒；同一 Session 已在运行时返回 `409`。

历史接口按 `seq` 从新到旧返回。`cursor` 填上页最后一项的 `seq`；`limit` 默认 50，范围为 1–100。`compaction` 和内部 `fanto.*` 条目不对外返回，敏感字段会被脱敏：

```json
{
  "success": true,
  "result": {
    "sessionId": "...",
    "agentId": "main",
    "data": [],
    "hasMore": false,
    "nextCursor": null
  }
}
```

异步任务创建后立即返回 `pending` 元数据。任务状态为 `pending`、`running`、`completed` 或 `failed`；完成时 `output` 有值，失败时 `error` 有值：

```sh
curl -sS http://127.0.0.1:3001/api/agent/tasks \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'X-User-Id: user_123' \
  -H 'X-Trace-Id: trace_003' \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"main\",\"sessionId\":\"$SESSION_ID\",\"message\":\"列出工作区文件\"}"
```

`agent_tasks` 与 Pi Session 共用 Agent 专用 SQLite。当前后台 Runner 只支持单实例部署；服务中断时遗留的 `running` 任务会标记为 `failed`，不自动重跑。完整配置与更多示例见 [Agent 服务说明](../../apps/agent/README.md)。

`apps/agent/agents.yaml` 及其通过 `systemPromptFile` 引用的 Prompt 文件仅在服务启动时加载，不做运行时热更新。变更 YAML 或 Prompt 后需要重启服务；已有 Session 在下一次 stream 或 task 执行时会自动升级，无需额外状态查询或配置更新接口。

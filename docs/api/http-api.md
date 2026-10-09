# HTTP API

本地基地址：`http://127.0.0.1:3000`。业务 Domain 接口通常使用以下响应信封；部分 Agent Session/Stream 错误使用简化的 `{error}`：

```json
{ "success": true, "result": {}, "errorCode": null, "errorMsg": null }
```

除健康检查、第三方认证 intent、第三方认证、兼容的注册/登录接口和 Refresh 外，所有 API 都要求 `Authorization: Bearer <access token>`。Access Token 有效期 30 分钟；Refresh Token 有效期 30 天并采用滑动续期。用户身份只来自服务端验证后的 JWT `sub`。

## 健康检查

`GET /health` 表示整体服务可用性并检查 PostgreSQL。数据库可用时返回 `200 { status: "ok", database: "ok", timestamp }`；不可用时返回 `503 { status: "unavailable", database: "unavailable", timestamp }`。当前不提供独立 `/ready`。

## 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/intents` | 为 Google 或 Apple 认证创建一次性 challenge |
| POST | `/api/auth/authentications` | 用第三方 proof 登录；新身份会自动创建 Fanto 用户 |
| POST | `/api/auth/registrations` | 使用 Google proof 创建 Fanto 用户 |
| POST | `/api/auth/logins` | 使用 Google proof 登录已有 Fanto 用户 |
| POST | `/api/auth/tokens/refresh` | 用 refresh token 换取新的 access / refresh token 对 |

创建 intent：

```json
{ "purpose": "authenticate", "provider": "google" }
```

客户端登录应创建 `purpose=authenticate` 的 intent，`provider` 可为 `google` 或 `apple`。成功响应的 `result` 包含 `intentId`、`provider`、`expiresAt` 和 `challenge.nonce`；iOS 将 nonce 传给对应的原生身份 SDK，随后以 `{ "intentId": "...", "proof": { "idToken": "..." } }` 调用 `/api/auth/authentications`。Server 验证 provider token 的签名、issuer、audience、expiry、sub 和 nonce，在同一事务中按 `(provider, sub)` 登录已有用户或创建新用户，再签发 Fanto JWT。第三方 ID token 不可用于其他业务接口。`register` 与 `login` purpose 以及对应 endpoints 仍保留给兼容调用方，但 iOS 不使用它们。

认证成功结果为 `{ user, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }`，其中 `user` 为 `{ userId, status }`。Access Token 有效期 30 分钟，Refresh Token 有效期 30 天。常见认证错误包括：`IDENTITY_NOT_REGISTERED`、`IDENTITY_ALREADY_REGISTERED`、`CHALLENGE_INVALID`、`INVALID_PROVIDER_PROOF`、`USER_DISABLED`、`REFRESH_TOKEN_INVALID` 和 `RATE_LIMITED`。

已认证用户接口：`GET /api/users/me` 返回当前用户和有效登录身份；`POST /api/users/me/identities/intents` 创建绑定身份所需 challenge，`POST /api/users/me/identities` 完成绑定；`POST /api/users/me/reauth/intents` 创建解除身份前的验证 challenge；`DELETE /api/users/me/identities/:identityId` 携带 reauth proof 后解除非最后一个身份。iOS 当前不展示账号管理界面，因此不调用这些接口。

## 记录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/records` | 创建记录，返回 201 |
| GET | `/api/records?limit=10&cursor=` | 倒序分页读取，limit 默认 10、范围 1–100 |
| GET | `/api/records/:id` | 单条记录 |
| PATCH | `/api/records/:id` | 以 expectedVersion 更新内容 |
| DELETE | `/api/records/:id` | 以 expectedVersion 硬删除记录 |
| POST | `/api/records/search` | 当前用户 Record 语义搜索 |

`POST /api/records/search` 的每个命中返回 `recordId`、原始 Record 的 `eventAt`、从完整 Record 内容构建的 `preview` 和向量 `distance`。

创建体：`{ text, media, location?, eventAt, source? }`；更新体：`{ text, media, location?, expectedVersion }`；删除体：`{ expectedVersion }`。`location` 为 `{ name, countryCode?, country?, province?, city?, district?, latitude, longitude }`；`countryCode` 为 ISO 3166-1 alpha-2，两位字母，其他行政区字段均可选。创建时省略表示无地点，更新时省略保留原地点、`null` 删除、对象替换。坐标固定为 WGS-84。`eventAt` 为必填的带时区 ISO 8601 时间，服务端规范化为 UTC；`media` 为 `{ mediaId }[]`，最多 5 项。Record 列表按 `eventAt`、`id` 倒序，`nextCursor` 同样基于这两个字段。保存 Record 时，音频 capture 中已有的 `durationMs` 会写入对应 audio block；后置处理完成后，图片 description、音频 transcription 与 ASR metadata 写回 `content.blocks`。Record 读取不再查询 `media_assets`，也不返回冗余 `media[]`。删除会同事务移除 Record（含向量）与独占媒体资产、清理来源关联，并在提交后尽力清理 OSS 对象，清理失败仅记录日志、不持久化重试；TaskRun 正式交付引用的媒体按独立保留规则处理，详见 [媒体清理](../domain/media.md#record-删除与媒体清理)；已排队的后置任务因找不到 Record 而失效。处理期间 Record 状态为 `processing`，更新返回 `409 VERSION_CONFLICT`。常见错误：`INVALID_INPUT`、`INVALID_CONTENT`、`INVALID_MEDIA`、`INVALID_CURSOR`、`VERSION_CONFLICT`、`NOT_FOUND`。

列表结果：`{ data, hasMore, nextCursor, pageSize }`。`nextCursor` 只应在 `hasMore=true` 时使用。

### Record 语义搜索

`POST /api/records/search` 请求体：

```json
{ "query": "AI Coding", "limit": 10 }
```

- `query` trim 后不能为空；
- `limit` 默认 10，范围 1–20；
- 当前用户只来自验证后的 Access JWT `sub`，请求体不能传 `userId`；
- 搜索通过 Record Retrieval 在当前用户范围内执行 pgvector 查询；
- 返回 `{ data: [{ recordId, eventAt, preview, distance }] }`；
- `distance` 是 pgvector 原始向量距离，仅用于检索相关性判断，不代表已经校准的产品置信度或概率。

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
      {
        "type": "audio",
        "mediaId": "audio_media_id",
        "durationMs": 12000,
        "transcription": "周末去西山徒步。",
        "asr": {
          "status": "succeeded",
          "model": "qwen3-asr-flash",
          "emotion": "neutral",
          "language": "zh",
          "completedAt": "2026-09-17T00:00:00.000Z"
        }
      }
    ]
  }
}
```

`status` 取值为：`pending`（已保存，等待处理）、`updated`（内容已更新，等待处理）、`processing`（正在进行图片/音频理解）和 `processed`（当前版本处理完成）。音频成功后，audio block 的 `transcription` 保存正文，`asr` 保存状态、模型、情绪 `emotion`、语种 `language` 与完成时间；失败音频写入 `asr.status=failed` 和 `errorCode`，不产生 `transcription`。单个媒体失败不会阻断其他媒体处理；图片失败时对应 block 不含 `description`。Record 完成当前版本的 postprocess 后才更新 Record Retrieval；后续 Embedding / 索引失败不会把已经 `processed` 的 Record 回滚。

`eventAt` 是 Record 的业务发生时间；`createdAt`、`updatedAt` 仅表示服务端保存与变更时间。当前 PostgreSQL 使用完整空库基线加异步 V3 前向迁移；旧迁移元数据按迁移约定归并，旧 SQLite 数据不提供原地升级。

Record response 以 `content.blocks` 作为唯一媒体展示数据来源；媒体 URL 不嵌入 Record，而是按 `mediaId` 从 Media API 临时获取。

## 上传与媒体

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/uploads` | 根据 MIME 创建上传凭据，返回直传 URL |
| POST | `/api/uploads/:mediaId/complete` | 校验对象并将媒体标记 ready |
| GET | `/api/media/:mediaId` | 已就绪且属于当前用户的媒体重定向到 OSS |
| GET | `/api/media/:mediaId/url?variant=original|thumbnail` | 返回已就绪媒体的短期 OSS 签名读取地址与过期时间 |
| GET | `/api/media/:mediaId/meta` | 返回已就绪媒体的稳定类型与 capture metadata |

创建上传体：`{ mimeType, bytes }`。不接受客户端 `fileName` 或 `mediaType`；服务端只允许 `audio/mp4`、`audio/mpeg`、`audio/wav`、`image/jpeg`、`image/png`、`image/webp`，并由 MIME 推导媒体类型和 OSS 对象后缀。客户端 PUT 签名 URL 时必须携带相同的规范 MIME `Content-Type`。complete 体可选 `{ capture: { width?, height?, durationMs? } }`。

`GET /api/media/:mediaId`、`GET /api/media/:mediaId/url` 与 `GET /api/media/:mediaId/meta` 都必须携带 Access JWT。不存在、未完成或不属于当前用户的媒体统一返回 `404 NOT_FOUND`；`/:id` 成功时返回 302 到原始媒体的短期 OSS 签名地址；`/:id/url` 返回 `{ url, expiresAt }` JSON，`variant` 默认为 `original`，图片可请求 `thumbnail`（OSS 实时宽 600、q80、WebP），音频无论 variant 都返回 original；非法 variant 返回 `400 INVALID_INPUT`。读取签名有效期为五分钟，客户端不应持久化，thumbnail / original 应分键缓存，并在读取失败后重新获取；该接口的响应体不会写入 access log。`/:id/meta` 对客户端上传的图片 / 音频返回 `{ mediaId, mediaType, mimeType, width?, height?, durationMs? }`。Task Worker 生成的结果文件由 Server 内部直接上传，不经过 `/api/uploads`，其 `mediaType=file`，meta 额外返回 `bytes / filename`。所有 meta 都不包含 signed URL。

## Proposal / Project

Proposal 的列表/详情保留 `sessionId: string | null`（对应内部提议分析会话）；具有 Session 归属权限的用户可通过通用 History 查看，但不能通过公共执行接口调用内部 Agent。

所有接口按 Access JWT 的 userId 隔离。列表响应为 `{ data, hasMore, nextCursor, pageSize }`，limit 默认 20、最大 100，必须为正整数；Proposal 参考记录默认 5。实体时间为 ISO 8601，空字段明确返回 null。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/proposals?type=&status=&targetProjectId=&limit=&cursor=` | type 为 create / extend，status 为 pending / accepted / rejected；默认不过滤 |
| GET | `/api/proposals/:id` | 提议详情及 referenceRecordCount |
| GET | `/api/proposals/:id/records?limit=&cursor=` | 完整参考 Record，按 eventAt / recordId 倒序分页 |
| POST | `/api/proposals/:id/accept` | 请求体 `{ selectedIdeaId?: string }`；同步创建/更新 Project，返回 `{ projectId }`；后台执行状态仅通过 Project 查询 |
| POST | `/api/proposals/:id/reject` | 返回 `{ proposal }`，同决策幂等 |
| GET | `/api/projects?status=&limit=&cursor=` | 默认包含 queued/running/completed/failed，可筛选任一状态或 archived；摘要列表不含 content |
| GET | `/api/projects/:id` | 完整 Project，包含 recordCount / referenceRecords（最近最多 5 条） |
| PATCH | `/api/projects/:id` | `{ expectedVersion, title?, summary?, goal?, coverMediaId?, content? }`，返回 Project |
| POST | `/api/projects/:id/archive` | `{ expectedVersion }`，返回 Project；重复归档幂等 |

Project 包含 projectId / userId / sessionId / goal / title / summary / coverMediaId / content / status / version / createdAt / updatedAt。当前公开 Project 详情只返回最近最多五条参考 Record，服务端尚未注册额外的 Project records 分页 Route。Proposal 包含 proposalId / userId / sessionId / type / targetProjectId / title / proposedSummary / content / status / resultProjectId / createdAt / updatedAt / resolvedAt。内容与事务语义以 [Domain](../domain/projects.md) 为准。

PATCH 不接受用户身份、Session ID 或状态字段；缺省字段保留，content 是完整正文。Proposal `content` 为 `{ reason, ideas: [{ id, title, idea, tags, goal }], selectedIdeaId }`，其中 Goal 是 `{ objective, context?, constraints?, successCriteria? }`；最多两个 Idea，`selectedIdeaId` 在用户接受后填入。Goal 由 Proposal 接受写入 Project，也可由 creator-agent 在 `project_manage` 更新。summary 更新需要向量服务成功；创建 Project 只在 Proposal 接受时发生。

## Project Agent Session

Project 与 Session 分别管理：`projects.status` 表示任务是否在排队/执行/成功/失败/归档，不代表 Session 是否存在。Project `sessionId` 单独返回，可能为 null。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/agent/sessions/:sessionId/history?limit=&cursor=` | 通用 Session 历史，按 Session userId 校验，无 Creator 专属处理 |
| GET | `/api/agent/sessions/:sessionId/events` | 订阅该 Session 的通用 SSE（不缓存和回放；断线后重拉 History） |
| POST | `/api/agent/stream` | 统一多轮会话 SSE：传入 `sessionId`、`message`、可选 `metadata.projectId`；从 Session 解析 Agent，Creative Tool 层验证项目权限 |

所有 Agent 都允许公开创建 Session，但 Proposal、Creator、Task Worker 无业务授权时不得执行模型或专用工具。Project 续聊不修改业务状态；Creator 保存非空作品成功可将 failed 恢复 completed。Project 专属消息提交、启动、History、Events 和 Stream 路由已移除；H5/iOS 均已适配通用 Session 协议。

## 上传图片

`POST /api/uploads` 声明 image MIME 时最大 10 MiB，超限返回 413 IMAGE_TOO_LARGE；上传完成继续核验 OSS 实际长度与 MIME。音频沿用原有限制。

## Agent Tasks

Task 只能由 `main` Agent 的 `create_task` Tool 创建；当前没有客户端直接创建 Task 的 POST API。`main` 使用 `get_task` 和 `update_task` 管理既有 Task；Task 定义与 TaskRun 持久化在 PostgreSQL，所有查询和状态变更按 Access JWT `sub` 强制 user-scoped。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tasks` | 当前用户 Task 列表 |
| GET | `/api/tasks/:taskId` | Task 详情 |
| GET | `/api/tasks/:taskId/runs` | TaskRun 列表 |
| GET | `/api/tasks/:taskId/runs/:runId` | TaskRun 详情 |
| POST | `/api/tasks/:taskId/pause` | 暂停后续 scheduled Run 生成 |
| POST | `/api/tasks/:taskId/resume` | 恢复 scheduled Task |
| DELETE | `/api/tasks/:taskId` | 取消 Task；不再创建后续 Run，已运行的 Run 由其 Worker 自行收尾 |
| GET | `/api/tasks/artifacts/:mediaId/preview` | 读取当前用户已交付的 HTML / Markdown / Text Task Artifact 原文，用于域内预览 |

`create_task` 使用面向用户意图的 Goal 模型：`objective` 必填，另有可选 `context / constraints / successCriteria`；`output.format` 必填且必须与用户明确要求一致。当前系统只有一个 `task-worker`，由 Server 自动选择，LLM 不传 `agentId`、timeout、mediaId 或文件协议。已确认相关的历史资料只通过可选 `references.recordIds` 传递真实 Record ID，Worker 再通过 Record Tool 获取正文与媒体。Goal 只描述用户最终想得到什么、背景、真实约束与用户视角的完成标准，不包含 Workspace、文件路径、`fanto-media`、OSS、`deliver_task_result` 等执行细节。同一 Main Session 可创建多个 Task，系统不自动去重、替代或版本化。Task 创建时只写入 `nextRunAt`，包括 immediate Task 的创建时刻；Scheduler 每 5 分钟扫描到期 Task（即时任务创建时主动唤醒扫描），先提交 status=queued 的 TaskRun 并向 AgentExecutionQueue 发布执行消息；TaskHandler 认领后标记 running，再创建/绑定 Session，执行一次，不自动重试。

TaskRun 成功响应中的结果形态为：

```json
{
  "runId": "...",
  "taskId": "...",
  "status": "completed",
  "scheduledAt": "2026-09-29T10:00:00.000Z",
  "startedAt": "...",
  "finishedAt": "...",
  "plan": {
    "summary": "先整理旅行素材，再完成卡片并检查最终效果。",
    "steps": [
      { "id": "material", "title": "整理旅行素材" },
      { "id": "design", "title": "完成卡片设计" }
    ],
    "createdAt": "...",
    "updatedAt": "...",
    "version": 1
  },
  "result": {
    "summary": "...",
    "artifacts": [
      {
        "filename": "result.html",
        "role": "primary",
        "mediaId": "...",
        "mimeType": "text/html",
        "bytes": 1024,
        "checksum": "sha256:..."
      }
    ]
  },
  "error": null
}
```

Task Worker 接收到的 User Message 只有纯 Task Brief（objective / context / constraints / successCriteria）。输出格式、主文件名、Record references、时区、已有 Plan 等执行信息由 `TaskExecutionContextProvider` 注入 Worker System Prompt 的内部上下文，不再混入用户 Goal。Worker 可先用 Record Tool 补齐用户资料；任务依赖当前、变化中或公开事实时可调用 `web_search` 获取公开网页资料与来源 URL；正式 write/edit/bash/交付前必须调用 `task_plan_manage`，首次 `action=create`，需要修订时 `action=update`，Plan 直接保存到 `task_runs.ext_data.plan`，API 只投影解析后的 `plan`，不公开完整 ext_data。当前不要求逐步确认或更新 step 状态。

Worker 最终将主结果写为 `result.md` / `result.txt` / `result.html`，再调用 `deliver_task_result` 声明主文件和可选附属文件。该工具校验相对路径与文件内容、上传 OSS、注册 ready Media，最后完成 TaskRun；普通模型文本不能作为任务结果。HTML / Markdown 内部引用 Fanto 图片或音频时使用真实 `fanto-media://<mediaId>`，但这一协议属于平台实现，不得作为使用说明或交付摘要暴露给用户；`images/foo.jpg`、`./foo.png` 等本地相对媒体路径仍会在交付阶段被拒绝。成功交付会立即结束 Worker 回合。模型调用失败、超时或未交付时，当前只运行一次，失败/超时/没有交付则标记 failed，不自动创建新的 Worker Session 重试。`GET /api/tasks/artifacts/:mediaId/preview` 只允许当前用户自己的 ready `media_type=file` Task Artifact，且必须仍被对应 TaskRun 的 `result.artifacts[]` 声明；仅支持 `text/html / text/markdown / text/plain`，最大 2 MiB。

## Agent Runtime

Agent Runtime 内嵌在 Business Server，使用同一地址 `http://127.0.0.1:3000` 与统一鉴权。定义读取 `apps/server/agent.yaml`，Prompt 由 `apps/server/src/agent/prompts/` 的 TypeScript 模块提供；Session 仍使用独立 SQLite，不与业务 PostgreSQL 共用。当前 `main` Agent 在每次 Run 前通过 Context Runtime 构建 Character、当前时间、当前 Task 摘要和最近 2 条紧凑 Recent Records，再填充 System Prompt；Recent Records 通过 `listRecords(limit=2)` 读取，可命中 Record 首页缓存，不执行 Query Rewrite 或向量搜索，记录时间按请求时区展示。Record Tool、`present_media` 与 Task Tool 通过 `business-services.ts` 调用对应领域 Service。Tool schema 不接受 `userId`，实际用户身份来自统一验证的 Access JWT `sub`，并作为 Run Context 的唯一用户入口。除 `GET /health` 外，Agent HTTP 接口统一要求 Access JWT：

```text
Authorization: Bearer <ACCESS_TOKEN>
X-Trace-Id: <可选链路 ID，可省略>
X-Time-Zone: <可选 IANA 时区，如 Asia/Shanghai；缺失或无效时为 UTC>
```

| 方法 | 路径 | 请求 | 成功响应 |
| --- | --- | --- | --- |
| POST | `/api/agent/sessions` | `{ agentId? }` | `201`，返回 `sessionId` 与 `agentId` |
| POST | `/api/agent/stream` | `{ sessionId, message, metadata?: { projectId?: uuid } }` | `200`，SSE 事件流 |
| GET | `/api/agent/sessions/:sessionId/history?cursor=&limit=` | 无请求体 | `200`，倒序历史页，包含 `messages` 投影 |
| GET | `/api/agent/sessions/:sessionId/events` | 无请求体 | `200`，只读 SSE 订阅，不发起执行或重放 |

先创建 Session；`stream` 必须使用已有的 `sessionId`。创建 Session 时 `agentId` 可省略（默认 `main`）。Stream 不接受 `agentId`，只从 Session 所有权绑定解析其类型；所有 Agent 都可公开创建 Session，但 Proposal/Task Worker 需要服务端注入可信 Record/TaskRun 才能执行。Creator 的 `metadata.projectId` 需经过当前用户及 Project↔Session 绑定校验，普通续聊不更新 Project 执行状态。`workspace` 不接受客户端路径，服务固定映射至 `data/workspaces/<userId>/<sessionId>`。TaskRun 也使用同样的两层用户隔离路径，并创建独立 Session。

```sh
export ACCESS_TOKEN='替换为服务端 ACCESS_TOKEN'

SESSION_ID=$(curl -sS http://127.0.0.1:3000/api/agent/sessions \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'X-Trace-Id: trace_001' \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"main"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).result.sessionId')
```

流式执行使用 POST 响应体的 SSE 流，不使用浏览器原生 `EventSource`：

```sh
curl -N http://127.0.0.1:3000/api/agent/stream \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'X-Trace-Id: trace_002' \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"message\":\"你好\"}"
```

请求响应 SSE 以 `start` 开始，期间可发送 `turn_start`、`message_start`、`message_end`、`tool_start`（`toolCallId`、`toolName`）、`tool_end`（再加 `status: succeeded | failed`）和零到多个 `delta`，最终为 `done` 或 `error`。工具事件以 `presentation.visible/displayContent/animation` 控制可见性与产品化文案，客户端只呈现声明为可见的活动状态，不展示原始工具参数、技术 ID、内部错误或 reasoning。当前有三个产品化白名单例外：成功的 `present_media` 返回稳定媒体 metadata；成功的 `create_task` 返回 `kind=task_created` 与 Task Card 所需摘要；成功的 `collect_user_input` 返回 `kind=user_input_requested`、`interactionId` 和结构化问题，H5 渲染为原生表单。`collect_user_input` 成功后当前 Agent Run 立即结束，用户提交答案后以同一 Session 的下一条 User Message 继续；回答消息带内部 interaction 标记供历史恢复识别，History API 将其投影为 `user_input_response`，使 H5 渲染为“用户澄清”卡片而不展示内部标记。其他 Tool Result 仍不对客户端公开。单次 Stream 请求最长 10 分钟（模型请求另有独立限制）；同一 Session 已在运行时返回 `409`。

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

`apps/server/agent.yaml` 与其引用的 TypeScript Prompt 模块仅在 Server 启动时加载，不做运行时热更新。变更 YAML 或 Prompt 后需要重启 Server；已有 Session 在下一次 stream 执行时会自动升级，无需额外状态查询或配置更新接口。

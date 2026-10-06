# 当前产品边界

本文只描述当前仓库已经接入运行入口、可以由现有代码路径支持的能力。产品长期方向见 [vision.md](vision.md)。

## 当前运行组成

| 组件 | 当前状态 |
| --- | --- |
| Server | 可运行，负责 Record、Record Retrieval、Media、User Preference、Project、Agent Task |
| Agent Runtime | 内嵌 Server，负责 Context Runtime、Agent Session、流式执行、子 Agent 执行与工作区 |
| iOS | 客户端代码链路已实现；Google / Apple 登录、Record 读取、Project 与 Fanto 单 Session 对话均已接公网 HTTPS API |
| H5 | 可运行；提供响应式多模态 Record、语义搜索、Markdown / 媒体消息与 Fanto 多轮对话测试客户端，适配 PC / iPad / 手机 |

## Record 与 Media

当前 Server 已支持：

- 创建、读取、分页和乐观并发更新 Record；
- Record 使用 `eventAt` 表示业务发生时间；
- 图片和音频先申请上传凭据，客户端直传 OSS，再 complete；
- Record 创建 / 更新后异步执行图片理解、音频转写与向量索引；
- 图片描述和音频转写写回 Record content block；
- 按用户读取媒体，并通过短期 OSS 地址返回内容；
- Task Worker 可由 Server 直接生成 `text/plain / text/markdown / text/html` 文件、上传 OSS，并注册为 `media_type=file`。

当前 iOS 已通过 Google / Apple 原生认证换取 Fanto Access / Refresh JWT；Record 读取、Project 与 Agent Client 都已实现 Server 调用链路。iOS“新建记录”支持文字与最多 5 张图片、日期和时间选择及可选地点；地点可搜索或在地图上选点，保存地点本体、行政区与坐标，拒绝定位权限时仍可手动选点；该页面不提供录音入口。保存时先通过 `POST /api/uploads` 申请上传凭据、直传并调用 complete，再通过 `POST /api/records` 创建 Record；成功后刷新本地列表与快照。

当前 iOS 中间 Fanto Tab 通过 Agent Runtime 的 Session、History 与 SSE Stream 接口支持开发态多轮对话。它只恢复最近 10 条历史，在 Keychain 保存一个默认 Session ID；历史解码已能容忍 Pi 的结构化 message content，并重建可见文本及成功 `present_media` 的白名单媒体 metadata，同时兼容旧正文中的 `fanto-media://<mediaId>`。Assistant 文本使用原生 Markdown 渲染；图片以横向缩略图呈现并可全屏分页查看，语音可在会话中播放。iOS 只保存稳定媒体 metadata，实际展示时才读取短期签名地址。它不支持会话切换、新话题、跨设备恢复或来源引用；正式认证已经接入 Google / Apple。Agent 网关若将 HTTP 转至 HTTPS，真机联调依赖系统信任该 HTTPS 证书；客户端不接受不受信任的证书。

当前 H5 位于 `apps/h5`，覆盖测试所需的 Record、Agent 与 Task 基础能力：查看 / 创建 / 语义搜索 Record，支持文字、JPEG/PNG/WebP 图片、M4A/MP3/WAV 音频、浏览器录音、发生时间选择，以及时间线图片缩略图和音频播放；同时支持恢复一个默认 Agent Session、兼容字符串或结构化 content 的历史消息、POST SSE 流式多轮对话和新建会话。Assistant 可见文本继续使用 Markdown；新媒体展示由原生 `present_media` Tool Result 驱动。成功的 `create_task` Tool Result 会在当前 Assistant 消息中形成 Task Card，刷新历史后仍可恢复；`collect_user_input` 会形成原生澄清表单，用户提交后以同一 Session 的下一条 User Message 继续执行，并以“用户澄清”卡片展示问题与回答；刷新历史后可恢复表单、已回答状态及澄清卡片。Tasks 页面列表只展示任务标题、状态和任务类型；任务详情只展示 Goal、最新 TaskRun 持久化的 Plan、最终 summary 与 artifact，不展示 Worker Tool Trace、内部 Session 或技术执行细节。运行中的详情会轮询 TaskRun；完成产物可在域内直接预览 `text/html / text/markdown / text/plain`，HTML 使用 sandboxed `iframe srcDoc`，Markdown 复用 Fanto Markdown，产物中的内部 `fanto-media://<mediaId>` 在渲染前换取短期 OSS signed URL。Task Plan 的事实来源仅为 `task_runs.ext_data.plan`，不从 Agent Session 消息反推。旧 Session 中的 `fanto-media://<mediaId>` 仍保留兼容渲染。H5 不提供 Project 页面，也不提供正式登录。线上测试模式通过构建时 `VITE_H5_TEST_REFRESH_TOKEN` 调用 `/api/auth/tokens/refresh` 建立 Access JWT 会话，因此仍只适用于受控测试环境，refresh token 不得提交到 Git。

## Record Retrieval

Server 已经会为处理完成的 Record 构建向量索引。用户文本、图片描述和音频转写不会再拼成一个 embedding，而是分别作为 `record_text`、`image`、`audio` 原子单元独立索引；媒体单元仍保留与原 Record / mediaId 的关联。

Record postprocess 成功后把最终 processed Record 交给 `RecordRetrievalService`，由 Record domain 内的 `PostgresRecordIndex` 提供 pgvector 派生索引。独立的 Fanto Memory 尚未实现。

`POST /api/records/search` 已注册，可对当前用户 Record 做语义搜索。pgvector 查询在 SQL 层按 `user_id` 限定当前用户，并在读取 metadata 时保持用户归属校验。

Agent Runtime 已通过 Business Services 接入 `record_get`、`record_list`、`record_search` 三个只读 Record Tool，并提供 `present_media` 展示 Tool；`main` 还可以通过 `collect_user_input` 采集真正必要的用户决策，并通过 `create_task / update_task / get_task` 管理后台 Agent Task。`main` 在每次 Agent Run 前执行一次 `RecordContextProvider`，固定读取最近 10 条 Record 的缓存窗口，注入截断正文、真实 `recordId`、媒体 `mediaId` 及截断图片描述 / 音频转写，不在 Run 前执行 Query Rewrite 或向量搜索。需要主题相关历史时由主模型主动调用 `record_search`。LLM 不传 `userId`；所有业务读取身份都来自当前 Session 的 Run Context。

## User Preference

Business Server 已提供独立的 `user_preferences` 领域与 `/api/preferences` CRUD。Preference 只保存用户明确表达、未来仍适用的长期偏好，每个用户最多 20 条，并保存最近一次来源 Session、Pi 用户消息 entry、逐字 source quote 与乐观并发 version。

Fanto `main` 在每次 Run 前由 PreferenceProvider 读取当前用户 Preference 并注入 System Prompt。Agent Loop 内由主模型判断是否需要调用 `preference_manage` 创建、更新或删除 Preference；不存在独立抽取模型或后台扫描。Tool 写入后不会重新构建本轮 Prompt，下一轮自动读取新状态。

## Project

当前 Server 已支持：

- Project 列表与状态筛选；
- Project 详情；
- Project 关联 Record 的游标分页，接口直接返回完整 Record；
- `proposed -> active` 的 confirm；
- `proposed -> rejected` 的 reject。

Project 和待确认提议统一为同一实体；Project 与 Record 使用专用 `project_records` 关系表，不再使用旧的类型目录、独立提议表或通用 entity relation。当前运行入口**不会自动分析 Record 并生成 proposed Project**。

## Agent Runtime

Server 内嵌的 Agent Runtime 当前支持：

- 从 `apps/server/agent.yaml` 加载模型与 Agent 定义，Agent 通过 `model_id` 引用同级模型项，并通过受限的 TypeScript Prompt 模块构建 System Prompt；`main` 是必需的默认 Agent；
- 创建持久 Session；
- 基于同一 Session 的多轮流式执行；
- Session 历史分页；
- `create_task / update_task / get_task` Goal 模型的异步任务管理，以及 `/api/tasks` Task / TaskRun 查询与暂停、恢复、取消和 Task Artifact 域内预览；
- Task / TaskRun 持久化在 PostgreSQL，由 5 分钟 Scheduler 按 WorkerPool 可用容量调度；
- 每个 Session 使用 `AGENT_WORKSPACE_ROOT/<userId>/<sessionId>` 独立工作区；
- Pi 内置 `read`、`write`、`edit`、`bash` 工具；
- `record_get`、`record_list`、`record_search` 三个只读 Record Tool；
- `web_search` 公开网页检索 Tool，仅开放给后台 Task Worker；复用 DeepSeek Anthropic 兼容接口的服务端 Web Search，并把检索来源 URL 返回给 Worker；
- `present_media` 媒体展示 Tool；
- `preference_manage` 长期偏好管理 Tool；
- `collect_user_input` 结构化澄清 Tool；只有缺少会明显改变结果的用户决策时使用，成功调用后结束当前 Main Run 等待用户回答；
- `create_task` 后台任务 Tool；当前唯一 `task-worker` 由系统自动选择，LLM 不接触 Worker 路由、timeout、mediaId 或文件协议，`output.format` 必填，关联资料只传 `references.recordIds`；
- `update_task / get_task` 后台任务管理 Tool；
- 唯一的 `task-worker` 后台子 Agent，统一处理资料整理、文件、HTML 页面和代码工作；Worker 必须先用 `task_plan_manage(create/update)` 将用户可读 Plan 写入 `task_runs.ext_data.plan`，之后才允许 write/edit/bash/交付，并通过 `deliver_task_result` 完成最终文件交付；单个 TaskRun 最多自动尝试 3 次；
- Run 前一次性 Context Runtime（Character / Current Time / Preference / Current Tasks / Recent Records）；
- Skill 文件加载。

它不直接访问 Fanto 业务数据库；Record Tool、PreferenceProvider / Tool、`present_media` 与 Task Tool 统一通过 `business-services.ts` 调用相应领域 Service，并从当前 Run Context 获取用户身份。当前 `main` 是 Fanto 面向用户的长期对话 Agent，开启三个只读 Record Tool、`present_media`、`preference_manage`、`collect_user_input` 与 `create_task / update_task / get_task`；唯一的 `task-worker` 可读取用户 Record、在需要当前或公开事实时通过 `web_search` 查询网页、通过 `task_plan_manage` 保存执行计划、使用文件和 bash 工具，并通过 `deliver_task_result` 交付最终成品。Main 只负责理解 What / Why，Worker 自主负责 How；Task Brief 不再携带文件路径、媒体协议等执行细节。媒体展示仍以 Pi 原生 Tool Call / Tool Result 保存在 Session 中，不组装新的最终消息结构。`main` 的认识、关系原则、工具与 Markdown / Media 规则已经合并在 `apps/server/src/agent/prompts/main.ts`；每轮还会注入 Character、当前时区下的时间、偏好、当前 Task 摘要与近期记忆；相关历史由主 Agent 按需搜索。

## 当前基础设施边界

- 业务数据库使用 Supabase PostgreSQL；向量索引使用同一数据库中的 pgvector。
- Server 的 Record postprocess queue 是进程内机制，不持久化、不重试、不支持多实例恢复。
- Server 已统一使用 Fanto Access JWT 鉴权，受保护接口的用户身份来自验证后的 JWT `sub`；客户端不再通过 `x-user-id` 或 Agent 静态 Token 指定用户。
- iOS 使用 HTTPS 公网域名，并通过 Google / Apple 登录换取 Fanto Token；Server 与内嵌 Agent Runtime 共用同一认证边界。
- H5 仍属于受控测试客户端，可通过构建时测试 refresh token 建立会话；它调用 `/api/auth/tokens/refresh` 获取 Access JWT，而不是内置 Agent 静态 Token。
- Agent Runtime 使用与 Server 相同的 Bearer Token 鉴权，并使用验证后的 JWT `sub` 绑定 Session；bash 的宿主机执行仍只适合开发环境，生产环境需要真正的容器或微虚拟机隔离。

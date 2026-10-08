# 当前产品边界

本文只描述当前仓库已经接入运行入口、可以由现有代码路径支持的能力。产品长期方向见 [vision.md](vision.md)。

## 当前运行组成

| 组件 | 当前状态 |
| --- | --- |
| Server | 可运行，负责 Record、Record Retrieval、Memory、Media、Proposal / Project、Agent Task |
| Agent Runtime | 内嵌 Server，负责 Context Runtime、Agent Session、流式执行、子 Agent 执行与工作区 |
| iOS | 客户端代码链路已实现；Google / Apple 登录、Record 读取、Project 与 Fanto 单 Session 对话均已接公网 HTTPS API |
| H5 | 可运行；提供响应式多模态 Record、语义搜索、Markdown / 媒体消息与 Fanto 多轮对话测试客户端，适配 PC / iPad / 手机 |

## Record 与 Media

当前 Server 已支持：

- 创建、读取、分页、乐观并发更新与删除 Record；独占媒体资产随记录移除，OSS 清理可持久重试，已有成果直接引用的资源保留；
- Record 使用 `eventAt` 表示业务发生时间；
- 图片和音频先申请上传凭据，客户端直传 OSS，再 complete；
- Record 创建 / 更新后异步执行图片理解、音频转写与向量索引；
- 图片描述和音频转写写回 Record content block；
- 按用户读取媒体，并通过短期 OSS 地址返回内容；
- Task Worker 可由 Server 直接生成 `text/plain / text/markdown / text/html` 文件、上传 OSS，并注册为 `media_type=file`。

当前 iOS 已通过 Google / Apple 原生认证换取 Fanto Access / Refresh JWT；Record 读取、Project 与 Agent Client 都已实现 Server 调用链路。iOS“新建记录”支持文字与最多 5 张图片、日期和时间选择及可选地点；地点可搜索或在地图上选点，保存地点本体、行政区与坐标，拒绝定位权限时仍可手动选点；该页面不提供录音入口。保存时先通过 `POST /api/uploads` 申请上传凭据、直传并调用 complete，再通过 `POST /api/records` 创建 Record；成功后刷新本地列表与快照。日历和时间线支持长按确认删除 Record，成功后同步本地列表与快照。

当前 iOS 中间 Fanto Tab 通过 Agent Runtime 的 Session、History 与 SSE Stream 接口支持开发态多轮对话。它只恢复最近 10 条历史，在 Keychain 保存一个默认 Session ID；历史解码已能容忍 Pi 的结构化 message content，并重建可见文本及成功 `present_media` 的白名单媒体 metadata，同时兼容旧正文中的 `fanto-media://<mediaId>`。Assistant 文本使用原生 Markdown 渲染；图片以横向缩略图呈现并可全屏分页查看，语音可在会话中播放。iOS 只保存稳定媒体 metadata，实际展示时才读取短期签名地址。它不支持会话切换、新话题、跨设备恢复或来源引用；正式认证已经接入 Google / Apple。Agent 网关若将 HTTP 转至 HTTPS，真机联调依赖系统信任该 HTTPS 证书；客户端不接受不受信任的证书。

当前 H5 位于 `apps/h5`，覆盖测试所需的 Record、Agent 与 Task 基础能力：查看 / 创建 / 语义搜索 Record，支持文字、JPEG/PNG/WebP 图片、M4A/MP3/WAV 音频、浏览器录音、发生时间选择，以及时间线图片缩略图和音频播放；同时支持恢复一个默认 Agent Session、兼容字符串或结构化 content 的历史消息、POST SSE 流式多轮对话和新建会话。Assistant 可见文本继续使用 Markdown；新媒体展示由原生 `present_media` Tool Result 驱动。成功的 `create_task` Tool Result 会在当前 Assistant 消息中形成 Task Card，刷新历史后仍可恢复；`collect_user_input` 会形成原生澄清表单，用户提交后以同一 Session 的下一条 User Message 继续执行，并以“用户澄清”卡片展示问题与回答；刷新历史后可恢复表单、已回答状态及澄清卡片。Tasks 页面列表只展示任务标题、状态和任务类型；任务详情只展示 Goal、最新 TaskRun 持久化的 Plan、最终 summary 与 artifact，不展示 Worker Tool Trace、内部 Session 或技术执行细节。运行中的详情会轮询 TaskRun；完成产物可在域内直接预览 `text/html / text/markdown / text/plain`，HTML 使用 sandboxed `iframe srcDoc`，Markdown 复用 Fanto Markdown，产物中的内部 `fanto-media://<mediaId>` 在渲染前换取短期 OSS signed URL。Task Plan 的事实来源仅为 `task_runs.ext_data.plan`，不从 Agent Session 消息反推。旧 Session 中的 `fanto-media://<mediaId>` 仍保留兼容渲染。H5 不提供 Project 页面，也不提供正式登录。线上测试模式通过构建时 `VITE_H5_TEST_REFRESH_TOKEN` 调用 `/api/auth/tokens/refresh` 建立 Access JWT 会话，因此仍只适用于受控测试环境，refresh token 不得提交到 Git。

## Record Retrieval

Server 会为处理完成的 Record 构建一个整体向量。用户正文、地点和图片 description 按固定顺序组成完整文本后生成 `records.embedding`；一条 Record 只有一个向量，不进行 chunk 或媒体级单元索引。

Record postprocess 成功后把最终 processed Record 交给 `RecordRetrievalService`，由 Record domain 内的 `PostgresRecordRepository` 写入 `records.embedding`。

`POST /api/records/search` 已注册，可对当前用户 Record 做语义搜索。pgvector 查询在 SQL 层按 `user_id` 限定当前用户，并在读取 metadata 时保持用户归属校验。

Agent Runtime 已通过 Business Services 接入唯一的只读 Record Tool `record_read`，并提供 `present_media` 展示 Tool；`record_read(recordIds)` 读取已知的完整 Record，`record_read(query)` 语义检索后返回最多 3 条完整 Record。`main` 还可以通过 `collect_user_input` 采集真正必要的用户决策，并通过 `create_task / update_task / get_task` 管理后台 Agent Task。`main` 在每次 Agent Run 前执行一次 `RecordContextProvider`，固定读取最近 10 条 Record 的缓存窗口，注入截断正文、真实 `recordId`、媒体 `mediaId` 及截断图片描述 / 音频转写，不在 Run 前执行 Query Rewrite 或向量搜索。LLM 不传 `userId`；所有业务读取身份都来自当前 Session 的 Run Context。

## Memory

Server 已提供独立于 Record 的 Fanto Memory。`memories` 是用户隔离的业务表，保存 `profile`（稳定背景或习惯）、`goal`（长期目标或进行中事项）和 `guidance`（长期沟通或协作方式）三种纯文本记忆，并在创建、更新时同步写入 768 维 pgvector。Memory 不从 Record 或对话自动提取。

主 Agent 只通过 `memory_manage` 管理和检索 Memory。每轮自动注入全部 `guidance`；`profile` 和 `goal` 由主模型在当前问题确实需要时通过语义搜索查询。用户必须明确提出记住、修改或遗忘，模型才可以写入、更新或删除。

## Proposal / Project

Project summary 在创建、更新时同步生成 768 维向量；proposal-agent 使用 project_read(search) 检索同用户 active 项目，再通过 get 核对候选以提出延续建议。summary 描述真实来源、主体、主题与成果边界，创作发布时与实际成果同步校正。

Server 支持独立 Proposal 的查询、参考记录分页与接受 / 拒绝，以及 Project 摘要列表、详情、版本保护更新和单向归档。接受 create 建立项目，接受 extend 为同用户 active 项目添加去重后的参考记录。Project 保存 summary 和 Markdown 当前成果，图片二进制存 OSS；详见 [Domain](../domain/projects.md)。

iOS 已改用 Proposal 接口展示建议、计划和参考记录，接受后刷新项目；项目详情展示图文成果、静态 HTML 预览和参考记录摘要。没有外部创建提议接口；启用 Creative Runtime 后自动分析记录，并在用户接受支持的创作提议后生成图文成果。

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
- `record_read` 唯一的只读 Record Tool，支持按真实 `recordIds` 读取，或按 `query` 检索后返回完整 Record；
- `memory_manage` 唯一的 Memory Tool，提供 list / search / create / update / delete action；
- `web_search` 公开网页检索 Tool，仅开放给后台 Task Worker；复用 DeepSeek Anthropic 兼容接口的服务端 Web Search，并把检索来源 URL 返回给 Worker；
- `present_media` 媒体展示 Tool；
- `collect_user_input` 结构化澄清 Tool；只有缺少会明显改变结果的用户决策时使用，成功调用后结束当前 Main Run 等待用户回答；
- `create_task` 后台任务 Tool；当前唯一 `task-worker` 由系统自动选择，LLM 不接触 Worker 路由、timeout、mediaId 或文件协议，`output.format` 必填，关联资料只传 `references.recordIds`；
- `update_task / get_task` 后台任务管理 Tool；
- 唯一的 `task-worker` 后台子 Agent，统一处理资料整理、文件、HTML 页面和代码工作；Worker 必须先用 `task_plan_manage(create/update)` 将用户可读 Plan 写入 `task_runs.ext_data.plan`，之后才允许 write/edit/bash/交付，并通过 `deliver_task_result` 完成最终文件交付；单个 TaskRun 最多自动尝试 3 次；
- Run 前一次性 Context Runtime（Character / Current Time / Current Tasks / 已保存 guidance / Recent Records）；
- Skill 文件加载。

它不直接访问 Fanto 业务数据库；Record、Memory、`present_media` 与 Task Tool 统一通过 `business-services.ts` 调用相应领域 Service，并从当前 Run Context 获取用户身份。当前 `main` 是 Fanto 面向用户的长期对话 Agent，开启唯一的 `record_read`、`memory_manage`、`present_media`、`collect_user_input` 与 `create_task / update_task / get_task`；唯一的 `task-worker` 可读取用户 Record、在需要当前或公开事实时通过 `web_search` 查询网页、通过 `task_plan_manage` 保存执行计划、使用文件和 bash 工具，并通过 `deliver_task_result` 交付最终成品。Main 只负责理解 What / Why，Worker 自主负责 How；Task Brief 不再携带文件路径、媒体协议等执行细节。媒体展示仍以 Pi 原生 Tool Call / Tool Result 保存在 Session 中，不组装新的最终消息结构。`main` 的认识、关系原则、工具与 Markdown / Media 规则已经合并在 `apps/server/src/agent/prompts/main.ts`；每轮还会注入 Character、当前时区下的时间、当前 Task 摘要、已保存 guidance 与近期记录；相关历史由主 Agent 按需搜索。

## 当前基础设施边界

- 业务数据库使用 Supabase PostgreSQL；向量索引使用同一数据库中的 pgvector。
- Server 的 Record postprocess queue 是进程内机制，不持久化、不重试、不支持多实例恢复。
- Server 已统一使用 Fanto Access JWT 鉴权，受保护接口的用户身份来自验证后的 JWT `sub`；客户端不再通过 `x-user-id` 或 Agent 静态 Token 指定用户。
- iOS 使用 HTTPS 公网域名，并通过 Google / Apple 登录换取 Fanto Token；Server 与内嵌 Agent Runtime 共用同一认证边界。
- H5 仍属于受控测试客户端，可通过构建时测试 refresh token 建立会话；它调用 `/api/auth/tokens/refresh` 获取 Access JWT，而不是内置 Agent 静态 Token。
- Agent Runtime 使用与 Server 相同的 Bearer Token 鉴权，并使用验证后的 JWT `sub` 绑定 Session；bash 的宿主机执行仍只适合开发环境，生产环境需要真正的容器或微虚拟机隔离。

启用 Creative Runtime 后，新 Record 自动经过价值、创意与已有项目关联判断，产生可接受 / 拒绝的 Proposal；缺少必要信息或主体不明确时静默不提议，不询问用户。当前执行范围是角色扮演图文：用户接受后编辑原图、保存 ready Media，并发布 Markdown Project 成果；extend 在保留已有正文的基础上追加。其他风格、写真集、纪念册和 Three.js 等尚不作为独立执行意图。运行与恢复边界见 [创作运行](../architecture/creative-runtime.md)。

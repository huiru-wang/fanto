# 当前产品边界

本文只描述当前仓库已经接入运行入口、可以由现有代码路径支持的能力。产品长期方向见 [vision.md](vision.md)。

## 当前运行组成

| 组件 | 当前状态 |
| --- | --- |
| Server | 可运行，负责 Record、Media、Memory / Retrieval、Creation / Proposal |
| Agent Runtime | 可独立运行，负责 Agent Session、流式执行、异步任务与工作区 |
| iOS | 客户端代码链路已实现；Record 读取、Creation / Proposal 与 Fanto 单 Session 对话均已接 API，但当前硬编码演示用户与 Server / Agent 公网 allowlist 不一致 |
| H5 | 可运行；提供响应式多模态 Record、语义搜索、Markdown / 媒体消息与 Fanto 多轮对话测试客户端，适配 PC / iPad / 手机 |

## Record 与 Media

当前 Server 已支持：

- 创建、读取、分页和乐观并发更新 Record；
- Record 使用 `eventAt` 表示业务发生时间；
- 图片和音频先申请上传凭据，客户端直传 OSS，再 complete；
- Record 创建 / 更新后异步执行图片理解、音频转写与向量索引；
- 图片描述和音频转写写回 Record content block；
- 按用户读取媒体，并通过短期 OSS 地址返回内容。

当前 iOS 的 Record 读取、Creation / Proposal 与 Agent Client 都已实现 Server 调用链路，但客户端仍硬编码 `creation-demo-user`，而当前 Server / Agent 主运行入口只允许 `default-user`，因此在当前公网部署配置下这些请求会被 401 拒绝。除此之外，“新建记录”仍只写入本地 Store，没有调用 Server 创建接口；媒体上传也没有在 iOS 端形成完整写入链路。

当前 iOS 中间 Fanto Tab 通过 Agent Runtime 的 Session、History 与 SSE Stream 接口支持开发态文本多轮对话。它只恢复最近 10 条历史，在 Keychain 保存一个默认 Session ID，不支持会话切换、新话题、跨设备恢复、Markdown 富文本、媒体、来源引用、Tool 产品效果或正式认证。Agent 网关若将 HTTP 转至 HTTPS，真机联调依赖系统信任该 HTTPS 证书；客户端不接受不受信任的证书。

当前 H5 位于 `apps/h5`，覆盖测试所需的 Record 与 Agent 基础能力：查看 / 创建 / 语义搜索 Record，支持文字、JPEG/PNG/WebP 图片、M4A/MP3/WAV 音频、浏览器录音、发生时间选择，以及时间线图片缩略图和音频播放；同时支持恢复一个默认 Agent Session、兼容字符串或结构化 content 的历史消息、POST SSE 流式多轮对话和新建会话。Assistant 消息使用 Markdown 渲染，并将 `fanto-media://<mediaId>` 图片引用解析为经过 Server 鉴权的短期 OSS 地址。H5 不提供 Creation / Proposal 页面，也不提供正式登录。测试客户端固定使用 `default-user`，Agent Bearer Token 被直接编译进 H5 bundle，因此只适用于受控测试环境。

## Memory / Retrieval

Server 已经会为处理完成的 Record 构建向量索引。用户文本、图片描述和音频转写不会再拼成一个 embedding，而是分别作为 `record_text`、`image`、`audio` 原子单元独立索引；媒体单元仍保留与原 Record / mediaId 的关联。

当前 Server 已形成独立的 Memory Domain 边界：Record postprocess 成功后把最终 processed Record 交给 `MemoryService`，sqlite-vec 通过 `MemoryIndex` adapter 提供派生索引。

`POST /api/records/search` 已注册，可对当前用户 Record 做语义搜索。sqlite-vec 使用 `user_id partition key`，KNN candidate generation 本身限定当前用户，并在读取 metadata 时再次校验用户归属。

Agent Runtime 已通过 Business Server HTTP 接入 `record_get`、`record_list`、`record_search` 三个只读工具；LLM 不传 `userId`，用户身份来自当前 Session 的 Run Context。

## Creation / Proposal

当前 Server 已支持：

- Creation 类型目录；
- active Creation 概览；
- Creation 列表与按类型筛选；
- Creation 详情与来源 Record 分页；
- 待确认 Proposal 列表与详情；
- Proposal “长期跟踪 / 暂不保留”决策；
- 确认 Proposal 时创建或更新 Creation，并迁移来源关系。

当前运行入口**不会自动分析 Record 并生成 Proposal**。Proposal 的自动生成、Creation 的自动持续更新仍未接入。

## Agent Runtime

独立 Agent 服务当前支持：

- 从 `apps/agent/agents.yaml` 加载 Agent 定义，并支持通过 `systemPromptFile` 加载独立 Prompt 文件；
- 创建持久 Session；
- 基于同一 Session 的多轮流式执行；
- Session 历史分页；
- 异步任务提交和查询；
- 每个 Session 独立工作区；
- Pi 内置 `read`、`write`、`edit`、`bash` 工具；
- `record_get`、`record_list`、`record_search` 三个只读 Record Tool；
- Skill 文件加载。

它不直接访问 Fanto 业务数据库；Record Tool 统一通过 `FantoServerClient` 调用 Business Server，并从当前 Run Context 获取用户身份。当前 `main` 是 Fanto 面向用户的长期对话 Agent，开启三个只读 Record Tool；`coding` 默认不具备个人历史访问能力。`main` 通过 `apps/agent/prompts/fanto.md` 约束长期记忆真实性、工具隐身、对话语气以及 Markdown / Media 表达。

## 当前基础设施边界

- 业务数据库使用 SQLite；向量索引使用同一数据库中的 sqlite-vec。
- Server 的 Record postprocess queue 是进程内机制，不持久化、不重试、不支持多实例恢复。
- Server 的 `x-user-id` 仍不是正式认证；当前运行入口额外只允许 `default-user`，用于公网测试期收紧访问范围。
- iOS 当前仍硬编码 HTTP ECS 地址和 `creation-demo-user`；该用户与当前公网 Server / Agent 的 `default-user` allowlist 不一致，尚不能直接用于当前公网链路。
- H5 固定使用 `default-user` 并内置测试 Agent Token；Token 对能访问前端 bundle 的用户可见，因此该方式只用于测试。
- Agent Runtime 使用 Bearer Token + `X-User-Id`，当前运行入口同样只允许 `default-user`；bash 的宿主机执行仍只适合开发环境，生产环境需要真正的容器或微虚拟机隔离。

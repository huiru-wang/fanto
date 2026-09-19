# 当前产品边界

本文只描述当前仓库已经接入运行入口、可以由现有代码路径支持的能力。产品长期方向见 [vision.md](vision.md)。

## 当前运行组成

| 组件 | 当前状态 |
| --- | --- |
| Server | 可运行，负责 Record、Media、Memory / Retrieval、Creation / Proposal |
| Agent Runtime | 可独立运行，负责 Agent Session、流式执行、异步任务与工作区 |
| iOS | 可运行；Record 读取、Creation / Proposal 主要链路已接 Server |
| H5 | 当前仓库不存在可运行产品工程 |

## Record 与 Media

当前 Server 已支持：

- 创建、读取、分页和乐观并发更新 Record；
- Record 使用 `eventAt` 表示业务发生时间；
- 图片和音频先申请上传凭据，客户端直传 OSS，再 complete；
- Record 创建 / 更新后异步执行图片理解、音频转写与向量索引；
- 图片描述和音频转写写回 Record content block；
- 按用户读取媒体，并通过短期 OSS 地址返回内容。

当前 iOS 已从 Server 读取 Record 列表并用于日历 / Timeline，但“新建记录”仍只写入本地 Store，没有调用 Server 创建接口；媒体上传也没有在 iOS 端形成完整写入链路。

## Memory / Retrieval

Server 已经会为处理完成的 Record 构建向量索引，索引文本包含：

- 用户文本；
- 已生成的图片描述；
- 已生成的音频转写。

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

- 从 `apps/agent/agents.yaml` 加载 Agent 定义；
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
- Server 的 `x-user-id` 是开发期用户隔离，不是正式认证。
- iOS 当前仍硬编码 HTTP ECS 地址和演示用户。
- Agent Runtime 使用 Bearer Token + `X-User-Id`，但 bash 的宿主机执行仍只适合开发环境；生产环境需要真正的容器或微虚拟机隔离。

# 当前产品边界

本文只描述当前仓库已经接入运行入口、可以由现有代码路径支持的能力。产品长期方向见 [vision.md](vision.md)。

## 当前运行组成

| 组件 | 当前状态 |
| --- | --- |
| Server | 可运行，负责 Record、Media、Creation / Proposal 与 Record 向量索引 |
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

当前 `RecordMemoryService` 已有内部语义搜索能力，但业务 Server 尚未注册 Record Search HTTP API，Agent Runtime 也尚未接入 Record 业务工具。

当前搜索实现仍是全局 KNN 候选后再按 `user_id` 过滤，不应把它视为最终的多用户检索边界。详见 [../domain/memory.md](../domain/memory.md)。

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
- Skill 文件加载。

它当前不直接访问 Fanto 业务数据库，也没有 `record_get`、`record_list`、`record_search` 等业务 Tool。

## 当前基础设施边界

- 业务数据库使用 SQLite；向量索引使用同一数据库中的 sqlite-vec。
- Server 的 Record postprocess queue 是进程内机制，不持久化、不重试、不支持多实例恢复。
- Server 的 `x-user-id` 是开发期用户隔离，不是正式认证。
- iOS 当前仍硬编码 HTTP ECS 地址和演示用户。
- Agent Runtime 使用 Bearer Token + `X-User-Id`，但 bash 的宿主机执行仍只适合开发环境；生产环境需要真正的容器或微虚拟机隔离。

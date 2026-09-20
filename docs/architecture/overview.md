# 系统架构总览

## 当前运行组件

```mermaid
flowchart LR
  IOS[iOS / SwiftUI] -->|HTTP| S[Business Server / Hono]
  H5[H5 / React + Vite] -->|HTTPS / Nginx| S
  H5 -->|HTTPS / Nginx| AR[Agent Runtime / Hono + Pi]
  S --> DB[(fanto.sqlite)]
  S --> OSS[Aliyun OSS]
  S --> VL[Vision Model]
  S --> ASR[ASR Model]
  S --> EMB[Embedding API]

  AR --> ADB[(agent-sessions.sqlite)]
  AR --> WS[Session Workspaces]
  AR -->|Record Tools / HTTP| S
```

Fanto 当前有两个独立后端服务，并有 iOS 与 H5 两类客户端入口：

1. **Business Server**：Record、Media、Memory / Retrieval、Creation / Proposal 的业务运行时。
2. **Agent Runtime**：Agent 定义、Session、流式执行、异步任务、工作区、Pi 内置工具、只读 Record Tool 与媒体展示 Tool 的独立运行时。

两个后端服务没有共享数据库。Agent Runtime 当前只通过 `FantoServerClient` 使用 Business Server 的 Record HTTP API 和 user-scoped Media metadata API；业务数据仍由 Business Server 负责用户隔离与访问。H5 生产构建由 Nginx 提供静态文件，并把 `/api/*` 转发到 Business Server、`/api/agent/*` 转发到 Agent Runtime。

## 业务数据边界

Business Server 使用一个 SQLite 数据库保存：

- users；
- records；
- media_assets；
- vector_items + sqlite-vec `record_vectors`；
- creation_kinds；
- creations；
- creation_proposals；
- entity_relations。

其中 Record、Media、Creation / Proposal 等业务表是业务事实；Record 向量索引是可重建的派生数据。

Agent Runtime 使用独立 SQLite 保存 Pi Session 与 Agent Task，并在 `AGENT_WORKSPACE_ROOT/<sessionId>` 为每个 Session 创建独立工作区。

## 用户边界

Business Server 除 `GET /health` 外要求 `x-user-id`，当前它只承担开发阶段的用户隔离，不是正式认证。

Agent Runtime 除健康检查外使用 Bearer Token，并要求 `X-User-Id`；Session 归属会持久化在 Pi Session custom entry 中。

## 当前可靠性边界

- Business Server 的 Record 后置任务通过进程内 EventEmitter 触发，不持久化、不自动重试。
- Agent 异步任务有 SQLite 状态，但 Runner 当前按单实例设计；服务重启时遗留的 running task 会失败而不是自动重放。
- iOS 当前访问固定 HTTP ECS 地址且仍使用演示用户；该用户与当前公网 allowlist 不一致，尚未形成可直接使用的公网链路，也未具备正式认证和生产级服务发现。
- H5 当前固定使用 `default-user` 并内置测试 Agent Token，只适用于受控测试环境。

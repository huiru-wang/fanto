# Fanto

Fanto 是一个建立在长期个人记录之上的陪伴型个人智能。用户只负责自然记录文字、图片和音频，Fanto 负责在需要时重新找到过去的信息、连接跨时间的线索，并以可追溯、克制的方式提供回应和发现。

> 默认安静，长期记得，偶尔有用。

## 当前仓库

Fanto 目前处于 MVP 阶段，仓库包含：

- `apps/server`：Hono + TypeScript 业务服务，负责 Record、Media、Creation / Proposal 与 Record 向量索引。
- `apps/agent`：独立的 Pi `AgentHarness` 服务，负责 Agent Session、流式执行、异步任务、工作区与内置工具。
- `apps/ios/fanto`：SwiftUI iOS 客户端，已实现 Record 读取、Creation / Proposal 主要链路与 Fanto 单 Session 对话代码；当前演示用户与公网 allowlist 尚未对齐。
- `apps/h5`：React + Vite 响应式测试客户端，支持多模态 Record、语义搜索、Fanto 多轮对话、Markdown 与媒体消息渲染。
- `packages/shared`：TypeScript 共享 API / Record 类型。

## 快速启动

安装依赖并启动业务服务：

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm db:migrate
pnpm dev:server
```

默认业务服务地址为 `http://127.0.0.1:3000`，健康检查：

```bash
curl http://127.0.0.1:3000/health
```

Agent 服务独立运行，启动方式见 [apps/agent/README.md](apps/agent/README.md)。

常用验证：

```bash
pnpm typecheck
pnpm test
```

## 文档

从 [docs/README.md](docs/README.md) 开始阅读。

- [产品愿景](docs/product/vision.md)
- [当前产品边界](docs/product/current-scope.md)
- [系统架构](docs/architecture/overview.md)
- [HTTP API](docs/api/http-api.md)
- [本地开发](docs/engineering/local-development.md)

项目协作与 AI Coding 规则见 [AGENTS.md](AGENTS.md)。

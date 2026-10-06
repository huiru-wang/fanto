# Fanto

Fanto 是一个建立在长期个人记录之上的陪伴型个人智能。用户只负责自然记录文字、图片和音频，Fanto 负责在需要时重新找到过去的信息、连接跨时间的线索，并以可追溯、克制的方式提供回应和发现。

> 默认安静，长期记得，偶尔有用。

## 当前仓库

Fanto 目前处于 MVP 阶段，仓库包含：

- `apps/server`：Hono + TypeScript 服务，负责业务领域，以及内嵌的 Pi Agent Runtime（Session、流式执行、工作区与内置工具）。
- `apps/ios/fanto`：SwiftUI iOS 客户端，已接入 Google / Apple 登录、Record 读写、Project 浏览与决策，以及 Fanto 单 Session 对话。
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

Agent API 由同一个 Server 进程提供在 `/api/agent/*`；配置入口为 `apps/server/agent.yaml`。

生产服务器首次完整发布（Server、内嵌 Agent Runtime、H5 与 Nginx）使用：

```bash
pnpm deploy:nginx
```

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

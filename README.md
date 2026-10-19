# Fanto

Fanto 是以**角色扮演与深度陪伴对话**为主线的 AI 产品：通过可设定的角色、连续的对话和长期记忆，让相处逐渐形成独属于用户的上下文。记录是可选的生活与回忆入口。

> 角色有延续，相处有记忆。

## 仓库组成

- `apps/server`：Hono / TypeScript 服务，内嵌 Pi Agent Runtime、Record/Media/Memory、Proposal/Project 和进程内异步创作。
- `apps/ios/fanto`：SwiftUI，Google/Apple 登录、Fanto 角色设置与对话、Record 日历与时间线、用户资料与外观偏好；脉络入口暂时隐藏，相关模块保留。
- `apps/h5`：React/Vite 受控测试客户端，Record、多轮对话、Proposal / Project 及作品预览。
- `apps/admin-web`：仅本地运行的只读管理界面，查询用户、Session 和 Token 用量，不参与部署。
- `packages/shared`：跨端类型和 Record 相关共享定义。

Agent 会话在单进程内存运行，稳定历史异步尽力保存；数据库保存不阻塞回复，重启可能丢失最近消息。Main Chat 与 Project Chat **共用一套 Agent 多轮协议**：`POST /api/agent/stream`、`GET /api/agent/sessions/:id/history` 和只读 `GET /api/agent/sessions/:id/events`。首次 Creator 创作通过非持久化后台执行队列启动，继续创作使用绑定的 Creator Session；没有 Project 专属聊天 API。

## 本地运行

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
# 设置 PostgreSQL、JWT、模型和 OSS 的必要配置
pnpm db:migrate
pnpm dev:server
```

服务默认在 `http://127.0.0.1:3000`，通过 `curl http://127.0.0.1:3000/health` 检查服务及数据库可用性。`apps/server/agent.yaml` 配置 Agent、Prompt 模块、Skill 和工具。可单独使用 `pnpm dev:h5` 启动 H5 测试前端，或按 [Admin Web 指南](apps/admin-web/README.md) 使用 `pnpm dev:admin` 启动管理界面。

```bash
pnpm typecheck
pnpm test
pnpm deploy          # 已配置环境中的应用更新
pnpm deploy:nginx    # 初次完整发布或 Nginx 配置更新
```

创作自动提议/执行由 `CREATIVE_ENABLED=true` 控制；需要有效模型与所选存储的凭据（阿里云 OSS / Cloudflare R2），配置见 [服务端配置](docs/engineering/configuration.md#对象存储选择)。后台内存队列不提供消息持久化或重启恢复，不能视为可靠任务队列。

## 文档

从 [文档索引](docs/README.md) 开始。重点为 [当前产品范围](docs/product/current-scope.md)、[架构总览](docs/architecture/overview.md)、[创作执行](docs/architecture/creative-runtime.md)、[HTTP API](docs/api/http-api.md)、[本地开发](docs/engineering/local-development.md) 和 [配置](docs/engineering/configuration.md)。

协作与 AI Coding 规则见 [AGENTS.md](AGENTS.md)，模块约束见对应局部 `AGENTS.md`。

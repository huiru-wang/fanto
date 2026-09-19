# 本地开发

## 前置条件

- Node.js；Agent package 要求 Node.js 22.19+。
- pnpm 10.11.0。
- 需要媒体理解、转写或向量索引时，准备 OSS、DashScope 与 Embedding 凭据。
- iOS 客户端使用 Xcode / SwiftUI。
- H5 使用 React + Vite。

## Business Server

在仓库根目录：

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm db:migrate
pnpm dev:server
```

默认监听 `0.0.0.0:3000`：

```bash
curl http://127.0.0.1:3000/health
```

启动时 Server 也会执行当前 migration 基线，并确保存在 `default-user`。

## Agent Runtime

```bash
cp apps/agent/.env.example apps/agent/.env
# 配置 AGENT_TOKEN 与模型密钥
pnpm --filter @fanto/agent dev
```

默认监听 3001。完整调用流程见 [apps/agent/README.md](../../apps/agent/README.md)。

## H5

先启动 Business Server 与 Agent Runtime，再在仓库根目录运行：

```bash
pnpm dev:h5
```

H5 开发服务器会把 `/api/agent/*` 代理到 `127.0.0.1:3001`，其余 `/api/*` 代理到 `127.0.0.1:3000`。图片和音频上传仍走 Server 返回的 OSS 签名 URL，由浏览器直接 PUT；用于 H5 的 OSS Bucket CORS 需要允许当前 H5 Origin、`PUT` 方法和 `Content-Type` Header。生产构建：

```bash
pnpm build:h5
```

手工部署环境可运行 `deploy/manual/publish-h5.sh`，将构建产物同步到 `/var/www/fanto-h5`；配套 Nginx 配置会从该目录提供 SPA。

## 数据文件

默认开发数据位于根目录 `data/`：

```text
data/
├── fanto.sqlite
├── agent-sessions.sqlite
└── workspaces/
```

Business Server 与 Agent Runtime 是两个独立运行时，不共享 Session 数据库。

## Schema 重置

Server migration 当前只支持空库基线，不是历史 upgrade chain。需要使用新 schema 重建本地业务库时，应停止服务并明确确认数据可丢弃后，再删除 `SQLITE_PATH` 对应 SQLite 及其 `-wal` / `-shm` 文件并重新执行 migration。

不要因为 migration 是“当前基线”就自动删除用户真实数据库。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm db:migrate
pnpm memory:rebuild
# 兼容别名
pnpm vector:rebuild

pnpm --filter @fanto/server seed:creation-showcase
```

`memory:rebuild` 会 reset 可重建的 Memory 派生索引，并按批次重新索引所有用户当前为 `processed` 的 Records；执行前应确认 Embedding 配置可用。它不会删除 Record / Media / Creation 等业务表。

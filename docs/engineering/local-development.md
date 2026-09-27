# 本地开发

## 前置条件

- Node.js；Agent package 要求 Node.js 22.19+。
- pnpm 10.11.0。
- 需要媒体理解、转写或向量索引时，准备 OSS、DashScope 与 Embedding 凭据。
- Business Server 还需要可创建 `vector` extension 的 Supabase PostgreSQL 数据库及 `DATABASE_URL`。
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

启动时 Server 会执行当前空库 migration 基线。用户通过正式注册流程创建，不再自动创建演示用户。

## Agent Runtime

```bash
cp apps/agent/.env.example apps/agent/.env
# 配置 AUTH_JWT_PUBLIC_KEYS、AUTH_JWT_ISSUER 与模型密钥
pnpm --filter @fanto/agent dev
```

默认监听 3001。完整调用流程见 [apps/agent/README.md](../../apps/agent/README.md)。

## H5

先启动 Business Server 与 Agent Runtime，再在仓库根目录运行：

```bash
pnpm dev:h5
```

H5 开发服务器会把 `/api/agent/*` 代理到 `127.0.0.1:3001`，其余 `/api/*` 代理到 `127.0.0.1:3000`。图片和音频上传仍走 Server 返回的 OSS 签名 URL，由浏览器直接 PUT；用于 H5 的 OSS Bucket CORS 需要允许当前 H5 Origin、`PUT` 方法和 `Content-Type` Header。生产构建：

线上 H5 测试认证使用 `apps/h5/.env` 中的 `VITE_H5_TEST_AUTH=true` 与 `VITE_H5_TEST_REFRESH_TOKEN`；可从 `apps/h5/.env.example` 复制模板。该 refresh token 必须由 Server 为 active 测试用户签发，且不得提交到 Git。

```bash
pnpm build:h5
```

生产部署统一使用 `pnpm deploy`。脚本会校验 Server 与 Agent 的 `.env`、安装依赖、预构建 H5、使用 Server 的 `.env` 执行 PostgreSQL migration、重启 Server/Agent、发布 H5，并检查 3000/3001 的 `/health`。日常发布不会修改 Nginx；只有首次部署或 Nginx 配置发生变化时使用 `pnpm deploy:nginx`，它会在校验通过后覆盖 `/etc/nginx/nginx.conf` 并 reload。H5 默认发布到 `/var/www/fanto-h5`，可用 `H5_DEPLOY_DIR` 覆盖。底层 `start.sh` / `stop.sh` / `restart.sh` 仍保留用于单服务运维。

## 数据文件

Agent 开发数据位于根目录 `data/`：

```text
data/
├── agent-sessions.sqlite
└── workspaces/
```

Business Server 使用 Supabase PostgreSQL；Agent Runtime 保持 SQLite，不共享业务数据库。

## Schema 重置

Server migration 当前只支持空 PostgreSQL schema 基线，不是历史 upgrade chain。需要使用新 schema 重建目标数据库时，应停止 Server、确认目标库数据可丢弃后重建目标 schema，再执行 migration。

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

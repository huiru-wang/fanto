# 本地开发

## 前置条件

- Node.js 22.19+。
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

`/health` 会实际检查 PostgreSQL；数据库不可用时返回 503，当前没有独立 `/ready`。生产进程还会每 10 秒执行数据库健康检查，连续 3 次失败后主动退出，由 PM2 拉起新进程。

启动时 Server 会执行当前空库 migration 基线。用户通过正式注册流程创建，不再自动创建演示用户。

## Agent Runtime

Agent Runtime 已内嵌在 Business Server，不单独启动。首次启动前在 `apps/server/.env` 配置 `DEEPSEEK_API_KEY`；模型、Agent 与 Tool 定义位于 `apps/server/agent.yaml`，Prompt 位于 `apps/server/src/agent/prompts/`。

## H5

先启动 Business Server（其中已包含 Agent Runtime），再在仓库根目录运行：

```bash
pnpm dev:h5
```

H5 开发服务器会把 `/api/*`（包括 `/api/agent/*`）代理到 `127.0.0.1:3000`。图片和音频上传仍走 Server 返回的 OSS 签名 URL，由浏览器直接 PUT；用于 H5 的 OSS Bucket CORS 需要允许当前 H5 Origin、`PUT` 方法和 `Content-Type` Header。生产构建：

线上 H5 测试认证使用 `apps/h5/.env` 中的 `VITE_H5_TEST_AUTH=true` 与 `VITE_H5_TEST_REFRESH_TOKEN`；可从 `apps/h5/.env.example` 复制模板。该 refresh token 必须由 Server 为 active 测试用户签发，且不得提交到 Git。

```bash
pnpm build:h5
```

生产部署统一使用 `pnpm deploy`。脚本会校验 Server `.env`、`DEEPSEEK_API_KEY` 和 Agent 配置文件，安装依赖、预构建 H5、使用 Server 的 `.env` 执行 PostgreSQL migration、重启 Server（包括内嵌 Agent Runtime）、发布 H5，并检查 `3000` 的 `/health`。服务器首次完整启动或 Nginx 配置发生变化时使用一条命令 `pnpm deploy:nginx`；它会在同一流程中覆盖 `/etc/nginx/nginx.conf`、校验并 reload Nginx，再检查本机 HTTPS `/health`。H5 默认发布到 `/var/www/fanto-h5`，可用 `H5_DEPLOY_DIR` 覆盖。底层 `start.sh` / `stop.sh` / `restart.sh` 仍保留用于单服务运维。

## 数据文件

Agent 开发数据位于根目录 `data/`：

```text
data/
├── agent-sessions.sqlite
└── workspaces/
```

Business Server 使用 Supabase PostgreSQL；Agent Runtime 保持 SQLite，不共享业务数据库。

## Database Migration

Server 使用 Kysely migration 管理 PostgreSQL schema。`src/bootstrap/main.ts` 在服务监听端口前自动执行 `runMigrations()`；生产部署脚本也会在重启 Server 前显式执行一次 migration，因此正常启动和 `pnpm deploy` 都会自动创建尚未存在的表和索引。已执行过的 migration 由 Kysely migration 元数据记录，不会在每次重启时重复执行。

当前 `zz_project_domain_refactor` 不迁移旧脉络数据：它直接删除未使用的旧脉络相关表和 `entity_relations`，再创建 `projects`、`project_records` 及索引。执行生产 migration 前仍应确认目标环境与当前 schema 预期一致。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm db:migrate
pnpm memory:rebuild
# 兼容别名
pnpm vector:rebuild
```

`memory:rebuild` 会 reset 可重建的 Memory 派生索引，并按批次重新索引所有用户当前为 `processed` 的 Records；执行前应确认 Embedding 配置可用。它不会删除 Record / Media / Project 等业务表。

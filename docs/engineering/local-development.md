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

启动时 Server 会执行尚未运行的 migration。用户通过正式注册流程创建，不自动创建演示用户。受控测试可显式运行 `pnpm --filter @fanto/server db:seed:test-user`，幂等插入 user001；已有用户不覆盖，不自动签发或提交凭据。

## Agent Runtime

Agent Runtime 已内嵌在 Business Server，不单独启动。首次启动前在 `apps/server/.env` 配置 `DEEPSEEK_API_KEY`；模型、Agent 与 Tool 定义位于 `apps/server/agent.yaml`，Prompt 位于 `apps/server/src/agent/prompts/`。

## Admin Web（仅本地运行）

`apps/admin-web` 是独立 React/Vite 管理客户端，不编译发布至 H5、Nginx 或 PM2。Server 在 `apps/server/.env` 设置 `ADMIN_ACCESS_KEY`（建议执行 `openssl rand -hex 32` 生成），至少32字符；未配置时所有 Admin API 默认拒绝。页面仅输入与 Server 一致的管理密钥，不使用用户 JWT 或账户身份。密钥仅保存在页面内存，刷新页面须重新输入。
```bash
pnpm dev:server
pnpm dev:admin
```

默认访问 `http://127.0.0.1:5174`，Vite 只监听 `127.0.0.1` 并把 `/api` 代理到 `http://127.0.0.1:3000`。Server 在其它位置时通过本地 `ADMIN_API_PROXY` 覆盖代理目标；目标 Server 仍须自行设置 `ADMIN_ACCESS_KEY`，跨网络连接必须使用 HTTPS。详见 [Admin Web README](../../apps/admin-web/README.md)。

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

部署默认使用当前本地代码，不拉取远端。使用 `pnpm run deploy --pull` 可先执行 `git pull --ff-only origin main`，再使用更新后的部署脚本继续执行；要求当前为 `main` 且工作区干净，拉取失败立即停止。可组合为 `pnpm run deploy --pull --nginx --maintenance`。本地修改不会被自动覆盖，分叉历史不会自动合并。

健康检查失败后默认间隔 5 秒重试，最多检查 60 次，单次请求超时 2 秒，总等待约 5–7 分钟；成功立即继续部署。可通过部署命令的环境变量 `FANTO_HEALTH_RETRIES` 和 `FANTO_HEALTH_INTERVAL_SECONDS` 调整次数与间隔。

## 数据文件

Agent 工作区位于根目录 `data/workspaces/`；Session 内存运行使用 Pi MemorySessionRepo，持久历史和 Token Usage 则由 `src/agent/checkpoint/` 增量写入业务 PostgreSQL 的 `agent_session` Schema。**不使用 SQLite 或整份 Snapshot。**

## Database Migration

Server 通过 Kysely 维护 PostgreSQL Schema。`src/bootstrap/main.ts` 在服务监听前自动调用 `runMigrations()`，部署脚本也会在重启 Server 前调用迁移命令。迁移失败会阻止 Server 启动，**不会自动清空数据库**。实际部署前建议先备份 PostgreSQL，在维护窗口停止旧版本写入，再执行迁移并验证。

**命名规范（从现在起保持）：** `NNN_简介.ts`，三位递增序号加英文 snake_case，例如 `001_create_current_schema.ts`、`002_fanto_scoped_memory.ts`、未来 `003_next_feature.ts`。不使用日期前缀、不复用序号、不改动历史 migration 的行为或文件名；Kysely 依文件名字典序执行。`runMigrations()` 会校验此命名规范。

当前两条迁移：

- `001_create_current_schema.ts`：固化改造前的历史业务表、旧 User/Fanto Memory、`scope_key='default'` 会话基线。它只是版本 001 的历史快照，不等于最终 Schema。
- `002_fanto_scoped_memory.ts`：增量升级为独立 Fanto 长期记忆。将旧 `memories` **重命名为 `memories_legacy_002`，原内容保留但不再供 Agent 读取**；创建只有 `fanto_id` 的新 `memories`；清除旧角色配置中的 `userMemoryEnabled`，全部角色配置统一 `fantoMemoryEnabled=true` 并增加版本号；新建 Session 必须提供 UUID `scope_key`，旧 `default` Session 和 Entry 原封不动保留；默认角色在注册或默认会话首次获取时由应用幂等创建，**不会批量将旧 Session/记忆归属改为默认角色**。

原先已执行的 migration 名为 `create_current_schema_20261019`。新版 `runMigrations()` 启动时，仅在 Kysely 迁移元数据表中将该历史记录安全重命名为 `001_create_current_schema`，然后执行 002；这只修改迁移记录的**名称**，不重跑基线或更改原用户数据。空库则正常先执行 001、再执行 002。重复运行不会重复操作或覆盖数据。

旧库可能已有空昵称或重复昵称。迁移不擅自重新命名这些角色；通过数据库 Trigger 对**新插入或显式改名**的角色强制执行必填与大小写不敏感的用户内唯一性。现存非空昵称不存在重名时，还会创建部分唯一索引。历史空昵称角色的现有字段更新不会因昵称校验而被阻挡；后续产品可以单独提供重命名方案。

执行前：

```bash
# 确认备份及维护窗口后，在 apps/server 目录运行：
pnpm db:migrate
# 若只需要本地演练，用含有 test 的独立数据库配置 TEST_DATABASE_URL 运行迁移集成测试。
```

**注意：**旧 `scope_key='default'` 会话保留作历史数据但不再能作为新版活跃对话；旧 User/Fanto Memory 归档表不会被自动恢复为新的角色记忆。迁移不会自动删除旧记录或新建全体用户的默认角色（新用户注册和已有用户初始化时会创建）。删除 Kysely 迁移元数据并重放 001 不是受支持的升级流程，因为已升级后的结构与历史基线不相同；如需重建应使用独立空库。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm db:migrate
```

## 数据库重置与维护部署

不要直接清空实际数据库。经操作者批准准备新空库、运行 `pnpm db:migrate` 并验证后，再单独安排服务切换；部署脚本不负责数据重置。Fanto Session 由 scope_key 映射，不在角色表保存 session_id。数据结构见 [Fanto](../domain/fanto.md)。

部署脚本可使用 `bash deploy/manual/deploy.sh --maintenance`（需要更新 Nginx 时追加 `--nginx`），在构建后先停止旧进程，再迁移并启动新版本。该模式不负责入口摘流、等待活跃会话排空或自动清库。

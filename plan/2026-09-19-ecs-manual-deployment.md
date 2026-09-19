# Fanto ECS 手动部署方案

## 目标

当前生产部署采用单台 ECS 原生 Node.js 进程，不引入 Docker、systemd、PM2 或自动 CI/CD。

部署原则：

1. Git clone 后，仓库目录就是完整部署目录，不增加 repo/app 二级目录。
2. Server 与 Agent 各自维护自己的生产环境变量文件。
3. 生命周期脚本统一放在 `deploy/manual/`。
4. `start.sh` 只负责启动当前代码，不执行 git pull、依赖安装、构建或数据库迁移。
5. 日志和 PID 统一放仓库根目录的 `logs/` 与 `run/`。
6. Nginx 只负责公网入口和反向代理，不直接暴露 3000/3001。

## 目录

```text
/opt/fanto/
├── apps/
│   ├── server/
│   │   ├── .env.production
│   │   └── ...
│   └── agent/
│       ├── .env.production
│       └── ...
├── deploy/
│   └── manual/
│       ├── start.sh
│       ├── stop.sh
│       ├── restart.sh
│       └── nginx/
│           └── fanto.conf
├── logs/
│   ├── server.log
│   └── agent.log
├── run/
│   ├── server.pid
│   └── agent.pid
└── ...
```

`logs/` 和 `run/` 是运行时目录，由 `start.sh` 自动创建，不提交 Git。

## 环境要求

ECS 安装：

- Git
- Node.js >= 22.19.0
- Corepack / pnpm 10.11.0
- Nginx
- curl（用于人工健康检查）

推荐：

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
```

## 首次部署

```bash
cd /opt
git clone <repository-url> fanto
cd /opt/fanto

cp apps/server/.env.example apps/server/.env.production
cp apps/agent/.env.example apps/agent/.env.production

vim apps/server/.env.production
vim apps/agent/.env.production

pnpm install --frozen-lockfile
pnpm --filter @fanto/agent build

chmod +x deploy/manual/start.sh
chmod +x deploy/manual/stop.sh
chmod +x deploy/manual/restart.sh

./deploy/manual/start.sh all
```

Server 当前直接通过 TypeScript + tsx 启动，没有独立 build 产物；Agent 当前通过 `tsc` 构建并从 `dist/bootstrap/main.js` 启动。因此首次部署只需要显式构建 Agent。

## 生产环境变量

### Server

文件：

```text
apps/server/.env.production
```

至少确认：

```dotenv
HOST=127.0.0.1
PORT=3000
SQLITE_PATH=/opt/fanto/data/fanto.sqlite

# OSS / DashScope 等生产配置按 apps/server/.env.example 补齐
```

### Agent

文件：

```text
apps/agent/.env.production
```

至少确认：

```dotenv
PORT=3001
FANTO_SERVER_BASE_URL=http://127.0.0.1:3000
AGENT_SESSION_DB=/opt/fanto/data/agent-sessions.sqlite
AGENT_WORKSPACE_ROOT=/opt/fanto/data/agent-workspaces

# AGENT_TOKEN / Provider API Key 等按 apps/agent/.env.example 补齐
```

生产密钥不得提交 Git。

## 生命周期脚本

三个脚本统一支持：

```bash
./deploy/manual/start.sh [server|agent|all]
./deploy/manual/stop.sh [server|agent|all]
./deploy/manual/restart.sh [server|agent|all]
```

不传参数默认 `all`。

### 启动顺序

```text
server -> agent
```

### 停止顺序

```text
agent -> server
```

### start.sh 边界

`start.sh` 只：

- 检查对应 `.env.production`
- 创建 `logs/`、`run/`
- 检查已有 PID
- 启动对应 Node 进程
- 写入 PID
- 输出启动结果

明确不做：

- git pull
- pnpm install
- build
- migration
- Nginx reload

## 日常发布

发布步骤保持显式：

```bash
cd /opt/fanto

git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @fanto/agent build

./deploy/manual/restart.sh all
```

如果只修改 Server：

```bash
git pull --ff-only
pnpm install --frozen-lockfile
./deploy/manual/restart.sh server
```

如果只修改 Agent：

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @fanto/agent build
./deploy/manual/restart.sh agent
```

数据库 migration 属于发布动作，不放进生命周期脚本。涉及 schema 变化时，在 restart 前显式执行当前项目对应的 migration 命令。

## 日志与 PID

日志：

```bash
tail -f logs/server.log
tail -f logs/agent.log
```

PID：

```bash
cat run/server.pid
cat run/agent.pid
```

## Nginx

配置文件：

```text
deploy/manual/nginx/fanto.conf
```

路由：

```text
/health         -> 127.0.0.1:3000
/api/agent/*    -> 127.0.0.1:3001
/api/*          -> 127.0.0.1:3000
其他路径         -> 404
```

Agent 的流式接口关闭 Nginx buffering，并使用较长 read/send timeout。

Alibaba Cloud Linux / CentOS 常见安装方式：

```bash
sudo ln -sf /opt/fanto/deploy/manual/nginx/fanto.conf /etc/nginx/conf.d/fanto.conf
sudo nginx -t
sudo systemctl reload nginx
```

如果 Nginx 使用 Debian/Ubuntu 的 `sites-enabled` 布局，则把同一配置链接到对应目录即可。

当前 `server_name _;` 可直接用于 IP 验证，也能接收任意 Host。正式域名确定后可改成：

```nginx
server_name api.example.com;
```

如果 HTTPS 在 Cloudflare / Tunnel 层终止，ECS Nginx 可继续只监听 HTTP 80；如果 HTTPS 直接终止在 ECS，则后续单独增加证书和 443 server block，不混入当前最小手工部署方案。

## 网络

ECS 安全组只开放实际公网入口：

- 80（当前 Nginx HTTP）
- 443（后续 ECS 自行终止 HTTPS 时）

不要公网开放：

- 3000
- 3001

Server 生产环境应设置：

```dotenv
HOST=127.0.0.1
```

Agent 当前代码固定监听 `0.0.0.0:3001`，因此必须依靠 ECS 安全组保证 3001 不对公网开放；后续如果希望进程本身也限制 loopback，再单独修改 Agent 的监听配置。

## 健康检查

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3001/health
curl http://127.0.0.1/health
```

## 当前不做

本阶段不引入：

- Docker / Docker Compose
- systemd 应用服务
- PM2
- Kubernetes
- 自动部署
- 自动 git pull
- 自动 migration
- 自动构建
- 日志平台

当后续出现多机、高频发布、自动恢复或灰度发布需求时，再升级部署体系。

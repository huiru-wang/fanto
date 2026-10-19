# Fanto Admin（仅本地运行）

只读管理后台：注册用户列表、用户累计 Token、全部 Agent Session 列表及每个 Session 的 Token / Model 分组用量。

## 启动

1. 在 Server 的 `apps/server/.env` 配置 `ADMIN_ACCESS_KEY`，建议用 `openssl rand -hex 32` 生成随机密钥。密钥仅存 Server 环境文件，不提交仓库，也不要设置成 `VITE_*` 前端变量。未配置或短于 32 字符时 Admin API 一律拒绝。
2. 启动 Fanto Server：`pnpm dev:server`，本机默认 `http://127.0.0.1:3000`。现有 Server 重启后才能读取新配置。
3. 启动管理前端：`pnpm dev:admin`，访问 `http://127.0.0.1:5174`。
4. 页面输入 `ADMIN_ACCESS_KEY` 的密钥值即可进入，不使用用户账户、JWT 或登录提供商。密钥仅保存在页面内存，刷新后需要重新输入。

如果 Server 不在本机，可通过进程环境变量 `ADMIN_API_PROXY` 配置 Vite 代理到**可信 HTTPS** Server 地址；代理本身只对 `127.0.0.1` 开放。务必使用 HTTPS 保护跨网络传输的密钥。**后端必须独立设置 `ADMIN_ACCESS_KEY`，不能依赖本地前端控制权限。**

此工程不参加 Fanto H5 / iOS 部署流程；不配置 Nginx、PM2 或生产静态资源发布。`pnpm --filter @fanto/admin-web build` 仅用于本地验证。

## 统计口径

所有用量直接来自 PostgreSQL 的 `agent_session.usage_ledger`。包含 Pi 普通 usage 和 adjustment，模型为空时展示 `unknown`；不包含图片、语音、Embedding 等其它独立计费调用。仅统计已持久化的 Usage，Cost 为 SDK 的预估值。管理后台不会展示消息正文或内部 Tool 参数。

# Fanto Admin（仅本地运行）

只读管理后台：注册用户列表、用户累计 Token、全部 Agent Session 列表及每个 Session 的 Token / Model 分组用量。

## 启动

1. Server 使用 `ADMIN_USER_IDS=user001`；本地 `apps/server/.env` 已设置，仓库模板 `apps/server/.env.example` 也已列出。请注意：只有 JWT `sub=user001` 且数据库用户存在、状态为 active 时才有管理权限。
2. 启动 Server：`pnpm dev:server`，本机默认 `http://127.0.0.1:3000`。
3. 启动管理前端：`pnpm dev:admin`，访问 `http://127.0.0.1:5174`。
4. 输入 **user001 的有效 Fanto Access JWT 或 Refresh Token** 登录；Refresh Token 会经已有 `/api/auth/tokens/refresh` 换取短时 Access JWT。Token 只留在浏览器内存；刷新页面需要重新登录。

若 user001 未绑定 Google / Apple 身份，Google 登录不可用；可使用该账户已有的测试 Refresh Token，或者先通过既有认证流程建立凭据。Admin 不会自动签发或内置管理员凭据。

可选：如需 Google 登录，把已获 Server 允许的 **Web OAuth Client ID** 设置在 `apps/admin-web/.env` 的 `VITE_GOOGLE_CLIENT_ID` 中。Google 登录使用正式的 Fanto `/api/auth/intents` 和 `/api/auth/logins`，不允许自动注册管理用户。

如果 Server 不在本机，可通过进程环境变量 `ADMIN_API_PROXY` 配置 Vite 代理到可信的 Server 地址；代理本身只对 `127.0.0.1` 开放。**后端必须独立设置 `ADMIN_USER_IDS`，不能依赖本地前端控制权限。**

此工程不参加 Fanto H5 / iOS 部署流程；不配置 Nginx、PM2 或生产静态资源发布。`pnpm --filter @fanto/admin-web build` 仅用于本地验证。

## 统计口径

所有用量直接来自 PostgreSQL 的 `agent_session.usage_ledger`。包含 Pi 普通 usage 和 adjustment，模型为空时展示 `unknown`；不包含图片、语音、Embedding 等其它独立计费调用。仅统计已持久化的 Usage，Cost 为 SDK 的预估值。管理后台不会展示消息正文或内部 Tool 参数。

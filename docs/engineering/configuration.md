# 配置

配置真实读取逻辑分别位于：

- Business Server：`apps/server/src/bootstrap/config.ts`
- Agent Runtime：`apps/server/src/agent/` 与 Server 启动配置

`.env.example` 是开发模板；如果模板与实际读取代码不一致，以代码为准。

## Business Server

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | Server 的 Supabase PostgreSQL 连接串；必须启用 TLS。使用 Supabase Pooler 时附加 `sslmode=require&uselibpqcompat=true` |
| `PORT` / `HOST` | 默认 `3000` / `0.0.0.0` |
| `AUTH_JWT_ACTIVE_KID` | 当前 EdDSA 签名密钥 ID |
| `AUTH_JWT_PRIVATE_KEY` | Ed25519 PKCS#8 私钥，仅 Business Server 持有 |
| `AUTH_JWT_PUBLIC_KEYS` | `kid -> Ed25519 public key` JSON，用于验签与密钥轮换 |
| `AUTH_JWT_ISSUER` | JWT issuer，默认 `fanto` |
| `GOOGLE_ALLOWED_CLIENT_IDS` | 允许的 Google OAuth Client ID，多个值用逗号分隔 |
| `APPLE_ALLOWED_CLIENT_IDS` | 允许的 Apple 原生 App ID / Bundle ID，多个值用逗号分隔 |
| `AGENT_SESSION_DB` | Server 内 Agent Session SQLite 路径，默认 `data/agent-sessions.sqlite` |
| `AGENT_WORKSPACE_ROOT` | Server 内 Agent workspace 根目录，默认 `data/workspaces` |
| `AGENT_CONFIG_PATH` | Server 内 Agent YAML 路径，默认 `apps/server/agent.yaml` |
| `DEEPSEEK_API_KEY` | 当前 Server Agent YAML 使用的 DeepSeek 模型凭据；缺失时 Server 启动失败 |
| `OSS_REGION` | OSS Region |
| `OSS_ENDPOINT` | 可选公开 Endpoint；拒绝 `-internal` 地址 |
| `OSS_BUCKET` | OSS Bucket |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | OSS 凭据 |
| `DASHSCOPE_API_KEY` | 图片理解、音频转写与向量化共用的百炼凭据 |
| `DASHSCOPE_BASE_URL` | 三类百炼调用共用的 OpenAI 兼容模式地址，默认北京 Workspace 地址 |
| `DASHSCOPE_EMBEDDING_MODEL` / `DASHSCOPE_EMBEDDING_DIMENSION` | 文本向量化，默认 `qwen3.7-text-embedding-flash` / `768` |
| `DASHSCOPE_VL_MODEL` | 图片理解，默认 `qwen3-vl-flash` |
| `DASHSCOPE_ASR_MODEL` | 音频转写，默认 `qwen3-asr-flash` |

当前 `fanto` OSS Bucket 使用无地域属性（中国内地），默认 Region 为 `oss-rg-china-mainland`，公网 Endpoint 为 `https://oss-rg-china-mainland.aliyuncs.com`。生产环境应显式配置 `OSS_ENDPOINT`，避免误用地域型 Endpoint。

Agent 的模型、Agent、Tool 与 compaction 配置位于 `apps/server/agent.yaml`；`corePromptModule` 和 `systemPromptModule` 引用 `apps/server/src/agent/prompts/` 中受限的 TypeScript Prompt 模块。配置和 Prompt 都在 Server 启动时加载，内容参与 Agent revision；修改后需要重启 Server。

## H5 线上测试认证

线上 H5 可通过 `apps/h5/.env` 的以下构建时变量，以预置 refresh token 建立测试用户会话：

| 变量 | 说明 |
| --- | --- |
| `VITE_H5_TEST_AUTH` | 必须为 `true`，否则 H5 不进入测试会话 |
| `VITE_H5_TEST_REFRESH_TOKEN` | 由 Business Server 为测试用户签发的 refresh token |

H5 启动时调用现有 `/api/auth/tokens/refresh`，在 `sessionStorage` 保存返回的 Token 对，并将 access token 用于 Business Server 与 Agent Runtime 请求。测试用户必须在 `users` 表中存在且为 `active`；不需要登录 identity 或 auth challenge。H5 不再以 `X-User-Id` 传递用户身份。

## 安全约束

- 不把真实密钥提交到 Git。
- 不在 iOS 或其他客户端内放模型 / OSS Secret。
- 文档和日志示例不得包含真实 Authorization。

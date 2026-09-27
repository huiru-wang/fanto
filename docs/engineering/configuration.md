# 配置

配置真实读取逻辑分别位于：

- Business Server：`apps/server/src/bootstrap/config.ts`
- Agent Runtime：`apps/agent/src/main.ts` 与相关启动代码

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
| `AGENT_API_TOKEN` | 仅与 Agent Runtime 共享的内部 API Token；Business Server 以此识别 Agent→Server 调用 |
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

## Agent Runtime

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| `PORT` | Agent 服务端口，默认 3001 |
| `AUTH_JWT_PUBLIC_KEYS` | 与 Business Server 相同的 Ed25519 公钥集合；Agent 只验签、不持有私钥 |
| `AUTH_JWT_ISSUER` | 与 Business Server 相同的 issuer，默认 `fanto` |
| `DEEPSEEK_API_KEY` 等 | 模型 Provider 所需密钥 |
| `FANTO_SERVER_BASE_URL` | Record Tool 访问 Business Server 的 base URL，默认 `http://127.0.0.1:3000` |
| `FANTO_SERVER_API_TOKEN` | 必填；必须与 Business Server 的 `AGENT_API_TOKEN` 相同，只用于 Agent→Server 内部调用 |
| `AGENT_SESSION_DB` | Agent Session / Task SQLite |
| `AGENT_WORKSPACE_ROOT` | Session 工作区根目录 |

Agent definition 的 `models` 与 `agents` 由 `apps/agent/agents.yaml` 定义。每个模型项包含 Pi provider 与 model，Agent 通过 `provider/model` 形式的 `model_id` 引用模型项；服务在启动期校验引用和 Pi 内置模型，并要求 `main` Agent 存在。System Prompt 可以直接写在 `systemPrompt`，也可以通过 `systemPromptFile` 引用相对 `agents.yaml` 的 Prompt 文件；两者不能同时配置。可选 `corePromptFile` 会在最终 System Prompt 前拼入，同样只能位于配置目录内。当前 Fanto 使用 `apps/agent/prompts/core.md` 和 `apps/agent/prompts/operational.md`。Prompt 文件只在 Agent Runtime 启动时读取，内容会参与 Agent revision 计算；`main` 的模板包含 `{{character}}`、`{{current_time}}`、`{{user_preferences}}`、`{{relevant_memory}}` 四个插槽，由 Context Runtime 在每次 Agent Run 开始前构建，并由 Context Composer 填充一次。密钥只能来自环境变量。

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

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
| `TASK_SCHEDULER_INTERVAL_MS` | Task Scheduler Tick 周期，默认 `300000`（5 分钟） |
| `AGENT_EXECUTION_CONCURRENCY` | Proposal/Creator/Task 共用的后台 Agent 并发限制，默认 `2` |
| `TASK_TIMEOUT_MIN_SECONDS` | Task 最小允许超时，默认 `30` |
| `TASK_TIMEOUT_MAX_SECONDS` | Task 全局最大允许超时，默认 `3600` |
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

Agent 的模型、Agent、Tool、Task capability 与 compaction 配置位于 `apps/server/agent.yaml`；`task.enabled=true` 的子 Agent 还定义 `defaultTimeoutSeconds / maxTimeoutSeconds`，最终 Task timeout 同时受 Server 全局最小/最大值约束。`systemPromptModule` 引用 `apps/server/src/agent/prompts/` 中受限的 TypeScript Prompt 模块；当前 Main 使用 `main.ts`，Task Worker 使用 `task-worker.ts`。不再存在 `corePromptModule` 配置。配置和 Prompt 都在 Server 启动时加载，内容参与 Agent revision；修改后需要重启 Server。

## 创作 Agent

默认关闭，设置 `CREATIVE_ENABLED=true` 后，Record 处理完成即通过进程内 AgentExecutionQueue 发布 Proposal，接受后发布 Creator；无需创作扫描器。需要可用的 DeepSeek、Qwen 与 OSS 服务端凭据；不在客户端保存密钥。配置修改后重启 Server。

| 变量 | 默认 / 用途 |
| --- | --- |
| `CREATIVE_ENABLED` | `false`；仅接受 true / false |
| `CREATIVE_PROPOSAL_TIMEOUT_MS` / `CREATIVE_CREATOR_TIMEOUT_MS` | `120000` / `900000`，完整 Agent 回合超时 |
| `CREATIVE_IMAGE_ENDPOINT` | 默认 DASHSCOPE_BASE_URL 同主机的原生 `/api/v1/services/aigc/multimodal-generation/generation` |
| `CREATIVE_IMAGE_API_KEY` | 缺省使用 DASHSCOPE_API_KEY |
| `CREATIVE_IMAGE_MODEL` / `CREATIVE_IMAGE_TIMEOUT_MS` | `qwen-image-3.0-pro` / `300000`，单次生图超时 |

`agent.yaml` 中 proposal-agent / creator-agent 使用各自 Prompt，creator-agent 自动注入 roleplay-article Skill。当前仅角色扮演图文可执行，不执行 Three.js 等其他创意。运行语义见 [创作运行](../architecture/creative-runtime.md)。

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

Project summary / query 向量化复用 `DASHSCOPE_BASE_URL`、`DASHSCOPE_API_KEY`、`DASHSCOPE_EMBEDDING_MODEL` 和固定 768 维配置，与 Record / Memory 使用同一 Client；请求超时 30 秒。模型切换时已有向量须重新生成，不能混用不同模型的向量。Project 创建及摘要更新依赖向量服务成功。

# 配置

以 `apps/server/src/bootstrap/config.ts`、`apps/server/.env.example` 和 `apps/server/agent.yaml` 为准；模板中的所有必填项应显式设置，不能把占位符用于线上环境。修改 Agent YAML、Prompt 或服务端环境后重启 Server。

## Server 配置

| 变量 | 当前语义 |
| --- | --- |
| `PORT` / `HOST` | HTTP 监听，默认 3000 / 0.0.0.0 |
| `DATABASE_URL` | PostgreSQL 连接串，业务数据和 Agent Session 共用；兼容标准 PostgreSQL 厂商。生产连接需 TLS，Supabase Pooler 可用 `sslmode=require&uselibpqcompat=true` |
| `AUTH_JWT_ACTIVE_KID` / `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEYS` | EdDSA 签名 Key ID、私钥和公钥映射 |
| `AUTH_JWT_ISSUER` | 默认 fanto |
| `GOOGLE_ALLOWED_CLIENT_IDS` / `APPLE_ALLOWED_CLIENT_IDS` | 允许的 OAuth audience / iOS Bundle ID |
| `DEEPSEEK_API_KEY` | Agent YAML 里 DeepSeek 模型所需凭据 |
| `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` | 向量、图片理解和音频转写所需凭据/兼容地址 |
| `DASHSCOPE_EMBEDDING_MODEL` / `DASHSCOPE_EMBEDDING_DIMENSION` | 默认 qwen3.7-text-embedding-flash / 768；Record、Memory、Project 共用 |
| `DASHSCOPE_VL_MODEL` / `DASHSCOPE_ASR_MODEL` | 视觉理解、语音转写模型 |
| `OSS_REGION` / `OSS_ENDPOINT` / `OSS_BUCKET` | OSS 地区、公网 Endpoint、Bucket |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 仅服务端保存的 OSS 密钥 |
| `AGENT_CONFIG_PATH` | 默认 `apps/server/agent.yaml` |
| `AGENT_WORKSPACE_ROOT` | 默认 `data/workspaces` |
| `AGENT_EXECUTION_CONCURRENCY` | Proposal / Creator / Task 共享后台并发，默认 2 |
| `TASK_SCHEDULER_INTERVAL_MS` | 到期任务扫描间隔，默认 300000 ms；即时任务会触发主动唤醒 |
| `TASK_TIMEOUT_MIN_SECONDS` / `TASK_TIMEOUT_MAX_SECONDS` | 允许的 Task 超时范围，默认 30 / 3600 秒 |

OSS 使用中国内地无地域 Bucket 时，默认 Region/Endpoint 可参考 `.env.example`；不要使用无法从客户端访问的 internal Endpoint。Project summary、Record 和 Memory 的向量模型/维度应保持一致；切换模型时已有向量不可直接混用。

## 创作执行

| 变量 | 当前语义 |
| --- | --- |
| `CREATIVE_ENABLED` | 默认 false；控制 Record 自动 Proposal 和后台 Creator 链路 |
| `CREATIVE_PROPOSAL_TIMEOUT_MS` | 默认 120000 ms |
| `CREATIVE_CREATOR_TIMEOUT_MS` | 默认 900000 ms |
| `CREATIVE_IMAGE_ENDPOINT` | DashScope 原生图片生成接口，可显式覆盖 |
| `CREATIVE_IMAGE_API_KEY` | 可单独配置生成模型密钥；为空时复用 `DASHSCOPE_API_KEY` |
| `CREATIVE_IMAGE_MODEL` | 默认 qwen-image-3.0-pro |
| `CREATIVE_IMAGE_TIMEOUT_MS` | 默认 300000 ms |

图片生成读取服务端模型凭据，默认可复用 `DASHSCOPE_API_KEY`；具体配置读取路径以 `config.ts` 为准。Creative Skill 位于 `apps/server/skills/creative/`，使用四份参考意图，不再绑定单一 roleplay Skill。运行事件通过非持久化 AgentExecutionQueue、SessionEventBus；没有独立 Creative Scheduler、预算和租约配置。

## Agent 定义

`agent.yaml` 使用 `systemPromptModule` 指向 `src/agent/prompts/`，包含 main、proposal-agent、creator-agent 和 task-worker。Tool、Skill、compaction、Task 能力均受定义约束。不存在 `corePromptModule`；修改定义/Prompt 后需要重启 Server。Creator 的对外继续会话通过统一 `/api/agent/stream` 运行，而不是新增 Project 聊天 API。

## H5 测试模式

`apps/h5/.env` 的 `VITE_H5_TEST_AUTH=true`、`VITE_H5_TEST_REFRESH_TOKEN` 仅供受控测试；H5 调用 `/api/auth/tokens/refresh` 换取 Access JWT 并用于业务/Agent API。Refresh token 会进入客户端构建产物，**不得作为正式面向公众的登录方案或接触生产特权资源**。不要把真实 Token、私钥、OSS Key 或 Authorization 提交到仓库。

## 日志耗时

日志写入 `LOG_DIR`，标准启动目录下默认是仓库 `logs/`。`access.log` 的 `cost` 单位为毫秒，记录 API 中间件从读取请求体到响应就绪的耗时，不包含日志响应体提取、客户端网络传输或 SSE 完整流生命周期。

`sql.log` 通过统一 Kysely 数据库入口记录成功/失败 SQL 模板与 `cost`（毫秒）；耗时覆盖连接上的 query 执行，不包含等待连接池，也不等于整个业务事务耗时。SQL 参数、结果、原始数据库错误内容不写入日志，字符串字面量和注释被过滤；失败保留 SQLSTATE errorCode。该入口覆盖业务与 Agent Session SQL，直接绕过 Kysely 的 pg 调用不覆盖。

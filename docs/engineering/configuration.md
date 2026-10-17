# 配置

以 `apps/server/src/bootstrap/config.ts`、`apps/server/.env.example` 和 `apps/server/agent.yaml` 为准；模板中的所有必填项应显式设置，不能把占位符用于线上环境。修改 Agent YAML、Prompt 或服务端环境后重启 Server。

## Server 配置

| 变量 | 当前语义 |
| --- | --- |
| `PORT` / `HOST` | HTTP 监听，默认 3000 / 0.0.0.0 |
| `DATABASE_URL` | PostgreSQL 连接串，业务数据和 Agent 稳定历史快照共用；兼容标准 PostgreSQL 厂商。生产连接需 TLS，Supabase Pooler 可用 `sslmode=require&uselibpqcompat=true` |
| `AUTH_JWT_ACTIVE_KID` / `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEYS` | EdDSA 签名 Key ID、私钥和公钥映射 |
| `AUTH_JWT_ISSUER` | 默认 fanto |
| `GOOGLE_ALLOWED_CLIENT_IDS` / `APPLE_ALLOWED_CLIENT_IDS` | 允许的 OAuth audience / iOS Bundle ID |
| `DEEPSEEK_API_KEY` | Agent YAML 里 DeepSeek 模型所需凭据 |
| `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` | 向量、图片理解和音频转写所需凭据/兼容地址 |
| `DASHSCOPE_EMBEDDING_MODEL` / `DASHSCOPE_EMBEDDING_DIMENSION` | 默认 qwen3.7-text-embedding-flash / 768；Record、Memory、Project 共用 |
| `DASHSCOPE_VL_MODEL` / `DASHSCOPE_ASR_MODEL` | 视觉理解、语音转写模型 |
| `OBJECT_STORAGE_PROVIDER` | 存储 Client，默认 `aliyun-oss`，也支持 `cloudflare-r2`；未知值拒绝启动 |
| `OSS_REGION` / `OSS_ENDPOINT` / `OSS_BUCKET` | OSS 地区、公网 Endpoint、Bucket |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 仅服务端保存的阿里云 OSS 密钥 |
| `R2_ENDPOINT` | R2 Bucket 设置中的 HTTPS S3 API endpoint；仅选择 R2 时必填 |
| `R2_BUCKET` | R2 Bucket 名称；仅选择 R2 时必填 |
| `R2_ACCESS_KEY_ID` / `R2_ACCESS_KEY_SECRET` | R2 S3 API Access Key ID / Secret Access Key；仅服务端保存、仅选择 R2 时必填 |
| `AGENT_CONFIG_PATH` | 默认 `apps/server/agent.yaml` |
| `AGENT_WORKSPACE_ROOT` | 默认 `data/workspaces` |
| `AGENT_EXECUTION_CONCURRENCY` | Proposal / Creator / Task 共享后台并发，默认 2 |
| `TASK_SCHEDULER_INTERVAL_MS` | 到期任务扫描间隔，默认 300000 ms；即时任务会触发主动唤醒 |
| `TASK_TIMEOUT_MIN_SECONDS` / `TASK_TIMEOUT_MAX_SECONDS` | 允许的 Task 超时范围，默认 30 / 3600 秒 |

OSS 使用中国内地无地域 Bucket 时，默认 Region/Endpoint 可参考 `.env.example`；不要使用无法从客户端访问的 internal Endpoint。Project summary、Record 和 Memory 的向量模型/维度应保持一致；切换模型时已有向量不可直接混用。

## 对象存储选择

启动配置只保留所选服务商的设置和凭据：阿里云需要 `OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET`，R2 需要四个 `R2_*` 项。选择 R2 不要求配置阿里云；选择阿里云不校验 R2 设置。两站点使用独立 Bucket、凭据及部署环境；同一个进程只装配一种存储 Client。

R2 配置示例（将账号、Bucket 和密钥替换为该站点的资源）：

```dotenv
OBJECT_STORAGE_PROVIDER=cloudflare-r2
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=<bucket-name>
R2_ACCESS_KEY_ID=<access-key-id>
R2_ACCESS_KEY_SECRET=<secret-access-key>
```

SDK Region 固定为 `auto`；EU / US / FedRAMP jurisdiction Bucket 使用控制台对应的 jurisdiction endpoint（例如 `.eu` / `.us` / `.fedramp`）；R2 的 APAC location hint 不代表新加坡地域驻留保证。配置必须是账号级 S3 API HTTPS 地址，不能包含 Bucket 路径、账号密码或查询参数，也不接受 `r2.dev` 或 CDN 域名。R2 签名直接使用 S3 API 地址，不改写为自定义域名；[Cloudflare 预签名文档](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)说明了该限制。

创建 Bucket 后生成具有该 Bucket 对象读写权限的 **S3 API** 凭据（不是 Cloudflare 管理 API 的 Bearer Token）。Bucket 保持私有，通过短期签名读取；现有上传与缩略图功能不需要 Workers 或 Cloudflare Images。对象请求最多 15 秒，无 SDK 自动重试，下载过程持续限制 maxBytes；PUT 预签名绑定 Content-Type，不附加客户端 checksum 请求头。

**切换边界：**目前国内 / 新加坡双站点规划为 cn 继续使用 OSS、sg 使用独立 R2 Bucket 和独立数据库，首期不迁移历史 OSS 文件。切换同一套**已有数据库**的 provider 则不同：数据库 `media_assets.object_key` 仍指向原来的对象 key；必须先将原图、音频、文件、Project 资源以及现有缩略图按**原样 key、Content-Type、metadata** 复制到 R2，并逐项校验（特别是缩略图的 `source-etag`：跨厂商 ETag 可能不同，需要重新生成缩略图或同步修正派生对象 metadata）。确认数据完整、签名直传、浏览器跨域读取以及 Agent 模型可访问后再切换 provider。切换期间暂停写入以免遗漏增量；不要仅修改 `OBJECT_STORAGE_PROVIDER` 就在旧库上启用空 Bucket，也不要立即删除旧 OSS 文件。

H5 直传需要在该 Bucket 配置 CORS，AllowedOrigins 填对应站点域名；受控本地开发可另加实际 localhost Origin。以下 JSON 可粘贴到 Cloudflare Bucket CORS 设置：

```json
[
  {
    "AllowedOrigins": ["https://<site-domain>"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

CORS 的客户端上传头仍只有原有的 Content-Type；不存在额外 checksum 或禁止覆盖要求。部署后用真实 Bucket 做一次 [R2 smoke 验证](testing.md#r2-存储验证)，再进行浏览器页面验收。

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

`agent.yaml` 使用 `systemPromptModule` 指向 `src/agent/prompts/`，只包含 main、proposal-agent、creator-agent。Tool、Skill、compaction 均受定义约束。不存在 `corePromptModule`；修改定义/Prompt 后需要重启 Server。Creator 的对外继续会话通过统一 `/api/agent/stream` 运行，而不是新增 Project 聊天 API。

## H5 测试模式

`apps/h5/.env` 的 `VITE_H5_TEST_AUTH=true`、`VITE_H5_TEST_REFRESH_TOKEN` 仅供受控测试；H5 调用 `/api/auth/tokens/refresh` 换取 Access JWT 并用于业务/Agent API。Refresh token 会进入客户端构建产物，**不得作为正式面向公众的登录方案或接触生产特权资源**。不要把真实 Token、私钥、OSS Key 或 Authorization 提交到仓库。

## 日志耗时

日志写入 `LOG_DIR`，标准启动目录下默认是仓库 `logs/`。`access.log` 的 `cost` 单位为毫秒，记录 API 中间件从读取请求体到响应就绪的耗时，不包含日志响应体提取、客户端网络传输或 SSE 完整流生命周期。

`sql.log` 通过统一 Kysely 数据库入口记录成功/失败 SQL 模板与 `cost`（毫秒）；耗时覆盖连接上的 query 执行，不包含等待连接池，也不等于整个业务事务耗时。SQL 参数、结果、原始数据库错误内容不写入日志，字符串字面量和注释被过滤；失败保留 SQLSTATE errorCode。该入口覆盖业务与 Agent Session SQL，直接绕过 Kysely 的 pg 调用不覆盖。

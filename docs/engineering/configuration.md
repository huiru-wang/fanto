# 配置

配置真实读取逻辑分别位于：

- Business Server：`apps/server/src/bootstrap/config.ts`
- Agent Runtime：`apps/agent/src/bootstrap/main.ts` 与相关启动代码

`.env.example` 是开发模板；如果模板与实际读取代码不一致，以代码为准。

## Business Server

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| `SQLITE_PATH` | 业务 SQLite 路径，默认 `../../data/fanto.sqlite` |
| `PORT` / `HOST` | 默认 `3000` / `0.0.0.0` |
| `EMBEDDING_API_KEY` | Embedding 凭据；代码也允许回退 `OPENAI_API_KEY` |
| `EMBEDDING_API_BASE` | Embedding API base；可回退 `OPENAI_API_BASE` |
| `EMBEDDING_MODEL` | 当前默认 `text-embedding-v2` |
| `EMBEDDING_DIMENSION` | 当前必须为 `1536` |
| `OSS_REGION` | OSS Region |
| `OSS_ENDPOINT` | 可选公开 Endpoint；拒绝 `-internal` 地址 |
| `OSS_BUCKET` | OSS Bucket |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | OSS 凭据 |
| `DASHSCOPE_API_KEY` | 图片理解与 ASR 凭据 |
| `DASHSCOPE_VL_BASE_URL` / `DASHSCOPE_VL_MODEL` | 图片理解 |
| `DASHSCOPE_ASR_BASE_URL` / `DASHSCOPE_ASR_MODEL` | 音频转写 |

注意：当前代码中的 OSS 默认 Region 仍是 `oss-cn-hangzhou`。如果配置计划准备调整它，在代码真正变更前不要把目标值写成当前事实。

## Agent Runtime

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| `PORT` | Agent 服务端口，默认 3001 |
| `AGENT_TOKEN` | HTTP Bearer Token |
| `DEEPSEEK_API_KEY` 等 | 模型 Provider 所需密钥 |
| `FANTO_SERVER_BASE_URL` | Record Tool 访问 Business Server 的 base URL，默认 `http://127.0.0.1:3000` |
| `AGENT_SESSION_DB` | Agent Session / Task SQLite |
| `AGENT_WORKSPACE_ROOT` | Session 工作区根目录 |

Agent definition 的 provider、model、tools、skills 与 compaction 由 `apps/agent/agents.yaml` 定义。密钥只能来自环境变量。

## 安全约束

- 不把真实密钥提交到 Git。
- 不在 iOS 或其他客户端内放模型 / OSS Secret。
- 文档和日志示例不得包含真实 Authorization。

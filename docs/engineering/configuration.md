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
| `OSS_REGION` | OSS Region |
| `OSS_ENDPOINT` | 可选公开 Endpoint；拒绝 `-internal` 地址 |
| `OSS_BUCKET` | OSS Bucket |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | OSS 凭据 |
| `DASHSCOPE_API_KEY` | 图片理解、音频转写与向量化共用的百炼凭据 |
| `DASHSCOPE_BASE_URL` | 三类百炼调用共用的 OpenAI 兼容模式地址，默认北京 Workspace 地址 |
| `DASHSCOPE_EMBEDDING_MODEL` / `DASHSCOPE_EMBEDDING_DIMENSION` | 文本向量化，默认 `qwen3.7-text-embedding-flash` / `768` |
| `DASHSCOPE_VL_MODEL` | 图片理解，默认 `qwen3-vl-flash` |
| `DASHSCOPE_ASR_MODEL` | 音频转写，默认 `qwen3-asr-flash` |

注意：当前代码中的 OSS 默认 Region 仍是 `oss-cn-hangzhou`。如果配置计划准备调整它，在代码真正变更前不要把目标值写成当前事实。

## Agent Runtime

主要环境变量：

| 变量 | 说明 |
| --- | --- |
| `PORT` | Agent 服务端口，默认 3001 |
| `AGENT_TOKEN` | HTTP Bearer Token |
| `PROVIDER` / `MODEL` | 覆盖 `agents.yaml` 中的默认模型配置；未设置时使用 YAML defaults |
| `DEEPSEEK_API_KEY` 等 | 模型 Provider 所需密钥 |
| `FANTO_SERVER_BASE_URL` | Record Tool 访问 Business Server 的 base URL，默认 `http://127.0.0.1:3000` |
| `AGENT_SESSION_DB` | Agent Session / Task SQLite |
| `AGENT_WORKSPACE_ROOT` | Session 工作区根目录 |

Agent definition 的 provider、model、tools、skills 与 compaction 由 `apps/agent/agents.yaml` 定义。System Prompt 可以直接写在 `systemPrompt`，也可以通过 `systemPromptFile` 引用相对 `agents.yaml` 的 Prompt 文件；两者不能同时配置。当前 Fanto 使用 `apps/agent/prompts/fanto.md`。Prompt 文件只在 Agent Runtime 启动时读取，内容会参与 Agent revision 计算。密钥只能来自环境变量。

## 安全约束

- 不把真实密钥提交到 Git。
- 不在 iOS 或其他客户端内放模型 / OSS Secret。
- 文档和日志示例不得包含真实 Authorization。

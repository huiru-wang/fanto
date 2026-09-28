# Agent Runtime 迁入 Server：执行任务

本任务顺序以可回滚、可验证为原则。每一步保持旧 `apps/agent` 可独立运行，直到第 10 步验证完成。

## 1. 固化迁移基线

- 为旧 Agent 的 session、history、stream、取消、Tool 和 context 测试建立迁移清单。
- 增加固定 Agent definition / Prompt / revision fixture。
- 记录旧 SSE 事件序列 fixture（包括 `present_media` 的白名单结果）。

验证：`pnpm --filter @fanto/agent typecheck && pnpm --filter @fanto/agent test && pnpm --filter @fanto/agent build`。

## 2. 在 Server 建立 Agent 模块骨架

- 复制 `context/`、`harness/`、`sessions/`、`tools/`、`skills/`、`workspace/` 的纯运行时实现到 `apps/server/src/agent/`。
- 将 `http/` 中的路由代码迁到 `apps/server/src/routes/agent/`，不把 Hono 依赖放入 Runtime。
- 保持 `runAgent` 为唯一 prompt 执行入口。

验证：Server typecheck；不注册路由时，Agent Runtime 的单元测试能在新目录运行。

## 3. 建立进程内领域 Service 适配层

- 新建 `agent/business-services.ts`，只声明 Record、Media、Preference 的最小 Service 能力和 Agent 投影转换。
- 将 `tools/records.ts`、`tools/media.ts`、`tools/preferences.ts` 的 `FantoServerClient` 参数替换为相应 Service 适配器。
- 将 Preference / Memory Context Provider 同样替换为适配器；保留 Query Rewriter 的模型依赖。
- 删除新 Server Agent Runtime 对 HTTP envelope、URL、timeout、`FantoServerClient` 的依赖。

验证：Tool 测试证明 userId 仍只来自 Run Context；跨用户访问返回与旧链路一致；`rg` 验证新 Agent 模块没有 `X-API-Token`、`X-User-Id` 或 `FantoServerClient`。

## 4. 迁移模型定义与 Prompt

- 新建 `agent/definitions.ts`，以 TypeScript 常量表达当前 `agents.yaml` 定义。
- 将 core / operational Markdown 迁为 `agent/prompts/*.ts` 字符串常量，保持文本和插槽原样。
- 保留启动期加载、`main` 强制存在、模型引用检查、revision 计算、Agent 切换语义。

验证：definition、最终 prompt 和 revision fixture 在旧 / 新实现间一致；未知 model / 重复 agent / 缺少 main 的失败测试通过。

## 5. 迁移 Session Manager 与存储配置

- 将 `AgentSessionManager` 接入 Server config 的 `agent` 子配置。
- 兼容 `AGENT_SESSION_DB` 和 `AGENT_WORKSPACE_ROOT` 的现有路径默认值与仓库根相对解析。
- 将 runtime 的 `close()` 挂到 Server shutdown；确保释放 cached harness 和 SQLite repo。

验证：使用迁移前生成的 SQLite Session 文件，在 Server 进程下成功读取 history 与恢复 owner；同一 session 并发 run 仍得到 409。

## 6. 将 Agent Route 接入 Server Auth 与 App

- 在 `createApp(services, options)` 接收 `AgentRuntime`，注册 `/api/agent/*` routes。
- Route 复用 Server request principal，不再使用 Agent 的 JWT verifier / AsyncLocal principal。
- 调整 Server CORS 的 `X-Time-Zone`、`GET/POST` 与 Agent body limit。
- 按旧协议保持 response envelope、status 和 SSE event payload。

验证：无 token、伪造 user header、失效用户、跨用户 session、未知 agent、非法请求体、历史分页均覆盖 Server route 测试。

## 7. 保持流式与取消语义

- 迁入 `streamSSE` 实现、15 秒心跳、120 秒 abort、stream abort 到 `runAgent` / lane abort 的传播。
- 让 route `finally` 始终释放 Session reservation。
- 确认 Server 全局错误处理不吞掉已经开始的 SSE 错误事件。

验证：人工或集成测试断开连接后 mock lane 收到 abort；超时只发送 `error` 不发送 `done`；成功事件顺序与旧 fixture 完全一致。

## 8. 配置与部署兼容

- Server config 兼容读取 Agent Session、workspace、模型 Provider 所需的旧环境变量。
- 从新 Runtime 删除 `FANTO_SERVER_BASE_URL`、`FANTO_SERVER_API_TOKEN` 配置读取；旧 `apps/agent` 保持不动。
- 更新本地开发和生产启动说明，明确同一 SQLite 文件不能被两个入口并发写入。

验证：仅启动 Server 的干净环境可加载 Agent；旧 Agent 的独立启动仍可工作；缺少必需模型配置时启动错误可理解。

## 9. 新旧入口对照测试与灰度准备

- 用隔离 DB / workspace 分别启动新旧入口，执行 Session 创建、history、普通 stream、Tool stream、断连取消。
- 比较状态码、response JSON、SSE 事件类型和公开 payload；允许 runId、时间戳、模型文本等非确定字段不同。
- 为客户端增加 Server Agent base URL 的切换配置，默认保持旧入口，按测试环境逐步启用。

验证：对照测试通过；至少一次真实 Provider / OSS / business data 链路成功。

## 10. 切换与观察

- 在测试环境将客户端全部指向 Server `/api/agent/*`。
- 观察 Session 恢复、Tool 用户隔离、SSE abort、资源关闭和日志中的错误率。
- 生产切换期间旧入口仅作为回退，不让同一 Session 同时流向两个进程。

验证：所有完成标准满足后，记录删除旧工程的批准条件；此阶段不删除 `apps/agent`。

## 11. 删除旧独立 Agent（单独批准后）

- 删除 `apps/agent`、其端口和部署配置、旧内部 token / allowlist、Client 指向旧 Agent 的配置。
- 从 Server config 删除已废弃的内部 API token 配置，仅保留 Server JWT 与 Agent Runtime 所需配置。
- 刷新架构、配置、开发文档及相关 AGENTS。

验证：`pnpm typecheck`、`pnpm test`、Server build、端到端 SSE/Tool/session 恢复验证均通过。

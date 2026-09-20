# Agent Runtime Guide

适用于 `apps/agent/`。先阅读：

- `../../docs/architecture/agent-runtime.md`
- `README.md`

## 当前边界

- `agents.yaml` 是 Agent 定义入口，只在服务启动时加载；可通过 `systemPromptFile` 引用同目录树下的 Prompt 文件，Prompt 同样只在启动时读取。
- Tool Registry 支持 Pi 内置 `read`、`write`、`edit`、`bash`，只读业务 Tool `record_get`、`record_list`、`record_search`，以及媒体展示 Tool `present_media`。
- Agent Session、任务与业务 Server 使用不同的数据存储；Agent Runtime 不直接访问 Fanto 业务数据库，Record Tool 与 `present_media` 只能通过 `FantoServerClient` 调用 Business Server HTTP API。
- 每个 Session 固定绑定用户归属与独立工作区，`sessionId` 是运行时、历史与工作区的隔离边界。
- `userId` 来自 Session → Run Context，不应作为 LLM 可自由填写的工具参数；业务 Tool 必须从当前 Pi Context 读取用户身份。

## 实现约束

- 新 Agent 能力优先通过配置、Tool 或 Skill 扩展，不在 HTTP Route 中堆业务逻辑。
- Session owner / revision 信息继续使用 Pi Session custom entry 保存，不建立重复状态源。
- 文件工具必须限制在 Session 工作区。
- bash 的路径检查、最小环境和命令限制只是开发期防线；生产环境不能把它们视为宿主机安全隔离。
- 密钥只通过环境变量注入，不能写入 `agents.yaml`、Skill 或工作区。
- Business Server HTTP Header、timeout、cancellation 和 envelope/error 统一由 `FantoServerClient` 处理，不在各 Tool 中重复实现。
- 修改 Agent 定义模型、Session 语义、Tool Registry 或安全边界前，先核对现有测试。

## 验证

```bash
pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build
```

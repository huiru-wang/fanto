# 配置驱动 Agent 服务任务

1. 新增项目根 `agents.yaml` 与 `apps/agent/agents.yaml.example`，在 README 说明部署时的配置路径、DeepSeek 环境变量和重启生效规则。
2. 增加 YAML 解析与 schema 校验依赖；实现 defaults 合并、Agent ID/工具/Skills/模型校验及无效配置的启动失败测试。
3. 创建 `config/agent-registry.ts`，将启动时已验证的配置按 ID 索引；未知 Agent 返回 404，禁止请求直接传入 provider、模型、工具或系统提示词。
4. 将当前 `runtime.ts` 拆分为 Harness factory、Session manager 与 Workspace 模块，并替换内存 Session 为 SQLite Session Repo。
5. 更新 SSE 请求 schema：要求 `agentId`，支持可选 `sessionId`；在 start 事件返回会话与 Agent 元数据，验证已有会话不能切换 `agentId`，并处理同一会话并发运行。
6. 实现 ToolRegistry，按 YAML 创建 read、write、edit、bash，设置 `activeToolNames`，并为每个工具组合写 Harness 创建测试。
7. 实现工作区路径约束、最小 bash 环境、命令超时与输出限制；覆盖 `..`、绝对路径、符号链接和命令策略的拒绝测试。
8. 定义并实现生产 sandbox adapter 接口；开发环境使用 NodeExecutionEnv，部署文档明确 bash 必须由容器或微虚拟机隔离后才可启用。
9. 实现 SkillLoader：只允许加载 `apps/agent/skills/<id>/SKILL.md`，校验 front matter，把配置列出的 Skills 传给 `AgentHarness.resources.skills`，并测试未声明或不存在的 Skill。
10. 将 YAML `compaction` 映射到 `AgentHarnessOptions.compaction`，校验与模型 context window 的关系，并使用可控模型测试多轮会话的压缩设置与恢复后的连续上下文。
11. 更新 Route 测试，覆盖 Agent 选择、会话新建/恢复、SSE 元数据、配置错误、断连取消及不泄漏工具/供应商敏感信息。
12. 运行类型检查、所有 Agent 服务测试和构建；随后更新 `apps/agent/README.md`、`docs/api/http-api.md` 和 `AGENTS.md` 中的配置、会话、工具隔离与生产边界说明。

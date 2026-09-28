# Agent Harness 与 Context 收敛执行任务

本清单的设计依据是 `plan/2026-09-28-agent-harness-context-design.md`。按顺序执行；每项完成后先运行其指定的窄验证，再进入下一项。

## 1. 建立迁移基线

- 阅读 `apps/agent/AGENTS.md`、`apps/agent/README.md`、`docs/architecture/agent-runtime.md`。
- 记录当前 `src/agent/**`、`src/context/**` 的所有 import 引用与现有测试覆盖。
- 运行 Agent 包的 typecheck 与 test，确认工作树基线无误。
- 不在此步骤修改业务行为。

验收：现有 Agent 测试全部通过；迁移前引用列表完整。

## 2. 重命名 Harness 所属目录

- 将 `apps/agent/src/agent/` 迁移为 `apps/agent/src/harness/`。
- 使用 `session-manager.ts` 代替 `session.ts`、`build-runtime.ts` 代替 `harness.ts`。
- 同步更新 `http/`、`main.ts`、`tools/`、测试及同包源码的 import。
- 暂时保持原行为与 public HTTP contract 不变。

验收：`pnpm --filter @fanto/agent typecheck` 通过；不存在有效源码 import 指向 `src/agent/`。

## 3. 建立 Context 三入口门面与统一 Run Context

- 新建 `context/index.ts`，只导出 `createRunContext`、`createSystemPrompt`、`createTransformContext`。
- 将原 `agent/run-context.ts` 迁移并改造为 `context/run-context.ts`。
- 用单个私有 Chord Context Key 保存 Run Data；通过 `createRunContext.read(context)` 读取。
- 保留并迁移 userId、traceId、sessionId、timeZone、current query、recentMessages 与 sourceMessageId 语义。
- 引入 Context 内部 `SlotStore`；输入 slots 仅作为初始 slot 值，不能暴露为通用共享状态。
- 更新 Record、Media、Preference Tool 以读取新的载体，并保持缺失用户身份时 fail closed。

验收：现有 Tool 测试迁移后通过；没有 Tool 通过 LLM 参数取得 userId；没有残留的旧 Run Context Key 读取路径。

## 4. 实现 System Prompt Builder 与 slot 执行内核

- 实现模板解析器：解析 `{{slot_name}}`，保留引用顺序，并提供稳定去重集合。
- 实现 Provider 注册校验：slot 格式校验、重复 slot 失败、结果 slot 不匹配降级。
- 将 Provider 合约迁移为自声明 `slot` 并返回 `{ slot, content }`。
- 实现按引用筛选、`Promise.all` 并行、普通错误降级、取消抛出、占位符替换。
- 在 `SlotStore` 中缓存最终 Prompt Promise，确保同 Run 后续 System Prompt 回调无模板解析、无 Provider 调用、无 IO。
- 迁移 Character、Current Time、Preference、Memory Provider；删除中心化 `sectionFor()` 和 section-to-slot 映射。
- 删除被替代的 `context/runtime.ts`、`context/builder.ts`、`context/composer.ts`，并修复纯时间格式化函数的依赖位置。

验收：新增单元测试覆盖按引用、并行、重复引用、占位符、异常、取消、同 Run memo、跨 Run 重建及 Provider 冲突；Agent 包 typecheck 与 test 通过。

## 5. 实现 buildRuntime 并接入 System Prompt

- 将原 Harness 构建逻辑收拢到 `harness/build-runtime.ts`。
- `buildRuntime` 接收 `agentId + Session + workspace + dependencies`，内部从 Registry 取得 Definition。
- 在 `AgentHarness.create()` 中传入 `systemPrompt: systemPrompt.resolve`。
- 私有保存 `main` lane；Runtime 对外提供 `prompt(query, context)`、`readRecentMessages()`、`harness`、`close()`，不返回 lane 或 sessionId。
- 更新 Session Manager：缓存 HarnessRuntime；仅在新 Session、agentId 切换或 revision 变化时重建，并正确关闭旧 Runtime。

验收：Session 创建、重新 acquire、revision 更新、并发排他与关闭行为的既有测试通过；动态 Prompt 回调能从第三参 Run Context 读取数据。

## 6. 接入完整 Hook 层

- 新建 `harness/hooks.ts` 和 `installHarnessHooks()`。
- 注册 `transform_context`，调用 `createTransformContext()` 的默认 pass，实现只返回 `{ messages }`。
- 迁移 `before_tool` 的 workspace path 与 bash 安全策略，不改变阻断语义。
- 在 `before_run_end` 调用 System Prompt Builder 的释放逻辑。
- 显式注册并保持 no-op：`before_run`、`before_drive`、`before_request`、`before_payload`、`after_response`、`after_tool`、`before_compaction`、`before_navigation`。

验收：测试证明 transform 默认不改变 messages、不能修改 Prompt、不会写回 transcript；workspace / bash policy 原有测试继续通过；同 Run memo 在 run end 后可被释放。

## 7. 接入完整 Event 层并简化 Run 执行

- 新建 `harness/events.ts`，统一订阅 Harness Event 并返回总取消函数。
- 迁移 `turn_start`、`tool_start`、`tool_end`、`message_update`、`entry_added` 的已有行为。
- 显式声明 no-op：`run_start`、`run_resume`、`run_suspend`、`run_end`、`operation_abort`、`fault`、`handler_error`、`turn_end`。
- 重写 `harness/run.ts`：生成 runId、读取最近消息、调用 `createRunContext`、订阅 Event、调用 `runtime.prompt`、finally 取消订阅。
- 删除 Run 层中模板判断、Provider 调用、fragments、Composer 和对 lane 的直接公开依赖。

验收：SSE 的 `start`、`turn_start`、`tool_start`、`tool_end`、`delta`、`done/error` 行为不回归；`present_media` metadata 白名单投影不回归；Event listener 不跨 Run 累积；sourceMessageId 仍可被 Preference Tool 使用。

## 8. 完成回归测试与构建验证

- 补充完整的 Context、Runtime、Hook、Event、Tool、Session 测试。
- 运行：

```bash
pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build
pnpm typecheck
pnpm test
```

- 对失败项先定位并修复；不得以降低断言、跳过测试或放宽用户隔离来换取通过。

验收：所有命令通过，且新增测试覆盖设计文档第 11 节所有行为。

## 9. 刷新 Current State 文档

- 读取 `docs/.checkpoint` 中的 `reviewed_through`。
- 审查 `reviewed_through..HEAD` 的完整文件变化及最终实现，不以本计划文件作为事实依据。
- 更新受影响的 `docs/architecture/agent-runtime.md`、`apps/agent/README.md`、`apps/agent/AGENTS.md` 和其他引用旧路径或旧 Context Runtime 的 Current State 文档。
- 仅在完成所有增量的 Documentation Impact Review 后更新 `docs/.checkpoint`。

验收：文档准确描述最终 Harness / Context 边界、动态 Prompt 的一次构建语义、Hook/Event 接入与新的源文件路径；checkpoint 与文档更新同次提交。

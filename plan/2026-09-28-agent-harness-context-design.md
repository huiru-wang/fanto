# Agent Harness 与 Context 收敛设计

## 1. 目标与范围

本方案重构 `apps/agent` 内部的 Harness 与 Context 边界，达成以下目标：

1. 将 `src/agent/` 重命名为 `src/harness/`；`apps/agent/` 仍是整个 Agent Runtime 包，不改名。
2. Context 对外只有三个命名入口：`createRunContext`、`createSystemPrompt`、`createTransformContext`。
3. 动态 System Prompt 在构建 Harness 时接入 Pi 的 `systemPrompt` 回调；Provider 在该回调的首次调用中按 Run 惰性执行，并在同一个 Run 内缓存。
4. `transform_context` Hook 已接入，但当前为 pass；它只处理 messages 请求视图，不能改 System Prompt 或写回 transcript。
5. Harness Hook 与 Event 都有显式接入层。当前没有业务策略的 Hook/Event 保留 no-op 扩展位置。
6. `run.ts` 只负责构建本次 Run Context、订阅事件和调用 Runtime 的 `prompt`；它不拼 Prompt、不直接跑 Provider、不直接注册 Pi Hook。

本次不改变：Agent definition 的 YAML 语义、Session 所有权与 revision 规则、工具集合、业务 Server API、SSE 对外契约、workspace 安全策略、用户隔离模型。

## 2. 已验证现状

- `apps/agent/src/agent/run.ts` 是唯一调用 `lane.prompt()` 的位置。它在 prompt 前读取历史、直接调用 `ContextRuntime.build()`、再调用 `composePrompt()`，并把最终 Prompt 写入当前 Run Metadata。
- `apps/agent/src/agent/harness.ts` 创建 `AgentHarness`，现有 `systemPrompt` 回调每次只从 Context 中读取预先拼好的 Prompt。
- 当前 Context 被拆为 `runtime.ts`、`builder.ts`、`composer.ts`、`types.ts` 与 `providers/*`；Composer 内维护中心化 section-to-slot 映射，Builder 也通过 Provider 名称反向映射 section。
- Pi 0.85.1 的 `systemPrompt` 回调签名为 `(toolContext, context)`，`lane.prompt(..., context)` 的第三参 Context 会透传给它。
- Pi 提供 `transform_context` Hook，事件包含 `messages` 和 `systemPrompt`，可以返回二者之一；本项目必须封装为仅处理 messages。
- 当前已使用的 Harness Event 包括 `turn_start`、`tool_start`、`tool_end`、`message_update` 和 `entry_added`；后者用于记录 Preference Tool 所需的 `sourceMessageId`。
- 业务 Tool 从 Chord Context 取得 `userId`、trace、Session 与来源消息，不能退回到模型可填写参数。

## 3. 目录与模块边界

目标目录：

```text
apps/agent/src/
├── harness/
│   ├── build-runtime.ts
│   ├── run.ts
│   ├── hooks.ts
│   ├── events.ts
│   ├── session-manager.ts
│   ├── registry.ts
│   └── definition.ts
│
├── context/
│   ├── index.ts
│   ├── run-context.ts
│   ├── system-prompt.ts
│   ├── transform-context.ts
│   ├── internal/
│   │   ├── slot-store.ts
│   │   ├── template.ts
│   │   ├── provider-runner.ts
│   │   └── types.ts
│   └── providers/
│       ├── character.ts
│       ├── current-time.ts
│       ├── preferences.ts
│       └── memory.ts
│
├── tools/
├── http/
├── clients/
├── workspace/
└── main.ts
```

`context/index.ts` 是 Context 唯一受支持的外部入口，且只能导出：

```ts
export { createRunContext } from "./run-context.js";
export { createSystemPrompt } from "./system-prompt.js";
export { createTransformContext } from "./transform-context.js";
```

`context/internal/**`、`context/providers/**` 仅供 Context 模块及应用的组合根使用；`harness/`、`tools/`、`http/` 不得直接依赖它们。Provider 可通过 `createSystemPrompt` 的输入插拔，但 slot 调度与模板执行规则只存在于 Context 内部。

不创建 `bootstrap/context.ts`。`main.ts` 已是依赖组合根，继续创建 Models、FantoServerClient、SkillLoader 和默认 Provider 实例，再交给 Session Manager / Runtime 依赖。

## 4. Context 公开接口

### 4.1 createRunContext

Run Context 是所有 per-run 数据的唯一入口。为了保持仅三个命名导出，读取操作作为 `createRunContext` 的附属能力，而不是另行导出函数。

```ts
type RunContextInput = {
  runId: string;
  userId: string;
  query: string;
  slots: Record<string, string>;

  sessionId: string;
  traceId?: string;
  timeZone?: string;
  recentMessages: readonly ContextMessage[];
};

type RunData = {
  readonly runId: string;
  readonly userId: string;
  readonly query: string;
  readonly sessionId: string;
  readonly traceId?: string;
  readonly timeZone?: string;
  readonly recentMessages: readonly ContextMessage[];
  readonly slots: SlotStore;
  sourceMessageId?: string;
};

export const createRunContext = Object.assign(
  (input: RunContextInput): Context => { /* internal Chord key write */ },
  {
    read(context: Context): RunData { /* fail closed without valid user */ },
  },
);
```

`runId` 是在执行 `lane.prompt()` 前由应用生成的本次执行 ID；它不要求等于 Pi 在 Hook event 中生成的内部 operation ID。它用于 Provider、Tool、Hook 与日志的统一关联。

`slots` 是本 Run 的私有 Prompt slot 状态：输入的 `Record` 是预置值，Context 内部将其包装为 `SlotStore`。它不是对外业务数据；Tool 和 transform 实现不应读写它。

`sourceMessageId` 保留为本 Run 内的可更新元数据：`entry_added` 捕获实际用户消息 entry 后写入，`preference_manage` 从同一 Run Context 读取。不得建立第二份全局 Map 或 Tool 参数来保存它。

### 4.2 createSystemPrompt

```ts
type SystemPromptProvider = {
  readonly slot: string;
  build(context: Context): Promise<{ slot: string; content: string }>;
};

type SystemPromptBuilder = {
  resolve(
    toolContext: ExecutionToolContext,
    context: Context,
  ): Promise<string>;
  release(context: Context): void;
};

createSystemPrompt(options: {
  template: string;
  providers: readonly SystemPromptProvider[];
  placeholder?: string;
}): SystemPromptBuilder;
```

`SystemPromptProvider` 是接口 1 的一部分，不是新的独立 Context 能力。每个 Provider 自声明 `slot`，例如 `"relevant_memory"`，不使用中心枚举、section 名称或 Provider name 到 slot 的转换。

### 4.3 createTransformContext

```ts
type MessageTransform = (
  messages: readonly AgentMessage[],
  context: Context,
) => Promise<readonly AgentMessage[] | undefined>;

createTransformContext(transform?: MessageTransform): MessageTransform;
```

未传 transform 时返回 pass 实现：它返回原始 messages。对外类型没有 `systemPrompt` 字段，因此业务实现无法争夺 System Prompt 的所有权。

## 5. 模板解析与 slot 执行

模板中的 slot 形式为 `{{slot_name}}`；slot 名限制为小写字母开头，后续允许小写字母、数字与下划线。解析器返回模板中出现的全部 slot 引用，并保留原始模板用于最终全量替换。

```text
模板
  ↓ parseTemplate()
引用列表（可重复）
  ↓ stable unique
所需 slot 集合
  ↓ provider registry lookup
已注册且被引用的 Provider
  ↓ Promise.all
{ slot, content } 结果
  ↓ SlotStore + fillTemplate()
本 Run 固定 systemPrompt
```

例：模板包含 `{{current_time}}` 两次、`{{relevant_memory}}` 一次、`{{unknown_slot}}` 一次时，`current_time` Provider 只运行一次；其结果替换两个引用。`unknown_slot` 不运行任何 Provider，替换为占位符。

Provider 注册阶段执行如下校验：

1. `slot` 必须符合 slot 名规则。
2. 不能有两个 Provider 声明相同 slot；Runtime 构建失败，避免结果不确定。
3. Provider 运行结果的 `slot` 必须等于其声明值；不一致视为该 Provider 失败。

首次 Pi `systemPrompt` 回调时：

1. 使用 `createRunContext.read(context)` 取得 Run Data 与 SlotStore。
2. 若 SlotStore 已有最终 Prompt Promise，直接 await 并返回。
3. 否则将整个构建任务存为最终 Prompt Promise，防止同一 Run 并发回调重复触发 IO。
4. 解析模板，筛选出实际被引用的 Provider。
5. 用 `Promise.all` 并行运行筛选后的 Provider；每个 Provider 从传入的 Chord Context 读取自己的 per-run 数据。
6. 普通 Provider 异常记录 slot、runId 与错误摘要，写入空内容；如果 Context 的 abort signal 已取消，直接重新抛出中止原因。
7. 将 `{ slot, content }` 写入 SlotStore；空白 content 视为缺失。
8. 对每个模板引用替换：有非空内容则使用该内容，否则使用 `placeholder`，默认 `（无）`。
9. 返回并缓存最终 Prompt。

同一个 Run 的后续 model turn 再进入 `systemPrompt` 回调时，只读取 SlotStore 内的最终 Prompt Promise；不重新解析模板、不重新运行 Provider、不发起 IO。

新一次 `lane.prompt()` 使用新的 `runId` 和新的 Run Context，因此会基于新的 query、历史、时区与用户状态重新构建。

`before_run_end` Hook 调用 `SystemPromptBuilder.release(context)`，释放对应 Run 的缓存。即使 Session 长期存活，也不能让 per-run Prompt memo 无界增长。

## 6. Harness Runtime

`buildRuntime` 是 Harness 的唯一构建入口。Session 已由 Session Manager 创建或打开，因此不返回 `sessionId`；Lane 是 Harness 内部细节，因此也不向调用方暴露。

```ts
type HarnessRuntime = {
  readonly harness: AgentHarness<ExecutionToolContext>;
  prompt(query: string, context: Context): Promise<RunResult>;
  readRecentMessages(): Promise<ContextMessage[]>;
  close(): Promise<void>;
};

buildRuntime(input: {
  agentId: string;
  session: Session;
  workspace: string;
  dependencies: RuntimeDependencies;
}): Promise<HarnessRuntime>;
```

构建顺序：

1. 按 `agentId` 从 Registry 取得并校验 Agent Definition。
2. 解析 Model、Tools、Skills、Workspace 环境与默认 Provider。
3. 用 Definition 的静态模板及 Provider 集合创建 `SystemPromptBuilder`。
4. 调用 `AgentHarness.create()`，将 `systemPrompt: systemPrompt.resolve` 传入 Pi。
5. 取得 `main` lane 并私有保存。
6. 调用 `installHarnessHooks()`。
7. 返回封装了私有 lane 的 Runtime；`prompt()` 内部调用 `lane.prompt(query, undefined, context)`。

Session Manager 保持 Session owner、revision、workspace、并发排他和 Runtime 缓存职责。只有新建 Session、Definition revision 变化、或 Session 切换 agentId 时关闭旧 Runtime 并重新调用 `buildRuntime`；每个 `/stream` 请求不重建 Harness。

## 7. Hook 接入

`harness/hooks.ts` 提供：

```ts
installHarnessHooks(harness, {
  workspace,
  systemPrompt,
  transformContext,
}): void;
```

必须注册的实际行为：

- `transform_context`：调用 `transformContext(event.messages, context)`，只返回 `{ messages }`。不读取、传递或返回 `event.systemPrompt`。
- `before_tool`：迁移现有 read/write/edit workspace 路径检查和 bash 请求检查，行为不变。
- `before_run_end`：调用 `systemPrompt.release(context)` 清理本 Run 的 Prompt memo。

必须显式注册的暂时 no-op Hook：

```text
before_run
before_drive
before_request
before_payload
after_response
after_tool
before_compaction
before_navigation
```

这些 handler 统一 `async () => undefined`。它们是预留扩展点，不得伪造业务行为。

## 8. Event 接入

`harness/events.ts` 提供：

```ts
subscribeHarnessEvents(
  harness: AgentHarness<ExecutionToolContext>,
  handlers: RuntimeEventHandlers,
): () => void;
```

每次 Run 在执行前订阅，并在 finally 中调用返回的取消函数，避免监听器跨 Run 累积。

当前实际处理：

| Pi Event | 处理 |
|---|---|
| `turn_start` | 向 SSE 写入 `turn_start` |
| `tool_start` | 向 SSE 写入 `tool_start` |
| `tool_end` | 向 SSE 写入 `tool_end`；成功的 `present_media` 保留稳定 metadata 白名单投影 |
| `message_update` | 仅转发 `text_delta`，累计输出并写 SSE `delta` |
| `entry_added` | 匹配本 Run 的用户 query，写入 Run Data 的 `sourceMessageId` |

显式声明并以 no-op 处理：

```text
run_start
run_resume
run_suspend
run_end
operation_abort
fault
handler_error
turn_end
```

HTTP 层继续只将现有 SSE 事件暴露给客户端；Pi 内部错误、工具原始参数/结果、reasoning 不新增对外暴露。

## 9. 单次 Run 流程

```text
HTTP stream request
  ↓ 鉴权 / 校验 agentId / acquire Session / reserve
HarnessRuntime（缓存命中或此前构建）
  ↓
runAgent()
  ├─ 生成应用层 runId
  ├─ Runtime 读取最近消息视图
  ├─ createRunContext({ runId, userId, query, slots, ... })
  ├─ subscribeHarnessEvents(...)
  └─ runtime.prompt(query, runContext)
       ↓
     Pi systemPrompt callback
       ↓
     createSystemPrompt.resolve(_, runContext)
       ↓
     首次时并行构建引用 slot；后续 turn 命中本 Run 缓存
       ↓
     Pi transform_context Hook（当前 pass）
       ↓
     模型 / Tool loop
  ↓ finally
取消 Event 订阅 / 释放 Session reservation
```

取消语义保持：HTTP 断连或总超时触发 AbortController；Provider 与 Business Server 请求收到同一 abort signal；取消不应被 Provider 失败降级吞掉。

## 10. 文件迁移映射

| 当前文件 | 目标 | 处理 |
|---|---|---|
| `src/agent/harness.ts` | `src/harness/build-runtime.ts` | 更名并收拢 Runtime 构建、私有 lane、System Prompt / Hook 接入 |
| `src/agent/run.ts` | `src/harness/run.ts` | 移除 Context Build / Composer，保留 Run Context、Event、执行 |
| `src/agent/session.ts` | `src/harness/session-manager.ts` | 更名，改为持有 HarnessRuntime |
| `src/agent/definition.ts` | `src/harness/definition.ts` | 更名与 import 更新 |
| `src/agent/registry.ts` | `src/harness/registry.ts` | 更名与 import 更新 |
| `src/agent/run-context.ts` | `src/context/run-context.ts` | 重建为统一 Run Context 载体 |
| `src/context/runtime.ts` | 删除 | 被 System Prompt Builder 取代 |
| `src/context/builder.ts` | 删除 | 被 Provider Runner 取代 |
| `src/context/composer.ts` | 删除 | 被 Template Parser / Filler 取代 |
| `src/context/types.ts` | `src/context/internal/types.ts` | 仅保留 Context 内部需要的类型 |
| `src/context/providers/time.ts` | `src/context/providers/current-time.ts` | 更名；保留时区格式化 helper 的合适导出位置 |

所有 `../agent/...`、`./agent/...` 和测试 import 必须同步更换为 `harness` 或 Context 门面路径。`tools/records.ts` 如需日期格式化，不能继续通过旧 Provider 文件耦合；应将纯格式化函数移动到无 Provider 语义的共享位置，或由 Tool 自己的专用纯 helper 承担。

## 11. 验收与测试

必须覆盖：

1. 模板仅运行被引用的 Provider；无 Context slot 的 `coding` 不查询 Preference / Memory。
2. 多个被引用 Provider 并行执行。
3. 重复 slot 引用只运行一次，并替换所有出现位置。
4. 未注册、空内容、普通 Provider 异常均替换为 `（无）`。
5. 取消时 Provider 构建中止，不能降级为成功 Prompt。
6. 同一 Run 多次 System Prompt 回调只执行一次 IO；不同 Run 必须重新执行。
7. 重复 Provider slot 在 Runtime 构建时失败；Provider 返回错误 slot 时降级并记录。
8. transform 默认返回原 messages；自定义 transform 只能改请求 messages，不能改 Prompt 或 transcript。
9. 所有 Hook 注册存在；现有 workspace / bash policy 仍生效。
10. Event 订阅在 Run 结束后卸载；SSE 现有事件顺序与数据形状不变。
11. Tool 在新的 Run Context 下仍能取得 userId、traceId、timeZone、sessionId、sourceMessageId，并继续对缺少用户身份 fail closed。
12. Session 所有权、单 Session 串行执行、revision 刷新与 Runtime close 不回归。

命令：

```bash
pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build
pnpm typecheck
pnpm test
```

## 12. 文档影响

实现完成后执行 Documentation Impact Review：以 `docs/.checkpoint` 的 `reviewed_through` 为起点，审查至最终 HEAD 的完整变更。

至少检查并按最终代码更新：

- `docs/architecture/agent-runtime.md`：Context 生命周期、Provider 按引用执行、Harness / Hook / Event 边界。
- `apps/agent/README.md`：目录、动态 Prompt、Run 执行方式、Context 约束。
- `apps/agent/AGENTS.md`：`src/harness/run.ts` 为唯一 prompt 调用点、Context 的新边界与验证说明。
- 任何引用 `src/agent/`、`Context Runtime`、`Context Composer` 的 Current State 文档。

只有完成全部 `reviewed_through..HEAD` 范围检查后，才更新 `docs/.checkpoint` 并将它与本次文档变更一起提交。

# Agent 停止、超时与续聊执行任务

状态：已实施，验证记录见文末。设计依据：[最小完整方案](2026-10-11-agent-stop-design.md)。按以下六项顺序完整实施、统一验收，不逐项发布半成品。

目标：停止/整轮超时后保留历史、真正释放 Session，并在同一 Session 正常续聊。复用当前 Pi、HTTP 协议、SessionManager、Worker 和客户端结构；不新增状态接口、运行状态协议或数据库表。

## Task 1：用真实 Pi 固定完整失败用例

文件：新增 `apps/server/src/routes/agent/cancellation.integration.test.ts`；扩展 `agent/harness/run.test.ts`、`routes/agent/sessions.test.ts`。

- [x] 使用真实 AgentHarness + MemorySessionRepo + faux Provider + 当前 HTTP Routes；不 mock lane.abort。
- [x] 在 start、turn_start、message_start、delta、message_end、tool_start、tool_end 和 terminal 注入暂停的写入；客户端不主动取消 Reader 解锁 stop。
- [x] 先验证当前 start/delta 用例失败；测试有 deadline 和 finally 清理，清理发生在断言之后。
- [x] 同时覆盖整轮 timeout、模型失败、工具中取消、重复 stop 和自然完成竞争。
- [x] 每个正常结束场景检查：Pi 无当前 Operation、部分输出/停止标记已保存、reservation 已释放，同 Session 下一轮真正 completed。

Fixture 必须定义 requestStop / history / continueSameSession，分别调用现有 stop、History和第二轮 Stream；不依赖新增 state API。核心断言形态：

```ts
const result = await withTestDeadline(requestStop(sessionId), 1000);
assert.equal(result.status, 200);
assert.equal((await lane.inspectExecution(TODO_CONTEXT)).current, null);
assert.equal((await history(sessionId)).messages.at(-1)?.state, "stopped");
assert.equal(await continueSameSession(sessionId), "continued");
```

withTestDeadline 仅是测试 watchdog，结束后清除 timer，不能用它代替生产取消；continueSameSession 必须真正读到下一轮 done 与预期文字。

命令：`pnpm --filter @fanto/server exec tsx --test src/routes/agent/cancellation.integration.test.ts src/agent/harness/run.test.ts src/routes/agent/sessions.test.ts`。

## Task 2：可取消 SSE 等待与 Run 收尾

文件：新增 `apps/server/src/agent/harness/run-output.ts`、`run-output.test.ts`；修改 `routes/agent/stream.ts`、`agent/harness/run.ts`、`events.ts`，必要时定点修改 `build-runtime.ts` 和 `session-manager.ts`。

- [x] 小型辅助函数保持正常写入顺序，signal 取消或等待 deadline 到期时解除网络等待，清理 listener/timer，接住迟到拒绝。
- [x] start、所有文本/工具事件和 terminal 使用同一行为；onStarted 阻塞时停止也能完成，取消后不得开始 prompt。
- [x] 输出 deadline 建议 5 秒；请求驱动 Run 因输出超时自动取消，后台只读订阅断开不取消 Worker。
- [x] 复用当前 abort Promise / withoutAbortSignal / Pi waitForIdle / fanto.run_stopped；停止和整轮超时明确日志原因。
- [x] 持久化完成后释放，释放只执行一次；旧 finally 不误释放新轮次。
- [x] 验证断开、背压、正常事件顺序、无 unhandled rejection 和 timer/listener 泄漏。

辅助函数的实现形态（仅供网络通知）：

```ts
async function waitForOutput(
  write: () => Promise<void>, signal: AbortSignal, timeoutMs: number,
): Promise<"written" | "detached" | "timeout"> {
  if (signal.aborted) return "detached";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<"detached" | "timeout">((resolve) => {
    onAbort = () => resolve("detached");
    signal.addEventListener("abort", onAbort, {once:true});
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const writing = Promise.resolve().then(write).then(() => "written" as const);
    return await Promise.race([writing, interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
```

调用方将 timeout 映射为本轮取消，处理 write 异常并清理网络流。该函数不得包装工具副作用或数据库事务以提前释放。

命令：`pnpm --filter @fanto/server exec tsx --test src/agent/harness/run-output.test.ts src/routes/agent/cancellation.integration.test.ts src/agent/harness/run.test.ts src/agent/harness/session-manager.test.ts`。

## Task 3：所有 Agent 入口及具体工具的收尾

文件：`apps/server/src/execution/agent-worker.ts`、`execution/handlers/creator.handler.ts`、`proposal.handler.ts`、`task.handler.ts`；`agent/business-services.ts`、相关具体 Tool / Client；扩展 `execution/agent-worker.test.ts` 和 Handler contract 测试。

- [x] 核对 Main / Creator / Proposal / Task Worker 的停止、deadline、失败路径均回到现有共享 Runtime；不新增框架。
- [x] 定点调整 Worker/Handler：必要业务状态收尾→关闭/释放→终态通知。Creator failed 状态必须在停止确认前完成，使后续 Stream 可正常进入。
- [x] 如需协调业务状态，复用现有回调结构，必要时增加一个窄用途收尾回调；不全面重构 Worker API。
- [x] 检查当前配置的模型、图片、Web Search、bash、文件与领域 Tool 的 signal 传播；只修复漏传、取消后继续执行或无界等待的实际问题。
- [x] 保留已提交成果、已保存 Proposal 和工具事实；取消时不自动重试/重放非幂等工具。
- [x] 图片客户端按最终 `infrastructure/clients/image-client.ts` 路径实施，复用现有外部调用日志；不恢复已合并文件。

命令：`pnpm --filter @fanto/server exec tsx --test src/execution/agent-worker.test.ts src/execution/handlers/proposal-creator.contract.test.ts src/routes/agent/cancellation.integration.test.ts`。每种 Agent 需有真实 Pi 的取消/超时测试，Creator 还需验证业务状态允许续聊。

## Task 4：现有 stop 的有限等待与 PG 验证

文件：`apps/server/src/routes/agent/sessions.ts`、`agent/harness/run-logging.ts`；扩展 `routes/agent/sessions.test.ts`、`agent/session/pg-session.test.ts`、`harness/interrupted-operation.test.ts`。PgStorage / pg-queries 仅在集成测试定位到具体问题时修改。

- [x] stop 保持现有请求/响应结构、归属校验和幂等语义；建议请求 20 秒预算，包含 ownership 阶段。
- [x] 超时用现有 error 结构返回 503“停止未确认”；已开始的取消继续且绑定捕获的 Run，不提前清空 activeRuns/running；ownership 阶段到期后不得迟到取消新轮次。
- [x] 最少阶段日志区分接收、授权、输出解除、Pi abort、历史保存、业务收尾、释放、stop 返回；超时记录具体 waitStage。
- [x] 使用真实隔离 PG 验证部分回复、空回复 stopped、工具结果、事务提交与下一轮；故障测试验证有限失败而非假成功。
- [x] 验证现有 clearInterruptedOperation 处理重启遗留，只取消、不请求模型/重放工具，恢复后可正常续聊。
- [x] 不新增 state 接口/run_started 表或记录；只有发现 Session SQL 无界阻塞的实际缺口，才补具体查询/事务的服务器端超时并验证真实回滚。

命令：设置只指向隔离测试库且库名包含 test 的 `TEST_DATABASE_URL`，运行 `pnpm --filter @fanto/server exec tsx --test src/agent/session/pg-session.test.ts src/routes/agent/cancellation.integration.test.ts src/routes/agent/sessions.test.ts src/agent/harness/run.test.ts`。未配置而跳过核心 PG 用例意味着本任务未完成，禁止使用生产库代替。

## Task 5：H5 / iOS 现有入口恢复发送

文件：`apps/h5/src/api/agent.ts`、`pages/ChatPage.tsx`，必要时 `components/projects/ProjectSessionChat.tsx`；`apps/ios/fanto/fanto/Networking/AgentAPIClient.swift`、`Conversation/ConversationStore.swift`、必要的 Project Stream 处理。

- [x] 现有 stop 请求建议客户端 25 秒上限；失败结束无限按钮等待，显示停止未确认并允许重试；不新增状态轮询、不自动重发聊天。
- [x] stop 成功后清理旧流/Task、恢复发送，再同步 History。History 失败保留本地内容，不继续锁住已确认释放的 Session。
- [x] 整轮超时 stopped、模型导致的本轮失败 error 均结束本轮等待，允许继续；单工具超时不错误结束仍在执行的整轮。
- [x] 使用现有 sessionId、controller/Task/message identity 防止迟到 SSE/History/finally 覆盖新轮或新 Session；不扩展 runId/canSend HTTP 协议。
- [ ] 实测停止前无文字/有文字/有工具、停止后立即继续、整轮超时后继续、刷新、切 Session、History失败与stop网络失败。
- [x] 不新增原本没有的页面停止按钮；共享 Runtime / 后台超时的正确性仍需测试。

命令：`pnpm --filter @fanto/h5 typecheck`、`pnpm --filter @fanto/h5 build`；`xcodebuild -project apps/ios/fanto/fanto.xcodeproj -scheme fanto -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build`。H5 当前 test 占位，必须另有浏览器/模拟器交互证据。

## Task 6：整体验收与统一交付

文档：按最终改动更新 `docs/architecture/agent-runtime.md`、必要的 `creative-runtime.md`、`docs/api/http-api.md`、`docs/engineering/testing.md`、`docs/clients/h5.md`、`docs/clients/ios.md` 及模块 AGENTS；不提前把方案描述成可用能力，不未经全量 review 推进 docs checkpoint。

- [ ] 对设计验收矩阵逐项记录真实证据；故障解除不能依赖测试先取消 Reader。
- [x] 实际 HTTP Server + socket 验证快读、慢读、暂停读和断连，随后同 Session 继续并检查数据库历史。
- [ ] 在受控环境做最少次数真实 DeepSeek / Creator smoke；连续 3 次“长回复→停止→继续→刷新”和“整轮超时→自动结束→继续→刷新”，验证正常条件下 5 秒目标。
- [x] 运行 `pnpm typecheck`、`pnpm test`、H5 build、iOS build；明确未运行/跳过范围，核心 Pi/PG取消验收不能跳过。
- [x] 对客户端请求、Server阶段日志、Pi Operation 和 PG 记录进行同一 Session 对照；线上原故障无日志时不宣称已确认其具体原因。
- [ ] 全部关键路径通过后统一提交交付，不分批发布补丁；用户授权部署后才上线，并核对前后端版本再做线上复验。

完成标准：手动停止和整轮超时均完成收尾，已产生内容刷新不丢，后续消息确实得到回复；异常有限返回、原因清楚，无伪成功或永久占用。


## 本次执行证据（2026-10-11）

- RED：原实现的真实 Pi start/delta 阻塞测试均失败，watchdog 报 cancellation blocked by output。
- 真实 Pi + 独立 PostgreSQL + HTTP：13 项通过（全部过程事件阻塞、停止/超时/输出 deadline、重复停止、历史和续聊、实际 HTTP socket）；PG SDK conformance 43 项通过，两组分开执行。
- Chromium 实际 H5 交互：停止请求及等待提示、确认后立即续聊、慢历史不覆盖新回复、停止失败重试、历史失败保留回复、done 无需 EOF 均通过。浏览器使用隔离 mock API，不使用生产账号数据。
- 真实 DeepSeek 最小 smoke：连续 3 轮流式停止、部分历史、同 Session 续聊通过，取消持久化 18/6/4 ms。使用内存隔离 Session，不写生产业务数据，不调用收费生图。
- 最终 pnpm typecheck、pnpm test 通过：Server 167 passed / 47 skipped / 0 failed；跳过的 PG conformance 中 43 项已在独立库单独补跑通过，其他 4 项为本次未涉及的业务数据库测试。H5 build、iOS build 均通过。
- iOS 模拟器构建通过；未执行真机/模拟器页面交互或真实 OSS 生图 E2E，不能将上述测试描述为它们的成功证据。
- 不推进 docs/.checkpoint；不部署生产。本次保留工作区已有外部调用日志变更。

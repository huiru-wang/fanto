# Agent 停止、超时与续聊：最小完整方案

状态：待执行。仅修改方案，不表示业务代码已经修复。运行链路事实基于 `865b813` 和真实 Pi + 当前 HTTP 路由复现实验；实施前核对工作区的最终代码，保留其它任务的改动。

## 1. 必须实现的结果

用户点击停止，或者整轮 Agent 执行超时后：

1. 中断当前一轮，不再启动新的模型请求或工具。
2. 保存已经接受的用户消息、已产生的助手内容和工具执行结果。
3. 完成必要的 Project / Task 业务状态收尾，再释放本轮 Session 占用。
4. 客户端结束等待；同一个 Session 可以立即发送下一条消息并获得回复。
5. 刷新后仍能看到中断前的内容和 stopped 状态。

Main、Creator、Proposal、Task Worker 使用同一套现有取消机制；H5 / iOS 的现有停止入口一致。Proposal 决策仍由工具保存事实决定，不解析或拼接自然语言决定业务结果。done 表示成功完成；停止和整轮超时完成收尾后使用 stopped，不假报成功。

正常网络与数据库条件下，停止并恢复发送的目标为 5 秒内。依赖故障时接口和 UI 必须有限结束等待并显示未确认，不能伪装成功、提前释放仍执行的 Session。已提交的副作用不会因取消自动回滚。

## 2. 已确认的问题

- 当前 Pi `0.85.1` 的持久化 AgentLane 有 abort / waitForIdle。独立实验可取消流式生成、保存 aborted 回复，并在同 Session 继续 prompt。
- Pi 会等待 Harness 事件回调。Fanto `harness/events.ts` 直接 await emit，HTTP emit await SSE 写入。真实 Pi + 当前路由实验：暂停消费生成中的 delta，stop 不返回；取消 Reader 后才返回 200。
- `865b813` 已把 Session 释放移到结束 SSE 前，但没有解除生成中事件的网络等待。
- runAgent 在内部 Run 取消监听建立前 await onStarted；start 写入被阻塞也必须覆盖。
- H5 / iOS 等 stop 返回后才取消本地流，H5 stop 请求没有明确等待期限；前端先断网不能替代 Server 的正确取消。
- Worker 的终态通知、Creator 的业务状态更新、Session 释放的顺序需要完整验证；不能在 Project 仍禁止续聊时返回“停止成功”。
- 原有测试多数 emit 即时返回，HTTP stop 测试多为假 Runtime；必须补真实 Pi 和 PG 的组合测试。

线上 `dbd54350-86ff-441e-8bce-5a8c1b06a216` 查询时：上一轮已有 aborted 回复及停止标记，当前轮为 assistant.effect_pending / running。缺同次线上 stop 日志，不能将本地复现当作线上这一次的最终原因。

对应版本源码：
- https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/harness/runtime/lane.ts
- https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/harness/events.ts

## 3. 本次范围

优先修正当前 `runAgent → runtime.abort → lane.abort/waitForIdle → 停止标记 → Session release`，沿用 SessionManager、PgStorage、Worker、Handler 和客户端现有结构。

本次不新增 GET state 接口，不新增 run_started 持久化记录，不扩展 start/stop 的 runId/canSend 协议，不新增数据库表、MQ、Redis或第二个 Runtime，不全面重构 Worker，也不为其它领域统一配置 SQL 超时。不扩展原本没有停止入口的页面；共享 Runtime 修复仍覆盖其执行超时和外部 stop 调用。

已有 runId / traceId / Pi operationId 用于日志，不成为新的客户端协议。已有 reservation 保留，只修正重复释放或旧 finally 释放新轮次的实际竞态。遗留 Operation 继续复用 clearInterruptedOperation 的取消-only恢复，不增加一套恢复系统。

## 4. 可取消的输出等待

增加一个小型输出等待辅助函数，用于 start、文本、工具和结束 SSE：

- 正常情况按现有顺序 await 写入，不使用无限队列或裸 fire-and-forget。
- 监听本轮取消信号。取消时解除事件回调对在途网络写入的等待，后续回调跳过输出；迟到的 write 拒绝必须被接住。
- start 同样使用本轮控制器的信号，且离开 start 后立即检查取消，不能继续发起 prompt。
- 请求驱动 Stream 的写入等待上限建议 5 秒：超过上限取消该 Run、解除等待，并记录 output_wait_timeout。避免未点击 stop 时无人消费也无限占用。
- 结束通知不影响已经完成的持久化及 Session 释放；heartbeat / timer / listener 在收尾时清理。
- 后台 Events 的网络订阅断开只清理订阅，不取消后台 Worker。

仅对网络通知放弃等待。不能对 Tool 执行、数据库提交或业务副作用套用同样的 Promise.race 然后声称已停止。

## 5. 停止和超时的完整收尾

用户 stop、整轮 deadline、请求断开、调用方 abort 汇入现有取消入口，并在日志区分原因。同一轮重复取消复用同一个 abort Promise。

顺序固定为：

```
请求取消
→ 解除输出回调等待
→ Pi abort（withoutAbortSignal 保留原 Context）
→ 等待 Pi idle
→ 保存部分回复、工具事实和停止标记
→ 必要业务状态收尾 / 后台 Harness 关闭
→ 本轮 Session 释放
→ stop 成功返回 / stopped 通知
```

不提前清除 activeRuns/running 来使接口返回。释放最多一次；旧 Stream 的 finally 不得再次释放新 Run。对已有 Worker/Handler 只调整必要的业务收尾与通知顺序；需要协调业务状态时复用既有回调结构，必要时加一个窄用途收尾回调，不另造生命周期框架。

Creator 停止或整轮超时后保留已保存成果、完成本轮 failed 状态，允许同 Project Session 继续创作。Proposal 已通过工具保存的提议保留，未保存不能制造结果。TaskRun 按当前模型记录失败/取消事实。不能在取消时自动重试生图或重放其它非幂等工具。

### 超时分类

| 情况 | 处理 |
| --- | --- |
| 整轮 Agent deadline | 自动执行上述取消收尾，stopped，恢复发送，无需再点 stop |
| 单次模型调用超时并使本轮失败 | 保存失败事实，完成本轮释放；客户端结束等待，可继续新消息 |
| 单个工具超时 | 记录明确工具失败，按 Agent 现有策略继续；若已到整轮 deadline 则结束本轮 |
| SSE 输出超时/断开 | 请求驱动 Run 取消收尾；后台只读订阅断开不取消 Worker |
| stop HTTP 等待超时/网络失败 | 停止尚未确认，不能宣称成功；允许重试同一个 stop，不自动重发聊天消息 |

正常超时不能把 Session 永久留在 running，也不能使历史消失。

## 6. 工具与数据库：验证先行，定点补齐

核对当前所有已配置 Tool 的 signal 传播，尤其模型、图片生成/下载/处理/上传、Web Search、bash 和业务事务。图片调用已合并 signal 和 timeout，实施时使用最终 `infrastructure/clients/image-client.ts` 路径。

已有正确实现不重写。发现漏传 signal、取消后继续启动下一阶段或无界外部等待时，仅修具体调用。停止发生在事务提交后保留结果；事务结果未确定时不能放弃等待后释放 Session。恢复只检查/取消，不重放。

PgStorage 本次重点验证原子提交、部分输出持久化与后续轮次。数据库锁等待/故障作为异常测试：停止请求有限失败，日志指出阶段，不假报 idle。只有测试证明 Session SQL 本身导致本次无法有界收尾，才对该 SQL/事务补局部服务器端超时；不扩大为全库超时治理。

## 7. 保持 HTTP 契约，消除无限等待

保留现有 POST stream / POST sessions/:id/stop / GET history / GET events 和响应结构。

- stop 200 意味着取消收尾和 Session 释放已完成；无活跃执行仍按现有 stopped:false 幂等处理。
- stop 等待上限建议 20 秒，覆盖归属校验和执行收尾。异常使用现有 error 响应形式返回 503，消息明确“停止未确认”。后台取消继续，不能因 HTTP 等待超时提前释放。
- 客户端 stop 网络期限略长于 Server，建议 25 秒；失败退出无期限按钮等待、显示可重试状态，不能自动重发用户消息。
- 重试 stop 只确认/取消现有运行，不启动 Agent。Server 重启留下的 Operation，由现有下一轮 clearInterruptedOperation 取消-only恢复；测试必须保证取消后可继续、不重放工具。
- 用户归属检查保持在取消前；非法调用不能停止别人的会话。若请求预算在归属校验期间耗尽，后续校验返回不得再执行迟到的取消；已开始的取消绑定当时捕获的 Run 对象，不重新查找并取消后来的新轮次。

不新增状态查询或客户端轮询。在异常尚未确认时继续禁用新的聊天发送，保留重试停止；再次 stop 成功后恢复发送。已有 Session 的持久化/业务状态未收尾时，不把本地中断等同服务端成功。

## 8. H5 / iOS 的现有入口

点击停止后显示正在停止，暂停本轮后续内容展示并调用现有 stop。Server 即使客户端不主动断开 Reader 也必须完成取消；客户端关闭旧流仅是清理动作。

stop 成功后清理旧 Stream / runTask、标记 stopped 并恢复发送，再同步 History。History 读取失败保留本地已有内容并提供重试，不能继续锁住已经确认释放的 Session。

整轮超时收到 stopped，或失败收到 error 后，同样清理本轮状态、允许下一条消息。正常 done 继续只用于成功完成。

用现有 sessionId 和本地 controller/Task/message identity 防止旧 SSE、旧 History、旧 finally 修改新轮次或新会话；无需外部 runId 协议。stop 失败不得把本地消息标成确认停止，也不能把持续执行的 Run 当作发送空闲。

## 9. 最少但足够的日志

复用现有日志，记录 userId、sessionId、agentId、runId、operationId、traceId及已有业务 ID。需要能区分：请求接收/归属校验、取消请求、输出等待解除、Pi 收尾、历史保存、业务收尾、Session 释放、stop 返回。

取消来源记录 user_stop / run_timeout / stream_disconnected / caller_abort / output_wait_timeout；工具失败保留具体 errorCode 和阶段。输出等待超过阈值或 stop 等待超时记录 waitStage 和耗时，不记录每个 delta、原始消息、工具参数或密钥。复用工作区已存在的外部调用日志，不另建日志体系。

## 10. 一次完整验收后交付

| 场景 | 必须通过 |
| --- | --- |
| start / delta / message / tool / terminal 写入挂住 | stop 无需客户端取消 Reader 即可收尾；已接受内容不丢 |
| 无文字、流式文字、推理中、工具中停止 | 历史显示 stopped，Pi idle，同 Session 下一轮 completed |
| 整轮超时、模型失败、单工具超时 | 归类准确，无永久占用；本轮结束后可继续 |
| 重复 stop、自然完成与 stop 竞争、旧 finally | 收尾一次，不误释放或覆盖新轮次 |
| Creator / Proposal / Task Worker | 工具与业务事实保留，必要状态收敛后释放，通知顺序正确 |
| PG 保存、锁等待、失败和恢复 | 已提交事实准确，无提前释放或自动重放；异常有限返回 |
| Server 重启遗留 Operation | 现有取消-only恢复正常，随后可续聊 |
| H5 / iOS 停止与超时后发送、刷新、切会话、History 失败 | 下一条确实回复；刷新不丢历史；旧回调不覆盖新消息 |
| 用户隔离 | 非 owner 403，无取消副作用 |

验证必须用真实 Pi Harness，而不是只 mock abort；关键持久化用隔离 TEST_DATABASE_URL，不允许使用生产库测试。PG 取消集成跳过意味着验收未完成。H5 当前 test 占位，构建不能替代浏览器交互。

先做可重复自动测试，再做实际 HTTP socket 的快/慢/暂停读/断连验证和受控真实模型 smoke。最终必须在同 Session 连续完成至少 3 次“长回复→停止→继续→刷新”，以及“整轮超时→自动结束→继续→刷新”。正常依赖条件下验证 5 秒目标。

只在全部关键场景通过后统一提交交付，不逐个补丁发布。不承诺数据库不可用时仍成功保存；对此必须有限、明确失败。实施交付与部署分开：仅在用户授权部署时执行上线，并核对前后端版本后复验，不以本地测试冒充线上成功。

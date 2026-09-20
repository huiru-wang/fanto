# 接入验证记录

日期：2026-09-21；仓库 HEAD `bfba530`；Node v22.23.2；Pi core/ai/sqlite backend 0.85.1。

## 执行方式

```sh
node plan/2026-09-20-dynamic-context/probes/pi-context.mjs
pnpm --filter @fanto/agent exec tsx --test test/session-manager.test.ts
```

[探针源码](probes/pi-context.mjs) 创建临时 SQLite Session，通过真实 Pi Harness / lane 执行，用脚本模型 transport 产生工具调用和回复。无外部模型请求、无凭据读取、不修改业务数据库；finally 清理临时库。探针从仓库根执行，使用当前安装依赖的 dist 入口，属于固定版本接入证据，不是生产代码。

## 实际结果

探针 passed=true：完成 3 次 assistant 请求，另执行 1 次取消请求；动态回调共 4 次，实际 summary 请求 1 次。验证：

- 同一 run 的工具修改 Context 状态后，下次请求看到新偏好哨兵。
- 同一 Harness 的新 run 使用新的 Context 状态。
- 用户消息 entry_added 事件触发时 SQLite 已存在该消息，且先于首个模型请求/工具执行。
- 用户消息 parentId 指向本轮 fanto.run_source marker。
- 动态哨兵未写入 Session entry；内部 custom entry 未出现在模型 messages。
- 显式 compact 真正调用 summary transport；没有调用动态 systemPrompt 或 transform_context，summary 请求没有哨兵。
- lane.abort 到达 transport signal，未返回 completed。

已有 SessionManager 两项测试均通过：SQLite Session 恢复与用户归属检查；Agent 切换与工具配置恢复。

## 源码交叉核对

安装包路径相对 `apps/agent/node_modules/@earendil-works/pi-agent-core/dist/`：

| 路径 | 结论 |
| --- | --- |
| harness/runtime/drive/generation.js | 每次 prepareGeneration 调用 resolveSystemPrompt；随后 before_request，再执行请求 |
| harness/runtime/drive/structural.js | compaction / branch summary 走 completeSimple 与独立 summarization context |
| harness/runtime/transcript.js | 持久 entry 发布 message_end / entry_added 事件 |
| harness/hooks.js | 部分 hook 异常会报告后继续，不能只靠抛异常实现偏好写入权限校验 |

仓库 `apps/agent/src/http/agent-route.ts` 和 `tasks/task-runner.ts` 已在调用 prompt 前 reserve，finally release。prepare 必须放在此保护范围内。Task 当前没有 stream 的整轮 120s controller；本次为准备链路设置独立 deadline，不把现有 Task 声称为与 stream 完全相同的总超时语义。

## 不能由本次验证推出的结论

- 未验证真实模型遵守偏好、正确调用工具、召回质量或供应商延迟。
- 未实现/验证 Preferences Repository、HTTP、容量竞争和超时核对链路。
- 显式 compaction 已运行；自动 overflow 的入口由源码核对为同类 structural 路径，但没有运行真实 provider overflow，不标记为实测。
- 历史消息/工具内容仍可能包含旧偏好；动态块未写入不等于物理遗忘。
- 未执行生产数据库升级或部署，未推进 docs/.checkpoint。

T1 的基础 Pi 行为已经足够支持本文选择；完整应用接入仍需完成 [实施要点](implementation.md) 中的来源拒绝、准备阶段取消和自动召回等验收，不能用探针替代功能验收。

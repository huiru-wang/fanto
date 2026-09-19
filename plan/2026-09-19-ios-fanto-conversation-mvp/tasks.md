# iOS Agent 多轮对话 MVP 执行任务

依赖方案：`design.md`。本轮只验证 Session / History / SSE 多轮对话链路；Record、Memory、Creation、正式 Auth 均不属于本轮阻塞项。

## 1. 验证 Agent Runtime 联调链路

- 确认 Agent Runtime 对 iOS 可访问的 HTTPS/HTTP 地址、端口与 ATS 配置。
- 使用开发态固定测试用户和测试 Agent Token 验证创建 Session、`history?limit=20` 与 SSE 事件顺序。
- 固化当前 History 返回条目的必要字段和角色映射，避免按推测解码。

验收：三个接口在真机或同等网络环境中可调用；至少完成一次 3 轮手工连续对话；每类响应和错误各保留一份脱敏联调样本。

## 2. 增加 Agent 客户端配置与请求层

- 新增独立 `AgentAPIClient` 与配置类型，不改动现有 Creation API Client 的职责。
- 集中添加 `Authorization`、`X-User-Id`、`X-Trace-Id` 和 JSON 请求头。
- 将固定测试 Token 仅放入该客户端配置，禁止输出到日志、界面和文档。

验收：创建、历史与流式请求均走统一请求层；业务 Server 请求不受影响。

## 3. 实现默认 Session 持久化与恢复规则

- 使用 Keychain 以 `userId + agentId` 保存默认 `sessionId`。
- 实现“存在则恢复、缺失才创建、明确失效才清除并重建一次”的流程。
- 对网络失败、5xx、解析失败保持原 ID，不创建重复会话。

验收：连续冷启动不重复创建 Session；模拟 Session 404 后可自动恢复为一个新 Session；断网后不会产生新 Session。

## 4. 实现历史读取与消息映射

- 读取 `limit=20` 的历史，将服务端最新在前的数据转换为 UI 时间正序。
- 建立面向 UI 的消息模型，区分用户、助手、临时流式、失败和已停止状态。
- 仅渲染可见的用户/助手内容，不显示运行时内部 Entry 或工具数据。

验收：退出再进入 Fanto 时正确恢复最近消息；20 条之外不会自动请求或显示加载入口。

## 5. 实现 SSE 流式解析、互斥与取消

- 使用 `URLSession` 的流式读取能力解析 SSE 的 event/data 边界。
- 将 `delta` 追加到同一条临时助手消息；`done` 固化消息。
- `tool_start / tool_end` 等非本轮目标事件只需安全忽略或映射为统一“处理中”状态。
- 同一 Session 回复未结束前禁止第二次发送；提供停止并取消本次请求。

验收：至少覆盖 `start → delta* → done`、服务端 error、网络中断、用户停止、409 忙碌、未知事件六条路径，并确认不存在重复 delta 或消息乱序。

## 6. 建立 ConversationStore 及重试语义

- 将会话加载、发送、流式内容、错误、停止和重试收敛至独立 `ConversationStore`。
- 失败时保留用户消息和已收到的助手片段；“重试”必须由用户点击且只重放该轮原始输入。
- 页面离开时安全取消临时 Task，避免离屏状态写入。

验收：View 重建不会使流式状态错乱；错误与重试不会复制历史消息或创建新 Session。

## 7. 接入中间 Fanto Tab 与原生会话界面

- 将根导航调整为 `记录 / Fanto / 脉络`，保持既有记录和脉络入口、选中态及路由行为。
- 完成空状态、历史加载、消息列表、文本消息、输入框、发送/停止和错误重试界面。
- 处理键盘避让、流式自动滚动边界、Dynamic Type、VoiceOver 与减少动态效果。

验收：Fanto 在所有尺寸下保持中间 Tab；用户可完成多轮对话；查看旧消息时不会被流式内容强制抢回底部。本轮不投入复杂 Markdown、媒体消息、来源卡片或 Tool 状态 UI。

## 8. 10+ 轮多轮上下文验证

- 准备固定测试脚本：第 1～2 轮植入一个只存在于当前会话的临时事实 / 约束。
- 中间加入多个不同主题问题。
- 第 8～10+ 轮重新询问前文信息，验证同一 Session 上下文保持。
- 再创建独立测试 Session，用相同问题询问前一个 Session 中的临时事实，验证不会带入旧 Session 上下文。
- 中间穿插切 Tab、App 前后台切换和冷启动恢复。

验收：

```text
[ ] 同一 Session 连续 10+ 轮完成
[ ] 前文上下文可在后续轮次使用
[ ] 新 Session 不继承旧 Session 临时上下文
[ ] 切 Tab 后继续原 Session 正常
[ ] App 前后台切换后继续正常
[ ] 冷启动恢复历史后继续正常
```

这里只验证 Session 上下文，不把模型答错常识问题误判成客户端链路失败。

## 9. 故障与回归测试

- 为 Session 恢复分支、历史顺序、SSE 事件映射和失败重试补充单元测试或可注入的网络桩测试。
- 至少覆盖首次创建 Session、已有 Session 恢复、Session 明确失效后重建一次、history 网络失败、stream 网络中断、SSE error、用户 cancel、409 busy、连续快速点击发送和 retry 不复制 Session。
- 在模拟器与真机检查长文本、网络切换、后台再回来和冷启动。
- 回归记录和脉络的数据加载、详情页导航与底部 Tab 行为。

验收：iOS 工程可正常构建运行；故障不会清空已显示历史或创建重复 Session；既有记录与脉络能力无回归。

## 10. 实施完成后的当前文档刷新

- 根据最终代码和接口契约更新 `docs/clients/ios.md`，必要时更新 `docs/product/current-scope.md` 与 Agent API 文档。
- 按仓库的 docs checkpoint 流程审查实际变更后再推进 checkpoint。

验收：文档只描述已接入的 Agent 多轮对话能力，不把未实现的正式 Auth、Memory、长期记忆或跨设备会话写成现状。


# iOS 客户端

目录：`apps/ios/fanto`。当前使用 SwiftUI，最低部署目标为 iOS 26.5。

## 根导航

应用使用系统 `TabView`：

- 记录；
- Fanto；
- 脉络。

## 当前页面与数据来源

下表中的“已接”表示客户端代码已实现对应 API 调用，不表示当前公网部署一定可调用；当前硬编码的 `creation-demo-user` 与 Server / Agent 的 `default-user` allowlist 不一致，相关公网请求会返回 401。

| 能力 | 数据来源 | 当前状态 |
| --- | --- | --- |
| Record 列表 / 日历 / Timeline | `GET /api/records?limit=100` | Client 已接；当前演示 userId 与公网 allowlist 不一致 |
| 新建 Record | 本地 `FantoStore.addRecord` | 仅本地，不持久化到 Server |
| 媒体写入 | UI / model 占位 | 未形成 Server 上传链路 |
| Creation 概览 | `GET /api/creations/overview` | Client 已接；当前演示 userId 与公网 allowlist 不一致 |
| 按类型 Creation 列表 | `GET /api/creations?kindId=` | 已接 |
| Creation 详情 | `GET /api/creations/:id` | 已接 |
| Creation 来源 Record | `GET /api/creations/:id/records` | 已接分页 |
| Proposal 列表 / 详情 | `/api/creation-proposals` | 已接 |
| Proposal confirm / reject | 对应 POST 接口 | 已接 |
| Fanto 默认长期会话 | `POST /api/agent/sessions` | Client 已接；当前演示 userId 与公网 allowlist 不一致 |
| Fanto 最近历史 | `GET /api/agent/sessions/:id/history?limit=10` | 已接 iOS 客户端流程 |
| Fanto 文本流式回复 | `POST /api/agent/stream` | 已接 iOS 客户端流程 |

Record 首批最多读取 100 条，当前客户端据此生成日历标记和 Timeline；尚未实现继续加载整个 Record 历史。

## Fanto 对话

Fanto 位于根导航中间，只使用一个默认长期 Agent Session，不提供会话列表、切换或“开始新话题”。iOS 以开发态用户和 `main` Agent 为键将 Session ID 保存到 Keychain；进入 Fanto 时优先读取最近 10 条历史，仅在本地没有 ID，或服务端明确返回 Session 不存在 / 无权访问时创建新的 Session。

流式回复通过 SSE 增量追加到当前助手消息。界面覆盖加载、等待、统一处理中、流式生成、停止和失败重试；同一 Session 未完成回复时不能并发发送。当前只支持普通文本和换行展示，不包含 Markdown 富文本、媒体消息、来源卡片或 Agent Tool 产品化状态。

## Record UI

Record 日历以周日为一周起点，周视图 / 月视图共享同一日期选择状态。音频 Record 当前主要显示播放入口和时长；图片按已有媒体投影展示。

“新建记录”通过系统 sheet 打开 Composer，但保存动作当前只追加到本地 Store。不要把这一界面视为已经完成了 Server Record Create。

## 网络边界

`CreationAPIClient` 当前固定：

```text
baseURL = http://47.118.26.9
userID  = creation-demo-user
```

当前 Server / Agent 主运行入口只允许 `default-user`，因此这组 `creation-demo-user` 请求在当前公网部署下会返回 401。Debug 对当前 HTTP 服务配置 ATS 例外；正式上线前需要：

- HTTPS；
- 服务地址配置化；
- 正式认证 / 用户身份；
- 去除演示用户硬编码。

Agent Client 目前也指向同一地址下的 `/api/agent/*` 路径，并附带开发期测试凭据。客户端不会绕过 TLS 证书校验：若网关将 HTTP 重定向到 HTTPS，则该 HTTPS 证书必须被 iOS 系统信任；否则 Fanto 会显示网络失败状态，不能视为真机联调完成。

## Preview

SwiftUI Preview 可以使用 `FantoStore.preview` 样例数据。Preview 数据只用于界面开发，不代表运行态 Server 已具备对应自动生成能力。

# iOS 客户端

目录：`apps/ios/fanto`。当前使用 SwiftUI，最低部署目标为 iOS 26.5。

## 根导航

应用使用系统 `TabView`：

- 记录；
- Fanto；
- 脉络。

## 当前页面与数据来源

下表中的“已接”表示客户端代码已实现对应 API 调用，不表示当前公网部署一定可调用；当前硬编码测试用户为 `user001`，与 Server / Agent allowlist 一致。

| 能力 | 数据来源 | 当前状态 |
| --- | --- | --- |
| Record 列表 / 日历 / Timeline | `GET /api/records?limit=100` | Client 已接 |
| 新建 Record | 本地 `FantoStore.addRecord` | 仅本地，不持久化到 Server |
| 媒体写入 | UI / model 占位 | 未形成 Server 上传链路 |
| Creation 概览 | `GET /api/creations/overview` | Client 已接 |
| 按类型 Creation 列表 | `GET /api/creations?kindId=` | 已接 |
| Creation 详情 | `GET /api/creations/:id` | 已接 |
| Creation 来源 Record | `GET /api/creations/:id/records` | 已接分页 |
| Proposal 列表 / 详情 | `/api/creation-proposals` | 已接 |
| Proposal confirm / reject | 对应 POST 接口 | 已接 |
| Fanto 默认长期会话 | `POST /api/agent/sessions` | Client 已接 |
| Fanto 最近历史 | `GET /api/agent/sessions/:id/history?limit=10` | 已接 iOS 客户端流程 |
| Fanto 文本流式回复 | `POST /api/agent/stream` | 已接 iOS 客户端流程 |

Record 首批最多读取 100 条，当前客户端据此生成日历标记和 Timeline；尚未实现继续加载整个 Record 历史。

## Fanto 对话

Fanto 位于根导航中间，只使用一个默认长期 Agent Session，不提供会话列表、切换或“开始新话题”。iOS 以开发态用户和 `main` Agent 为键将 Session ID 保存到 Keychain；App 根导航出现后即开始预加载 Fanto Session 与最近 10 条历史，切入 Fanto 时若尚未完成才显示加载态。仅在本地没有 ID，或服务端明确返回 Session 不存在 / 无权访问时创建新的 Session。

流式回复通过 SSE 增量追加到当前助手消息。客户端按 SSE 原始字节流保留事件分隔，避免丢失连续的 `delta`；`turn_start` 与 `tool_start` 都映射为处理态，在尚无文字时显示“正在回想…”，开始收到 `delta` 后直接呈现正文。成功的 `present_media` Tool Result 会暂存至本轮 `done`，再合并进助手消息；历史恢复也会从同类 `toolResult` 重建媒体。旧会话正文中的 `fanto-media://<mediaId>` 图片和链接也会兼容投影为同类媒体。图片和语音分组呈现：图片使用横向缩略图，轻点后全屏分页查看；语音可在会话中播放。客户端只保存稳定的媒体 metadata，展示时才通过媒体读取接口取得短期签名地址，并在资源加载失败后刷新一次。界面覆盖加载、等待、流式生成、停止和失败重试；发送任务无论正常结束、失败或被意外取消，都会将占位消息收敛到明确终态，避免停留在等待状态。空回复也会明确失败并提供重试。同一 Session 未完成回复时不能并发发送。History decoder 已能容忍 Pi Assistant 的字符串或结构化 content，并只抽取可见 text，因此出现 toolCall block 时不会导致整页历史解码失败。助手消息复用 Creation 页面共用的原生 Markdown 视图渲染标题、段落与内联 Markdown；当前不包含来源卡片或其他 Agent Tool 产品化状态。

## Record UI

Record 日历以周日为一周起点，周视图 / 月视图共享同一日期选择状态。轻点顶部“月 · 年”会以系统 sheet 打开年月滚轮，确认后保留可用的当月日期并同步周历 / 月历定位。日历区域横滑可按当前视图切换前后周或前后月；视觉翻页箭头不显示，但 VoiceOver 保留等价操作。音频 Record 当前主要显示播放入口和时长；图片缩略图按需通过媒体读取接口取得短期签名地址。轻点缩略图会全屏展示图片；多张图片可左右分页切换。签名地址只保留在视图运行态，图片请求失败时会刷新地址并重试一次。

“新建记录”通过系统 sheet 打开 Composer，但保存动作当前只追加到本地 Store。不要把这一界面视为已经完成了 Server Record Create。

## 网络边界

`CreationAPIClient` 当前固定：

```text
baseURL = https://fanto.robinverse.me
userID  = user001
```

当前 Server / Agent 主运行入口只允许 `user001`，与 iOS 测试用户一致。正式上线前仍需要：

- 服务地址配置化；
- 正式认证 / 用户身份；
- 去除演示用户硬编码。

Agent Client 目前也指向同一域名下的 `/api/agent/*` 路径，并附带开发期测试凭据。客户端不会绕过 TLS 证书校验；HTTPS 证书必须被 iOS 系统信任，否则 Fanto 会显示网络失败状态，不能视为真机联调完成。

## Preview

SwiftUI Preview 可以使用 `FantoStore.preview` 样例数据。Preview 数据只用于界面开发，不代表运行态 Server 已具备对应自动生成能力。

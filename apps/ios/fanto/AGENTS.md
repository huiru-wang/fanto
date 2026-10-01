# iOS Agent Guide

适用于 `apps/ios/fanto/`。当前能力与数据来源见 `../../../docs/clients/ios.md`。

## 当前约束

- 使用 SwiftUI，当前最低部署目标为 iOS 26.5。
- 根导航使用系统 `TabView`，当前为“记录 / Fanto / 脉络”三个 Tab；认证页不属于 Tab 导航。
- 优先使用系统导航、Sheet、语义颜色与原生交互，不用自定义覆盖层替代系统组件。
- 运行态数据应以 Server API 为准；Preview 可以使用样例数据，但不能把 Preview / 本地样例包装成已经接入的真实能力。
- 当前“新建记录”仍只写入本地 `FantoStore`；除非同时完成真实 API 接入，不要把它描述成服务端持久化。
- API Client 使用 HTTPS 公网域名；正式运行态身份统一来自 Fanto access JWT，不再允许客户端通过 `x-user-id` 或固定测试 token 指定用户。
- Google 登录依赖 `Supporting/Info-*.plist` 中的 iOS Client ID、Server Client ID 与 reversed URL scheme；占位值只能用于未配置构建，真机登录前必须替换。
- Apple 登录依赖 `fanto/fanto.entitlements` 中的 Sign in with Apple capability；Server 的 `APPLE_ALLOWED_CLIENT_IDS` 必须包含 iOS Bundle ID。
- 已认证用户在进入根导航前会显示与登录页一致的品牌启动页，并并发预读取 Records、Creations / Proposals 和 Fanto 最近会话；读取失败不能阻塞进入主界面，页面自行呈现既有失败与重试状态。

## UI / 状态约束

- Record 日历以周日为一周起点。
- Record 页面提供日历与连续时间线两种视图；日历日期选择与时间线数据都以同一 `FantoStore.records` 为事实来源。
- 连续时间线按本地日历日倒序分组，底部基于 Server `nextCursor` 自动追加更早记录；追加失败不能清空当前已显示数据。
- Creation / Proposal 页面只展示服务端真实返回的数据。
- 音频 Record 当前主要展示播放动作与时长，不在客户端自行生成 AI 摘要。
- Fanto 对话须按 Server 的 SSE `presentation` 渲染可见进度；`create_task` 与 `collect_user_input` 的结构化结果分别渲染为任务卡和导航区域下方的逐题表单。`required: false` 的表单项允许跳过；不展示内部工具参数、结果或 interaction 标记。任务详情使用现有受保护 Task / TaskRun 接口按需读取，不新增独立任务管理页；交付文件在详情 Sheet 的既有导航栈内预览，不叠加第二个 Sheet。已完成任务的详情与成果内容仅在当前账号的 App 运行期内缓存，用户手动刷新或切换账号时再读取 / 清空。

修改网络契约前先核对 `../../../docs/api/http-api.md`。

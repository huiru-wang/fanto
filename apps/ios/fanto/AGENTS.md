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

## UI / 状态约束

- Record 日历以周日为一周起点。
- 周历与月历共用同一日期选择状态，不建立两套互相漂移的 selection。
- Creation / Proposal 页面只展示服务端真实返回的数据。
- 音频 Record 当前主要展示播放动作与时长，不在客户端自行生成 AI 摘要。
- Fanto 对话须按 Server 的 SSE `presentation` 渲染可见进度；`create_task` 与 `collect_user_input` 的结构化结果分别渲染为任务卡和表单，不展示内部工具参数、结果或 interaction 标记。任务详情使用现有受保护 Task / TaskRun 接口按需读取，不新增独立任务管理页。

修改网络契约前先核对 `../../../docs/api/http-api.md`。

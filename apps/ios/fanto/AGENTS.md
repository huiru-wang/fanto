# iOS Agent Guide

适用于 `apps/ios/fanto/`。当前能力与数据来源见 `../../../docs/clients/ios.md`。

## 当前约束

- 使用 SwiftUI，当前最低部署目标为 iOS 26.5。
- 根导航使用系统 `TabView`，当前为“记录 / Fanto / 脉络”三个 Tab。
- 优先使用系统导航、Sheet、语义颜色与原生交互，不用自定义覆盖层替代系统组件。
- 运行态数据应以 Server API 为准；Preview 可以使用样例数据，但不能把 Preview / 本地样例包装成已经接入的真实能力。
- 当前“新建记录”仍只写入本地 `FantoStore`；除非同时完成真实 API 接入，不要把它描述成服务端持久化。
- 当前 API Client 仍硬编码 HTTP ECS 地址和 `creation-demo-user`；当前 Server / Agent 公网运行入口只允许 `default-user`，因此该客户端在当前部署配置下会被拒绝。正式上线前需要 HTTPS、配置化服务地址与正式认证。

## UI / 状态约束

- Record 日历以周日为一周起点。
- 周历与月历共用同一日期选择状态，不建立两套互相漂移的 selection。
- Creation / Proposal 页面只展示服务端真实返回的数据。
- 音频 Record 当前主要展示播放动作与时长，不在客户端自行生成 AI 摘要。

修改网络契约前先核对 `../../../docs/api/http-api.md`。

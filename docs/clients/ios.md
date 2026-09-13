# iOS 客户端

目录：`apps/ios/fanto`。使用 SwiftUI，最低部署目标为 iOS 26.5，底部为系统 `TabView` 的「记录 / 脉络」。

## 页面与数据来源

| 页面 | 数据来源 | 状态 |
| --- | --- | --- |
| 记录 | `FantoStore.records` 内存数组 | 本地演示；新建记录不会请求服务。 |
| 新记录 | 本地 Store | 支持文字与位置开关；附件仅占位。 |
| 脉络首页 | `/api/creations/overview` | 已接入只读加载、下拉刷新、失败重试。 |
| 脉络详情 | `/api/creations/:id` 与 `/records` | 已接入正文、状态与来源记录分页。 |
| Proposal 卡片 | Preview 数据 | 服务未提供 Proposal 路由，运行时不会展示真实 Proposal。 |

记录页日历以周日为一周起点，支持周行 / 整月切换；当前仅渲染内存记录。音频 UI 只显示播放动作和时长，不显示摘要。

## 本地服务连接限制

`CreationAPIClient` 当前固定使用 `http://localhost:3000` 和演示用户 `creation-demo-user`。

- 在 iOS 模拟器中，需先启动本机服务。
- 在真机中，`localhost` 指向手机自身，不能访问 Mac 的服务；因此当前实现无法直接读取本机数据。
- 当前客户端没有服务地址配置、正式身份认证或生产网络策略。

这些限制应在真机联调前通过可配置开发地址、局域网或安全隧道以及正式认证统一处理。

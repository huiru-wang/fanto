# iOS 客户端

目录：`apps/ios/fanto`。使用 SwiftUI，最低部署目标为 iOS 26.5，底部为系统 `TabView` 的「记录 / 脉络」。

## 页面与数据来源

| 页面 | 数据来源 | 状态 |
| --- | --- | --- |
| 记录 | `/api/records` 首批最多 100 条 | 已接入启动加载、下拉刷新、日历标记与按天 Timeline。 |
| 新记录 | 本地 Store | 支持文字与位置开关；保存尚不会请求服务，附件仅占位。 |
| 脉络首页 | `/api/creations/overview` | 已接入加载、下拉刷新、失败重试。 |
| 脉络详情 | `/api/creations/:id` 与 `/records` | 已接入正文、状态与来源记录分页。 |
| Proposal 卡片 | `/api/creation-proposals` | 已接入真实待确认卡片；长期跟踪/暂不保留会请求服务端并刷新脉络。 |

记录页日历以周日为一周起点，支持周行 / 整月切换；当前加载记录接口的首批 100 条并据此展示日历标记和 Timeline。音频 UI 只显示播放动作和时长，不显示摘要。

## 本地服务连接限制

`CreationAPIClient` 当前固定使用 `http://47.118.26.9` 和演示用户 `creation-demo-user`。

- Debug 构建为当前 HTTP ECS 服务设置了 ATS 例外；Release 构建保持 ATS 默认安全策略，因此必须改用 HTTPS。
- 当前客户端没有服务地址配置或正式身份认证。

上线前应由 ECS 提供 HTTPS，并把服务地址与身份认证统一配置化。

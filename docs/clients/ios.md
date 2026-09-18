# iOS 客户端

目录：`apps/ios/fanto`。当前使用 SwiftUI，最低部署目标为 iOS 26.5。

## 根导航

应用使用系统 `TabView`：

- 记录；
- 脉络。

## 当前页面与数据来源

| 能力 | 数据来源 | 当前状态 |
| --- | --- | --- |
| Record 列表 / 日历 / Timeline | `GET /api/records?limit=100` | 已接真实 Server |
| 新建 Record | 本地 `FantoStore.addRecord` | 仅本地，不持久化到 Server |
| 媒体写入 | UI / model 占位 | 未形成 Server 上传链路 |
| Creation 概览 | `GET /api/creations/overview` | 已接 |
| 按类型 Creation 列表 | `GET /api/creations?kindId=` | 已接 |
| Creation 详情 | `GET /api/creations/:id` | 已接 |
| Creation 来源 Record | `GET /api/creations/:id/records` | 已接分页 |
| Proposal 列表 / 详情 | `/api/creation-proposals` | 已接 |
| Proposal confirm / reject | 对应 POST 接口 | 已接 |

Record 首批最多读取 100 条，当前客户端据此生成日历标记和 Timeline；尚未实现继续加载整个 Record 历史。

## Record UI

Record 日历以周日为一周起点，周视图 / 月视图共享同一日期选择状态。音频 Record 当前主要显示播放入口和时长；图片按已有媒体投影展示。

“新建记录”通过系统 sheet 打开 Composer，但保存动作当前只追加到本地 Store。不要把这一界面视为已经完成了 Server Record Create。

## 网络边界

`CreationAPIClient` 当前固定：

```text
baseURL = http://47.118.26.9
userID  = creation-demo-user
```

Debug 对当前 HTTP 服务配置 ATS 例外；正式上线前需要：

- HTTPS；
- 服务地址配置化；
- 正式认证 / 用户身份；
- 去除演示用户硬编码。

## Preview

SwiftUI Preview 可以使用 `FantoStore.preview` 样例数据。Preview 数据只用于界面开发，不代表运行态 Server 已具备对应自动生成能力。

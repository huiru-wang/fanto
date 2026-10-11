# iOS Agent Guide

适用于 `apps/ios/fanto/`。当前能力与数据来源见 `../../../docs/clients/ios.md`。

## 当前约束

- 使用 SwiftUI，当前最低部署目标为 iOS 26.5。
- 根导航使用系统 `TabView`，当前为“记录 / Fanto / 脉络”三个 Tab；认证页不属于 Tab 导航。
- 优先使用系统导航、Sheet、语义颜色与原生交互，不用自定义覆盖层替代系统组件。
- 运行态数据应以 Server API 为准；Preview 可以使用样例数据，但不能把 Preview / 本地样例包装成已经接入的真实能力。
- “新建记录”可选择记录发生的日期与时间；打开后会尝试一次前台定位并给出可编辑地点建议。用户可移除定位建议，或通过搜索结果、地图选点与当前位置编辑地点。地点保留本体、国家、省/州、城市、区和坐标；地点卡紧接正文与图片，展示地点本体和行政区。创建页只支持文字与最多 5 张图片，不提供录音入口。媒体上传后创建 Server Record，并以最新列表刷新本地 Store；缓存不能替代服务端事实来源。
- API Client 使用 HTTPS 公网域名；正式运行态身份统一来自 Fanto access JWT，不再允许客户端通过 `x-user-id` 或固定测试 token 指定用户。
- Google 登录依赖 `Supporting/Info-*.plist` 中的 iOS Client ID、Server Client ID 与 reversed URL scheme；占位值只能用于未配置构建，真机登录前必须替换。
- Apple 登录依赖 `fanto/fanto.entitlements` 中的 Sign in with Apple capability；Server 的 `APPLE_ALLOWED_CLIENT_IDS` 必须包含 iOS Bundle ID。
- 已认证用户在进入根导航前会显示与登录页一致的品牌启动页，并并发预读取 Records、Projects 和 Fanto 最近会话；Record 会先恢复当前用户受文件保护的本地快照、再由 Server 覆盖。读取失败不能阻塞进入主界面，页面自行呈现既有失败与重试状态。

## UI / 状态约束

- Record 日历以周日为一周起点。
- Record 页面提供日历与连续时间线两种视图；日历日期选择与时间线数据都以同一 `FantoStore.records` 为事实来源。
- 日历默认显示周历；周历下滑展开月历，月历上滑收回周历，两种形态横滑时必须同步移动选中日期，且 VoiceOver 需保留等价操作。
- 连续时间线按本地日历日倒序分组，底部基于 Server `nextCursor` 自动追加更早记录；追加失败不能清空当前已显示数据。
- 日历与时间线支持长按记录确认删除，使用服务端 version；成功后移除本地 Record 并保存快照，版本冲突刷新后需重新确认。取消网络请求不展示为失败；静默建议刷新保留既有内容，旧请求不得覆盖新状态。
- Record 快照按当前认证用户隔离，最多保留最近 200 条；新增与成功分页后写回快照，认证失效或账号切换时清除。未来接入更新入口时，必须在对应写入成功后同步更新或失效该快照。
- 脉络页区分 Proposal 与 Project；建议决策走 Proposal API，项目详情从单个详情响应读取参考记录，不请求 Project records 接口。项目 html-preview 必须禁用脚本、桥接、任意网络资源和导航；内部图片走受保护媒体接口，签名 URL 只保留运行态。
- 脉络页跟进新建议；后台提议分析全程静默，信息不足时不提议。Project 详情读取通用 Session History，后台过程订阅只读 Events，继续创作走统一 Agent Stream，并与主对话共享 Tool Presentation/消息 UI；已有作品右下角允许进入同一 Project Session 继续对话，项目内容以 Server 当前版本为准。
- 音频 Record 当前主要展示播放动作与时长，不在客户端自行生成 AI 摘要。
- 停止对话调用通用 Session stop 接口，等待服务端取消与记录保存后才恢复发送；历史的 `state: stopped` 恢复为已停止消息，空输出也需保留停止状态。
- Fanto 对话按 SSE message_start/message_end 划分文本块，与工具和任务按事件顺序展示，仅 done 表示回复完成；须按 Server 的 SSE `presentation` 渲染可见进度；`create_task` 与 `collect_user_input` 的结构化结果分别渲染为任务卡和导航区域下方的逐题表单。`required: false` 的表单项允许跳过；不展示内部工具参数、结果或 interaction 标记。对话初次出现时定位到最新消息，向上滚动到历史顶部时使用 Server `nextCursor` 读取更早页，并保持阅读位置。任务详情使用现有受保护 Task / TaskRun 接口按需读取，不新增独立任务管理页；交付文件在详情 Sheet 的既有导航栈内预览，不叠加第二个 Sheet。已完成任务的详情与成果内容仅在当前账号的 App 运行期内缓存，用户手动刷新或切换账号时再读取 / 清空。

修改网络契约前先核对 `../../../docs/api/http-api.md`。

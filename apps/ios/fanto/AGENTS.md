# iOS Agent Guide

适用于 `apps/ios/fanto/`。当前能力与数据来源见 `../../../docs/clients/ios.md`。

## 当前约束

- 使用 SwiftUI，当前最低部署目标为 iOS 26.5。
- 根导航使用系统 `TabView`，当前为“记录 / Fanto / 我的”三个 Tab，默认进入 Fanto；“脉络”入口隐藏；认证页不属于 Tab 导航。
- 优先使用系统导航、Sheet、语义颜色与原生交互，不用自定义覆盖层替代系统组件。
- 运行态数据应以 Server API 为准；Preview 可以使用样例数据，但不能把 Preview / 本地样例包装成已经接入的真实能力。
- “新建记录”可选择记录发生的日期与时间；打开后会尝试一次前台定位并给出可编辑地点建议。用户可移除定位建议，或通过搜索结果、地图选点与当前位置编辑地点。地点保留本体、国家、省/州、城市、区和坐标；地点卡紧接正文与图片，展示地点本体和行政区。创建页只支持文字与最多 5 张图片，不提供录音入口。媒体上传后创建 Server Record，并以最新列表刷新本地 Store；缓存不能替代服务端事实来源。
- API Client 使用 HTTPS 公网域名；正式运行态身份统一来自 Fanto access JWT，不再允许客户端通过 `x-user-id` 或固定测试 token 指定用户。
- Google 登录依赖 `Supporting/Info-*.plist` 中的 iOS Client ID、Server Client ID 与 reversed URL scheme；占位值只能用于未配置构建，真机登录前必须替换。
- Apple 登录依赖 `fanto/fanto.entitlements` 中的 Sign in with Apple capability；Server 的 `APPLE_ALLOWED_CLIENT_IDS` 必须包含 iOS Bundle ID。
- 已认证用户在进入根导航前会显示与登录页一致的品牌启动页，并并发预读取 Records 和 Fanto 最近会话，不预加载隐藏的 Projects；Record 会先恢复当前用户受文件保护的本地快照、再由 Server 覆盖。读取失败不能阻塞进入主界面，页面自行呈现既有失败与重试状态。

## UI / 状态约束

- “我的”使用系统 NavigationStack、List / Form、语义字号和 SF Symbols；不自绘导航栏、返回按钮或底部 Tab。点击昵称编辑用户头像、昵称、单行签名。用户资料走独立 Profile API，不复用 Fanto 设置。
- 用户头像 purpose=user_avatar；裁切页只上传裁切结果，编辑页点击保存后统一绑定头像与文字。保存失败保留草稿，版本冲突需确认；系统返回后的未保存草稿只保留在当前账号运行态，不跨账号或 App 重启。
- 外观和强调色使用原生 Menu / Picker，当场生效；外观仅跟随系统 / 浅色 / 深色，强调色仅十种预设，均保存到设备 UserDefaults。深色中黑色强调色使用语义前景保证可读。
- 账号页读取本人登录方式并支持退出；退出清除 Keychain 与当前账号缓存，进行中的 Token 刷新不得恢复已退出会话。数据与隐私目前为说明页，无导出、注销或记忆管理入口。

- Fanto 设置只从主对话左上头像与昵称进入，右上不保留设置图标。基本资料和四项角色编辑使用版本化 Fanto Settings API；失败保留草稿，版本冲突必须明确处理。角色编辑器限制可视高度、允许换行并在框内滚动。
- 头像使用 PhotosPicker 选择新图，圆形预览支持拖动和缩放；点击裁切页保存后仅上传裁切 JPEG 并立即绑定，保留未保存的文字草稿。不保存原图、不提供下载或重新裁切旧头像。头像 purpose=fanto_avatar，与 Record 附件隔离。
- 对话正文与 Project Session 共用无气泡头像消息行；主对话读取个性头像，Project Session 保留品牌头像。输入框使用独立的原生 Liquid Glass，保留减少透明度替代样式。

- Record 日历以周日为一周起点。
- Record 页面提供日历与连续时间线两种视图；日历日期选择与时间线数据都以同一 `FantoStore.records` 为事实来源。
- 日历默认显示周历；周历下滑展开月历，月历上滑收回周历，两种形态横滑时必须同步移动选中日期，且 VoiceOver 需保留等价操作。
- 连续时间线按本地日历日倒序分组，底部基于 Server `nextCursor` 自动追加更早记录；追加失败不能清空当前已显示数据。
- 日历与时间线支持长按记录确认删除，使用服务端 version；成功后移除本地 Record 并保存快照，版本冲突刷新后需重新确认。取消网络请求不展示为失败；静默建议刷新保留既有内容，旧请求不得覆盖新状态。
- Record 快照按当前认证用户隔离，最多保留最近 200 条；新增与成功分页后写回快照，认证失效或账号切换时清除。未来接入更新入口时，必须在对应写入成功后同步更新或失效该快照。
- 脉络入口当前隐藏，相关页面代码保留；以下是保留模块的约束，不代表当前有可见入口。脉络页区分 Proposal 与 Project；建议决策走 Proposal API，项目详情从单个详情响应读取参考记录，不请求 Project records 接口。项目 html-preview 必须禁用脚本、桥接、任意网络资源和导航；内部图片走受保护媒体接口，签名 URL 只保留运行态。
- 脉络页的待确认 Proposal 使用堆叠卡片，按服务端顺序上下滑动浏览，保留按钮与 VoiceOver 等价操作；切换不执行接受 / 拒绝，刷新时保持当前 Proposal 身份。
- 脉络页跟进新建议；后台提议分析全程静默，信息不足时不提议。Project 详情读取通用 Session History，后台过程订阅只读 Events，继续创作走统一 Agent Stream，并与主对话共享 Tool Presentation/消息 UI；已有作品右下角允许进入同一 Project Session 继续对话，项目内容以 Server 当前版本为准。
- 音频 Record 当前主要展示播放动作与时长，不在客户端自行生成 AI 摘要。
- 停止调用通用 Session stop：202 表示请求已接受、工具仍在结束，保持原 SSE，显示“正在结束当前操作”，可编辑草稿但不可发送；终态或 History 确认空闲后恢复发送，不等数据库历史保存。已开始工具不被用户停止中断。旧请求不得覆盖新轮次；History 的 stopped 部分回复须恢复，断线核对 running/stopping，不自动重发。
- 对话图片预览读取 thumbnail，点击全屏查看读取 original；音频读取原始媒体。
- Fanto 对话按 SSE message_start/message_end 划分文本块，与工具活动按事件顺序展示，仅 done 表示回复完成；须按 Server 的 SSE `presentation` 渲染可见进度；`collect_user_input` 的结构化结果渲染为导航区域下方的逐题表单。`required: false` 的表单项允许跳过；不展示内部工具参数、结果或 interaction 标记。对话初次出现时定位到最新消息，向上滚动到历史顶部时使用 Server `nextCursor` 读取更早页，并保持阅读位置。不提供 Task 页面、Task 卡片或 Task 文件预览。

修改网络契约前先核对 `../../../docs/api/http-api.md`。

- Record 附件草稿保留上传凭据和阶段；失败不自动重试，统一提示“保存失败，请重试”，用户再次保存后才继续。图片 ready 包含服务端小图完成，客户端通过 variant 选择读取。

- 主对话断线、前台恢复和载入运行中会话时核对 History `running`；恢复期间保留内容、锁住发送，空闲后补载历史，不自动重放 POST。Tab 切换保持根视图持有的 ConversationStore 和运行任务。

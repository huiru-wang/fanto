# iOS 客户端

目录：`apps/ios/fanto`。当前使用 SwiftUI，最低部署目标为 iOS 26.5。

## 根导航

应用使用系统 `TabView`：

- 记录；
- Fanto；
- 我的。

每次启动默认进入记录页。中间 Tab 显示当前 Fanto 昵称和圆形头像，保存后随共享设置更新；仅 Tab 标题在超过 6 个字符时截断，其他位置保留完整昵称。头像复用账号图片缓存并保留原色，未设置时显示品牌头像，加载失败保留当前图标；选中态使用系统 Tab 栏及强调色。主界面独立读取用户资料，失败不阻止对话。

导航返回及确认控件使用语义主前景色，不跟随强调色；保存 / 确认操作使用原生对勾图标并保留无障碍名称；普通尾部工具栏的玻璃背景保持一致，未修改 / 保存中为灰色禁用，合法修改后为语义主前景色可点击。List / Form 以系统 44pt 最小行高作为共同基线，内容随 Dynamic Type 自适应。Fanto 设置与个人信息等 push 页面保持系统 Tab 栏，不在返回动画后再恢复底部栏；主对话只做一次初始消息定位，返回时保持原阅读位置。

## 用户中心

“我的”顶部不显示标题文字，保留系统导航结构，使用原生 NavigationStack 与 insetGrouped List，使用系统语义字号、SF Symbols、系统 Tab 和导航栏的 Liquid Glass，不复刻原型中的自绘栏。背景图全宽延伸至顶部安全区，滚动时随内容退场并恢复系统导航材质；默认使用内置夕阳图，在个人信息页通过“背景图”名称、小缩略图和箭头组成的紧凑设置行选择新图，也可恢复默认。空头像使用系统人物图标，资料来自当前账号，不使用原型中的样例人名、照片或固定天数。顶部用三列“相伴天数 / 记录数 / 亲密度”取代相伴提示语，读取 `GET /api/users/me/statistics?timeZone=<设备时区>`；天数与全部记录总数来自服务端，亲密度暂用接口固定值12。未读取到统计显示破折号，失败保留缓存；不显示构建号或新增图表。

点击昵称进入原生 Form 编辑页，编辑头像、背景图、昵称、签名；照片通过系统 PhotosPicker 选择，再复用圆形裁切。裁切只上传 user_avatar 用途的 JPEG，小图 ready 后立即提交头像绑定；背景图支持4:3取景并仅上传裁切结果（最多1600×1200、2 MiB），头像 / 背景图裁切上传成功后立即只 PATCH 对应媒体字段，确认绑定后关闭裁切页；资料首页没有统一保存按钮。昵称与签名通过设置行进入各自二级页，输入框带字数计数和限制说明，右上对勾单独保存。每次只提交正在编辑的字段，不携带其他媒体 ID 或文本；失败保留当前页输入并显示实际错误，不能把上传成功当成绑定成功。版本冲突只处理当前项，不覆盖其他项；退出单项页即放弃未保存输入。

偏好仅有外观和强调色，均使用原生 Menu / Picker，左侧名称不作为弹出来源，展开菜单仍保留行名称；偏好和账号列表使用相同的系统默认行高，列表图标使用语义主前景色，不跟随强调色；候选色使用原色位图色点，避免菜单把所有 SF Symbol 色点统一染色。外观仅系统（默认）、浅色、深色，强调色仅蓝、青、绿、青柠绿、黄、橙、粉、洋红、紫。选择当场生效，设备 UserDefaults 持久化，不写入账号资料；同一账号不同设备可有不同偏好。强调色采用适应浅深色的可读前景；旧的黑色偏好回退为蓝色。

账号与登录读取 `GET /api/users/me`，原有退出功能保留，底部增加尚未开放的注销账号入口。“我的”、数据与隐私和 Fanto 设置使用无标题的设置分块。数据与隐私仅保留存储与缓存、导出我的数据及数据处理与授权入口，不提供系统权限项或资料说明块。“帮助与反馈”独立提供使用帮助、问题反馈、联系支持；“关于”独立提供关于 Fanto、使用条款、隐私政策，不显示宣传语或开始相处说明。使用帮助、使用条款、隐私政策通过系统浏览器分别打开 `https://fanto.robinverse.me/help`、`/terms`、`/privacy`，这三个官网路径已约定，网页内容后续发布。关于详情仅展示版本号，不显示构建号；其余未实现能力显示即将开放的说明占位页，不执行操作或展示虚构状态。个人资料契约见 [Users](../domain/users.md)。

## 当前页面与数据来源

下表中的“已接”表示客户端代码已实现对应 API 调用，不表示当前公网部署一定可调用。iOS 运行态业务请求统一携带 `Authorization: Bearer <sessionToken>`，用户身份只由服务端 `auth_sessions` 验证结果决定。

| 能力 | 数据来源 | 当前状态 |
| --- | --- | --- |
| Record 列表 / 日历 / 连续时间线 | `GET /api/records?limit=30&cursor=` | Client 已接分页 |
| 删除 Record | `DELETE /api/records/:id`，携带 expectedVersion | 日历 / 时间线长按确认，成功后更新列表与快照 |
| 新建 Record | 已授权且无草稿地点时获取一次当前位置；媒体上传后调用 `POST /api/records`，再刷新列表 | Client 已接 |
| 媒体写入 | `POST /api/uploads` 申请凭据，直传后调用 `POST /api/uploads/:mediaId/complete` | Client 已接 |
| Fanto 默认长期会话 | `POST /api/agent/sessions` | Client 已接 |
| Fanto 最近历史 | `GET /api/agent/sessions/:id/history?limit=10` | 已接 iOS 客户端流程 |
| Fanto 文本流式回复 | `POST /api/agent/stream` | 已接 iOS 客户端流程 |
| 用户个人资料 | `GET/PATCH /api/users/me/profile`、purpose=user_avatar 的 Media 上传 | 读取、版本化保存与头像裁切已接 |
| 用户统计 | `GET /api/users/me/statistics`，当前 Session 对应账号与设备时区 | 天数 / 总记录数已接，亲密度为占位值 |
| 账号与登录 | `GET /api/users/me`，`POST /api/auth/native/logout` 服务端撤销后清 Keychain | 身份展示、退出已接 |
| Fanto 设置 | `GET/PATCH /api/fanto/settings`、purpose=fanto_avatar 的 Media 上传 | 已接基本资料、头像裁切和四项角色配置，版本冲突显式处理 |

Record 首批读取 30 条，客户端据此生成日历标记和两种视图；服务端返回 `nextCursor`，连续时间线在滚动到底部时基于 cursor 自动读取并追加更早记录。追加页会按 Record ID 去重并按事件时间倒序排列；追加失败保留已显示记录并在底部提供重试。当前账号最近 200 条已读取 Record 会以受 iOS 文件保护的数据快照保存在 Application Support；认证后的启动过程先恢复该快照，再以服务端首屏结果覆盖。新增与每次成功分页后都会更新快照；认证失效或账号切换时清除该账号快照。记录携带服务端 version；旧快照缺少版本时先读取最新 Record 再删除。删除成功或服务端已不存在时移除本地数据并保存快照，已删除 ID 不允许被进行中的分页请求重新加入；版本冲突刷新列表并要求重新确认。


## 客户端缓存

采用启动同步、运行期间复用、保存后定向写回，不使用定时刷新或资料 TTL。Fanto 设置、用户资料、用户统计与账号登录方式由根视图持有共享 Store：每个认证后的 App 会话先恢复当前账号 JSON 快照，再各自读取一次最新服务端数据；页面进入及 Tab 切换只复用结果，并发读取共享进行中的请求。用户资料下拉刷新及读取失败后的重试可显式请求服务端，并同步更新统计。记录新增 / 删除成功后单独刷新统计，统计不使用已加载分页的条数。失败保留已有内容；保存接口的完整响应直接写回内存与磁盘，旧版本及保存前发出的旧查询不能覆盖新状态。单项页草稿与已保存快照分开，后台资料更新不覆盖当前输入；写入不提交其他字段，丢失响应时读取当前项确认，未确认前不能伪装成功。

Fanto / 用户头像、用户背景图、记录和对话图片共用 `MediaImageCache`：先查已解码内存，再查压缩文件，最后才获取签名地址并下载。缓存键为当前账号命名空间内的 `mediaId + variant`，不使用签名 URL 或资料 version；媒体变更通过新 ID 切换，不重新下载已有图片。裁切上传成功后以本地 JPEG 预热两种 variant，再按原保存语义绑定资料。缩略图与展示原图分别限制解码尺寸为 512 / 2560 像素长边；原文件保存在磁盘。内存图片预算 32 MiB，磁盘图片预算每账号 150 MiB，按最近访问淘汰；JSON 与图片位于受文件保护、可由系统清理的 `Library/Caches/FantoAccountCache/v1`。缓存不可用时按需重建，不作为永久离线存储。

签名 URL 仅在内存复用，按接口 `expiresAt` 在即将过期时按需换取，没有刷新计时器；已命中图片文件时不请求签名。主动业务 API 请求绕过系统 HTTP 响应缓存，以服务端响应为准。退出或认证失效时立即使账号缓存作用域失效并清理文件，旧会话的网络响应、上传预热和磁盘写入不得进入新会话。

记录继续使用现有最近 200 条快照、启动 / 手动刷新及增删后的同步逻辑；对话继续保留运行态消息和已有 History / SSE 恢复逻辑，不新增消息磁盘缓存，不缓存生成中状态。外观与强调色继续保存在设备 UserDefaults，凭据继续保存在 Keychain。

## Google 登录与账号状态

App 启动后先进入认证 Gate：

- Keychain 仅保存服务端单个不透明 Session Token 和最少必要用户元数据；旧双 JWT Keychain 数据直接清除并要求重新登录。
- 冷启动从 Keychain 取 Token，再以 Bearer `GET /api/users/me` 在线验证身份；验证通过才恢复登录状态与账号缓存、进入应用。网络错误进入可重试启动状态，不擅自删除 Token；401 明确认证失效时清理 Keychain 并回到登录页。
- 请求始终使用同一个 Session Token，不再以客户端日期判断 Access JWT 过期或调用 Refresh。服务器 7 天空闲/30 天绝对过期时需要重新认证。
- “我的 → 账号与登录”读取当前账号登录方式；退出先调用 `/api/auth/native/logout` 在 Server 撤销当前 Session，成功后清 Keychain 与当前账号缓存。撤销失败保留 Token、停止新请求并提供重试，不能伪装为服务端登出成功。

认证 Gate 展示 Fanto 品牌登录页，提供 Google 与 Apple 原生继续按钮。完整链路：iOS 请求 `/api/auth/intents`（`purpose=authenticate, provider=google|apple`）获得一次性 nonce，将 nonce 交给对应原生身份 SDK，再使用 `/api/auth/native/authentications` 提交 `{intentId,proof:{idToken}}`。Server 校验提供方签名、audience、expiry、nonce、sub，在一次事务内按 `(provider,sub)` 登录或创建用户，返回 `sessionToken`；iOS 存入 Keychain 后进入应用。旧版双 JWT iOS 与新 Server 不兼容，必须升级并重新登录。

Google 配置位于 `Supporting/Info-Debug.plist` 与 `Supporting/Info-Release.plist`：

- `GIDClientID`：Google Cloud iOS OAuth Client ID；
- `GIDServerClientID`：后端验证使用的 Web / Server OAuth Client ID，同时需要加入 Server 的 `GOOGLE_ALLOWED_CLIENT_IDS`；
- `CFBundleURLTypes`：iOS Client ID 对应的 reversed client ID URL scheme。

Debug 与 Release 均配置 iOS OAuth Client ID、Server OAuth Client ID 和对应 reversed URL scheme。Server OAuth Client ID 同时必须位于 Server 的 `GOOGLE_ALLOWED_CLIENT_IDS`；iOS 客户端不保存也不使用 Web Client Secret。

Apple 登录使用系统 `AuthenticationServices`，Xcode target 通过 `fanto/fanto.entitlements` 启用 Sign in with Apple capability；Server 的 `APPLE_ALLOWED_CLIENT_IDS` 必须包含原生 iOS Bundle ID `com.robinverse.fanto`。iOS 将 Server intent nonce 传给 `ASAuthorizationAppleIDRequest`，只提交 Apple `identityToken` 给 Server；不使用 Services ID、网页回调 URI 或 Apple client secret。用户取消系统授权时不展示错误；其余 Apple 授权失败会显示登录失败状态。

认证成功后才创建业务根视图；认证失效时会先清空当前 `FantoStore` 的 Records 运行态数据，再回到登录页。Agent Session 的 Keychain key 继续包含真实 `user_id + agent_id`，因此不同账号不会复用同一个长期会话。

## Fanto 对话


设置首页仅显示头像、昵称展示和独立昵称设置项，以及角色设定、互动场景、交流规则、示例对话四个单行入口；内容仅在对应二级编辑页显示。iOS 不提供简介编辑、基本资料二级页、角色内容预览或恢复默认头像入口，也不显示头像操作及底部保存提示。首页没有保存按钮；昵称和每个角色字段在对应二级页右上角单独保存。角色 PATCH 的 roleConfig 只包含当前子键，其余角色内容由 Server 合并保留；读取失败可重试。另有独立清除对话记录按钮；清除按钮与退出登录均使用系统中央 Alert 二次确认。清除操作经确认后创建空白会话并仅提交 sessionId，绑定确认后同步重置对话状态、写回设置缓存；失败保留原消息。旧会话仍保留在服务端，客户端不提供历史会话列表，记忆与角色不变；不提供记忆管理入口。角色配置使用有高度上限的多行编辑器，回车插入换行，长文本在框内滚动，键盘工具栏可收起键盘。

点击设置头像使用 PhotosPicker 选择新图片，裁切页使用系统 NavigationStack，左上返回取消、右上对勾确认；圆形遮罩与裁切窗口尺寸固定，仅拖动和缩放原图，不提供重置构图按钮。图片生成、上传和绑定进度显示在顶部已有确认按钮内，错误用系统 Alert 呈现；导入进度使用原控件覆盖层，不插入额外行或改变页面布局。保存只上传最多 512×512 的裁切 JPEG，并立即更新头像；不保存原图，不下载或重新编辑已有头像。头像、昵称和各角色字段互相独立保存；同字段并发冲突要求用户确认。数据、限制与生命周期以 [Fanto](../domain/fanto.md) 为准。

Fanto 位于根导航中间，当前仅使用一个默认 Fanto 角色，以服务端设置的 sessionId 选择当前会话，fantoId 标识角色且不会随会话改变。顶部只保留头像 / 昵称设置入口，不提供历史会话列表、切换或新建会话按钮，也不请求会话列表。设置页清除会创建并绑定新会话，不删除旧 Session。进入根导航后在后台加载 Fanto Session 与最近 10 条历史，切入 Fanto 时若仍未完成才显示加载态，不阻塞记录首页。首次显示对话时会定位至最新消息；向上滚动至历史顶部时，客户端基于服务端 `cursor / nextCursor` 自动读取更早页，并保持原先顶部消息的阅读位置。当前 sessionId 为空，或服务端明确返回 Session 不存在 / 无权访问时创建并绑定新的 Session；设置页清除也会更新同一字段及共享缓存。

流式回复按 SSE message_start/message_end 划分文本块，并与 Tool Presentation 按事件顺序渲染；只有 done 标记回复完成，连接关闭本身不表示成功。客户端按 SSE 原始字节流保留事件分隔，避免丢失连续的 `delta`；`turn_start`、`message_start` 与可见 Tool Presentation 会被投影为进行中的进度条目，工具结束后更新为成功或失败状态。成功的 `present_media` Tool Result 会暂存至本轮 `done`，再合并进助手消息；历史恢复同样通过服务端 `messages` 投影重建文本、活动、媒体与用户澄清卡片。`collect_user_input` 会在导航区域下方以逐题原生提示呈现，支持单选、多选、文本和“其他”输入；`required: false` 的问题允许跳过。提交结果携带服务端要求的内部 interaction 标记继续同一 Session，并以“已提交表单”的用户卡片显示。旧会话正文中的 `fanto-media://<mediaId>` 图片和链接也会兼容投影为同类媒体。图片和语音分组呈现：图片横向预览请求 `variant=thumbnail`，轻点后全屏分页查看请求 `variant=original`；语音可在会话中播放。消息中只保存稳定的媒体 metadata；图片文件与短期签名地址复用本页“客户端缓存”策略，音频按需读取签名地址。界面覆盖加载、等待、流式生成、停止和失败重试；发送消息无论正常结束、失败或被意外取消，都会将占位消息收敛到明确终态，避免停留在等待状态。空回复也会明确失败并提供重试。同一 Session 未完成回复时不能并发发送。停止通过 Session stop 接口，请求上限 25 秒；202 时已开始工具继续执行，显示“正在结束当前操作”，保持原 SSE 并允许编辑草稿，终态或 History 确认空闲后恢复发送，不等待数据库保存。历史失败保留本地回复，旧历史与停止回调不能覆盖新轮次。收到 `done/stopped/error` 即结束本轮流读取；`stopped` SSE 与 History 的 `state: stopped` 均恢复为已停止消息，尚未输出文本时也保留。助手消息使用共用的原生 Markdown 视图渲染标题、段落与内联 Markdown。

## Record UI

Record 提供日历与连续时间线两种视图；选择通过设备 UserDefaults（records.viewMode）保存，重启后保持上次模式，首次默认日历，切换账号不重置此设备偏好。两种模式复用相同记录项：蓝点、正文、媒体，下方同一行展示完整日期时间与地点；连续时间线不单独显示左侧时间列。日历以周日为一周起点，默认显示单行周历；顶部的时间线按钮切换至连续时间线，添加按钮保持可用。切换使用轻微的淡入与水平移动过渡，并在“减少动态效果”开启时取消该过渡。周历向下滑展开月历，月历上滑收回当前选中日期所在周；两种形态横滑分别切换前后周与前后月，并同步更新选中日期。轻点顶部“月 · 年”会以系统 sheet 打开年月滚轮，确认后保留可用的当月日期并同步定位。视觉翻页箭头不显示，但 VoiceOver 保留等价的翻页与展开/收起动作。连续时间线按本地日历日倒序分组，日期标题在滚动时保持可见，右上日历按钮可返回日历视图。新建编辑器可在中文日期选择页设置发生日期与时间，顶部显示所选值；打开后会先尝试前台定位。地点可从搜索结果、地图选点或当前位置确定，并保存地点本体、国家、省/州、城市、区和坐标。地点卡紧接正文与图片，使用本体作为主标题、行政区作为副标题；拒绝定位时仍可搜索或地图选点，不阻止保存。创建页支持文字与最多 5 张图片，图片轮播末尾的加号是唯一图片添加入口，不提供录音入口。音频 Record 当前主要显示播放入口和时长；图片缩略图按需通过媒体读取接口取得短期签名地址。轻点缩略图会全屏展示图片；多张图片可左右分页切换。签名地址仅保留在当前账号运行态并按 expiresAt 复用；图片统一经过按媒体 ID 和 variant 标识的内存 / 磁盘缓存，网络读取失败最多更新地址重试一次。

运行态 Record 直接从 `content.blocks` 构建图片与音频展示，不依赖额外 `media[]` 投影。图片缩略图请求 `/api/media/:id/url?variant=thumbnail`，全屏查看请求 `variant=original`；音频时长直接读取 audio block 的 `durationMs`。

“新建记录”通过系统 sheet 打开 Composer，左上使用统一的返回箭头，正文、照片、日期与提交控件沿用既有布局。无地点时只有一行“添加地点”；已获得定位权限且无恢复地点时自动获取一次当前位置，显示不可拖动的原生地图预览，右下信息按钮展示地点与去重后的行政区，不显示搜索图标，点击继续使用既有搜索 / 地图选点页；右上菜单可修改或移除地点。主表单不主动请求权限，二级页点击地图底部“当前位置”按钮才发起授权并重新定位，地图其他区域仍可轻点选点；已拒绝时用系统中央 Alert 引导设置，仍能搜索。当前位置与地图选点共用地址映射：读取新版 MapKit 地址和城市 / 国家信息，并保留旧版结构化行政字段；始终保存原始选中坐标，地址未识别时保留坐标并显示提示。取消和切换选择后旧解析结果不能覆盖新选择。手动选点、移除及恢复的草稿地点不会被自动定位覆盖。

每个账号保留一份未提交草稿。返回、下拉关闭或 App 进入非活跃 / 后台时排队保存正文、日期、地点、定位建议选择及已导入照片，重新打开先等待最后一次写入并恢复；照片以独立 JPEG 保存，避免重压缩及每次重写。草稿保存在 Application Support 的账号隔离目录，并启用首次解锁后的文件保护；它不是可清理缓存，退出登录后同一账号可恢复，其他账号不可读取或覆盖。已完成上传的 mediaId 保留，短期上传凭据不写入磁盘；同次页面失败重试仍沿用内存上传阶段。

提交时先上传所选媒体，再创建 Server Record，确认成功后清除草稿与照片文件，并将返回 Record 插入本地 Store 和快照；失败保留草稿。草稿的恢复、写入和清除通过串行队列避免旧保存重新写回已提交内容。

## 网络边界

`FantoAPIClient` 与 `AgentAPIClient` 当前都指向 `https://fanto.robinverse.me`。所有受保护 Server API 和 Agent API 都使用 `Authorization: Bearer <sessionToken>`；iOS 不再发送 `x-user-id`，也不再内置 Agent 静态 token。Agent Session persistence 仅使用当前已认证 `user_id` 作为 Keychain namespace 的一部分。

客户端不会绕过 TLS 证书校验；HTTPS 证书必须被 iOS 系统信任。服务地址仍为代码内固定值，后续如需 staging / production 切换再单独配置化。

## Preview

SwiftUI Preview 可以使用 `FantoStore.preview` 样例数据。Preview 数据只用于界面开发，不代表运行态 Server 已具备对应自动生成能力。


Record 保存失败统一提示“保存失败，请重试”，保留草稿及附件上传阶段，仅用户再次点击后继续上传 / complete / 创建。列表小图与原图继续通过同一个 mediaId 的不同 variant 读取；链路见 [Media](../domain/media.md)。

## 主对话连接恢复

主对话 Store 由根视图持有，普通 Tab 切换不取消回复。连接异常、重新进入前台或载入仍在运行的会话时，通过 History 的 `running/stopping` 核对服务端状态；恢复期间保留内容并禁止发送，空闲后刷新历史。不会自动重发用户消息。

SSE `finalizing` 仅为兼容进度，不显示数据库保存锁。回复在内存收尾后以 done/stopped/error 结束；历史异步保存，进程重启可能缺失最近消息，普通刷新优先恢复服务端内存。

## 统一 Session（2026-10-22）

iOS Google/Apple SDK 仍获取 provider ID Token，调用 `/api/auth/native/authentications` 获得随机单个 `sessionToken`；Keychain 只保存它和必要元数据。所有业务请求都使用同一个 Bearer，不再有 Access/Refresh JWT、客户端定时刷新。冷启动带 Bearer `GET /api/users/me` 确认身份，401 删除失效凭证，网络错误允许重试。退出先执行 `/api/auth/native/logout` 的服务端撤销，再清 Keychain。旧 JWT Keychain 记录将直接清除，需要重新登录，旧版 iOS 客户端不兼容新 Server。

# iOS 客户端

目录：`apps/ios/fanto`。当前使用 SwiftUI，最低部署目标为 iOS 26.5。

## Project Session 创作与继续对话（V3）

iOS 采用原生 SwiftUI Project 列表与详情：Proposal 接受只返回 `projectId`，随后直接读取 Project 详情，Server 后台自动处理 Creator，无须手动 `/session/start`。

`Project.status` 使用 `queued/running/completed/failed/archived`：queued 表示等待执行，**与 Session 是否存在/绑定无关**。详情优先显示当前有效作品，queued/running 时继续保留上次内容；completed/failed 且有 Session 时可以继续创作，queued/running/archived 不允许发送新消息；只有 completed/failed 能归档。

会话统一按 `sessionId` 读取 `GET /api/agent/sessions/:sessionId/history` 和订阅 `GET /api/agent/sessions/:sessionId/events`（JWT + `URLSession.bytes(for:)`）；继续创作通过统一 `POST /api/agent/stream` 传入 `creator-agent` 和当前 sessionId，直接消费流式响应。断线后补读 History、不自动重发消息；只读订阅失败不阻止 completed/failed Project 主动发送。Project Session 复用 Main Chat 原生消息气泡、Markdown、媒体和 Tool Presentation，按 toolCallId 更新执行状态，不把工具内部 ID 当成自然语言展示。列表有活动 Project 时短间隔刷新；详情 queued/running 时每约 5 秒刷新，并在 App 进入后台时暂停。

TaskRun.status 增加 queued（等待执行），与 running（正在执行）区分。Project 和 Task 不共享状态枚举。

图片在本地生成上传 JPEG 后校验 10 MiB；服务端申请与完成直传同样校验。最终作品媒体由 Project Service 按 objectKey 归属生成独立副本。

## 根导航

应用使用系统 `TabView`：

- 记录；
- Fanto；
- 脉络。

## 当前页面与数据来源

下表中的“已接”表示客户端代码已实现对应 API 调用，不表示当前公网部署一定可调用。iOS 运行态业务请求统一携带 Fanto access JWT，用户身份只由服务端验证后的 `sub` 决定。

| 能力 | 数据来源 | 当前状态 |
| --- | --- | --- |
| Record 列表 / 日历 / 连续时间线 | `GET /api/records?limit=30&cursor=` | Client 已接分页 |
| 删除 Record | `DELETE /api/records/:id`，携带 expectedVersion | 日历 / 时间线长按确认，成功后更新列表与快照 |
| 新建 Record | 打开编辑器即尝试一次当前位置定位并给出地点建议；媒体上传后调用 `POST /api/records`，再刷新列表 | Client 已接 |
| 媒体写入 | `POST /api/uploads` 申请凭据，直传后调用 `POST /api/uploads/:mediaId/complete` | Client 已接 |
| 非归档 Project 列表 | `GET /api/projects`（默认全部非归档）；`status=archived` 获取归档 | Client 已接 |
| pending Proposal 列表 | `GET /api/proposals?status=pending` | Client 已接 |
| Project 详情 | `GET /api/projects/:id` | 正文、总数与最多 5 条参考记录 |
| Proposal 参考 Record | `GET /api/proposals/:id/records?limit=5&cursor=` | Client 已接分页，直接返回完整 Record |
| Proposal accept / reject | `/api/proposals/:id/accept`、`/reject` | 已接；accept 传 selectedIdeaId，只返回 projectId，直接读取 Project |
| Project 归档 | `POST /api/projects/:id/archive` | 以详情版本归档 |
| Fanto 默认长期会话 | `POST /api/agent/sessions` | Client 已接 |
| Fanto 最近历史 | `GET /api/agent/sessions/:id/history?limit=10` | 已接 iOS 客户端流程 |
| Fanto 文本流式回复 | `POST /api/agent/stream` | 已接 iOS 客户端流程 |

Record 首批读取 30 条，客户端据此生成日历标记和两种视图；服务端返回 `nextCursor`，连续时间线在滚动到底部时基于 cursor 自动读取并追加更早记录。追加页会按 Record ID 去重并按事件时间倒序排列；追加失败保留已显示记录并在底部提供重试。当前账号最近 200 条已读取 Record 会以受 iOS 文件保护的数据快照保存在 Application Support；认证后的启动过程先恢复该快照，再以服务端首屏结果覆盖。新增与每次成功分页后都会更新快照；认证失效或账号切换时清除该账号快照。记录携带服务端 version；旧快照缺少版本时先读取最新 Record 再删除。删除成功或服务端已不存在时移除本地数据并保存快照，已删除 ID 不允许被进行中的分页请求重新加入；版本冲突刷新列表并要求重新确认。


## Google 登录与账号状态

App 启动后先进入认证 Gate：

- Keychain 中存在仍有效的 Fanto access token 时先显示与登录页一致的品牌启动页，再进入主界面；启动页使用 Fanto IP、`Pieces become something.` 和浅色渐变背景，并在显示期间并发预读取 Record、Project 与 Fanto 最近会话。读取失败不会阻塞进入主界面，对应页面保留既有失败与重试状态；
- access token 临近过期时，使用 Keychain 中的 refresh token 调用 `POST /api/auth/tokens/refresh`，成功后原子替换整对 token；
- refresh token 过期、无效或用户被禁用时清理本地认证状态并回到登录页；
- access / refresh token 均保存在 Keychain，业务 token 不写入 `UserDefaults`；
- 当前没有“我的”、设置或退出登录入口；认证失效时会清除本地认证状态并回到登录页。

认证 Gate 直接展示包含 Fanto IP 与 “Pieces become something.” 的登录页，提供 Google 与 Apple 的原生继续按钮。完整链路为：iOS 请求 `/api/auth/intents`（`purpose=authenticate, provider=google|apple`）获得一次性 challenge nonce，再将 nonce 传给对应的原生身份 SDK，并通过 `/api/auth/authentications` 的通用 `proof` 字段把 ID token 发送给 Fanto Server；Server 验证签名、audience、expiry 与 nonce 后，按 `(provider, sub)` 登录已有用户或原子创建新用户，随后签发 Fanto access / refresh JWT。认证成功后进入“记录”Tab；客户端不展示也不判断注册状态。

Google 配置位于 `Supporting/Info-Debug.plist` 与 `Supporting/Info-Release.plist`：

- `GIDClientID`：Google Cloud iOS OAuth Client ID；
- `GIDServerClientID`：后端验证使用的 Web / Server OAuth Client ID，同时需要加入 Server 的 `GOOGLE_ALLOWED_CLIENT_IDS`；
- `CFBundleURLTypes`：iOS Client ID 对应的 reversed client ID URL scheme。

Debug 与 Release 均配置 iOS OAuth Client ID、Server OAuth Client ID 和对应 reversed URL scheme。Server OAuth Client ID 同时必须位于 Server 的 `GOOGLE_ALLOWED_CLIENT_IDS`；iOS 客户端不保存也不使用 Web Client Secret。

Apple 登录使用系统 `AuthenticationServices`，Xcode target 通过 `fanto/fanto.entitlements` 启用 Sign in with Apple capability；Server 的 `APPLE_ALLOWED_CLIENT_IDS` 必须包含原生 iOS Bundle ID `com.robinverse.fanto`。iOS 将 Server intent nonce 传给 `ASAuthorizationAppleIDRequest`，只提交 Apple `identityToken` 给 Server；不使用 Services ID、网页回调 URI 或 Apple client secret。用户取消系统授权时不展示错误；其余 Apple 授权失败会显示登录失败状态。

认证成功后才创建业务根视图；认证失效时会先清空当前 `FantoStore` 的 Records / Projects 运行态数据，再回到登录页。Agent Session 的 Keychain key 继续包含真实 `user_id + agent_id`，因此不同账号不会复用同一个长期会话。

## Fanto 对话

Fanto 位于根导航中间，只使用一个默认长期 Agent Session，不提供会话列表、切换或“开始新话题”。iOS 以当前认证用户的 `user_id` 和 `main` Agent 为键将 Session ID 保存到 Keychain；认证后的品牌启动页会预加载 Fanto Session 与最近 10 条历史，根导航中的加载任务仅作为兜底，切入 Fanto 时若仍未完成才显示加载态。首次显示对话时会定位至最新消息；向上滚动至历史顶部时，客户端基于服务端 `cursor / nextCursor` 自动读取更早页，并保持原先顶部消息的阅读位置。仅在本地没有 ID，或服务端明确返回 Session 不存在 / 无权访问时创建新的 Session。

流式回复通过 SSE 增量追加到当前助手消息。客户端按 SSE 原始字节流保留事件分隔，避免丢失连续的 `delta`；`turn_start`、`message_start` 与可见 Tool Presentation 会被投影为进行中的进度条目，工具结束后更新为成功或失败状态。成功的 `present_media` Tool Result 会暂存至本轮 `done`，再合并进助手消息；历史恢复同样通过服务端 `messages` 投影重建文本、活动、媒体、任务与用户澄清卡片。`collect_user_input` 会在导航区域下方以逐题原生提示呈现，支持单选、多选、文本和“其他”输入；`required: false` 的问题允许跳过。提交结果携带服务端要求的内部 interaction 标记继续同一 Session，并以“已提交表单”的用户卡片显示。`create_task` 会显示任务卡片；轻点以系统 Sheet 打开详情，读取现有 Task / TaskRun 接口并以 Markdown 显示目标、要求、完成标准和计划。最近一次有交付成果的 completed Run 会显示成果文件卡片，轻点后在同一 Sheet 的导航栈内预览：HTML 使用非持久化 Web 视图，Markdown 与纯文本使用原生阅读视图；预览前会将交付内容里的 `fanto-media://` 引用替换为当前用户短期可访问的媒体 URL。已完成任务的详情和成果预览只在当前账号的本次 App 运行期间缓存在内存；再次查看优先命中缓存，用户手动点击刷新才重新请求，认证失效或切换账号时清空。iOS 不提供独立任务管理页。旧会话正文中的 `fanto-media://<mediaId>` 图片和链接也会兼容投影为同类媒体。图片和语音分组呈现：图片使用横向缩略图，轻点后全屏分页查看；语音可在会话中播放。客户端只保存稳定的媒体 metadata，展示时才通过媒体读取接口取得短期签名地址，并在资源加载失败后刷新一次。界面覆盖加载、等待、流式生成、停止和失败重试；发送任务无论正常结束、失败或被意外取消，都会将占位消息收敛到明确终态，避免停留在等待状态。空回复也会明确失败并提供重试。同一 Session 未完成回复时不能并发发送。助手消息复用 Project 页面共用的原生 Markdown 视图渲染标题、段落与内联 Markdown。

## 脉络 UI

Proposal 和 Project 独立展示：待确认创作灵感在列表上方，非归档作品在下方；通过单独入口查看 archived 作品。Proposal 允许 1–2 个创意方向及 Tags，用户选择方向后使用「按这个方向创作」，接受返回 projectId 即导航至对应 Project。再次查看已接受提议仅跳转原 Project，不能再次尝试创建或启动 Creator。

Project 列表行使用标题、摘要和轻量状态提示；详情优先展示已有作品，queued/running 时保留上一版的封面及正文，不通过 Session 有无推测创作阶段；没有作品时只显示摘要与“等待创作 / 正在创作”短提示。Session 存在即可查看历史及实时工具/文本过程；completed/failed 时才可以发送新的创作消息、归档，archived 只读。内容变化通过 Project.version 维护，但状态/Session 变化不增长 version，客户端仍应正常刷新 status/sessionId。

iOS 使用原生 SwiftUI ScrollView、NavigationStack、Sheet 与 Toolbar；底部单一主要行动为“继续创作 / 继续聊聊”（仅完成或失败且 Session 存在），其他状态不占用底部固定区域。参考 Record 按现有详情简洁排列。Project 正在执行时详情可见期间低频查询状态，完成后停止；Session SSE 本身不持久化，断线后查询 History。后台进入时停止实时订阅/查询，恢复前台时刷新。

Project 正文使用 Swift Markdown 语法树渲染标题、段落、列表和媒体；HTML 作品使用当前禁用脚本及外部导航的非持久化预览容器。作品媒体从 Project 独立副本读取，不依赖被删除的原 Record 媒体。

## Record UI

Record 提供日历与连续时间线两种视图。日历以周日为一周起点，默认显示单行周历；顶部的时间线按钮切换至连续时间线，添加按钮保持可用。切换使用轻微的淡入与水平移动过渡，并在“减少动态效果”开启时取消该过渡。周历向下滑展开月历，月历上滑收回当前选中日期所在周；两种形态横滑分别切换前后周与前后月，并同步更新选中日期。轻点顶部“月 · 年”会以系统 sheet 打开年月滚轮，确认后保留可用的当月日期并同步定位。视觉翻页箭头不显示，但 VoiceOver 保留等价的翻页与展开/收起动作。连续时间线按本地日历日倒序分组，日期标题在滚动时保持可见，右上日历按钮可返回日历视图。新建编辑器可在中文日期选择页设置发生日期与时间，顶部显示所选值；打开后会先尝试前台定位。地点可从搜索结果、地图选点或当前位置确定，并保存地点本体、国家、省/州、城市、区和坐标。地点卡紧接正文与图片，使用本体作为主标题、行政区作为副标题；拒绝定位时仍可搜索或地图选点，不阻止保存。创建页支持文字与最多 5 张图片，图片轮播末尾的加号是唯一图片添加入口，不提供录音入口。音频 Record 当前主要显示播放入口和时长；图片缩略图按需通过媒体读取接口取得短期签名地址。轻点缩略图会全屏展示图片；多张图片可左右分页切换。签名地址只保留在视图运行态，图片请求失败时会刷新地址并重试一次。

运行态 Record 直接从 `content.blocks` 构建图片与音频展示，不依赖额外 `media[]` 投影。图片缩略图请求 `/api/media/:id/url?variant=thumbnail`，全屏查看请求 `variant=original`；音频时长直接读取 audio block 的 `durationMs`。

“新建记录”通过系统 sheet 打开 Composer。保存时先上传所选媒体，再创建 Server Record，随后以最新列表结果刷新 Record Store 与本地快照。

## 网络边界

`FantoAPIClient` 与 `AgentAPIClient` 当前都指向 `https://fanto.robinverse.me`。所有受保护 Server API 和 Agent API 都使用 `Authorization: Bearer <Fanto access JWT>`；iOS 不再发送 `x-user-id`，也不再内置 Agent 静态 token。Agent Session persistence 仅使用当前已认证 `user_id` 作为 Keychain namespace 的一部分。

客户端不会绕过 TLS 证书校验；HTTPS 证书必须被 iOS 系统信任。服务地址仍为代码内固定值，后续如需 staging / production 切换再单独配置化。

## Preview

SwiftUI Preview 可以使用 `FantoStore.preview` 样例数据。Preview 数据只用于界面开发，不代表运行态 Server 已具备对应自动生成能力。

脉络页可见期间按现有逻辑每五秒刷新待确认建议；每约十五秒仅对列表中 queued/running 的 Project 补读状态。详情 queued/running 时每约五秒刷新，完成/失败即停止状态轮询；没有“等待 Session 创建后主动 start”或“自动重新执行”流程。

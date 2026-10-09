# Fanto H5 / iOS 适配 Server 异步执行 V3

日期：2026-10-08  
状态：H5/iOS V3 客户端已实现并通过 H5 typecheck/build + iOS Xcode 模拟器构建；真实账号联调和完整模拟器交互验收仍待进行  
范围：`apps/h5/`、`apps/ios/fanto/fanto/`，包含网络协议、页面状态、交互、布局、TaskRun 展示、测试及客户端文档。**本计划只设计，不执行客户端代码。**  
依赖：`plan/2026-10-08-async-task-queue-refactor-v3.md` 已实施的 Server HTTP/SSE 契约。

## 1. 核心产品原则

1. **Project.status 只描述任务执行状态**：`queued / running / completed / failed / archived`；不再使用 `active`，不设计 `creatorQueued`、`isCreating` 等冗余服务端状态。
2. **sessionId 与 status 完全独立**：有 Session 不意味着任务正在执行；无 Session 不意味着任务仍在 queued。Session 只用于 History、SSE 与提交后续对话。
3. **content 与 status 完全独立**：Project 即使 queued、running、failed，也可能有之前的正式作品；**优先展示最新有效作品，不用“制作中占位页”盖住旧成果**。
4. 提议是用户的一次决定，接受成功便进入 Project 页面。**客户端不得主动启动/重派 Creator 工作**；后台启动由 Server 的 Queue/Handler 完成。
5. UI 主次：作品内容 > 状态和简短进度 > 操作；状态为一句简短提示或轻量标记，不堆大段解释、进度条、运行日志、技术信息或多个重复按钮。
6. Agent 会话内容通过**通用 Session History + Session SSE**呈现；SSE 是临时过程，持久历史和 Project 详情始终是事实来源。
7. 任务执行异常不会自动重试，也没有“重新执行当前 queued Project”接口；**不设计无法实际执行的「重试创作 / 重新启动」按钮**。
8. 不变动 Record/Chat 主流程、Proposal 两候选卡片/标签语义、最终作品复制/预览机制；iOS 保持原生 SwiftUI 风格，H5 沿用已建立的页面视觉语言。

## 2. Server V3 契约清单（客户端按现有代码实现）

| 功能 | 目标 HTTP / SSE | 必要调整 |
| --- | --- | --- |
| Accept Proposal | `POST /api/proposals/:id/accept` 请求 `{ selectedIdeaId }`，成功 `result: { projectId }` | 不再解析旧 `resultProjectId` / `addedRecordCount`；不调用 start |
| Proposal Detail | `GET /api/proposals/:id` | Proposal 自身仍有 `pending/accepted/rejected`、`resultProjectId`，**与 accept 响应不同** |
| Project List | `GET /api/projects?limit=&cursor=` | 不传 status 默认全部非归档（queued/running/completed/failed）；归档列表传 `status=archived` |
| Project Detail | `GET /api/projects/:id` | 直接读取五状态、`sessionId|null`、`content`、`version`、参考记录等 |
| Session History | `GET /api/agent/sessions/:sessionId/history?limit=&cursor=` | Main / Creator 统一按 SessionID 读取，无 Project 特殊路由 |
| Session Events | `GET /api/agent/sessions/:sessionId/events` | 带 JWT 的长期 SSE GET 订阅，不触发执行，无历史重放 |
| Project Message | `POST /api/projects/:id/session/messages`，请求 `{ message }` | `HTTP 202` + `result: { sessionId }`；响应**不是 SSE** |
| Project Archive | `POST /api/projects/:id/archive`，请求 `{expectedVersion}` | 仅 completed/failed 可归档，queued/running 不提供操作 |
| TaskRun | `GET /api/tasks/:id/runs` 等现有路径 | Run 增加 `queued`；Task 本身 `active/paused/completed/cancelled` 不变 |
| Main Chat | `POST /api/agent/stream` | 请求驱动 SSE **保持不变** |

删除客户端全部调用以下旧路径：`/projects/:id/session/start`、`/projects/:id/session/stream`、`/projects/:id/session/events`、`/projects/:id/session/history`。

通用 Session History 只按拥有者授权直接读取；Creator/Task/Proposal 的内部 Session 仍不能通过公共 API 创建或执行。HTTP 4xx 需按真实权限/业务状态处理，不能把 409 自动当成“重试启动”。

### HTTP 响应消费约定

- H5 的 `requestJson` 与 iOS 的通用请求解码器继续拆除外层 `{success,result,errorCode,errorMsg}`，组件只拿到 `result`。
- `POST Project Message` 收到 **202** 即表示受理/开始运行，不意味着生成完成；后续进度从已建立的 Session SSE 收，终态由 GET Project.status 验证。
- 401/403 属于身份/权限异常；404 属于资源不可用；409 属于当前状态不可继续/Session 忙。未知断网错误保留草稿，**不自动重复 POST**，避免同一消息被发送两次。

## 3. 状态、文案及可操作范围

| Project.status | 主显示 | 内容区 | 会话区域 | 底部动作 |
| --- | --- | --- | --- | --- |
| `queued` | **等待创作** | 已有 content 正常展示，否则显示目标/摘要 | 若 Session 存在可看历史；不可发送新消息 | 无“开始/重试” |
| `running` | **正在创作** | 已有 content 正常展示，允许完成时刷新 | Session 存在则可订阅 SSE/看历史；输入只读/禁用 | 无重复提交 |
| `completed` | **创作完成** | 优先作品，允许预览与查看原始素材 | Session 存在可看历史并继续对话 | 有 Session 时 **继续创作**；可归档 |
| `failed` | **本次创作未完成** | 保留旧作品；没有则显示目标/摘要 | Session 存在可阅读错误与历史、继续对话 | 有 Session 时 **继续聊聊/调整方向**；可归档 |
| `archived` | **已归档** | 作品和历史只读 | 有 Session 可浏览历史，但无编辑器 | 不允许创作、归档操作 |

说明：

- **状态文字不应暗示 Session 生命周期**。例如 queued 不写“正在建立会话”；running 不等同于“正在生图”，后台可能只在准备素材。
- running 的动画仅是轻量低调的状态动效；不是进度百分比或 Agent 执行阶段推断。
- 对 `completed` 但 `sessionId=null` 的异常旧数据：照常展示作品，不渲染不可用的聊天输入。
- 对 `failed` 且 `sessionId=null`：展示“本次创作未完成”，保留详情和「刷新」；**没有 Server 重试接口，不能承诺重试**。
- 对 `queued` 长时间未变化：持续准确展示“等待创作”；可手动刷新。由于 Server V3 不做消息持久化/恢复，客户端**不能用超时擅自改为 failed 或承诺自动恢复**。
- 对 `running` 无 Session：仍显示“正在创作”；允许轻量状态查询直到 Session 可用或终态。
- `sessionId` 从 null 变为非 null 仅触发 Session 订阅就绪，不应自行改写 Project.status。
- 用户发起的继续创作令 Project `completed/failed → running → completed/failed`；聊天输入在执行期间禁用。
- 归档的内容与历史可读，不显示创作/重试入口；服务端拒绝归档时（409/version 冲突）刷新最新 Project。

## 4. 脉络列表设计（两端保持信息架构一致）

### 4.1 页面层级

```text
脉络                          [刷新]

值得继续的灵感
  [待确认的 Proposal 卡片 / Tags]
  ...

你的作品
  [所有非归档 Project: queued/running/completed/failed]
  [归档入口]

[选择已归档] → 仅展示 archived 的只读作品
```

- **不要为 queued/running/completed/failed 分别建四个主 Tab**。它们是同一条创作脉络的生命周期，不应让用户在多类 Tab 中找作品。
- 保留 **「全部 / 已归档」** 两种范围选择（H5 可用现有分段按钮，iOS 优先简洁工具栏菜单/切换入口）；默认全部非归档。
- Proposal 和 Project 是不同对象；接受 Proposal 后从 Proposal 列表移除，Project 列表增加对应 queued 项。
- 首屏不新增“处理中计数”、“失败任务计数”、“工作队列长度”等技术元素。

### 4.2 Project 列表卡片与行

- 统一层级：**封面或轻量占位 → 标题 → 一行摘要 → 状态 + 时间**。
- `queued`：柔和占位封面与“等待创作”微标记；若已有旧封面则保留旧封面。
- `running`：封面/标题不跳动，状态微弱呼吸动效；如需显示“正在创作”仅出现一次。
- `completed`：封面为主、状态低调，不显示“100%”之类进度提示。
- `failed`：低饱和提示“未完成”，不使用大面积红色警告或遮住作品。
- `archived`：低强调的归档标记。
- 卡片无媒体时用现有 `ProjectCover` 插画/占位，不显示破图或巨大 spinner。
- H5 手机窄屏以单列卡片，桌面保持现有双列；iOS 使用原生 List 行，不套 Web 风格卡片。

## 5. Project 详情设计（优先作品、次要过程）

### 5.1 稳定布局

```text
[关闭/返回]                            [菜单: 归档(可用时)]
作品标题
[状态符号 + 简短文案]  ·  更新时间

[已发布作品内容/图片/HTML]
    或
[无作品时显示创作目标 + 安静的等待/执行提示]

[创作对话 / 查看创作过程]  ← sessionId 存在才出现

[参考记录（折叠）]

[底部单一主要行动]
    completed + sessionId → 继续创作
    failed + sessionId    → 继续聊聊
    其他                  → 不占用固定底部按钮区域
```

- 不要因为 `queued/running` 清空旧作品；正在新一轮 extend/用户消息时依然展示上次作品。
- `content` 包含合法 HTML/Markdown 图片引用时保留原有安全预览。状态变化不销毁和重建作品 iframe/滚动内容；避免轮询导致闪烁或自动回顶。
- 仅在 `content` 为空时使用摘要与简短提示，避免模拟不存在的内容或百分比。
- 会话 UI 仅根据 `sessionId` 决定能否读取；**输入是否可用**由 `status == completed || failed` 再决定。
- `running` 有 Session 时可以查看实时过程，但不允许并发发消息；`queued` 有 Session 时同样可查看已有历史，不把 queued 当作“没有 Session”。
- `failed` 不显示不可靠的“一键重试”；通过已存在 Session 的“继续聊聊”是一次**新用户意图**，不是补投原后台消息。
- 终态发生变化时只更新 status 和必要内容；不突然自动打开聊天或抢占当前滚动位置。

### 5.2 H5 布局

- 继续使用当前 `ProjectDetailSheet`：桌面右侧抽屉（现有约 670px），移动端满宽抽屉。
- 顶部在标题下加入小尺寸状态行；作品区域沿用 `ProjectDocument` / `ProjectHtmlPreview`，参考记录默认折叠。
- 有 Session 的“创作对话”作为可折叠/悬浮次入口；作品占据主体，**不把聊天永久铺满页面**。但无作品且正在创作时，允许默认展开过程区域。
- 固定底部仅显示当前真正可操作的主要按钮；按状态隐藏 `startSession` 按钮和不可操作的「归档」。
- CSS 优先复用已有 `.project-creation-status`、`.project-sheet`、`.project-session-float`，补充状态映射修饰类，不再新建一整套视觉规范。
- 小屏布局必须照顾软键盘和 `safe-area-inset-bottom`，聊天输入不被固定底栏覆盖。

### 5.3 iOS 布局

- 保留 `ProjectDetailView` 原生 `NavigationStack + ScrollView + safeAreaInset`。
- 在标题下展示统一 ProjectStatus 样式；已有作品继续按 `MarkdownContentView` / `ProjectHTMLPreview` 展示。
- 创作过程使用原生 `sheet`（可用 `.medium/.large`）承载 `ProjectSessionConversation`；无作品且有 Session 时可在页面内呈现精简过程入口。
- 底部胶囊按钮仅适用于可继续的新对话；`queued/running/archived` 不显示“继续创作”。
- Toolbar “归档”仅 completed/failed 可见；保留确认弹窗，遇到并发版本冲突刷新数据后再提示。
- 不引入 H5 风格的大卡片和大面积动画；使用系统 Typography、SF Symbols、Material 与 Dynamic Type/Safe Area。

## 6. Proposal 确认与跳转

1. 继续支持 1–2 个创作方向与 tags；沿用「不感兴趣 / 按这个方向创作」双操作，不扩大详情文案密度。
2. 点击接受前保持所选 `selectedIdeaId`；POST 只提交一次，操作期间按钮禁用。
3. Accept 成功收到 `projectId` 后**直接打开 GET /projects/:id**。不等待后台 Session，不调用旧 start 接口，也不依赖 Project 是否已出现在列表分页中。
4. 接受完成从待确认 Proposal 列表删除/更新；项目详情初次很可能是 queued，不弹技术成功框、不假装 Agent 已经开始。
5. 已接受的 Proposal 重新打开时：如果 `resultProjectId` 存在，只提供「查看作品」导航，**不再发一次 accept 试图启动任务**。
6. 提议拒绝、关联 Record 展示以及异常提示沿用现有体验；页面关闭不取消后台任务。
7. extend 成功后进入原 Project 的最新详情，保留原 content/封面/Session，状态先显示 queued。

## 7. Session 对话与实时事件

### 7.1 统一客户端流协议

- H5 `fetch` + ReadableStream：继续附带 JWT，**不直接换为无法自定义 Authorization Header 的浏览器原生 EventSource**。
- iOS `URLSession.bytes(for:)`：继续发送 Bearer Token，沿用 SSE 行解析但把目标从 projectId 改为 sessionId。
- 将 `start/turn_start/message_start/message_end/delta/tool_start/tool_end/done/error` 都解析到统一前端事件模型；ToolPresentation 继续遵守 `visible/displayContent/animation`。
- 主 Agent `POST /api/agent/stream` 保持请求驱动 SSE，不做破坏性改造；尽量共享基础 SSE decoder，不共享两个相反的“调用即订阅”语义。
- Project 消息变为两步：**先建立（或复用）Session SSE 订阅，再 POST /session/messages 收到 202**；用 SSE 展示瞬态过程，必要时补读 History。
- 不能假定 SSE 连接一定在第一个 delta 前完成；订阅中断/重新进入页面、POST 响应延迟时，从 History 读取持久消息补全。
- 消息草稿在 202 成功后才认为已提交；网络响应未知时保持可恢复草稿/提示查看历史，**不自动再次 POST**。
- 同一个 Project Session 始终只有一条活跃订阅和一个消息提交；组件卸载/页面消失/后台进入时取消订阅；重新打开重新订阅并先拉 History。
- Tool/文本的临时流展示不与 History 永久重复；收到 done/error 后合并历史、清空本轮 transient 缓冲，并刷新 Project.status 和 content。
- 断线重连只重建**读取 SSE 订阅**，不重复执行 POST，不实现 Agent 任务重试。
- Session History 原有分页游标、`messages` 投影和 media 展示保持一致。

### 7.2 页面刷新策略（与后台调度不同）

Server 没有“Project 状态变更广播”，且 queued 初期未必有 Session，因此仅靠 SSE 无法观察 `queued → running` 与 `sessionId=null → 有值` 的所有场景。

- **只在 Project 详情可见且状态 queued/running 时**限时、低频 GET Project 详情检查 status/sessionId（例如 4–6 秒，实际实现统一常量）；不会因此触发 Agent 运行。
- 有 Session 时以 SSE + History 为主观察执行；状态 GET 仍用于最终确认 Project.status/已发布 content。
- 完成或失败即停止详情状态轮询；Project 内容已稳定时无需全时 3 秒刷新；退出页面或 App 进入后台立即终止 GET/SSE。
- **状态流转与 Session 绑定不会增加 Project.version**：H5 当前详情刷新使用 `current.version !== next.version` 才替换数据，必须改掉；至少以 `status/sessionId/updatedAt/content/version` 实际变化更新，或有条件直接接受最新响应，否则 queued→running、Session 绑定、running→completed 会被吞掉。
- 列表正在展示且存在 queued/running 项时，可每约 10–15 秒轻量刷新当前非归档列表状态，并在页面返回/前台恢复时刷新；保留已有内容与滚动位置，不把所有分页数据每 5 秒全量重新拉取。没有活动项目时停止这一状态刷新。
- H5 的页面列表与 iOS 进入前台可以刷新，避免长期空窗；网络错误采用当前页面手动重试/有限退避，不不断刷错误提示。
- 这些是**客户端 UI 数据刷新**，不是 Server Task/Proposal 的轮询触发，亦不创建补投机制。

## 8. H5 具体代码调整

| 文件 | 任务 |
| --- | --- |
| `src/api/projects.ts` | ProjectStatus 五状态；`listProjects(status?: ProjectStatus)` 默认不附带 status；Accept 返回 `{projectId}`；删除 `startProjectSession`、`fetchProjectHistory(projectId)` |
| `src/api/agent.ts` | `watchProjectEvents(projectId)` 改 `subscribeSessionEvents(sessionId)`；`fetchAgentHistory(sessionId)` 通用；新增 `sendProjectMessage(projectId,message)` 返回 202 sessionId；Main `streamAgentMessage` 不再接受 projectId 分支；共享 SSE parser |
| `src/pages/ProjectsPage.tsx` | Tab 从 active/archived 改为 all/archived；all 不传 status；所有非归档 Project 同列表；卡片增加轻量状态与无媒体占位；仅有活动 Project 时低频刷新状态、保留滚动；保留 Proposal 列表 |
| `src/components/projects/ProjectDetailSheet.tsx` | Accept 用 projectId 直接导航；accepted 提议“查看作品”；删除 start 按钮；根据 status 控制归档/继续；空/有 content 均展示独立状态；只在 queued/running 可见时低频刷新；不能再只比较 version 决定是否更新 |
| `src/components/projects/ProjectSessionChat.tsx` | 订阅由 projectId→sessionId；POST 消息返回 202，不再从 POST 读 SSE；History+SSE+完成后刷新；按状态禁用输入；去掉每 3 秒全时 History 轮询 |
| `src/components/projects/ProjectCover.tsx` | 维持封面有效性；无 cover 继续现有低饱和视觉，不依状态覆盖已存在图片 |
| `src/components/tasks/TaskDetailModal.tsx`、`src/api/tasks.ts` | 增加 queued Run 类型和“等待执行”空计划/结果状态；queued/running 状态可刷新 |
| `src/styles/global.css` | 状态行、轻量动效与简短空内容占位；H5 手机/桌面抽屉、按钮和输入 safe area 自适应 |

H5 `requestJson` 的统一成功响应解析沿用，注意新 `POST /session/messages` 是 202 JSON 不是 SSE。

## 9. iOS 具体代码调整

| 文件 | 任务 |
| --- | --- |
| `Models/Project.swift` | `ProjectStatus` 改五个 case；统一中文 title、systemImage、配色语义；`Project` 保留独立的 sessionID、content、version |
| `Networking/FantoAPIClient.swift` | AcceptedProposalPayload 解码 `projectId`；删除 `startProjectSession` / StartedProjectSessionPayload；列表默认不传 status，归档传 archived；增加按 projectId 直接拉详情导航路径 |
| `Networking/AgentAPIClient.swift` | `fetchHistory(sessionID:projectID:)` 删除 projectID 特例；`observeProject(projectID:)` 改 `observeSession(sessionID:)`；新增 `sendProjectMessage(projectID:message:)`（202 JSON），保留 Main 原 `stream` |
| `Store/FantoStore.swift` | `loadProjects` 不再传 .active；Accept 根据 projectId 直接 `fetchProject` 并导航，不能只靠分页后的 `projects.first`；列表稳定去重 |
| `Projects/ProjectsView.swift` | 默认非归档；待确认灵感在上、作品在下；归档独立入口；可见且含 queued/running 项时低频更新项目状态（当前 5 秒循环仅刷新 Proposal），不持续刷新已经完成的所有作品 |
| `Projects/ProjectRow.swift` | 状态轻量呈现、保留原生列表层级、无封面不添加巨大占位，失败状态低强调 |
| `Projects/ProposalDetailView.swift` | 接受后直接进入 Project；accepted 只展示“查看作品”而非“重试启动”；继续沿用原生双操作 + tags |
| `Projects/ProjectDetailView.swift` | 删除 isStarting / startSession；新 status 文案、空作品提示、归档显隐与悬浮继续创作条件；已发表作品优先；仅 queued/running 期间可见性驱动刷新 |
| `ProjectSessionConversation`（当前位于 `ProjectDetailView.swift`） | 用通用 History + Session SSE + 新 202 POST；running/queued/archived 时输入只读；页面退出/后台取消任务；避免独立 3s 永久 History 轮询 |
| `Conversation/FantoTaskModels.swift`、`Conversation/TaskDetailSheet.swift` | `TaskRun.status==queued` 显示等待执行，running 才说执行中，completed/failed 正确展示结果与失败 |
| `Design/FantoTheme.swift`（如必要） | 只补足状态辅助色/符号，不重新设计全局主题 |

**iOS 构建条件**：通过项目现有 Xcode target 编译、Swift 6 并发检查、模拟器实际点击/返回/后台恢复测试；`Task`、订阅和 UI 状态更新必须在正确 Actor 上处理，不能用逃逸强引用留下后台 SSE 任务。

## 10. 场景矩阵与验收

### 功能与状态

1. 新 Record → Proposal 待确认出现；选择创意接受只提交一次；H5/iOS 均能从 projectId 立即打开 queued Project，不依赖 sessionId。
2. queued 无 Session：页面显示“等待创作”，无“开始创作”；状态更新为 running 后详情更新；Session 出现后自动启用只读过程。
3. queued 有旧 Session（extend）：仍显示 queued，作品/历史保留，**不自动当成 running**，输入不可用。
4. running 无 Session：状态可见但不虚构消息；有 Session 后可订阅并展示工具与文字事件。
5. running 有旧 content：旧作品、封面、参考 Record 保持可读，不被 loading 全屏覆盖；终态刷新最新 content。
6. completed + Session：从已发布作品打开“继续创作”，POST 返回 202，输入禁用直至 status 终态；SSE 与 History 同步后不重复文字/工具块。
7. failed + Session：保留旧成果，显示“本次创作未完成”；用户可以发起新的修改意图，不假装后台重试。
8. failed 无 Session：只显示错误状态和作品/目标及手动刷新，不渲染不可用的发送/重试按钮。
9. archived + Session：作品和历史可查看，编辑器隐藏；queued/running 不出现归档操作，服务端 409 正确处理。
10. Proposal accepted 再次打开：进入既有关联 Project，不重复 accept；拒绝后正常返回列表。
11. TaskRun 新建 queued 及 running：H5/iOS 区分“等待执行”和“正在执行”，不把 Task 的 active 当作 Project active。
12. SSE 断线、长时间后台、进入前台、POST 收到 202 但没有收到 delta：History 可补读，Project.status 是最终依据，不重发 POST。
13. HTTP 401/403/404/409、网络中断、会话删除、归档与并发更新：展示正确错误，不丢失用户草稿、不会误删内容。
14. H5 小屏/宽屏：底部 safe area、输入键盘、抽屉内容不溢出；iOS Dynamic Type、原生 sheet、VoiceOver 标记、深色主题/动态系统外观不受影响。

### 验证命令与方式

- H5：`pnpm --filter @fanto/h5 typecheck`、`pnpm --filter @fanto/h5 build`（以实际 package.json scripts 核实）；必要时补单元测试。
- iOS：在本机 `xcodebuild -project apps/ios/fanto/fanto.xcodeproj -scheme ...` 构建（scheme 以实际工程核实）；模拟器验收列表/详情/接收状态/聊天/归档。
- Server：保持现有 V3 HTTP/SSE 及 TaskRun 契约；如发现客户端无法处理的真实 Server 协议缺陷，**先列明具体复现与最小 Server 修复，不靠客户端伪造状态**。

## 11. 实施顺序与范围

**P0 — 两端 API 和可用性**

1. 修改 H5/iOS DTO、Accept、Project 五状态、默认列表查询、History/SSE/Project Message 接口。
2. 删除全部旧 Project Session start/stream/events/history 路径；保持 Main Chat 不变。
3. 修复接受后立即导航到 Project、queued/running 期间输入/归档的禁用逻辑。
4. TaskRun 增加 queued 展示；类型检查与基础构建通过。

**P1 — 页面交互与视觉适配**

5. 两端列表实现「待确认灵感 / 非归档作品 / 已归档」简洁信息层级与各状态轻量提示。
6. 详情优先作品、其次状态与对话；优化无作品占位、旧作品延续、归档/失败可用操作。
7. 页面可见性驱动的状态查询、Session GET SSE 和 History 同步，防止 stale UI、重复消息和永久高频请求。
8. H5 手机 safe area / iOS 原生 sheet、Dynamic Type、VoiceOver 等检查。

**P2 — 回归与交付**

9. 状态/Session/content 三维场景矩阵回归、接口异常和订阅取消测试。
10. H5 build/typecheck、iOS Xcode build + 模拟器验收，新建 H5 客户端文档 `docs/clients/h5.md`（目前不存在），更新 `docs/clients/ios.md` 与对应 HTTP 使用文档。

### 明确不在本次范围

- 不新增 Project 创作重试 API、后台持久队列、进度百分比、通知、状态专属 SSE 服务。
- 不修改 Server 消息调度模型或 Agent 执行规则（除非联调发现具体 Server bug 并单列）。
- 不生成新 App 品牌视觉系统、不大改 Record/Chat 页；聚焦 V3 必要适配及脉络/作品合理布局。

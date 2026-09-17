# 协作约定

- 只有用户明确要求执行、修改或修复时才编辑代码；排查和方案讨论不默认授权编辑。
- 技术方案超过五项任务时，将方案和任务分别保存到 `plan/<方案目录>/`；每个方案目录是一次独立变更，至少包含设计与任务文件。图表使用 Mermaid。
- 核心链路或模块重构时同步 docs/ 和本文件。

## 服务端目录

- 运行入口与 Hono 组装位于 `apps/server/src/bootstrap/`；当前启动文件为 `bootstrap/main.ts`，迁移命令为 `bootstrap/migrate.ts`。
- `src/migrations/` 只有面向空 SQLite 数据库的当前 schema 基线；不增加旧 schema、旧字段或旧数据的升级兼容。需要变更时允许删除数据库重建。
- `routes/` 仅处理 HTTP，普通 CRUD 可直接调用相应 `domain/` Repository；不要新建只转发调用的 Service。
- `domain/records`、`domain/media`、`domain/creations` 与 `domain/memory` 保存业务实体、校验、游标、业务操作和 SQLite Repository 实现。
- `infrastructure/clients/` 是所有外部依赖适配器，使用 `oss-client.ts`、`audio-client.ts`、`image-client.ts`、`embeddings-client.ts` 命名；进程内异步处理只有 `listeners/`，没有 workers。
- 旧主动创作、Task 与 Agent workflow 已从业务服务删除；未来按新的 Creation/Proposal 模型重建，不恢复旧路由或旧数据模型。

## HTTP 查询

- 真实 Topic 对话前后端均暂缓。现有消息读取只补用户/session 隔离，不扩展聊天运行时。正式认证和异步整理仍为后续范围。
- Record 列表/单条详情返回当前 topics，关联按页批量读取；POST/PATCH 返回基础实体。shared/api/dto.ts 区分读 DTO 和 View。
- Topic 列表使用 updatedAt/id 复合游标且仅返回 active，详情允许查询本用户归档 Topic。

- 当前 HTTP 接口与 curl 示例统一维护在 docs/api/http-api.md，接口变更时同步更新。
- GET /api/records 可按 topicId 过滤，按 eventAt、id 倒序。nextCursor 是复合游标，避免批量记录共享时间戳导致漏页；不要改回仅时间的游标。Record 创建必须提交带时区的 ISO 8601 `eventAt`，日历和时间线均以该业务时间渲染。
- 按 Topic 查记录仍需校验 Record 和 Topic 的用户归属，使用 EXISTS 避免重复关联放大结果集。

## Agent 会话与工具

- `apps/agent` 是独立的 Hono + Pi AgentHarness 服务。`apps/agent/agents.yaml` 是唯一 Agent 定义来源，仅在服务启动时加载；先通过 `POST /api/agent/sessions` 创建 SQLite Session，再使用 `POST /api/agent/stream` 或 `POST /api/agent/tasks` 执行，二者都必须传 `agentId` 与 `sessionId`。`agentId` 是执行目标，空闲旧 Session 在下一次执行时隐式升级或切换 Agent；不提供 YAML 热更新、Session 状态或配置更新接口。`GET /api/agent/sessions/:sessionId/history` 按 `seq` 倒序返回可见历史，`GET /api/agent/tasks/:taskId` 查询异步任务。每个会话绑定用户归属并拥有独立工作区；使用服务端 Bearer Token，不接入业务数据库。启动和接口说明见 `apps/agent/README.md`。
- Agent 配置只能启用 Pi 内置 `read`、`write`、`edit`、`bash`，Skills 仅从 `apps/agent/skills/<id>/SKILL.md` 加载。文件工具不得离开 Session 工作区；bash 使用最小环境与固定 cwd。云端生产环境启用 bash 必须采用容器或微虚拟机隔离，不能将 NodeExecutionEnv、路径检查或命令黑名单视为宿主机隔离。

- Agent 使用 Pi `AgentHarness + SQLite Session`；`sessionId` 是持久 Session、Harness 缓存和工作区的唯一隔离边界。`userId` 与当前 `agentId`、配置 revision 写入 Pi Session 的 `fanto.session_owner` custom entry，用于接口授权、归属校验和隐式配置升级；异步任务只使用 Agent 专用 SQLite 的 `agent_tasks` 表，不另建业务服务表。
- 默认 Agent 为 `main`；其 JSON Definition 的 `tools` 只能配置 Pi 内置 `read`、`write`、`edit`、`bash`。文件工具限制在 session 工作区，bash 使用最小环境、危险命令限制与工作区 cwd。
- 原始消息读取基于 Pi Session entry，不以旧 `messages` 表中的运行时事件作为真相源；对外 DTO 必须脱敏密钥、令牌、密码和 Authorization 字段。
- bash 工具必须在 sessionId 对应工作区执行，采用最小环境、超时和危险命令限制。生产环境如需更强隔离，应使用容器或微虚拟机，不能放宽宿主机 bash 权限。
- Record 创建/更新后由同一个后置 listener 处理图片理解、音频 ASR 与向量生成；图片 description、audio block 的 transcription 与用户文本按 block 顺序共同索引。向量项固定 `type=record`、`outerId=recordId`。图片描述和音频转写一次事务回写到 Record；Media 的 ASR 扩展数据保存状态、模型、完成时间及服务返回的语种和情绪。失败仅记录日志且不重试。

## 整理摘要与修改

- records/topics.ext_data 存 JSON，实体/API 为 extData；organization 命名空间保存最近一次成功摘要。更新时只替换该命名空间，不覆盖其他扩展键。不增加反馈字段、接口或 Record tag。
- PATCH /api/records/:id 只接受 content，变化后 status=updated；processing 返回 409；相同内容不更新状态和时间。旧摘要在重整前保留。
- 整理成功后事务提交摘要和最终状态；重新规划替换本批关联，原、新 Topic 都根据当前有效记录重写，无记录 Topic 归档。失败恢复记录状态和原关联不等于 Topic 正文事务回滚。

## 脉络模块

- 当前服务装配 Creation、待确认 Proposal、类型目录与按类型完整列表查询；Proposal 支持确认（创建/更新长期跟踪脉络）和暂不保留。旧主动创作、Agent、Task 与自动生成 Proposal 的工作流不属于当前运行时，后续按新业务模型重建。
- 脉络状态统一为 `active`、`resting`、`archived`；类型使用全局 `kind_id`，系统类型可读，用户自定义类型暂不实现。
- Record 与 Creation / Proposal 的关联使用全局业务 ID。关联来源 Record 分页先查询关系表，再按 ID 批量读取 Record 并按关系顺序重组，禁止为此分页查询使用 JOIN。

## 前端 H5

- 当前工作区没有 `apps/h5` 工程。根目录仍保留的 `pnpm dev:h5`、`pnpm build:h5` 暂无可执行目标，不得作为验证命令。
- 重建范围以 `plan/2026-09-14-h5-ios-server-parity/` 为准；在实现和验证完成前，不把其中的页面、接口调用或交互视为运行时能力。
- 重建后的 H5 只复用 `@fanto/shared` 接口契约，请求使用相对 `/api`；固定开发用户不是正式认证，禁止在浏览器中放置模型密钥。
- 浏览器自动化必须使用模拟或隔离 API，不得触发真实整理任务或修改用户数据库。

## iOS 底部交互层

- iOS 工程位于 `apps/ios/fanto`，使用原生 `TabView` 提供“记录 / 脉络”两项导航；不覆盖系统 tab bar 的背景、尺寸、动画或命中区域。
- “新建记录”位于记录页导航栏，使用系统 sheet 呈现；不使用底栏 overlay、透明全屏点击层或自定义抽屉。
- 记录页日历以周日为一周起点。`selectedDate`、周锚点和日历呈现状态有单一所有者；月历展开/收起使用同一日历区域的连续布局过渡，不得将单行周历和整月日历以两份内容并置。Timeline 按所选日期展示，音频记录仅显示播放动作与时长。
- iOS 运行态已接入 ECS 的 Record、Creation 与 Proposal API：概览仅展示服务端返回的最多三条 active 脉络与实际类型目录；详情读取正文、状态和来源 Record 游标分页；Proposal 卡片读取待确认列表，长期跟踪 / 暂不保留写回服务端。按类型完整列表已由 `kindId` 查询支持；搜索和状态筛选仍等待对应路由，禁止用本地样例冒充真实数据。
- 当前为 iOS 26.5 最低部署目标。使用系统组件和语义颜色；Material 只用于短暂的系统导航/呈现层。

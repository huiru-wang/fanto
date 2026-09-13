# 协作约定

- 只有用户明确要求执行、修改或修复时才编辑代码；排查和方案讨论不默认授权编辑。
- 技术方案超过五项任务时，将方案和任务分别保存到 `plan/<方案目录>/`；每个方案目录是一次独立变更，至少包含设计与任务文件。图表使用 Mermaid。
- 核心链路或模块重构时同步 docs/ 和本文件。

## Contemplate

- 当前工作流位于 apps/server/src/agent/workflows/contemplate/，版本为 contemplate-workflow-v2.2-simple。
- merge_record、create_topic、skip_record 统一使用非空、不重复的 recordIds；skip 的执行结果仍逐条记录 recordId。
- 规划阶段的 JSON、结构和业务校验共用一次修正额度。执行阶段不自动重跑，模型或输出截断错误直接失败。
- planningAttempts 保存每次完整规划输出、校验诊断、耗时、结束原因；不能仅依赖响应开头的日志预览排查错误。
- 候选 Topic 不是强制分类列表，禁止硬合并无关记录。原始 Record 是正文依据，不强制补写推断或探索章节。
- 记录状态恢复不等于 Topic 写入回滚。真实模型效果测试使用独立数据库副本，禁止直接重跑用户数据作为验证。

## HTTP 查询

- 真实 Topic 对话前后端均暂缓。现有消息读取只补用户/session 隔离，不扩展聊天运行时。正式认证和异步整理仍为后续范围。
- Record 列表/单条详情返回当前 topics，关联按页批量读取；POST/PATCH 返回基础实体。shared/api/dto.ts 区分读 DTO 和 View。
- Topic 列表使用 updatedAt/id 复合游标且仅返回 active，详情允许查询本用户归档 Topic。

- 当前 HTTP 接口与 curl 示例统一维护在 docs/api/http-api.md，接口变更时同步更新。
- GET /api/records 可按 topicId 过滤，按 createdAt、id 倒序。nextCursor 是复合游标，避免批量记录共享时间戳导致漏页；不要改回仅时间的游标。
- 按 Topic 查记录仍需校验 Record 和 Topic 的用户归属，使用 EXISTS 避免重复关联放大结果集。

## Agent 会话与工具

- Agent 使用 Pi `AgentHarness + SQLite Session`；`sessionId` 是持久 Session、Harness 缓存和工作区的唯一隔离边界。`userId` 与 `agentId` 写入 Pi Session 的 `fanto.session_owner` custom entry，用于接口授权与归属校验；不另建 Agent 业务表。
- 默认 Agent 为 `main`；其 JSON Definition 的 `tools` 只能配置 Pi 内置 `read`、`write`、`edit`、`bash`。文件工具限制在 session 工作区，bash 使用最小环境、危险命令限制与工作区 cwd。
- 原始消息读取基于 Pi Session entry，不以旧 `messages` 表中的运行时事件作为真相源；对外 DTO 必须脱敏密钥、令牌、密码和 Authorization 字段。
- bash 工具必须在 sessionId 对应工作区执行，采用最小环境、超时和危险命令限制。生产环境如需更强隔离，应使用容器或微虚拟机，不能放宽宿主机 bash 权限。
- Record Memory 仅在 Record 创建/更新后异步生成；向量项固定 `type=record`、`outerId=recordId`，内容仅含用户文本和保存时已就绪的音频 ASR 文本。图片不向量化，失败仅记录日志且不重试。

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
- iOS 运行态已接入 ECS 的 Record、Creation 与 Proposal API：概览仅展示服务端返回的最多三条 active 脉络与实际类型目录；详情读取正文、状态和来源 Record 游标分页；Proposal 卡片读取待确认列表，长期跟踪 / 暂不保留写回服务端。按类型完整列表、搜索和状态筛选仍等待对应路由，禁止用本地样例冒充真实数据。
- 当前为 iOS 26.5 最低部署目标。使用系统组件和语义颜色；Material 只用于短暂的系统导航/呈现层。

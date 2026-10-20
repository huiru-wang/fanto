# Projects / Proposals 清理任务

日期：2026-10-20。方案见 [完整方案](2026-10-20-remove-projects-proposals-design.md)。以下任务尚未执行；本轮仅产出方案。基于当前代码而非旧 plan。按依赖推进，不把中间无法编译的版本发布。

## T1 冻结边界与数据清单

- 复查 HEAD、工作区及 Server / iOS 局部规则，保留其他任务修改。
- 确认线上是否已有三张业务表、两个 Agent 的 Session / Usage / 工作目录与 Project 媒体。只读取数量与标识，不操作生产数据。
- 验证 SessionEventBus 仍无 Main 发布者、Markdown 共享组件仍被 Main 使用；定位最新新增消费者。
- 产物：删除 / 保留清单，以及已有数据处置范围；无宽泛 CASCADE / 非 main 批量删除方案。

## T2 先迁出 iOS 共用展示

依赖 T1。

- 移出 MarkdownContentView 与主对话依赖的图片渲染 / 查看能力；中性命名并去掉 Project HTML 分支。
- 更新调用与 Xcode 引用。
- 验证 Main 文本、代码、表格、图片和全屏预览可构建；功能无额外 UI 变化。

## T3 移除双端 Projects / Proposals

依赖 T2（iOS），T1（H5）。

- 删除 iOS 项目模型、页面、Store 字段 / 方法、网络 Page / Payload、Preview 残留。
- 删除 H5 ProjectsPage / api / 组件、导航与路由、专用样式。
- 删除双端 projectId metadata 和后台 Events 订阅；保留 Main Stream、History、stop、首次 / 清除 Session 创建。
- 验证 iOS 构建，H5 typecheck / test / build；检查无旧 API 调用和可见入口。

## T4 Server 断开自动创作与执行器

依赖 T1；与 T5 / T6 同一集成版本交付。

- main.ts / app.ts 删除服务装配、路由依赖、专用 bodyLimit、normalizeLegacyMedia、shutdown 分支。
- Postprocess 仅发布 Embedding，去掉 AgentQueue 参数。
- 删除 AgentExecutionQueue、execution 全目录及专属测试。
- 验证成功 / 失败 Postprocess、Embedding 失败不回滚、无新后台 Agent Run。

## T5 Agent 去掉创作能力

依赖 T1；与 T4 同步。

- 删除两个 Agent、Prompt、Context Provider、五项创作 Tool、五个创作 Skill 包。
- 清理 Definition 枚举 / 校验、Tools / Providers 注册、Runtime / BusinessServices、RunContext / Metadata / 日志、proposal_create Hook。
- Main 保留既有工具和权限；旧创作工具 / Prompt 配置须失败。
- 验证 Main Record / Memory / present_media、用户隔离、停止 / 冷恢复 / 历史投影。

## T6 移除领域、路由并解除 Record 耦合

依赖 T1；与 T4 / T5 同步。

- 删除 domain/projects、routes/projects 及专属测试。
- RecordService、RetrievalService、PostgresRecordRepository 去掉 Project 关联清理依赖；清理无消费者的 Hook，保留 Record 事务和媒体清理。
- 移除 Stream projectId schema，删除只读 Events 路由 / SessionEventBus；保留共享 SSE 发送函数。
- 验证旧接口不可用、旧 metadata 被拒绝；Record 创建 / 更新 / 删除 / 检索正常。

## T7 清理媒体创作分支

依赖 T5 / T6。

- MediaService 去掉生成资产、引用复制和临时参考图。
- ImageClient 去掉生成 / 下载 / 审查及仅服务这些路径的恢复加密和错误处理。
- 保留图片描述、缩略图、音频、头像 / 背景图、存储接口及共享依赖。
- 更新分支混合测试，验证普通上传 / 删除和跨用户隔离。

## T8 数据结构退场

依赖 T4–T7 不再访问相关结构。

- schema.ts 与空库基线去掉 projects / proposals / record_links 及专用索引。
- 对已有库新增 DROP TABLE IF EXISTS 的单向退场迁移，按依赖顺序删除，不要求清空其他表或 Kysely。
- 测试空库、已有库、重复执行，明确保留 users / contact_value / Records / Memory / 资料 / Main Checkpoint。
- 若本次同时执行历史 Session 清理，必须用精确两个 Agent ID 定位并验证 Main 不受影响；单独报告历史 Usage 变化。

## T9 配置与旧 Shared 导出

依赖 T4 / T5 / T7。

- 去掉 CREATIVE_*、AGENT_EXECUTION_CONCURRENCY 的读取、类型、模板及对应配置测试。
- 核查无消费者的 TopicDto / Topic 模型 / TOPIC_STATUS，移除旧脉络导出。
- 复查依赖；保留 sharp、Main / Record / 存储所需库。不改真实 .env 中的凭据。

## T10 测试、文档与全仓审计

依赖 T3–T9。

- 删除纯专属测试；将仍有价值的权限、媒体、Record、停止 / 恢复测试改成当前 Main 场景，不以删除测试替代验证。
- 新增断链验证、退役接口 / metadata 拒绝、迁移保留数据、无后台 Proposal、共享 Markdown 保留等回归。
- 同步 Current Docs、README、根 / 模块 AGENTS；删除退役专页和失效链接。不擅自推进 docs/.checkpoint。
- 运行 pnpm typecheck / test、H5 build、隔离 PG 集成测试、iOS 编译与现有缓存 / 地点测试。
- 对可执行代码精确检索 Projects / Proposals 符号及五项 Tool / Agent ID / CREATIVE_* / record_links；排除合法迁移历史和 projection / Xcode 等非业务名称，人工复查例外。

## T11 发布与历史外部资源维护

依赖 T10；本任务不在方案阶段执行。

- 停旧进程，必要导出及清单完成后执行迁移，再启动匹配版本，发布客户端。
- 独立维护清理经引用核验的 Project 独占媒体、精确退役 Session 工作目录；无法证明独占的媒体保留并列清单。
- 不在启动 / 普通 migration 中批量删除 OSS，不新增常驻清理队列。未做真实外部删除就明确报告未做。
- 验收 Main、Record / Embedding、Memory、资料、登录、统计和 Admin；核对无退役后台调用。记录不可逆数据影响和恢复方式。

## 完成定义

- T2–T10 完成才可称代码逻辑清理完成；T11 的实际发布 / 历史数据 / 外部文件处置应分别报告，不与代码交付混为一谈。
- 最终仓库中不存在仍可运行的 Projects / Proposals 功能、API、Agent、工具、触发器、客户端页面或专用结构；保留能力通过对应回归。

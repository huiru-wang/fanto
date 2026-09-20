# Fanto 明确偏好记忆 MVP 执行任务

日期：2026-09-20

状态：未实施。对应方案：[design.md](./design.md)。任务按依赖顺序执行；当前授权仅为编写方案。

## T1. 验证动态上下文与来源接入点

- [ ] 复核最新 Agent / Server 代码及局部 AGENTS，保留其他任务的工作区改动。
- [ ] 用最小运行时测试验证 Pi 动态 systemPrompt 回调可读取 Run Context，明确工具后续请求和 compaction 调用行为。
- [ ] 确认本轮用户消息持久化定位方式，设计 source_run_id 内部 custom entry；不依赖未经验证的 messageId 接口。
- [ ] 验证动态偏好不变成普通历史消息，compaction 不固化动态偏好块。

验收：确定可用接入点和测试，使用已验证接口；若 Pi 行为与方案预期不符，先修订接入细节，不引入第二套 Session 系统。

## T2. 偏好表和 Repository

依赖：T1。

- [ ] 新增 `domain/preferences/` model 与 SQLite repository，定义三类偏好及方案中的字段。
- [ ] 更新 DB 类型、空库 migration up / down，建立用户查询和完全相同内容去重所需索引／约束。
- [ ] 实现用户隔离 list / create / update / delete；事务保证 20 条容量与去重。
- [ ] 实现 120 字符内容、300 字符 quote 限制，以及 expectedVersion 并发保护。
- [ ] 验证物理删除、已删除重试、跨用户 ID 不泄漏存在性。

验收：空库可创建；CRUD、并发、容量、重复、越权测试通过；不触碰现有真实数据库，不扩展向量 schema。

## T3. HTTP 与 Agent Client

依赖：T2。

- [ ] 新增并注册 `/api/preferences` GET / POST 和 `/:id` PATCH / DELETE。
- [ ] 复用当前身份、envelope 和校验方式，区分版本冲突、容量已满与目标不存在。
- [ ] 扩展 FantoServerClient 的 method、DTO、错误文案、取消和超时支持。
- [ ] 偏好路由日志省略请求／响应正文及来源 quote。
- [ ] 验证真实路由装配、跨用户 CRUD、响应解析与请求中止；不是只测试孤立 handler。

验收：Server 与 Client 契约一致；受控测试身份可访问，其他用户数据不可读写；新增日志无偏好正文。

## T4. 每轮加载与动态注入

依赖：T1、T3。

- [ ] 在 stream / task 共用 prompt 入口加载偏好，以工具配置决定是否启用。
- [ ] Run Context 增加本轮可更新快照、加载状态、可信来源标识和当前原始用户消息。
- [ ] Harness 动态提示词组合基础 Prompt 与精简偏好列表，稳定排序，包含管理所需 ID / version。
- [ ] 读取失败降级普通对话，不使用陈旧缓存；与空列表明确区分。
- [ ] 验证会话复用和新会话都刷新、coding 不读取、用户不串数据、上下文不累积、compaction 后恢复当前快照。

验收：预置偏好可出现在实际模型请求中；客户端历史无注入消息；共享 definition 与 revision 不受用户偏好污染。

## T5. 管理工具与对话规则

依赖：T3、T4。

- [ ] 新增 `preference_manage`，按 action 区分 list / create / update / delete 参数。
- [ ] 扩展配置 schema、Registry 和 main 工具列表；不为 coding 开启。
- [ ] create / update 验证 sourceQuote 来自当前用户消息；来源和用户身份由运行时填充。
- [ ] 成功写入后同步本轮快照；冲突刷新；未知写入结果读取核对；失败不得假成功。
- [ ] 更新 Fanto Prompt：三类明确偏好、保留适用条件、不推测、不从 Record 提取、不保存临时要求、当前请求优先。
- [ ] 明确删除是停止长期使用，不清除聊天原文；禁止从旧历史自动恢复已删偏好。
- [ ] 保持工具参数／结果不通过 SSE 向客户端公开，仅使用现有状态事件。

验收：一次完整对话能创建、查看、更新和删除偏好，同轮后续请求使用新快照；错误路径与非法来源均有测试。

## T6. 产品行为与成本验收

依赖：T5。

- [ ] 执行 design.md 的真实模型用例，检查工具动作、存储内容和后续行为，覆盖新会话与压缩后会话。
- [ ] 验证两 Session 修改冲突、服务不可用、断连和超时结果未知的行为。
- [ ] 回归 Record 检索与媒体展示，确认无 Record 自动提取写入。
- [ ] 采集偏好块 tokens、每轮模型请求次数、读取耗时与工具失败数；不记录偏好正文。
- [ ] 运行 `pnpm typecheck`、`pnpm test`、`pnpm --filter @fanto/agent build`，完成 Server + Agent 真实 smoke。

验收：关键场景满足方案期望；报告实测结果和剩余限制，区分自动测试与真实模型验证，不声称绝对不会漏记。

## T7. 文档与交付

依赖：T6。

- [ ] 更新 `docs/domain/memory.md`，区分 Record 派生检索与偏好业务数据；必要时新建 `docs/domain/preferences.md` 并建立导航。
- [ ] 更新 `docs/api/http-api.md`、`docs/architecture/server.md`、`docs/architecture/agent-runtime.md` 的真实契约与运行路径。
- [ ] 更新 `docs/product/current-scope.md`、`apps/agent/README.md`，说明跨会话偏好和遗忘范围。
- [ ] 更新 `apps/agent/AGENTS.md`、`apps/server/AGENTS.md` 的工具、用户边界和业务表约束；根 AGENTS 仅在新增导航需要时改动。
- [ ] 更新 `docs/engineering/testing.md` 中相关验证入口；根 README 仅在当前能力描述受影响时更新。
- [ ] 交付记录注明空库 migration 限制、容量限制、已测场景和成本观察；已有数据库保留式升级另定步骤，不执行隐含清库。
- [ ] 检查最终 diff，不覆盖无关改动，不将本次局部文档更新当作全仓 Documentation Impact Review，不自动推进 checkpoint。

验收：代码、测试、实际入口与 Current Docs 一致；方案中的能力只有实现后才描述为当前可用。

## MVP 明确不包含

Record 偏好抽取、状态画像、经历复制、隐含偏好推测、后台抽取任务、历史扫描、偏好向量索引、场景分类模型、图数据库、偏好 UI、自动记忆开关、整段聊天数据删除和正式认证改造。

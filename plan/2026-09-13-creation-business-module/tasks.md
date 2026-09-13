# Creation 业务模块实施任务

> 前置约束：本轮只建设数据库、Repository、只读 Service、只读 HTTP 与测试；不实现任何业务写入，包括 Creation / Proposal 的创建、确认、拒绝、更新、归档或恢复。

## 1. 固化领域常量与 DTO

- 定义动态 Creation 类型、`active | resting | archived` 状态、Proposal 操作和状态的 Zod / TypeScript 常量。
- 定义 `CreationSummary`、Creation 列表项、详情项、Proposal 列表项、详情项、首页概览的读 DTO。
- 定义 `entity_relations` 的受控实体类型与关系类型：`record_creation`、`record_creation_proposal`。

验收：共享 DTO 可表达所有设计接口；Proposal 读 DTO 可原样返回 nullable `extData`；不再对外暴露 `source`、`failure_code`、`failure_message`。

## 2. 编写数据库迁移

- 删除开发数据库并按最终 schema 重建，不迁移旧业务数据。
- 创建 `creation_kinds` 并 seed 初始三种系统类型；类型使用全局 `kind_id`，并为未来用户类型保留 nullable `owner_user_id`。
- 创建最终结构的 `creations`、`creation_proposals` 与 `entity_relations`；关联只使用 `record_id`、`creation_id`、`proposal_id` 等全局业务 ID。
- 创建 Creation、Proposal 与关联 Record 键集分页所需索引。

验收：删除数据库后可重复执行迁移并得到最终 schema、初始类型与全部索引。

## 3. 实现仓储层

- 实现 Creation 类型查询与合法性校验。
- 实现 Creation / Proposal 的分页读取、详情读取、类别统计和继续跟踪查询。
- 实现实体关系的正向查询和反向查询；来源 Record 读取固定为“关系表键集分页 → Record 批量读取 → 按关系顺序重组”的两段查询。

验收：仓储测试覆盖用户隔离、空类别过滤、稳定排序、双向关系读取，以及同一时间戳下关联 Record 游标不漏项、不重复。

## 4. 实现 `CreationKindService`

- 封装类型目录查询与 `kindId` 校验。
- 统一为 Creation、Proposal 读模型补齐类型标题。

验收：类型目录能返回稳定名称和显示标题；Creation / Proposal 读模型能正确补齐类型信息。

## 5. 实现 `CreationService`

- 实现首页概览、列表、详情、按 Creation 查询 Record、按 Record 反查 Creation。

验收：首页返回正确前三条和统计；详情不内嵌 Record；关联 Record 可游标分页。

## 6. 实现 `CreationProposalService`

- 实现 Proposal 列表、详情、关联 Record 查询与 Record 反查 Proposal。

验收：Proposal 列表、详情与关联 Record 查询均按用户隔离、状态和游标正确返回。

## 7. 实现 HTTP 路由与授权

- 提供设计中列出的类型、Creation、Proposal 和通用关系查询接口，且全部使用 `GET`。
- 所有路由复用 `x-user-id` 用户隔离；关系查询必须以关系表 `user_id` 过滤，并以第二段 Record 查询再次限制 `user_id`。
- 不实现任何业务写入路由。
- 更新统一的 HTTP API 文档及示例。

验收：HTTP 集成测试覆盖列表、详情、关系分页和跨用户访问拒绝；不存在业务写入路由。

## 8. 回归与交付验证

- 运行删库重建、类型检查、当前装配服务的回归测试和新增模块测试。
- 验证当前 Record API 未受关联表调整影响，并确认旧主动创作、Agent、Task 和写路由不再装配到当前服务。
- 使用 fixture 分别验证：空用户、仅 Proposal 用户、多个类型用户、三种状态和一条 Record 关联多个实体。

验收：所有测试通过；现有 Record、媒体路由无回归；当前服务不装配 Agent、Task、Heartbeat 或任何业务写入接口。

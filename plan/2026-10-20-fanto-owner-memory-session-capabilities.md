# Fanto Owner / Memory / Session / Dynamic Agent 重构方案

- 日期：2026-10-20
- 状态：待执行的技术方案；**本文件不代表功能已实现**。
- 范围：Server、PostgreSQL Migration、Main Agent、H5/iOS。
- 前提：保留 Pi AgentHarness、现有 Proposal/Creator Agent、现有 Records/Projects/Media 服务；优先最小改造，不新增通用插件平台。
- 依据：本次实际检查 apps/server/agent.yaml、domain/fanto、domain/memory、domain/records、agent/harness、agent/context、agent/tools、agent_session Schema、H5/iOS Fanto 设置与会话链路。

## 1. 已确定的产品语义

1. Fanto 是可选角色：用户可有零个 Fanto。当前客户端仍以**最多一个当前 Fanto**为目标，不做角色列表或多角色同时交互。
2. 无 Fanto 时前端仍正常进入 **main**；Main 使用通用、非角色化的 Core Prompt，不补一个虚构人物、不注入默认身份，也不装载 UserMemoryTool / FantoMemoryTool。
3. Fanto 的**身份设定创建后不可修改**，包括角色名、身份性格、世界背景、初始关系、初始对话样例；要更换身份，只能删除后重新创建。工具能力和动作旁白是可修改的**运行设置**，不是身份内容。头像等展示资产是否允许换图可以后续单独确定，不能借其改写身份。
4. Main 的 Record 访问、User Memory 访问、动作旁白分别开关。FantoMemoryTool 在有 Fanto 时默认开放；present_media 默认开放；Record 和 User Memory 不默认授予角色访问权限。
5. UserMemoryTool 与 FantoMemoryTool 是**两个不同 Tool**，各有不同 Memory Kind 和固定 Scope；模型 Tool 参数里没有 ownerId/userId/fantoId，由服务端解析。
6. 不再自动注入 recent_records；不再基于未授权数据执行相关 Record Context 检索。允许时由 Agent 按需调用 record_read。
7. 主对话 Session ID 不允许通过“新建会话/清除历史”自由轮换。仅在生命周期**首次初始化、创建 Fanto、删除 Fanto 并回到默认 Main**时产生所需 Session。Proposal/Creator 的内部 Session 创建是独立业务，不受此限制。
8. 删除 Fanto 清理其角色设置、Fanto 记忆、所有归属于它的 Main Sessions 及 Entries/Usage、角色独占媒体；保留用户原始 Records、User Memory、Projects、Proposal/Creator Sessions。
9. 删除最后一个 Fanto 是合法状态，不自动补建一个默认“Fanto 角色”记录。

## 2. 当前实现中需要消除的旧假设

| 位置 | 当前行为 | 新目标 |
|---|---|---|
| apps/server/agent.yaml | main 固定 tools: record_read、memory_manage、present_media | 服务端 Tool 白名单保留，Main 最终 active tools 由有效能力配置控制；memory_manage 替换为两 Tool |
| agent/harness/build-runtime.ts | AgentHarness.create 在新建、冷恢复或静态 definition revision 不同等情况下执行；Session 缓存可长期复用 | 保留缓存；每轮开始准备有效能力，并用 lane.setActiveTools；不要误以为每轮创建 Harness |
| agent/context/providers/records.ts | main 每轮取最近两条 Record 注入 recent_records | 删除 main recent_records 路径；清理未用代码 |
| agent/prompts/main.ts | 始终有 Persona 段、动作旁白规则、Memory 指令、recent_records 段 | Core + 条件 Persona/Memory/Record/Narration 模块；无角色时没有伪造的角色名与人格 |
| CharacterProvider / FantoService | 找不到 Fanto 时回退“Fanto”名称与 DEFAULT_CHARACTER | 配置解析显式区分 NoFanto 与 Fanto；不把缺失行视为隐式存在的 Fanto |
| domain/memory | memories.user_id + 单一 memory_manage + 统一 kinds | owner_type/owner_id + 两组 kind + 双 Tool + 按 owner 查询 |
| domain/records | records.user_id 引用 users；Record Service 以 userId 作为所有查询 scope | owner_type/owner_id；入口鉴权仍用 userId；业务 owner 只能服务端解析 |
| domain/fanto | PATCH 可修改 Persona 与 sessionId；旧 /api/character 可绕过 | create/patch capabilities/delete 生命周期；身份不可更新；sessionId 不允许 PATCH |
| routes/agent/sessions.ts | POST /sessions 可直接新建 Main Session | 禁止公开任意创建 main；首次 Main bootstrap 和 Fanto 创建/删除由服务端原子化管理 |
| agent_session.sessions | 只有 user_id/agent_id，无 fanto_id；entries/usage 没有 Session 外键级联 | 保留 user_id 鉴权列及 agent_id；补 fanto_id；删 Fanto 时显式清子表与缓存 |

注意：现有代码的 User Memory 默认注入与 record_recent 是**两个不同通道**。去掉 record_recent 不能自动解决 User Memory 开关；关闭 User Memory 时必须同时停止 Tool、Context Provider 和 Prompt 相关路径。

## 3. 数据归属：统一 owner_id，但不混淆身份与鉴权

### 3.1 owner 的含义

建议 Records 和 Memories 采用同一对字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| owner_type | TEXT CHECK IN ('user','fanto') | 归属实体类型，必须有 |
| owner_id | TEXT NOT NULL | 当 owner_type=user 时为真实 userId；当 owner_type=fanto 时为 fantoId（UUID 字符串） |

**仅 owner_id 而没有 owner_type 不安全**：真实用户 ID 和 Fanto UUID 都是字符串，不应假定永远不冲突；也无法表达明确的访问规则与唯一索引。owner_type 是必要的最小补充，并不否定 owner_id 的泛化要求。

- 用户所有者：从已校验 JWT 获得 userId；查询 owner_type=user AND owner_id=userId。
- Fanto 所有者：从受信任 Session 或 Fanto Settings 得到 fantoId；通过 user_fanto_settings WHERE fanto_id=fantoId AND user_id=当前 JWT 用户，查询 owner_type=fanto AND owner_id=fantoId。
- **模型永远不允许自行传 owner_type/owner_id，更不允许通过替换字符串跨越 Scope。**
- 未来 Fanto 产生自身世界 Record 时，owner_type=fanto；用户记录保持 owner_type=user；Main 的 record_read 对用户数据的许可不等于 Fanto Record 访问权限。
- 对 Record/Memory 的鉴权始终在业务 Service/Repository 查询中完成，而不是只在 Controller 或 Tool 入口做一次判断。

不建议把其他业务表（users、user_profiles、projects、proposals、media_assets、agent_session.sessions）的 user_id 全部改名。它们表示实际账号归属/计费/鉴权，而不是可泛化的内容所有者。**本次仅按要求将 records.user_id、memories.user_id 改为 owner_id，并补 owner_type**。

### 3.2 为什么现有外键不能简单改名

records.user_id、memories.user_id 目前是 REFERENCES users(user_id) ON DELETE CASCADE。改为多态 owner_id 后，不可能继续使用原外键约束同时指向 users 和 user_fanto_settings。

目标：
1. 去除旧的单一 users(user_id) 外键；迁移时明确记录被删除用户的清理策略。
2. 新增 owner_type + owner_id 的非空及 CHECK 约束、对应复合索引（含 records 时间线、向量查询，memories 时间与向量查询）。
3. 关系用可信解析：fantoId -> user_fanto_settings.user_id。Fanto 删除事务显式删除 fanto-owned rows；用户注销事务必须显式删除两类 owner 的 Record/Memory，不能再寄希望于旧 FK。
4. 需要数据库级兜底时可使用限定触发器，在删除 Fanto/用户时兜底清理，且迁移/测试必须覆盖直接 SQL 删除路径；不要留下无法检测的 orphan owner。
5. 纯改名并不会让所有 Record 业务自动支持 fanto owner；Repository、Media 校验、关联、Embedding/Postprocess 和上层业务都要逐层区分认证 userId 与内容 owner。

### 3.3 Record 所有权迁移

现有 records 全是用户记录：批量填 owner_type='user'，owner_id=旧 user_id，校验总行数、逐 owner 数量、索引命中与权限后才 drop 原列、外键和索引。若当前部署仍有旧版 API 在服务，使用兼容迁移或短维护窗口，不允许旧代码在新 Schema 上继续写入。

- Record Service 需要输入“可信 owner scope”，而不是盲目将所有 userId 参数批量替换为 ownerId。
- 用户 Record 的创建/编辑/删除/分页/搜索/向量检索依旧按 JWT user owner 作用域运行。
- media_assets.user_id 仍是账户级资产所有者；Fanto 所属 Record 关联媒体时需同时校验媒体的实际 userId 及用途/来源，并规划 Fanto 删除后的孤儿媒体清理。不能把 fantoId 当成 media_assets.user_id。
- record_links、Projects/Proposals 当前属于 user 级创作业务；Proposal/Creator 只能检索 user-owned Record。未来 Fanto World Record 的自动分析/创作需要另立授权，不纳入这次链路。
- Record postprocess、Embedding 队列仍必须按可信 owner 校验并检查 owner 是否在处理期间被删除，避免删除后异步任务重新写入。
- 删除账户时要覆盖 Fanto-owned Records、其媒体、所有现有 Record 关联；不能只删除 owner_type=user 的数据。

## 4. Memory：双 owner + 双 Tool + 各自 kind

### 4.1 表与数据模型

一张 memories 表继续复用 768 维 pgvector；字段为 memory_id, owner_type, owner_id, kind, content, embedding, created_at, updated_at。保留一张表但**类型逻辑隔离**。

建议新增组合约束：
- owner_type=user => kind 只允许 UserMemoryKind。
- owner_type=fanto => kind 只允许 FantoMemoryKind。
- 各类记忆条数上限分别对 (owner_type, owner_id) 统计，不能用旧 countByUser 混算。
- 所有 CRUD / search 的 WHERE 必须带 owner_type + owner_id；find/update/delete 再加 memory_id，防止跨作用域更新。

UserMemoryKind（延续当前四类）：
- personal_background
- important_relationships
- current_focus
- interaction_preferences

FantoMemoryKind（独立定义）：
- shared_history：双方确实发生的对话/约定/已确认剧情（区分虚构与现实）
- relationship_state：角色与用户关系的稳定阶段、双方明确边界
- ongoing_threads：角色尚未完成的事项、已约定的后续
- personal_experiences：Fanto 已确认的自身经历与成长；非独立的世界时间线 Record

原 shared_history 从 User kind 中撤出；迁移时优先按用户已有唯一 Fanto 关系归入对应 fanto owner。**不能确认归属的历史记忆保留为暂存/兼容数据供审计，不得自动注入任意新角色；绝不静默删除或伪造其归属。**

### 4.2 两个 Tool

| Tool 名（建议） | 加载条件 | 作用域 | Kind |
|---|---|---|---|
| user_memory_manage / UserMemoryTool | 有 Fanto 且其 userMemoryEnabled=true | user | UserMemoryKind |
| fanto_memory_manage / FantoMemoryTool | 有 Fanto 时默认加载 | fanto | FantoMemoryKind |

两 Tool 均保留 list/search/create/update/delete 的既有基础功能，但参数 Schema 的 kind 枚举完全不同；不暴露 scope/ownerId/userId/fantoId 参数。底层 MemoryService/Repository 复用通用逻辑，通过服务端绑定的可信 owner scope 和各自允许的 kind 列表执行，避免复制两套向量存储实现。

关于 userMemoryEnabled：用户提出的是“允许读取用户 Memory”；若 UserMemoryTool 含写入能力，**前端授权文案必须明确为“读取和维护我的长期记忆”**，不能只写“读取”。若产品坚持只授予“读取”，则 UserMemoryTool 的 create/update/delete 必须另行限制；MVP 推荐单个“访问与维护”授权并默认关闭，不增加第三个开关。

### 4.3 Context Provider 与泄漏防护

- userMemoryEnabled=false：不激活 UserMemoryTool，**不调用/注入 user_memories 或 user 级 relevant_memories**，Prompt 也不许暗示已读取用户记忆。
- 有 Fanto：按需加载 Fanto 级相关记忆；可有经过预算约束的基础关系记忆，而非所有 Fanto 条目每轮全文注入。
- 无 Fanto：两个 Memory Tool 均不加载，也无任何 User/Fanto Memory Provider 注入；用户原有 Memory 数据仍保留。
- 关闭 User Memory 不删除历史已进入会话或 Fanto Memory 的信息，也不阻止用户在当前聊天中自述；这是后续读取权限撤销，不是历史信息“自动遗忘”。若未来要做到彻底忘记，需单独设计来源追踪和数据擦除。
- Memo 初始化、Provider 候选检索、tool 执行、compaction/history 都要审视来源；只切掉工具但仍注入 Provider 是权限漏洞。

## 5. Fanto 模型：不可修改身份 + 可变能力

### 5.1 现有 user_fanto_settings 可继续复用

继续使用 fanto_id (UUID PK) + user_id(真实账号归属) + role_config JSONB + 当前 Session 引用 + version。因为需要允许 0 个 Fanto，读取到 NULL 是合法的 NoFanto 状态；创建时生成全新的 fantoId。

建议在 role_config 中区分：
- immutable identity：character、scenario、instructions、exampleDialogues；nickname（现有外部列）及身份相关描述字段也应约束创建后不可编辑。
- mutable agent options：recordReadEnabled、userMemoryEnabled、narrationEnabled；未来更多允许 Tool 的能力可以继续添加。
- UI 中若允许修改外观，仅限与身份不冲突的展示图片；身份文本不经 PATCH。

示意（逻辑模型，非立即执行 API Schema）：

~~~json
{
  "identity": {
    "character": "...",
    "scenario": "...",
    "instructions": "...",
    "exampleDialogues": "..."
  },
  "agent": {
    "recordReadEnabled": false,
    "userMemoryEnabled": false,
    "narrationEnabled": true
  }
}
~~~

实现可继续兼容 role_config 的现有扁平身份四字段，不强制存量 JSON 大迁移；只须提供受校验的 agent 可变子对象。新建默认 Record/User Memory 关闭；存量用户启用状态不能从空字段隐式推断“同意授权”，迁移需确定明确默认和产品告知（安全起见未显式确认按 false）。

### 5.2 动态 Main 配置

服务器静态配置保留 main 的模型、compaction、支持的 Tool 集及基础 Prompt 模块，Proposal/Creator 不由 Fanto Settings 控制。

| 状态 | 激活 Tools | Prompt |
|---|---|---|
| 无 Fanto | present_media、record_read（延续默认 Main 读取用户 Record 的现有功能；若需要隐私收紧，可另外调整为关闭） | 通用 Core + Record/Time；无 Persona、无两类记忆、无 Narration |
| 有 Fanto | present_media、fanto_memory_manage；若对应开关开启，再加 record_read / user_memory_manage | Core + Persona + Fanto Memory + 按授权注入的 User Memory/Record + 可选 Narration |

说明：默认 Main 的 Record 读取保留“现有 main 功能”这一假定。若需要把“没有角色”同时定义为“只允许普通聊天”，可以在最终执行前将无 Fanto 的 record_read 设为关闭，但不能让该行为成为隐式的数据权限漏洞。默认 Main 既不持有 Fanto 身份，也不能写 Fanto Memory。

System Prompt 不能继续用一个永远存在的“角色名称/Persona”固定段加空字符串。应按有效配置决定是否拼接各个模块，保证无 Fanto 时不存在“你是 Fanto 角色”“昵称 Fanto”或动作旁白示例。提示词中的记忆、Record 工具说明只在对应能力激活时出现。

Pi SDK 现有 AgentHarness.create + lane.setActiveTools 已支持 Active Tools 切换：Harness 创建/冷恢复时注册允许的 Main Tools 集合；每次 Run 先获取**同一份有效配置快照**，再设置 Active Tools，构建本轮 Prompt/Provider。可复用 Harness，不要每条消息重建，也不要让多个 Provider 各自读不同版本 Fanto Settings。权限撤销要在 Tool 实际调用的 Service 层再次核对，防止缓存/竞态与历史工具执行入口绕过。
- 仍需在 SessionManager 的 reserve/acquire/run 准备阶段确保单 Session 串行；改动期间禁止正在进行的模型 Run 换权限。
- 工具展示/History 不应依赖“当前激活 tools”来解释过去的历史工具；必要时用服务器完整 Tool 元数据映射。
- present_media 虽始终存在，但它不能以旧 Record 返回的 mediaId 绕过当前关闭的 Record 授权；展示历史媒体需按来源、scope 和真正的资产访问权限审查。

## 6. agent_id 保持 main；fanto_id 标识实例

**不建议把 agent_session.sessions.agent_id 改为 fantoId。**

- agent_id = 运行时 Agent 种类 main / proposal-agent / creator-agent：映射模型、Prompt、Skill、Tool 白名单、Admin 统计/路由。
- fanto_id = 实例身份（可空）：绑定“哪个 Fanto 的对话及其记忆”。无 Fanto 的 main Session 为 NULL。
- session_id = 一段持久化对话链的技术标识；当前产品对每个状态只允许一个 active main Session。

新字段：
- agent_session.sessions.fanto_id UUID NULL；仅 agent_id=main 可填写。
- 保留 agent_session.sessions.user_id，用于账号级所有权、查询过滤、运行和审计，不把 Fanto ID 混成真实登录身份。
- 可设 DB 约束 (agent_id <> 'main' => fanto_id IS NULL)；增加 (user_id, agent_id, fanto_id) 和 (fanto_id) 索引。
- 当前 Main 稳态每个已存在 Fanto 仅允许一个 active Session。若历史存在多个绑定同一 Fanto 的 Session，迁移时须先确认归属，旧数据可在删除 Fanto 时一并清理；不要随意删除或强行唯一化未整理的存量 Session。

这样不改 Registry 的 Agent ID 解析规则，也不影响 Proposal/Creator 的 Session。

## 7. Session 生命周期：不允许自由新建

### 7.1 默认 Main（用户没有 Fanto）

- 第一次进入：Server 原子检查当前用户是否没有 Fanto，若无合法默认 Main Session 则**只初始化一次**；后续每次返回同一个 sessionId。
- 不能通过客户端调用 POST /api/agent/sessions(agentId=main) 生成额外主对话；也不能 PATCH Fanto.sessionId 指向任意新建 Session。
- 无 Fanto Session 由 agent_session.sessions 的 (user_id, agent_id='main', fanto_id IS NULL) 唯一可定位；不依赖不存在的 Fanto Settings 行。建议数据库唯一约束/唯一部分索引确保同时启动多个客户端仅创建一个默认 Main Session。
- History/Stream 继续以服务端返回的实际 Session ID 工作；Main 启动入口应提供幂等 resolve-or-bootstrap，而不是通用 Create Session。

### 7.2 创建 Fanto

- 校验同用户尚无 Fanto（当前最多一个）、固定 Identity、能力设置。
- 创建新 Fanto + 首个 Fanto Main Session，原子绑定 user_fanto_settings.session_id 与 agent_session.sessions.fanto_id。属于身份**首次初始化**，不是用户自由“新建会话”。
- 如用户此前使用无 Fanto 默认 Main，为避免把原始普通聊天强行变成新角色的共同过去，建议在创建时同步退休/删除旧默认 Main Session（执行前必须明确提示将清空此前默认对话；若不允许丢失，需产品提供导出或显式迁移而非直接合并）。不能沿用旧 sessionId 冒充新的角色关系。
- 创建中出错回滚，不留下失联 Fanto 或孤立 Session。可以先在数据库事务中写入 session 元数据，再按当前 LiveSessionRepo 在首次 acquire 时懒加载 Harness；避免将模型/Harness 初始化放在数据库事务内。

### 7.3 角色日常使用

- 所有正常交互保持同一 sessionId；能力开关生效不改变 sessionId，不删除记忆或历史。
- 移除 iOS/H5“清除对话记录→建新 Main Session”的现有流程。无“新会话”按钮或任意指定 sessionId 的写入口。
- 如果角色设置发生版本冲突则返回 409 供客户端刷新；不得重置或交换 Session。
- GET History、Stream、Stop 在确认登录用户所有权后还要验证 Main Session 的 fantoId 与用户当前绑定角色状态相匹配，拒绝已删除/已退休的 Session。

### 7.4 删除 Fanto

- 当前有运行中的 Main：返回 409 BUSY 或要求先停止并确认停止收尾。**绝不在 Tool 执行期间直接删除数据库并声称成功**。
- 通过防止新 Run 的删除锁/状态，以及用户行或 Fanto 行锁，令“判断空闲→删除”之间不能被另一个请求重新启动会话。当前 SessionManager.running 只适用于单进程，多实例部署前必须引入数据库可见的 gate/lease 或等价互斥，不能用进程内 Map 保证多实例安全。
- 数据库事务里删除该 fantoId 关联的全部 Main Session 的 entries、usage_ledger、sessions；删除 Fanto-own 的 memories/records；删除 user_fanto_settings 本体。禁止仅删除当前 session_id 指向的一条，会遗漏存量历史。
- 清除 SessionManager 的缓存 Harness/Checkpoint，保证迟到的 checkpoint 不会重写已删数据。非数据库媒体/对象存储清理由提交后的幂等清理任务执行；失败可重试，不将对象存储网络操作放在长 DB 事务内。
- 清理角色专属头像与未来 World Record 专属媒体；不清理用户个人 Records、User Memories、Projects、Proposal/Creator Sessions、用户头像及可共享媒体。
- 删除后**保持无 Fanto**，下一次进入对话由幂等 bootstrap 创建一个全新的默认 main Session（或事务中同时完成默认 Main Session 初始化），绝不继续读取已删除 Fanto 的旧会话。这个创建是删除后默认模式的必要初始化，不是允许重复新建。
- 账户删除则要覆盖其所有用户/Fanto 作用域内容和 Agent Sessions；普通账号级记录、Project 等仍按原账号归属语义删除。

### 7.5 隐含的产品取舍

“只有在 Fanto 中明确删除才能创建新的 Session”如字面上不允许首次 bootstrap、首次创建 Fanto 时生成 Session，将无法运行无角色 Main 或新角色。因此本方案将**禁止用户自由重置**作为硬规则，首次初始化与身份创建/删除视为必需的生命周期例外。对用户而言不存在新建会话入口；所有例外由服务端内部控制。测试须验证后续重复请求返回同一 ID。

## 8. API/客户端目标接口（建议）

建议生命周期操作进入 Fanto Domain 的 Service；HTTP Route 不直接访问 Repository，Agent Tool 不调用内部 HTTP。

- GET /api/fanto/settings：返回 mode: 'default'|'fanto'、fantoId|null、roleConfig|null、agentOptions、sessionId。无 Fanto 为正式响应，不返回虚构 Persona。
- POST /api/fanto：创建新的不可变身份、初始化 Fanto Session；拒绝重复创建。
- PATCH /api/fanto/settings：仅允许 agentOptions（和明确认可的展示偏好）；必须有 expectedVersion；拒绝修改固定身份、nickname、sessionId。
- DELETE /api/fanto：确认式删除，有 expectedVersion 或其他并发控制；在非空闲、处理中返回明确状态，不静默部分删除。
- GET /api/agent/main-session（或等价的初始化/解析动作）：幂等返回当前默认或 Fanto Session ID；不接受任意 agentId/sessionId。
- POST /api/agent/sessions：Proposal/Creator 专用内部 Server 路径可继续调用 SessionManager.create；公开 HTTP 禁止 agentId=main 任意创建。不得因为客户端传 proposal-agent 就允许绕过 Creator/Proposal 的业务授权新建内部会话。
- GET/Stream/Stop 的通用历史功能继续保留，遵循 userId + fantoId + sessionId 绑定授权。

- iOS/H5：角色选择创建、能力开关、删除确认与删除后的无角色 Main；移除“清除对话”建立新 Session 的 UI/Store 代码；存储 sessionId 只以服务端响应为准。
- 旧 /api/character PUT 必须停用或变为不可变身份的只读兼容入口，不能绕过身份锁定。
- 首次无角色时不强制要求选角色才能聊天；可在设置入口创建角色。删除操作文案准确标明 Fanto 对话、角色记忆与角色资料会永久删除，用户自身 Record/User Memory 保留。

## 9. 迁移方案与数据保护

禁止“运行新代码后再靠旧 baseline 的 CREATE TABLE IF NOT EXISTS 自动修改结构”；现有生产 PostgreSQL 要使用**前向 Migration**处理列、约束、索引、校验与回填，且依赖重置 baseline 的开发/新库流程要同步得到相同目标结构。

建议分阶段：
1. **迁移前审计**：统计 memories/records 按 user_id 数量、shared_history 数量；Fanto 行数量、单用户多个 Fanto；main Session 数量/归属；无法归属的旧会话与头像/媒体引用。
2. **扩展（additive）**：Records/Memories 增 owner_type/owner_id，并按旧 user_id 回填；Session 增 fanto_id；Fanto agentOptions 增 Schema 默认；增加复合索引与检查约束。先不 drop 老列。
3. **Session 关联修复**：用户唯一 Fanto 可以将本人旧 main sessions（不只当前指针）按经过核验的规则补到 fanto_id；无法证明身份的旧 Session 隔离报告，不得与新 Fanto 混用。无 Fanto 的旧 Main 选合法默认会话；重复/冲突须有显式处理清单，避免产生多个“当前”会话。
4. **Memory 类型迁移**：现有用户四类标 owner_type=user；shared_history 若能判定唯一归属，移至 owner_type=fanto 并使用 fantoId，不能判定的兼容数据保持可追溯且不注入运行 Prompt。保留内容/Embedding/原 ID/时间戳，不重复 embed。
5. **代码切换与验证**：全部 Repository/Tool/Service 替换旧 user_id 访问路径；排除旧 API/任务路径继续写旧列，迁移检查通过后再收紧 NOT NULL、DROP 老列/索引/外键，修订 baseline 的新库目标结构。
6. **数据删除策略校验**：直接删除账户、删除 Fanto、删除失败重试均不会产生 records/memories/session 及关联媒体的孤儿数据；不要依赖多态 owner_id 上已经移除的旧 FK。
7. **对现有用户配置的策略**：未明确授予的 User Memory/Record 权限默认关闭；迁移发布需让用户知道原本自动上下文行为变了。保留数据，不以“开启过旧版默认工具”为用户显式授权证据。

如用户允许在**开发环境清空既有角色/会话/记忆数据**，可以单独制定更简单的重建基线；但在没有此授权时，本文默认保留历史用户数据，不自动 DROP 旧生产表或悄悄删除存量 Session。

## 10. 主要改动路径

### Backend / Migration
- apps/server/src/migrations/**、infrastructure/database/schema.ts、infrastructure/database/agent-schema.ts：owner_type/owner_id、新索引与约束、main fanto_id、删除行为。
- apps/server/src/domain/fanto/model.ts、fanto-service.ts、postgres-repository.ts：显式 NoFanto，创建/删除、不可变 Identity、agentOptions、唯一 active Fanto 与 Session。
- apps/server/src/domain/memory/model.ts、memory-service.ts、repository.ts、postgres-repository.ts：双 kind 双 owner 查询、独立配额、数据迁移。
- apps/server/src/domain/records/**、相关监听器/事件消费者/Embedding、Projects/Proposals：owner scope 替换；用户记录业务维持 user-owned。
- apps/server/src/agent/tools/memory.ts 拆成 user-memory.ts/fanto-memory.ts 或通用工厂 + 两个具体 Tool；tools/index.ts 更新名称与创建。
- apps/server/src/agent/context/providers/memory.ts、character.ts、records.ts、providers/index.ts：按有效能力解析，删除 recent_records 注入；无 Fanto 时无角色/用户记忆上下文。
- apps/server/src/agent/prompts/main.ts：拆出 Core、Persona、Tool/Memory、Narration 条件片段。清理 collect_user_input 等不再使用的 Tool 定义/引用时避免误删历史兼容投影。
- apps/server/src/agent/harness/build-runtime.ts、session-manager.ts、definition.ts、run.ts、registry.ts：统一 Effective Config 快照、按 Run setActiveTools、会话固定绑定、删除缓存、归属一致性、Tool 历史兼容。
- apps/server/src/routes/fanto.ts、character.ts、routes/agent/sessions.ts、stream.ts：权限、生命周期、禁止任意创建 main、不可写 sessionId。

### Clients
- apps/h5/src/api/fanto.ts、fanto/*、agent 会话 Store：mode/agentOptions/创建删除/固定 session。
- apps/ios/fanto/fanto/Models/*、FantoSettings/*、Conversation/*、Networking/*：对应字段、无 Fanto UI、删除确认、移除清除并换 Session 的逻辑。
- 更新 OpenAPI/共享类型（如存在）、错误码、客户端缓存版本和设置冲突策略。

Proposal/Creator 不继承 Fanto 的工具或记忆开关，继续按 userId 和其业务可信上下文访问 User Records/Projects；不得通过角色删除清理它们的会话。

## 11. 测试与验收

### A. Owner 与数据隔离
- 用户 A/B 相同 ownerId 文本的冲突情况下，由 owner_type + 当前 JWT 仍拒绝跨用户读写。
- User Record / Fanto Record 同库共存，分页、find、update、delete、向量搜索均不串数据。
- Record postprocess、Embedding、media 校验、Proposal/Creator 只用合法 owner；删除进行中不恢复写入。
- 账户删除会清理用户及其 Fanto-owned Rows，不依赖已经移除的 user_id FK。

### B. 两 Memory Tool
- 无 Fanto：两个 Memory Tool 均不存在，Prompt 不注入 user/fanto memories。
- 有 Fanto 且 userMemoryEnabled=false：UserMemoryTool 不可调用，User Memory Provider 不执行；FantoMemoryTool 可以正常写当前 Fanto。
- 开启 userMemoryEnabled：两个工具分别读写独立 owner/kind；交叉 kind、伪造 fantoId、伪造 userId、跨用户 memoryId 操作全部拒绝。
- 关闭后：下轮不再读取 User Memory；原有记录/历史数据不误删。
- shared_history 旧数据迁移后归属准确；无法归属不会注入新角色。

### C. Prompt 和动态 Tools
- Core 空 Persona 正常输出普通对话，不出现默认角色名、虚构关系、narration。
- narrationEnabled=true 使用角色动作引用块；关闭时不输出角色旁白规则，不影响普通 Markdown 引用。
- recordReadEnabled=false 不存在 record_read active tool，也没有 recent_records 或旁路检索；present_media 无跨权限泄漏。
- 同一个 Session 切换能力后新一轮立即生效，AgentHarness 不需要每轮重建，历史与 compaction 正常。

### D. 单 Main Session 与删除
- 无 Fanto 时，多设备重复 bootstrap 返回同一个默认 sessionId；公开 POST /sessions(main) 禁止直接创建。
- 创建 Fanto 固定身份并创建唯一绑定 Session；PATCH 身份、昵称/底层 roleConfig、sessionId 均被拒绝；仅可改 capabilities。
- 角色删除（含历史迁移 Session）：entries/usage/memory/角色和独占媒体被清理；用户的原始 Record/User Memory/Projects/Creative Sessions 保留。
- 删除进行中拒绝新的 Run；正在执行时明确 BUSY，SSE/Checkpoint 不写回已删 Session；失败回滚后原 Fanto 可正常使用。
- 删除最后一个 Fanto 后回到 default main；无角色不复活 Fanto、无失联 Session；旧的 Fanto ID 和历史 Session ID 全部不能再访问。
- Proposal/Creator 新建内部 Session、任务执行和用户级统计行为不因 Main 生命周期变更而退化。

运行验证：至少 server typecheck、server test、隔离 PostgreSQL 的 migration/integration tests、H5 test/typecheck、iOS build 与主对话端到端测试。重点校验真实 PG 外键变化，不满足于仅通过 Mock Test。

## 12. 推荐实施顺序与验收门槛

- **P0 — Owner & Migration**：先建新 owner scope、保留旧数据、迁移与 Repository 查询测试。
- **P1 — Fanto & Memory**：无 Fanto 状态、固定 Persona、可变选项、拆双 Memory Tool 与对应 Provider。
- **P2 — Main Runtime**：条件 Prompt、删除 recent_records、动态 activeTools、权限撤销与媒体来源校验。
- **P3 — Session & Delete**：main 唯一会话、生命周期 API、删除事务/缓存/存储清理、多端幂等 bootstrap。
- **P4 — Clients & 回归**：iOS/H5 选角/删除/权限开关、历史兼容、完整测试和必要的 Current State 文档同步。

每一阶段至少在隔离测试数据库上通过完整核心链路之后再进入下一阶段；涉及生产已存在的持久数据必须有备份与回滚方案。

## 13. 仍需在实际执行前确认的产品取舍（已有建议默认）

1. **无 Fanto 默认 Main 是否继续允许 record_read？** 本方案暂按“继续现有 Main 能力”设为允许，但不允许任何 Memory Tool；如果希望严格空白 Main，可改为无 Record 的纯对话（只需调整 Effective Config）。
2. **User Memory 开关包含写入吗？** 建议“访问并维护（读写）”，前端文案如实告知；若只是“读取”，需要在 UserMemoryTool 动作层限制新增/修改/删除。
3. **创建 Fanto 时如何处理此前无角色 Main 聊天？** 默认建议删旧会话并新建角色会话，需有清楚的数据损失确认，不能偷偷继承关系。
4. **旧 shared_history、旧多条 Main Sessions 的迁移**：只能按可验证的角色身份归属，未明数据不做猜测；迁移前输出审计报告。
5. **多实例删除中的活跃会话检测**：当前进程内锁不足以覆盖未来多 Server，需要数据库可见的生命周期 gate，至少禁止并发删除/新 Run 竞态。

这些均不应成为本轮写文件的阻塞项。方案记录建议取舍；正式执行时按明确的产品决策和真实数据形态落地。

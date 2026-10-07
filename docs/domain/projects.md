# Proposal 与 Project

Proposal 保存待决策的创意建议，Project 保存用户已接受的脉络、summary 和当前成果。两者独立于 Task 与 Agent Runtime。HTTP 契约见 [HTTP API](../api/http-api.md#proposal--project)。

## 数据与状态

| 表 | 职责 |
| --- | --- |
| `proposals` | create / extend 提议、reason / idea / plan、可选 creation / session_id、参考记录与决策结果 |
| `projects` | title、summary、可空 cover_media_id / session_id、Markdown content、summary embedding、version |
| `record_links` | 以 user_id / type / outer_id / record_id 为主键的两类 Record 关联 |

Proposal 从 pending 单向变为 accepted 或 rejected；同一决策重复调用幂等，相反决策冲突。Project 只有 active / archived，归档为终态。没有 split、position、恢复、删除或外部直接创建 Project 的接口。Project 的 session_id 当前由接受 create 初始化为 null，尚未绑定 Agent Session。Proposal 的 session_id 保存生成该提议的 proposal-agent 内部会话；服务端通过可信 create options 写入，未提供会话时为 null。该字段是追踪引用，不授予公共会话访问权限；Session 在独立 SQLite 中，因此不建立 PostgreSQL 外键。

## 创建与接受

`ProposalService.create` 是服务器内部能力。输入至少一个同用户 Record，重复 ID 去重，任一不存在或跨用户引用使创建失败。create 必须提供 proposedSummary，不能指定目标；extend 必须指定同用户 active Project，不能提供 proposedSummary。

接受时在事务中锁定 Proposal、有效 Record、目标 Project。create 使用提议标题与 proposedSummary 创建 active Project，content 为空、version 为 1；extend 只添加 Record 关联，已有关系去重，新增关系才递增 Project version，不覆盖标题、summary 或正文。响应包含 resultProjectId / addedRecordCount，保留 Proposal 原始关联。全部参考 Record 已删除时失败并保持 pending；部分删除时使用有效记录。已接受提议重试返回同一结果项目，addedRecordCount 为 0。

Record 删除先锁 Record，再清理两类链接与递增受影响 Project 的版本，包括 archived 项目，整个操作同事务提交。接受、创建 extend 与删除都遵守 Record → Project 的锁顺序。参考内容通过 Record Service 查询，不复制正文。时间线按 record_event_at / record_id 倒序；若将来允许改变 Record eventAt，必须同步该冗余字段。

## 更新与查询

Project 更新必须提供 expectedVersion，校验归属、active 状态、版本和媒体后修改 title / summary / coverMediaId / content。缺省字段保持不变，content 空字符串清空正文，coverMediaId null 清空封面。无变化不递增版本，但仍校验状态与版本。summary 是整个项目的经历与主题边界，描述真实来源（明确时间 / 地点 / 场景）、有依据的主体、核心主题与风格、成果形式、保留 / 变化范围和适合延续的记录。目标 100–300 个中文字符，最多 2000；实体与主题词自然写入句子，不编造地点、人物关系，不堆砌关键词。提议阶段描述目标，发布阶段根据实际成果校正；append 保留原项目事实并补充新范围。

`projects.embedding` 是 summary 的 768 维 pgvector 派生字段，使用现有 Embedding Client。接受 create 时生成 summary 向量，再同事务创建 Project；summary 更新同时替换向量，创作发布同时保存正文、summary、向量与运行完成状态。向量服务失败返回 EMBEDDING_UNAVAILABLE，接受仍为 pending，更新保留旧正文、摘要与版本。title / content 单独更新不重算向量；向量不进入实体或 HTTP / Tool 响应。

`ProjectService.search(userId,{query})` 将自然语言 query 向量化，在同用户 active 项目中按余弦距离排序，固定最多 3 条，返回 projectId / title / summary / version / similarity；相似度仅用于候选排序，Agent 必须再确认语义关联。当前采用用户过滤后的精确向量查询，适用于几十个项目，不依赖更新时间分页。迁移保留已有摘要并将向量设为 null，第一次搜索按用户补齐缺失向量，条件写入校验 summary 未变且向量仍为空，不修改业务版本。旧摘要不会自动被模型重新解释，可通过 summary 更新纠正。

Project 列表默认 active，省略 content；详情返回正文、recordCount 和最近最多五条完整 referenceRecords。Proposal 列表可按 type / status / targetProjectId 筛选，参考记录单独分页。游标绑定用户、查询类型、父实体和过滤条件；updatedAt 排序不保证跨页快照，客户端按 ID 去重。

公共 `ProjectService.find / update` 支持受信服务器调用方传入 Kysely transaction，媒体校验和更新均使用该事务，不另开事务。`search`、Project `recordsPage`、`listReferencedMediaIds` 仅是内部能力。Repository 不从模块入口导出。

## Markdown 与媒体

content 为数据库中的 UTF-8 文本，最大 2 MiB；只将媒体二进制存 OSS。正文支持 Markdown、GFM 表格 / 删除线、`![说明](fanto-media://<mediaId>)` 与明确的 `html-preview` 围栏。连续图片段落组成图片组。普通 HTML 围栏作为源码，原始 HTML 不执行；链接只允许 HTTP(S) 或文内锚点。

更新使用 Markdown / HTML / CSS 语法树校验实际图片与样式 url 引用，排除普通代码示例。资源必须为同用户 ready Image；不接受外部图片、签名地址、Base64、本地路径、脚本、表单、iframe 或外部 CSS。静态 HTML 元素、属性和 CSS 规则使用白名单。`listReferencedMediaIds` 返回正文与封面的稳定媒体引用；当前没有媒体硬删除或 OSS 回收。

iOS 使用 Swift Markdown 解析器原生渲染正文、图片组、列表、引用、代码及表格；html-preview 使用非持久化 WebView，禁用 JavaScript、原生桥接和导航，CSP 限制资源来源。仅内部 fanto-media 图片请求通过受保护媒体接口换取签名 URL，失败后刷新一次；普通围栏降级为源码。H5 当前无 Project 页面。

## 创作契约边界

Proposal content.creation 可省略；提供时仅含 objective / context? / constraints? / successCriteria?，语义与 Task goal 一致，保存用户确认的结果目标、真实背景、约束和验收标准，不包含媒体 ID 或技术执行参数。Proposal 的 HTTP / Service / Tool 摘要字段使用 proposedSummary，数据库对应 proposed_summary；Project 与 creation_publish 使用 summary，不提供 Proposal summary 别名。

具体原图、主体与 1–3 张图片预算在 creator-agent 读取授权 Record 后，通过 creation_prepare 保存到 creation_runs.execution_plan。服务端校验 ready Image 与 Record 归属，并按 Proposal 类型确定 create / append；计划首次保存后不可改变，重试复用。提议与执行计划各自承担用户目标和付费执行边界。

`scanAcceptedCreations` 是受信应用层的跨用户恢复数据源，按 resolvedAt / proposalId 升序分页，只返回 accepted 且含有效 creation.objective 的提议及参考 ID。它没有 HTTP / LLM Tool 入口。启用创作链路后，后台登记每条接受提议的唯一 CreationRun；接受 create 仍先确定性创建空项目，creator-agent 负责发布成果。执行、恢复和权限边界见 [创作运行](../architecture/creative-runtime.md)。

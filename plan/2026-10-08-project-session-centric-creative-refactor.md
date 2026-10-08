# Project / Agent Session 中心化重构

日期：2026-10-08
范围：Server / Agent / Creative Runtime / Media / iOS / H5
状态：待执行（本文件为目标方案，不代表功能已实现）

## 1. 目标与边界

- **Project 是长期业务实体**：持有最新 `goal`、`content`、`sessionId`、标题/摘要/封面/版本等，不维护 Agent 执行状态。
- **Creator Agent Session 是唯一过程来源**：创建、后续追问、工具调用、创作过程都属于同一个 Session；直接展示 Agent 原生消息，不做百分比/图片数量/阶段进度。
- **Proposal 是待确认建议**：`content.creation` 改为 `content.goal`；接受后写入 Project 最新 Goal。Create 新建 Project；Extend 更新目标 Project Goal。
- 删除 `proposal_runs`、`creation_runs`、`creation_image_steps`，以及依赖这三表的 lease/runId/attempt/slot/progress/图片恢复等机制。不要另建运行表、进度表、预算表或生图幂等层。
- **最终成果媒体独立于 Record**：只有被 `project_manage` 最终保存的 `content` / `coverMediaId` 所引用的外部媒体才复制入 Project OSS 目录；未用于最终输出的参考图不复制。Record 删除按原有归属正常清理。
- `image_generate` 是无状态工具：多图参考输入，单图输出；不要求 prepare/固定数量/图片槽位。
- 保留基础用户归属、Session 与 Project 绑定关系、输入校验、媒体读写权限及乐观版本校验；**不保留**旧的 Creative Run lease/token 权限模型。
- 本次不改 Task / TaskRun 系统；不把其他任务的 Session 混入 Project Session。

## 2. 数据结构

### 2.1 Goal

```ts
interface ProjectGoal {
  objective: string;
  context?: string;
  constraints?: string[];
  successCriteria?: string[];
}
interface ProposalContent {
  reason: string;
  idea: string;
  plan: string[];
  tags: string[];
  goal: ProjectGoal; // 原 creation 改名，不增加图像执行参数
}
```

### 2.2 Project

```ts
interface Project {
  projectId: string;
  userId: string;
  sessionId: string | null; // 兼容未补齐的旧数据；新建绑定后必须有值
  title: string;
  summary: string;
  goal: ProjectGoal;        // projects.goal JSONB
  content: string;          // 当前完整成果，不限定图文/图片数量
  coverMediaId: string | null;
  status: "active" | "archived";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

- Proposal `sessionId` 仍是 proposal-agent 分析 Session；Project `sessionId` 是长期 creator-agent Session，两者不混用。
- `content` 暂时保留现有 string + `fanto-media://<mediaId>` 资源协议，兼容 Markdown / `html-preview`；工具不强制必须生成图像或 HTML。
- `goal` 和 `content` 均为**最新全量值**：支持单独更新，未传入字段不变；历史由 Session 消息保留；`content: ""` 可主动清空。
- `summary` 向量派生逻辑保留；`expectedVersion` 乐观锁保留。归档后默认不可继续写入。

## 3. 接受 Proposal → 绑定 Session → 启动

1. `POST /api/proposals/:id/accept` 通过 `ProposalService` 处理：验用户/状态；Create 创建 Project 并写入 `goal`；Extend 将 Proposal Goal 写入目标 Project，追加关联 Record（去重），不清除已发布 `content`。
2. 由 Server 创建或获取绑定到该 Project 的 `creator-agent` Session；**必须在执行首条 Agent 消息前**将 `projects.session_id` 写入数据库。
3. 接受接口返回 `resultProjectId` 和可使用的 `sessionId`；随后触发该 Session 执行一次与已接受 Proposal 对应的创作指令。
4. 重复 Accept 复用同一 Project / Session，不再重复初始化 Project；新建 Session 失败允许对已接受 Proposal 重试补齐 `sessionId`，绝不在未绑定时启动。
5. PostgreSQL 与 Session SQLite 不共享事务：业务确认持久化后再确保 Session 绑定；异常通过接受重试/轻量启动扫描补齐，未完成绑定前不得派发。不得为了分布式事务再新增 Run 表。
6. 同一 Project 的所有执行在同一 Session 中串行，包括自动初次创作、接受 Extend Proposal 后的继续创作及用户主动对话。复用现有 `SessionManager.reserve` 的占用机制；忙时返回明确“正在创作”，不并发修改同一成果。
7. 服务重启后可从已接受 Proposal、Project 绑定以及 Session 既有历史识别尚未开始的指令；按 Session 实际消息恢复/决定继续，不制造一套 `queued/running/completed` 业务状态。超时或异常保留真实 Session 历史，由用户继续对话或后台重新唤醒；不承诺外部生图调用恰好执行一次。

## 4. Agent Context / 权限

- `RunContext` 增加可选的 `projectId`，由服务端通过当前 `sessionId + userId` 与 Project 的绑定关系解析；**客户端与 LLM 不可任意指定目标 Project**。
- `creation_context` 仅包含 `{"projectId":"..."}`；删除 CreationRun、Proposal/Goal、图片数量、执行计划、阶段和已生成图片等注入。Agent 通过 `project_read(get)` 自行取得当前最新 `goal` / `content` / `version` / 关联 Record。
- 首轮指令只说明“当前 Project 已接受，读取最新目标并执行”，不将易过期 Goal 快照做成长期系统上下文；后续对话沿用 Session 既有记忆。
- creator-agent 可读取和继续其 Project；proposal-agent 仍用于 Record 自动发现。两者保留明确的内部角色边界，但移除 `CreativeAuthority` 的 `analysisRunId / creationRunId / leaseToken`、`CREATIVE_LEASE_LOST`、run 绑定校验。
- Agent 工具统一依赖可信 RunContext 用户身份和受绑定 Project（必要时查 Project 所属用户、状态与 Session）；`project_manage` 的 update 默认只能修改绑定的 Project。可保留 create action 供未来明确授权的无 Project 场景，当前 Proposal 接受链路不重复 create。
- 仅对**确实绑定该 Project** 的 creator-agent Session 开放用户侧历史与对话入口。禁止借此开放其它内部 Agent（proposal-agent）或跨用户 Session。
- 继续沿用 Agent Runtime 的会话持久化、Tool Presentation、历史投影、断线续读和内存级单 Session 串行；不增专用 Creative 权限/执行状态表。

## 5. Agent 工具定义

### 5.1 project_read

- `search` 保留现有用户隔离向量检索。
- `get` 返回完整 Project `goal`、`content`、`version`、封面及相关 Record（必要时按既有记录接口分页）。
- creator-agent 不能借 `get` 操作未授权 Project；受 Project Session 绑定约束。
- 不再仅给 `contentPreview` 截断结果作为全部创作事实；大内容可单独读取，但首选提供完整最新成果。

### 5.2 project_manage（取代 creation_publish）

```ts
type ProjectManageInput =
  | {
      action: "create";
      title: string;
      summary: string;
      goal: ProjectGoal;
      content?: string;
      coverMediaId?: string | null;
    }
  | {
      action: "update";
      projectId: string;
      expectedVersion: number;
      title?: string;
      summary?: string;
      goal?: ProjectGoal;
      content?: string;
      coverMediaId?: string | null;
    };
```

- 工具只管理完整 Project 的最新业务字段，不要求图文格式、已生成图片数量或固定发布步骤。
- `update` 支持更新 `goal`、`content`、`title`、`summary`、`coverMediaId`，未传字段保持不变；`content` 为**替换后的全部正文**，不要由工具按旧 `creation.composition` 自动 append。
- `create` 供有明确授权的 Project 创建场景使用；当前接受 Proposal 已经创建 Project，仅调用 update；Project 创建必须绑定当前 creator-agent Session。
- 业务写入复用 `ProjectService`，保留用户/Project 归属、版本、归档、摘要向量与媒体有效性检查。
- 成功返回**保存后**的 `Project`（含 canonical mediaId 的 `content` / `coverMediaId`、`version`）以及必要时的 `mediaIdMap`（原 → 新），供 Agent 后续继续引用。
- 工具声明可见的用户文案 `presentation`；成功修改即表示已持久化成果。无需另一个“发布完成”状态。

### 5.3 image_generate（纯生图）

```ts
type ImageGenerateInput = {
  prompt: string;
  referenceMediaIds: string[]; // 可传多张，模型支持数量以其真实能力为准
  aspectRatio?: "portrait" | "landscape" | "square";
};
type ImageGenerateOutput = {
  mediaId: string;
  mimeType: string;
  width: number;
  height: number;
};
```

执行：获取 RunContext 的 `userId/projectId` → 校验来源为该用户可读取的 ready image → 获取供模型使用的临时读 URL（必要时适配格式，临时对象用后删除）→ 调用生图模型 → 保存**一张**结果及 `media_assets` → 返回四字段。

- 不需要 `creation_prepare`、`imageIndex`、`executionPlan`、固定 imageCount、幂等/预算/进度记录、`creation_image_steps`、失败恢复。
- 工具输入不含 `userId`、`projectId`、`runId`；身份与目标来自服务端 Context。
- 生图结果直接存储到当前 Project OSS 路径；只生成一张；可多次独立调用。
- 临时参考素材不构成 Project 最终成果；结果是否被 Project 使用，仅以随后 `project_manage` 保存的成果为准。

### 5.4 其它

- `proposal_create` 接收 `content.goal`，保留创作提议展示字段。
- `record_read / skill_read` 保留，并按用户与 Project 授权读取；无需 creation-run 白名单表。
- 从 `agent.yaml` / Tool Factory / Prompt / BusinessServices 删除 `creation_prepare` 和 `creation_publish`，新增 `project_manage`；保留 `image_generate`、`project_read`、`proposal_create`。
- 更新 `creator-agent` Prompt：主动读取最新 Project，允许任意合法内容创作和继续对话，用户要求修改时通过 `project_manage(update)` 保存；不再把 Skill、图片数量或固定发布流程做成强制条件。

## 6. Project 媒体 OSS 目录与最终成果副本

### 6.1 存储约定

```text
users/{userId}/project/{projectId}/{mediaId}.{ext}
```

- Project 新生成图片直接写此目录；后续 Project 专属上传也使用此目录。
- 旧 Record 源图继续存原对象目录（如 `users/{userId}/media/...`），**不预先复制**。
- `media_assets` 仍保留唯一 `mediaId`、`objectKey`、`userId`、MIME、大小、ready 状态；Project 媒体 `ext_data` 可使用 `{ source:"project", projectId, createdBy:"image_generate" | "project_copy" }`，不保存 Run 或图片槽位字段。
- 临时生图参考适配图片属于临时对象，处理结束即清理，不作为最终 Project 媒体。

### 6.2 project_manage 写入时按需复制（核心）

对即将**最终保存**的完整 `content` 和 `coverMediaId` 提取所有实际媒体引用，逐一查 `media_assets.mediaId`：

1. 校验来源存在、属于当前用户、`status=ready`、类型受支持。
2. 若 `objectKey` 已在 **当前** `users/{userId}/project/{projectId}/` 前缀下：直接复用同一个 `mediaId`，不复制。
3. 否则：OSS 对象复制到当前 Project 目录，创建**新的 `mediaId`** 对应新 `objectKey` 的独立 `media_assets` 记录；保留正确 mime / ext / bytes / 可用尺寸信息。
4. 使用“旧 mediaId → 新 mediaId”映射改写 `content` 内所有对应引用及 `coverMediaId`，再将**改写后的最终内容**持久化到 Project；同一请求中重复引用的旧 ID 只复制一次。
5. 返回最终 Project 与可选 `mediaIdMap`。下一轮 Agent 以返回的 canonical ID 为准。

注意：一个 `mediaId` 只能对应一个 `objectKey`；**不能只复制 OSS 文件却让 Project 继续保存 Record 原 mediaId**，否则 Record 删除仍会破坏 Project 资源独立性。

- 复用当前 `inspectProjectContent` 的 AST 解析思路，扩展可定位/替换资源引用的函数；覆盖 Markdown 图片、`html-preview` 的 img 与 CSS url，以及 Project 封面；不得全文替换任意 UUID（避免误改普通文字/代码块/无关链接）。未来新增音频/视频等合法媒体嵌入协议时同步支持。
- 原本就在 Project 目录中的对象，无论来自 `image_generate` 还是此前复制，都不再复制；若来源为其它 Project 目录，仍按外部资源复制到**当前** Project。
- 只对最终保存的引用复制；仅出现于 Record、Proposal、Goal、Agent 上下文、历史、参考图输入的 mediaId **不复制**。
- `content` 未更新时，使用已持久化的当前正文和新封面构造目标最终状态；`content` 被更新时，以传入的**完整新正文**为准，不复制已被删除的旧引用。
- Project 写入过程中对来源 media 行持有与 Record 删除兼容的共享锁，Record 删除使用排他锁；完成副本及注册后再提交 Project 修改，避免边复制边删。OSS 复制失败不保存带悬空 ID 的 Project；DB 失败清理已确认的孤儿副本（可复用已有清理队列），不新增 Run 表。
- Project 后续更新/归档不会让 Record 原图成为其依赖。已有 Project 正文中直接引用 Record 原图的数据，在删旧表前/迁移时执行一次同样的副本归一化，否则旧数据不满足新不变量。

### 6.3 Record 删除回归简单

- `Record` 删除：按原逻辑删除独占媒体记录并登记 OSS 删除任务，保留对仍存在的 Task 产物等其它独立资源的既有规则；Project 不再要求保留原 Record mediaId。
- 删除 `ProjectService.retainedMediaIds` 的“扫描所有 Project 内容阻止 Record 媒体删除”特殊路径；删除 `MediaRepository.enqueueRecordDeletion` 中 `creation_image_steps/creation_runs` 的特殊保留分支。
- Project 结果永远只引用其 Project 目录内自己的 mediaId；Record 删除不影响已发布 Project 的作品与封面。
- Record 删除会清理关联记录关系；但已发布作品中的**副本媒体**仍可正常展示。
- 无需 Record → Project 永久媒体引用计数，也无需做未发布图片的预先复制。

### 6.4 上传 10 MiB 限制

- 图片**客户端直传**（Record 上传与以后 Project 上传）统一限制 `10 * 1024 * 1024` bytes；音频沿用原有限制。
- H5/iOS 本地选图校验；`POST /api/uploads` 服务端按 mime 与 bytes 校验；OSS 签名上传完成时核对实际 Content-Length / MIME，不依赖前端声明。
- 图片超限提示“图片不能超过 10MB”，统一返回明确上传大小错误码。历史超限图片如已存储，允许在最终作品副本迁移时复制原对象，不强制转换旧数据；模型生成图片的能力/大小限制由生图和图像校验决定，不套用用户直传规则。

## 7. Creative Runtime 与 Session 展示

### 7.1 调度收敛

- Record 分析：Record postprocess 后触发 `proposal-agent`，用原生 Session 运行，输出 `proposal_create` 或 `no_proposal`；从 `proposal_runs` 移除运行状态。最小 Record 版本/分析 Session 关联可使用已有 `records.ext_data`，只为触发去重/追踪，不另建 Run 表。
- Project 创作：从“扫描 `creation_runs` claim/续租/renew/finish”改为“接受 Proposal → 获取绑定 Session → 派发 Agent”；后台启动恢复从 Project/Proposal + Session 记录推导，不再有 `CreativeRunner` 的 lease/attempt 等状态机。
- Agent 实际工具事件经过现有 `subscribeHarnessEvents`、`resolveToolPresentation`、`projectHistory` 投影，按各 Tool 声明维护用户可见文案。内部大参数/密钥不展示。
- 初次创作和后续对话均复用同一 Session。完成的判据是 Project 实际 `content` 被 `project_manage` 成功更新，而非另写 `completed` 状态。

### 7.2 API

保留：
- `POST /api/proposals/:id/accept`（回 `resultProjectId / sessionId`）
- `POST /api/proposals/:id/reject`
- `GET /api/projects`、`GET /api/projects/:id`（返回 `goal` / `sessionId` / `content`）
- Project 查询与归档，以及必要的 Project 更新能力。

新增 Project 级授权入口（避免直接放开所有 internal Agent Session）：
- `GET /api/projects/:id/session/history?cursor=&limit=`：原生历史投影，支持分页。
- `GET /api/projects/:id/session/events`：只读订阅后台 Agent 文本增量/工具事件；重连先拉 History，事件不做持久独立表。
- `POST /api/projects/:id/session/stream`：用户追加一轮消息，沿用主会话 SSE 协议和 Session 并发控制。

删除：
- `GET /api/projects/:id/creation`
- 基于 `proposal_runs` 的 `GET /api/records/:id/proposal-analysis` 进度响应；若前端仍需要是否产生提议，只用 Proposal 数据推导，不返回 run/status/progress。
- 全部 Creative Run 相关的进度/attempt/lease/图片槽位字段。

注意：普通 `/api/agent/sessions/:id/history`、`/api/agent/stream` 对未授权内部 Session 的拦截仍保留；Project 专属路径在服务端验证 Project 所有权、Session 绑定与 Agent 角色后进入共享会话能力。

## 8. iOS / H5

- Proposal UI 保持现有标题/标签/效果/计划与确认交互；新 schema 解析 `content.goal`；补充想法随 Accept 写入 Project 最新 Goal。
- 新建/延续 Project 详情：没有成果内容时展示 Agent Session 的真实消息流和已完成 Tool Call；不再读取 creation.progress。当前正在运行时通过只读事件订阅观察，刷新后拉持久 Session History。
- Project 内容更新后刷新详情并展示最新 `content`；不要用模型文案/Tool Result 的“完成”伪造 Project 已保存。
- 已完成 Project 右下角悬浮 Agent 对话入口，点击打开同一个 Project Session；可继续提问、生成/修改内容、调用 `project_manage`，再回到更新后的成果。
- 复用主会话历史消息结构、Tool Presentation 和 SSE UI，保持 Record 媒体与 Project 副本资源的 `mediaId` 访问一致。
- 支持空状态、异常/取消、忙会话提示、断线重连和历史分页；历史处理不泄露内部工具参数。
- 删除 H5 `getProjectCreation/Creation`、iOS `fetchCreation/ProjectCreation`、各类图片数量/阶段进度 UI。

## 9. 数据迁移与清理

1. **新增独立数据库 migration**：`projects.goal JSONB`；将已接受 Proposal `content.creation` 迁成 `content.goal`，已有 Project 的 Goal 从已接受 Proposal 回填（可按最后 accepted/resolvedAt 更新），`proposals.session_id` 保留提议分析 Session。
2. 删除 `creation_runs` 前，在还能读取旧数据时，按同 Project 最近有效 `creation_runs.agent_session_id` 回填空的 `projects.session_id`；无有效 Session 的 Project 后续创建并绑定新的 creator Session，不捏造历史消息。
3. 对现存 Project 最终 `content` / `coverMediaId` 执行一次“非 Project 前缀媒体 → 副本 + mediaId 改写”，完成后 Record 才能使用新清理语义。
4. 先将 Runtime / Service / Client 全部从旧表迁出，再由新 migration 删除三个表、关联索引及不再使用的查询。按仓库规则**保留已经执行过的 migration 文件名**，不通过删除旧 migration 假装数据库自动变化；验证空库与已部署库两条路径。
5. 清理 `creative-runtime/repository.ts` 旧 claim/renew/bind/finish 等逻辑、`CreativeAuthority`、`CreationExecutionPlan`、旧图片生成保存恢复接口和旧文档。
6. 已完成项目中历史图像引用不能因为旧表删除失效；保留 media_assets 的已有生成图片记录，不批量删除已发布作品媒体。

## 10. 改造文件范围

- Server Domain：`domain/projects/{project,proposal-service,project-service,repository,validation,content}.ts`。
- Media / OSS：`domain/media/{media-service,postgres-repository,mime}.ts`、`infrastructure/clients/oss-client.ts`、uploads route。
- Agent：`agent.yaml`、`agent/prompts/{creator-agent,proposal-agent}.ts`、`agent/tools/creative.ts`、`agent/context/{run-context,providers/creative}.ts`、`agent/harness/{run,session-manager,events}.ts`、`agent/business-services.ts`。
- Runtime：`creative-runtime/{runner,repository,service,model}.ts` 及 bootstrap 注册逻辑：移除旧职责，保留最小分析/触发与 Session 调度。
- HTTP：`routes/{projects,creative,agent/*,uploads}.ts`（Project 专属 history/events/stream）。
- 客户端：`apps/h5/src/{api/projects,components/projects,pages/ProjectsPage}` 及 iOS Projects/Networking/Conversation 相关代码。
- 测试与文档：对应 Domain/Creative/Media/Agent tests、`docs/architecture/creative-runtime.md`、`docs/domain/{projects,media}.md`、`docs/api/http-api.md`、`docs/clients/ios.md`、`docs/product/current-scope.md`、受影响的 `AGENTS.md`。

## 11. 必须验证的验收链路

1. Accept create：Project 创建且 Goal 正确、sessionId 非空，首条 Agent 消息执行前绑定完成；重复 Accept 不产生新 Project / Session。
2. Accept extend：Project Goal 更新、旧 Content 保留、追加参考 Record、Session 不变；继续对话能读取最新 Project。
3. `creation_context` 只有 projectId；creator-agent 的 `project_read` 获取最新内容；`project_manage` 任意内容和 Goal 更新、版本冲突、归档限制都正确。
4. `image_generate` 多个参考 mediaId 输入、一个生成 mediaId 输出；无 imageIndex/Run/Progress；文件存正确 Project 前缀。
5. 引用外部 Record 图片的最终 `project_manage`：生成新 mediaId + OSS 副本并重写 Markdown/HTML/封面引用；Project 目录已有媒体原样保留；不在最终结果中的参考图不复制。
6. 删除源 Record 后：源 media_assets/OSS 可正常删除，Project 内容和封面仍可用副本；与删除并发执行 `project_manage` 不出现悬空 mediaId。
7. 图片直传超 10MB：H5/iOS 提前拦截、Server 拒绝，实际 OSS 元数据超出时 complete 拒绝；音频不受图片阈值影响。
8. Session History / Tool Call 映射在 H5 / iOS 一致；后台创作时可观察，刷新恢复历史，成果发布即刷新，已完成 Project 能在同 Session 继续对话。
9. 已部署数据库回填 / 删表正确，空库迁移正确；无针对旧三张 Run 表的业务查询、接口、状态字段残留。
10. `pnpm --filter @fanto/server typecheck && pnpm --filter @fanto/server test`，H5 构建、iOS 构建及必要的 OSS / Agent 实际链路测试通过。

## 12. 实施顺序

1. Goal + Project schema/接口/Proposal 接受流程，建立 Project ↔ Session 绑定与 RunContext.projectId。
2. Project 级 Session History / Stream / Tool Presentation；简化 Creative Runtime 和 Prompt，并改造 `project_read/project_manage`。
3. 将 `image_generate` 改成纯单图输出工具，统一 Project OSS 目录。
4. 完成 `project_manage` 最终成果媒体检查/副本/引用改写，回归 Record 正常删除；图片直传加 10MB 限制。
5. iOS/H5 改为 Session 消息流程与右下角继续对话入口。
6. 迁移并删除旧 Run 三表及全部引用，跑完整回归，最后同步 Current State 文档。

**最终不变量**：Project 的当前 Goal 和 Content 只有 Project 自己保存；执行消息只在 Agent Session；正式保存的 Project 媒体引用都指向该 Project 目录中的独立 mediaId；Record 的删除不能破坏最终作品。

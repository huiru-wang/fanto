# Server Agent Guide

适用于 `apps/server/`。先阅读 [Server](../../docs/architecture/server.md)、[Agent](../../docs/architecture/agent-runtime.md)、[创作执行](../../docs/architecture/creative-runtime.md)、[Domain](../../docs/domain/projects.md) 和 [HTTP API](../../docs/api/http-api.md)。

## 目录职责

- `src/bootstrap/`：服务装配、配置、启动、迁移。
- `src/routes/`：HTTP 参数、用户认证边界与响应；包括统一 `routes/agent/`。
- `src/domain/`：Records、Media、Memory、Fanto、Users（个人资料）、Projects（含 CreativeService）。
- `src/agent/`：唯一 Pi Harness、SessionManager、Tool、Context、Prompt 与 Skill。
- `src/event/`：非持久化的 Record Postprocess、Embedding、AgentExecution 队列及 SessionEventBus。
- `src/execution/`：AgentWorker、共享 AgentExecutionListener、Proposal/Creator Handler。
- `src/listeners/`：Record 后置理解和 Embedding 消费者。
- `src/infrastructure/`：PostgreSQL、OSS、外部 AI Client、日志和缓存。
- `src/migrations/`：已发布基线和有序前向迁移。

## 边界与不变量

- HTTP Route 不直接访问 Repository；领域操作走 Service。Agent Tool / Context Provider 只能通过 `agent/business-services.ts` 调用获准领域服务，不调用内部 HTTP。
- 所有数据读取、写入和查询必须 user-scoped，身份只能来自已校验 JWT / Session。Creator 的可信 projectId 必须由服务端按 userId + sessionId 查找绑定 Project，再做 Project 状态与归属校验。公共 Stream 仅允许合规 Creator Session，不开放未授权的 Proposal 执行。
- 停止使用通用 Session stop：先标记停止，已开始工具自然完成，不把用户停止信号传入工具内部；禁止后续模型请求与新工具。200 表示已收尾，202/stopping 表示仍在结束当前操作，终态才可续发。SDK Session 与 frame drain 在内存运行；稳定历史异步尽力保存，正常结束/停止不等数据库。断线仅分离 SSE，History 优先恢复内存。Record/Project 正式写入继续保持事务。唯一对话契约、快照/冷恢复/容量边界见 [Agent Runtime](../../docs/architecture/agent-runtime.md)。
- Project 状态只有 queued/running/completed/failed/archived；queued 与 Session 创建无关。Proposal content 为 reason + ideas + selectedIdeaId，每个 Idea 有 title/idea/tags/goal；不要使用旧单 Idea/Plan Schema。Record 与 Project 关联要维持事务与锁顺序。
- Proposal 是否产生以工具保存的业务事实为准，不解析自然语言输出；当前单个 Record 可以支撑新提议。Proposal 在保存前必须说清成果、素材变化和新增价值；关键创作方向由 Proposal 提出，工具与制作步骤留给 Creator。Record postprocess 成功后分别投递 EmbeddingQueue 和 Proposal；失败的 Embedding 不回滚 processed。共享 AgentExecutionQueue 用内存 pending 和并发限制执行 Proposal/Creator；没有 MQ 持久化、自动重试、重启恢复。Fanto 不提供即时/定时/周期 Task、提醒或通用任务委派。
- `image_generate` 使用本人 ready 图片的 thumbnail 签名地址作为参考输入；`image_review` 保留原图输入。多张参考图输入、单图输出，生成物直接属于 Project OSS 路径。只有媒体进入正式 Project content/cover 后，才复制其它来源的 ready 媒体，换用新的 mediaId；Record 删除事务内清理独占媒体元数据，提交后尽力清理 OSS，失败不自动重试。
- `create_current_schema_20261011.ts` 是当前完整空库基线，包含异步状态、Agent Session PostgreSQL 与 wx_openid 删除。旧库在完整执行归并前迁移后合并元数据，随后通过 `drop_tasks_20261011.ts` 正式前向迁移删除原 Task/TaskRun 表及其数据；不手动清空 Kysely 表，保持其它业务数据和用户隔离。
- 用户个人资料由 UserProfileService 管理 `user_profiles`，与角色设置分开。Profile PATCH 校验版本，头像只能为本人 ready 的 user_avatar，背景图只能为本人 ready 的 user_cover；nickname / signature 不自动注入角色 Prompt。见 [Users](../../docs/domain/users.md)。
- FantoService 统一管理 `user_fanto_settings`：基本资料独立列，角色内容保存在 `role_config` JSONB，PATCH 按 version 校验并合并提交字段；旧 Character API 仅为兼容适配。CharacterProvider 每个 Run 通过 business-services 读取一次，读取失败中止该 Run，保存后下一轮生效。头像必须属于本人且 purpose=fanto_avatar，不能用于 Record/Project；生命周期见 [Fanto](../../docs/domain/fanto.md)。
- Memory 使用个人背景、重要关系、近期关注、相处偏好四类；个人背景/相处偏好默认注入，其他按话题由 Main 检索。读写语义由 fantoCore 指导，沿用 memory_manage；不增加逐消息后台整理、记忆版本或语义校验层。存储与历史类型边界见 [Memory](../../docs/domain/memory.md)。
- Current docs 描述已实现语义；`plan/` 只作为方案历史，不作为现状依据。密钥、URL Token 和内部 Tool 参数不得写入面向用户的回复、日志或文档。

Proposal / Creator 创建或复用 Session 后立即记录业务 ID 绑定；Agent Run 日志携带 sessionId/runId，记录阶段与工具耗时，不记录原始参数、模型内容或流式 delta。外部调用日志统一记录安全元数据与调用结果/耗时，不记录媒体内容或 SDK 原始响应；图片理解、生成与下载统一在 `infrastructure/clients/image-client.ts`。字段与范围见 [Server：外部调用日志](../../docs/architecture/server.md#外部调用日志)。链路排障日志见 [创作执行：日志排查](../../docs/architecture/creative-runtime.md#日志排查)。

## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及 PostgreSQL 需隔离 `TEST_DATABASE_URL`；涉及 OSS/模型时区分 Mock 测试和真实收费 smoke。更多测试矩阵见 [测试](../../docs/engineering/testing.md)。

- 媒体业务依赖 `ObjectStorage`，启动按 `OBJECT_STORAGE_PROVIDER` 装配阿里云 OSS / Cloudflare R2，存储 Client 只操作指定 key，不接收图片 variant。Record 图片在服务端生成并存储 WebP 小图后才标记 ready；Fanto / 用户头像与背景图只保存客户端裁切的单张图片，不生成第二份。上传与重试语义见 [Media](../../docs/domain/media.md)。

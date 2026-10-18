# 测试与验证

改动必须匹配验证范围；纯 typecheck 不能证明数据库事务、OSS 或付费模型链路已成功。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
pnpm --filter @fanto/h5 typecheck
pnpm --filter @fanto/h5 build
xcodebuild -project apps/ios/fanto/fanto.xcodeproj -scheme fanto -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

有些 PostgreSQL 集成测试需要 `TEST_DATABASE_URL` 和测试账号 `CREATEDB` 权限；未配置时测试会跳过，不能报告为全部通过。严禁将生产库配置给测试。

## 按领域验证

- **数据库**：空库基线 `create_current_schema_20261011.ts`、已有数据库完整迁移历史合并与不完整历史拒绝、`drop_tasks_20261011.ts` 删除废弃 Task 表，`z_agent_session_snapshots_20261017.ts` 增加异步快照表，保留其它业务数据；不要手动删除 `kysely_migration`。
- **Record / Media**：按用户、版本、位置字段、五媒体限制、后置 Vision/ASR、独立 EmbeddingQueue、语义检索；真实 OSS PUT/HEAD/URL、删除后的尽力清理以及 Project 最终副本归属；`image-thumbnail.test.ts` 验证 EXIF/WebP/并发上限，`media-service.test.ts` 验证小图失败与 DB 失败后的手动恢复、variant 和用户隔离。H5 `tests/media-upload.test.ts` 验证每个失败阶段不会自动继续请求。
- **Proposal / Project**：Proposal 1–2 个 Idea、accept 幂等、create/extend 状态、Record 关联、version 乐观并发、媒体复制、旧内容保留和失败状态收敛；测试文件位于 `domain/projects/`、`routes/project-http.test.ts`。
- **PG Session SDK conformance**：设置只指向独立测试库的 `TEST_DATABASE_URL`（库名需包含 test），运行 `pnpm --filter @fanto/server exec tsx --test src/agent/session/pg-session.test.ts`，验证 Pi Core Storage / SessionRepo 一致性、Fork、失败回滚与 PG 无外键。测试会清空并删除测试数据库中的 `agent_session` schema，不可使用生产数据库。
- **取消集成回归**：`routes/agent/cancellation.integration.test.ts` 使用真实 Pi Harness、faux Provider 和 HTTP socket，覆盖各阶段输出阻塞、取消持久化、超时、重复 stop、输出 deadline 与续聊。可单独设置 `TEST_DATABASE_URL` 在独立 PG 库验证；它会创建/删除 `agent_session` schema，与 PG conformance 测试分开执行，避免并发操作同一 schema。付费模型与浏览器验证仍需单独执行。
- **Memory**：`agent/context/providers/memory.test.ts` 验证默认两类注入、预算、失败和下一轮刷新；`agent/tools/memory.test.ts` 验证按话题搜索、同条更新和失败语义；`domain/memory/memory.integration.test.ts` 在隔离 PostgreSQL 验证新类型约束、旧内容不转换、CRUD/向量检索、容量和用户隔离。设置 `TEST_DATABASE_URL`（库名含 test，需 CREATEDB）。`MEMORY_SMOKE_TEST=1 pnpm --filter @fanto/server exec tsx --test src/agent/tools/memory.smoke.test.ts` 为付费真实模型验证，使用生产 Main Prompt/Tool/Harness 与隔离的内存工具数据，不能当成生产数据库 E2E。
- **Agent Session**：History user ownership、Creator 按 projectId+sessionId 绑定 Project 的领域授权、Stream/Events、同一 Session 并发防护、Tool Presentation 隐私投影、取消与超时。可检查 `routes/agent/sessions.test.ts`、`routes/agent/stream.test.ts` 与 `agent/presentation.test.ts`。
- **异步执行**：`execution/agent-execution.listener.test.ts`、`execution/handlers/proposal-creator.contract.test.ts`；验证 Proposal/Creator 共享并发、创作状态转换、停止/进程中断边界。异步 Queue 不持久化，不能声称自动恢复。
- **客户端**：H5 typecheck/build；iOS Xcode 模拟器构建与实际页面交互。测试创建记录/位置、Proposal 接受、Project 继续对话（含订阅失败仍可发）、Tool 活动/媒体渲染、异步状态刷新和归档。

需要真实 DeepSeek/Qwen/OSS 时使用受控的最小 smoke test，明确费用和环境，不能把 Mock 的成功当成真实生成。当前没有默认启用的付费 Creator E2E CI 测试。

## R2 存储验证

默认仓库测试覆盖 R2 配置 / 启动工厂、真实 SDK 预签名和 Content-Type 绑定、metadata 归一化、流式下载大小上限与超时、错误分类和日志脱敏。本地 S3 HTTP fixture 使用真实 AWS SDK 的请求序列化 / 响应解析验证现有 MediaService 的直传、缩略图失败恢复、不同 variant、用户隔离、作品副本和删除；该测试不等同于真实 Cloudflare 验收。

`r2-storage.smoke.test.ts` 默认跳过。配置服务端 `.env` 中该站点的四个 `R2_*` 项后，单独执行：

```bash
R2_SMOKE_TEST=1 pnpm --filter @fanto/server exec tsx --test src/infrastructure/clients/storage/r2-storage.smoke.test.ts
```

该测试通过生产启动工厂创建 R2 Client，使用随机 `smoke/r2/<UUID>/` 前缀，验证真实签名 PUT、HEAD、受限 GET、签名读取、小图 metadata 和删除。仅读写这一随机前缀，finally 删除并 HEAD 确认清理；需要该 Bucket 的对象读写权限。它不修改数据库、默认 provider、正式媒体或 Bucket 配置。浏览器 Origin 的 CORS 及手机网络需在对应站点另行验收。

## 会话内存与异步快照

`agent/session/live-session.test.ts` 使用真实 SDK 和 HTTP 路由验证阻塞/失败的快照写入不延迟 done、下一轮或在线历史，停止部分回复刷新/冷恢复、工具自然完成、参数生成时停止和断线继续。`session-snapshots.integration.test.ts` 使用隔离 TEST_DATABASE_URL 自动创建/删除独立数据库，验证 PG 单语句保存、revision/owner 防旧覆盖与旧 Session 冷恢复；需要 CREATEDB。默认未设置测试库时该测试跳过。旧 PgStorage conformance 仅验证兼容适配，不代表当前在线路径仍使用逐帧数据库事务。

## Fanto 设置

`domain/fanto/fanto.test.ts` 覆盖输入约束、路由认证与隔离、版本竞争、JSON 合并、旧接口适配及头像绑定/清理。`migration.integration.test.ts` 在隔离子数据库验证旧角色文本（含换行与 Unicode）无损迁移；需测试账号具备创建数据库权限。`domain/media/avatar.test.ts` 使用内存对象存储验证裁切尺寸、用途边界、单对象读取与不生成小图。H5 的 `tests/fanto-settings.test.ts` 覆盖裁切投影和头像保存后的文字草稿合并。数据库测试需独立 TEST_DATABASE_URL；本地存储 fixture 与自动检查不代替真机相册、OSS CORS 和最终交互验收。

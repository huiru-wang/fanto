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

- **数据库**：`create_current_schema_20261019.ts` 是唯一完整基线；隔离 PG 中测试空库建表、旧库历史归并、Agent 三表全部缺失后的事务重建与会话指针修复、有效 Checkpoint 数据保留、历史不完整和部分缺表拒绝。旧迁移文件已合并，legacy cleanup 仅为旧库升级兼容逻辑；不要手动删除 `kysely_migration`。
- **Record / Media**：按用户、版本、位置字段、五媒体限制、后置 Vision/ASR、独立 EmbeddingQueue、语义检索；真实 OSS PUT/HEAD/URL、删除后的尽力清理以及 Project 最终副本归属；`image-thumbnail.test.ts` 验证 EXIF/WebP/并发上限，`media-service.test.ts` 验证小图失败与 DB 失败后的手动恢复、variant 和用户隔离。H5 `tests/media-upload.test.ts` 验证每个失败阶段不会自动继续请求。
- **Proposal / Project**：Proposal 1–2 个 Idea、accept 幂等、create/extend 状态、Record 关联、version 乐观并发、媒体复制、旧内容保留和失败状态收敛；测试文件位于 `domain/projects/`、`routes/project-http.test.ts`。
- **Agent Checkpoint PG Integration**：用仅供测试的 `TEST_DATABASE_URL`（库名含 test），执行 `pnpm --filter @fanto/server exec tsx --test src/agent/checkpoint/*.integration.test.ts`，验证保留三表、清理废弃字段、Entry/Usage 存储、Run 历史分页、冷恢复和主会话权限。测试创建并删除独立的临时数据库，不可使用生产数据库。
- **取消集成回归**：`routes/agent/cancellation.integration.test.ts` 使用真实 Pi Harness、faux Provider 和 HTTP socket，覆盖各阶段输出阻塞、取消持久化、超时、重复 stop、输出 deadline 与续聊。需要数据库时可单独设置 `TEST_DATABASE_URL` 在独立 PG 库验证；运行时以独立临时库执行，避免与其它集成测试共享生产 Schema。付费模型与浏览器验证仍需单独执行。
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

`agent/session/live-session.test.ts` 使用真实 Pi SDK 和 HTTP 路由验证 Turn/Run Checkpoint、Run 分页、PG 写入失败、Stop 和重启恢复。`agent/checkpoint/postgres.integration.test.ts` 使用独立 TEST_DATABASE_URL 自动创建/删除临时数据库，验证 Agent 三表清理后的 Schema、Entry/Usage、模型字段、主链恢复；`settings.integration.test.ts` 验证归属和版本冲突。需要 CREATEDB，未配置测试库则集成测试跳过。当前在线链路不会调用旧 PgStorage / Snapshot。

## Fanto 设置

`domain/fanto/fanto.test.ts` 覆盖输入约束、路由认证与隔离、版本竞争、JSON 合并、旧接口适配及头像绑定/清理。`migration.integration.test.ts` 在隔离子数据库验证旧角色文本（含换行与 Unicode）无损迁移；需测试账号具备创建数据库权限。`domain/media/avatar.test.ts` 使用内存对象存储验证裁切尺寸、用途边界、单对象读取与不生成小图。H5 的 `tests/fanto-settings.test.ts` 覆盖裁切投影和头像保存后的文字草稿合并。数据库测试需独立 TEST_DATABASE_URL；本地存储 fixture 与自动检查不代替真机相册、OSS CORS 和最终交互验收。

## 用户中心

`domain/users/profile.test.ts` 验证昵称 / 签名单行约束、路由身份边界、并发版本与用户 / Fanto 头像用途隔离、背景图4:3尺寸约束、资料级联删除和清理引用保护。数据库部分创建隔离子数据库，需 TEST_DATABASE_URL 与创建数据库权限。`domain/media/avatar.test.ts` 对两类头像执行相同的单对象与实际尺寸校验。iOS 原生菜单、Dynamic Type、照片裁切与账号退出的最终交互由真机验收；构建与静态检查不能代替交互验收。

## iOS 资料缓存

`sh apps/ios/tests/run-cache-tests.sh` 在本机编译并执行生产缓存组件，覆盖跨页面复用、并发读取合并、保存与旧查询竞争、断网保留、启动快照先显示后同步、账号作用域隔离、退出清理与图片磁盘预算。iOS 模拟器构建校验图片解码和 SwiftUI 接入；真机验证头像 / 背景图不闪、相册上传、弱网及切换账号的实际体验。没有定时刷新或资料 TTL。

`routes/settings-fields.test.ts` 验证用户资料逐字段 PATCH、四项角色配置各自提交单个 JSON 子键，以及经过认证的 user_cover 上传路由和大小限制。iOS 缓存回归同时验证单字段序列化（遗漏不等于 null）、独立保存写回、同字段冲突保护及丢失保存响应后的读取确认。背景图 Unsupported media 代表上传申请参数被拒绝，仅凭此错误不能判定线上版本；需核对上传参数与线上支持的 purpose。仓库已支持 user_cover，头像用例同时通过认证后的真实上传 / complete 路由验证 4:3 JPEG 与实际尺寸（对象存储使用 fixture，不代表线上 OSS 验收）。部署仍需包含 coverMediaId 对应迁移，不能通过改用 Record 用途绕过。

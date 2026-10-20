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

- **数据库**：migration-baseline.test.ts 在隔离子库验证空库建表、重复执行与基线重放、全业务无 FK，以及仅登记单一基线迁移。仅测试隔离库，不代表旧实际数据库已升级。
- **Record / Media**：按用户、版本、位置字段、五媒体限制、后置 Vision/ASR、独立 EmbeddingQueue、语义检索；真实 OSS PUT/HEAD/URL、删除后的尽力清理以及 用户隔离；`image-thumbnail.test.ts` 验证 EXIF/WebP/并发上限，`media-service.test.ts` 验证小图失败与 DB 失败后的手动恢复、variant 和用户隔离。H5 `tests/media-upload.test.ts` 验证每个失败阶段不会自动继续请求。
- **Agent Checkpoint PG Integration**：用仅供测试的 `TEST_DATABASE_URL`（库名含 test），执行 `pnpm --filter @fanto/server exec tsx --test src/agent/checkpoint/*.integration.test.ts`，验证仅创建当前三表、Entry/Usage 存储、Run 历史分页、冷恢复和主会话权限。测试创建并删除独立的临时数据库，不可使用生产数据库。
- **取消集成回归**：`routes/agent/cancellation.integration.test.ts` 使用真实 Pi Harness、faux Provider 和 HTTP socket，覆盖各阶段输出阻塞、取消持久化、超时、重复 stop、输出 deadline 与续聊。需要数据库时可单独设置 `TEST_DATABASE_URL` 在独立 PG 库验证；运行时以独立临时库执行，避免与其它集成测试共享生产 Schema。付费模型与浏览器验证仍需单独执行。
- **Memory**：见下方“服务端多角色回归”；使用隔离 TEST_DATABASE_URL（库名含 test，需 CREATEDB），付费模型 smoke 独立开启。
- **Agent Session**：History user ownership、Stream、同一 Session 并发防护、Tool Presentation 隐私投影、取消与超时。可检查 `routes/agent/sessions.test.ts`、`routes/agent/stream.test.ts` 与 `agent/presentation.test.ts`。
- **客户端**：H5 typecheck/build；iOS Xcode 模拟器构建与实际页面交互。测试创建记录/位置、Tool 活动/媒体渲染、异步状态刷新和归档。


## 能力移除回归

capability-scope.test.ts 验证已认证请求无法访问退役业务路由；Agent Definition / Session / Stream 测试验证 Main 注册、旧能力拒绝与 metadata 严格校验。record-postprocess.listener.test.ts 验证 processed 后只投递 Embedding、旧版本不投递、失败释放认领。空库基线只创建保留表，不新增旧表 / 历史文件清理迁移；旧库手动维护。

## R2 存储验证

默认仓库测试覆盖 R2 配置 / 启动工厂、真实 SDK 预签名和 Content-Type 绑定、metadata 归一化、流式下载大小上限与超时、错误分类和日志脱敏。本地 S3 HTTP fixture 使用真实 AWS SDK 的请求序列化 / 响应解析验证现有 MediaService 的直传、缩略图失败恢复、不同 variant、用户隔离、作品副本和删除；该测试不等同于真实 Cloudflare 验收。

`r2-storage.smoke.test.ts` 默认跳过。配置服务端 `.env` 中该站点的四个 `R2_*` 项后，单独执行：

```bash
R2_SMOKE_TEST=1 pnpm --filter @fanto/server exec tsx --test src/infrastructure/clients/storage/r2-storage.smoke.test.ts
```

该测试通过生产启动工厂创建 R2 Client，使用随机 `smoke/r2/<UUID>/` 前缀，验证真实签名 PUT、HEAD、受限 GET、签名读取、小图 metadata 和删除。仅读写这一随机前缀，finally 删除并 HEAD 确认清理；需要该 Bucket 的对象读写权限。它不修改数据库、默认 provider、正式媒体或 Bucket 配置。浏览器 Origin 的 CORS 及手机网络需在对应站点另行验收。

## 会话内存与异步快照

`agent/session/live-session.test.ts` 使用真实 Pi SDK 和 HTTP 路由验证 Turn/Run Checkpoint、Run 分页、PG 写入失败、Stop 和重启恢复。`agent/checkpoint/postgres.integration.test.ts` 使用独立 TEST_DATABASE_URL 自动创建/删除临时数据库，验证 Agent 三表当前 Schema、Entry/Usage、模型字段、主链恢复；`settings.integration.test.ts` 验证归属和版本冲突。需要 CREATEDB，未配置测试库则集成测试跳过。当前在线链路不会调用旧 PgStorage / Snapshot。

## Fanto 设置

多角色服务端验证见下方“服务端多角色回归”。客户端既有测试仍验证各自版本行为，不能视为新版多角色 API 已适配。

## 登录身份联系方式

`domain/auth/auth-service.integration.test.ts` 在隔离 PostgreSQL 子库覆盖注册 / 统一认证 / 登录 / 绑定 / 重新绑定的 contact_value 写入、缺失联系方式保留旧值、邮箱相同不合并账号、跨账号绑定拒绝、手机号国际格式与账号响应不暴露原文。Google / Apple Provider 测试使用本地签名 Token 验证完整邮箱读取、缺失邮箱及 nonce / audience 校验，不访问外部认证或短信服务。

## 用户中心

`domain/users/profile.test.ts` 验证昵称 / 签名单行约束、路由身份边界、并发版本与用户 / Fanto 头像用途隔离、背景图4:3尺寸约束、无 FK 下显式资料清理和清理引用保护。数据库部分创建隔离子数据库，需 TEST_DATABASE_URL 与创建数据库权限。`domain/media/avatar.test.ts` 对两类头像执行相同的单对象与实际尺寸校验。iOS 原生菜单、Dynamic Type、照片裁切与账号退出的最终交互由真机验收；构建与静态检查不能代替交互验收。

`domain/users/statistics.test.ts` 覆盖注册当天 / 跨时区 / 夏令时的相伴日计算、统计路由认证与时区校验；在隔离 PostgreSQL 子库验证当前用户总记录数、未处理记录计数、删除后更新及跨账号隔离。亲密度只验证固定占位字段。

## iOS 地点映射

`sh apps/ios/tests/run-location-tests.sh` 使用本机 MapKit 验证新版地址读取、搜索 POI 名称、旧版行政字段、原始选点坐标保留、行政区去重与地址未识别提示，不调用在线定位服务。真实定位 / 逆地理编码、地图点击与“当前位置”按钮的手势隔离仍需真机验收。

## iOS 资料缓存

`sh apps/ios/tests/run-cache-tests.sh` 在本机编译并执行生产缓存组件，覆盖跨页面复用、并发读取合并、保存与旧查询竞争、断网保留、启动快照先显示后同步、账号作用域隔离、退出清理与图片磁盘预算；同时覆盖创建草稿文字 / 日期 / 地点 / JPEG 字节与已完成上传 ID 恢复、重新登录恢复、账号隔离及提交清除后不被旧写入复活。iOS 模拟器构建校验图片解码和 SwiftUI 接入；真机验证头像 / 背景图不闪、相册上传、弱网及切换账号的实际体验。没有定时刷新或资料 TTL。

`routes/settings-fields.test.ts` 验证用户资料逐字段 PATCH、Fanto 配置子键更新及拒绝身份/Session 重绑定，以及经过认证的 user_cover 上传路由和大小限制。iOS 缓存回归同时验证单字段序列化（遗漏不等于 null）、独立保存写回、同字段冲突保护及丢失保存响应后的读取确认。会话重绑定回归验证 sessionId 单字段编码、共享设置与磁盘写回、旧 GET 不恢复旧指针，并在隔离 PG 验证身份不变、旧会话保留、归属校验与版本冲突。背景图 Unsupported media 代表上传申请参数被拒绝，仅凭此错误不能判定线上版本；需核对上传参数与线上支持的 purpose。仓库已支持 user_cover，头像用例同时通过认证后的真实上传 / complete 路由验证 4:3 JPEG 与实际尺寸（对象存储使用 fixture，不代表线上 OSS 验收）。部署仍需包含 coverMediaId 对应迁移，不能通过改用 Record 用途绕过。

## 服务端多角色回归

`domain/fanto/fanto.test.ts` 验证空身份、固定身份、并发 3 active 上限、归档/恢复和默认 Session；`lifecycle.integration.test.ts` 使用隔离子库及存储替身验证运行门禁、版本、User/Fanto Owner 保留、删除前 Checkpoint 排空、迟到写入拒绝和 202→204 对象清理重试。`migration.integration.test.ts` 验证 Owner/scope_key/无 FK及单一基线记录，均不重置实际库。

`main-dynamic.test.ts` 验证空段省略、Scope 授权和上下文预算；`business-services.test.ts` 验证工具实际访问守卫；`memory.test.ts` 验证只读 Schema 和伪造动作拒绝；`live-session.test.ts` 使用真实 Pi Harness/faux 模型验证同一 Harness 在下一 Run 切换工具。Memory PG 回归验证两类 Owner、四类各自合法性、隔离、检索和并发容量上限。外部模型/OSS/R2 的真实收费 smoke 仍需独立配置，不与隔离库自动测试混称为线上验收。

## H5 多角色

H5 的 typecheck/test/build 验证客户端代码与配置；fanto-settings.test.ts 覆盖角色级版本、配置子键、独立远端变更合并、归档/删除回退 Main。浏览器联调使用真实测试账号及服务端/数据库验证创建、配置持久化、切换、固定 Session、3 active、归档恢复与物理删除；流式显示可使用模拟 SSE，不能将其报告为付费模型真实调用。详情见 H5 文档。

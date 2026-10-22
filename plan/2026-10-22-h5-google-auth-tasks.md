> 2026-10-22 执行决定：**Server 不保留任何旧 JWT/Refresh 兼容**，直接启用单 Token Session。旧版 iOS 必须升级并重新登录；原方案中的灰度 JWT 兼容窗口、旧协议保留与延期收口均不执行。生产部署需与新版客户端同步安排。

# Fanto 全平台单 Token Session 与 H5 Google 登录执行任务

状态：**代码改造与可运行自动测试完成，生产发布/真实 OAuth/独立 PG 集成仍待验收**，Server 直接切换，无旧版 JWT 兼容。前置方案：`2026-10-22-h5-google-auth-design.md`。目标终态：**一张 `auth_sessions` 表 + 一个不透明随机 Session Token / 每次设备登录 + 共用 24h 进程内 TtlCache/验证/撤销服务**；H5 通过 HttpOnly Cookie，iOS 通过 Keychain + Bearer，未来 Android 通过 Keystore 支持的安全存储 + Bearer。旧 iOS Access/Refresh JWT 将**在 Server 直接关闭，不保留旧版兼容**，不再长期保留。

| 顺序 | 任务 | 主要范围 | 依赖 | 完成标准 |
| --- | --- | --- | --- | --- |
| 1 | Google Web 客户端与环境配置、迁移计划 | H5/Server env.example、Google Cloud、Vite HTTPS、部署/最低 iOS 版本策略 | 无 | Web Google ID 加入 Server audience 且不移除 iOS ID；配置精确 `AUTH_WEB_ORIGIN`、统一 Session 有效期 7 天空闲/30 天绝对上限；生产 HTTPS、协议/隐私页可用；旧 iOS 不兼容，必须升级并重登，线上版本同步发布 |
| 2 | 建一张全平台 Session 表 | `migrations/004_create_auth_sessions.ts`（核对实际编号）、`database/schema.ts` | 1 | `auth_sessions` 保存 UUID Session ID、唯一 Token Hash、userId FK、客户端受控传输类型（`web/native`）、创建/最后活动/空闲到期/绝对到期/撤销时间；同账号多 Session；不存 Token 原文，不增加第二表；迁移兼容空/旧库 |
| 3 | 全平台 Session 服务 + 24h 热点缓存 | `domain/auth/auth-session-service.ts`、已有 `TtlCache`、Server bootstrap | 2 | ≥32 字节 CSPRNG Token；SHA-256 查找；24 小时进程内缓存命中跳过 Session PG 查询但验证 web/native 传输通道、过期和用户状态；缓存未命中 DB 校验/必要时续空闲；数据库异常不 fail-open；单进程登出 PG 提交撤销→`cache.delete`；同一服务同时消费 Cookie/Bearer |
| 4 | 共用身份流程与直接切换 Server | `AuthService`、`AuthError`、认证装配/路由 | 3 | Google/Apple Provider、`sub` 身份、默认 Fanto、challenge 消费与 Session 创建在一致事务内；新 Native 接口提供 JSON 单 Token；Web Cookie 与原生不混用 proof 通道；旧 iOS JWT/refresh 路由和服务立即删除，公共业务鉴权只走单 Session 验证 |
| 5 | H5 Web Cookie 登录/退出接口 | `routes/auth-web.ts`、`bootstrap/app.ts`、H5 auth API | 4 | `POST /api/auth/web/intents`、`POST /api/auth/web/authentications`、`POST /api/auth/web/logout` + `GET /api/users/me` 恢复；Web 结果 JSON 不出现 Session Token；`__Host-fanto-session` 全属性；来源/CSRF/JSON+自定义头/CORS/no-store/敏感日志处理；所有 Cookie 状态变更 API 统一检查 Origin；退出幂等、错误不误报；GIS Redirect 使用独立安全回调 |
| 6 | iOS 原生 Session API 与服务端退出 | `routes/auth-native.ts`、`bootstrap/app.ts`、统一 Session Service | 4 | Native `POST /api/auth/native/authentications` 返回 `user,sessionToken,idleExpiresAt,absoluteExpiresAt`，提供 Bearer `POST /api/auth/native/logout`；`GET /api/users/me` 可用 Native Bearer；服务端吊销当前 Session + 删除缓存；保留现有身份绑定/重新认证语义 |
| 7 | iOS Keychain 与 AuthSession 单 Token 重构 | `Authentication/{AuthModels,AuthSession,AuthCredentialStore,AuthenticationStore}.swift` | 6 | 只保存一个 Session Token + 最少账号元数据；删除双 JWT 日期字段、`refreshTask/refresh()/forceRefresh()`；恢复时 GET me 而非按 JWT 过期时间本地判定；401 清凭证，网络失败可重试；旧版 Keychain 双 JWT 清除并重新登录，绝不当新 Token 使用 |
| 8 | iOS 登录、Bearer 业务请求与退出 | `Networking/AuthAPIClient.swift`、`{AgentAPIClient,FantoAPIClient,MediaUploadAPIClient,RecordWriteAPIClient}.swift`、`UserAccountView.swift` | 7 | Google/Apple 原生 SDK 继续使用已有 intent/nonce；改到 Native Session 认证 API；四种业务请求只使用同一 `Authorization: Bearer <sessionToken>`，不再刷新 JWT；退出先服务端撤销，成功后清 Keychain 与用户缓存；失败可重试/不伪报注销；不影响 Agent/角色行为 |
| 9 | H5 Cookie 认证树、Google GIS、登录启动页 | H5 `AuthProvider/AuthGate`、GIS、`main.tsx`、API、品牌素材/样式、FantoProvider | 5 | 移除构建测试 Refresh/旧本地 Token；启动 `GET /api/users/me`；正式 Google 按钮 + nonce、Safari Popup/Redirect 验收；登录/启动品牌页适配 375/390/1280；固定角色 Session 检查完成再进入对话；登出停止新请求、断开 SSE、清 Cookie/当前用户状态 |
| 10 | 跨端 Session 和旧 JWT 拒绝自动测试 | Server 路由/缓存/AuthService 测试、iOS/ H5 tests、隔离 PG | 3–9 | Cookie 与 Native Bearer 对应同一 Hash Session 规则；账号同一 `userId`、各设备 Token 独立；过期/禁用/撤销/缓存/503 正确；H5 Cookie CSRF/CORS；原生 Keychain 旧结构迁移/401/断网/Google Apple；旧 JWT 全部拒绝且不保留任何兼容；真实退出后普通串行请求 401；无付费模型调用 |
| 11 | 直接切换到全平台统一 Session | Server + H5 + iOS 部署与版本策略 | 10 | Server 一次性禁用 JWT Bearer/签发/Refresh，并同步发布新 H5/iOS；旧 iOS 将失效、必须升级重登；验收账号复用、登录/恢复/退出；不设兼容窗口 |
| 12 | 移除旧 JWT 代码、同步 Current Docs | `JwtTokenService`、旧 auth 路由/DTO、JWT 配置、H5/iOS/Server AGENTS/docs | 11 | 直接移除 JWT 签发/验证/refresh 和对应 iOS/H5 代码；Server iOS H5 typecheck/tests/build 通过；文档更新 Users/API/配置/工程/产品架构，正式部署后才改为 Current State，不自动推进 docs/.checkpoint |

## 跨端执行规则与不做范围

- **每次登录一个 Token**：统一格式是不可解码的 32 字节以上随机串，数据库只保存 SHA-256 Hash；同一个用户在 H5、iOS、未来 Android 分别有独立 Session。**不是所有设备共享同一枚 Token**。统一为一张表和一个认证中间件/Service。
- **Web 与 Native 只差交付**：H5 仅用 `__Host-fanto-session`（`Secure; HttpOnly; SameSite=Lax; Path=/`、无 Domain）并自动携带 Cookie，JSON 不返回原文；iOS Keychain 和未来 Android 安全存储持有原文，并通过 Bearer 携带。服务端按来源限制 Cookie 仅接受 web Session、Bearer 仅接受 native Session，并拒绝未知、过期、被撤销或禁用账号对应 Token。Native 不存 Cookie，H5 不存/读 Bearer Token。
- **登录与退出均走服务端**：Native 退出不能再只清 Keychain；Web/Native 共用 PG 撤销后同步 `cache.delete(tokenHash)`。失败不假称已撤销，前端停止业务请求并可重试；SSE 已执行中的任务不保证回滚。单进程普通串行请求下撤销生效。
- **24 小时内存缓存本期保持不变**：复用已有 `TtlCache`，当前 PM2 `instances: 1`；缓存有效期限小于或等于 24 小时且不能超出 Session 自身有效期；空闲 7 天/绝对 30 天共用；未来扩为多实例之前必须改为有可靠失效机制的分布式缓存（如 Redis）或每请求查库。
- **明确暂不处理复杂并发**：没有 Token 轮换、Web Locks、Refresh 409、pending load 回填保护、多进程缓存同步，不承诺并发登出强一致性；测试必须覆盖正常串行失效及失效规则，不能虚报全局即时一致。
- **旧 iOS JWT 立即失效**：Server 不保留任何旧 JWT 和 Refresh API。旧版 iOS 必须升级并重新登录；应用市场发布和服务端上线必须同步协调，不提供双轨兼容。
- **Android 仅约定契约**：未来安全存储 + Bearer 直接调用相同 Native Session API，不增加第二表或 Android 专用 Token 体系；本次不创建 Android 工程。
- **其他安全边界**：所有 Web Cookie 状态变更请求验证精确 Origin/CSRF、不能给任意跨域开放 credentials；Google/Apple 验证 nonce/签名/audience/过期，日志不存凭证；离线与 401 分开处理；清 Session 不删除角色或 Agent 历史。
- **当前工作区保护**：仅方案文件变动；实施前再次检查其它未提交文件、迁移编号和实际 App Store 最低版本策略。PG 测试只用 `TEST_DATABASE_URL`，真实 Google/Apple 登录、生产 HTTPS 和 iOS Keychain 均需真机/真环境验证。

完整数据结构、接口和目标改动目录以同目录设计方案第 5–9 节为准。

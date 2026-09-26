# iOS Google OAuth 实施任务

依赖顺序按现有服务端契约、客户端基础层、体验页面、主页迁移和验证排列。本期不做“我的”、设置、退出、设备会话或新增服务端接口。

1. **锁定契约与配置**：补齐 `docs/api/http-api.md` 的认证接口、错误码、JWT audience/TTL、Google 配置与脱敏约束；确认 Debug / Release Google OAuth client 配置和 staging 回调 scheme。  
   验证：Server route test 和 iOS 配置检查能区分 placeholder 与有效值。

2. **建立 iOS Auth Models 与 Keychain 迁移**：拆分 UI 状态、API DTO、认证结果、凭证和错误；对现有 Keychain 记录进行安全兼容读取或一次性清理策略。  
   验证：旧记录、空记录、错误记录、写入失败都不会使 App 卡在恢复页。

3. **实现 `AuthSession` actor**：实现安装、恢复、并发 refresh 去重、原子凭证替换和失效传播；所有任务遵守 cancellation。  
   验证：单元测试证明十个并发请求只触发一次 refresh，失败不会残留 token。

4. **接入 Google provider**：保留 Server intent nonce → Google Sign-In → proof 的顺序，完善 SDK cancellation/error 映射、`onOpenURL` 和配置错误检查。  
   验证：真机 staging 走通注册、登录、取消及过期 challenge；ID token 不进入日志和持久化。

5. **重做认证页面**：实现欢迎、注册、登录、反馈组件和 loading/disabled 状态；替换 segmented 模式切换，接入条款和隐私链接。  
   验证：最大字体、VoiceOver、Reduce Motion / Transparency、快速点击和失败恢复通过。

6. **接入认证根与主页**：认证完成后才创建 `AppRootView`；主页保留“记录 / Fanto / 脉络”三个 Tab，删除“我的”Tab 与 `AccountView`；认证失效时清理业务 Store 后回欢迎页。  
   验证：首次登录进入记录页，冷启动恢复进入主页，失效后不出现旧账号内容。

7. **认证测试矩阵与可观测性**：添加 Swift Testing、URLProtocol、Server tests 与必要的 XCUITest seam；接入隐私安全的 `Logger` 事件和 correlation ID。  
   验证：覆盖方案中所有自动化场景；并发和重试没有测试间共享状态。

8. **集成验收与文档刷新**：执行 iOS 构建 / 测试、Server typecheck / test、真机 OAuth 验收和辅助功能矩阵；按最终实现刷新 `docs/clients/ios.md`、HTTP API、配置、安全/架构文档和 checkpoint。  
   验证：`docs/.checkpoint` 覆盖本次最终 commit，文档不描述未接入能力。

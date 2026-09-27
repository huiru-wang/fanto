# Apple ID 登录执行任务

关联方案：[2026-09-27-apple-sign-in-design.md](2026-09-27-apple-sign-in-design.md)

1. 在 Apple Developer 为 `com.robinverse.fanto` 启用 Sign in with Apple（Primary App ID），在 Xcode target 加入该 capability，并更新签名 profile；确认真机构建包含 entitlement。
2. 扩展 Server 配置模型与 `.env.example`，新增并校验 `APPLE_ALLOWED_CLIENT_IDS`；部署环境设置为 `com.robinverse.fanto`，不写入 Apple 私钥或授权码相关凭据。
3. 实现 `AppleIdentityProvider`：解析 `{ idToken }`、从 Apple JWKS 验签、限制 `RS256`、校验 issuer/audience/expiry/sub/nonce，并映射为既有 `VerifiedIdentity`。
4. 在 Server bootstrap 注册 Apple Provider；补充安全日志原因标签，同时保证日志不含 token、nonce、email 等敏感数据。
5. 为 Apple Provider 增加离线单元测试，覆盖成功、错误 audience、issuer、签名、过期、缺失 claim 与 nonce 不匹配；为 auth route 增加 Apple provider 的 intent/proof 透传测试。
6. iOS 新建基于 `AuthenticationServices` 的 Apple provider，执行原生授权、将 Server nonce 写入请求、从 credential 取 UTF-8 identity token，并规范映射取消/失败。
7. 将 `AuthAPIClient` 的 intent 创建与 proof 提交抽象为 provider 参数；`AuthenticationStore` 复用统一认证编排，并确保 Google 与 Apple 提交期间互斥。
8. 在认证页加入系统 `ASAuthorizationAppleIDButton` 的 SwiftUI 包装，保持与现有 Google 登录相同的 loading、错误和无障碍语义；不改变自动建号规则。
9. 更新 `docs/api/http-api.md`、`docs/clients/ios.md` 和 `docs/engineering/configuration.md`，仅描述最终已接入的 Apple 认证契约、配置和平台约束。
10. 执行 Server typecheck/test、Xcode build；在真机用测试 Apple ID 验证首次授权、取消、重复登录与隐藏邮箱，并在生产机完成 JWKS 连通性及端到端 smoke test。

# 线上 H5 免登录测试认证实施清单

> 关联设计：[2026-09-27-h5-test-auth-design.md](./2026-09-27-h5-test-auth-design.md)  
> 状态：待实施

1. 确认线上测试域名、H5 / Business Server / Agent Runtime 的反向代理路由，并确认 H5 使用相对 `/api/*` 请求路径。
2. 在目标数据库创建或恢复 `h5-online-test` active 用户；确认需要测试的数据及媒体对象都属于该 `user_id`。
3. 在 Server 的受控环境中通过 `JwtTokenService.issuePair("h5-online-test")` 签发一组测试 access / refresh token；记录预置 refresh token 的过期时间。
4. 为线上 Agent Runtime 配置当前 JWT 公钥与 issuer，验证它可接受该 access token 的 `fanto-agent` audience。
5. 改造 H5 配置：用 `VITE_H5_TEST_AUTH` 和 `VITE_H5_TEST_REFRESH_TOKEN` 替换硬编码用户 ID 与固定 Agent Token。
6. 新增 H5 运行时测试会话模块：启动 refresh、sessionStorage 缓存、401 单次刷新并重放请求、会话失效展示。
7. 改造 H5 Business Server 与 Agent HTTP Client：统一从测试会话读取 access token、添加 `Authorization` Header、移除 `X-User-Id`。
8. 在线验证 Records、Media 上传、Preferences、Creations、Agent Chat，以及 access token 过期后的 refresh 行为；确认请求数据均属于测试用户。
9. 记录预置 refresh token 的轮换时间；到期后在 Server 重签并更新 H5 部署环境变量，重新部署。
10. 测试结束时移除 H5 测试环境变量、重新部署，并禁用或删除 `h5-online-test` 用户。

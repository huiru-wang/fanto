# H5 Agent Guide

适用于 apps/h5，先阅读 docs/clients/h5.md、docs/domain/fanto.md 和 docs/api/http-api.md。

- H5 是受控测试客户端，身份来自已验证 JWT；不在源码或提交中放测试 refresh token、私钥或数据库凭据。
- FantoProvider 管理角色列表、选中 FantoId 及默认 Fanto 固定 Session。每个 Fanto 使用服务端固定 sessionId，禁止调用通用创建 Session 或 PATCH 重绑定旧指针。
- 身份字段仅在创建时编辑，nickname 必填且同用户唯一；创建后身份只读。PATCH 只提交变化的 agentConfig 子键或头像。记忆仅属于对应 Fanto，fantoMemoryEnabled 控制独立长期记忆。系统默认 fanto 不可改配置、归档或删除。
- ChatPage 按 sessionId 设置 React key，切换时清理旧 SSE/恢复/分页操作；草稿按 Session 隔离，选择与待清理删除按用户隔离保存在 sessionStorage。旧异步响应不得覆盖新角色或复活已删除角色。
- 归档不占 3 active 名额，恢复复用原 Session。删除需要确认；202 待清理不是全部完成，保留显式重试入口，刷新也能恢复。未知创建结果不得自动重发 POST。
- 头像经既有裁切上传链路使用 fanto_avatar，不将用户头像或 Record 媒体用于角色。
- 修改核心交互时同步 docs/clients/h5.md 及对应产品文档。验证：pnpm --filter @fanto/h5 typecheck、test、build；真实浏览器检查桌面/移动端、角色切换和请求失败。测试不应自动调用付费模型。

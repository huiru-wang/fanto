# 测试与验证

验证应与改动范围一致；仓库级检查不能替代需要真实外部服务的链路验证。

## 仓库级

```bash
pnpm typecheck
pnpm test
```

## Business Server

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

当前测试重点覆盖 Record Repository / HTTP、Memory Core、sqlite-vec MemoryIndex、Creation HTTP、配置、MIME 与部分外部 Client 行为。

涉及以下内容时还需要针对性验证：

- schema 变化：空库 migration；
- Memory：Record document 构建、user-scoped sqlite-vec 检索、Record 接入、Search HTTP，以及必要时 `pnpm memory:rebuild`；
- OSS：signed PUT、complete、媒体读取；
- Vision / ASR / Embedding：真实凭据下的最小 smoke test。

## Agent Runtime

```bash
pnpm --filter @fanto/agent typecheck
pnpm --filter @fanto/agent test
pnpm --filter @fanto/agent build
```

修改 Session、Tool、Task 或安全边界时，至少覆盖对应现有测试，并验证：

- user ownership；
- 同一 Session 并发保护；
- workspace confinement；
- 配置 reload / revision 行为；
- HTTP 错误映射；
- Record Tool 的 Run Context 用户身份、`FantoServerClient` Header / timeout / cancellation / envelope；
- `record_list / record_search / record_get` 的模型 DTO 投影与 Agent 权限配置；
- `present_media` 的 mediaId-only schema、user-scoped metadata 校验、Tool Result 白名单投影，以及其他 Tool 参数 / 结果不进入 SSE 的边界。

Record Tool 变更除单元测试外，还应至少做一次 Business Server + Agent Runtime 真实 smoke；真实模型的 Tool Selection 不作为 CI 的确定性断言。

## iOS

当前仓库没有统一的命令行 iOS 测试脚本。修改 iOS UI / 网络层时，需要至少通过 Xcode build，并针对受影响页面做手工或模拟器验证。

## 不要用假验证替代真实验证

以下行为不算完成：

- 只 typecheck 就宣称 OSS 上传可用；
- 只读取代码就宣称 HTTP 路由已经注册；
- 只存在数据库表就宣称自动 workflow 已接入；
- 用 Preview / mock 数据证明 iOS 已经接入服务端能力。

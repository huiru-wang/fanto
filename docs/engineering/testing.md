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

当前测试重点覆盖 Record Repository / HTTP、Record Retrieval、Record 行上的 pgvector 搜索、Proposal / Project Domain 与 HTTP（事务、版本、幂等、归属、并发删除）、Project summary 向量搜索（几十个候选、归属 / 归档过滤、摘要更新、向量失败原子性与旧摘要补索引）、Markdown 资源校验、配置、MIME 与部分外部 Client 行为。需要数据库的集成测试仅在明确设置隔离的 `TEST_DATABASE_URL` 时运行。

涉及以下内容时还需要针对性验证：

- schema 变化：空库 migration 与既有 PostgreSQL 增量迁移、数据保留与用户隔离；旧 Proposal goal 转换与已付费运行计划 / 状态保留；
- Record Retrieval：Record document 构建、user-scoped pgvector 检索、Record 接入与 Search HTTP；
- OSS：signed PUT、complete、媒体读取；
- Vision / ASR / Embedding：真实凭据下的最小 smoke test。

## Agent Runtime

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

Agent Runtime 的测试已包含在 Server 测试中。修改 Session、Tool、Task 或安全边界时，至少覆盖对应现有测试，并验证：

- user ownership；
- 同一 Session 并发保护；
- workspace confinement；
- 配置 reload / revision 行为；
- HTTP 错误映射；
- Record Tool 的 Run Context 用户身份、Service 调用、timeout / cancellation / SSE 边界；
- `record_read` 的模型 DTO 投影与 Agent 权限配置；
- `present_media` 的 mediaId-only schema、user-scoped metadata 校验、Tool Result 白名单投影，以及其他 Tool 参数 / 结果不进入 SSE 的边界；
- `create_task / update_task / get_task` 的 Goal contract、受信 Run 用户/来源、5 分钟 Scheduler 容量领取、WorkerPool 不排队、RRULE 时区、`userId/sessionId` Workspace 与结果 Media 绑定；以及 `deliver_task_result` 的相对路径校验、多文件结果、失败可重试与 TaskRun 完成边界。

Record Tool 变更除单元测试外，还应至少做一次 Server 内 Agent Runtime 真实 smoke；真实模型的 Tool Selection 不作为 CI 的确定性断言。

## iOS

当前仓库没有统一的命令行 iOS 测试脚本。修改 iOS UI / 网络层时，需要至少通过 Xcode build，并针对受影响页面做手工或模拟器验证。

## 不要用假验证替代真实验证

以下行为不算完成：

- 只 typecheck 就宣称 OSS 上传可用；
- 只读取代码就宣称 HTTP 路由已经注册；
- 只存在数据库表就宣称自动 workflow 已接入；
- 用 Preview / mock 数据证明 iOS 已经接入服务端能力。

## 创作链路

`creative-runtime/creative.test.ts` 使用 TEST_DATABASE_URL 指向的隔离 PostgreSQL 服务，新建临时数据库（测试账号需要 CREATEDB）并在结束后删除；覆盖 Record 后置理解、HTTP 接受、图片保存、增量发布、无价值 / 主体不明确时静默结束、用户隔离与未知生图禁止重发。日常测试使用假模型和 OSS，不付费。

`creative-runtime/creative-live.test.ts` 默认为跳过。显式设置 `CREATIVE_SMOKE_ALLOW_PAID=true` 与 TEST_DATABASE_URL 后，读取 Server `.env`，使用真实 Pi / DeepSeek / Qwen / OSS，最多发起一次付费生图请求；测试素材为自行绘制的成年人物插画，临时数据库、Session 与 OSS 对象均清理。不要使用生产数据库作为 TEST_DATABASE_URL。

# Fanto Agent Guide

本文件只定义仓库级导航与全局协作约束。具体模块规则位于对应目录的 `AGENTS.md`，当前系统语义位于 `docs/`。

## 1. 开始前先定位上下文

- 产品定位与边界：`docs/product/`
- 当前系统结构：`docs/architecture/`
- 业务领域语义：`docs/domain/`
- HTTP 契约：`docs/api/http-api.md`
- iOS 当前能力：`docs/clients/ios.md`
- 开发、配置、测试：`docs/engineering/`

进入子模块时继续读取最近的局部规则：

- Server：`apps/server/AGENTS.md`
- Agent Runtime：`apps/agent/AGENTS.md`
- iOS：`apps/ios/fanto/AGENTS.md`

## 2. Source of Truth

优先级：

1. 实际代码、测试、schema / migration 决定可执行事实。
2. `docs/` 描述当前已经存在的系统与产品语义。
3. `plan/` 是工作设计或历史方案，不是当前运行能力的证明。

如果文档与代码冲突，先验证实际运行路径，再以代码事实修正文档；不要根据旧方案猜测当前能力。

## 3. 全局协作约束

- 只有用户明确要求执行、修改或修复时才编辑代码或文件；排查和方案讨论不默认授权修改。
- 优先做最小、清晰、可验证的改动，不为抽象而增加层级。
- 涉及用户数据的查询与写入必须保持用户隔离；不能把“调用方会过滤”当成数据边界。
- 不把密钥、Token、Authorization 或其他凭据写入源码、客户端或示例文档。
- 不把尚未接入运行入口的代码、设计稿或计划描述成已经可用的产品能力。
- 修改前先阅读目标模块局部 `AGENTS.md` 与相关 current docs。

## 4. 验证入口

仓库级：

```bash
pnpm typecheck
pnpm test
```

更具体的验证范围见 `docs/engineering/testing.md` 和各模块 `AGENTS.md`。

## 5. 文档刷新

Plan 是可选的执行上下文，不是当前事实来源。文档刷新以 Git 已提交的最终变化为依据。

当用户要求同步 / 刷新项目文档，或任务明确包含文档整理时：

1. 读取 `docs/.checkpoint` 的 `reviewed_through`。
2. 先查看 `reviewed_through..HEAD` 的 commit message 与 changed files：
   - `git log --oneline <checkpoint>..HEAD`
   - `git diff --name-status <checkpoint>..HEAD`
3. 根据变化路径判断候选文档，再读取相关代码的具体 diff；不要默认全量重写 docs。
4. Commit message 用于理解意图，最终代码、测试、schema 与实际 diff 才是事实依据。
5. 只在用户行为、API contract、Domain 语义、数据生命周期、架构 / 安全 / 可靠性边界或配置方式变化时更新 Current Docs；纯重构和等价实现通常无需改文档。
6. `docs/product/current-scope.md` 只在产品 Capability 变化时更新，不作为 changelog。
7. 全部增量都完成 Documentation Impact Review 后，再把 checkpoint 推进到本次已审查到的 commit。checkpoint 表示“reviewed through”，不表示每个 commit 都产生过文档修改。

常见代码到文档的检查关系：

- `apps/server/src/domain/records/**`、Record routes → `docs/domain/records.md`、必要时 `docs/api/http-api.md`
- `apps/server/src/domain/media/**`、媒体 Client → `docs/domain/media.md`
- `apps/server/src/domain/memory/**`、向量脚本 → `docs/domain/memory.md`
- `apps/server/src/domain/creations/**` → `docs/domain/creations.md`
- `apps/agent/**` → `docs/architecture/agent-runtime.md`
- `apps/ios/fanto/**` → `docs/clients/ios.md`
- 配置读取逻辑 → `docs/engineering/configuration.md`
- 跨组件能力真正接入 / 移除 → 检查 `docs/product/current-scope.md`

这些映射只用于缩小 Review 范围，不替代对最终 diff 的判断。

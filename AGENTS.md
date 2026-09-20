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

1. 实际代码、测试、schema / migration、配置决定可执行事实。
2. `docs/` 描述当前已经存在的系统与产品语义。
3. `plan/` 仅是可选的执行过程材料，不属于 Current Knowledge，也不用于判断当前系统状态。

如果文档与代码冲突，先验证实际运行路径，再以代码事实修正文档；不要根据旧方案猜测当前能力。

## 3. 全局协作约束

- 只有用户明确要求执行、修改或修复时才编辑代码或文件；排查和方案讨论不默认授权修改。
- 优先做最小、清晰、可验证的改动，不为抽象而增加层级。
- 涉及用户数据的查询与写入必须保持用户隔离；不能把“调用方会过滤”当成数据边界。
- 不把生产密钥、Token、Authorization 或其他凭据写入源码、客户端或示例文档。用户明确批准的受控测试客户端可以使用固定测试凭据，但必须明确标记为 test-only、不得授予生产资源权限，并在正式认证接入前移除。
- 不把尚未接入运行入口的代码、设计稿或计划描述成已经可用的产品能力。
- 修改前先阅读目标模块局部 `AGENTS.md` 与相关 current docs。

## 4. 技术方案

原则：技术方案应描述从**已验证的当前系统**到目标状态的**最小必要变化**。

规则：

1. 基于现状设计：先确认相关代码、Schema、配置、测试，再做方案。
2. 只做最小必要变化：明确改什么、不改什么，优先复用现有结构，不顺手扩架构。
3. 讲清关键链路：说明主要数据流、调用关系和职责归属。
4. 守住关键约束：明确不能破坏的数据边界、依赖方向、状态/失败语义。
5. 提前定义验证：方案完成时就应知道如何证明实现正确。

## 5. 验证入口

仓库级：

```bash
pnpm typecheck
pnpm test
```

更具体的验证范围见 `docs/engineering/testing.md` 和各模块 `AGENTS.md`。

## 6. 文档刷新

Current State 文档只描述**当前最终仓库状态**。它不仅包括 `docs/**`，也包括根 `README.md`、模块 `README.md`，以及 `AGENTS.md` 中描述“当前能力 / 当前约束 / 当前运行状态”的部分。文档刷新比较 `docs/.checkpoint` 所指向的仓库状态与当前 `HEAD`，不重建中间开发过程。

当用户要求同步 / 刷新项目文档，或任务明确包含文档整理时：

1. 读取 `docs/.checkpoint` 的 `reviewed_through`。
2. 查看 `reviewed_through..HEAD` 的整体变化，用于定位受影响范围：
   - `git diff --name-status <checkpoint>..HEAD`
   - 必要时查看 `git log --oneline <checkpoint>..HEAD` 辅助理解变化背景。
3. 根据 changed files 判断候选 Current State 文档，再读取相关最终代码与具体 diff。候选范围必须同时考虑 `docs/**`、根 / 模块 README、以及包含当前状态描述的模块 AGENTS；最终代码、测试、schema / migration、配置和最终 diff 才是事实依据。
4. 不读取、核对、整理、补全、归档或修正 `plan/` 来完成文档刷新。Plan 可能过期、未完成、被放弃或与最终实现不同，这不构成文档问题。
5. 只在用户行为、API contract、Domain 语义、数据生命周期、架构 / 安全 / 可靠性边界或配置方式变化时更新 Current Docs；纯重构和等价实现通常无需改文档。
6. `docs/product/current-scope.md` 只在产品 Capability 变化时更新，不作为 changelog。
7. 单次 feature 中顺手更新部分文档，不等于完成 Documentation Impact Review。只有 `reviewed_through..HEAD` 的全部增量和所有受影响 Current State 文档都检查完成后，才能把 checkpoint 推进到本次已审查到的 commit；checkpoint 与本次文档修正应一起提交。checkpoint 表示“reviewed through”，不表示每个 commit 都产生过文档修改。

常见代码到文档的检查关系：

- `apps/server/src/domain/records/**`、Record routes → `docs/domain/records.md`、必要时 `docs/api/http-api.md`
- `apps/server/src/domain/media/**`、媒体 Client → `docs/domain/media.md`
- `apps/server/src/domain/memory/**`、向量脚本 → `docs/domain/memory.md`
- `apps/server/src/domain/creations/**` → `docs/domain/creations.md`
- `apps/agent/**` → `docs/architecture/agent-runtime.md`、`apps/agent/README.md`，必要时根 `README.md`
- `apps/h5/**` → `docs/product/current-scope.md`、`docs/engineering/local-development.md`、`docs/architecture/overview.md`，必要时根 `README.md`
- `apps/ios/fanto/**` → `docs/clients/ios.md`、`apps/ios/fanto/AGENTS.md`
- 配置读取逻辑 → `docs/engineering/configuration.md`
- `deploy/**`、公网入口或代理拓扑 → `docs/engineering/local-development.md`、`docs/architecture/overview.md`，必要时根 `README.md`
- 跨组件能力真正接入 / 移除 → 检查 `docs/product/current-scope.md` 与根 `README.md`

这些映射只用于缩小 Review 范围，不替代对当前最终状态的判断。

## 7. Commit Message

Commit message 可以帮助理解变化背景，但文档刷新不依赖特定的 commit 结构，也不要求为了文档维护拆分 commit。

推荐使用清晰、可理解的描述，例如：

```text
feat(memory): add user-scoped retrieval
fix(records): reject stale postprocess writes
docs: update current memory architecture
```

重要架构或行为变化可以补充简短 body 说明原因，但最终系统事实仍以代码、测试、schema / migration、配置与最终 diff 为准。

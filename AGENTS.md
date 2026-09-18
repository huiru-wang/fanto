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

# Fanto 文档索引

`docs/` 只描述**当前已经存在的产品语义与系统事实**。如果文档与实际代码冲突，应先验证代码路径，再修正文档。

## 产品

- [产品愿景](product/vision.md)：Fanto 为什么存在、长期想成为怎样的产品。
- [产品原则](product/principles.md)：功能和 AI 行为发生取舍时的稳定原则。
- [当前产品边界](product/current-scope.md)：当前仓库已经接入与尚未接入的能力。

## 架构

- [系统总览](architecture/overview.md)：当前运行组件、依赖关系与数据边界。
- [业务 Server](architecture/server.md)：Hono Server 的模块边界、请求与异步处理链路。
- [Agent Runtime](architecture/agent-runtime.md)：Pi AgentHarness、Session、Task、Workspace 与安全边界。

## 领域

- [Record](domain/records.md)：原始记录、状态、版本和时间语义。
- [Media](domain/media.md)：上传、OSS、图片理解与音频转写。
- [Memory / Retrieval](domain/memory.md)：Memory 模块、Record 索引、检索与派生数据边界。
- [User Preferences](domain/preferences.md)：用户明确长期偏好、来源追溯与 Agent 写入边界。
- [Creation / Proposal](domain/creations.md)：长期脉络、待确认发现和来源关系。

## 客户端与接口

- [HTTP API](api/http-api.md)：当前实际注册的 HTTP 接口。
- [iOS](clients/ios.md)：当前 SwiftUI 客户端页面、真实数据源与未接入能力。

## 工程

- [本地开发](engineering/local-development.md)
- [配置](engineering/configuration.md)
- [测试与验证](engineering/testing.md)

仓库协作规则从根目录 [AGENTS.md](../AGENTS.md) 开始；进入 Server、Agent 或 iOS 时继续读取对应目录的局部 `AGENTS.md`。

## 文档刷新检查点

`docs/.checkpoint` 记录最近一次**已经完成 Documentation Impact Review 的仓库 commit**。它不是“最后一次修改 docs 的 commit”，也不是要求每个 commit 都同步文档。

刷新文档时，从 checkpoint 到当前 `HEAD` 查看 commit、changed files 和相关最终 diff，只更新真正受语义变化影响的 Current State 文档。审计范围不只限于 `docs/**`：根 / 模块 README，以及 AGENTS 中描述当前能力或当前约束的部分也属于 Current State；确认整段增量都已经 review 后，再推进 checkpoint。

因此 checkpoint 的含义是：

> 截至这个 commit 的仓库变化，已经判断过它们是否需要反映到 Current Docs。

具体执行规则见根目录 [AGENTS.md](../AGENTS.md)。

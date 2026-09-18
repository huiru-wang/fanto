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
- [Memory / Retrieval](domain/memory.md)：Record 向量索引、检索与派生数据边界。
- [Creation / Proposal](domain/creations.md)：长期脉络、待确认发现和来源关系。

## 客户端与接口

- [HTTP API](api/http-api.md)：当前实际注册的 HTTP 接口。
- [iOS](clients/ios.md)：当前 SwiftUI 客户端页面、真实数据源与未接入能力。

## 工程

- [本地开发](engineering/local-development.md)
- [配置](engineering/configuration.md)
- [测试与验证](engineering/testing.md)

仓库协作规则从根目录 [AGENTS.md](../AGENTS.md) 开始；进入 Server、Agent 或 iOS 时继续读取对应目录的局部 `AGENTS.md`。

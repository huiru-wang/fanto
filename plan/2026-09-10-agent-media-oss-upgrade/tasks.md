# 执行任务清单

## Phase 0：决策与准备

- [ ] 确认生产 bash 的隔离级别：容器/微虚拟机，或仅开发模式的 NodeExecutionEnv。
- [ ] 确认 ASR 的触发策略：建议客户端在上传完成后显式发起，Record 可在转写前保存。
- [ ] 确认 Pi SQLite backend 的版本、许可证、与当前 SQLite 驱动的集成方式；锁定与 `pi-agent-core` 兼容的版本。

## Phase 1：OSS 与 AI 配置

- [ ] 扩展 `AppConfig`：收敛 OSS region/endpoint/bucket/credential 与 ASR、VL 独立 base URL。
- [ ] 改造 `OssStorage` 接收并使用 endpoint，增加启动期配置和公网 endpoint 校验。
- [ ] 更新示例环境变量、部署说明与 `docs/http/record-media-api.md`，不写入真实密钥。
- [ ] 添加 OSS 签名 URL 单元测试，以及内部 endpoint/错误 endpoint 的拒绝测试。

## Phase 2：ASR 持久化与 Record 集成

- [ ] 定义 `media_assets.ext_data.asr` 的 schema、状态机和向后兼容读取逻辑。
- [ ] 实现 ASR 任务的持久状态变更、幂等成功读取、失败重试与并发控制。
- [ ] 保持 Record 请求 `media` 仅为 `mediaId`；`text` 保留用户输入，ASR 作为 audio media 的独立读视图，不进行拼接。
- [ ] 扩展媒体读 DTO/文档，提供已脱敏的 ASR 状态和文本恢复能力。
- [ ] 为转写成功、刷新恢复、重复请求、失败重试、编辑后创建 Record 编写测试。

## Phase 3：Pi Harness 与会话持久化

- [ ] 新建 `agent/` 目录结构及接口边界，移除旧 runtime 对 HTTP 路由的直接耦合。
- [ ] 引入 SQLite `SessionStorage` backend 或实现经过 Pi conformance 测试的适配器。
- [ ] 以全局唯一 `sessionId` 创建、打开和隔离 SessionStorage/Harness/workspace；metadata 中的 userId 仅用于 HTTP 授权与列表过滤。
- [ ] 构建 Harness factory：models、system prompt、session、tool context、恢复未完成操作和空闲缓存。
- [ ] 将 SSE 改为消费 Harness 状态/事件的稳定投影，保留错误与取消语义。
- [ ] 添加重启后会话续接、并发同 session、跨用户 sessionId 碰撞与压缩后的集成测试。

## Phase 4：Tool Calling 与工作区

- [ ] 实现每 user/session 独立 workspace 的创建、清理和路径/软链接越界防护。
- [ ] 注册 Pi 原生 bash/read/write/edit 工具，配置 activeToolNames 与模型工具能力检查。
- [ ] 通过 bash prepare hook 强制 cwd、最小环境、超时、输出截断、命令策略和审计。
- [ ] 在生产执行容器/微虚拟机中实现 ExecutionEnv；开发环境与生产环境通过显式配置区分。
- [ ] 完成路径逃逸、绝对路径、软链接、网络、超时、输出/环境变量泄漏和危险命令的安全测试。

## Phase 5：原始消息读取与迁移

- [ ] 定义独立于 Pi 内部类型的 `RawAgentMessage` DTO 与 projector，并制定字段脱敏规则。
- [ ] 实现 `GET /api/agent/sessions/:sessionId/messages` 的归属校验、复合游标和 limit 校验。
- [ ] 使 SSE projector 与列表 projector 共享映射规则；测试实时事件可由列表重放。
- [ ] 制定旧 `messages` 表的只读保留、迁移或归档期限；确认后再停止旧写入并删除遗留代码。
- [ ] 更新 HTTP API 文档与端到端测试，完成 feature flag 灰度、监控和回滚预案。

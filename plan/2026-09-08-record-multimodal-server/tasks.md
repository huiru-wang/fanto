# Fanto Server 简化多模态 Record：实施任务

依赖：[设计方案](./design.md)。测试只能使用隔离 SQLite、OSS fake 与模型 fake，不使用真实用户数据。

1. 停用 organizer、contemplate、digest 对 Record 的生产写路径。
   - 验收：创建、编辑、媒体处理均不写 Topic。

2. 重整服务目录为 `application/{records,uploads,media}`、`domain/{records,uploads}`、`interfaces`、`listeners` 与 `infrastructure`。
   - 验收：domain 不依赖 Hono、Kysely、OSS 或 AI SDK；不存在媒体 worker 目录。

3. 落地 shared 与 domain 的 `RecordContentV1` codec、runtime schema 和附件结果写回纯函数。
   - 验收：图片最多 3 个、音频最多 1 个、总数最多 4 个；拒绝空内容、未知类型、非法 MIME、超限大小或时长；没有 block processing、哈希、semantic 或向量字段。

4. 定义并实现本地 `LocalMediaQueue`，由图片与音频两个 listener 分别消费。
   - 验收：不创建第二张任务表，也不扩展 tasks 表服务媒体；消息含 recordId、blockId、contentVersion；队列实现不承诺持久化、租约或自动重试。

5. 编写前滚迁移：新增 `content_version`，将旧文本 content 转为 V1 JSON，并转换旧 Record 状态。
   - 验收：支持备份、dry-run、重复执行安全；旧记录读取、分页和用户隔离不回归。

6. 实现私有 OSS 上传 intent、HEAD complete、一次性 asset ref、短时签名读 URL 与过期清理。
   - 验收：跨用户、过期、伪造 key、未上传、重复消费、元数据不符均失败；密钥不下发或记录。

7. 实现 Record 创建与更新：保存 content、递增 contentVersion，并为缺少最终结果的附件发布同版本媒体消息。
   - 验收：替换附件会清除其结果；未变附件不重复投递；媒体处理不改变 Record.status。

8. 实现图片与音频 listener 及 `application/media` 用例：调用服务，以及版本和 block 条件回写。
   - 验收：contentVersion 不匹配、block 删除或类型变化时，Record 不变并记录丢弃日志；匹配时仅回写最终媒体字段。

9. 实现 Qwen 图片理解与流式音频理解适配。
   - 验收：图片仅返回 description；音频聚合 transcript/language/emotion；无 transcript、无 stop、无 `[DONE]`、断流、429、5xx、网络错误均可诊断并记录日志；中间流内容不持久化。

10. 补齐 HTTP、队列分派、私有访问、迁移和并发回写的集成测试，并同步 API 文档。
    - 验收：媒体无任务状态管理；本地队列重启丢失消息为已知行为；不实现视频、H5、向量化、Artifact、Suggestion 或真实 Topic 写入。

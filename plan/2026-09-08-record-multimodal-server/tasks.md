# Fanto Server 多模态 Record：实施任务

> 依赖：[设计方案](./design.md)。测试使用隔离 SQLite、OSS fake 和模型 fake；不使用真实用户数据。

1. Feature-disable organizer、contemplate、digest 的生产写路径。
   - 验收：任何 Record 创建、编辑、处理都不写 Topic。

2. 建立统一的 server 目录与依赖边界：`application/{records,uploads,processing}`、`domain/{records,uploads,media}`、`interfaces`、`workers/record-processing`、`infrastructure`。
   - 验收：domain 无 Hono/Kysely/SDK 依赖；routes 不直接调用 OSS 或模型。

3. 落地 shared `RecordContentV1`、runtime schema、codec、新 Record status 与 processing-state 纯函数。
   - 验收：图片 ≤3、音频 ≤1、空内容、未知类型、MIME/时长/大小均严格校验；状态 counters 只能由 task 重算。

4. 编写前滚迁移：新增 `content_version`、V0 文本转 V1、旧 organized/skipped 转 processed 并保存 legacy 信息。
   - 验收：备份/dry-run/重复迁移安全；旧记录读、分页、用户隔离不回归。

5. 实现 OSS `MediaStorage`、upload intent、HEAD complete、一次性 ref、签名读 URL 与过期清理。
   - 验收：跨用户、过期、伪造 key、未上传、重复消费、校验不符全部失败；密钥不下发/不记录。

6. 实现 Record application services、路由和 processing job lease/generation 幂等机制。
   - 验收：创建/编辑/删除附件/重试的事务一致；旧 job 不能回写新 generation。

7. 实现 `QwenVlImageUnderstandingService` 与 image job。
   - 验收：请求/响应转换、事实描述 schema、429/5xx/网络重试、对象丢失和 schema 错误均可测。

8. 实现流式 `QwenAsrAudioUnderstandingService` 与 audio job，解析和聚合 SSE transcript、language、emotion。
   - 验收：逐 chunk 拼接、重复 annotation、annotation 冲突、缺 transcript、无 stop、无 `[DONE]`、断流、三次退避和精确重试均可测；流式半成品不会写入 Record。

9. 按 [HTTP API 文档](../../docs/api/http-api.md) 做 API 集成测试、私有访问测试和状态机回归。
   - 验收：所有 required task 成功才 processed；单一失败为 processing_failed；无视频、H5、Artifact、Suggestion 或真实 Topic 写入。

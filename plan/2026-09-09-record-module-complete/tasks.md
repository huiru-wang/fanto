# Record 模块完整实施任务

依赖：[设计方案](./design.md)。所有测试使用独立 SQLite、OSS fake、ASR/Vision fake；禁止真实用户数据库、真实对象和真实模型调用。

1. 审计并收敛本次变更范围。
   - 恢复或保留既有 Topic、Agent、Task、向量与其迁移；本次 diff 只触及 Record、媒体、共享 DTO、H5 适配、测试与文档。
   - 验收：主分支功能未因 Record 工作被删除；迁移历史连续可运行。

2. 固化 shared DTO、RecordContent codec 与数据迁移策略。
   - 定义以 `mediaId` 为唯一附件标识的 blocks、图片/音频数量上限和空内容校验；保持 `records.version`。
   - 验收：客户端不能提交 object key、图片描述、语言或情绪；旧记录与新记录都可读取。

3. 完整实现 upload intent 与 media asset repository。
   - 覆盖创建、HEAD complete、幂等 complete、归属、过期、取消、未关联 asset 删除和 ext_data namespace 合并。
   - 验收：跨用户、过期、错误 MIME/字节数、未上传、重复 complete 都被正确拒绝或幂等返回。

4. 完整实现 OSS 适配与媒体读取。
   - 私有 PUT/GET 签名、HEAD、删除、错误归类；`GET /api/media/:id` 鉴权后 302；验证音频 Range。
   - 验收：不泄漏 object key、凭据或签名 URL；无权与不存在统一 404。

5. 修正音频编辑态 SSE。
   - 传递 AbortSignal 至上游 ASR；限制单活跃连接；转发 delta；仅完整结果写入 `media_assets.ext_data.audio`；完成任务可复读结果。
   - 验收：取消、断连、超时和不完整流不写结果；保存前可编辑 transcript；音频未就绪返回 409。

6. 恢复图片异步队列和 listener。
   - 实现 `LocalImageQueue`、`image_understanding` 消息、Vision adapter、listener 注册和可诊断日志。
   - 验收：图片只在 Record 保存成功后投递；listener 不依赖 Hono；模型失败不影响保存。

7. 实现图片条件回写与补偿投递。
   - 使用 `recordId + mediaId + version` 双重校验；创建/PATCH 后为无描述图片投递；启动/定时扫描补偿进程重启遗漏。
   - 验收：版本变化、附件移除、替换图片时旧任务不回写；相同任务重复执行结果幂等。

8. 完整实现 Record 创建、PATCH 与媒体回收。
   - 原子关联、解除关联、expectedVersion 冲突 DTO、幂等键；提交后异步回收移除的附件并记录失败。
   - 验收：不允许跨 Record 复用已关联媒体；成功编辑不因 OSS 删除失败回滚。

9. 完成列表、详情与 H5 适配。
   - 复合游标、批量 hydration、图片和音频渲染 DTO；H5 改用 `content.text` 和 `media`，移除旧 Topic/处理状态假设。
   - 验收：`pnpm typecheck` 全绿；列表无 N+1；可预览图片并播放音频。

10. 补齐自动化测试与文档。
    - 覆盖 intent、OSS complete、SSE、取消、图片投递/回写/丢弃/补偿、并发、删除、Range、分页、鉴权和幂等。
    - 更新产品链路、HTTP path/header/body/response、curl 冒烟流程、迁移与运维说明。
    - 验收：服务端测试、全仓类型检查和独立端到端 fake 测试均通过。

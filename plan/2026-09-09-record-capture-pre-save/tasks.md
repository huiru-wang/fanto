# Record 编辑态媒体处理：实施任务

依赖：[设计方案](./design.md)。不兼容旧数据库，重建 SQLite 后验证。

1. 更新 Record API DTO：接收 `text + assets`，不再接受客户端 objectKey 或 JSON content version。
   - 验收：请求伪造 objectKey、模型结果或未完成 assetRef 均拒绝。

2. 建立 `upload_intents` 表、状态机和 SQLite repository。
   - 验收：uploadStatus 与 analysisStatus 分离；二者均不出现在 Record content。

3. 实现私有 OSS 上传 intent、complete HEAD 校验、短期签名读/写 URL、取消与过期清理。
   - 验收：跨用户、过期、重复 complete、大小/MIME 不匹配、重复消费均失败。

4. 实现图片上传完成后的本地预览支持所需 API 返回值，以及可选图片描述调用。
   - 验收：前端在 OSS 上传中即可使用本地 Blob 预览；服务端不保存 Blob URL。

5. 实现 `POST /uploads/intents/:id/transcription` SSE，包括单连接约束、delta 转发、最终结果写入和失败事件。
   - 验收：音频完成上传后可接收 delta；流式半成品不写数据库；completed 仅在完整模型结束后发送。

6. 实现转写取消：删除 intent 时中止活跃模型请求并丢弃后续结果。
   - 验收：保存前删除音频后，查询 intent 为 cancelled，Record 永不出现该附件。

7. 实现 Record 创建与编辑时对 intent 的原子消费、block 生成、结果复制和 version 递增。
   - 验收：音频未转写完成时保存返回 `AUDIO_TRANSCRIPTION_PENDING`；成功保存后不再有媒体 listener 回写。

8. 实现用户编辑 transcript 的保存规则与审计边界。
   - 验收：用户可覆盖 transcript；language/emotion 只来自转写结果；覆盖不改变原 OSS 文件。

9. 补齐 upload、SSE、取消、版本、删除附件、保存竞争的 API 测试，并更新 HTTP API 文档和手工 curl。
   - 验收：图片上传后可预览，录音上传完成后前端在目标 1~5 秒内开始显示转写；最终仅一次保存完整 Record。

10. 新增 `media_assets` 与统一 `GET /api/media/:mediaId`，将 block 改为仅存 mediaId 和理解结果。
    - 验收：blocks 数组顺序即媒体顺序；列表可批量取回媒体元数据并直接预览图片、播放音频；不扫描 JSON 查找媒体或按类型设计不同媒体路径。

11. 将尺寸、时长和分析结果收敛到 `media_assets.ext_data` 的 capture/analysis 命名空间。
    - 验收：上述字段无独立列或索引；更新 analysis 不覆盖 capture。

12. 补齐幂等、expectedVersion 并发冲突、已保存附件删除、Range 播放、Cookie 鉴权、私有缓存和 OSS 删除失败补偿规则。
    - 验收：多端同时保存返回明确冲突；音频可拖动播放；删除与过期的对象清理可追踪。

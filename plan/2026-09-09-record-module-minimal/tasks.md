# Record 模块最小实施任务

依赖：[最终最小技术方案](./design.md)。测试使用隔离 SQLite、fake OSS、fake ASR、fake 图片理解服务；不使用真实对象或用户数据。

1. 整理服务端目录与边界。
   - 建立 records、uploads、`application/media/transcribe-audio.ts`、domain、`infrastructure/ai`、listener 与 routes 的目标目录；移除 application/images、worker 和 jobs 代码。
   - 验收：图片理解文件只位于 `infrastructure/ai/image-understanding.ts`，音频模型适配只位于 `infrastructure/ai/audio-transcription.ts`，图片消费只在 listener。

2. 实现 RecordContent、上传 intent 和 media asset 数据模型及迁移。
   - 支持可选 text、图片/音频组合、可选 audio transcript、`records.version`、`media_assets.ext_data.recordId/capture`。
   - 验收：纯音频、图音、图文和纯文本均通过；空内容、超限和重复 mediaId 被拒绝。

3. 实现上传 intent 与 OSS complete。
   - 创建短期 PUT URL、前端直传后的 HEAD 校验、创建稳定 mediaId、私有 GET URL。
   - 验收：错误 MIME/字节、过期、跨用户、未上传和重复 complete 都有确定响应。

4. 实现音频编辑态 SSE。
   - 在 `application/media/transcribe-audio.ts` 编排，在 `infrastructure/ai/audio-transcription.ts` 调用模型；转发 delta、completed、failed；同一音频限制单连接；不向数据库写转写文本。
   - 验收：前端可只读预览；没有 transcript 的音频仍能保存；取消/重试/清理不在本阶段实现。

5. 实现 Record 创建和 PATCH。
   - 原子校验媒体、按顺序构造 block、关联/解除媒体、版本递增与冲突响应。
   - 验收：PATCH 必须 expectedVersion；冲突返回当前 Record；不删除任何编辑态或解除关联对象。

6. 实现本地图片 queue、task 发布与 listener。
   - 创建/更新成功后发送图片 task；listener 通过 `infrastructure/ai/image-understanding.ts` 调用 Qwen3-VL-Flash，并用 `recordId + mediaId + version` 条件回写 description。
   - 使用方案定义的客观中文提示词；单 task 仅理解一张图片。
   - 验收：图片不阻塞保存；模型只接受短期私有 URL；版本变化、图片移除、模型失败和重复 task 都不会错误覆盖数据。

7. 实现媒体读取、列表与详情。
   - 鉴权 302、Range、复合 cursor、批量 hydration 和前端媒体 DTO。
   - 验收：列表没有 N+1；图片可预览，音频可播放和拖动。

8. 补齐测试与文档。
   - 覆盖上传、complete、SSE、Record 保存/冲突、图片 task 条件回写、读取/鉴权/分页；更新 HTTP 文档和 curl。
   - 验收：隔离测试稳定通过，`pnpm typecheck` 全绿。

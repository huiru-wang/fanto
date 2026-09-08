# Record 模块服务端实施任务

1. 重建数据库基础迁移：users、records、upload_intents、media_assets；移除旧 Topic/Task/向量迁移。
2. 落地 shared DTO、RecordContent 校验与 media_assets ext_data 命名空间。
3. 实现私有 OSS PUT/GET 签名、HEAD、删除，以及上传 intent 创建/complete/取消/过期清理。
4. complete 后创建 media asset，并校验跨用户、过期、重复 complete、MIME 与大小不符。
5. 实现音频转写 SSE、单连接限制、取消、最终 audio ext_data 回写及失败事件。
6. 实现图片编辑态理解结果，并仅在保存时写入图片 block。
7. 实现 Record 创建与 PATCH：有序 mediaId、音频就绪校验、expectedVersion、原子关联和删除附件。
8. 实现统一 `GET /api/media/:mediaId`、Range 播放、Cookie 鉴权和列表批量 hydration。
9. 实现上传/完成/转写/删除/保存/并发/媒体读取的集成测试，更新 HTTP API 文档与手工 curl。

验收：图片上传中即可本地预览；音频上传后编辑页出现 SSE 文本；保存只产生一次完整 Record；列表直接预览图片并播放音频；没有保存后媒体回写。

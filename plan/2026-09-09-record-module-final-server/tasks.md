# Record 模块最终服务端实施任务

依赖：[最终技术方案](./design.md)。测试必须使用独立 SQLite、fake OSS、fake ASR、fake Vision；不得连接真实用户数据、真实 OSS 或真实模型。

1. 建立目标目录与依赖边界。
   - 按方案拆分 domain、application、interfaces、infrastructure、routes、workers 与 scheduler；保留非 Record 模块不动。
   - 验收：domain 无 Hono/SQLite/SDK 依赖；routes 和 workers 不直接拼接 SQL。

2. 设计并执行前滚数据库迁移。
   - 新增/补齐 `media_assets`、`upload_intents`、`image_understanding_jobs`、`media_cleanup_jobs`、`idempotency_keys` 及索引；迁移旧 Record content。
   - 验收：新旧数据库均可升级；不修改已执行 migration；迁移可在副本重复验证。

3. 完成 Record domain codec 与用例。
   - 实现输入校验、媒体上限、block 构造、version、关联差异、分页 cursor 与 DTO hydration。
   - 验收：伪造 object key/模型字段/重复 mediaId/空内容/跨用户媒体均被拒绝。

4. 实现 OSS 与稳定媒体资产。
   - 实现私有签名 PUT/GET、HEAD、删除、MIME/大小复核、ext_data 深合并和统一读取。
   - 验收：重复 complete 幂等；Range 可用；无权限与不存在统一 404；不泄漏私有信息。

5. 实现 upload intent 生命周期与幂等。
   - 支持创建、complete、查询、取消、过期以及 Idempotency-Key 的响应重放和请求 hash 校验。
   - 验收：网络重试不创建额外对象/资产；取消和过期均不可再次完成或保存。

6. 实现音频 SSE 转写。
   - 支持单连接、delta、最终写入、完成后复读、超时、客户端断连和 AbortSignal 上游取消。
   - 验收：中间文本不持久化；不完整或取消的流不写最终结果；保存前音频就绪校验正确。

7. 实现 Record 创建、PATCH 与删除附件。
   - 单事务完成媒体校验、媒体关联/解除、version 冲突、图片任务创建与 cleanup job 创建。
   - 验收：成功 PATCH 递增版本；冲突返回当前 DTO；OSS 删除失败不回滚用户编辑。

8. 实现可靠图片任务队列和 listener。
   - 领取 lease、有限重试、视觉调用、条件回写、失败诊断和任务状态迁移。
   - 验收：模型失败不影响 Record；重复任务幂等；旧版本/移除图片永不回写。

9. 实现 scheduler 与清理 worker。
   - 回收超时 lease、过期 intent、未关联资产、删除失败重试，以及无 description 图片补偿扫描。
   - 验收：重启后任务可恢复；24 小时临时资源最终清理；清理日志可追踪。

10. 实现 H5 所需读取契约。
    - 列表批量 hydrate、详情 DTO、图片预览地址、音频 Range 地址、SSE 客户端状态和 expectedVersion 编辑冲突交互。
    - 验收：前端只使用 mediaId 与内部 URL；全仓 `pnpm typecheck` 通过。

11. 补齐自动化测试。
    - 覆盖 domain、迁移、repository、HTTP、OSS complete、SSE、取消、图片任务、补偿、cleanup、幂等、鉴权、并发、分页和 Range。
    - 验收：所有测试可在隔离环境稳定重复运行，无外部网络依赖。

12. 完成接口、运维和验收文档。
    - 在 `docs/http/` 写完整 path/header/request/response/SSE；在 `docs/product-flows/` 写编辑页与图片异步链路；补充环境变量、告警和 curl 冒烟流程。
    - 验收：新成员可仅依文档部署 fake 环境并完成端到端验证。

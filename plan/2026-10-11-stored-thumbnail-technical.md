# 记录图片与缩略图：技术执行方案

状态：已实施；验证结果见任务清单。产品约束见[产品方案](2026-10-11-stored-thumbnail-design.md)，实施顺序见[任务清单](2026-10-11-stored-thumbnail-tasks.md)。执行以本文件和经核对的当前代码为依据，不依赖聊天记忆。与更早方案冲突时，以本组三份文件为准。

## 1. 已确认的现状和本次边界

当前 `MediaService.completeUpload` 只检查原对象的大小与类型；`OssStorage.readUrl` 使用阿里云实时图片处理；前端直到 complete 成功才保存 mediaId。已有 `sharp`、uploading/ready 状态、`ext_data` 和原图 object_key 可复用。

本期只接阿里云 OSS，改为公共媒体层生成并存储小图。保留 HTTP 上传凭据字段和 Record 媒体引用方式。不增加禁止覆盖、额外上传请求头、Bucket 版本控制要求、自动前端重试、历史原图搬迁或 R2 实现。

## 2. 存储接口与装配

新增 `infrastructure/clients/storage/object-storage.ts`、`aliyun-storage.ts` 和 `bootstrap/create-object-storage.ts`。本期工厂只支持 aliyun-oss；未来实现 R2 Client 后注册配置分支，未知 provider 拒绝启动。

```ts
type SignedUrl = { url: string; expiresAt: string };
type ObjectMetadata = {
  bytes: number;
  contentType: string;
  etag: string;
  metadata: Record<string, string>;
};

interface ObjectStorage {
  signUpload(key: string, contentType: string, expiresSeconds: number): Promise<SignedUrl>;
  signRead(key: string, expiresSeconds: number): Promise<SignedUrl>;
  head(key: string): Promise<ObjectMetadata | null>;
  getObject(key: string, options?: { maxBytes?: number }): Promise<Buffer>;
  putObject(key: string, data: Buffer, contentType: string,
    options?: { metadata?: Record<string, string> }): Promise<void>;
  remove(key: string): Promise<void>;
}
```

- Client 只操作一个指定 key；不接收 original/thumbnail，不生成小图，不隐式删除派生文件。
- Aliyun Client 将 SDK HEAD、对象 Body、metadata 和错误映射为统一类型。只有明确不存在返回 null，权限和网络错误不能被当作不存在；删除不存在对象幂等成功。
- `getObject` 的 maxBytes 在读取过程中限制，图片调用必须传入上限；网络调用设 SDK 超时。外部日志只保留安全元数据、结果和耗时。
- 所有签名统一 await，上传有效期 900 秒、读取 300 秒、生图临时参考 900 秒，expiry 与实际签名一致。上传仍绑定现有 Content-Type。
- `main.ts` 注入 ObjectStorage；MediaService、postprocess Listener 移除 OssStorage 类型依赖。更新 complete、read/redirect、Vision/ASR 和生图参考处的签名调用，不能让 Promise 进入 URL 字段。
- 保留并校验现有 OSS_* 配置。未来 R2 只需实现同一契约并增加对应配置 / 工厂注册；资源和 CORS 另行设置，不改变业务层。

## 3. 路径与数据结构

`domain/media/mime.ts` 的新上传路径改为 `users/<userId>/record/<UTC YYYY-MM>/<mediaId>.<ext>`，图片与音频保留 MIME 对应扩展名。年月沿用上传时刻，不使用 Record eventAt。

新增路径 helper，根据可信原图 key 的最后一个扩展名推导 `<mediaId>.thumbnail-v1.webp`，兼容旧 media/ 和 Project 路径。原图为 WebP 时也不能与小图同 key。

数据库仍一条 Media，`object_key / mime_type / bytes` 表示原图；在现有 ext_data 增加：

```json
{
  "variants": {
    "thumbnail": {
      "version": 1,
      "objectKey": "users/u1/record/2026-10/<mediaId>.thumbnail-v1.webp",
      "mimeType": "image/webp",
      "bytes": 42000,
      "width": 600,
      "height": 400,
      "sourceEtag": "opaque-etag"
    }
  }
}
```

ETag 仅作不透明源对象标记，不当作通用 MD5。小图对象同时写入标准 metadata：thumbnail-version 和 source-etag，供写对象成功但 DB 提交失败后的重试判断。任何 ext_data 更新都合并最新值，保留 recordId、capture、projectId、source 等字段。客户端不得写 variants。

不新增 Media 行、SQL 表或 migration；Record content 仍只引用 mediaId，公开 meta 仍是原媒体信息。

## 4. 公共图片处理与上传完成

新增 `domain/media/image-thumbnail.ts`，只负责输入 Buffer → 小图 Buffer / bytes / dimensions。用现有 sharp：实际格式检查 → EXIF 方向旋转 → 最大宽 600、保持比例、不放大 → WebP q80。不保留原 EXIF，动态图片使用首帧。原图保持原内容。

用户图片上限继续 10 MiB，Project 图片继续 20 MiB；解码上限 4000 万像素。实际格式必须符合声明 MIME，capture 图片宽高按解码和旋转后的真实值保存。

`completeUpload` 流程：

1. user-scoped 查询；不存在返回 not_found；已 ready 幂等返回成功，不重写 metadata。
2. 对 uploading Media HEAD 原图；不存在与长度 / MIME 不匹配分别返回结果。音频校验后沿用现有完成流程。
3. 图片下载并校验。检查派生对象 metadata；源 ETag、版本、MIME 和有效长度符合要求时可复用，否则生成并上传小图。
4. 对象操作成功后，在短事务内锁定 userId+mediaId、重读状态和 ext_data，合并 capture / variants 并设 ready；已 ready 返回已有结果，已删除不复活。外部调用不放进该事务。
5. 小图或 DB 失败保留 uploading 和已有对象，用户下一次主动保存时继续；不能将小图失败的媒体关联到 Record。

同 userId+mediaId 的生成合并为一次执行；全进程初始最多同时生成 2 张图，等待队列有上限，满时返回可重试失败。网络和图片处理分别设超时，complete 初始预算 60 秒，客户端 90 秒；实测后调整。超时不能被误写为成功，也不能在底层工作仍运行时提前释放并发槽。

HTTP 成功结构不变。错误分类：

| 情况 | HTTP / errorCode | 用途 |
| --- | --- | --- |
| Media 不存在 / 非本人 | 404 NOT_FOUND | 终止当前媒体流程 |
| 原对象不存在 | 409 UPLOAD_NOT_FOUND（新增） | 用户重试时判断是否需要上传 |
| 声明长度 / MIME 不匹配 | 409 UPLOAD_MISMATCH | 文件不符合上传声明 |
| 内容无法解码 / 实际格式不符 / 像素超限 | 422 INVALID_IMAGE（新增） | 文件无效 |
| 生成、存储、DB 暂时失败或处理容量已满 | 409 UPLOAD_INCOMPLETE | 保留草稿，等待用户重试 |

前端这些保存失败统一提示“保存失败，请重试”，不自动继续网络操作。

## 5. 客户端保存与用户主动重试

iOS：改 `RecordWriteAPIClient.swift`、`DraftRecordImage.swift`、`RecordComposerView.swift`。H5：改 `api/media.ts`、`api/http.ts`、`RecordComposer.tsx`。为草稿保存 ticket（mediaId/url/expiry）及已上传、已完成阶段；取得 ticket 即保存，不等整个 upload 方法成功。

- 一次用户点击按申请 → PUT → complete → Record 顺序执行；任何实际保存失败立即结束、保留草稿并提示失败。无自动重发、延时重试或失败后探测。
- 用户再次点击保存：已 uploaded 的媒体只 complete，已 ready 的媒体直接引用；已成功的其他照片不重做。
- 上次 PUT 响应丢失：仅在用户再次点击时先 complete 确认；成功则继续，UPLOAD_NOT_FOUND 表示原图缺失，可继续本次明确发起的上传，其余错误停止。不能把 PUT 的任意错误当成功。
- 原图已上传时链接过期不影响 complete；只有确认无原图且链接过期才重新申请。更换照片必须丢弃旧阶段，不能给新内容复用旧票据。
- H5 ApiError 与 iOS envelope 保留 errorCode，判断不依赖提示文本。草稿仅运行内存保留，不增加杀进程后恢复。
- 保留现有逐张处理。全部媒体完成才创建 Record；创建失败可在用户重试时复用 ready 媒体。Record POST 的响应丢失可能导致重复创建是既有幂等边界，本期不承诺自动消除。

## 6. 看图、旧照片与作品

`MediaService.readUrl` 校验归属 / ready 后解析变体：thumbnail 使用已存小图 key，original 使用原图 key；音频和非图片返回 original。`redirectUrl`、模型读取、生成参考继续取原图。公开 `{url, expiresAt}` 和 variant 参数保持不变；移除阿里云 x-oss-process 运行路径。

历史 ready 图片没有 variants：授权后用同一 ensureThumbnail 补生成，短事务锁定并合并最新 metadata，旧原图路径不变。失败返回 503 MEDIA_UNAVAILABLE，原图仍可读；生成期间媒体被删除不复活，已生成对象尽力清理。已有 metadata 的新图片不在每次读取时 HEAD / 重新生成。

两个现有方法的业务含义与改动：

| 当前方法 | 产品含义 | 必要改动 |
| --- | --- | --- |
| createGeneratedImage | 保存 Fanto 创作生成的图片 | 利用已有 Buffer 生成小图；两对象成功后登记 ready / variants；失败清理本次新写对象 |
| copyFinalReferences | 作品正式采用记录照片时保存独立副本 | 新 mediaId 保存独立原图和小图；不能引用源 Record 的小图；所有新写 key 进入现有回滚清理 |

Project 正式副本当前已经在业务事务中执行外部 I/O；本期沿用结构，验证新增图片处理的事务耗时，不顺手重构。模型临时参考对象不注册 Media、不展示，不生成小图。

## 7. 删除和验证

`PostgresMediaRepository.enqueueRecordDeletion` 在删除媒体元数据的事务内收集原 / 小图 key 并去重。旧图片缺 metadata 可推导 v1 key，非图片不推导。`deleteRecordObjects` 提交后分别限时尝试，一个失败不阻止另一个。Project 回滚也收集两对象；独立作品副本不被源 Record 删除。

保持现有尽力清理，不新增可靠删除、放弃草稿的自动回收或无孤儿承诺。日志不写凭据、signed URL 或 SDK 原始错误内容。

完成标准：

- 单元：路径 / UTC 跨月、旋转 / 比例 / 小图不放大 / WebP、实际格式校验、接口标准化与脱敏、超时 / 并发限制。
- 隔离 PostgreSQL 集成：complete 幂等、生成 / 上传 / DB 失败不 ready、ext_data 合并、用户隔离、旧图补生成、Project 独立副本和双对象清理。
- 客户端：每一步失败后无自动续接；用户再点击时正确恢复；五图全部完成才创建；文字、日期、地点和照片保留。
- 真实 OSS：签名上传、Content-Type / CORS、原图 / 小图内容和读取、删除；Mock 不替代真实闭环。小规格实例验证五图等待时间与内存，图片处理中现有服务仍正常。
- 执行 pnpm typecheck、pnpm test、iOS build；DB 测试使用 TEST_DATABASE_URL，不触碰生产数据，不覆盖其他未提交变更。

实施后更新 docs/domain/media.md、docs/api/http-api.md、相关 configuration/testing/client 文档与根 / 模块 AGENTS、README。只描述最终实现；局部更新不自动推进 docs/.checkpoint。阿里云链路稳定后再安排 R2，同一套接口和业务验证复用。

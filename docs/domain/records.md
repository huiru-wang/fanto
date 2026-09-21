# Record

Record 是用户原始记录，是 Fanto 个人数据的基础事实之一。它属于单一用户，并保留用户的原始文字与媒体顺序。

## 内容模型

`records.content` 保存 JSON：

```json
{
  "text": "准备周末徒步",
  "blocks": [
    { "type": "image", "mediaId": "...", "description": "异步生成，可选" },
    { "type": "audio", "mediaId": "...", "transcription": "异步生成，可选" }
  ]
}
```

创建 / 更新时客户端只提交文字与 `mediaId`，不提交 AI 生成的 `description` 或 `transcription`。

保存约束：

- text 最长 20,000 字；
- 最多 4 个媒体；
- 同一 Record 中 mediaId 不可重复；
- 媒体必须 ready、属于当前用户，且不能被其他 Record 占用；
- 文字为空时，至少需要包含一条音频；仅图片且无文字的 Record 当前不允许保存。

## 时间语义

- `eventAt`：业务发生时间，由客户端在创建时提交带时区 ISO 8601，Server 规范化后保存；Timeline / 日历应以它为准。
- `createdAt`：服务端首次保存时间。
- `updatedAt`：服务端最后变更时间。

列表按 `eventAt DESC, recordId DESC` 分页，cursor 同时编码这两个值，避免相同时间戳导致漏项。

## 版本与状态

Record 使用整数 `version` 做乐观并发。更新必须提交 `expectedVersion`。

```mermaid
stateDiagram-v2
  [*] --> pending: create
  pending --> processing: postprocess claim
  updated --> processing: postprocess claim
  processing --> processed: complete
  processing --> pending: release before complete on failure
  pending --> updated: user edit
  processed --> updated: user edit
```

当状态为 `processing` 时，不接受内容更新；版本冲突或 processing 更新会返回 `409 VERSION_CONFLICT`。

`completePostprocess` 只有在 `recordId + userId + version + runId` 都匹配当前 processing 任务时才完成，并返回最终的 processed Record；过期任务返回 `null`。

## 后置理解

Record 创建 / 更新后会触发 [Media](media.md) 理解与 [Memory](memory.md) 索引：

```text
Record save
→ postprocess claim
→ Vision / ASR
→ completePostprocess
→ processed Record
→ MemoryService.replaceRecord
```

图片描述和音频转写都写回当前 Record 版本的 block；旧 task 不能覆盖已经变化的版本。

Memory 是派生能力。Record 已经成功变成 `processed` 后，如果 Embedding 或 Memory Index 写入失败，不会把 Record 回滚到 pending；当前没有持久重试，索引可通过 Memory rebuild 恢复。

## 删除

删除使用当前 `version` 进行乐观并发校验，并从主表硬删除 Record。删除会解除关联媒体的 `recordId` 占用标记、移除该 Record 的向量记忆，以及清除其作为来源的创作关联；媒体资产及其 OSS 对象保留，后续可由专门的媒体清理能力处理。已入队或执行中的后置任务只会匹配仍存在的 Record，因此不会写回已删除内容。

Record 的完整 HTTP 投影还会把 block 关联到 Media URL、音频时长和 ASR 元数据，见 [HTTP API](../api/http-api.md)。

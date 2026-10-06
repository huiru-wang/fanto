# Record Retrieval

Record Retrieval 是对用户原始 Record 的派生索引和搜索能力，不是 Fanto 的长期记忆。`records` 是用户保存的事实；`vector_items` 只保存可删除、可重新生成的检索索引。

## 模块结构

```text
domain/records/
├── record-service.ts
└── retrieval/
    ├── record-retrieval-service.ts
    ├── record-index.ts
    ├── postgres-record-index.ts
    ├── record-document.ts
    └── embedding-provider.ts
```

`RecordRetrievalService` 负责拆分 processed Record、生成 embedding、增量更新、删除和搜索。`PostgresRecordIndex` 在 Record domain 内读写 pgvector。外部 Embedding API 适配器位于 `infrastructure/clients/`。

## 索引与失败语义

Record 创建或更新后的图片理解与音频转写完成，并成功写回当前版本后，postprocess listener 调用 `RecordRetrievalService.replaceRecord(processedRecord)`。文字、图片描述、音频转写和地点分别成为独立索引单元；搜索当前只查询文字、图片和音频。

索引失败只记录错误日志，不回滚已完成的 Record，也不自动重试、补偿或批量重建。删除 Record 时先移除该 Record 的索引，再删除业务 Record。

## Agent 使用

每次 main Agent Run 开始前，`RecordContextProvider` 读取最近 2 条 Record，注入 `recent_records`。主题相关的历史仍由模型调用 `record_search` 主动查询。最近记录只是原始背景，不能表示 Fanto 已形成长期认识。

Fanto 的独立长期 Memory 尚未实现。

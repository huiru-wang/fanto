# Record Retrieval

Record Retrieval 是对用户原始 Record 的派生搜索能力，不是 Fanto 的长期记忆。`records` 是用户保存的事实；`records.embedding` 是该 Record 最终内容生成的可覆盖派生字段。

## 模块结构

```text
domain/records/
├── record-service.ts
├── postgres-repository.ts
└── retrieval/
    ├── record-retrieval-service.ts
    ├── record-document.ts
    └── embedding-provider.ts
```

`RecordRetrievalService` 负责从 processed Record 构建一段完整 canonical 文本、生成 embedding 并搜索。`PostgresRecordRepository` 在 `records.embedding` 上读写 pgvector。外部 Embedding API 适配器位于 `infrastructure/clients/`。

## 索引与失败语义

Record 创建或更新后的图片理解完成并成功写回当前版本后，postprocess listener 调用 `RecordRetrievalService.replaceRecord(processedRecord)`。canonical 文本按固定顺序组合用户正文、格式化地点和图片 description；当前不将音频转写写入新的整体向量。

Embedding 失败只记录错误日志，不回滚已完成的 Record，也不自动重试、补偿或批量重建。更新 Record 时先将 `embedding` 清空，新的 postprocess 成功后写入当前版本向量；删除 Record 时向量随业务行删除。

## Agent 使用

每次 main Agent Run 开始前，`RecordContextProvider` 读取最近 2 条 Record，注入 `recent_records`。主题相关的历史由模型调用 `record_read(query)` 主动查询；它会在语义检索后返回最多 3 条完整 Record。最近记录只是原始背景，不能表示 Fanto 已形成长期认识。

Fanto 的独立长期 Memory 已由 [Memory](memory.md) domain 管理；它保存用户明确指定的长期信息，不与 Record 的派生向量索引混用。

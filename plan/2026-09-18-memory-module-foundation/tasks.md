
# Fanto Memory Module Foundation 任务清单

## P0-1：建立 Memory Core 模型与 Port

- [ ] 新增 domain/memory/model.ts
- [ ] 定义 MemorySourceType / MemoryRef / MemoryDocument / MemoryIndexHit / MemorySearchResult
- [ ] 新增 EmbeddingProvider
- [ ] 新增 MemoryIndex
- [ ] Domain 不依赖 Kysely / SQLite / AppConfig
- [ ] 不建立 Generic VectorStore

## P0-2：Record Memory Builder

新增 domain/memory/record-memory.ts：

- [ ] text → 用户记录
- [ ] image description → 图片描述
- [ ] audio transcription → 音频转写
- [ ] 保持 block 顺序
- [ ] 空内容返回 null
- [ ] content hash 稳定
- [ ] 单元测试覆盖 text/image/audio/mixed/empty/order/hash

## P0-3：MemoryService

新增 domain/memory/memory-service.ts：

- [ ] replaceRecord(record)
- [ ] removeRecord({userId, recordId})
- [ ] searchRecords({userId, query, limit})
- [ ] hash 未变化时跳过 embedding
- [ ] 空 document 时 remove
- [ ] 不查询 records 表
- [ ] 使用 fake Port 做单元测试

## P0-4：EmbeddingClient 接 Port

- [ ] EmbeddingsClient 实现 EmbeddingProvider
- [ ] 保持 embedding dimension 校验
- [ ] API key / base URL 留在 infrastructure
- [ ] Memory Core 不读取 config

## P0-5：SqliteVecMemoryIndex

新增 infrastructure/memory/sqlite-vec-memory-index.ts：

- [ ] 迁移 vector_items 查询
- [ ] 迁移 sqlite-vec 写入
- [ ] 实现 isCurrent / replace / remove / search
- [ ] 保持 rowid / id 对齐
- [ ] 完成后删除旧 domain/memory/record-index.ts 的 SQLite 实现

## P0-6：user-scoped vec0

Schema：

~~~sql
CREATE VIRTUAL TABLE record_vectors USING vec0(
  user_id text partition key,
  embedding float[1536]
);
~~~

- [ ] 写入 user_id
- [ ] KNN SQL 增加 user_id = currentUser
- [ ] 使用 k = limit
- [ ] 移除 limit * 4
- [ ] vector_items 继续校验 userId / type / status

## P0-7：Sqlite Adapter 测试

新增建议 infrastructure/memory/sqlite-vec-memory-index.test.ts：

- [ ] create / replace
- [ ] isCurrent
- [ ] remove
- [ ] KNN order
- [ ] user partition
- [ ] 其他用户更近也不能污染结果
- [ ] vector_items ownership defense
- [ ] empty result

## P0-8：Record Repository 生命周期调整

当前：

~~~text
completePostprocess → boolean
~~~

目标：

~~~text
completePostprocess → Record | null
~~~

- [ ] 成功返回最终 processed Record
- [ ] stale task 返回 null
- [ ] 保持 version / runId 保护
- [ ] 更新 Repository tests

## P0-9：Record 接入 Memory

修改 record-postprocess.listener.ts：

- [ ] completePostprocess → processed Record
- [ ] memory.replaceRecord(record)
- [ ] Memory 不再自行查 Record
- [ ] stale task 不写 Memory
- [ ] Memory 失败不撤销 processed Record
- [ ] 明确 Memory error 日志

## P0-10：Composition Root

bootstrap/main.ts / app.ts：

~~~text
EmbeddingsClient
→ SqliteVecMemoryIndex
→ MemoryService
~~~

- [ ] 注入 listener
- [ ] 注入 Record routes
- [ ] Route 不依赖 concrete Sqlite Adapter

## P0-11：Record Search HTTP

新增 POST /api/records/search：

- [ ] query 非空
- [ ] limit 默认 10
- [ ] limit 1–20
- [ ] userId 只从 x-user-id
- [ ] Route 调 MemoryService.searchRecords
- [ ] 不接受客户端 userId
- [ ] 不暴露 embedding / k / threshold
- [ ] 第一版返回 recordId + snippet
- [ ] 不把 distance 当产品 score

## P0-12：HTTP Search 测试

- [ ] normal
- [ ] empty query
- [ ] invalid limit
- [ ] no result
- [ ] user isolation
- [ ] Memory failure
- [ ] response envelope

## P0-13：Rebuild 重构

建议重命名 scripts/rebuild-memory-index.ts：

- [ ] 移除 default-user 硬编码
- [ ] scan 所有 Record
- [ ] 500 records / batch
- [ ] 每条调用 MemoryService.replaceRecord
- [ ] 不复制 content builder / embedding / sqlite SQL

## P0-14：Memory Index Reset

- [ ] clear vector_items
- [ ] drop / recreate record_vectors
- [ ] 不删除任何业务表
- [ ] reset 后执行 rebuild

## P0-15：多用户 Rebuild 验证

准备 default-user / user-a / user-b：

- [ ] 所有用户都有索引
- [ ] partition userId 正确
- [ ] search 不跨用户
- [ ] Record update 后命中新内容
- [ ] 无旧重复 vector

## P0-16：错误与一致性

- [ ] Memory 失败不回滚 processed Record
- [ ] Memory 失败记录日志
- [ ] 明确当前无 durable retry
- [ ] rebuild 可恢复缺失索引

## P0-17：删除旧 Vector-only PLAN

本方案取代 plan/2026-09-18-user-scoped-vector-retrieval：

- [ ] 删除旧目录
- [ ] user-scoped vector 内容完整吸收
- [ ] 不保留两个重叠 PLAN

## P0-18：回归验证

~~~bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
~~~

如涉及真实 Embedding：

- [ ] 最小 smoke test
- [ ] rebuild 一个真实 Record
- [ ] search 能召回

## P0-19：实施后的 Documentation Impact Review

代码真正落地后检查：

- [ ] docs/domain/memory.md
- [ ] docs/domain/records.md
- [ ] docs/architecture/server.md
- [ ] docs/api/http-api.md
- [ ] docs/engineering/testing.md
- [ ] docs/engineering/local-development.md
- [ ] Search HTTP 接入后检查 docs/product/current-scope.md

不要在只有 PLAN 时修改 Current Docs。

## P1：未来 Postgres 可替换性 Review

不迁移 Postgres，只检查边界：

- [ ] MemoryService 无 SQLite import
- [ ] MemoryIndex contract 不暴露 vec0
- [ ] EmbeddingProvider 不绑定模型商
- [ ] HTTP API 不依赖 sqlite distance
- [ ] Record integration 不依赖 Memory storage

未来应能新增 PgVectorMemoryIndex，而不改 MemoryService、Record integration、Search HTTP contract、Agent Tool。

## 明确延期

- [ ] 独立 Memory 微服务
- [ ] Memory 独立数据库
- [ ] memories 业务表
- [ ] Creation vector
- [ ] Conversation vector
- [ ] hybrid search / BM25 / reranker
- [ ] HNSW / 独立 Vector DB
- [ ] PostgreSQL 迁移
- [ ] Record delete
- [ ] 用户排除 Memory UI
- [ ] durable retry queue

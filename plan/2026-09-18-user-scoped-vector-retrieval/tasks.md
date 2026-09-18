# User-Scoped Vector Retrieval 任务清单

## P0-1：修改 vec0 schema

- [ ] 修改 `create_current_schema.ts`
- [ ] `record_vectors` 增加 `user_id text partition key`
- [ ] embedding 保持 `float[1536]`
- [ ] 不搬迁 vector_items 现有业务 metadata

目标：

```sql
CREATE VIRTUAL TABLE record_vectors USING vec0(
  user_id text partition key,
  embedding float[1536]
);
```

验收：

- sqlite-vec v0.1.9 可成功创建表
- 可插入 text user_id
- KNN 可携带 `user_id = ?`

---

## P0-2：修改向量写入

- [ ] `RecordMemoryService.index()` 写入 `user_id`
- [ ] 保持 last_insert_rowid → vector_items.id 对齐
- [ ] 保持 content_hash 去重逻辑
- [ ] 保持 replace 语义

目标：

```sql
INSERT INTO record_vectors(user_id, embedding)
VALUES (?, ?)
```

---

## P0-3：修改 search

- [ ] KNN SQL 增加 `user_id = userId`
- [ ] `k` 从 `limit * 4` 改为 `limit`
- [ ] 显式保留 KNN 顺序
- [ ] `vector_items` 继续校验 user_id
- [ ] `vector_items` 继续校验 type=record
- [ ] `vector_items` 继续校验 status=indexed

目标：

```sql
SELECT rowid AS id, distance
FROM record_vectors
WHERE embedding MATCH ?
  AND user_id = ?
  AND k = ?
ORDER BY distance
```

---

## P0-4：独立 Memory 检索测试

建议新增：

```text
apps/server/src/domain/memory/record-index.test.ts
```

覆盖：

- [ ] partition 基础查询
- [ ] u1 查询不返回 u2
- [ ] 更近的其他用户向量不会污染当前用户 Top-K
- [ ] 多用户候选污染回归
- [ ] limit 正确
- [ ] KNN 顺序正确
- [ ] replace 后旧向量不存在
- [ ] replace 后新向量 partition 正确
- [ ] remove 正确

核心回归：

```text
u1 B distance = 0.14
u2 C distance = 0.01

search(u1)
必须返回 B
不得返回 C
```

---

## P0-5：改造 vector rebuild

当前问题：

```text
只重建 default-user
```

改造：

- [ ] 移除 hard-coded `default-user`
- [ ] 遍历所有 Record
- [ ] 按 `record.userId` 写入 partition
- [ ] 采用批量 / 分页方式遍历
- [ ] 明确输出总 Record 数
- [ ] 最好输出涉及用户数
- [ ] 失败时非 0 退出

建议批次：

```text
500 records / batch
```

---

## P0-6：Vector Reset / Rebuild 路径

由于 vector index 是衍生数据：

- [ ] 定义 reset 流程
- [ ] 清空 `vector_items`
- [ ] drop 旧 `record_vectors`
- [ ] recreate 新 vec0 schema
- [ ] 执行全用户 rebuild

确保：

- [ ] 不删除 records
- [ ] 不删除 media
- [ ] 不删除 creation 数据

---

## P0-7：Migration 基线与运行文档

更新：

- [ ] `docs/domain/records.md`
- [ ] `docs/operations/local-development.md`

说明：

- [ ] user_id 是 vec0 partition key
- [ ] Record search 是 user-scoped KNN
- [ ] vector index 可重建
- [ ] schema 调整后的本地 reset / rebuild 操作
- [ ] rebuild 已覆盖所有用户

---

## P0-8：回归验证

执行：

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

如有专门 rebuild reset 命令，再执行：

```bash
pnpm vector:rebuild
```

验证：

- [ ] default-user search
- [ ] 第二用户 search
- [ ] 相同 query 不跨用户
- [ ] 每个用户都能获得足够 Top-K
- [ ] Record 更新后搜索命中最新内容

---

## P1：简单性能验证

构造：

```text
10 users
1000 vectors / user
```

观察：

- [ ] 当前用户 KNN latency
- [ ] 其他用户数据增加是否明显影响当前用户查询
- [ ] k=limit 是否稳定

本轮只做基础验证，不建设 benchmark framework。

---

## 明确延期

- [ ] metadata time filtering
- [ ] hybrid search
- [ ] BM25
- [ ] reranker
- [ ] Creation vector
- [ ] unified memory_vectors
- [ ] 独立向量数据库
- [ ] embedding model 迁移
- [ ] embedding dimension 调整

这些都不影响本轮 user-scoped retrieval 正确性。

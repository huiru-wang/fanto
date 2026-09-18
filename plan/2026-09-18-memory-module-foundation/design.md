
# Fanto Memory Module Foundation 设计

## 1. 目标

本方案将现有“Record 向量索引”提升为一个完整、可演进的 Memory 模块。

Memory 在产品上仍然表示：Fanto 对用户长期上下文的理解与可检索能力。它不是新的用户可见业务实体，本轮不创建 memories 业务表，也不拆独立微服务。

本轮目标：

1. Record 稳定接入 Memory；
2. Memory 提供统一的索引、替换、删除、搜索能力；
3. 搜索天然保持 user-scoped；
4. sqlite-vec 只是可替换的存储实现；
5. 未来迁移 PostgreSQL + pgvector 时，上层业务基本不变；
6. 后续 Creation / Conversation 等来源需要进入 Memory 时，有明确扩展位置；
7. Agent 的 record_search 通过 Business Server HTTP 调用，而不是直接访问数据库。

---

## 2. 当前事实与问题

当前链路：

~~~text
Record create/update
    ↓
postprocess queue
    ↓
record-postprocess.listener
    ↓
图片理解 / 音频转写
    ↓
completePostprocess
    ↓
RecordMemoryService.index()
    ↓
RecordMemoryService 再次读取 records
    ↓
EmbeddingsClient
    ↓
vector_items + record_vectors
~~~

当前 RecordMemoryService 同时承担：

- Record 内容读取；
- Record → 索引文本转换；
- SHA-256 去重；
- Embedding；
- sqlite-vec 写入；
- vector_items 写入；
- sqlite-vec 查询；
- metadata 查询。

这导致 Domain 语义和 SQLite / sqlite-vec 细节耦合。

当前检索：

~~~text
Global KNN(k = limit * 4)
    ↓
vector_items 按 user_id 过滤
    ↓
slice(limit)
~~~

这是 post-filter，不是可靠的多用户召回边界。

---

## 3. 设计原则

### 3.1 Memory 是能力，不是新的业务真相

业务事实仍然是 Record / Creation / Proposal / Media。

Memory 索引属于可重建派生数据：

~~~text
业务数据存在，Memory 缺失
→ 允许，可重建

Memory 存在，业务数据不存在
→ 脏索引，应清理
~~~

### 3.2 模块独立，不做微服务

本轮仍然是：

~~~text
Business Server
├── records
├── media
├── creations
└── memory
~~~

不做独立 Memory 进程、独立数据库、独立 RPC。

### 3.3 不抽 Generic VectorStore

不设计通用向量数据库 SDK 抽象，而定义：

- MemoryService
- MemoryIndex
- EmbeddingProvider

接口围绕 Fanto 的“记住 / 替换 / 忘记 / 搜索”语义。

### 3.4 userId 是底层数据边界

MemoryIndex.search 本身必须接受 userId 并强制隔离，不能依赖调用方最后过滤。

当前 sqlite-vec 实现使用：

~~~sql
user_id TEXT PARTITION KEY
~~~

让 KNN 在当前用户分区内发生。

---

## 4. 三层 Memory 模块

### Layer 1：Memory Core / Use Cases

建议目录：

~~~text
apps/server/src/domain/memory/
├── model.ts
├── record-memory.ts
└── memory-service.ts
~~~

职责：

- Memory 内部模型；
- Record → MemoryDocument；
- content hash；
- index / replace / remove / search use case；
- 不依赖 Kysely；
- 不依赖 SQLite；
- 不依赖 vec0；
- 不依赖 AppConfig。

### Layer 2：Ports / Contracts

建议：

~~~text
apps/server/src/domain/memory/
├── memory-index.ts
└── embedding-provider.ts
~~~

负责定义 Memory Core 依赖的稳定能力。

### Layer 3：Infrastructure Adapters

建议：

~~~text
apps/server/src/infrastructure/memory/
└── sqlite-vec-memory-index.ts

apps/server/src/infrastructure/clients/
└── embeddings-client.ts
~~~

职责：

- sqlite-vec schema / SQL；
- vector_items；
- rowid 对齐；
- user partition；
- Embedding API。

未来可替换：

~~~text
SqliteVecMemoryIndex
        ↓
PgVectorMemoryIndex
~~~

Memory Core 不变化。

---

## 5. 核心模型

本轮不建立持久化 Memory Entity，但定义内部统一模型：

~~~ts
export type MemorySourceType = "record";

export type MemoryRef = {
  userId: string;
  sourceType: MemorySourceType;
  sourceId: string;
};

export type MemoryDocument = MemoryRef & {
  content: string;
  contentHash: string;
};

export type MemoryIndexHit = MemoryRef & {
  content: string;
  distance: number;
};

export type MemorySearchResult = {
  sourceType: MemorySourceType;
  sourceId: string;
  snippet: string;
  distance: number;
};
~~~

MemoryDocument 是派生索引文档，不是产品实体。

---

## 6. Ports

### 6.1 EmbeddingProvider

~~~ts
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
~~~

当前 EmbeddingsClient 实现该接口。

Memory Core 不知道 apiKey、baseUrl、具体模型商或 fetch。

### 6.2 MemoryIndex

建议最小接口：

~~~ts
export interface MemoryIndex {
  isCurrent(ref: MemoryRef, contentHash: string): Promise<boolean>;

  replace(
    document: MemoryDocument,
    embedding: number[],
  ): Promise<void>;

  remove(ref: MemoryRef): Promise<void>;

  search(input: {
    userId: string;
    sourceType: MemorySourceType;
    embedding: number[];
    limit: number;
  }): Promise<MemoryIndexHit[]>;

  reset?(): Promise<void>;
}
~~~

isCurrent 保留当前“hash 不变则跳过 embedding”的优化。

Port 不暴露 SQL、table、rowid、k、partition。

---

## 7. MemoryService

建议核心 API：

~~~ts
export class MemoryService {
  constructor(
    private readonly index: MemoryIndex,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async replaceRecord(record: Record): Promise<void>;

  async removeRecord(input: {
    userId: string;
    recordId: string;
  }): Promise<void>;

  async searchRecords(input: {
    userId: string;
    query: string;
    limit: number;
  }): Promise<MemorySearchResult[]>;
}
~~~

### replaceRecord

~~~text
Record
  ↓
buildRecordMemoryDocument(record)
  ↓
empty?
  ├─ yes → remove previous index
  └─ no
       ↓
MemoryIndex.isCurrent(ref, hash)
  ├─ true → return
  └─ false
       ↓
EmbeddingProvider.embed(content)
       ↓
MemoryIndex.replace(document, embedding)
~~~

### searchRecords

~~~text
query
  ↓
EmbeddingProvider.embed(query)
  ↓
MemoryIndex.search(
  userId,
  sourceType=record,
  embedding,
  limit
)
  ↓
MemorySearchResult
~~~

MemoryService 不读取业务数据库。

---

## 8. Record → Memory 接入

当前 MemoryService 会自己再次读取 records，这是需要去掉的耦合。

目标链：

~~~mermaid
sequenceDiagram
  participant HTTP as Record Route
  participant Q as Postprocess Queue
  participant L as Listener
  participant R as Record Repository
  participant AI as Vision / ASR
  participant M as MemoryService

  HTTP->>Q: publish(recordId,userId,version)
  Q->>L: task
  L->>R: claimPostprocess
  R-->>L: Record
  L->>AI: enrich media
  L->>R: completePostprocess
  R-->>L: processed Record
  L->>M: replaceRecord(processed Record)
~~~

### Repository 调整

当前：

~~~ts
completePostprocess(...): Promise<boolean>
~~~

建议改为：

~~~ts
completePostprocess(...): Promise<Record | null>
~~~

语义：

- version / runId 匹配并完成：返回最终 processed Record；
- stale / 不可完成：返回 null。

Listener：

~~~ts
const completed = await records.completePostprocess(...);
if (completed) {
  await memory.replaceRecord(completed);
}
~~~

这就是 Record 与 Memory 的正式运行时接入点。

---

## 9. Record Memory Builder

建议新增：

~~~text
domain/memory/record-memory.ts
~~~

纯函数：

~~~ts
buildRecordMemoryDocument(record: Record): MemoryDocument | null
~~~

索引文本保持当前语义：

~~~text
用户记录：<text>
图片描述：<image description>
音频转写：<audio transcription>
~~~

要求：

- 保持 block 顺序；
- 空内容返回 null；
- hash 可稳定复现；
- 不调用 embedding；
- 不写数据库；
- 不查询数据库。

---

## 10. SqliteVecMemoryIndex

新位置：

~~~text
apps/server/src/infrastructure/memory/sqlite-vec-memory-index.ts
~~~

负责所有 SQLite-specific 行为：

- Kysely；
- vector_items；
- record_vectors；
- last_insert_rowid；
- sqlite-vec；
- rowid / metadata id 对齐；
- user partition；
- replace / remove / search。

---

## 11. user-scoped sqlite-vec

当前：

~~~sql
CREATE VIRTUAL TABLE record_vectors USING vec0(
  embedding float[1536]
);
~~~

改为：

~~~sql
CREATE VIRTUAL TABLE record_vectors USING vec0(
  user_id text partition key,
  embedding float[1536]
);
~~~

当前项目 sqlite-vec v0.1.9 已实际验证支持 text partition key。

### 写入

~~~sql
INSERT INTO record_vectors(user_id, embedding)
VALUES (?, ?)
~~~

### 查询

~~~sql
SELECT rowid AS id, distance
FROM record_vectors
WHERE embedding MATCH ?
  AND user_id = ?
  AND k = ?
ORDER BY distance
~~~

直接使用 k = limit，移除 limit * 4。

### 二次业务校验

从 vector_items 读取 metadata 时仍然要求：

~~~text
user_id = currentUser
type = record
status = indexed
~~~

形成两层边界：

~~~text
vec0 partition
→ retrieval boundary

vector_items.user_id
→ business ownership boundary
~~~

---

## 12. Search Service

Memory 内部统一提供：

~~~ts
memory.searchRecords({
  userId,
  query,
  limit,
})
~~~

未来调用方可以包括：

- Record Search HTTP；
- Agent Tool；
- Proposal 发现；
- Creation 更新；
- Conversation context retrieval。

调用方不需要知道 sqlite-vec、pgvector、embedding dimension 或 partition。

---

## 13. HTTP 搜索服务

Memory 是内部 Domain，不直接暴露泛化 /api/memory/search。

第一版保持资源语义：

~~~http
POST /api/records/search
~~~

Request：

~~~json
{
  "query": "我以前有没有思考过 AI Coding",
  "limit": 10
}
~~~

约束：

- userId 只来自 x-user-id；
- query trim 后不能为空；
- limit 默认 10；
- limit 1–20；
- Route 调 MemoryService.searchRecords；
- 不接受客户端 userId；
- 不暴露 embedding / threshold / k。

第一版 Response：

~~~json
{
  "success": true,
  "result": {
    "data": [
      {
        "recordId": "...",
        "snippet": "..."
      }
    ]
  }
}
~~~

distance 不默认暴露成产品 score。

需要完整 Record 时：

~~~text
record_search
    ↓ recordId
record_get
~~~

如果未来 UI 需要 eventAt 等字段，由 Record Route batch hydrate，不塞进 MemoryIndex。

---

## 14. Composition Root

在 bootstrap/main.ts 装配：

~~~text
EmbeddingsClient
      ↓
SqliteVecMemoryIndex
      ↓
MemoryService
~~~

再注入：

- Record postprocess listener；
- Record routes。

Route 只依赖 MemoryService 或其最小能力接口，不依赖 concrete Sqlite Adapter。

---

## 15. 删除旧 RecordMemoryService

完成后，不再保留“大而全”的 domain/memory/record-index.ts。

目标：

~~~text
domain/memory/
├── model.ts
├── embedding-provider.ts
├── memory-index.ts
├── record-memory.ts
└── memory-service.ts

infrastructure/memory/
└── sqlite-vec-memory-index.ts
~~~

---

## 16. Rebuild 成为 Memory 运维能力

当前 scripts/rebuild-vector-index.ts：

- 只处理 default-user；
- 最多 10,000 条；
- 绑定旧 RecordMemoryService。

建议重命名：

~~~text
scripts/rebuild-memory-index.ts
~~~

Rebuild 也必须走：

~~~text
Record
→ MemoryService.replaceRecord(record)
~~~

不要在脚本复制 content 拼接、hash、embedding 或 sqlite SQL。

### 全用户 rebuild

移除 default-user 硬编码。

按稳定批次扫描全部 Record，例如：

~~~text
500 records / batch
~~~

运维脚本可使用内部 DB scan，但无需为此暴露 HTTP API。

---

## 17. Memory Index Reset

Memory Index 是派生数据，因此可以：

~~~text
clear vector_items
drop / recreate record_vectors
rebuild all Records
~~~

不得删除：

- records；
- media_assets；
- creations；
- creation_proposals；
- entity_relations。

---

## 18. Record 生命周期与 Memory

### Create

~~~text
create Record
→ pending
→ postprocess
→ processed
→ replaceRecord
~~~

### Update

~~~text
update Record
→ updated
→ postprocess
→ processed
→ replaceRecord
~~~

### Postprocess 失败

~~~text
Record release
Memory 不更新
~~~

旧索引可暂时保留，代表最后一次成功处理版本。

### Delete

当前 Record 没有 delete API。

MemoryService 仍保留 removeRecord，供未来 Record 删除 / 排除能力使用，但本轮不新增 Delete API。

---

## 19. 错误与一致性

Memory 是派生能力，不应该让 Record 成功状态依赖 Embedding 成功。

原则：

~~~text
Record 成功
Memory 失败
→ Record 仍有效
→ Memory 可重建
~~~

特别是 completePostprocess 已成功后：

- Memory index 失败只记录日志；
- 不把 Record 从 processed 回滚成 pending；
- 当前无 durable retry 时，通过 rebuild 修复。

这需要修正当前 listener 中“Memory 失败进入 catch 后 releasePostprocess”的语义。

---

## 20. Search 与源数据 hydration

Memory Search 职责：

~~~text
semantic relevance
→ sourceId + snippet
~~~

完整业务实体由对应 Domain 提供：

~~~text
MemoryService
→ recordId

RecordRepository
→ full Record
~~~

这样未来 Creation Memory / Conversation Memory 也可以复用同一 Memory Core。

---

## 21. 为未来多 Source 留边界

当前只实现：

~~~ts
MemorySourceType = "record"
~~~

未来可以扩展：

~~~text
record
creation
conversation_summary
~~~

本轮不实现后两者，不建立统一业务实体，也不增加泛化 HTTP。

---

## 22. PostgreSQL / pgvector 迁移路径

完成本轮后，MemoryService、Record integration、Search HTTP、Agent Tool 都不依赖 SQLite。

未来主要替换：

~~~text
SqliteVecMemoryIndex
        ↓
PgVectorMemoryIndex
~~~

Memory Core 不变。

Postgres 初期建议优先：

~~~text
user_id 普通索引
+
pgvector exact search
~~~

查询语义：

~~~sql
WHERE user_id = $1
ORDER BY embedding <=> $2
LIMIT $3
~~~

单用户向量量还有限时，不急于 HNSW。真正需要 ANN 后再单独设计 filtered ANN / partition 策略。

---

## 23. 目录目标

~~~text
apps/server/src/
├── domain/
│   └── memory/
│       ├── model.ts
│       ├── embedding-provider.ts
│       ├── memory-index.ts
│       ├── record-memory.ts
│       └── memory-service.ts
│
├── infrastructure/
│   ├── clients/
│   │   └── embeddings-client.ts
│   └── memory/
│       └── sqlite-vec-memory-index.ts
│
├── listeners/
│   └── record-postprocess.listener.ts
│
└── routes/
    └── records.ts
~~~

不要为了“三层”额外增加 application/services/repositories/adapters 等目录。三层是职责边界，不是目录形式主义。

---

## 24. 测试分层

### Memory Core

建议：

~~~text
domain/memory/record-memory.test.ts
domain/memory/memory-service.test.ts
~~~

使用 fake MemoryIndex / EmbeddingProvider。

验证：

- content builder；
- 空内容；
- hash dedupe；
- hash 相同时不重复 embedding；
- replace；
- remove；
- search；
- userId 传递。

### Sqlite Adapter

建议：

~~~text
infrastructure/memory/sqlite-vec-memory-index.test.ts
~~~

真实 SQLite + sqlite-vec：

- partition；
- user-scoped KNN；
- replace；
- remove；
- KNN 顺序；
- metadata ownership。

核心 case：

~~~text
u1 B distance=0.14
u2 C distance=0.01

search(user=u1)
必须返回 B
不能返回 C
~~~

### Record Integration

验证：

~~~text
completePostprocess
→ processed Record
→ listener calls memory.replaceRecord
~~~

stale task 不写 Memory。

### HTTP

POST /api/records/search：

- normal；
- empty query；
- invalid limit；
- no result；
- user isolation；
- Memory error。

### Rebuild

多用户 rebuild 后，每个用户只可检索自己的 Record。

---

## 25. 文档影响（实施完成后）

按当前新文档架构，代码真正落地后做 Documentation Impact Review。

候选 Current Docs：

~~~text
docs/domain/memory.md
docs/domain/records.md
docs/architecture/server.md
docs/api/http-api.md
docs/engineering/testing.md
docs/engineering/local-development.md
~~~

如果 Search HTTP 真正注册：

~~~text
docs/product/current-scope.md
~~~

也应更新。

PLAN 描述未来设计；Current Docs 只在代码落地后更新。

---

## 26. 与 Agent Tools PLAN 的关系

现有 plan/2026-09-18-agent-record-tools-oss-region 中的 record_search 依赖本方案最终提供：

~~~text
POST /api/records/search
~~~

依赖方向：

~~~mermaid
flowchart LR
  A[Agent record_search Tool]
  H[POST /api/records/search]
  M[MemoryService]
  P[MemoryIndex Port]
  S[SqliteVecMemoryIndex]

  A --> H
  H --> M
  M --> P
  P --> S
~~~

Agent Runtime 不依赖 MemoryIndex / sqlite-vec / DB。

---

## 27. 明确不做

- 独立 Memory 微服务；
- 独立 Memory DB；
- memories 业务表；
- Generic VectorStore Framework；
- Creation vector；
- Conversation vector；
- hybrid search；
- BM25；
- reranker；
- HNSW；
- 独立 Vector DB；
- PostgreSQL 迁移；
- Record delete；
- 用户排除 Memory UI；
- durable retry queue。

---

## 28. 实施顺序

### Phase 1：Memory Core

- model；
- ports；
- record document builder；
- MemoryService；
- fake tests。

### Phase 2：Sqlite Adapter

- SqliteVecMemoryIndex；
- user partition；
- replace / remove / search；
- adapter tests。

### Phase 3：Record Integration

- completePostprocess 返回 processed Record；
- listener 调 MemoryService.replaceRecord；
- Memory 不再反查 Record。

### Phase 4：Search HTTP

- POST /api/records/search；
- HTTP tests。

### Phase 5：Rebuild

- 全用户 scan；
- reset；
- 统一走 MemoryService；
- 多用户验证。

### Phase 6：Docs / Regression

- Server typecheck；
- tests；
- Current Docs impact review。

---

## 29. Definition of Done

- [ ] Memory 形成独立 Domain 模块
- [ ] Memory Core 不依赖 Kysely / SQLite / AppConfig
- [ ] Embedding 通过 EmbeddingProvider
- [ ] 向量存储通过 MemoryIndex
- [ ] sqlite-vec 实现位于 infrastructure/memory
- [ ] record_vectors.user_id TEXT PARTITION KEY
- [ ] KNN 从一开始限定当前用户
- [ ] 不再使用 limit * 4
- [ ] Record postprocess 把 completed Record 直接交给 Memory
- [ ] Memory 不再自行查询 records 表
- [ ] MemoryService 提供 replaceRecord / removeRecord / searchRecords
- [ ] POST /api/records/search 可用
- [ ] HTTP userId 只来自 header
- [ ] Memory 失败不回滚已成功 processed 的 Record
- [ ] rebuild 覆盖所有用户
- [ ] rebuild 复用 MemoryService
- [ ] 多用户隔离与召回测试通过
- [ ] Server typecheck / tests 通过
- [ ] 实施后按新 docs 架构完成 Documentation Impact Review

---

## 30. 最终目标架构

~~~mermaid
flowchart TB
  R[Record Domain]
  L[Record Postprocess Listener]

  subgraph M[Memory Module]
    RM[Record Memory Builder]
    MS[MemoryService]
    EP[EmbeddingProvider Port]
    MI[MemoryIndex Port]
  end

  EC[EmbeddingsClient]
  SI[SqliteVecMemoryIndex]
  DB[(SQLite / sqlite-vec)]
  HTTP[POST /api/records/search]

  R --> L
  L -->|processed Record| MS
  MS --> RM
  MS --> EP
  MS --> MI

  EP --> EC
  MI --> SI
  SI --> DB

  HTTP --> MS
~~~

核心不是“把 vector 代码拆几个文件”，而是建立稳定边界：

> Record 提供事实，Memory 负责把事实变成可重新找到的长期上下文，sqlite-vec 只是 Memory 的当前实现。

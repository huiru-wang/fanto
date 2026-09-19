# Fanto 10,000 用户首年容量规划

## 目标

以 **10,000 注册用户** 作为首年云资源容量规划基准。该规划用于云服务申请与初始资源配置，不代表必须一次性预购全部容量；优先选择可在线扩容的服务规格。

## 核心假设

- 注册用户：10,000
- MAU：约 3,000
- 峰值 DAU：约 1,000
- 活跃用户平均：30 条 Record / 月，约 360 条 / 年
- Record 中约 40% 含图片或音频
- Memory 按 `record_text / image / audio` 原子单元独立索引
- 当前 Embedding：768 维
- 媒体二进制存 OSS，不进入关系数据库
- 图片生产环境应压缩后上传，容量估算按平均约 1.5 MB / 张，而不是接口 50 MB 上限

## 容量结论

| 指标 | 首年申请 / 设计值 | 说明 |
| --- | ---: | --- |
| 注册用户 | 10,000 | 固定规划口径 |
| MAU | 3,000 | 约 30% |
| 峰值 DAU | 1,000 | 用于 QPS / 并发估算 |
| Business 关系库 | **100 GB** | User、Record、Media metadata、Creation / Proposal 等 |
| Agent Session 数据 | **50 GB** | 对话、Tool Call / Result、Task 等 |
| 向量容量 | **50 GB** | 768 维，目标支撑约 200 万级 vectors |
| OSS 对象存储 | **2 TB** | 图片 / 音频为首年主要存储成本 |
| OSS 可扩容目标 | **5 TB+** | 媒体量增长时直接扩容 |
| Business API 峰值 QPS | **50 QPS** | 第一阶段留有较大余量 |
| Record Search 峰值 QPS | **20 QPS** | 语义检索 |
| Record 写入峰值 QPS | **10 QPS** | Record 创建 / 更新 |
| Agent 请求峰值 | **20 QPS** | 请求启动量，不代表模型 token 吞吐 |
| Agent 并发 Run | **100** | 比 Agent QPS 更重要 |
| SSE 长连接 | **200** | 对话流式连接容量 |
| Postprocess 并发 | **10** | Vision / ASR / Embedding 总体控制 |
| 服务端公网带宽 | **50 Mbps** | 媒体使用 OSS 直传后足够 |

## 存储拆分

### 关系数据库

第一年实际业务数据预计在 **10～30 GB** 量级，申请 **100 GB** 主要用于：

- Record 与 content JSON
- Media metadata
- User / Identity
- Creation / Proposal / Relation
- 数据库索引、膨胀与运维余量

如果未来迁移 PostgreSQL，首年不需要按大规模分库分表设计。

### 向量数据

当前向量为 **768 维 float32**：

```text
768 × 4 bytes ≈ 3 KB / vector
```

包含 metadata、索引与存储开销后，可按 **5～8 KB / vector** 估算。

10,000 注册用户、约 3,000 MAU 的首年目标下，预计约 **100～200 万向量以内**，因此 **50 GB** 足够，并保留明显余量。

首年没有必要为向量检索单独建设复杂的分布式基础设施。

### OSS

媒体是首年容量最大项。

按活跃用户约 **250 MB / 年** 媒体数据估算：

```text
3,000 活跃用户 × 250 MB ≈ 750 GB
```

考虑增长、重复上传、图片数量差异和运营测试，首年按 **2 TB** 申请，并保证可以扩到 **5 TB+**。

## 初期基础设施建议

首年优先保持简单：

```text
Application Server
├── Business Server
└── Agent Runtime

Managed PostgreSQL / RDS
├── Business Data
├── Agent Session Data
└── Vector Data（如果使用 pgvector）

OSS
└── Image / Audio
```

不要求一开始就拆成三个独立数据库服务。若继续使用独立向量服务，也只需按 **50 GB / 20 QPS / 200 万 vectors** 申请。

## 需要重点监控的指标

上线后优先监控：

1. DAU / MAU
2. Record 新增量 / 日
3. 图片、音频平均大小与 OSS 日增量
4. vectors 总量与日增量
5. Record Search P95 / P99 latency
6. Business API Peak QPS
7. Agent concurrent runs / SSE connections
8. Vision / ASR / Embedding 队列长度与失败率
9. LLM / Vision / ASR / Embedding 实际调用成本

当任一指标达到当前规划的 **60%～70%** 时重新做容量评估，而不是等资源接近耗尽再扩容。

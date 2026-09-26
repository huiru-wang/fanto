# iOS Record 连续时间线重构

日期：2026-09-27

## 目标

把 Record 页从“日历选中某一天 -> 只展示当天记录”的筛选模式，重构为“日历负责定位、时间线负责连续浏览”的模式。

最终体验：

- 进入 Record 页默认从最近一条记录开始。
- 所有记录按 `eventAt` 倒序组成一条连续时间线，可持续向下加载直到最早记录。
- 时间线按“有记录的自然日”分组，不展示空日期。
- 当前日期分组标题吸顶；下一日期标题到达时自然将上一标题顶走。
- 顶部日历不再限制 Timeline 数据范围，选择日期只负责跳转到该日期附近。
- 日历与时间线共享“当前浏览日期”，滚动和日历跳转保持同步。

## 当前实现

已确认当前代码：

- `RecordsView.swift`
  - `selectedDate` 是页面核心状态。
  - `store.records` 会先按 `selectedDate` 过滤，只把当天记录传给 Timeline。
  - 日历和 Timeline 位于同一个 `ScrollView`。
- `RecordTimelineView.swift`
  - 只渲染单日标题 + 单日记录。
  - 无日期分组、无 sticky section header、无继续加载。
- `RecordCalendarView.swift`
  - 周历 / 月历共用 `selectedDate`。
  - 选择日期目前直接改变筛选日期。
- `FantoStore.loadRecords()`
  - 只请求一次第一页并覆盖 `records`。
- `CreationAPIClient.fetchRecords()`
  - 固定请求 `GET /api/records?limit=100`。
  - 已解析 `hasMore / nextCursor`，但没有继续分页能力。
- Server `GET /api/records`
  - 已支持 cursor pagination。
  - 排序稳定为 `event_at DESC, record_id DESC`。
  - cursor 表示“继续读取比当前最后一条更早的记录”。

因此，“从最新一直滚到最早”不需要重做 Server 分页协议；主要缺口在 iOS 分页状态、Timeline 分组和滚动联动。

## 页面结构

重构后页面分为两个职责明确的区域：

```text
RecordsView
├── Calendar / Navigation Area
│   ├── 当前年月 / 日期入口
│   ├── 周历 / 月历
│   └── 新建记录
└── Continuous Timeline
    ├── Sticky Date Header
    ├── 当日 Records
    ├── Sticky Date Header
    ├── 当日 Records
    └── Load More Trigger
```

### 1. Calendar / Navigation Area

日历从“筛选器”变为“时间线导航器”。

行为：

- 日历点击某一天：请求并定位到该日期附近，而不是把 Timeline 过滤成当天。
- 周 / 月切换逻辑继续复用现有实现。
- 有记录标记仍来自已知 Record 数据；不要求本次重构额外实现全年统计接口。
- 当前浏览日期变化时，日历 selection 同步更新，但这种同步不能反向触发新的跳转请求。

需要区分两个动作来源：

- `userSelectedDate`：用户主动点击日历，需要执行 Timeline 定位。
- `visibleDateChanged`：用户滚动 Timeline 导致当前日期改变，只同步日历状态。

避免“滚动 -> selection 改变 -> 又触发 jump”的循环。

### 2. Continuous Timeline

Timeline 不再接收单个 `date + records`，而是接收完整已加载记录集合。

按自然日分组：

```text
今天 · 9月27日
  18:40 ...
  09:12 ...

昨天 · 9月26日
  21:06 ...

9月24日 · 周四
  15:32 ...
  10:21 ...
```

规则：

- 日期组按日期倒序。
- 组内 Record 按 `eventAt` 倒序。
- 没有 Record 的日期不生成 Section。
- Timeline 最末尾根据分页状态显示：
  - 正在加载；
  - 可继续触发下一页；
  - 已到最早记录；
  - 加载失败 + 重试。

## Sticky Date Header

使用 SwiftUI 原生 Section Header + pinned header 实现，不自行计算悬浮位置。

推荐结构：

```swift
LazyVStack(
    alignment: .leading,
    spacing: 0,
    pinnedViews: [.sectionHeaders]
) {
    ForEach(dayGroups) { group in
        Section {
            ...
        } header: {
            TimelineDateHeader(date: group.date)
        }
    }
}
```

期望交互：

1. 当前日期 Header 到达 Timeline 顶部后吸顶。
2. 下一有记录日期 Header 上移。
3. 下一 Header 到顶时把当前 Header 自然顶走。
4. Header 切换后更新页面的 `visibleDate`。

视觉继续沿用当前 `ChineseDateText.timelineTitle(date)`，本次不重新设计 Record Row。

## 页面状态模型

当前单一 `selectedDate` 需要拆分语义：

```text
calendarDate
  日历当前选中 / 展示的日期

visibleDate
  Timeline 当前吸顶日期

scrollTarget
  一次性的程序化定位目标
```

正常状态：

```text
Timeline 滚动
→ visibleDate 改变
→ calendarDate 同步
→ 不触发重新加载
```

用户点击日历：

```text
用户选择 date
→ calendarDate = date
→ 定位 Timeline 到 date
→ 定位完成后由实际可见 section 决定 visibleDate
```

如果目标日期没有记录：

- 定位到该日期之前最近的有记录日期；
- 不创建空日期 Section；
- 日历可同步到最终实际可见日期。

## 数据分页

### Store

把 Record 加载状态从“一次性列表加载”改为可分页 Timeline 状态。

建议至少持有：

```text
records
nextCursor
hasMore
isLoadingMore
recordLoadState
```

接口职责：

```text
loadRecords()
  首次 / 下拉刷新
  清空 cursor，从最新一页重新加载

loadMoreRecords()
  使用 nextCursor 读取更早一页
  append + 去重 + 排序

loadRecords(before:)
  日历跨历史跳转时，从指定日期附近重新建立 Timeline 窗口
```

合并规则：

- 以 Record ID 去重。
- 最终始终按 `eventAt DESC, id DESC` 保持稳定顺序。
- `loadMoreRecords()` 必须防止并发重复请求。
- `hasMore == false` 后不再继续请求。

### 页面触发加载

不要依赖“最后一条 Record 精确出现”作为唯一触发点。

在 Timeline 尾部放置明确的 load-more sentinel：

```text
最后一个 Section
↓
LoadMoreTrigger.onAppear
↓
store.loadMoreRecords()
```

Store 自身负责幂等防重。

初始 page size 建议 30～50 条；不再固定一次请求 100 条。具体值可在实现时根据 Row 媒体加载体验选择，默认先用 30。

## 日历跳转到历史日期

当前 Server cursor 只能表达“从某一条 Record 之后继续向更早读取”，客户端不能可靠地凭日期自行构造合法 cursor。

为避免用户点击一年前日期时从最新记录连续翻数百页，本次需要给 Record List 增加一个最小的日期锚点能力。

建议扩展：

```http
GET /api/records?limit=30&before=2026-09-28T00:00:00+08:00
```

语义：

- 返回 `event_at < before` 的第一批记录；
- 排序仍为 `event_at DESC, record_id DESC`；
- 返回格式继续沿用现有 `data / hasMore / nextCursor / pageSize`；
- 后续继续用 `nextCursor` 向更早分页；
- `cursor` 与 `before` 不允许同时出现，冲突返回 400。

选择 9 月 27 日时，客户端传该用户当前 Calendar 下“9 月 28 日 00:00”的 ISO 时间，即可得到 9 月 27 日及更早记录。

这样：

- 有当天记录：Timeline 从当天最近记录开始。
- 当天无记录：自然落到更早的最近一个有记录日期。
- 不需要新增“按天查询”接口。
- 不改变 cursor 的稳定分页逻辑。

### 本次范围内的跳转语义

从最新入口进入时：

```text
最新 → 持续向下 → 最早
```

从日历跳到历史日期时：

```text
目标日期附近 → 持续向下 → 更早 → 最早
```

本次不实现“跳到历史日期后继续向上无限加载更新记录”的双向分页。

如果用户要回到最新记录：

- 提供日历选择“今天”或现有日期导航回到今天；
- 重新建立从最新 Record 开始的 Timeline。

这是为了保持首版数据流单向、可验证，不引入双 cursor 和复杂滚动位置恢复。

## Refresh 行为

下拉刷新语义保持简单：

```text
refresh
→ 重新请求最新第一页
→ 重建 Timeline
→ 回到最新记录区域
```

不要把 refresh 与 `loadMore` 混用。

若当前处在历史跳转窗口，下拉刷新也回到最新 Timeline；这与“查看有没有新记录”的用户预期一致。

## 新建 Record 后

当前 Composer 保存仍只写本地 Store，本次不扩展 Server Create 能力。

保存新 Record 后：

- Record 插入 `records`；
- 按 `eventAt` 重新排序；
- 若新 Record 日期属于当前 Timeline 窗口，自动进入对应日期 Section；
- Composer 已有的日期回调不再承担“筛选当天”的职责，只用于必要的 Timeline 定位。

如果用户创建的是“今天”的新记录，建议回到最新位置；如果创建的是历史日期，则定位到对应日期 Section。

## 预计修改范围

### iOS

重点文件：

- `apps/ios/fanto/fanto/Records/RecordsView.swift`
  - 去掉按 `selectedDate` 过滤 Record。
  - 管理 calendar / visible / scroll target 联动。
  - Calendar 与 Timeline 拆分职责。
- `apps/ios/fanto/fanto/Records/RecordTimelineView.swift`
  - 从单日 Timeline 改为分组 Continuous Timeline。
  - Section sticky header。
  - load-more sentinel。
- `apps/ios/fanto/fanto/Records/RecordCalendarView.swift`
  - selection 保留，但点击回调语义改为“导航”。
  - 防止 Timeline 同步 selection 时产生重复导航。
- `apps/ios/fanto/fanto/Store/FantoStore.swift`
  - 保存 `nextCursor / hasMore / loadingMore`。
  - 增加首次加载、继续加载、日期锚点加载。
- `apps/ios/fanto/fanto/Networking/CreationAPIClient.swift`
  - `fetchRecords(limit:cursor:before:)`。
- 可新增：
  - `TimelineDayGroup.swift`
  - `TimelineDateHeader.swift`

不要为了本次重构拆新的 Repository / ViewModel 层。

### Server

- `apps/server/src/routes/records.ts`
  - GET list 增加可选 `before`。
  - 校验 `before` 为合法带 offset datetime。
  - 拒绝 `cursor + before` 同时使用。
- `apps/server/src/domain/records/repository.ts`
  - list opts 增加可选日期上界。
- `apps/server/src/domain/records/postgres-repository.ts`
  - 无 cursor 且有 before 时增加 `event_at < before`。
  - 原排序和 cursor 行为保持不变。
- 对应 Server tests。

## 明确不做

本次不做：

- 双向无限滚动。
- 全量预加载历史 Record。
- 新的 Calendar 统计 / 按月聚合接口。
- 空日期占位。
- Record Row 视觉重设计。
- Record Create 服务端接入。
- 搜索、按标签过滤等额外能力。
- 修改 Record / Media 数据模型。
- 修改现有 cursor 编码格式。

## 边界与异常

### 1. 用户没有任何 Record

Timeline 显示全局空态：

```text
还没有记录
```

日历仍可正常显示，新建按钮可用。

### 2. 某天没有 Record

不展示空 Section。

从日历跳过去时落到该日期之前最近的 Record；若之前也无任何记录，则显示已到最早 / 空态。

### 3. 加载下一页失败

已加载内容保留，不回退整个页面到 error screen。

Timeline 尾部展示局部错误和“重试”。

### 4. 首屏加载失败

仍使用当前页面级错误状态和重新加载按钮。

### 5. 同一时间的多条 Record

依赖 Server 已有：

```text
event_at DESC
record_id DESC
```

保证分页边界稳定；客户端去重作为额外保护。

### 6. 时区

日期分组以 iOS 当前 `Calendar.current` / 用户本地时区解释 `eventAt`。

日历跳转的 `before` 必须发送“目标日期下一天本地 00:00”对应的带 offset ISO 时间，不能直接拼 UTC 日期，避免跨时区遗漏当天记录。

## 验证

### Server

至少覆盖：

1. 无 cursor / before：仍返回最新一页。
2. `before`：只返回日期上界之前的 Record。
3. `before` 后的 `nextCursor` 可以继续稳定向更早分页。
4. `cursor + before` 返回 400。
5. 非法 `before` 返回 400。
6. 相同 `eventAt` 多条 Record 不重复、不遗漏。
7. 用户隔离不受影响。

### iOS Store / Client

至少验证：

1. 首次加载保存 `nextCursor / hasMore`。
2. load more 追加而不是覆盖。
3. 连续触发 load more 不产生重复请求。
4. Record ID 去重。
5. refresh 重建最新 Timeline。
6. before 跳转请求正确编码用户本地日期边界。

### UI 手工验收

准备跨多个非连续日期的数据，例如：

```text
9/27 2条
9/26 1条
9/25 0条
9/24 2条
8/03 1条
```

检查：

1. 打开页面默认看到最新 Record。
2. 向下滚动依次看到 9/27 → 9/26 → 9/24，不出现 9/25 空组。
3. 日期 Header 吸顶。
4. 9/26 Header 到顶部时自然顶走 9/27。
5. 滚到分页边界自动加载更早 Record，没有明显跳动。
6. 一直滚到最早 Record 后不再请求。
7. 日历选择 8/03 后直接定位到 8/03 附近，不需要加载中间全部历史。
8. 选择没有记录的日期时落到更早的最近有记录日期。
9. Timeline 滚动导致日历日期同步，但不会反复触发网络跳转。
10. 下拉刷新回到最新 Timeline。
11. 图片 / 音频 Record 的现有展示和播放能力不回归。

## 实施顺序

1. Server list 增加 `before` 日期锚点并补测试。
2. iOS Client 把 Record list 改成 cursor / before 参数化请求。
3. FantoStore 增加分页状态和 `loadMoreRecords`。
4. RecordTimelineView 改成按日期 Section 分组 + sticky header。
5. RecordsView 去掉单日过滤，接入连续 Timeline。
6. 接入 load-more sentinel。
7. 将 Calendar selection 从“过滤”改成“导航”，完成 visible date 单向同步。
8. 验证刷新、新建记录、媒体、空态、失败态。
9. 实现完成后再根据最终代码刷新 Current Docs；Plan 本身不作为 Current State。

## 完成标准

满足以下条件即可认为本次重构完成：

- Record 页不再受日历选中日限制。
- 从最新记录可以连续滚动到最早记录。
- Timeline 只按有记录日期分组。
- 日期 Header 具备自然 push-off sticky 行为。
- 滚动过程中的当前日期与日历状态同步。
- 日历可直接跳到较早日期，不需要预加载全部中间历史。
- cursor 分页无重复、无遗漏，失败可局部重试。
- 不破坏现有 Record 媒体展示、新建 Composer 与用户隔离。

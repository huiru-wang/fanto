# Record 地点行政区语义优化方案

## 目标

让 Record 的地点同时保留用户可读的地点本体、结构化行政区和 WGS-84 坐标。Agent 上下文与地点记忆使用完整语义地点，避免只有 POI 名称而无法判断城市和国家。

目标示例：

```json
{
  "type": "location",
  "name": "万科·金草公寓",
  "countryCode": "CN",
  "country": "中国",
  "province": "浙江省",
  "city": "杭州市",
  "district": "上城区",
  "latitude": 30.311147,
  "longitude": 120.214973
}
```

对应的上下文与向量索引文本为：

```text
地点：中国 浙江省 杭州市 上城区 万科·金草公寓
```

## 已验证现状

- `LocationContentBlock` 只有 `name`、`latitude`、`longitude`。
- iOS 自动定位、搜索结果和地图选点分别优先使用 `CLPlacemark.name` 或 `MKMapItem.name`，会只保存 POI 名称。
- Server 将 location block 原样存入 `records.content`，并把经纬度投影到 `records.location_latitude` / `records.location_longitude`；地图投影无需变化。
- Memory 和 Agent Record 摘要目前均使用 `地点：<name>`。

## 数据契约

地点 block 采用平铺字段，不增加 `administrativeArea` 嵌套对象：

```ts
type LocationContentBlock = {
  type: "location";
  name: string;
  countryCode?: string;
  country?: string;
  province?: string;
  city?: string;
  district?: string;
  latitude: number;
  longitude: number;
};
```

字段语义：

- `name`：POI、建筑物、街道或用户选中的地点本体；不重复拼入行政区。
- `countryCode`：ISO 3166-1 alpha-2 大写代码，例如 `CN`、`FR`、`US`，作为跨语言、跨供应商的稳定国家标识。
- `country`：当前设备语言下的国家展示名。
- `province`：一级行政区。海外可承载 state、province、region 等等价层级。
- `city`：城市或 locality。
- `district`：区、县、arrondissement、borough 或其他较细 locality；无法可靠取得时省略。
- 坐标继续为必填 WGS-84 值，服务端规范化到六位小数。

`name`、坐标维持必填；行政区字段均可选。字段存在时，`countryCode` 必须是两个 ASCII 字母并规范化为大写，其余字段 trim 后为 1–100 字。API、shared schema、Server 输入校验、iOS 解码使用同一可选字段约定。旧 location block 合法且不做数据库迁移。

## 客户端采集与展示

抽出一个纯 Swift `RecordLocationFormatter`，作为三条采集路径唯一的 location block 生产者：

1. 自动定位：使用 `CLGeocoder` 的 `CLPlacemark`。
2. 搜索结果：使用 `MKMapItem.placemark` 与 `MKMapItem.name`。
3. 地图选点：对点选坐标反向地理编码后使用 `CLPlacemark`。

映射规则：

| Record 字段 | Apple 来源 | 回退 |
| --- | --- | --- |
| `countryCode` | `isoCountryCode` | 缺失则省略 |
| `country` | `country` | 缺失则省略 |
| `province` | `administrativeArea` | 缺失则省略 |
| `city` | `locality` | `subAdministrativeArea` |
| `district` | `subLocality` | 缺失则省略 |
| `name` | POI 搜索优先 `MKMapItem.name`；其余取 `placemark.name` | `地图选点` / `当前位置` |

保存前对显示文本 trim、去除空字段。行政区只逐字段保存一次，不把它们合并进 `name`。编辑器的主标题继续显示 `name`，副标题按 country → province → city → district 展示；新建 Record 页底部地点卡维持同样的主副层级，坐标保留在第三行供确认，不提供手工坐标输入。

## 服务端、上下文与记忆

Server 接受、校验、规范化并原样写入行政区字段。`records` 表不新增行政区列：它们属于 Record 内容事实，当前没有按行政区筛选或聚合的接口；现有经纬度投影继续只服务未来地图能力。

新增唯一的 TypeScript 格式化函数 `formatLocationContext(block)`：按 `country`、`province`、`city`、`district`、`name` 收集非空值，去除相邻重复项，并生成 `地点：<joined values>`。它用于：

- `buildRecordMemoryDocuments` 的 `record_location` embedding 文本；
- Agent recent-memory 摘要；
- Record Tool 的详情与搜索预览。

不会把精确坐标写入 Agent 上下文或 embedding 文本。坐标保留在 Record 事实中供地图使用，避免无意义的数值噪声与额外位置暴露。

## 兼容、历史数据与发布

新字段全是 optional，因此 Server 先发布后，旧 iOS、既有 Record、历史备份和旧 API 调用继续工作。iOS 新版本随后开始采集结构化行政区。

已有 Record 不应通过服务端自动反向地理编码回填：这会引入新的第三方地理服务、成本和额外位置数据传输。旧 block 继续只以 `name` 提供上下文；用户下次编辑地点时再用 iOS 本地地理编码写入完整字段。若未来确需批量补齐，应单独评估全球地理服务、限速、隐私告知、失败重试和可审计回填任务。

本变更不增加世界地图接口、范围检索或 marker 聚类策略。

## 验证标准

- 中国 POI 保存的 block 包含 `CN`、中国、省、市、区和 POI 名称；上下文含完整层级。
- 海外 POI 可保存国家代码与可取得的行政层级；缺失层级不会生成空格、重复词或保存失败。
- 自动定位、搜索选点、地图点选得到一致的字段形态。
- 无行政区的旧 location block 可读取、更新、索引并生成 `地点：<name>`。
- 经纬度的数据库投影、用户隔离、Record 乐观并发和现有地图索引行为不变。

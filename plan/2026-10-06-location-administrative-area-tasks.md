# Record 地点行政区语义优化执行任务

关联方案：[地点行政区语义优化方案](2026-10-06-location-administrative-area-design.md)。

1. **扩展共享地点契约**
   - 在 `packages/shared/src/record-content.ts` 为 location block 加入可选行政区字段。
   - 保持旧 block 可解析，更新 shared 类型检查。

2. **扩展 Server 保存校验与规范化**
   - 在 `apps/server/src/domain/records/content.ts` 校验 `countryCode` 和各行政区展示字段。
   - 在 Record repository 的 `normalizedLocation` 中 trim、规范化国家代码并省略空字段。
   - 保持创建、更新、省略 location 保留、显式 `null` 删除的现有语义。

3. **在 iOS 建立统一地点格式化器**
   - 新增纯 Swift formatter，将 `CLPlacemark` / POI 名称转换成 `RecordLocation`。
   - 明确定义 `subAdministrativeArea` 和 `subLocality` 的城市、区回退规则。
   - 让自动定位、搜索结果和地图选点都调用该 formatter。

4. **更新 iOS 模型与 API 编解码**
   - 为 `RecordLocation` 增加可选行政区字段。
   - 更新 Record 读取解析和创建 / 更新请求体，确保字段端到端保留。
   - 旧响应缺少行政区字段时保持兼容。

5. **调整地点编辑与新建 Record 展示**
   - 搜索结果和已选地点展示 POI 主标题及完整行政区副标题。
   - 新建编辑器底部地点卡展示同样的层级和坐标；仍只通过搜索、地图或当前位置选取。
   - 处理逆地理编码返回不完整行政区、无 POI 名称和无网络回退。

6. **统一生成 Agent 与 Memory 地点语义**
   - 在 Server 新增 `formatLocationContext`，按固定顺序拼接非空层级并去除相邻重复。
   - 接入向量记忆、recent-memory、Record Tool 预览和详情，杜绝各处自行拼接。
   - 坐标不进入 Agent 上下文与 embedding 文本。

7. **补充测试**
   - Server：输入验证、国家代码规范化、完整中国地点、海外不完整地点、旧 block 兼容。
   - Server：Memory 与 Agent 上下文的地点文本格式。
   - iOS：formatter 的中国、海外、缺失层级和搜索 POI 优先级单元测试；运行 Simulator 验证自动定位、搜索、地图选点与保存请求。

8. **更新 Current Docs 与发布**
   - 更新 `docs/domain/records.md`、`docs/domain/memory.md`、`docs/api/http-api.md`、`docs/clients/ios.md` 及 iOS 局部 `AGENTS.md`。
   - 先发布 Server，再发布 iOS；不需要新的数据库 migration。
   - 发布后用中国和海外地点分别创建 Record，核对持久化 block、地图坐标投影和 Agent 上下文。

9. **处理历史 Record 的边界**
   - 保持旧地点记录可用，未含行政区时继续仅使用 `name`。
   - 不在本次发布中调用外部地理服务批量回填；如需回填，另立任务评估供应商、成本、用户告知、限速和失败恢复。

# Fanto iOS：Records 与 Creations 体验实施任务

> 本清单是实施拆解，不授权直接改动现有 iOS 代码；需先确认 iOS 交互层约定和后端 Creation API。

1. 确认从“回声 / Topic”迁移到“Creation”的文案，以及三种 type 的本地化名称。
2. 定义有序 `CreationSection[]` 接口：section 顺序、type、标题、卡片摘要、稳定 ID、后端权威排序、分页和未知 type 降级。
3. 建立 `selectedDate`、week anchor、month anchor 的单一状态模型，并定义按日期查询/定位契约。
4. 实现并验证一行周日历：相邻周横向切换、日期选择、记录点和“今天”。
5. 实现月历展开层：上月/下月、选日回到相应周、Dynamic Type 适配和状态恢复。
6. 调整 Timeline Record 行，支持文本、语音播放/转写、左对齐图片、完整时间和可选简化位置。
7. 定义 Composer 的草稿、媒体、录音、位置、保存、失败恢复状态，以及权限/上传契约。
8. 在仓库约定更新后，实现双目的地导航和全局 `+`；为 iOS 17–25 使用 Material 回退，为更高版本验证系统 Liquid Glass。
9. 实现 type section 与横向卡片轨道，严格保留后端顺序、加载状态和整体空态。
10. 测试日历、Composer、横向卡片的快速操作、拖动中断、反向手势、后台切回和失败状态。
11. 在 VoiceOver、最大 Dynamic Type、深色模式、Reduce Motion、Reduce Transparency、Increase Contrast 下验证主流程。

## 完成定义

- 不出现选中日期、月份标题与 Timeline 内容不一致。
- 保存失败不丢失用户输入或附件引用。
- Creation UI 不私自重排后端数据，也不丢弃未知 type。
- `+`、月历展开、横向卡片快速连续操作下不存在不可关闭或重叠状态。

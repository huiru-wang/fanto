# Fanto IP Assets

Fanto 是 Agent 对外的角色形象。本目录是 **IP 视觉资产的 canonical source**，App 内部不要直接从根 `public/` 临时取图。

## 第一阶段资产

### 1. Avatar

`avatar/`：Agent 头像，透明 PNG。

- `avatar-master-1024.png`
- `avatar-512.png`
- `avatar-256.png`
- `avatar-128.png`
- `avatar-64.png`

头像采用更紧凑的头部 / 上半身构图，适合聊天消息、会话列表、通知和设置页。

### 2. Agent states

`states/`：六个基础状态，1024×1024 透明 PNG。

| State | 语义 | 推荐使用场景 |
| --- | --- | --- |
| `idle` | 普通 / 等待 | 静止展示、欢迎页 |
| `thinking` | 思考 / 探索 | Agent 正在处理问题 |
| `remembering` | 产生关联 | 记忆关联、旧记录浮现 |
| `creating` | 编织 / 创作 | Creation、整理、生成 |
| `reminding` | 提醒 | 主动提醒、通知 |
| `done` | 完成 | 任务完成、内容生成完成 |

首版采用“静态 PNG + 代码微动效”，不使用 GIF。建议动画幅度保持轻微：上下 1–3 px、旋转 ±1–2°、scale 1.00–1.015。

### 3. Props

`props/`：独立透明 PNG，可与角色组合。

- `note`：记录 / 便签
- `bell`：提醒
- `magnifier`：探索 / 研究
- `calendar`：日期 / 日历
- `photo`：图片 / 记忆
- `thread-ball`：线团 / 编织 / Creation

道具不和角色绑定，后续增加 Agent 能力时优先增加道具而不是复制整套角色。

### 4. Fanto Line

`line/`：Fanto 的线条视觉与动效规范。线条属于 UI Primitive，运行时应由 SwiftUI Path / Web SVG 绘制，不做成固定 PNG。

见 `line/line-motion.md` 和 `line/line-sample.svg`。

## 目录

```text
assets/fanto/
  README.md
  avatar/
  character/
  states/
  props/
  references/
  line/
  tools/
```

- `character/`：当前标准角色主体。
- `references/`：Default / Dark / Tinted 等设计参考，不代表 App 内需要三套角色。
- `tools/generate_assets.py`：从现有透明角色图重新生成 canonical 和 runtime 资产。

## Runtime 导出

生成脚本同时导出两套运行时资源：

### H5

```text
apps/h5/public/assets/fanto/
  manifest.json
  avatar/
  states/
  props/
```

路径可以直接由浏览器使用，例如：

```text
/assets/fanto/avatar/fanto-avatar-512.png
/assets/fanto/states/thinking.png
/assets/fanto/props/thread-ball.png
```

### iOS

生成到 `apps/ios/fanto/fanto/Assets.xcassets/`：

```text
FantoAvatar.imageset
FantoStateIdle.imageset
FantoStateThinking.imageset
...
FantoPropNote.imageset
FantoPropBell.imageset
...
```

SwiftUI 中可直接使用：

```swift
Image("FantoAvatar")
Image("FantoStateThinking")
Image("FantoPropThreadBall")
```

## 重新生成

依赖 Python 3 + Pillow：

```bash
python3 assets/fanto/tools/generate_assets.py
```

输入源目前为：

```text
public/app-icon-default-1024_transparent.png
public/app-icon-dark-1024_transparent.png
public/app-icon-tinted-1024_transparent.png
```

## 约束

- App 内角色默认保持彩色版本，不因为系统 Dark Mode 自动整体反色。
- Dark / Tinted 主要用于系统 App Icon 或特殊品牌场景。
- 角色图必须保留透明背景和脚底柔和阴影。
- 不在状态 PNG 中写文字。
- 不把 loading spinner、机械直线、科技光环等通用 AI 符号作为 Fanto 的核心视觉。
- 新能力优先表达为“线 + 道具 + 角色状态”。

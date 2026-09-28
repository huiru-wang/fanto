# Fanto Line Motion Spec

Fanto 的“线”用于表达连接、回忆、编织与主动行动。它不是装饰线，也不是 loading spinner。

## Visual token

| Token | Light | Dark |
| --- | --- | --- |
| stroke | `#171717` | `#F2E9DC` |
| stroke width | 6 pt / px 基准 | 6 pt / px 基准 |
| line cap | round | round |
| line join | round | round |
| opacity | 1.0 | 1.0 |

实际尺寸按容器同比例缩放。小于 24 pt 的图形可降到 4 pt，但不要使用 1 px 发丝线。

## Shape

- 默认使用轻微弧线，不使用机械直线。
- 每段线至少有一个方向变化，但不要高频抖动。
- 转角必须圆润。
- 允许形成 loop、结、绕线，但不要画成电路、数据流或科技 HUD。
- 连接两个内容时，线的终点应明确落在目标附近，而不是无限延伸。

## Motion

### Draw

用于“正在连接 / 正在想到”。

- duration: 600 ms
- easing: easeOut
- path progress: 0 → 1
- Web: `stroke-dashoffset`
- SwiftUI: `.trim(from: 0, to: progress)`

### Connect

用于线端最终贴近目标。

- duration: 350 ms
- easing: easeInOut
- overshoot: 0–3 px

### Idle breathe

仅在角色静止但需要表达生命感时使用。

- duration: 1800 ms
- y: 0 → -2 → 0
- rotation: -1° → 1° → -1°
- scale: 1.0 → 1.012 → 1.0

同一时间只使用一类微动效，不叠加漂浮、旋转、缩放三套强动画。

## Semantic mapping

| Product semantic | Line behavior |
| --- | --- |
| Record created | 新线头短暂出现 |
| Relevant memory | 两个已有线头靠近并连接 |
| Thread | 多条线维持长期连接 |
| Creation | 多根线收束 / 编织到同一产物 |
| Reminder | 一根线把便签 / 铃铛拉到角色附近 |
| Done | 线停止运动，形成稳定小结 |

## Web reference

```css
.fanto-line {
  fill: none;
  stroke: #171717;
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fanto-line--drawing {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: fanto-line-draw 600ms ease-out forwards;
}

@keyframes fanto-line-draw {
  to { stroke-dashoffset: 0; }
}
```

实际 SVG 推荐用 `pathLength="1"` 归一化 dash 值。

## SwiftUI reference

```swift
struct FantoLineShape: Shape {
    var progress: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addCurve(
            to: CGPoint(x: rect.maxX, y: rect.midY),
            control1: CGPoint(x: rect.width * 0.30, y: rect.minY),
            control2: CGPoint(x: rect.width * 0.70, y: rect.maxY)
        )
        return path.trimmedPath(from: 0, to: progress)
    }
}
```

Stroke 使用 `.round` lineCap / lineJoin。

## Do / Don't

Do:
- 像手画出来的一根线。
- 让运动服务于“连接了什么”。
- 尽量短、克制、可读。

Don't:
- 无限循环 loading。
- 霓虹发光。
- 数据粒子沿线高速流动。
- 直角折线、电路板语言。
- 同时出现过多线条造成“知识图谱”感。

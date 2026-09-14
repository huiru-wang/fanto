# Agent Skills

每个 Skill 放在 `<skill-id>/SKILL.md`。目录名与 front matter 中的 `name` 必须一致，且只能使用小写字母、数字、`-`、`_`。

```md
---
name: repo-conventions
description: Follow this repository's conventions before editing code.
---
Read AGENTS.md before making changes.
```

在项目根 `agents.yaml` 的 Agent 定义中将该 ID 加入 `skills` 后，服务启动时会加载它。

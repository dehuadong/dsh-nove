# Agent Note: implement-gate：配置默认值合并

Status: implemented

工作项：让 `.agents/implement-gate.json` 的 `commands` 成为可选覆盖层，默认命令只保留在代码里，避免 marker 与代码重复。

## Problem

`index.js` 有 `DEFAULT_COMMANDS`，但 `config.js` 要求 `commands.implement` 必填；`/implement-gate init` 又把默认命令写进 marker。结果 marker 必须复制默认正则，默认值与 marker 会漂移，`docs` 命令还多一层 fallback。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `tools/implement-gate/config.js:50-101` | `commands` 必填 `implement`，未提供的键不编译 | 改为可选；缺省键用代码默认值 |
| `tools/implement-gate/index.js:28-34` | `DEFAULT_COMMANDS` 只在 init 时写入 | 默认命令归 `config.js`，读取时合并 |
| `tools/implement-gate/index.js:145-153` | init 生成 `commands` | init 不再写 `commands`/`proposed` |

## Decision

- `DEFAULT_COMMANDS` 从 `index.js` 移到 `config.js`；
- `compileCommands(undefined)` 返回默认 planning/implement/docs；
- 提供 `commands` 时只覆盖给出的键，其余用默认；
- 不再要求 `commands.implement` 必填；未知键仍拒绝；
- `/implement-gate init` 只写 `enabled/version/codeExtensions/codePaths/protected`；
- `proposed` 仍接受但 policy 中为 `undefined`，不参与分类；
- `codePaths` 默认空。

## Alternatives considered

- **保留 marker 必填 commands。** 最强理由是显式；默认值与代码重复且会漂移，故不采用。
- **完全删除 commands 配置。** 最强理由是消灭重复；作者可能需要自定义口令，故保留覆盖层。
- **只在 index 里 fallback。** 最强理由是改动小；config 校验仍强制必填，问题没解决。

## Consequences

- 新 marker 不需要 `commands`，默认命令来自代码；
- 现有 marker 的 `commands` 仍覆盖默认，作者删掉后即用默认；
- 只覆盖 `implement` 时，planning/docs 仍用默认；
- `proposed` 不再影响分类，notes 按文档处理；
- `codePaths` 默认空，需要拦 package/tsconfig 的项目显式声明。

## Verification

```text
node tools/implement-gate/test.mjs   # ALL CHECKS PASSED
npm run verify                       # 通过
```

测试覆盖：无 commands 使用默认 planning/implement、只覆盖 planning 时 implement 仍默认、未知键拒绝、init 不含 commands/proposed。

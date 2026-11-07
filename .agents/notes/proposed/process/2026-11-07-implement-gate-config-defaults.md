# Agent Note: implement-gate：配置默认值合并

Status: proposed

工作项：让 `.agents/implement-gate.json` 的 `commands` 成为可选覆盖层，默认命令只保留在代码里，避免 marker 与代码重复。

## Problem

`tools/implement-gate/index.js` 有 `DEFAULT_COMMANDS`，但 `config.js` 要求 `commands.implement` 必填；`/implement-gate init` 又把默认命令写进 marker。结果：

- marker 必须复制两个默认正则；
- 代码默认值与 marker 值会漂移；
- `docs` 命令只在代码 fallback，marker 里没有，形成三套来源。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `tools/implement-gate/config.js:50-101` | `commands` 必填 `implement`，未提供的键不编译 | 改为可选；缺省键用代码默认值 |
| `tools/implement-gate/index.js:28-34` | `DEFAULT_COMMANDS` 只在 init 时写入 | 默认命令归 `config.js`，读取时合并 |
| `tools/implement-gate/index.js:145-153` | init 生成 `commands` | init 不再写 `commands`，只写必要配置 |

## Proposal

### 1. `commands` 可选

`config.js`：

- 导出 `DEFAULT_COMMANDS`（planning/implement/docs）；
- `compileCommands(undefined)` 返回默认命令；
- 提供 `commands` 时，只编译并覆盖给出的键；
- 不再要求 `commands.implement` 必填；
- 未知键仍拒绝。

### 2. 读取时合并

```text
effective = { ...DEFAULT_COMMANDS, ...providedCommands }
```

`loadConfig` 返回的 policy 始终含完整命令；`gateCommand` 不再需要 fallback。

### 3. init 简化

`/implement-gate init` 生成：

```json
{
  "enabled": true,
  "version": 2,
  "codeExtensions": [...],
  "codePaths": [],
  "protected": [".agents/implement-gate.json", ".agents/state/implement-gate"]
}
```

不再写 `commands`、`proposed`。

### 4. 现有 marker

- `commands` 可以保留，也可以由作者删除；保留时覆盖默认；
- `proposed` 继续被接受但忽略，标记 deprecated；
- `codePaths` 现有值仍生效；作者要默认空需手动改。

### 非目标

- 不自动改 protected marker；
- 不删除 `codeExtensions`/`protected`；
- 不改变命令语义，只改变默认值来源。

## Alternatives considered

**保留 marker 必填 commands。** 最强理由是显式；默认值与代码重复且会漂移，故不采用。

**完全删除 commands 配置。** 最强理由是消灭重复；作者可能需要自定义口令，故保留覆盖层。

**只在 index 里 fallback。** 最强理由是改动小；config 校验仍强制必填，问题没解决。

## Acceptance criteria

1. 无 `commands` 的 marker 合法并可用默认 planning/implement/docs；
2. 只提供 `commands.implement` 时，planning/docs 仍用默认；
3. 未知 command 键仍拒绝；
4. init 生成的 marker 不含 `commands`/`proposed`；
5. 现有 marker 含 commands 时仍可覆盖；
6. 测试覆盖无 commands、部分覆盖、未知键、init 输出。

## Plan Review

- Standards：默认值归代码，配置只放覆盖；marker 不再复制。
- Spec：无 commands、部分覆盖、init 输出都可观察。
- Architecture：`DEFAULT_COMMANDS` 移到 config，读取时合并；Gate 调用方拿到完整命令。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有 marker 的 commands 仍覆盖默认，作者删掉前不会自动更新；
- `proposed` 继续被接受但无效果，文档要写明 deprecated；
- 移动 `DEFAULT_COMMANDS` 可能造成循环依赖，需要从 config 导出。

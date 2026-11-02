# Agent Note: implement-gate 初始化动作

Status: implemented

工作项：当前任务「implement-gate 初始化动作」。

## Problem

新项目没有 `.agents/implement-gate.json` 时 guard 完全 pass-through；要启用只能手写配置。v2 配置包含代码扩展名、执行入口、protected、proposed、命令正则，手抄容易漏项或写错，且用户不应该直接拼工具 JSON。

## Decision

新增工具动作：

```text
implement_gate({action:'init'})
```

用户侧用自然语言触发，例如「初始化 implement-gate」；代理负责调用该动作。

### 行为

- 只在 marker 不存在时创建；已有 marker 返回 `already-exists`，不覆盖；
- 生成 version 2 默认配置：
  - 常见代码扩展名；
  - 执行入口 `package.json`、锁文件、`tsconfig*.json`、`cordis.patch.yml`、`.github/workflows/`；
  - marker/state 默认 protected；
  - planning/implement 两条中文命令；
- 可选覆盖 `codeExtensions`、`codePaths`、`proposed`；
- 写入后立即用 `loadConfig` 校验；非法配置删除 marker 并返回 `misconfigured`；
- 不创建 state 文件，不授予 implement 授权。

### 使用

```text
用户：初始化 implement-gate
代理：implement_gate({action:'init'})
→ enabled:true, configVersion:2
```

之后改代码仍需：

```text
批准，使用技能 implement 执行实现 {任务}
```

## Alternatives considered

**A. 继续手写配置。** 最强理由是零实现。否决原因：配置字段多，容易漏 `codePaths`/命令，用户不应手拼 JSON。

**B. 提供独立 CLI 脚本。** 最强理由是可脚本化。否决原因：跨平台入口与安装路径维护成本高；工具动作已经能被代理自然语言触发。

**C. init 默认 `enabled:false`。** 最强理由是更保守。否决原因：用户明确要求“初始化”即启用；调用 init 本身是显式动作，且它不授予代码写权限。

## Testing

- `tools/implement-gate/test.mjs`：init 创建 v2、status 立即 enabled、重复 init `already-exists`、默认拦截代码/放行 docs、非法覆盖被拒且不留下 marker。
- `node storycraft/scripts/ci.mjs --no-e2e`：94 单元文件通过。
- 安装后对已有 Storycraft 配置调用 init：返回 `already-exists`，未覆盖。
- 提交：`45d6203`。

## Consequences

- 新项目初始化从手写 JSON 变成一次工具动作；
- init 只建立策略，不授予 implement；代码写仍走门禁；
- 已有配置不会被 init 自动迁移；v1 项目仍会 `misconfigured`，需手动迁移；
- 默认 `proposed` 为空；有 Agent Notes 的项目需在 init 后配置，或调用时传入 `proposed`；
- 非法生成配置会被删除，避免半配置导致后续全部写拒绝。

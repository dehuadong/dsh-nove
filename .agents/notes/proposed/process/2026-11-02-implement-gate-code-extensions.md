# Agent Note: implement-gate 代码后缀门禁简化

Status: proposed

工作项：当前任务「implement-gate 代码后缀门禁简化」。

## Problem

上一版把 `codeRoots`、`codeFiles`、`docScope` 一起放进配置后，守卫从“编辑代码前授权”扩大成“大部分文件都要授权”：

- `git add/commit` 被拦截；
- `README`、`AGENTS`、`docs`、`.json`、`.yaml` 也要文档范围；
- 改一个非代码文件也要先 `批准，执行文档治理`；
- 配置和状态机都变复杂，误判点变多。

这与目标不一致。目标只有一句：

> **编辑代码文件前必须 implement 授权；其他文件不进入代码门禁。**

## 对拍参考

参考工程 `inkos-master` 没有 DSH `implement-gate` 对应实现；本项是 DSH Host 工具链自身的授权边界简化。检索范围：`inkos-master` 的 `packages/`、`scripts/`、`docs/` 与 CI；未找到同类 pre-execute 授权守卫。仓库内前置实现是 `tools/implement-gate/` 与 `implemented/process/2026-11-02-implement-gate-generalization.md`。

## Proposal

### 1. 配置 v2

`.agents/implement-gate.json` 改为：

```json
{
  "enabled": true,
  "version": 2,
  "codeExtensions": [
    ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".java", ".kt", ".kts",
    ".c", ".h", ".cc", ".cpp", ".hpp", ".cs",
    ".rb", ".php", ".swift", ".scala", ".lua",
    ".sh", ".ps1", ".sql",
    ".css", ".scss", ".html", ".vue", ".svelte", ".astro"
  ],
  "codePaths": [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.client.json",
    "cordis.patch.yml",
    ".github/workflows/",
    "storycraft/package.json",
    "storycraft/package-lock.json",
    "storycraft/tsconfig.json",
    "storycraft/tsconfig.client.json"
  ],
  "protected": [
    ".agents/implement-gate.json",
    ".agents/state/implement-gate"
  ],
  "proposed": ".agents/notes/proposed",
  "commands": {
    "planning": "^批准，使用(?:技能\\s*)?planning\\s+执行规划\\s+(.+)$",
    "implement": "^批准，使用(?:技能\\s*)?implement\\s+执行实现\\s+(.+)$"
  }
}
```

- `codeExtensions` 决定代码边界，大小写不敏感、必须以 `.` 开头；
- `codePaths` 是少量**执行入口**例外（package.json、锁文件、tsconfig、cordis、CI workflow）；不带尾斜杠的条目按**精确文件**处理（如 `storycraft/package.json`），带尾斜杠的条目按**目录前缀**处理（如 `.github/workflows/`）；它们是代码门禁，不是 always-protected，implement 下可改；
- `codePaths` 可省略或为空；非空时每项必须是 workspace 相对路径，拒绝绝对路径、`..`、通配符；尾斜杠允许；空字符串/`//` 非法；
- 不再有 `codeRoots`、`docScope`、`commands.docs`；
- `protected` 追加默认 marker/state；默认路径无条件 protected；
- `proposed` 可选；缺省不影响普通文档。

### 2. 门禁判定

```text
目标路径扩展名 ∈ codeExtensions
  OR 目标路径命中 codePaths（文件或目录前缀）
  → 需要 implement
其他路径
  → 不进入代码门禁
proposed 路径
  → 仍只允许 planning/implement
protected 路径
  → 始终拒绝
```

阶段效果：

| 目标 | discuss | planning | implement | complete |
|---|---|---|---|---|
| 代码文件 | 拒绝 | 拒绝 | 允许 | 拒绝 |
| 非代码文件 | 允许 | 允许 | 允许 | 允许 |
| propose Note | 拒绝 | 允许 | 允许 | 拒绝 |
| protected | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

### 3. shell 与 git

- `git status/add/commit/push` 不进入代码门禁；`git commit` 不检查 staged 文件，代码改动本身已在写时被拦；
- `git checkout/reset/clean` 会覆盖或删除工作区代码，仍视为代码写，需要 implement；
- `pwsh`/`bash` 只检查命令中**显式出现的代码文件目标**：
  - `Set-Content src/x.ts` → 需要 implement；
  - `Set-Content docs/x.md`、`data.json` → 允许；
  - `Remove-Item src/x.ts` → 需要 implement；
  - `Remove-Item docs/x.md` → 允许；
  - `> src/x.ts`、`>> src/x.ts` → 需要 implement；`> docs/x.md` → 允许；
- 简单变量赋值可解析（`$p='src/x.ts'; Set-Content $p`）→ 按代码门禁；`$p=$(...)`、反引号、`$env:` 等无法静态求值 → 不猜测，交给显式目标规则，不因未知变量一律拒绝；
- `npm run build`、`npm install`、构建/测试命令不再统一视为代码写；只检查其显式目标（如 `--prefix` 不在本项范围，仍由 shell-guard/sandbox）；
- **工作区外边界保留**：`Set-Content C:\x.txt`、`workdir` 在工作区外且命令写入时，仍由实现层拒绝；只读命令（`Test-Path`、`ls`）不因外部路径被拒。完整 outside-write 覆盖仍由 shell-guard 工作项负责。

### 4. 状态

- 状态继续保存 phase/work/task/blockReason；**不再保存 `docScope`**；
- `implement_gate({action:'end-docs'})` 固定返回 `{ok:false,code:'not-supported'}`；
- 旧状态文件中的 `docScope` 读取时忽略，下一次 `saveState` 自然丢弃；
- 配置 `version:1` 或缺少 `version:2` → `misconfigured`，必须迁移；
- 配置每次按 workspace 根读取；
- `commands.docs` 从配置 schema 移除；`gateCommand` 不再有 docs 分支；带 `docs` 键的配置 → `misconfigured`。

### 5. 迁移

- Storycraft `.agents/implement-gate.json` 改为 v2；现有代码文件仍按后缀拦截；
- `README`、`AGENTS`、`docs`、`.json`、`.yaml`、`git` 恢复为无需 planning/implement；
- 旧 `docScope`/`end-docs` 不再使用；`end-docs` 固定 `not-supported`。

## Alternatives considered

**A. 保留 codeRoots，只把 docs/json 加入例外。** 最强理由是改动小。否决原因：例外会继续膨胀，最终又回到白名单维护；用户要的是“只按代码后缀”。

**B. 只按文件名后缀，不看路径。** 最强理由是简单。否决原因：本就如此设计；但需要明确扩展名配置和大小写，否则 `.TS` 会漏。

**C. 保留 docScope 作为可选。** 最强理由是仍有文档范围控制。否决原因：用户明确不需要；docs/json/git 不应进入门禁，保留状态只会增加误判。

**D. 把配置 json 也纳入 codeExtensions。** 最强理由是保护配置。否决原因：用户明确说部分 json 不需要 planning/implement；执行入口应由 `codePaths` 精确列出，而不是全量后缀。

## Acceptance criteria

1. Storycraft 配置迁移为 v2，`.ts/.js/.py/.rs/.go` 等代码文件仍需要 implement；`.TS`、`a.test.ts`、尾随点/空格的 `.ts.` 也按代码处理；
2. `codePaths` 中根级与嵌套执行入口（`package.json`、`storycraft/package.json`、`storycraft/tsconfig.json`、锁文件、`cordis.patch.yml`、`.github/workflows/`）需要 implement，但 implement 下可改；文件条目精确匹配，尾斜杠条目按目录前缀匹配；
3. `README`、`AGENTS`、`docs`、`.md`、`.json`、`.yaml`、`.gitignore` 等无扩展/非代码文件在 discuss/complete 下直接可写，不要求 docs 命令；
4. `git status/add/commit/push` 不进入代码门禁；`git checkout/reset/clean` 仍视为代码写，需要 implement；
5. `pwsh`/`bash` 只按显式代码目标拦截；`Set-Content src/x.ts` 拒绝，`Set-Content docs/x.md`、`data.json` 放行；`> src/x.ts` 拒绝，`> docs/x.md` 放行；`$p='src/x.ts'; Set-Content $p` 拒绝；
6. 工作区外显式写入仍拒绝；`Test-Path C:\outside`、`Get-ChildItem C:\outside` 等只读命令放行；`npm run build`/`npm install` 不再统一按代码写拒绝；
7. `.agents/notes/proposed/**` 仍只在 planning/implement 可写；
8. `.agents/implement-gate.json`、state 始终 protected；
9. `docScope` 从状态移除；`end-docs` 固定返回 `not-supported`；`commands.docs` 从 schema 移除，配置出现 docs 键或调用 docs 命令不授权；
10. `version:1`、缺 `version:2`、缺 `codeExtensions`、扩展名非法（无点/通配符/绝对路径）、`codePaths` 含绝对路径/`..`/通配符/空项、非法命令正则、未知键 → `status` 返回 `misconfigured`，写拒绝；
11. 不同项目可使用不同 `codeExtensions`/`codePaths`，互不影响；
12. `node tools/implement-gate/test.mjs` 与 `storycraft/scripts/ci.mjs --no-e2e` 通过；
13. `tools/implement-gate/README.md` 的配置/行为段与 `AGENTS.md:29,33` 同步为“代码后缀门禁”，删除文档范围命令说明。

## Risks

- `.json`、`.yaml` 普通配置不再受 implement 门禁；执行入口由 `codePaths` 精确列出，漏列的执行入口会绕过代码门禁；
- 仅按后缀判断，扩展名不标准的代码文件（Makefile、无扩展名脚本）不会拦截；需要时加入 `codePaths`，不在本项扩展；
- symlink 的扩展名按词法路径判断；`.md` 链接到 `.ts` 的行为不保证拦截，需要时由 shell-guard/sandbox 或后续 realpath 规则处理；
- 去掉 `docScope` 后，文档修改不再有运行时确认；这是用户明确接受的范围；
- 旧配置 v1 会 fail closed，必须迁移；迁移失败会阻止所有代码写；
- 状态文件残留 `docScope` 被忽略，下一次保存丢弃；`status` 不再展示。

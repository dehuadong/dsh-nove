# Agent Note: shell-guard 跨平台补强

Status: proposed

工作项：当前任务「shell-guard 跨平台补强」。

## Problem

`tools/shell-guard/` 目前的分类器以 Windows/PowerShell 为主：它只在 `tools/pre-execute` 拦截 `pwsh`/`bash`，只识别删除/移动/清理动词，并把整条命令文本直接交给动词正则。

三个已观察到的缺口：

1. **只拦删除/移动，不拦创建/写入**。代理可以在工作区外 `New-Item`/`npm install --prefix`/写脚本，创建成功；最后删除时才被拒绝，留下无法自动清理的外部目录。
2. **here-string 误判**。脚本内容里的 `unlinkSync`、`rm` 会被当成真实删除；合法测试脚本被拒绝。
3. **POSIX 覆盖不足**。`sudo rm`、`find -delete`、`xargs rm`、`mv/cp/install/dd/sed -i` 等路径未覆盖；macOS 大小写卷与 symlink 也未做真实路径归一化。

## 对拍参考

参考工程 `inkos-master` 没有 DSH `shell-guard` 对应实现；本项是 DSH Host 工具链自身的安全边界补强，不存在可直接复用的参考实现。检索范围：`inkos-master` 的 `packages/`、`scripts/`、`docs/` 与 CI；未找到同类 pre-execute 文件守卫。因此以下设计按本 Harness 的 `tools/pre-execute` 合同与 `shell-guard` 现有职责推导，不引入参考工程的运行时。

仓库内已有可复用的前置证据：

- `tools/implement-gate/classify.js` 的 here-string 剥离与 `shellOutside` 已经处理过“脚本文本被当路径”的误判；
- `deepseek-harness/packages/core/agent-loop/tests/interception.spec.ts:708-732` 证明 `tools/pre-execute` 的 `deny` 会在 dispatch 前短路；
- `tools/shell-guard/README.md` 当前只声明删除/移动，本项会把职责扩展到显式创建/写入。

## Proposal

### 1. 职责边界

`shell-guard` 负责**工作区外的显式文件变更**：

- 删除、移动、复制、覆盖；
- 创建目录/文件；
- 重定向写入；
- 目标明确的安装/克隆（`--prefix`、`--cache`、`git clone <dest>`）。

不负责：

- 工作区内源码/文档的工程授权（implement-gate）；
- 子进程内部任意写入（静态分类不可靠，交给 sandbox）；
- 工作区内的正常构建、测试、依赖安装。

### 2. 平台与工具

继续监听 `tools/pre-execute`：

- Windows：`pwsh`；
- macOS/Linux：`bash`；若 profile 注册 `sh`/`zsh`，一并拦截。

entry 仍用 `sandboxPolicy.resolve()` 取 workspace 根；不引入可配置额外根。

### 3. 解析

1. **语句切分**只按 `\n`、`;`、`&&`、`||`；**不拆单个 `|`**。管道作为一条语句处理：如果动词在管道后且目标不可见（如 `... | xargs rm`），保持现有的 pipeline-unknown 拒绝，不能拆开后回落到 cwd。
2. **嵌入代码**分两类：
   - here-string 作为**数据**被 `Set-Content`/`Add-Content`/`Out-File`/变量赋值消费时，剥离其正文，避免把脚本文本里的 `unlinkSync`/`rm` 当命令；
   - here-string/heredoc 被 `bash`/`sh`/`zsh`/`node`/`python`/`Invoke-Expression`/`eval` 执行时，**不剥离**，正文继续参与动词/路径检查；
   - `node -e`、`python -c` 属于可执行代码，不剥离；正文出现外部写/删仍拒绝。
3. 去掉 `sudo`、`doas`、`command`、`env VAR=...`、`nohup`、`time` 前缀后识别真实动词。
4. 解析同条命令内的简单变量赋值（`$p = '.artifacts\x'`、`p=/tmp/x`）；无法静态求值 → fail closed。
5. 通配符目标 → fail closed，除非能证明匹配范围在 workspace 内。

### 4. 路径边界

新增 `tools/shell-guard/path-boundary.js`（不跨包共享，避免 package `files`/exports 断裂）：

- `path.resolve(cwd, target)`；
- 对**workspace 根**、已存在目标或最近已存在父目录做 `realpath`；
- 拼接不存在部分后判断是否在 workspace 根内；
- Windows 大小写不敏感；macOS 用 realpath 归一化实际大小写；Linux 大小写敏感；
- symlink/junction 指向外部 → 拒绝。

`implement-gate` 的 `shellOutside` 不在本工作项内合并；后续如需共用，另立包或导出契约，不能靠相对路径跨包 import。

### 5. 决策

```text
解析语句
  → 去命令前缀
  → 判断是否为显式写/删/移动/覆盖动词或重定向
      → 只读命令：allow
      → 写入命令：解析目标
          → 嵌入可执行代码：正文参与检查
          → here-string 作为数据：剥离正文
          → realpath + 边界
              → 任意外部目标：deny
              → 全部内部：allow
```

只读命令（`Test-Path`、`Get-ChildItem`、`ls`、`cat`、`git status`）不因路径在工作区外被拒绝；这与 §1 的“显式文件变更”一致。拒绝文案包含真实路径，并提示工作区 `.artifacts/`。

### 6. 与 implement-gate 的分工

- `shell-guard`：工作区外文件变更；
- `implement-gate`：工作区内源码/文档授权；
- 本工作项只修 shell-guard；不把 `path-boundary` 跨包共享作为交付条件，避免扩大范围与打包契约。
- 已知相邻缺陷不纳入本项：`implement-gate/index.js` 的 `shellOutside` 会把只读命令里的工作区外路径也拒绝（如 `Test-Path E:\...`）。它需要单独的 read-only pass-through 修复；本项只保证 shell-guard 自己的只读命令不被误伤。

### 7. 已知限制

子进程内部写入无法静态识别：

```text
node inside-script.mjs   # 脚本内部可写任意路径
python make.py
```

这类情况由 DSH sandbox 的 `workspace-write` 提供真正边界；`shell-guard` 只保证显式命令目标与脚本路径。

## Alternatives considered

**A. 只补 POSIX 动词，仍只拦删除/移动。** 最强理由是改动小、误伤少。否决原因：`E:\novelist\_dsh-apicheck` 正是创建侧未拦留下的垃圾；只修删除仍然会“能建不能删”。

**B. 把 guard 做成完整 shell 解析器。** 最强理由是最少误判。否决原因：PowerShell/POSIX 方言过多，实现和维护成本高；本守卫只需要覆盖常见显式文件变更，复杂脚本交给 sandbox。

**C. 只依赖 sandbox `workspace-write`，禁用 guard。** 最强理由是边界最可靠。否决原因：当前部分 profile 使用 `danger-full-access`；guard 仍是低成本的错误拦截层，应保留。

**D. 允许工作区外临时目录，仅限制删除。** 最强理由是支持跨项目依赖对照。否决原因：正是当前问题的来源；临时测试应放 `.artifacts`，外部目录无法保证清理。

## Acceptance criteria

1. 复现用户报告：`New-Item E:\novelist\_dsh-apicheck`、`npm install --prefix E:\novelist\_dsh-apicheck`、`Remove-Item -Recurse E:\novelist\_dsh-apicheck` 均被拒绝；
2. `Set-Content E:\outside`、`> E:\outside`、`git clone <url> E:\outside` 被拒绝；
3. `mv/cp/install/dd/sed -i` 指向外部时被拒绝；
4. `sudo rm /tmp/x`、`find /outside -delete`、`... | xargs rm` 被识别并拒绝；工作区内 `find . -delete` 仍按工作区内处理；
5. here-string 作为 `Set-Content` 数据时，正文里的 `unlinkSync`/`rm` 不触发误判；
6. here-string/heredoc 被 `bash`/`node`/`python`/`Invoke-Expression` 执行、且正文写外部时被拒绝；`node -e`/`python -c` 写外部被拒绝；
7. 只读命令（`Test-Path E:\outside`、`Get-ChildItem E:\outside`、`ls /tmp`、`git status`）不被拒绝；
8. workspace 内 `.artifacts/` 的创建/删除/`trash.mjs` 正常；
9. `workdir` 在工作区外时，相对写/删被拒绝；
10. symlink 指向外部时，通过该路径写入被拒绝；workspace 根本身先 realpath，再做大小写比较；
11. macOS 大小写差异不绕过边界；Linux 大小写敏感行为正确；
12. `tools/shell-guard/test.mjs` 纳入 `storycraft/scripts/ci.mjs`；新增 `.github/workflows/shell-guard.yml` 在 `windows-latest`、`ubuntu-latest`、`macos-latest` 运行该测试；
13. shell-guard 单独安装时，只读命令/测试不被误伤；与 implement-gate 共存时只验证两者拒绝顺序不互相覆盖，**不声称修掉 implement-gate 的 read-only 误判**（该问题另立工作项）；
14. `AGENTS.md` 文件安全段、`tools/shell-guard/README.md` 的职责描述同步为“删除/移动/创建/写入/覆盖”，并写明 `.artifacts/` 临时目录与子进程内部写入仍依赖 sandbox；
15. 变量赋值解析：`$p='E:\out'; Remove-Item $p` 拒绝，`$p='.artifacts\x'; Set-Content $p` 放行；`$(...)`、反引号、`$env:` 等无法静态求值的形式 fail closed；先使用后赋值/重新赋值按最终可见值判断，无法确定时拒绝。

## Risks

- 创建/写入拦截面扩大，可能误伤合法外部安装；通过“只检查显式目标”和 `.artifacts` 提示降低；
- 变量/命令替换无法完全静态求值，只能 fail closed，可能增加拒绝；
- `realpath` 对不存在路径需要祖先回溯，逻辑比当前字符串比较复杂；
- 子进程内部写入仍依赖 sandbox；`danger-full-access` 下不能保证；
- shell 方言差异（PowerShell/bash/zsh）需要平台测试维护。

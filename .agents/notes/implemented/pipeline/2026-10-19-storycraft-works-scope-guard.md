---
title: 故事工坊：works 读取的会话作用域守卫
status: implemented
created: 2026-10-19
updated: 2026-10-20
verification: scope 守卫与 scope.test 已落地，CI 50 个单元文件通过。
---

# Agent Note：故事工坊：works 读取的会话作用域守卫

## 问题

技能约定「讨论阶段不碰 `works/`」是提示词。原生工具能直接读历史作品：`read`/`edit`/`write` 的 `file_path`、`glob`/`grep` 省略 `path` 时的整工作区递归、`pwsh`/`bash` 的 `workdir`、`read_image`。参考实现的防线在工具面（会话绑定作品、读已注册产物、跨作品拒绝），我们要在同一层补。

## 决定

### 作用域根

- `worksRoot = <根会话 header.cwd>/works`，根会话 = 沿 `header.parentSession` 向上找到的最顶层会话；`header.cwd` 是会话创建目录、不可变，工作区根**不随 cd 变化**；
- 第二个受保护根 `dbRoot = <根会话 header.cwd>/.storycraft`（库、`-wal`、`-shm`）：**无论有没有当前作品，一律拒绝**，因为单文件无法按作品隔离。固定文案：`不直接访问作品库：请通过故事工坊动作或导出读取。`
- 相对路径的基准是**当前会话的实时工作目录**：取 `ctx.workingDirectory.get(session)`（同步、不抛；`ensure` 是异步，不能用），它才是 `working_directory` cd 之后的真实目录；缺失时回退到该会话 `header.cwd`；
- 归一化 `..`、正/反斜杠、Windows 小写；`ctx.workingDirectory.get` 的返回值可能已经是绝对路径，直接使用。

### 纯函数 `scope.js`

```
scopeDenial({ tool, arguments, cwd, worksRoot, dbRoot, currentWork }) -> string | undefined
```

`worksRoot` 与 `dbRoot` 两个受保护根分开传入；判定规则和文案分别对应，不能只按 `worksRoot` 分支。

- 同步、**不抛异常**：参数缺失或异常返回保守拒绝文案；
- 覆盖参数：

| 工具 | 参与判定的参数 |
| --- | --- |
| `read`、`edit`、`write`、`read_image` | `file_path` |
| `glob` | `path`（**省略即视为整工作区**，直接拒绝） |
| `grep` | `path` 与 `include`（`pattern` 是内容正则，不按路径处理） |
| `pwsh`、`bash` | `workdir` 与 `command` 中的路径片段 |
| `working_directory` | `cd`（**不允许进入 works/ 或 .storycraft/**） |

- 目标在 `dbRoot` 下 → 上述固定文案（先于当前作品判断）；
- 目标在 `worksRoot` 下：
  - 无当前作品 → `讨论阶段不读历史作品：请先在面板进入一部作品，或给 path 限定到项目目录。`
  - 有当前作品但不在 `works/<currentWork>/` → `只能访问当前作品：works/<其他作品> 不在当前会话的作用域内。`
  - 当前作品内 → 放行；
- `glob`/`grep` 省略路径 → `检索默认会扫进 works/：请给 path 限定到项目目录或当前作品。`
- `working_directory` 的 `cd` 指向 `works/` 或 `.storycraft/` → `不进入作品目录：请用相对项目根的路径访问作品。`
- shell：按**路径段**匹配 `works` 与 `.storycraft`，左边界含分隔符与路径起始：`(^|[\s"'=:/\\])(works|\.storycraft)([/\\]|$)`；因此 `./works/x`、`/repo/works/x`、`E:\repo\works\x`、`.storycraft/works.db` 都命中，`packages/workspace` 不命中；`workdir` 按路径判定，`command` 出现无法解析的 `works`/`.storycraft` 片段时保守拒绝；
- 项目级路径（`AGENTS.md`、`docs/`、`storycraft/`、`deepseek-harness/`、`packages/workspace/`）不参与判定。

### 当前作品的来源

- `sessionOf(exec)` 取会话 id，`sessionCurrentOf(root, id)` 取指针（内存为空时先从 `session_current` hydrate，见 `implemented/workspace/2026-10-20-storycraft-workbench-freshness.md`）；
- 子代理没有自己的指针：沿 `header.parentSession` 找到根会话，再取根会话指针；
- 指针不存在时按「无当前作品」处理；
- 当前作品解析同样以**根会话**为准，避免子代理 `cwd` 变化造成误判。

### 接入

`tools.js` 的 `apply()` 注册第二个守卫，与 `delegationDepth` 守卫并列；`scope.js` 只依赖字符串与路径，便于单测。

## 备选方案

- **只加强提示词**：已被证明挡不住；否决。
- **移除文件工具**：破坏正常项目文件操作；否决。
- **按阶段动态卸载工具**：DSH 没有按阶段改工具面的入口；否决，守卫等价。
- **允许显式读参考作品**：扩大污染面；暂不做。
- **`realpath` 规范化**：需要异步，守卫是同步接口；记为残余风险。

## 后果

该设计已按决定落地；生产与消费路径已切换，旧路径不再写入，未保留旧作品迁移或兼容层。

## 验证

产品行为与验收由 #17 拥有。本设计只证明：

1. `scope.test` 覆盖路径矩阵：相对/绝对、正/反斜杠、`..`、当前作品内外、大小写；`.storycraft` 下的库与 `-wal`/`-shm` **在有当前作品时同样被拒**；以及 **cd 到项目目录后 `../works/x` 仍按实时 cwd 解析并拒绝**；
2. `scope.test` 覆盖工具参数矩阵：`glob`/`grep` 省略 path、`grep.include`、shell 的 `workdir` 与 `command`、`read_image`、`working_directory` 的 `cd`；
3. shell 片段匹配：`packages/workspace` 放行；`works/其他`、`./works/x`、`/repo/works/x`、`E:\repo\works\x` 均拒绝；
4. `tools.test` 断言两个守卫都已注册，并覆盖拒绝文案；
5. `node scripts/decisions/check.mjs` 通过。

## 风险

- shell 可拼接/编码绕过保守匹配；
- 符号链接未做 `realpath`，可能逃逸（记录为残余风险）；
- 未进入作品时讨论受限，这是预期；
- `glob`/`grep` 省略路径一律拒绝，会改变既有习惯，需要文档说明。




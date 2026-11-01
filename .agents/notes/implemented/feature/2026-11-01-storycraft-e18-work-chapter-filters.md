# Agent Note: 故事工坊：E18 作品与章节检索筛选

Status: implemented

工作项：当前任务 E18（不新建 GitHub issue）。补齐作品列表与章节列表的检索筛选；只读，不改写作链。

## Problem

- 左侧作品列表只有“作品/回收站”和长篇/短篇/剧本类型，找某部作品只能翻；
- 章节列表固定倒序 20 章/页，无法按阶段、未处理审稿或标题定位；
- 作品摘要已有 `openProblems`，章节摘要已有 `stage/openProblems`，面板没有把它们变成筛选；
- 作品没有显式“状态”字段，需要从已有章节摘要派生，不能伪造新状态。

## 对拍参考

- `inkos-master/packages/core/src/agent/agent-tools.ts:3126` 的 work profile filter 表明参考实现把形态作为列表过滤维度；本地作品已有 `form`，且面板已有形态标签。
- 参考工程没有等价的作品级“未处理数/状态”列表 UI 可直接照搬；本项复用本地 `listWorks` 暴露的 `chapters/writtenChapters/latestChapter/openProblems` 与 `readWork` 的章节 `stage/openProblems`。
- 本地 `client.ts:4234-4239` 已有形态标签，`client.ts:4274` 用它过滤作品；本项不重复加形态控件。
- 本地章节分页在 `client.ts:2810-2813`，20 章/页；`readWork` 当前返回全部章节。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 形态过滤 | 继续用现有形态标签 | 避免两套形态状态 | 等价适配 | E2E |
| 服务端列表过滤 | `listWorks`/`readWork` 接收筛选条件 | 客户端是单文件脚本，不能安全共享新模块 | 采纳 | 单元 |
| 作品有显式状态 | 从章节进度派生 | 无新 schema | 补强 | 单元 |

## Decision

### 作品筛选

- 标题子串搜索，忽略大小写/首尾空白；
- 形态仍由现有左侧标签负责（不新增第二个形态控件）；
- 派生状态（仅长篇显示/生效）：
  - `empty` 无章节；
  - `planning` 有章节但无正文；
  - `writing` 有正文且最新章未定稿；
  - `settled` 最新章已定稿（显示“已收尾”，不宣称全书完结）；
  - `degraded` 库打不开；
- 未处理数：`openProblems > 0` / `= 0` / 全部；`openProblems:null`（degraded）在 `=0` 不匹配，在 `>0` 不匹配，仅“全部”可见；
- 条件 AND；清空恢复；回收站不参与。

`listWorks(root, options?)` 增加 `q/status/issues` 过滤；返回现有摘要加 `latestStage`（最新章 stage；无章节 null）。`status` 由 `latestStage/chapters/writtenChapters` 派生；短篇/剧本没有 chapters 行，其 `status` 为 null，状态筛选只在长篇标签下显示。若对短篇/剧本传入 `status`，该条件被忽略（不返回空列表也不报错）；`q` 对作品标题是子串匹配。

### 章节筛选

- 章号或标题搜索：纯数字或 `#数字` 时按章号精确匹配，否则按标题子串；
- 阶段：现有 `stage` 值（已规划/已写/已审/已修订/已定稿）；
- 未处理审稿：`openProblems > 0` / `= 0` / 全部；
- 条件 AND；筛选后回到第 1 页；当前选中章不可见时清空选择；
- 仍按倒序、20 章/页。

`readWork(root, work, options?)` 增加 `q/stage/issues`：

- `chapters` 永远是**全量**，供 `nextNumber`、前后移动、isLatest、latestChapter 等非列表逻辑使用；
- 另返回 `chapterMatches`（过滤后的章节摘要），只供章节列表/分页/计数使用；
- 状态/事实等其余 payload 不变；路由 `GET /work?q=&stage=&issues=` 透传；默认无参数时 `chapterMatches` 等于 `chapters`。

### 实现位置

- 新增 **server-only** `src/work-filters.ts`：`workStatus`、`filterWorks`、`filterChapters`；`store-db` 使用，单元测试直接 import；
- `client.ts` 不 import 该文件（client 是 `bundle:false` 的单脚本）；客户端只发送筛选参数、渲染返回结果；
- 作品/章节区域各加过滤条；状态/阶段使用现有 badge 风格；
- 不改 DB schema、不调用模型、不新增标签/页面。

### 页码与选中

- WorkDetail 的 `load` 接收筛选状态，调用 `face.work(..., filters)`；
- 筛选条件变化时 `setChapterPage(1)`，并跳过“选中章自动跳页”的旧 effect（用筛选版本 ref）；
- `selected` 不在 `chapterMatches` 中时清空；
- 计数、`pageCount`、分页只基于 `detail.chapterMatches`；
- `nextNumber`、前后移动、isLatest、latestChapter 等继续用全量 `detail.chapters`；
- 无匹配时显示“没有匹配的作品/章节”，与真正的“还没有作品/章节”分开；`EmptyState` 只在无筛选且列表为空时出现。

### 大书边界

- 250 章摘要仍随 `readWork` 返回；服务端过滤是 O(n) 内存操作，不加载正文；
- 已有一个 250 章性能 fixture；若未来需要真正分页查询，再另立服务端分页项。

## Alternatives considered

**A. 客户端 `work-filters.ts` 共享。** 最强理由是纯函数可单测。否决原因：client 构建不 bundle，值 import 会让浏览器执行未解析 import；不能为 E18 改整个构建合同。

**B. 完全客户端过滤、只做 E2E。** 最强理由是改动小。否决原因：筛选逻辑无法单元测试，且与“大书”边界不一致。

**C. 只保留现有形态筛选。** 最强理由是改动最小。否决原因：E18 的标题/未处理/章节阶段是实际缺口。

**D. 章节正文全文搜索。** 最强理由是找句子。否决原因：正文搜索已有统一检索/上下文；本项只筛摘要。

## Testing

- `tests/work-filters.test.mjs`：状态派生、标题/状态/未处理组合、degraded、短篇 status、数字 q、阶段。
- `tests/storage.test.mjs`：`latestStage/status`、全量 `chapters` 与 `chapterMatches`。
- `e2e/filters.spec.cjs`：标题/状态、21 章筛选分页、选择保持、无匹配、清空。
- 完整 CI：94 单元 + 49 E2E。

## Consequences

- “已收尾”只看最新章 settled，不等于全书完结；文案避免“已完成”；
- 短篇/剧本无 chapters，状态筛选不适用；UI 只在长篇显示；
- `readWork` 仍返回全量 `chapters` 以及 `chapterMatches`（最多 250），服务端分页留待更大规模；
- 过滤后选中章清空可能让作者失去当前位置；可见则保留；
- degraded 行的 `openProblems:null` 与 `=0/>0` 语义需在 UI 文案说明。

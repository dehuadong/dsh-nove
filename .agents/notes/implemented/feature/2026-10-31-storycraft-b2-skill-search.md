# Agent Note: 故事工坊：B2 技能参考检索

Status: implemented

工作项：当前任务 B2（不新建 GitHub issue）。产品范围与验收归本 Note；B1 已交付，依赖 H2 的故事记忆/素材检索。

## Problem

故事记忆和素材已经进入 FTS，但技能方法正文没有进入检索：

- 作者无法在面板里用自然语言查“技能参考里怎么处理这个场景”；
- 现有命中只有 `source`，没有可定位的“文件 + 标题/行”；
- 技能是全局静态资源，复制进每部作品库会重复、过期，且没有 revision 失效。

B2 本轮只做**面板/API 的统一检索**：故事记忆、素材、技能参考在同一个结果形状里返回，命中带来源与位置。`story_context`/`brief` 的技能检索另立 B2b，不在本轮改 trace 契约。

## 对拍参考

- `inkos-master/packages/core/src/retrieval/local-search.ts:27-31` 把故事记忆、归档素材和 Skill references 放在同一个可重建检索投影里，按 scope 替换文档；`SearchDocument` 有 kind/source/title/body/metadata。
- `inkos-master/packages/core/src/agent/skill-tool.ts:93-101` 在 `use_skill` 的 query 分支检索技能段，返回 `path/heading/body/charStart/charEnd/score`。
- 参考的 skill 检索发生在 `use_skill` 工具内，不并入角色上下文；本项目本轮也**不并入**上下文，只做面板/API，避免改 trace/上下文合同。

| 参考做法 | 我们的做法 | 原因 | 裁决 | 验证 |
| --- | --- | --- | --- | --- |
| 独立检索投影，scope=skill | host 侧内存段索引 + revision 缓存 | 技能全局、文件小；不写每部作品库 | 等价适配 | 单元 |
| Markdown 按标题/char 偏移切段 | 按标题切段，带行号 | 面板可定位 | 等价适配 | 单元 |
| skill 检索在 use_skill 内 | 面板 `/search` 统一检索 | 作者主动查；不改上下文 | 偏差 | E2E |
| 检索 kernel 合并多类文档 | 同 API 分 kind 配额返回 | 避免跨 kind 分数不可比 | 收窄 | 单元 |

既有 `.agents/notes/implemented/feature/2026-10-22-storycraft-unified-retrieval.md` 排除了 skill；本 Note 部分取代其“技能参考未做”的现状，但**不**改变上下文检索合同。

## Decision

### 技能段索引

新增 `src/skill-search.ts`：

- 只读 catalog 内技能的 `SKILL.md` 与 `references/**/*.md`；跳过脚本/其他文件；
- 按 Markdown 标题切段，保留 `heading`、起止行号、正文；无标题文件作为一个段；
- 结果 `id=skill:<skill>/<path>#<heading-slug>:<line>`、`kind='skill'`、`source='skill:<skill>/<path>'`、`location='<heading> · L<start>-<end>'`；
- 以 `skillRevision` 为缓存键；revision 变化重建该技能，不返回旧位置；
- 查询用 `searchTokens`；分数按查询 token 覆盖/频次 + 标题命中，确定性排序；不引入向量/模型；
- 技能缺失/不可读时该技能返回空并记录原因，不让整个检索失败；缓存按 revision 惰性重建；revision 沿用 `skillRevision` 的现有 hash。

### 统一检索 API

新增只读 `GET /api/see-storycraft/search?root&id&q=`：

- 作品侧调用现有 `searchMemory`（记忆/素材/标题）；
- 技能侧用 `skill-search`，始终返回技能段；
- 返回 `{search:{groups:[{kind, hits:[{id,kind,source,location?,snippet,score,chapter}]}]}}`（location 仅技能有）；`readManifest` 先校验作品，不能只查技能绕过作品作用域；
- 每个 kind 取前 `SEARCH_KIND_LIMIT=3` 条；不跨 kind 比较分数；
- 空查询返回空 groups，不抛错；所有 kind 的 hit 都用 `snippetFor(..., SEARCH_SNIPPET_CHARS=240)` 截断；查询按 `SEARCH_QUERY_MAX=500` 字符消费层截断；
- 只读、作品作用域；不改 schema、不调用模型。

### 面板

- 看板“日志”之后新增折叠“检索”段（不新增第 8 标签）；
- 输入查询，点“检索”才请求；显示 kind/source/location/snippet；
- 面板不区分 role/scope，直接查全 catalog；空/失败/无命中可见；
- 只读，不提供“写入上下文”动作；README 路由/说明同步。

### 边界

- 不把技能正文写入 `search_docs`、作品库或导出；
- 不改 `story_context`/`brief`/trace 契约，Skill 不进入上下文检索；B2b 另立；
- 不新增模型工具；不返回技能全文，消费者按 source/location 再读。

## Alternatives considered

**A. 把技能文档复制进每部作品的 `search_docs`。** 最强理由是复用单一 FTS。否决原因：全局技能在每部作品重复，revision 更新要逐作品失效。

**B. 本轮同时并入 `story_context`/`brief`。** 最强理由是写手直接拿到方法段。否决原因：trace 合同固定 `{id,kind,source,score}`、engine 枚举、brief 无 role、上下文 <3 章关闭；会扩大 B2 合同并破坏既有测试。另立 B2b。

**C. 新建独立 SQLite 技能库。** 最强理由是 FTS5 排序成熟。否决原因：技能文件少、变更少；内存 + revision 缓存足够，避免新文件/备份边界。

**D. 跨 kind 统一分数排序。** 最强理由是“一个列表”。否决原因：`-bm25` 与 token 覆盖不可比；分 kind 配额更稳定，面板按组展示。

## Testing

- `tests/search.test.mjs`：技能段 source/heading/精确行号、frontmatter 跳过、记忆/素材/技能分组、revision 失效、旧文本消失、未知作品拒绝、空查询、snippet 截断。
- `tests/store-perf.test.mjs`：250 章统一检索 <500ms，响应不含 `text` 全文。
- `e2e/search.spec.cjs`：展开前不请求、技能命中显示 source/location、空查询不请求、无命中。
- 完整 CI：92 单元 + 47 E2E。

## Consequences

- 词法检索对同义表达弱；B2 只保证可定位，不承诺语义召回；
- 技能文件更新时缓存重建成本；按 revision 惰性重建，面板 all scope 可能一次读多个技能；
- 面板顶部搜索是“查资料”，不自动注入上下文；写手仍按原技能加载路径读正文；
- 技能文件缺失/不可读不阻断面板其他功能，仅少一组结果；
- 与 `2026-10-22 unified-retrieval` 的“技能参考未做”现状部分更新；上下文整合在 B2b。

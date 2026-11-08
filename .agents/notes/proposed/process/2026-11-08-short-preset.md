# Agent Note: 故事工坊：short.preset 短篇预设

Status: proposed

工作项：新增 `capabilities.yaml` 的 `short.preset`。当前账本没有这一行；它只建立短篇形态的产品入口，不实现短篇大纲、草稿、审校或打包。

## Problem

`workspace.single-form` 的存储限制已移除，但产品入口只有 `storycraft`（longform）：

- `PRESET_FORM` 只有 `storycraft: 'longform'`；
- 没有 `storycraft-short` 预设，`story_init` 永远创建 longform 作品；
- 因此“同一 workspace 多形态”没有真实产品路径，`workspace.single-form` 只能是保真债。

源工程有独立的 `short-fiction` profile，不是 longform 的一个参数。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/builtin-profiles.ts:23-29` | `short-fiction` profile，capabilityIds 含 `short-fiction`，artifactKinds 为 outline/manuscript/sales-package/cover | 复刻新增短篇预设，form=`short` |
| `inkos-master/packages/core/src/pipeline/short-fiction-runner.ts:208-306` | 短篇有独立的 outline/draft/review/package 流水线 | 本行只做 preset 入口；流水线留给 short.outline 等后续能力 |
| `inkos-master/packages/core/src/agents/short-fiction.ts:20-30` | short-fiction 角色与结构化提交 | 本行不实现该角色，登记后续债 |

## Proposal

### 范围

- 新增 `short.preset` 能力行，reference 为 `builtin-profiles.ts`；
- 新增 DSH preset `storycraft-short`：
  - 复用现有标准基线、技能与工具插件；
  - persona 改为短篇创作；form 映射 `short`；
  - `storycraft` 保持 longform，`storycraft-short` 为 short；
- `PRESET_FORM` 增加 `'storycraft-short': 'short'`；
- `story_propose` / `story_init` 在短篇预设下创建 `form:'short'` 作品；
- consumer：
  - e2e 验证 `storycraft-short` 预设可见、能初始化 short 作品；
  - 同一 workspace 先由 longform 会话建长篇，再由短篇会话建短篇；
- 真实回执：两个预设、同一 workspace、两个 form。

### 非目标 / 保留债

- 不实现 `short.outline`、`short.batch-draft`、`short.review-revise`、`short.package`；
- 短篇 preset 暂时只暴露现有动作集（story_init/story_propose 等），不暴露短篇流水线；
- 这是“入口预设”，不是完整短篇产品；四个 short 能力仍是 missing。

### 失败行为

- 短篇预设下 `story_init` 必须创建 form=`short`；
- longform 预设仍创建 form=`longform`；
- 同一 workspace 两个 form 共存；
- 未知 preset 仍 `preset-form-unknown`。

## Alternatives considered

**不建预设，只让 story_init 接受 form 参数。** 最强理由是少改 bundle；源工程用 profile 区分形态，参数会让 longform 会话创建短篇作品，形态语义混乱，故不采用。
**直接做完整短篇流水线。** 最强理由是可以一次闭环；四个 short 能力是独立纵向工作，塞进本行会超范围，故只做入口。
**把 short 作为 longform 模式。** 最强理由是复用现有工具；源工程有独立 profile 和 skill，故不采用。

## Acceptance criteria

1. 账本新增 `short.preset` 行；
2. `storycraft-short` 预设可被 DSH 列出并启动；
3. 短篇预设 `story_init` 创建 form=`short`；
4. 同一 workspace 可同时有 longform 与 short 作品（产品路径，不是直接 storage）；
5. 未知 preset 仍拒绝；
6. 四个 short 流水线能力保持 missing，不冒充完成；
7. consumer 与真实回执齐全后才置 `verified`。

## Plan Review

- Standards：新增能力行，不把 short 流水线塞进 preset；四个 short 能力保留 missing。
- Spec：预设、form、同 workspace 双作品、未知 preset 都可观察。
- Architecture：preset 决定 form；作品 manifest 存 form；短篇动作是后续能力。
- 结论：通过，进入实施需 implement 授权；但这是“入口预设”，不是完整短篇功能。

## Risks

- 复制 preset 插件列表会带来维护重复；
- 短篇预设暂时暴露 longform 动作，用户可能误以为短篇流水线可用；
- 真实回执需要两个预设会话，测试成本高。

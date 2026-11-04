# Agent Note: 故事工坊：cast.single-authority 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `cast.single-authority`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、后果与验证。

## Problem

作品里曾有两套人物数据：`roles:index` + `role:<slug>` 卡，以及 `bible:characters` 的六字段小传。`brief`/`composer` 有卡时用卡，但 `facts.readCards`、`state-check`、`state-settle` 与 `bible` 真值仍读六字段；minor 角色没有稳定进入 whitelist 与生成上下文。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/utils/outline-paths.ts:60-127` | 角色索引只有 `name + tier`，卡按主要/次要目录，一人一卡 | 采纳：`roles:index` 是索引，`role:*` 是卡；`bible:characters` 不再存在 |
| `inkos-master/packages/core/src/forecast/context-builder.ts:59-62` | Composer/Planner/Writer 直接消费角色卡，按 major/minor 分组 | 采纳：brief/composer 只读卡；minor 不过滤 |
| `docs/report/inkos/inkos03.md:124`、`inkos04.md:31/61/71` | 人物索引与卡的消费者、卡片长度要求 | 消费者按报告核对，不新增字段 |

## Decision

`roles:index` + `role:*` 是唯一人物权威：

- `facts.readCards` 读角色卡，返回 `{ name, tier }`；whitelist 从卡名与既有 landed 内容派生；
- `context/brief`、`context/composer`、`context/contract` 删除六字段 fallback；longform 无卡时人物段为空，不回退；
- `state-check`、`state-settle` 的卡名来自角色卡；
- `domain/bible` 删除 `characters` 真值与 `parseCharacters`，`BIBLE_FILES` 只剩 world/style/plan/intent；
- `storage/repositories/shared.ts` 的默认真值、`catalog` 的导入分支、`recovery` 的 characters 行、客户端人物标签与模板同步删除。

`bible:characters` 的读写现在返回 `bible-invalid`；short/script 没有角色卡时不要求人物段（本项非目标）。

## Alternatives considered

- **保留 `bible:characters` 作为短篇/剧本的兼容路径。** 最强理由是少改面板与导出；但本项目没有旧作品、短篇/剧本尚未实现，保留会继续产生第二套人物权威。
- **只把 minor 加进 whitelist，不动六字段。** 最强理由是改动最小；但 brief/context 仍可能读六字段，人物权威仍不唯一。
- **把六字段合并进角色卡字段。** 最强理由是统一数据；但角色卡合同已按参考实现确定，合并会改字段合同。

## Consequences

- **收益**：人物来源收敛到角色索引与卡；minor 与 major 走同一路径；`bible` 不再保存第二套人物。
- **代价与已知上限**：short/script 目前没有人物段，这是非目标；面板 bible 编辑器只显示四个真值；真实 brief trace 尚未采集，所以 `capabilities.yaml` 的 `cast.single-authority` 仍保持 `missing`，等待一次真实 longform 章纲 brief 回执。
- **触发重访**：short/script 需要角色消费、或 `roles:index` 字段合同变化时，重访本决定。

## Verification

```text
node storycraft/tests/context.test.mjs          # ALL CHECKS PASSED
node storycraft/tests/facts.test.mjs            # ALL CHECKS PASSED
node storycraft/tests/bible.test.mjs            # ALL CHECKS PASSED
node storycraft/tests/tools.test.mjs            # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e         # PASS: 98 unit files
npm run verify                                  # notes + capabilities
```

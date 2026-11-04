# Agent Note: 故事工坊：cast.single-authority 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `cast.single-authority`（[账本行](../../../../capabilities.yaml)）。账本行承载能力映射与状态；本 Note 承载范围、验收、证据与评审。

## Problem

作品里存在两套人物数据：

- `roles:index`（`name + tier`）与 `role:<slug>` 卡；
- `bible:characters` 的六字段小传。

`brief` 与 `composer` 在有角色卡时优先用卡，但 `facts.readCards`、`state-check`、`state-settle` 以及 `bible` 真值文件仍读六字段。真实作品 `N003` 的 `roles:index` 有 7 个 `major`、5 个 `minor`，但 `facts/context/brief` 仍可能退回六字段，minor 角色没有稳定进入 whitelist 与生成上下文。

本项把 `roles:index` + 卡变成唯一人物权威，删除六字段人物路径；不改角色卡字段，不做旧作品迁移。

## 对拍参考

| 参考证据 | 参考做法 | 我们的落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/utils/outline-paths.ts:60-127` | 角色索引只有 `name + tier`，卡按主要/次要目录，一人一卡 | 采纳：`roles:index` 是索引，`role:*` 是卡；`bible:characters` 不再存在 |
| `inkos-master/packages/core/src/forecast/context-builder.ts:59-62` | Composer/Planner/Writer 直接消费角色卡，按 major/minor 分组 | 采纳：brief/composer 只读卡；minor 不过滤 |
| `docs/report/inkos/inkos03.md:124`、`inkos04.md:31/61/71` | 人物索引与卡的消费者、卡片长度要求 | 消费者范围按报告核对，不新增字段 |

## Proposal

### 范围

1. `facts.readCards` 改读 `roles:index` 对应的 `role:*` 卡，返回 `{ name, tier, ...card }`；whitelist 只从卡名与既有 landed 内容派生。
2. `context/brief`、`context/composer`、`context/contract` 删除六字段 fallback：有索引/卡时用卡；无卡时人物段为空，不回退 `bible:characters`。
3. `state-check`、`state-settle` 的卡视图继续只用 `name`，来源改为角色卡。
4. `bible` 真值：从 `BIBLE_FILES`/`EDITABLE_BIBLE_FILES` 删除 `characters`；删除 `parseCharacters` 与 `bible/characters.json` 路径；`bible` 只保留 intent/plan/style/world 等非人物真值。
5. 清理 `recovery`、`export`、面板/目录中引用 `bible:characters` 的路径；`role:*` 卡继续由现有 `role_card` 消费者处理。

### 非目标

- 不改 `roles:index` / `role_card` 字段合同；
- 不改 major/minor 语义；
- 不做旧作品迁移与兼容；
- 不实现短篇/剧本的角色消费；
- 不改 `role_card` 的检索/导出行为。

### 行为与失败

- `roles:index` 缺失或与卡不 1:1：按现有 `foundation` 完整性错误处理，不退回六字段；
- 卡名为空、tier 与索引不一致：沿用现有 `artifact-invalid`；
- 没有角色卡的 longform 作品：人物段为空并在 trace 标 `absent`，不伪造人物；
- `bible:characters` 读写请求：按未知真值文件拒绝（`bible-invalid`），不再兼容。

### 真实证据

`artifacts/real-runs/cast.single-authority.json`：

```json
{
  "date": "YYYY-MM-DD",
  "sessionId": "session-...",
  "tests": { "passed": true },
  "receipts": [
    { "kind": "brief-trace", "characters": ["minor-name-1", "minor-name-2"], "source": "foundation/roles" },
    { "kind": "whitelist", "names": ["minor-name-1", "minor-name-2"], "source": "role-cards" },
    { "kind": "consumer-test", "path": "storycraft/tests/context.test.mjs", "ok": true }
  ]
}
```

真实会话优先取一次 longform 章纲 brief；没有新会话时允许引用既有 foundation 会话，但必须能证明 minor 进入 brief/context，否则保持 `missing`。

### 验证命令

```text
node storycraft/tests/context.test.mjs
node storycraft/tests/facts.test.mjs
node storycraft/tests/role-model.test.mjs
node storycraft/tests/state-check.test.mjs
npm run check-capabilities -- --write
npm run verify
```

## Alternatives considered

**保留 `bible:characters` 作为短篇/剧本的兼容路径。** 最强理由是少改面板与导出；但本项目没有旧作品、短篇/剧本尚未实现，保留会继续产生第二套人物权威，故不采用。

**只把 minor 加进 whitelist，不动六字段。** 最强理由是改动最小；但 brief/context 仍可能读六字段，人物权威仍不唯一，故不采用。

**把六字段合并进角色卡字段。** 最强理由是统一数据；但角色卡合同已经按参考实现确定，合并会改字段合同，超出本项。

## Acceptance criteria

1. `roles:index` + `role:*` 是唯一人物来源；代码中不存在 `bible:characters` 读取或 `characters` 真值文件；
2. `facts` 的 whitelist 与 state-check/settle 的卡名来自角色卡；minor 不被过滤；
3. longform 的 brief/composer 在有卡时使用卡，无卡时人物段为空且 trace 标 `absent`，不回退六字段；
4. `bible` 对 `characters` 的读写返回 `bible-invalid`；
5. context/facts/role-model/state-check 消费者测试通过；
6. 真实 brief trace 含至少一个 `minor` 角色名；
7. 回执写入 `artifacts/real-runs/cast.single-authority.json` 后，`check-capabilities -- --write` 将其置为 `verified`，`npm run verify` 通过。

## Plan Review

- Standards：账本承载状态，本 Note 承载工作项；不新增状态表；不保留兼容层。
- Spec：范围、非目标、失败行为与 minor 验收明确；真实证据不足时保持 `missing`。
- Architecture：人物权威收敛到 `roles:index`/`role:*`；facts/context/state 消费者同步迁移；bible 真值收缩，无新增模块。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 面板的 bible 编辑器、导出、恢复仍引用 `characters`，需要同步改；漏一处会导致运行时错误；
- 既有测试夹具用六字段人物，需改为角色卡 fixture；
- longform 作品没有卡时人物段为空，可能让 writer 缺少人物信息；这是“唯一权威”的预期行为，不用六字段兜底；
- 真实 brief trace 需要完整章纲；若拿不到，本项只能停在消费者测试与代码证据，不置 `verified`。

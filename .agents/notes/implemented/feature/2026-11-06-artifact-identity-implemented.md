# Agent Note: 故事工坊：artifact.identity 工作项

Status: implemented

工作项：`capabilities.yaml` 的 `artifact.identity`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 记录决定、证据与边界。

## Problem

artifact 只有 artifactId、revisionId 和内容；没有父 revision、checksum、字节数、current/superseded 状态。读取省略 revision 时按 rowid 取最后一行，不能证明“current”；跨作品隔离也没有测试。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/artifact-revisions.ts:14-70` | revision 含 parentRevisionId、path、contentType、status、checksum、byteLength、createdAt | SQLite artifact 行补 parent_revision_id、checksum、byte_length、status；path 改为虚拟地址 |
| `artifact-revisions.ts:71-110` | 新 current 写入后旧 current 变 superseded | 写入前把旧 current 标为 superseded，新行 current |
| `artifact-revisions.ts:111+` | promote 保留历史并切换 current | 读取省略 revision 时优先 status=current，显式 revision 精确读 |

## Decision

- `storage/db.ts` 的 artifact 表增加：
  - `parent_revision_id`
  - `checksum`
  - `byte_length`
  - `status`（`current` / `superseded`）
- `putArtifactOnDb`：
  - 取当前 current 作为 parent；
  - 旧 current 标 superseded；
  - 新行写 `sha256:<hex>` 与 UTF-8 字节数，status=current；
- `readArtifact`：
  - 省略 revision 读 current；
  - 显式 revision 读历史；
  - 返回 parent/checksum/byteLength/status；
- 旧工作库缺列由 `assertWorkShape` 抛 `schema-version-mismatch`，不做迁移。

## Alternatives considered

- **保持 rowid 最后一行作为 current。** 最强理由是实现简单；但写入顺序不等于 current，历史 revision 与新 current 无法区分，故不采用。
- **重建 artifacts 文件目录。** 最强理由是贴近源工程路径；但本复刻已选 SQLite，虚拟地址已足够，故不采用。
- **只补测试不改字段。** 最强理由是不动 schema；但源工程的 parent/checksum/status 是身份的一部分，缺失无法证明版本，故不采用。

## Consequences

- **收益**：revision 有父子链、内容校验、字节数与 current 状态；读取语义稳定；跨作品仍由作品库边界隔离。
- **代价**：旧作品库直接 schema 拒绝；测试作品重建。
- **边界**：虚拟路径只用于读取，不落成文件路径；artifact kind 列表不变。

## Verification

```text
node storycraft/tests/artifact-identity.test.mjs   # ALL CHECKS PASSED
node storycraft/scripts/ci.mjs --no-e2e            # PASS: 101 unit files
npm run verify                                     # 39 capabilities: 9 verified, 30 missing
```

真实 e2e fixture 的 `示例短篇` 作品：

- `outline`：parent `6662284075da`，checksum `sha256:…e86e`，byteLength 87，status current；
- `plan:1`：checksum `sha256:…d71b85`，byteLength 139，status current。

回执：`artifacts/real-runs/artifact.identity.json`。

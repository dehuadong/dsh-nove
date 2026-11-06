# Agent Note: 故事工坊：artifact.identity 工作项

Status: proposed

工作项：`capabilities.yaml` 的 `artifact.identity`（[账本行](../../../../capabilities.yaml)）。账本行承载能力状态；本 Note 承载范围、验收、证据与评审。

## Problem

`artifact.identity` 标题是“虚拟路径、artifactId/revision、跨作品隔离”，当前实现只有：

- `artifact-contract.ts` 的 artifactId 正则与 typed kind 身份；
- `artifact-store.ts` 的 `artifactRevision()` 内容哈希；
- 每部作品一个 SQLite 库，跨作品天然分库。

没有证据证明：

- revision 的父子链、checksum、byteLength、status 与源工程一致；
- 虚拟路径能稳定解析到 `artifactId@revisionId`；
- 同一 artifactId 在另一部作品里不会命中；
- 非法路径（`..`、斜杠、空 revision）会被拒绝。

## 源工程证据

| 源工程证据 | 源工程行为 | 复刻落点与裁决 |
|---|---|---|
| `inkos-master/packages/core/src/harness/artifact-revisions.ts:14-70` | revision 含 `id`、`parentRevisionId`、`path`、`contentType`、`status`、`checksum: sha256:...`、`byteLength`、`createdAt`；路径为 `artifacts/<artifactId>/revisions/<revisionId><ext>` | 复刻 SQLite 表需保留父子、checksum、字节数、status；路径改为虚拟地址，但身份字段不能丢 |
| `artifact-revisions.ts:71-110` | 当前 revision 用 `status=current`，旧 current 变 `superseded` | 复刻需要 current/superseded 状态，而不是只靠最大 revisionId |
| `artifact-revisions.ts:111+` | promote 会切换 current，保留旧 revision | 复刻的 `putArtifact` 需要可查询 current 与历史 |
| `artifact-revisions.ts:1-13` | artifactId/kind/revisionId 由 schema 校验，路径是项目内相对路径 | 复刻 artifactId 不允许路径字符；虚拟路径只作为读取地址，不落成可穿越的文件名 |

## Proposal

### 范围

- `artifact-contract.ts`：`validateArtifactRecord` 增加 `parentRevisionId`、`checksum`、`byteLength`、`status`（可选或必填按源字段）；
- `artifact-store.ts`：`putArtifactOnDb` 计算 `sha256` 与 `byteLength`，写 current/superseded；
- `storage/db.ts`：artifact 表增加对应列，旧库直接 `schema-version-mismatch`（无迁移）；
- 读取侧：虚拟路径解析 `artifact:<artifactId>@<revisionId>`，`revisionId` 省略时读 current；
- 跨作品：同一 artifactId 在另一作品库读取必须 `artifact-not-found`；
- 消费者测试覆盖父子链、checksum、current 切换、跨作品隔离与非法路径。

### 非目标

- 不实现文件系统 artifact 目录（SQLite 是复刻存储，路径是虚拟地址）；
- 不改 artifact kind 列表；
- 不实现 export/backup 的产物路径。

### 失败行为

- artifactId 含 `/`、`\`、`..`、空白或大写 → `artifact-invalid`；
- revisionId 不存在 → `artifact-not-found`；
- 同 artifact 同 revision 重复写 → `artifact-revision-exists`；
- 跨作品读取 → `artifact-not-found`，不返回另一库内容。

### 真实证据

`artifacts/real-runs/artifact.identity.json`：

```json
{
  "date": "YYYY-MM-DD",
  "sessionId": "session-...",
  "tests": { "passed": true },
  "receipts": [
    { "kind": "artifact-read", "artifactId": "plan:1", "revisionId": "r...", "ok": true },
    { "kind": "cross-work", "artifactId": "plan:1", "otherWork": "...", "error": "artifact-not-found" },
    { "kind": "current-revision", "artifactId": "chapter:1", "current": "r...", "ok": true }
  ]
}
```

## Alternatives considered

**保持当前 contract 校验，只补测试。** 最强理由是代码已能读写；但源工程的 parent/checksum/byteLength/status 缺失，无法证明 revision 身份与当前版本，故不采用。

**用文件系统重建 artifacts 目录。** 最强理由是更贴近源工程路径；但本项目已选 SQLite 存储，虚拟路径是机制等价，故不重建文件树。

**把 revisionId 只当自增序号。** 最强理由是简单；但源工程 revision 是内容寻址（checksum），自增无法校验内容一致，故不采用。

## Acceptance criteria

1. artifactId 非法字符/路径被拒绝；
2. revision 写入含 parentRevisionId、sha256 checksum、byteLength、status；
3. 新 current 写入后旧 current 变 superseded；
4. 按 `artifactId@revisionId` 读取精确 revision，省略 revision 读 current；
5. 同一 artifactId 在另一作品读取返回 `artifact-not-found`；
6. 消费者测试与真实回执齐全后，`check-capabilities --write` 置 `verified`。

## Plan Review

- Standards：先补身份字段与测试，不扩 artifact kind；SQLite 存储保持。
- Spec：路径、revision、current、跨作品都可观察；失败码明确。
- Architecture：虚拟路径是读取地址，不是落盘文件名；跨作品隔离靠作品库边界。
- 结论：通过，进入实施需 implement 授权。

## Risks

- 现有 artifact 表字段少，增列会触发旧库 schema 拒绝；测试作品重建，不做迁移；
- current/superseded 切换若与 review/revise 写入顺序冲突，需要区分 producer；
- 真实回执需要一次真实作品读写，不能只靠单元测试。

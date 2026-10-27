/** Immutable artifact registry: contract validation plus SQLite persistence. */

import { StoryError, SUMMARY_FIELDS, SUMMARY_MAX_CHARS, chapterNumber, contentVersion, now } from './domain.ts'
import { ARTIFACT_IDENTITY, validateArtifactRecord, validateChapterMemo, validateChapterMeta, validateChapterSummary } from './artifact-contract.ts'
import { openWork, touchMeta, transaction } from './db.ts'
import { syncSearchDoc } from './search-index.ts'
import { reviewInputOf } from './review-binding.ts'

function serialize(content: any) {
  if (typeof content === 'string') return { contentType: 'text', text: content }
  return { contentType: 'json', text: JSON.stringify(content) }
}

function deserialize(row: any) {
  return row.content_type === 'json' ? JSON.parse(String(row.content)) : String(row.content)
}

/** Canonical revisionId of one artifact content: the hash of its stored bytes. */
export function artifactRevision(content: any) {
  return contentVersion(serialize(content).text)
}

/**
 * Store one immutable artifact revision on a caller-owned handle and transaction.
 * A summary may be written on a settled chapter (it describes the final body),
 * so the settled guard is opt-out for that producer only.
 * @param {object} db - open work database.
 * @param {object} input - artifact record.
 * @param {{allowSettled?: boolean}} [options] - producer options.
 * @returns {object} stored artifact identity.
 */
export function putArtifactOnDb(db: any, input: any, options: any = {}) {
  const envelope = validateArtifactRecord(input)
  const { contentType, text } = serialize(envelope.content)
  const at = envelope.createdAt
  const chapter = envelope.scope?.chapter
  // Diagnostics traces may be written before the chapter row exists (foundation
  // stages run at work level); they are not chapter artifacts for that reason.
  if (chapter !== undefined && !(envelope.kind === 'trace' && envelope.artifactId === 'trace:1:architect')) {
    const row = db.prepare('SELECT stage FROM chapters WHERE number = ?').get(chapter)
    if (row === undefined) throw new StoryError('chapter-not-found', `没有第 ${chapter} 章：不能写章节 artifact`)
    if (row.stage === 'settled' && !(options.allowSettled === true && (envelope.kind === 'summary' || envelope.kind === 'trace'))) {
      throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：先 reopen 再写章节 artifact`)
    }
  }
  const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
    .get(envelope.artifactId, envelope.revisionId)
  if (existing !== undefined) throw new StoryError('artifact-revision-exists', `artifact revision 已存在：${envelope.artifactId}@${envelope.revisionId}`)
  db.prepare(`INSERT INTO artifacts
    (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at, input_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(envelope.artifactId, envelope.revisionId, envelope.kind,
      envelope.scope?.chapter ?? null, contentType, text, envelope.provenance, at,
      typeof options.inputRevision === 'string' ? options.inputRevision : null)
  // A new memo revision invalidates the author's earlier confirmation.
  if (envelope.kind === 'plan' && chapter !== undefined) {
    db.prepare('UPDATE chapters SET plan_approved_at = NULL, plan_revision = NULL, plan_approved_source = NULL, updated_at = ? WHERE number = ?')
      .run(now(), chapter)
  }
  if (options.search !== undefined) {
    syncSearchDoc(db, options.search.docId, options.search.kind, options.search.source,
      options.search.chapter ?? 0, options.search.text)
  }
  touchMeta(db)
  return {
    workId: envelope.workId,
    artifact: {
      artifactId: envelope.artifactId,
      revisionId: envelope.revisionId,
      kind: envelope.kind,
      ...(envelope.scope === undefined ? {} : { scope: envelope.scope }),
    },
  }
}

/** Store one immutable artifact revision. */
export function putArtifact(root: any, input: any, options: any = {}) {
  const envelope = validateArtifactRecord(input)
  const db = openWork(root, String(envelope.workId))
  try {
    return transaction(db, () => putArtifactOnDb(db, envelope, options))
  } finally {
    db.close()
  }
}

/**
 * Record one context/brief assembly as a `trace:<chapter>:<role>` revision.
 *
 * Re-assembling identical content is an idempotent success: the revision hash
 * already exists, so nothing new is written and the existing identity returns.
 * @param root - workspace directory.
 * @param input - work, chapter, role and the trace content.
 * @returns stored artifact identity.
 */
export function writeContextTrace(root: any, input: {
  work: string
  chapter: number
  role: string
  trace: object
}): { artifactId: string, revisionId: string } {
  const artifactId = `trace:${input.chapter}:${input.role}`
  const content = { ...input.trace, chapter: input.chapter }
  const revisionId = artifactRevision(content)
  try {
    const stored = putArtifact(root, {
      workId: input.work,
      artifactId,
      kind: 'trace',
      scope: { chapter: input.chapter },
      revisionId,
      content,
      provenance: 'generated',
      createdAt: now(),
    }, { allowSettled: true })
    return { artifactId: stored.artifact.artifactId, revisionId: stored.artifact.revisionId }
  } catch (error) {
    // A repeat assembly with the same content is not an error: the revision exists.
    const code = (error as { code?: unknown } | null | undefined)?.code
    if (code === 'artifact-revision-exists') return { artifactId, revisionId }
    throw error
  }
}

/** Read one revision, or the latest revision when revisionId is omitted. */
export function readArtifact(root: any, input: any) {
  const workId = String(input.work)
  const artifactId = String(input.artifactId)
  const db = openWork(root, workId)
  try {
    const row = input.revisionId === undefined
      ? db.prepare('SELECT * FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1').get(artifactId)
      : db.prepare('SELECT * FROM artifacts WHERE artifact_id = ? AND revision_id = ?').get(artifactId, String(input.revisionId))
    if (row === undefined) {
      if (input.revisionId !== undefined) {
        throw new StoryError('revision-not-found', `没有 revision：${artifactId}@${input.revisionId}`)
      }
      throw new StoryError('artifact-not-found', `没有 artifact：${artifactId}`)
    }
    return {
      workId,
      artifact: {
        artifactId: row.artifact_id,
        revisionId: row.revision_id,
        kind: row.kind,
        ...(row.scope_chapter === null ? {} : { scope: { chapter: row.scope_chapter } }),
        provenance: row.provenance,
        createdAt: row.created_at,
        content: deserialize(row),
      },
    }
  } finally {
    db.close()
  }
}

/** List the latest revision of each artifact, optionally filtered by kind. */
export function listArtifacts(root: any, input: any) {
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    const rows = input.kind === undefined
      ? db.prepare(`SELECT a.* FROM artifacts a
        JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts GROUP BY artifact_id) latest
        ON a.rowid = latest.rowid ORDER BY a.artifact_id`).all()
      : db.prepare(`SELECT a.* FROM artifacts a
        JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts WHERE kind = ? GROUP BY artifact_id) latest
        ON a.rowid = latest.rowid ORDER BY a.artifact_id`).all(String(input.kind))
    return {
      workId,
      artifacts: rows.map(row => ({
        artifactId: row.artifact_id,
        revisionId: row.revision_id,
        kind: row.kind,
        ...(row.scope_chapter === null ? {} : { scope: { chapter: row.scope_chapter } }),
        provenance: row.provenance,
        createdAt: row.created_at,
      })),
    }
  } finally {
    db.close()
  }
}

/** One typed write: fill the canonical ID, kind and content-hash revision. */
function writeTyped(root: any, input: any) {
  return putArtifact(root, {
    workId: String(input.work),
    artifactId: input.artifactId,
    kind: input.kind,
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    revisionId: artifactRevision(input.content),
    content: input.content,
    provenance: input.provenance ?? 'generated',
    createdAt: input.createdAt ?? now(),
  }, input.search === undefined ? {} : { search: input.search })
}

/** One typed read that refuses a mismatching kind. */
function readTyped(root: any, input: any, expected: any) {
  const result = readArtifact(root, {
    work: input.work,
    artifactId: expected.artifactId,
    ...(input.revisionId === undefined ? {} : { revisionId: input.revisionId }),
  })
  if (result.artifact.kind !== expected.kind) {
    throw new StoryError('artifact-kind-mismatch',
      `${expected.artifactId} 的 kind 是 ${result.artifact.kind}，不是 ${expected.kind}`)
  }
  return result
}

/** Foundation documents: the name → kind map; artifact IDs stay in the contract. */
const FOUNDATION_KINDS = Object.freeze({
  story_frame: 'story_frame',
  volume_map: 'volume_map',
  book_rules: 'book_rules',
  roles_index: 'role_index',
})

export const FOUNDATION_DOCUMENTS = Object.freeze(Object.fromEntries(
  Object.entries(FOUNDATION_KINDS).map(([name, kind]) => [name, { kind, artifactId: ARTIFACT_IDENTITY[kind].artifactId }]),
))

function foundationDocument(name: any) {
  const document = FOUNDATION_DOCUMENTS[name]
  if (document === undefined) {
    throw new StoryError('artifact-invalid', `未知的 foundation 文档名：${String(name)}`)
  }
  return document
}

/**
 * Write one foundation document (story_frame, volume_map, book_rules or the
 * roles index). Content is validated by the artifact contract.
 */
export function writeFoundationDocument(root: any, input: any) {
  const document = foundationDocument(input.name)
  const text = renderFoundationContent(input.content)
  return writeTyped(root, {
    work: input.work,
    artifactId: document.artifactId,
    kind: document.kind,
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
    search: {
      docId: document.artifactId,
      kind: document.kind,
      source: `foundation/${input.name === 'roles_index' ? 'roles/index' : input.name}`,
      text,
    },
  })
}

/** Read one foundation document, latest or an explicit revision. */
export function readFoundationDocument(root: any, input: any) {
  return readTyped(root, input, foundationDocument(input.name))
}

/** Write one role card; the contract binds `role:<slug>` to content.slug. */
export function writeRoleCard(root: any, input: any) {
  const segment = String(input.role ?? input.content?.slug ?? '').trim()
  return writeTyped(root, {
    work: input.work,
    artifactId: `role:${segment}`,
    kind: 'role_card',
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
    search: {
      docId: `role:${segment}`,
      kind: 'role_card',
      source: `foundation/roles/${segment}`,
      text: typeof input.content?.markdown === 'string' && input.content.markdown.trim() !== ''
        ? input.content.markdown
        : JSON.stringify(input.content),
    },
  })
}

/** Render foundation artifact content: Markdown string or its readable `markdown` field. */
export function renderFoundationContent(content: any) {
  if (typeof content === 'string') return content
  if (content !== null && typeof content === 'object' && typeof content.markdown === 'string') return content.markdown
  return content === undefined ? '' : JSON.stringify(content)
}

/** Read one role card by its `role:<slug>` identity. */
export function readRoleCard(root: any, input: any) {
  const segment = String(input.role ?? input.slug ?? '').trim()
  return readTyped(root, input, { artifactId: `role:${segment}`, kind: 'role_card' })
}

/** Latest foundation documents in one read, for brief/context/export consumers. */
export function readFoundationDocuments(root: any, work: any) {
  const db = openWork(root, String(work))
  try {
    const read = (artifactId: any) => {
      const row = db.prepare('SELECT content_type, content, revision_id, created_at FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
        .get(artifactId)
      if (row === undefined) return undefined
      const content = row.content_type === 'json' ? JSON.parse(String(row.content)) : String(row.content)
      return { content, version: row.revision_id, createdAt: row.created_at }
    }
    return {
      storyFrame: read('bible:story_frame'),
      volumeMap: read('bible:volume_map'),
      bookRules: read('bible:book_rules'),
      rolesIndex: read('roles:index'),
      currentFocus: read('bible:current_focus'),
    }
  } finally {
    db.close()
  }
}

/** Latest role cards of one work, ascending by artifact id. */
export function listRoleCards(root: any, work: any) {
  const db = openWork(root, String(work))
  try {
    const rows = db.prepare(`SELECT a.artifact_id, a.content_type, a.content, a.revision_id FROM artifacts a
      JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts
        WHERE kind = 'role_card' GROUP BY artifact_id) latest ON a.rowid = latest.rowid
      ORDER BY a.artifact_id`).all()
    return rows.map(row => ({
      artifactId: row.artifact_id,
      revisionId: row.revision_id,
      content: row.content_type === 'json' ? JSON.parse(String(row.content)) : String(row.content),
    }))
  } finally {
    db.close()
  }
}

/** One form artifact write: `<prefix>:<id>` with content-hash revision. */
function writeFormArtifact(root: any, input: any, prefix: any, kind: any) {
  return writeTyped(root, {
    work: input.work,
    artifactId: `${prefix}:${String(input.id ?? '').trim()}`,
    kind,
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
  })
}

/** One form artifact read by `<prefix>:<id>`. */
function readFormArtifact(root: any, input: any, prefix: any, kind: any) {
  return readTyped(root, input, { artifactId: `${prefix}:${String(input.id ?? '').trim()}`, kind })
}

/** Write one short story as `short:<id>`; it never maps to a chapter row. */
export function writeShortStory(root: any, input: any) {
  return writeFormArtifact(root, input, 'short', 'short_story')
}

/** Read one short story, latest or an explicit revision. */
export function readShortStory(root: any, input: any) {
  return readFormArtifact(root, input, 'short', 'short_story')
}

/** Write one script as `script:<id>`; it never maps to a chapter row. */
export function writeScript(root: any, input: any) {
  return writeFormArtifact(root, input, 'script', 'script')
}

/** Read one script, latest or an explicit revision. */
export function readScript(root: any, input: any) {
  return readFormArtifact(root, input, 'script', 'script')
}

/** Render a structured ChapterMemo as the text view old consumers expect. */
export function renderChapterMemo(memo: any) {
  if (memo === null || typeof memo !== 'object'
    || typeof memo.goal !== 'string' || memo.goal === ''
    || typeof memo.body !== 'string' || memo.body === '') {
    throw new StoryError('artifact-invalid', 'ChapterMemo 需要非空 goal 与 body')
  }
  const lines = [`# 第 ${memo.chapter} 章 章纲`, '']
  if (memo.perspective !== undefined && memo.perspective !== '') lines.push(`- 视角：${memo.perspective}`)
  lines.push(`- 目标：${memo.goal}`)
  if (memo.obstacle !== undefined && memo.obstacle !== '') lines.push(`- 阻力：${memo.obstacle}`)
  if (memo.cost !== undefined && memo.cost !== '') lines.push(`- 代价：${memo.cost}`)
  if (memo.turn !== undefined && memo.turn !== '') lines.push(`- 结尾变化：${memo.turn}`)
  if (Array.isArray(memo.threadRefs) && memo.threadRefs.length > 0) lines.push(`- 伏笔：${memo.threadRefs.join('、')}`)
  lines.push('', '## 章纲正文', memo.body)
  return `${lines.join('\n')}\n`
}

/**
 * Write one chapter memo on a caller-owned handle. Identical latest content is
 * an idempotent no-op; a different content writes a new revision and clears
 * the author's earlier confirmation.
 */
export function writeChapterMemoOnDb(db: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  const content = input.content
  const entry = db.prepare('SELECT stage FROM chapters WHERE number = ?').get(chapter)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${chapter} 章：不能写章节 artifact`)
  if (entry.stage === 'settled') {
    throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：先 reopen 再写章节 artifact`)
  }
  const revisionId = artifactRevision(content)
  const latest = db.prepare(`SELECT revision_id FROM artifacts
    WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${chapter}`)
  if (latest?.revision_id === revisionId) {
    return {
      workId: String(input.work),
      artifact: { artifactId: `plan:${chapter}`, revisionId, kind: 'plan', scope: { chapter } },
    }
  }
  return putArtifactOnDb(db, {
    workId: String(input.work),
    artifactId: `plan:${chapter}`,
    kind: 'plan',
    scope: { chapter },
    revisionId,
    content,
    provenance: input.provenance ?? 'generated',
    createdAt: input.createdAt ?? now(),
  })
}

/** Write one chapter memo as `plan:<n>`, scoped to that chapter. */
export function writeChapterMemo(root: any, input: any) {
  const workId = String(input.work)
  const db = openWork(root, workId)
  try {
    return transaction(db, () => writeChapterMemoOnDb(db, input))
  } finally {
    db.close()
  }
}

/**
 * Move/delete chapter-scoped artifacts after a chapter renumber.
 * Only the latest revision survives; affected approvals are cleared.
 */
export function remapChapterArtifacts(db: any, input: any) {
  const mapping = input.mapping
  const deleted = new Set(input.deleted ?? [])
  const affected = new Set([
    ...deleted,
    ...[...mapping.entries()].filter(([oldNumber, newNumber]) => oldNumber !== newNumber).map(([oldNumber]) => oldNumber),
  ])
  if (affected.size === 0) return { moved: 0, deleted: 0 }
  const numbers = [...affected]
  const rows = db.prepare(`SELECT * FROM artifacts
    WHERE scope_chapter IN (${numbers.map(() => '?').join(', ')}) ORDER BY rowid`).all(...numbers)
  const latest = new Map()
  for (const row of rows) latest.set(row.artifact_id, row)
  const order = { plan: 0, summary: 1, review: 2, trace: 3 }
  const ordered = [...latest.values()].sort((left, right) => ((order as Record<string, number>)[left.kind] ?? 9) - ((order as Record<string, number>)[right.kind] ?? 9))
  const deletions = new Set()
  const inserts = []
  const planRevisions = new Map()
  const planTargets = new Map()
  let deletedCount = 0

  for (const row of ordered) {
    const oldNumber = row.scope_chapter
    const newNumber = mapping.get(oldNumber)
    if (newNumber === undefined) {
      deletions.add(row.artifact_id)
      if (row.kind === 'plan') planTargets.set(row.artifact_id, null)
      deletedCount += 1
      continue
    }
    if (newNumber === oldNumber) continue
    const content = deserialize(row)
    let nextId = row.artifact_id
    if (row.kind === 'plan' && row.artifact_id === `plan:${oldNumber}`) nextId = `plan:${newNumber}`
    if (row.kind === 'summary' && row.artifact_id === `summary:${oldNumber}`) nextId = `summary:${newNumber}`
    if (row.kind === 'review' && row.artifact_id.startsWith(`review:${oldNumber}:`)) {
      nextId = `review:${newNumber}:${row.artifact_id.slice(`review:${oldNumber}:`.length)}`
    }
    if (row.kind === 'trace' && row.artifact_id.startsWith(`trace:${oldNumber}:`)) {
      nextId = `trace:${newNumber}:${row.artifact_id.slice(`trace:${oldNumber}:`.length)}`
    }
    if (row.kind === 'plan' || row.kind === 'summary' || row.kind === 'trace') content.chapter = newNumber
    if (row.kind === 'review' && Array.isArray(content.observations)) {
      for (const observation of content.observations) {
        if (observation?.target?.artifactId?.startsWith('plan:')) {
          const oldPlan = Number(observation.target.artifactId.slice('plan:'.length))
          const nextPlan = mapping.get(oldPlan)
          if (nextPlan === undefined) {
            delete observation.target
          } else {
            observation.target.artifactId = `plan:${nextPlan}`
            observation.target.revisionId = planRevisions.get(`plan:${nextPlan}`) ?? observation.target.revisionId
          }
        }
        for (const ref of Array.isArray(observation?.sourceRefs) ? observation.sourceRefs : []) {
          if (typeof ref.sourceId !== 'string') continue
          if (ref.sourceId.startsWith('plan:')) {
            const oldPlan = Number(ref.sourceId.slice('plan:'.length))
            const nextPlan = mapping.get(oldPlan)
            if (nextPlan !== undefined) ref.sourceId = `plan:${nextPlan}`
          } else if (ref.sourceId === `chapter:${oldNumber}`) {
            ref.sourceId = `chapter:${newNumber}`
          } else if (ref.sourceId.startsWith(`chapter:${oldNumber}:`)) {
            ref.sourceId = `chapter:${newNumber}:${ref.sourceId.slice(`chapter:${oldNumber}:`.length)}`
          }
        }
      }
    }
    const revisionId = artifactRevision(content)
    if (row.kind === 'plan') {
      planRevisions.set(nextId, revisionId)
      planTargets.set(row.artifact_id, { id: nextId, revisionId })
    }
    deletions.add(row.artifact_id)
    inserts.push({ row, nextId, revisionId, content, scope: newNumber })
  }

  if (deletions.size > 0) {
    db.prepare(`DELETE FROM artifacts WHERE artifact_id IN (${[...deletions].map(() => '?').join(', ')})`)
      .run(...deletions)
  }
  for (const item of inserts) {
    const existing = db.prepare('SELECT content_type, content FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
      .get(item.nextId, item.revisionId)
    if (existing !== undefined) {
      const nextText = serialize(item.content).text
      if (existing.content_type !== serialize(item.content).contentType || existing.content !== nextText) {
        throw new StoryError('chapter-remap-conflict', `重映射目标已存在不同内容：${item.nextId}@${item.revisionId}`)
      }
      continue
    }
    const { contentType, text } = serialize(item.content)
    db.prepare(`INSERT INTO artifacts
      (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at, input_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.nextId, item.revisionId, item.row.kind, item.scope,
        contentType, text, item.row.provenance, item.row.created_at, item.row.input_revision ?? null)
  }
  // Reviews in identity chapters may target a memo that moved or disappeared.
  const identityReviewRows = db.prepare(`SELECT a.* FROM artifacts a
    JOIN (SELECT artifact_id, max(rowid) AS rowid FROM artifacts WHERE kind = 'review' GROUP BY artifact_id) latest
    ON a.rowid = latest.rowid
    WHERE a.kind = 'review' AND (a.scope_chapter IS NULL OR a.scope_chapter NOT IN (${numbers.map(() => '?').join(', ')}))`)
    .all(...numbers)
  for (const row of identityReviewRows) {
    const content = deserialize(row)
    let changed = false
    for (const observation of Array.isArray(content.observations) ? content.observations : []) {
      const target = observation?.target
      if (target === undefined || typeof target.artifactId !== 'string') continue
      if (!planTargets.has(target.artifactId)) continue
      const next = planTargets.get(target.artifactId)
      if (next === null) delete observation.target
      else {
        target.artifactId = next.id
        target.revisionId = next.revisionId
      }
      changed = true
    }
    if (!changed) continue
    const revisionId = artifactRevision(content)
    const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
      .get(row.artifact_id, revisionId)
    if (existing !== undefined) continue
    const { contentType, text } = serialize(content)
    db.prepare(`INSERT INTO artifacts
      (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at, input_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.artifact_id, revisionId, row.kind, row.scope_chapter, contentType, text, row.provenance, row.created_at, row.input_revision ?? null)
  }
  for (const [oldNumber, newNumber] of mapping) {
    if (oldNumber === newNumber) continue
    db.prepare('UPDATE chapters SET plan_approved_at = NULL, plan_revision = NULL WHERE number = ?').run(newNumber)
  }
  return { moved: inserts.length, deleted: deletedCount }
}

/** Read one chapter memo, latest or an explicit revision. */
export function readChapterMemo(root: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  let result
  try {
    result = readTyped(root, input, { artifactId: `plan:${chapter}`, kind: 'plan' })
    validateChapterMemo(result.artifact.content)
  } catch (error) {
    if (error instanceof SyntaxError) throw new StoryError('artifact-invalid', `plan:${chapter} 的 memo JSON 无法解析`)
    if ((error as any)?.code === 'artifact-invalid') throw error
    if ((error as any)?.code === undefined) throw new StoryError('artifact-invalid', `plan:${chapter} 的 memo 内容不符合 ChapterMemo 合同`)
    throw error
  }
  return result
}

/** Write one structured chapter summary as `summary:<n>`. */
export function writeChapterSummary(root: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  return writeTyped(root, {
    work: input.work,
    artifactId: `summary:${chapter}`,
    kind: 'summary',
    scope: { chapter },
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
  })
}

/** Read one structured chapter summary, latest or an explicit revision. */
export function readChapterSummary(root: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  return readTyped(root, input, { artifactId: `summary:${chapter}`, kind: 'summary' })
}

/** Per-field cap of a structured summary field, in code points. */
const SUMMARY_FIELD_LIMIT = 120

/** Clip one string to a code-point limit. */
function clipPoints(text: any, limit: any) {
  const points = [...String(text ?? '')]
  return points.length > limit ? points.slice(0, limit).join('') : String(text ?? '')
}

/**
 * Normalize and validate one ChapterSummary. `chapter` and `bodyRevision` are
 * host-owned identity fields; structured fields are clipped, not rejected.
 * @param {object} input - raw payload or content.
 * @param {number} chapter - chapter number.
 * @param {number} bodyRevision - body revision the summary describes.
 * @returns {object} contract-valid ChapterSummary.
 */
export function normalizeChapterSummary(input: any, chapter: any, bodyRevision: any) {
  const content = { chapter, bodyRevision, rawText: clipPoints(input?.rawText ?? '', SUMMARY_MAX_CHARS).trim() }
  for (const field of SUMMARY_FIELDS) (content as Record<string, any>)[field] = clipPoints(input?.[field] ?? '', SUMMARY_FIELD_LIMIT).trim()
  return validateChapterSummary(content)
}

/**
 * Write one ChapterSummary as `summary:<n>` on a caller-owned handle and
 * transaction. Identical latest content is an idempotent no-op.
 * @param {object} db - open work database.
 * @param {{work: string, chapter: number, bodyRevision: number, content: object, provenance?: string, createdAt?: string}} input - write input.
 * @returns {{artifactId: string, revisionId: string, content: object, created: boolean}} written artifact.
 */
export function writeChapterSummaryOnDb(db: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  const content = normalizeChapterSummary(input.content, chapter, input.bodyRevision)
  const artifactId = `summary:${chapter}`
  const revisionId = artifactRevision(content)
  const latest = db.prepare('SELECT revision_id FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1').get(artifactId)
  if (latest?.revision_id === revisionId) return { artifactId, revisionId, content, created: false }
  putArtifactOnDb(db, {
    workId: String(input.work),
    artifactId,
    kind: 'summary',
    scope: { chapter },
    revisionId,
    content,
    provenance: input.provenance ?? 'generated',
    createdAt: input.createdAt ?? now(),
  }, { allowSettled: true })
  return { artifactId, revisionId, content, created: true }
}

function positiveInteger(value: any, label: any) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new StoryError('artifact-invalid', `${label} 必须是正整数`)
  }
  return number
}

function compactText(value: any) {
  return String(value ?? '').replace(/\s+/gu, '')
}

/** Refuse an observation whose quote is not in the reviewed body or plan. */
function verifyObservationSources(root: any, work: any, chapter: any, bodyRevision: any, observations: any, handle?: any) {
  if (!Array.isArray(observations)) return
  const db = handle ?? openWork(root, String(work))
  try {
    if (db.prepare('SELECT 1 FROM chapters WHERE number = ?').get(chapter) === undefined) {
      throw new StoryError('chapter-not-found', `没有第 ${chapter} 章`)
    }
    const body = db.prepare('SELECT body FROM chapter_versions WHERE number = ? AND revision = ?')
      .get(chapter, bodyRevision)?.body
    if (body === undefined) throw new StoryError('body-not-found', `第 ${chapter} 章没有正文版本 r${bodyRevision}`)
    const memoRow = db.prepare(`SELECT content_type, content FROM artifacts
      WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${chapter}`)
    const bodyText = compactText(body)
    let memo
    if (memoRow?.content_type === 'json') {
      try {
        memo = JSON.parse(memoRow.content)
      } catch {
        throw new StoryError('artifact-invalid', `plan:${chapter} 的 memo JSON 无法解析`)
      }
    }
    const planText = memo === undefined ? '' : compactText(renderChapterMemo(memo))
    for (const [index, observation] of observations.entries()) {
      for (const [refIndex, ref] of (Array.isArray(observation?.sourceRefs) ? observation.sourceRefs : []).entries()) {
        const source = String(ref.sourceId)
        const haystack = source === `chapter:${chapter}` || source === `chapter:${chapter}:r${bodyRevision}`
          ? bodyText
          : source === `plan:${chapter}` ? planText : undefined
        if (haystack === undefined) {
          throw new StoryError('artifact-invalid', `observation[${index}].sourceRefs[${refIndex}] 引用未知来源：${source}`)
        }
        if (!haystack.includes(compactText(ref.quote))) {
          throw new StoryError('observation-source-unverified',
            `observation[${index}].sourceRefs[${refIndex}] 的引文不在 ${source} 中`)
        }
      }
    }
  } finally {
    if (handle === undefined) db.close()
  }
}

/**
 * Write one Markdown truth artifact (`bible:world`/`bible:style`/`bible:intent`/
 * `outline`) on a caller-owned handle and transaction. The same content is an
 * idempotent no-op; the content is stored and hashed exactly as given.
 * @param {object} db - open work database.
 * @param {{work: string, artifactId: string, kind: string, content: string, provenance?: string, createdAt?: string}} input - write input.
 * @returns {{artifactId: string, kind: string, revisionId: string, content: string, created: boolean}} written artifact.
 */
export function writeTextArtifactOnDb(db: any, input: any) {
  const content = String(input.content ?? '')
  const revisionId = artifactRevision(content)
  const latest = db.prepare('SELECT revision_id FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(input.artifactId)
  if (latest?.revision_id === revisionId) {
    return { artifactId: input.artifactId, kind: input.kind, revisionId, content, created: false }
  }
  // Reverting to an older text is a legitimate author action: move that exact
  // content revision to the end so it becomes the current one again. The
  // revisionId stays the content hash and history stays readable.
  const older = db.prepare('SELECT created_at, provenance FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
    .get(input.artifactId, revisionId)
  if (older !== undefined) {
    db.prepare('DELETE FROM artifacts WHERE artifact_id = ? AND revision_id = ?').run(input.artifactId, revisionId)
  }
  putArtifactOnDb(db, {
    workId: String(input.work),
    artifactId: input.artifactId,
    kind: input.kind,
    revisionId,
    content,
    provenance: older?.provenance ?? input.provenance ?? 'generated',
    createdAt: input.createdAt ?? now(),
  })
  return { artifactId: input.artifactId, kind: input.kind, revisionId, content, created: true }
}

/**
 * Read one truth artifact's latest or explicit revision.
 * @param {string} root - workspace directory.
 * @param {{work: string, artifactId: string, kind: string, revisionId?: string}} input - read input.
 * @returns {{artifact: object}} artifact payload.
 */
export function readTextArtifact(root: any, input: any) {
  return readTyped(root, input, { artifactId: input.artifactId, kind: input.kind })
}

/**
 * Read the latest content of one truth artifact.
 * @param {object} db - open work database.
 * @param {string} artifactId - artifact identity.
 * @returns {{content: string, version: string, updated_at: string}|undefined} entry.
 */
export function readTextArtifactOnDb(db: any, artifactId: any) {
  const row = db.prepare('SELECT content, revision_id, created_at FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(artifactId)
  return row === undefined
    ? undefined
    : { content: row.content, version: row.revision_id, updated_at: row.created_at }
}

/**
 * Write one review round's observations as `review:<n>:r<bodyRev>:<round>`.
 * Each observation is validated, including its source refs.
 */
export function writeChapterObservations(root: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  const bodyRevision = positiveInteger(input.bodyRevision, 'bodyRevision')
  const round = positiveInteger(input.round, 'round')
  verifyObservationSources(root, input.work, chapter, bodyRevision, input.observations)
  return writeTyped(root, {
    work: input.work,
    artifactId: `review:${chapter}:r${bodyRevision}:${round}`,
    kind: 'review',
    scope: { chapter },
    content: { observations: input.observations },
    provenance: input.provenance,
    createdAt: input.createdAt,
  })
}

/** Write one review round on a caller-owned handle and transaction. */
export function writeChapterObservationsOnDb(db: any, root: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  const bodyRevision = positiveInteger(input.bodyRevision, 'bodyRevision')
  const round = positiveInteger(input.round, 'round')
  verifyObservationSources(root, input.work, chapter, bodyRevision, input.observations, db)
  const artifactId = `review:${chapter}:r${bodyRevision}:${round}`
  const content = { observations: input.observations }
  putArtifactOnDb(db, {
    workId: String(input.work),
    artifactId,
    kind: 'review',
    scope: { chapter },
    revisionId: artifactRevision(content),
    content,
    provenance: input.provenance ?? 'generated',
    createdAt: input.createdAt ?? now(),
  }, { inputRevision: reviewInputOf(db, chapter) })
  return { artifactId, revision: round, revisionId: artifactRevision(content) }
}

/** Read one review round's observations by chapter, body revision and round. */
export function readChapterObservations(root: any, input: any) {
  const chapter = chapterNumber(input.chapter)
  const bodyRevision = positiveInteger(input.bodyRevision, 'bodyRevision')
  const round = positiveInteger(input.round, 'round')
  return readTyped(root, input, {
    artifactId: `review:${chapter}:r${bodyRevision}:${round}`,
    kind: 'review',
  })
}

/**
 * Project `chapter:<n>`'s metadata from the chapter row.
 *
 * `planRevision` is the memo revision the author confirmed; `observationIds`
 * list the review artifacts of this chapter (their contents arrive with the
 * observation contract).
 */
export function readChapterMeta(root: any, input: any) {
  const workId = String(input.work)
  const number = chapterNumber(input.chapter)
  const db = openWork(root, workId)
  try {
    const row = db.prepare('SELECT * FROM chapters WHERE number = ?').get(number)
    if (row === undefined) throw new StoryError('chapter-not-found', `没有第 ${number} 章`)
    const planRevision = row.plan_revision ?? undefined
    const observationIds = db.prepare(`SELECT artifact_id FROM artifacts
      WHERE kind = 'review' AND scope_chapter = ? ORDER BY rowid`).all(number).map(item => item.artifact_id)
    const meta = validateChapterMeta({
      number: row.number,
      title: row.title,
      wordCount: row.words,
      stage: row.stage,
      ...(row.plan_approved_at === null ? {} : { planApprovedAt: row.plan_approved_at }),
      ...(planRevision === undefined ? {} : { planRevision }),
      provenance: row.provenance ?? 'generated',
      observationIds,
    })
    return { workId, chapterMeta: meta }
  } finally {
    db.close()
  }
}

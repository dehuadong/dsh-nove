/** Immutable artifact registry: contract validation plus SQLite persistence. */

import { StoryError, chapterNumber, contentVersion, now } from './domain.js'
import { ARTIFACT_IDENTITY, validateArtifactRecord, validateChapterMeta } from './artifact-contract.js'
import { openWork, touchMeta, transaction } from './db.js'

function serialize(content) {
  if (typeof content === 'string') return { contentType: 'text', text: content }
  return { contentType: 'json', text: JSON.stringify(content) }
}

function deserialize(row) {
  return row.content_type === 'json' ? JSON.parse(row.content) : row.content
}

/** Canonical revisionId of one artifact content: the hash of its stored bytes. */
export function artifactRevision(content) {
  return contentVersion(serialize(content).text)
}

/** Store one immutable artifact revision. */
export function putArtifact(root, input) {
  const envelope = validateArtifactRecord(input)
  const { contentType, text } = serialize(envelope.content)
  const at = envelope.createdAt
  const db = openWork(root, String(envelope.workId))
  try {
    return transaction(db, () => {
      const chapter = envelope.scope?.chapter
      if (chapter !== undefined) {
        const row = db.prepare('SELECT stage FROM chapters WHERE number = ?').get(chapter)
        if (row === undefined) throw new StoryError('chapter-not-found', `没有第 ${chapter} 章：不能写章节 artifact`)
        if (row.stage === 'settled') {
          throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：先 reopen 再写章节 artifact`)
        }
      }
      const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
        .get(envelope.artifactId, envelope.revisionId)
      if (existing !== undefined) throw new StoryError('artifact-revision-exists', `artifact revision 已存在：${envelope.artifactId}@${envelope.revisionId}`)
      db.prepare(`INSERT INTO artifacts
        (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(envelope.artifactId, envelope.revisionId, envelope.kind,
          envelope.scope?.chapter ?? null, contentType, text, envelope.provenance, at)
      // A new memo revision invalidates the author's earlier confirmation.
      if (envelope.kind === 'plan' && chapter !== undefined) {
        db.prepare('UPDATE chapters SET plan_approved_at = NULL, plan_revision = NULL, updated_at = ? WHERE number = ?')
          .run(now(), chapter)
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
    })
  } finally {
    db.close()
  }
}

/** Read one revision, or the latest revision when revisionId is omitted. */
export function readArtifact(root, input) {
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
export function listArtifacts(root, input) {
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
function writeTyped(root, input) {
  return putArtifact(root, {
    workId: String(input.work),
    artifactId: input.artifactId,
    kind: input.kind,
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    revisionId: artifactRevision(input.content),
    content: input.content,
    provenance: input.provenance ?? 'generated',
    createdAt: input.createdAt ?? now(),
  })
}

/** One typed read that refuses a mismatching kind. */
function readTyped(root, input, expected) {
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

function foundationDocument(name) {
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
export function writeFoundationDocument(root, input) {
  const document = foundationDocument(input.name)
  return writeTyped(root, {
    work: input.work,
    artifactId: document.artifactId,
    kind: document.kind,
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
  })
}

/** Read one foundation document, latest or an explicit revision. */
export function readFoundationDocument(root, input) {
  return readTyped(root, input, foundationDocument(input.name))
}

/** Write one role card; the contract binds `role:<slug>` to content.slug. */
export function writeRoleCard(root, input) {
  const segment = String(input.role ?? input.content?.slug ?? '').trim()
  return writeTyped(root, {
    work: input.work,
    artifactId: `role:${segment}`,
    kind: 'role_card',
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
  })
}

/** Read one role card by its `role:<slug>` identity. */
export function readRoleCard(root, input) {
  const segment = String(input.role ?? input.slug ?? '').trim()
  return readTyped(root, input, { artifactId: `role:${segment}`, kind: 'role_card' })
}

/** Write one chapter memo as `plan:<n>`, scoped to that chapter. */
export function writeChapterMemo(root, input) {
  const chapter = chapterNumber(input.chapter)
  return writeTyped(root, {
    work: input.work,
    artifactId: `plan:${chapter}`,
    kind: 'plan',
    scope: { chapter },
    content: input.content,
    provenance: input.provenance,
    createdAt: input.createdAt,
  })
}

/** Read one chapter memo, latest or an explicit revision. */
export function readChapterMemo(root, input) {
  const chapter = chapterNumber(input.chapter)
  return readTyped(root, input, { artifactId: `plan:${chapter}`, kind: 'plan' })
}

/** Write one structured chapter summary as `summary:<n>`. */
export function writeChapterSummary(root, input) {
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
export function readChapterSummary(root, input) {
  const chapter = chapterNumber(input.chapter)
  return readTyped(root, input, { artifactId: `summary:${chapter}`, kind: 'summary' })
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new StoryError('artifact-invalid', `${label} 必须是正整数`)
  }
  return number
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/gu, '')
}

/** Refuse an observation whose quote is not in the reviewed body or plan. */
function verifyObservationSources(root, work, chapter, bodyRevision, observations) {
  if (!Array.isArray(observations)) return
  const db = openWork(root, String(work))
  try {
    if (db.prepare('SELECT 1 FROM chapters WHERE number = ?').get(chapter) === undefined) {
      throw new StoryError('chapter-not-found', `没有第 ${chapter} 章`)
    }
    const body = db.prepare('SELECT body FROM chapter_versions WHERE number = ? AND revision = ?')
      .get(chapter, bodyRevision)?.body
    if (body === undefined) throw new StoryError('body-not-found', `第 ${chapter} 章没有正文版本 r${bodyRevision}`)
    const planRow = db.prepare('SELECT text FROM chapter_plans WHERE number = ?').get(chapter)
    const memoRow = db.prepare(`SELECT content FROM artifacts
      WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1`).get(`plan:${chapter}`)
    const bodyText = compactText(body)
    const planText = compactText(`${planRow?.text ?? ''}\n${memoRow?.content ?? ''}`)
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
    db.close()
  }
}

/**
 * Write one review round's observations as `review:<n>:r<bodyRev>:<round>`.
 * Each observation is validated, including its source refs.
 */
export function writeChapterObservations(root, input) {
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

/** Read one review round's observations by chapter, body revision and round. */
export function readChapterObservations(root, input) {
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
export function readChapterMeta(root, input) {
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

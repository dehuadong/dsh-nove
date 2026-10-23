/** Immutable artifact registry: contract validation plus SQLite persistence. */

import { StoryError } from './domain.js'
import { validateArtifactEnvelope } from './artifact-contract.js'
import { openWork, transaction } from './db.js'

function serialize(content) {
  if (typeof content === 'string') return { contentType: 'text', text: content }
  return { contentType: 'json', text: JSON.stringify(content) }
}

function deserialize(row) {
  return row.content_type === 'json' ? JSON.parse(row.content) : row.content
}

/** Store one immutable artifact revision. */
export function putArtifact(root, input) {
  const envelope = validateArtifactEnvelope(input)
  const { contentType, text } = serialize(envelope.content)
  const at = envelope.createdAt
  const db = openWork(root, String(envelope.workId))
  try {
    return transaction(db, () => {
      const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
        .get(envelope.artifactId, envelope.revisionId)
      if (existing !== undefined) throw new StoryError('artifact-revision-exists', `artifact revision 已存在：${envelope.artifactId}@${envelope.revisionId}`)
      db.prepare(`INSERT INTO artifacts
        (artifact_id, revision_id, kind, scope_chapter, content_type, content, provenance, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(envelope.artifactId, envelope.revisionId, envelope.kind,
          envelope.scope?.chapter ?? null, contentType, text, envelope.provenance, at)
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

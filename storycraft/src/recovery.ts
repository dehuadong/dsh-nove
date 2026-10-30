/** Read-only workspace/work diagnostics and rebuildable search projections. */

import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Database } from './db.ts'
import {
  backupsDir, exportsDir, integrityCheck, openCatalog, openWork, transaction, trashDir, workFile, worksDir,
} from './db.ts'
import { chapterStem } from './domain.ts'
import { materialIndexText } from './search-text.ts'
import { dropSearchDoc, syncSearchDoc } from './search-index.ts'
import { summarySearchText } from './store-db.ts'
import { FOUNDATION_DOCUMENTS, renderFoundationContent } from './artifact-store.ts'

export type RecoveryCode =
  | 'catalog-missing' | 'db-missing' | 'orphan-db' | 'stale-session'
  | 'export-temp' | 'backup-temp' | 'integrity-failed' | 'search-index-missing'
  | 'search-index-drift' | 'search-fts-corrupt' | 'busy' | 'db-corrupt'

export interface RecoveryIssue {
  code: RecoveryCode
  severity: 'error' | 'warning'
  message: string
  workId?: string
}

export interface ScanReport {
  mode: 'workspace' | 'work'
  workId?: string
  issues: RecoveryIssue[]
  staging: string[]
  wal: boolean
  projection: 'event-log'
  counts?: Record<string, { indexed: number, expected: number }>
  unknownKinds?: string[]
}

/** Indexed kinds this module owns. Events are indexed by their own kind. */
const KNOWN_KINDS = [
  'chapter', 'summary', 'fact', 'hook', 'settle', 'volume', 'material', 'outline',
  'world', 'style', 'intent', 'current_focus',
  'story_frame', 'volume_map', 'book_rules', 'role_index', 'role_card', 'card', 'state_draft',
] as const

interface SourceRow {
  kind: string
  docId: string
  source: string
  chapter: number
  body: string
  indexText?: string
}

function latestArtifact(db: Database, artifactId: string): { artifactId: string, kind: string, content: string, contentType: string } | undefined {
  const row = db.prepare('SELECT artifact_id AS artifactId, kind, content, content_type AS contentType FROM artifacts WHERE artifact_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(artifactId) as { artifactId: string, kind: string, content: string, contentType: string } | undefined
  return row
}

function artifactText(row: { kind: string, content: string, contentType: string }): string {
  if (row.contentType !== 'json') return row.content
  try { return renderFoundationContent(JSON.parse(row.content)) } catch { return row.content }
}

function cardText(db: Database, name: string): string | undefined {
  const row = db.prepare('SELECT content FROM bible WHERE name = ?').get(name) as { content: string } | undefined
  return row?.content
}

/**
 * Every document the write paths currently index. Rebuild and scan share this
 * list so a clean work always reports equal counts.
 */
export function sourceRows(db: Database): SourceRow[] {
  const rows: SourceRow[] = []
  for (const chapter of db.prepare('SELECT number, current_revision AS revision FROM chapters WHERE current_revision > 0 ORDER BY number').all() as { number: number, revision: number }[]) {
    const body = db.prepare('SELECT body FROM chapter_versions WHERE number = ? AND revision = ?')
      .get(chapter.number, chapter.revision)?.body
    if (typeof body !== 'string') continue
    rows.push({ kind: 'chapter', docId: `chapter:${chapter.number}:r${chapter.revision}`, source: `chapters/${chapterStem(chapter.number)}`, chapter: chapter.number, body })
  }
  for (const row of db.prepare(`SELECT artifact_id AS artifactId, content FROM artifacts a
    WHERE kind = 'summary' AND rowid = (SELECT max(rowid) FROM artifacts WHERE artifact_id = a.artifact_id)
    ORDER BY artifact_id`).all() as { artifactId: string, content: string }[]) {
    const number = Number(String(row.artifactId).slice('summary:'.length))
    let content: unknown = row.content
    try { content = JSON.parse(row.content) } catch { /* keep text */ }
    rows.push({ kind: 'summary', docId: row.artifactId, source: `summaries/${chapterStem(number)}`, chapter: number, body: summarySearchText(content) })
  }
  for (const row of db.prepare("SELECT seq, chapter, kind, payload FROM events WHERE kind IN ('fact', 'hook') ORDER BY seq").all() as { seq: number, chapter: number, kind: string, payload: string }[]) {
    rows.push({ kind: row.kind, docId: `event:${row.seq}`, source: 'state/events', chapter: row.chapter, body: row.payload })
  }
  for (const row of db.prepare('SELECT id, title, summary, from_ch AS fromChapter FROM volumes ORDER BY id').all() as { id: string, title: string, summary: string | null, fromChapter: number }[]) {
    rows.push({ kind: 'volume', docId: `volume:${row.id}`, source: 'volumes', chapter: row.fromChapter, body: `${row.title} ${row.summary ?? ''}` })
  }
  for (const row of db.prepare('SELECT id, title, content FROM materials ORDER BY id').all() as { id: string, title: string, content: string }[]) {
    rows.push({ kind: 'material', docId: `material:${row.id}`, source: `materials/${row.id}`, chapter: 0, body: row.content, indexText: materialIndexText(row.title, row.content) })
  }
  for (const name of Object.keys(FOUNDATION_DOCUMENTS) as Array<keyof typeof FOUNDATION_DOCUMENTS>) {
    const document = FOUNDATION_DOCUMENTS[name]
    const row = latestArtifact(db, document.artifactId)
    if (row === undefined) continue
    const source = name === 'roles_index' ? 'foundation/roles/index' : `foundation/${name}`
    rows.push({ kind: row.kind, docId: row.artifactId, source, chapter: 0, body: artifactText(row) })
  }
  for (const name of ['world', 'style', 'intent', 'current_focus'] as const) {
    const row = latestArtifact(db, `bible:${name}`)
    if (row === undefined) continue
    const source = name === 'current_focus' ? 'foundation/current_focus' : `bible/${name}`
    rows.push({ kind: row.kind, docId: `bible:${name}`, source, chapter: 0, body: artifactText(row) })
  }
  const outline = latestArtifact(db, 'outline')
  const outlineWritten = db.prepare('SELECT outline_written_at AS writtenAt FROM meta WHERE id = 1').get() as { writtenAt: string | null } | undefined
  if (outline !== undefined && outlineWritten?.writtenAt !== null && outlineWritten?.writtenAt !== undefined) {
    rows.push({ kind: 'outline', docId: 'outline', source: 'outline/plan', chapter: 0, body: outline.content })
  }
  for (const row of db.prepare(`SELECT artifact_id AS artifactId, kind, content, content_type AS contentType FROM artifacts a
    WHERE kind = 'role_card' AND rowid = (SELECT max(rowid) FROM artifacts WHERE artifact_id = a.artifact_id)
    ORDER BY artifact_id`).all() as { artifactId: string, kind: string, content: string, contentType: string }[]) {
    rows.push({ kind: 'role_card', docId: row.artifactId, source: `foundation/roles/${row.artifactId.slice('role:'.length)}`, chapter: 0, body: artifactText(row) })
  }
  for (const row of db.prepare(`SELECT artifact_id AS artifactId, kind, content FROM artifacts a
    WHERE kind = 'state_draft' AND rowid = (SELECT max(rowid) FROM artifacts WHERE artifact_id = a.artifact_id)
    ORDER BY artifact_id`).all() as { artifactId: string, kind: string, content: string }[]) {
    const chapter = Number(/^state:draft:(\d+):/u.exec(row.artifactId)?.[1] ?? 0)
    rows.push({ kind: 'state_draft', docId: row.artifactId, source: `state/draft/${chapter}`, chapter, body: row.content })
  }
  const characters = cardText(db, 'characters')
  const trimmed = characters?.trim() ?? ''
  if (trimmed !== '' && trimmed !== '[]') rows.push({ kind: 'card', docId: 'card:characters', source: 'bible/characters', chapter: 0, body: characters! })
  return rows
}

function issue(code: RecoveryCode, message: string, workId?: string, severity: 'error' | 'warning' = 'error'): RecoveryIssue {
  return { code, severity, message, ...(workId === undefined ? {} : { workId }) }
}

function activeWorks(catalog: Database): { workId: string, trashed: boolean }[] {
  return (catalog.prepare('SELECT work_id AS workId, trashed_at AS trashedAt FROM works').all() as { workId: string, trashedAt: string | null }[])
    .map(row => ({ workId: row.workId, trashed: row.trashedAt !== null }))
}

/** Workspace-level metadata scan: no work content tables are read. */
export function scanWorkspace(root: string): ScanReport {
  const issues: RecoveryIssue[] = []
  const staging: string[] = []
  const catalog = openCatalog(root, { create: false })
  let works: { workId: string, trashed: boolean }[] = []
  let sessions: { sessionId: string, workId: string }[] = []
  try {
    if (catalog === undefined) {
      issues.push(issue('catalog-missing', '作品目录不存在或无法打开；先在面板创建一个作品'))
    } else {
      works = activeWorks(catalog)
      sessions = catalog.prepare('SELECT session_id AS sessionId, work_id AS workId FROM session_current').all() as { sessionId: string, workId: string }[]
    }
  } finally {
    catalog?.close()
  }
  const known = new Set(works.map(work => work.workId))
  const active = works.filter(work => !work.trashed)
  for (const work of active) {
    if (!existsSync(workFile(root, work.workId))) issues.push(issue('db-missing', `作品 ${work.workId} 的库文件不存在`, work.workId))
  }
  if (existsSync(worksDir(root))) {
    for (const name of readdirSync(worksDir(root))) {
      if (name.startsWith('.')) { staging.push(`works/${name}`); continue }
      if (!name.endsWith('.db')) continue
      const workId = name.slice(0, -3)
      if (!known.has(workId)) issues.push(issue('orphan-db', `作品库文件没有 catalog 行：${name}`, workId))
    }
  }
  for (const session of sessions) {
    if (!known.has(session.workId) || !existsSync(workFile(root, session.workId))) {
      issues.push(issue('stale-session', `会话 ${session.sessionId} 指向不存在的作品 ${session.workId}`, session.workId, 'warning'))
    }
  }
  for (const [dir, code, prefixes] of [
    [exportsDir(root), 'export-temp', ['.tmp-', '.bak-']],
    [backupsDir(root), 'backup-temp', ['.safety-', '.corrupt-', '.tmp-']],
  ] as const) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (prefixes.some(prefix => name.startsWith(prefix))) {
        staging.push(`${basename(dir)}/${name}`)
        issues.push(issue(code, `导出/备份临时残留：${name}`, undefined, 'warning'))
      }
    }
  }
  return { mode: 'workspace', issues, staging, wal: false, projection: 'event-log', unknownKinds: [] }
}

/** Work-level scan: integrity, search projection and WAL state of one work. */
export function scanWork(root: string, workId: string): ScanReport {
  const issues: RecoveryIssue[] = []
  const file = workFile(root, workId)
  if (!existsSync(file)) {
    return { mode: 'work', workId, issues: [issue('db-missing', `作品 ${workId} 的库文件不存在`, workId)], staging: [], wal: false, projection: 'event-log' }
  }
  let db: Database | undefined
  try {
    db = openWork(root, workId)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'db-corrupt') {
      return { mode: 'work', workId, issues: [issue('db-corrupt', `作品 ${workId} 的库无法打开，请用备份恢复`, workId)], staging: [], wal: false, projection: 'event-log' }
    }
    if (code === 'work-busy') {
      return { mode: 'work', workId, issues: [issue('busy', `作品 ${workId} 正被另一个动作写入`, workId)], staging: [], wal: false, projection: 'event-log' }
    }
    throw error
  }
  try {
    if (integrityCheck(db) !== 'ok') issues.push(issue('integrity-failed', `作品 ${workId} 的库完整性检查失败`, workId))
    try {
      db.prepare("INSERT INTO search_fts(search_fts) VALUES('integrity-check')").run()
    } catch {
      issues.push(issue('search-fts-corrupt', `作品 ${workId} 的检索索引损坏`, workId))
    }
    const expected = new Map<string, number>()
    for (const row of sourceRows(db)) expected.set(row.kind, (expected.get(row.kind) ?? 0) + 1)
    const indexed = new Map<string, number>()
    for (const row of db.prepare('SELECT kind, count(*) AS count FROM search_docs GROUP BY kind').all() as { kind: string, count: number }[]) {
      indexed.set(row.kind, row.count)
    }
    const counts: Record<string, { indexed: number, expected: number }> = {}
    let missing = false
    let drift = false
    for (const kind of new Set([...expected.keys(), ...KNOWN_KINDS])) {
      const have = indexed.get(kind) ?? 0
      const want = expected.get(kind) ?? 0
      counts[kind] = { indexed: have, expected: want }
      if (want > 0 && have === 0) missing = true
      else if (have !== want) drift = true
    }
    if (missing) issues.push(issue('search-index-missing', `作品 ${workId} 的检索索引缺少整类文档`, workId))
    if (drift) issues.push(issue('search-index-drift', `作品 ${workId} 的检索索引与来源计数不一致`, workId))
    const unknownKinds = [...indexed.keys()].filter(kind => !(KNOWN_KINDS as readonly string[]).includes(kind))
    return {
      mode: 'work', workId, issues, staging: [],
      wal: existsSync(`${file}-wal`) || existsSync(`${file}-shm`),
      projection: 'event-log', counts, unknownKinds,
    }
  } finally {
    db.close()
  }
}

/**
 * Rebuild the derived search projection for one work. Only known kinds are
 * replaced; unknown rows stay and are re-indexed by the FTS rebuild command.
 */
export function rebuildSearchIndex(root: string, workId: string): { workId: string, counts: Record<string, number>, unknownKinds: string[] } {
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const unknownBefore = (db.prepare('SELECT DISTINCT kind FROM search_docs').all() as { kind: string }[])
        .map(row => row.kind).filter(kind => !(KNOWN_KINDS as readonly string[]).includes(kind))
      const deleteRows = db.prepare(`SELECT doc_id AS docId FROM search_docs WHERE kind IN (${KNOWN_KINDS.map(() => '?').join(',')})`)
        .all(...KNOWN_KINDS) as { docId: string }[]
      for (const row of deleteRows) dropSearchDoc(db, row.docId)
      const counts: Record<string, number> = {}
      for (const row of sourceRows(db)) {
        syncSearchDoc(db, row.docId, row.kind, row.source, row.chapter, row.body, row.indexText ?? row.body)
        counts[row.kind] = (counts[row.kind] ?? 0) + 1
      }
      db.prepare("INSERT INTO search_fts(search_fts) VALUES('rebuild')").run()
      const unknownKinds = (db.prepare('SELECT DISTINCT kind FROM search_docs').all() as { kind: string }[])
        .map(row => row.kind).filter(kind => !(KNOWN_KINDS as readonly string[]).includes(kind))
      return { workId, counts, unknownKinds: [...new Set([...unknownBefore, ...unknownKinds])] }
    })
  } finally {
    db.close()
  }
}

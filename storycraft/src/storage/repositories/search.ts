/** FTS search and context retrieval over one work database. */

import { MATERIAL_PURPOSES } from '../../materials.ts'
import { snippetFor } from '../../retrieval.ts'
import { searchTokens } from '../../search-text.ts'
import { projectState } from '../../state-projection.ts'
import { openWork } from '../db.ts'
import { eventsOf, summaryStateOf } from './shared.ts'
/**
 * Drop one search document and its FTS row.
 * @param {object} db - open work database.
 * Search one work by FTS5.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} query - natural query.
 * @param {number} [limit] - result limit.
 * @returns {Array<object>} ranked documents.
 */
export function search(root: any, work: any, query: any, limit: any = 5) {
  const match = matchOf(query)
  if (match === '') return []
  const db = openWork(root, work)
  try {
    return queryDocs(db, { match, limit })
      .map((row: any) => ({ id: row.id, kind: row.kind, source: row.source, chapter: row.chapter, body: row.body, score: row.score }))
  } finally {
    db.close()
  }
}

/**
 * Retrieve current summaries, unresolved hooks, closed volumes and material excerpts for context.
 * The SQL ranks first and limits second; post-filters use the same state rules
 * as the rest of the store, so stale summaries and reopened/resolved hooks do
 * not leak into a role context.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @param {string} query - query text.
 * @param {object} [options] - retrieval filter.
 * @param {number} [options.beforeChapter] - only material before this chapter.
 * @param {string[]} [options.kinds] - restrict kinds; unknown entries are ignored.
 * @returns {Array<{id: string, kind: string, source: string, sourceIds: string[], chapter: number, hookId?: string, text: string, score: number}>} candidates: current summaries, unresolved hooks, volumes, and bounded material excerpts.
 */
export function searchMemory(root: any, work: any, query: any, options: any = {}) {
  const beforeChapter = Number.isInteger(options.beforeChapter) ? options.beforeChapter : undefined
  const requested = Array.isArray(options.kinds) ? options.kinds.filter((kind: any) => MEMORY_KINDS.includes(kind)) : MEMORY_KINDS
  const kinds = [...new Set(requested)]
  if (kinds.length === 0) return []
  const tokens = queryTokens(query)
  const match = matchString(tokens)
  if (match === '') return []
  const db = openWork(root, work)
  try {
    const rows = queryDocs(db, {
      match,
      kinds,
      beforeChapter,
      limit: 200,
    })
    const materialRows = new Map()
    const materialIds = rows.filter((row: any) => row.kind === 'material').map((row: any) => row.id.slice('material:'.length))
    if (materialIds.length > 0) {
      const placeholders = materialIds.map(() => '?').join(', ')
      for (const row of db.prepare(`SELECT id, title, purpose FROM materials WHERE id IN (${placeholders})`).all(...materialIds)) {
        materialRows.set(`material:${row.id}`, row)
      }
    }
    const purposeFilter = Array.isArray(options.purposes)
      ? options.purposes.filter((purpose: any) => MATERIAL_PURPOSES.includes(purpose))
      : undefined
    const reopened = new Map(db.prepare("SELECT chapter, max(seq) AS seq FROM events WHERE kind = 'reopen' GROUP BY chapter")
      .all().map(row => [row.chapter, row.seq]))
    const hookProjection = new Map(projectState(eventsOf(db)).hooks.map(hook => [hook.hookId, hook]))
    const volumes = new Map(db.prepare('SELECT id, to_ch FROM volumes').all().map(row => [row.id, row.to_ch]))
    const candidates = []
    for (const row of rows) {
      const chapter = row.chapter
      if (['world', 'style', 'intent', 'outline', 'story_frame', 'volume_map', 'book_rules', 'role_index', 'role_card', 'current_focus'].includes(row.kind)) {
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter: null,
          text: row.body, score: -row.score,
        })
        continue
      }
      if (beforeChapter !== undefined && (chapter === null || chapter >= beforeChapter)) continue
      if (row.kind === 'summary') {
        if (chapter === null) continue
        const state = summaryStateOf(db, chapter)
        if (state.state !== 'current') continue
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter,
          text: state.text ?? row.body, score: -row.score,
        })
        continue
      }
      if (row.kind === 'hook') {
        const seq = Number(/^event:(\d+)$/u.exec(row.id)?.[1])
        if (!Number.isInteger(seq) || seq <= Number(reopened.get(chapter) ?? -1)) continue
        const event = db.prepare('SELECT chapter, payload FROM events WHERE seq = ?').get(seq)
        if (event === undefined) continue
        let payload
        try {
          payload = JSON.parse(String(event.payload))
        } catch {
          continue
        }
        if (typeof payload?.op !== 'string') continue
        const hookId = payload.op === 'upsert' ? payload.hook?.hookId : payload.hookId
        const hook = hookProjection.get(hookId)
        if (hook === undefined) continue
        if (!['open', 'progressing', 'deferred'].includes(hook.status)) continue
        candidates.push({
          id: row.id,
          kind: row.kind,
          source: row.source,
          sourceIds: ['state'],
          chapter,
          hookId,
          text: `${hook.text}（${hook.status}，第 ${chapter} 章）`,
          score: -row.score,
        })
        continue
      }
      if (row.kind === 'volume') {
        const id = String(row.id).startsWith('volume:') ? String(row.id).slice('volume:'.length) : undefined
        if (id === undefined || !volumes.has(id)) continue
        if (beforeChapter !== undefined && Number(volumes.get(id)) >= beforeChapter) continue
        candidates.push({
          id: row.id, kind: row.kind, source: row.source, sourceIds: [row.id], chapter, text: row.body, score: -row.score,
        })
        continue
      }
      if (row.kind === 'material') {
        const material = materialRows.get(row.id)
        if (material === undefined) continue
        if (purposeFilter !== undefined && !purposeFilter.includes(material.purpose)) continue
        const titleExcerpt = [...material.title].slice(0, 60).join('')
        const excerpt = snippetFor(row.body, tokens, Math.max(80, 400 - [...titleExcerpt].length - 1))
        candidates.push({
          id: row.id,
          kind: row.kind,
          source: row.source,
          sourceIds: [row.id],
          chapter: 0,
          text: `${titleExcerpt}\n${excerpt}`.trim(),
          score: -row.score,
        })
      }
    }
    return candidates
  } finally {
    db.close()
  }
}

/** Document kinds exposed to role context retrieval. */
const MEMORY_KINDS = ['summary', 'hook', 'volume', 'material', 'world', 'style', 'intent', 'outline',
  'story_frame', 'volume_map', 'book_rules', 'role_index', 'role_card', 'current_focus']

/** Query tokens; shared by search and context retrieval. */
function queryTokens(query: any) {
  return searchTokens(query).split(' ').filter(token => token !== '')
}

/** Quote and OR-join tokens for one FTS match. */
function matchString(tokens: any) {
  return tokens.map((token: any) => `"${token.replaceAll('"', '""')}"`).join(' OR ')
}

/** FTS match string for one query, or '' when the query has no tokens. */
function matchOf(query: any) {
  return matchString(queryTokens(query))
}

/** One FTS query with the shared projection, ordering and limit. */
function queryDocs(db: any, { match, kinds, beforeChapter, limit }: any) {
  const clauses = ['search_fts MATCH ?']
  const params = [match]
  if (Array.isArray(kinds) && kinds.length > 0) {
    clauses.push(`d.kind IN (${kinds.map(() => '?').join(', ')})`)
    params.push(...kinds)
  }
  if (Number.isInteger(beforeChapter)) {
    clauses.push('d.chapter < ?')
    params.push(beforeChapter)
  }
  params.push(limit)
  return db.prepare(`SELECT d.doc_id AS id, d.kind, d.source, d.chapter, d.body, bm25(search_fts) AS score
    FROM search_fts JOIN search_docs d ON d.rowid = search_fts.rowid
    WHERE ${clauses.join(' AND ')}
    ORDER BY score, d.chapter DESC, d.doc_id LIMIT ?`).all(...params)
}

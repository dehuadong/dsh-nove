/** Search projection helpers shared by the work store and artifact writers. */

import { searchTokens } from './dist/search-text.js'

/** Remove one search document and its FTS row. */
export function dropSearchDoc(db, docId) {
  const row = db.prepare('SELECT rowid, tokens FROM search_docs WHERE doc_id = ?').get(docId)
  if (row === undefined) return
  db.prepare("INSERT INTO search_fts(search_fts, rowid, tokens) VALUES('delete', ?, ?)").run(row.rowid, row.tokens)
  db.prepare('DELETE FROM search_docs WHERE doc_id = ?').run(docId)
}

/** Upsert one search document and its FTS row. */
export function syncSearchDoc(db, docId, kind, source, chapter, body, indexText = body) {
  const tokens = searchTokens(indexText)
  dropSearchDoc(db, docId)
  db.prepare('INSERT INTO search_docs (doc_id, kind, source, chapter, body, tokens) VALUES (?, ?, ?, ?, ?, ?)')
    .run(docId, kind, source, chapter, body, tokens)
  const row = db.prepare('SELECT rowid FROM search_docs WHERE doc_id = ?').get(docId)
  db.prepare('INSERT INTO search_fts (rowid, tokens) VALUES (?, ?)').run(row.rowid, tokens)
}

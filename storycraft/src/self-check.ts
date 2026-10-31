/** Read-only work self-check: database, search index, chapter versions and state drafts. */

import { scanWork, type RecoveryIssue } from './recovery.ts'

export interface SelfCheckIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
  chapter?: number
}

export interface SelfCheckReport {
  ok: boolean
  checked: number
  issues: SelfCheckIssue[]
}

/** Fixed check groups: database open, integrity/search, chapters, state. */
const CHECK_GROUPS = 4
const DB_ONLY_CODES = new Set(['db-missing', 'db-corrupt', 'busy', 'schema-version-mismatch'])

function mapped(error: unknown): SelfCheckIssue {
  return { code: 'self-check-failed', severity: 'error', message: error instanceof Error ? error.message : String(error) }
}

/** Inspect one work without opening a writable database. */
export function selfCheck(root: string, workId: string): SelfCheckReport {
  const extra: SelfCheckIssue[] = []
  let report
  try {
    report = scanWork(root, workId, {
      readOnly: true,
      inspect: (db) => {
        const rows = db.prepare(`SELECT c.number, c.current_revision AS currentRevision, c.stage,
          c.state_ready_revision AS stateReady, v.body
          FROM chapters c LEFT JOIN chapter_versions v
            ON v.number = c.number AND v.revision = c.current_revision`).all() as any[]
        for (const row of rows) {
          const number = Number(row.number)
          const revision = Number(row.currentRevision)
          if (revision <= 0) continue
          if (row.body === null || row.body === undefined) {
            extra.push({ code: 'chapter-version-missing', severity: 'error', message: `第 ${number} 章当前版本 r${revision} 缺少正文行`, chapter: number })
          } else if (String(row.body).trim() === '') {
            extra.push({ code: 'chapter-body-empty', severity: 'error', message: `第 ${number} 章当前版本正文为空`, chapter: number })
          }
          if (row.stage === 'settled' && Number(row.stateReady) !== revision) {
            extra.push({ code: 'settled-state-mismatch', severity: 'error', message: `第 ${number} 章已定稿但状态版本不一致`, chapter: number })
          }
        }
        const drafts = db.prepare(`SELECT a.scope_chapter AS chapter, a.content FROM artifacts a
          JOIN (SELECT scope_chapter, max(rowid) AS rowid FROM artifacts
            WHERE kind = 'state_draft' AND scope_chapter IS NOT NULL GROUP BY scope_chapter) latest
            ON a.rowid = latest.rowid`).all() as any[]
        for (const row of drafts) {
          let content: any
          try { content = JSON.parse(String(row.content)) } catch { continue }
          if (content.ready === true) continue
          extra.push({ code: 'state-draft-pending', severity: 'warning', message: `第 ${Number(row.chapter)} 章有未处理的状态草案`, chapter: Number(row.chapter) })
        }
      },
    })
  } catch (error) {
    return { ok: false, checked: 1, issues: [mapped(error)] }
  }
  const issues: SelfCheckIssue[] = [
    ...report.issues.map((item: RecoveryIssue) => ({ code: item.code, severity: item.severity, message: item.message })),
    ...extra,
  ]
  const checked = report.issues.some(item => DB_ONLY_CODES.has(item.code)) ? 1 : CHECK_GROUPS
  return { ok: !issues.some(item => item.severity === 'error'), checked, issues }
}

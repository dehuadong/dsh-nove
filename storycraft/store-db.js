/**
 * Work-level store on SQLite (slice S2 of #18).
 *
 * This module owns work rows, settings, the book outline, proposals and the
 * trash/restore lifecycle. Chapter-level data arrives in S3; until the switch in
 * S6 the file-based `storage.js` stays authoritative for running sessions.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openStore, transaction } from './db.js'
import { StoryError, chapterNumber, countWords, parseReview } from './storage.js'

const FORMS = new Set(['longform', 'short', 'script'])

/** Current time in ISO form. */
function now() {
  return new Date().toISOString()
}

/** Normalise a work title into a directory-safe id. */
function workIdOf(title) {
  return String(title).trim().replace(/[\\/:*?"<>|]/gu, '').replace(/\s+/gu, ' ').slice(0, 40)
}

/** Read one work manifest, or throw. */
export function readManifest(root, work) {
  const db = openStore(root)
  try {
    const row = db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(work))
    if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
    const chapters = db.prepare('SELECT * FROM chapters WHERE work_id = ? ORDER BY number').all(row.work_id)
    return {
      version: 1,
      workId: row.work_id,
      title: row.title,
      form: row.form,
      ...(row.tags === null ? {} : { tags: JSON.parse(row.tags) }),
      planApproval: row.plan_approval,
      ...(row.word_min === null ? {} : { wordRange: { min: row.word_min, max: row.word_max } }),
      ...(row.outline_written_at === null ? {} : {
        outline: {
          writtenAt: row.outline_written_at,
          ...(row.outline_approved_at === null ? {} : { approvedAt: row.outline_approved_at }),
        },
      }),
      chapters: chapters.map(chapter => ({
        number: chapter.number,
        id: `ch-${String(chapter.number).padStart(4, '0')}`,
        title: chapter.title,
        status: chapter.status,
        stage: chapter.stage,
        currentRevision: chapter.current_revision,
        words: chapter.words,
        ...(chapter.plan_approved_at === null ? {} : { planApprovedAt: chapter.plan_approved_at }),
        updatedAt: chapter.updated_at,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } finally {
    db.close()
  }
}

/**
 * Create a work.
 * @param {string} root - workspace.
 * @param {{title: string, form?: string, wordRange?: {min: number, max: number}, tags?: string[]}} input - work input.
 * @returns {{workId: string}} created work.
 */
export function initWork(root, input) {
  const title = String(input.title ?? '').trim()
  if (title === '') throw new StoryError('title-required', '作品需要标题')
  const form = input.form ?? 'longform'
  if (!FORMS.has(form)) throw new StoryError('form-invalid', `未知形态：${form}`)
  if (input.wordRange !== undefined) {
    const min = Number(input.wordRange?.min)
    const max = Number(input.wordRange?.max)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min) {
      throw new StoryError('word-range-invalid', `字数范围不合法：${JSON.stringify(input.wordRange)}`)
    }
  }
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const base = workIdOf(title)
      let workId = base
      for (let index = 2; db.prepare('SELECT 1 FROM works WHERE work_id = ?').get(workId) !== undefined; index += 1) {
        workId = `${base}-${index}`
      }
      const at = now()
      db.prepare(`INSERT INTO works (work_id, title, form, tags, plan_approval, word_min, word_max, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        workId, title, form,
        input.tags === undefined ? null : JSON.stringify(input.tags),
        'required',
        input.wordRange?.min ?? null, input.wordRange?.max ?? null,
        at, at,
      )
      return { workId }
    })
  } finally {
    db.close()
  }
}

/** List active works. */
export function listWorks(root) {
  const db = openStore(root)
  try {
    return db.prepare('SELECT work_id, title, form, updated_at FROM works WHERE trashed_at IS NULL ORDER BY updated_at DESC')
      .all().map(row => ({ workId: row.work_id, title: row.title, form: row.form, updatedAt: row.updated_at }))
  } finally {
    db.close()
  }
}

/** List trashed works. */
export function listTrash(root) {
  const db = openStore(root)
  try {
    return db.prepare('SELECT work_id, title, trashed_at FROM works WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC')
      .all().map(row => ({ workId: row.work_id, title: row.title, trashedAt: row.trashed_at }))
  } finally {
    db.close()
  }
}

/** Update word range and/or plan policy. */
export function updateSettings(root, input) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(input.work))
      if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(input.work)}`)
      const min = input.wordRange === null ? null : input.wordRange?.min ?? row.word_min
      const max = input.wordRange === null ? null : input.wordRange?.max ?? row.word_max
      if (min !== null && max !== null && (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min)) {
        throw new StoryError('word-range-invalid', `字数范围不合法：${JSON.stringify(input.wordRange)}`)
      }
      const policy = input.planApproval ?? row.plan_approval
      if (policy !== 'required' && policy !== 'off') throw new StoryError('plan-approval-invalid', '章纲确认策略不合法')
      db.prepare('UPDATE works SET word_min = ?, word_max = ?, plan_approval = ?, updated_at = ? WHERE work_id = ?')
        .run(min, max, policy, now(), row.work_id)
      return {
        workId: row.work_id,
        planApproval: policy,
        ...(min === null ? {} : { wordRange: { min, max } }),
      }
    })
  } finally {
    db.close()
  }
}

/** Write the book plan (content into bible, timestamp on the work). */
export function writeOutline(root, input) {
  const mainline = String(input.mainline ?? '').trim()
  if (mainline === '') throw new StoryError('outline-invalid', '全书计划至少要写主线')
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = db.prepare('SELECT work_id FROM works WHERE work_id = ?').get(String(input.work))
      if (work === undefined) throw new StoryError('work-not-found', `没有作品：${String(input.work)}`)
      const text = ['# 写作计划', '', '## 主线', mainline, '', '## 卷划分',
        String(input.volumes ?? '').trim() || '（暂未划分）', '', '## 结局方向',
        String(input.ending ?? '').trim() || '（暂未确定）', ''].join('\n')
      const at = now()
      db.prepare(`INSERT INTO bible (work_id, name, content, version, updated_at) VALUES (?, 'plan', ?, ?, ?)
        ON CONFLICT(work_id, name) DO UPDATE SET content = excluded.content, version = excluded.version, updated_at = excluded.updated_at`)
        .run(work.work_id, text, randomUUID(), at)
      db.prepare('UPDATE works SET outline_written_at = ?, outline_approved_at = NULL, updated_at = ? WHERE work_id = ?')
        .run(at, at, work.work_id)
      return { workId: work.work_id, outline: { writtenAt: at } }
    })
  } finally {
    db.close()
  }
}

/** Record the author's confirmation of the book plan. */
export function approveOutline(root, input) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(input.work))
      if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(input.work)}`)
      if (row.outline_written_at === null) throw new StoryError('outline-required', '还没有全书计划：先 story_outline')
      const at = now()
      db.prepare('UPDATE works SET outline_approved_at = ?, updated_at = ? WHERE work_id = ?').run(at, at, row.work_id)
      return { workId: row.work_id, outline: { writtenAt: row.outline_written_at, approvedAt: at } }
    })
  } finally {
    db.close()
  }
}

/** Rename a work (title and/or id); foreign keys cascade. */
export function renameWork(root, input) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(input.work))
      if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(input.work)}`)
      const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : row.title
      const nextId = typeof input.workId === 'string' && input.workId.trim() !== ''
        ? workIdOf(input.workId)
        : (title === row.title ? row.work_id : workIdOf(title))
      if (nextId !== row.work_id && db.prepare('SELECT 1 FROM works WHERE work_id = ?').get(nextId) !== undefined) {
        throw new StoryError('work-exists', `作品已存在：${nextId}`)
      }
      db.prepare('UPDATE works SET work_id = ?, title = ?, updated_at = ? WHERE work_id = ?').run(nextId, title, now(), row.work_id)
      return { workId: nextId, title }
    })
  } finally {
    db.close()
  }
}

/** Soft-delete a work. */
export function deleteWork(root, input) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const result = db.prepare('UPDATE works SET trashed_at = ?, updated_at = ? WHERE work_id = ? AND trashed_at IS NULL')
        .run(now(), now(), String(input.work))
      if (result.changes === 0) throw new StoryError('work-not-found', `没有作品：${String(input.work)}`)
      return { workId: String(input.work) }
    })
  } finally {
    db.close()
  }
}

/** Restore a soft-deleted work. */
export function restoreWork(root, input) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const result = db.prepare('UPDATE works SET trashed_at = NULL, updated_at = ? WHERE work_id = ? AND trashed_at IS NOT NULL')
        .run(now(), String(input.work))
      if (result.changes === 0) throw new StoryError('work-not-found', `回收站里没有：${String(input.work)}`)
      return { workId: String(input.work) }
    })
  } finally {
    db.close()
  }
}

/**
 * Create an ideation proposal.
 * @param {string} root - workspace.
 * @param {{title: string, form: string, premise: string, characters?: string, conflict?: string, notes?: string}} input - proposal.
 * @returns {{proposal: object}} stored proposal.
 */
export function createProposal(root, input) {
  const id = `p-${randomUUID().slice(0, 8)}`
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const exists = db.prepare('SELECT 1 FROM works WHERE title = ? AND trashed_at IS NULL').get(String(input.title))
      if (exists !== undefined) throw new StoryError('work-exists', `作品已存在：${input.title}`)
      const at = now()
      db.prepare(`INSERT INTO proposals (id, title, form, premise, characters, conflict, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, String(input.title), String(input.form ?? 'longform'), String(input.premise ?? ''),
        input.characters ?? null, input.conflict ?? null, input.notes ?? null, at,
      )
      return { proposal: { id, title: input.title, form: input.form ?? 'longform', premise: input.premise ?? '', createdAt: at } }
    })
  } finally {
    db.close()
  }
}

/** Read one proposal. */
export function readProposal(root, id) {
  const db = openStore(root)
  try {
    const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(String(id))
    if (row === undefined) throw new StoryError('proposal-not-found', `没有提案：${String(id)}`)
    return {
      id: row.id, title: row.title, form: row.form, premise: row.premise,
      ...(row.characters === null ? {} : { characters: row.characters }),
      ...(row.conflict === null ? {} : { conflict: row.conflict }),
      ...(row.notes === null ? {} : { notes: row.notes }),
      createdAt: row.created_at,
      ...(row.used_at === null ? {} : { usedAt: row.used_at, usedWorkId: row.used_work_id }),
    }
  } finally {
    db.close()
  }
}

/** Mark a proposal as used by a work. */
export function markProposalUsed(root, id, workId) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      db.prepare('UPDATE proposals SET used_at = ?, used_work_id = ? WHERE id = ?').run(now(), String(workId), String(id))
      return { id, workId }
    })
  } finally {
    db.close()
  }
}

/** Prune unused proposals older than the TTL. */
export function pruneProposals(root, ttlMs) {
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const cutoff = new Date(Date.now() - ttlMs).toISOString()
      const result = db.prepare('DELETE FROM proposals WHERE used_at IS NULL AND created_at < ?').run(cutoff)
      return { removed: result.changes }
    })
  } finally {
    db.close()
  }
}

/** Fetch one work row or throw. */
function ensureWork(db, work) {
  const row = db.prepare('SELECT * FROM works WHERE work_id = ?').get(String(work))
  if (row === undefined) throw new StoryError('work-not-found', `没有作品：${String(work)}`)
  return row
}

/** Fetch one chapter row. */
function chapterRow(db, workId, number) {
  return db.prepare('SELECT * FROM chapters WHERE work_id = ? AND number = ?').get(workId, number)
}

/** Insert a planned chapter row if it does not exist yet. */
function ensureChapter(db, workId, number) {
  const existing = chapterRow(db, workId, number)
  if (existing !== undefined) return existing
  const at = now()
  db.prepare('INSERT INTO chapters (work_id, number, updated_at) VALUES (?, ?, ?)').run(workId, number, at)
  return chapterRow(db, workId, number)
}

/** Write a chapter plan. */
export function writePlan(root, input) {
  const number = chapterNumber(input.chapter)
  const fields = [input.perspective, input.goal, input.obstacle, input.cost, input.turn]
  if (fields.some(value => typeof value !== 'string' || value.trim() === '')) {
    throw new StoryError('plan-incomplete', '章纲需要视角、目标、阻力、代价、结尾变化')
  }
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      const entry = ensureChapter(db, work.work_id, number)
      if (entry.stage === 'settled') {
        throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改章纲前先带 reopen 重写正文回退`)
      }
      const text = [`# 第 ${number} 章 章纲`, '',
        `- 视角：${input.perspective.trim()}`, `- 目标：${input.goal.trim()}`,
        `- 阻力：${input.obstacle.trim()}`, `- 代价：${input.cost.trim()}`,
        `- 结尾变化：${input.turn.trim()}`, ''].join('\n')
      db.prepare(`INSERT INTO chapter_plans (work_id, number, text, written_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(work_id, number) DO UPDATE SET text = excluded.text, written_at = excluded.written_at`)
        .run(work.work_id, number, text, now())
      db.prepare('UPDATE chapters SET plan_approved_at = NULL, updated_at = ? WHERE work_id = ? AND number = ?')
        .run(now(), work.work_id, number)
      return { workId: work.work_id, chapter: number, planApproved: false }
    })
  } finally {
    db.close()
  }
}

/** Approve a chapter plan (author gate). */
export function approveChapterPlan(root, input) {
  const number = chapterNumber(input.chapter)
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      const entry = chapterRow(db, work.work_id, number)
      const plan = db.prepare('SELECT 1 FROM chapter_plans WHERE work_id = ? AND number = ?').get(work.work_id, number)
      if (entry === undefined || plan === undefined) throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲`)
      const at = now()
      db.prepare('UPDATE chapters SET plan_approved_at = ?, updated_at = ? WHERE work_id = ? AND number = ?')
        .run(at, at, work.work_id, number)
      return { workId: work.work_id, chapter: number, planApprovedAt: at }
    })
  } finally {
    db.close()
  }
}

/** Write or rewrite a chapter body. */
export function writeChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const body = String(input.body ?? '')
  if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      const entry = chapterRow(db, work.work_id, number)
      const plan = db.prepare('SELECT 1 FROM chapter_plans WHERE work_id = ? AND number = ?').get(work.work_id, number)
      if (entry === undefined || plan === undefined) {
        throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再写正文`)
      }
      if (input.requirePlanApproval === true && work.plan_approval === 'required'
        && entry.current_revision === 0 && entry.plan_approved_at === null) {
        throw new StoryError('plan-not-approved', `第 ${number} 章章纲还没经作者确认：请先确认章纲`)
      }
      const settled = entry.stage === 'settled'
      if (settled && input.reopen !== true) {
        throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改正文请传 reopen: true`)
      }
      if (entry.current_revision > 0 && input.rewrite !== true && !(settled && input.reopen === true)) {
        throw new StoryError('chapter-exists', `第 ${number} 章已有正文；改稿请传 rewrite: true 生成新版本`)
      }
      const revision = entry.current_revision + 1
      const words = countWords(body)
      const at = now()
      db.prepare('INSERT INTO chapter_versions (work_id, number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(work.work_id, number, revision, body, words, at)
      db.prepare(`UPDATE chapters SET title = ?, status = 'written', stage = 'written',
        current_revision = ?, words = ?, plan_approved_at = CASE WHEN ? = 1 THEN NULL ELSE plan_approved_at END,
        updated_at = ? WHERE work_id = ? AND number = ?`)
        .run(String(input.title ?? entry.title), revision, words, revision === 1 ? 0 : 1, at, work.work_id, number)
      syncSearchDoc(db, work.work_id, `chapter:${number}:r${revision}`, 'chapter', `chapters/${number}`, number, body)
      return { workId: work.work_id, chapter: number, revision, words, reopened: settled && input.reopen === true }
    })
  } finally {
    db.close()
  }
}

/** Read the current body of one chapter. */
export function readChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const db = openStore(root)
  try {
    const work = ensureWork(db, input.work)
    const entry = chapterRow(db, work.work_id, number)
    if (entry === undefined || entry.current_revision === 0) throw new StoryError('chapter-not-written', `第 ${number} 章还没有正文`)
    const row = db.prepare('SELECT body, words FROM chapter_versions WHERE work_id = ? AND number = ? AND revision = ?')
      .get(work.work_id, number, entry.current_revision)
    return { workId: work.work_id, chapter: number, revision: entry.current_revision, words: row.words, body: row.body }
  } finally {
    db.close()
  }
}

/** Record one review round. */
export function writeReview(root, input) {
  const number = chapterNumber(input.chapter)
  const problems = Array.isArray(input.problems) ? input.problems : []
  if (problems.length === 0) throw new StoryError('empty-review', '问题清单为空：审稿至少要给出一条问题')
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      const entry = chapterRow(db, work.work_id, number)
      if (entry === undefined || entry.current_revision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文，不能审稿`)
      if (entry.stage === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改审稿要先带 reopen`)
      const round = (db.prepare('SELECT max(round) AS n FROM reviews WHERE work_id = ? AND number = ?').get(work.work_id, number)?.n ?? 0) + 1
      const lines = [`# 第 ${number} 章 审稿（第 ${round} 轮）`, '', `- 正文版本：${entry.current_revision}`, '']
      for (const [index, problem] of problems.entries()) {
        const id = `Q${index + 1}`
        const text = String(problem?.problem ?? '').trim()
        if (text === '') throw new StoryError('empty-problem', `${id} 缺少问题描述`)
        lines.push(`- [ ] ${id} :: ${String(problem?.location ?? '').trim() || '未标注'} :: ${text} :: ${String(problem?.suggestion ?? '').trim() || '未给出建议'}`)
      }
      lines.push('')
      db.prepare('INSERT INTO reviews (work_id, number, round, text, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(work.work_id, number, round, lines.join('\n'), entry.current_revision, now())
      db.prepare("UPDATE chapters SET status = 'reviewed', stage = 'reviewed', updated_at = ? WHERE work_id = ? AND number = ?")
        .run(now(), work.work_id, number)
      return { workId: work.work_id, chapter: number, round, problems: problems.map((problem, index) => ({ id: `Q${index + 1}`, done: false })) }
    })
  } finally {
    db.close()
  }
}

/** Latest review of one chapter. */
export function latestReview(root, work, chapter) {
  const number = chapterNumber(chapter)
  const db = openStore(root)
  try {
    const row = db.prepare('SELECT * FROM reviews WHERE work_id = ? AND number = ? ORDER BY round DESC LIMIT 1').get(String(work), number)
    if (row === undefined) return undefined
    return { round: row.round, text: row.text, revision: row.revision, items: parseReview(row.text) }
  } finally {
    db.close()
  }
}

/** Revise the current body against the latest review. */
export function reviseChapter(root, input) {
  const number = chapterNumber(input.chapter)
  const body = String(input.body ?? '')
  if (body.trim() === '') throw new StoryError('empty-body', '正文不能为空')
  const problemIds = Array.isArray(input.problemIds) ? input.problemIds : []
  if (problemIds.length === 0) throw new StoryError('problem-required', '修订要指定至少一条问题')
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      const entry = chapterRow(db, work.work_id, number)
      if (entry === undefined || entry.current_revision === 0) throw new StoryError('body-not-found', `第 ${number} 章还没有正文`)
      if (entry.stage === 'settled') throw new StoryError('chapter-settled', `第 ${number} 章已定稿：改正文请传 reopen: true`)
      const review = db.prepare('SELECT * FROM reviews WHERE work_id = ? AND number = ? ORDER BY round DESC LIMIT 1').get(work.work_id, number)
      if (review === undefined) throw new StoryError('review-required', `第 ${number} 章还没有审稿：先 story_review`)
      const open = parseReview(review.text).filter(item => !item.done).map(item => item.id)
      const missing = problemIds.filter(id => !open.includes(id))
      if (missing.length > 0) throw new StoryError('problem-not-found', `问题不存在或已处理：${missing.join('、')}`)
      const current = db.prepare('SELECT body FROM chapter_versions WHERE work_id = ? AND number = ? AND revision = ?')
        .get(work.work_id, number, entry.current_revision)
      if (current.body === body) throw new StoryError('revision-identical', '修订后的正文与当前版本相同')
      let text = review.text
      for (const id of problemIds) text = text.replace(new RegExp(`^- \\[ \\] ${id} ::`, 'mu'), `- [x] ${id} ::`)
      db.prepare('UPDATE reviews SET text = ? WHERE work_id = ? AND number = ? AND round = ?').run(text, work.work_id, number, review.round)
      const revision = entry.current_revision + 1
      const words = countWords(body)
      db.prepare('INSERT INTO chapter_versions (work_id, number, revision, body, words, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(work.work_id, number, revision, body, words, now())
      db.prepare("UPDATE chapters SET status = 'revised', stage = 'revised', current_revision = ?, words = ?, updated_at = ? WHERE work_id = ? AND number = ?")
        .run(revision, words, now(), work.work_id, number)
      syncSearchDoc(db, work.work_id, `chapter:${number}:r${revision}`, 'chapter', `chapters/${number}`, number, body)
      return { workId: work.work_id, chapter: number, revision, words, problems: problemIds }
    })
  } finally {
    db.close()
  }
}

/** Write a chapter summary. */
export function writeSummary(root, input) {
  const number = chapterNumber(input.chapter)
  const text = String(input.text ?? '').trim()
  if (text === '') throw new StoryError('empty-summary', '摘要不能为空')
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      ensureChapter(db, work.work_id, number)
      db.prepare(`INSERT INTO summaries (work_id, number, text, written_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(work_id, number) DO UPDATE SET text = excluded.text, written_at = excluded.written_at`)
        .run(work.work_id, number, text, now())
      syncSearchDoc(db, work.work_id, `summary:${number}`, 'summary', `summaries/${number}`, number, text)
      return { workId: work.work_id, chapter: number, chars: text.length }
    })
  } finally {
    db.close()
  }
}

/** Read a chapter summary. */
export function readSummary(root, work, chapter) {
  const number = chapterNumber(chapter)
  const db = openStore(root)
  try {
    const row = db.prepare('SELECT text FROM summaries WHERE work_id = ? AND number = ?').get(String(work), number)
    return row === undefined ? undefined : { chapter: number, text: row.text }
  } finally {
    db.close()
  }
}

/** Append state events (entities/hooks) and return the new projection. */
export function foldState(root, input) {
  const number = chapterNumber(input.chapter)
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      const events = Array.isArray(input.events) ? input.events : []
      const next = (db.prepare('SELECT max(seq) AS n FROM events WHERE work_id = ?').get(work.work_id)?.n ?? 0) + 1
      let seq = next
      for (const event of events) {
        db.prepare('INSERT INTO events (work_id, seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?, ?)')
          .run(work.work_id, seq, now(), number, String(event.kind), JSON.stringify(event))
        syncSearchDoc(db, work.work_id, `event:${seq}`, String(event.kind), 'state/events.jsonl', number, JSON.stringify(event))
        seq += 1
      }
      return { workId: work.work_id, chapter: number, appended: events.length, seq: seq - 1 }
    })
  } finally {
    db.close()
  }
}

/** Read events of one work (optionally up to a chapter). */
export function readEvents(root, work, upToChapter) {
  const db = openStore(root)
  try {
    const rows = upToChapter === undefined
      ? db.prepare('SELECT * FROM events WHERE work_id = ? ORDER BY seq').all(String(work))
      : db.prepare('SELECT * FROM events WHERE work_id = ? AND chapter <= ? ORDER BY seq').all(String(work), chapterNumber(upToChapter))
    return rows.map(row => ({ seq: row.seq, chapter: row.chapter, kind: row.kind, ...JSON.parse(row.payload) }))
  } finally {
    db.close()
  }
}

/** Write a volume. */
export function writeVolume(root, input) {
  const id = String(input.id ?? '').trim()
  if (id === '') throw new StoryError('volume-id-required', '卷需要 id')
  const from = Number(input.from)
  const to = Number(input.to)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to < from) {
    throw new StoryError('volume-range-invalid', '卷的章范围不合法')
  }
  const db = openStore(root)
  try {
    return transaction(db, () => {
      const work = ensureWork(db, input.work)
      db.prepare(`INSERT INTO volumes (work_id, id, title, from_ch, to_ch, summary) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_id, id) DO UPDATE SET title = excluded.title, from_ch = excluded.from_ch, to_ch = excluded.to_ch, summary = excluded.summary`)
        .run(work.work_id, id, String(input.title ?? id), from, to, String(input.summary ?? ''))
      syncSearchDoc(db, work.work_id, `volume:${id}`, 'volume', 'volumes', from, `${String(input.title ?? id)} ${String(input.summary ?? '')}`)
      return { workId: work.work_id, volume: { id, title: String(input.title ?? id), from, to } }
    })
  } finally {
    db.close()
  }
}

/** List volumes. */
export function readVolumes(root, work) {
  const db = openStore(root)
  try {
    return db.prepare('SELECT * FROM volumes WHERE work_id = ? ORDER BY from_ch').all(String(work))
      .map(row => ({ id: row.id, title: row.title, from: row.from_ch, to: row.to_ch, summary: row.summary ?? '' }))
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Search projection (S4)
// ---------------------------------------------------------------------------

/**
 * Tokenize text for FTS5: CJK bigrams + unigrams, latin words.
 * @param {string} text - source text.
 * @returns {string} space-separated tokens.
 */
export function searchTokens(text) {
  const tokens = []
  for (const match of String(text).matchAll(/[\u4e00-\u9fa5]+/gu)) {
    const run = match[0]
    for (let index = 0; index < run.length; index += 1) {
      if (index + 1 < run.length) tokens.push(run.slice(index, index + 2))
      tokens.push(run[index])
    }
  }
  for (const match of String(text).matchAll(/[A-Za-z][A-Za-z0-9_-]+/gu)) tokens.push(match[0].toLowerCase())
  return tokens.join(' ')
}

/** Upsert one search document and its FTS row. */
function syncSearchDoc(db, workId, docId, kind, source, chapter, body) {
  db.prepare(`INSERT INTO search_docs (work_id, doc_id, kind, source, chapter, body, tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_id, doc_id) DO UPDATE SET kind = excluded.kind, source = excluded.source,
      chapter = excluded.chapter, body = excluded.body, tokens = excluded.tokens`)
    .run(workId, docId, kind, source, chapter, body, searchTokens(body))
  const row = db.prepare('SELECT rowid FROM search_docs WHERE work_id = ? AND doc_id = ?').get(workId, docId)
  db.prepare('DELETE FROM search_fts WHERE rowid = ?').run(row.rowid)
  db.prepare('INSERT INTO search_fts (rowid, tokens) VALUES (?, ?)').run(row.rowid, searchTokens(body))
}

/**
 * Search one work.
 * @param {string} root - workspace.
 * @param {string} work - work id.
 * @param {string} query - natural query.
 * @param {number} [limit] - result limit.
 * @returns {Array<object>} ranked documents.
 */
export function search(root, work, query, limit = 5) {
  const tokens = searchTokens(query).split(' ').filter(token => token !== '')
  if (tokens.length === 0) return []
  const db = openStore(root)
  try {
    const match = tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ')
    return db.prepare(`SELECT d.doc_id AS id, d.kind, d.source, d.chapter, d.body, bm25(search_fts) AS score
      FROM search_fts JOIN search_docs d ON d.rowid = search_fts.rowid
      WHERE search_fts MATCH ? AND d.work_id = ? ORDER BY score, d.chapter DESC, d.doc_id LIMIT ?`)
      .all(match, String(work), limit)
      .map(row => ({ id: row.id, kind: row.kind, source: row.source, chapter: row.chapter, body: row.body, score: row.score }))
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Export and backup (S5)
// ---------------------------------------------------------------------------

/** Render the export manifest. */
function exportManifest(db, workId) {
  const work = ensureWork(db, workId)
  const chapters = db.prepare('SELECT * FROM chapters WHERE work_id = ? ORDER BY number').all(workId)
  return {
    schemaVersion: 1,
    title: work.title,
    form: work.form,
    tags: work.tags === null ? [] : JSON.parse(work.tags),
    wordRange: work.word_min === null ? null : { min: work.word_min, max: work.word_max },
    planApproval: work.plan_approval,
    outline: work.outline_written_at === null ? null : {
      writtenAt: work.outline_written_at,
      approvedAt: work.outline_approved_at,
    },
    chapters: chapters.map(chapter => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      stage: chapter.stage,
      currentRevision: chapter.current_revision,
      words: chapter.words,
      planApprovedAt: chapter.plan_approved_at,
    })),
  }
}

/**
 * Export one work as a directory tree.
 * @param {string} root - workspace.
 * @param {string} work - work id.
 * @param {string} [destination] - target directory.
 * @returns {Promise<{directory: string, files: number}>} export summary.
 */
export async function exportWork(root, work, destination) {
  const db = openStore(root)
  try {
    const workRow = ensureWork(db, work)
    const target = destination ?? join(root, '.storycraft', 'exports', `${workRow.work_id}-${Date.now()}`)
    const files = []
    const put = async (relative, text) => {
      const file = join(target, relative)
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, text, 'utf8')
      files.push(relative)
    }
    const stem = number => `ch-${String(number).padStart(4, '0')}`
    await put('manifest.json', JSON.stringify(exportManifest(db, workRow.work_id), null, 2) + '\n')
    for (const version of db.prepare('SELECT * FROM chapter_versions WHERE work_id = ? ORDER BY number, revision').all(workRow.work_id)) {
      const name = version.revision === 1 ? `${stem(version.number)}.md` : `${stem(version.number)}.r${version.revision}.md`
      await put(join('chapters', name), version.body.endsWith('\n') ? version.body : `${version.body}\n`)
    }
    for (const plan of db.prepare('SELECT * FROM chapter_plans WHERE work_id = ? ORDER BY number').all(workRow.work_id)) {
      await put(join('outline', `${stem(plan.number)}.plan.md`), plan.text)
    }
    for (const summary of db.prepare('SELECT * FROM summaries WHERE work_id = ? ORDER BY number').all(workRow.work_id)) {
      await put(join('summaries', `${stem(summary.number)}.md`), summary.text)
    }
    for (const review of db.prepare('SELECT * FROM reviews WHERE work_id = ? ORDER BY number, round').all(workRow.work_id)) {
      await put(join('reviews', `${stem(review.number)}.r${review.round}.md`), review.text)
    }
    for (const entry of db.prepare('SELECT * FROM bible WHERE work_id = ? ORDER BY name').all(workRow.work_id)) {
      await put(join('bible', entry.name === 'plan' ? 'plan.md' : `${entry.name}.md`), entry.content)
    }
    await put('volumes.json', JSON.stringify(db.prepare('SELECT * FROM volumes WHERE work_id = ? ORDER BY from_ch').all(workRow.work_id), null, 2) + '\n')
    await put('state/events.jsonl', db.prepare('SELECT * FROM events WHERE work_id = ? ORDER BY seq').all(workRow.work_id)
      .map(row => JSON.stringify({ seq: row.seq, at: row.at, chapter: row.chapter, kind: row.kind, ...JSON.parse(row.payload) })).join('\n') + '\n')
    await put('proposals.json', JSON.stringify(db.prepare('SELECT * FROM proposals ORDER BY created_at').all(), null, 2) + '\n')
    return { directory: target, files: files.length }
  } finally {
    db.close()
  }
}

/**
 * Copy the store to a backup file with an integrity check.
 * @param {string} root - workspace.
 * @param {string} [destination] - backup file.
 * @returns {Promise<{file: string, integrity: string}>} backup result.
 */
export async function backupStore(root, destination) {
  const { backupTo, integrityCheck } = await import('./db.js')
  const db = openStore(root)
  try {
    const file = destination ?? join(root, '.storycraft', 'backups', `works-${Date.now()}.db`)
    await backupTo(db, file)
    return { file, integrity: integrityCheck(db) }
  } finally {
    db.close()
  }
}

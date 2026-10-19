/**
 * Work-level store on SQLite (slice S2 of #18).
 *
 * This module owns work rows, settings, the book outline, proposals and the
 * trash/restore lifecycle. Chapter-level data arrives in S3; until the switch in
 * S6 the file-based `storage.js` stays authoritative for running sessions.
 */

import { randomUUID } from 'node:crypto'
import { openStore, transaction } from './db.js'
import { StoryError } from './storage.js'

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

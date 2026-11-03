/** Long-form stage machine: the next legal action for a work. */

import { formOf, now, planApprovalPolicy, stageOf, unitOf, StoryError } from '../domain.ts'
import { MAX_REVISION_ROUNDS, revisionRounds } from '../storage/types.ts'
import { openWork } from '../storage/db.ts'
import {
  foundationStateOf,
} from '../storage/repositories/foundation.ts'
import {
  readManifest,
  delegateOf,
} from '../storage/repositories/catalog.ts'
import {
  summaryStateOf,
  latestReviewRow,
  reviewCovers,
  isCleanReview,
  openObservations,
  methodFor,
  planMemoFrom,
  foundationSummaryOf,
  askFor,
} from '../storage/repositories/shared.ts'

/**
 * The next step of one work, derived from the stage machine. Read-only.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} next step.
 */
export function nextStep(root: any, work: any) {
  const manifest = readManifest(root, work)
  const plannerDelegate = formOf(manifest) === 'longform' ? { delegate: { role: 'planner' } } : {}
  const db = openWork(root, manifest.workId)
  try {
    const hasPlan = (number: any) => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(`plan:${number}`) !== undefined
    const summaryOf = (number: any) => summaryStateOf(db, number)
    const chapters = manifest.chapters
    // A reopened earlier chapter must be finished before later ones; otherwise the
  // flow keeps targeting the last chapter as before.
  const reopened = new Set<number>()
  for (const event of db.prepare("SELECT chapter, kind FROM events WHERE kind IN ('reopen', 'settle') ORDER BY seq").all()) {
    if (event.chapter === null || event.chapter === undefined) continue
    if (event.kind === 'reopen') reopened.add(Number(event.chapter))
    else reopened.delete(Number(event.chapter))
  }
  const reopenedChapter = chapters.find((entry: any) => reopened.has(entry.number) && entry.stage !== 'settled')
  const last = chapters.length === 0 ? undefined : (reopenedChapter ?? chapters[chapters.length - 1])
    const chapter = last === undefined ? 1 : last.number
    const outline = manifest.outline
    let candidate
    const step = (() => {
      if (last === undefined) {
        if (outline === undefined || outline.writtenAt === undefined) {
          if (formOf(manifest) === 'longform') {
            const foundation = foundationStateOf(db)
            if (foundation.complete !== true) {
              const dispatchStage = foundation.dispatchStage
              return {
                chapter, stage: 'planned', action: 'story_architect', foundationStage: dispatchStage,
                reason: `还没有基础设定（${dispatchStage}）：让 architect 生成故事框架、规则与角色，再写全书计划`,
                missing: [`foundation:${dispatchStage}`],
              }
            }
            if (foundation.approvedAt === undefined) {
              return {
                chapter, stage: 'planned', action: 'story_architect',
                reason: '基础设定已生成，等作者确认（面板「基础设定」或会话里的 story_approve），再写全书计划',
                blocked: ['foundation-approval'],
              }
            }
          }
          return {
            chapter, stage: 'planned', action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向，等作者确认', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter, stage: 'planned', action: 'story_plan',
            reason: '全书计划等作者确认：在面板点「确认全书计划」，然后写第 1 章章纲',
            blocked: ['outline-approval'],
          }
        }
        return { chapter, stage: 'planned', action: 'story_plan', reason: '还没有任何章节：先写第 1 章章纲', missing: [], ...plannerDelegate }
      }
      const stage = stageOf(last)
      const hasBody = last.currentRevision > 0
      if (stage === 'settled') {
        const summary = summaryOf(last.number)
        if (summary.state !== 'current') {
          return {
            chapter: last.number, stage, action: 'story_summarize',
            reason: summary.state === 'stale'
              ? `第 ${last.number} 章已定稿，但摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，后面几章的写前上下文才用得上`
              : `第 ${last.number} 章已定稿但没有摘要：先补摘要，后面几章的写前上下文才用得上`,
            missing: ['summary'],
          }
        }
        const closing = db.prepare('SELECT * FROM volumes WHERE to_ch = ?').all(last.number)
          .find(volume => typeof volume.summary !== 'string' || volume.summary.trim() === '')
        if (closing !== undefined) {
          return {
            chapter: last.number, stage, action: 'story_volume',
            reason: `第 ${last.number} 章是「${closing.title}」的最后一章：给它补一段卷摘要，下一卷的写前上下文要用`,
            missing: ['volume-summary'],
          }
        }
        const next = last.number + 1
        if (outline === undefined || outline.writtenAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_plan',
            reason: '全书计划等作者确认：先在面板点「确认全书计划」，再写下一章章纲', blocked: ['outline-approval'],
          }
        }
        return { chapter: next, stage: 'planned', action: 'story_plan', reason: `第 ${last.number} 章已定稿：写第 ${next} 章章纲`, missing: [], ...plannerDelegate }
      }
      if (!hasPlan(last.number)) {
        if (outline === undefined || outline.writtenAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_plan',
            reason: '全书计划等作者确认：在面板点「确认全书计划」，再写章纲', blocked: ['outline-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_plan', reason: `第 ${last.number} 章缺章纲`, missing: [], ...plannerDelegate }
      }
      if (!hasBody) {
        if (planApprovalPolicy(manifest) === 'required' && last.planApproved !== true) {
          return {
            chapter: last.number, stage, action: 'story_write',
            reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」，然后写正文`,
            missing: ['body'], blocked: ['plan-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_write', reason: `第 ${last.number} 章已有章纲，写正文`, missing: ['body'] }
      }
      // An unconfirmed plan wins over any chapter step: revising or re-reviewing
      // under a plan the author has not accepted would write against a draft.
      if (hasPlan(last.number) && planApprovalPolicy(manifest) === 'required' && last.planApproved !== true) {
        return {
          chapter: last.number, stage, action: 'story_plan',
          reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」`,
          missing: [], blocked: ['plan-approval'],
        }
      }
      if (stage === 'written') {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      candidate = latestReviewRow(db, last.number)
      if (!reviewCovers(candidate, last)) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      if (isCleanReview(candidate) && candidate.revision !== last.currentRevision) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章的清稿审稿针对旧版本 r${candidate.revision}：先重新审稿`, missing: ['review'] }
      }
      const blocked = {}
      const open = openObservations(candidate)
      if (open.length > 0) {
        const rounds = revisionRounds(last.currentRevision)
        if (rounds >= MAX_REVISION_ROUNDS) {
          return {
            chapter: last.number, stage, action: 'story_revise',
            reason: `第 ${last.number} 章已修订 ${rounds} 轮（上限 ${MAX_REVISION_ROUNDS}），仍有 ${open.length} 条未处理审稿：请作者裁决（接受当前版本，或说明继续修订）`,
            missing: open.map((item: any) => item.id),
            ...blocked,
            blocked: ['revision-limit', ...((blocked as { blocked?: string[] }).blocked ?? [])],
          }
        }
        return {
          chapter: last.number, stage, action: 'story_revise',
          reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map((item: any) => item.id), ...blocked,
        }
      }
      const draftRow = db.prepare("SELECT content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(last.number)
      const draft = draftRow === undefined ? undefined : JSON.parse(String(draftRow.content))
      const draftCurrent = draft !== undefined && Number(draft.revision) === Number(last.currentRevision)
      if (draftCurrent && draft.ready !== true) {
        return {
          chapter: last.number, stage, action: 'story_apply_draft',
          reason: `第 ${last.number} 章的状态草案等作者确认：接受草案或先改状态`,
          missing: [],
        }
      }
      const summary = summaryOf(last.number)
      if (summary.state !== 'current') {
        return {
          chapter: last.number, stage, action: 'story_summarize',
          reason: summary.state === 'stale'
            ? `第 ${last.number} 章摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，再定稿`
            : isCleanReview(candidate)
              ? `第 ${last.number} 章清稿审稿无问题：先写摘要，再定稿`
              : `第 ${last.number} 章已修订：先写摘要，再定稿`,
          missing: ['summary'],
        }
      }
      if (draftCurrent && draft.ready === true) {
        return {
          chapter: last.number, stage, action: 'story_finalize',
          reason: `第 ${last.number} 章状态已就绪：定稿（应用草案并入账）`,
          missing: [],
        }
      }
      return { chapter: last.number, stage, action: 'story_settle', reason: isCleanReview(candidate) ? `第 ${last.number} 章清稿审稿无问题：结算状态` : `第 ${last.number} 章已修订：结算状态`, missing: [] }
    })()
    const delegate = delegateOf(step, last, candidate)
    const method = methodFor(step, formOf(manifest))
    const planMemo = (step.blocked ?? []).includes('plan-approval')
      ? planMemoFrom(db, step.chapter)
      : undefined
    const foundationSummary = (step.blocked ?? []).includes('foundation-approval') ? foundationSummaryOf(db) : undefined
    const ask = askFor(step, last, candidate, planMemo, foundationSummary)
    return {
      workId: manifest.workId,
      ...step,
      form: formOf(manifest),
      unit: unitOf(formOf(manifest)),
      ...(delegate === undefined ? {} : { delegate }),
      ...(ask === undefined ? {} : { ask }),
      ...(method === undefined ? {} : { method }),
    }
  } finally {
    db.close()
  }
}


/**
 * Read-only semantic check for a proposed `story_state` delta.
 *
 * The deterministic state machine runs first. Only a clean deterministic delta
 * starts a validator child, so an invalid or empty delta never spends a model
 * call. The child gets the current body plus bounded context and submits its
 * findings through the existing `story_submit` seam; this module never writes
 * events, stages or summaries.
 */

import {
  StoryError, chapterNumber, previewState, readChapter, readFoldedState, readManifest, readPlan, readSummary,
  readSummaryState, stageOf,
} from './storage.ts'
import { readCards } from './facts.ts'
import { closeSubmission, consumeSubmission, openSubmission, STATE_CHECK_NO_EVIDENCE } from './submission.ts'
import { runChild } from './delegate.ts'
import { finishCall, nextAttempt, recordCall } from './telemetry.ts'

/** One chapter entry from the manifest. */
interface ManifestChapter {
  number: number
  currentRevision: number
  stage?: string
}

/** Manifest fields the prompt reads; the store owns the full shape. */
interface ManifestView {
  title: string
  chapters: ManifestChapter[]
}

/** Folded state fields the prompt serialises; the projection owns the full shape. */
interface FoldedView {
  facts: Array<{ subject: string }>
  hooks: Array<{ hookId: string }>
}

/** The card field the prompt filters on; the card contract belongs to `facts.ts`. */
interface CardView {
  name: string
}

/** Model-produced state delta; `previewState` validates every field in the store. */
interface StateDelta {
  // Model-supplied operations are a dynamic JSON boundary typed by the projection.
  factOps: any
  // Model-supplied hook operations, same boundary as `factOps`.
  hookOps: any
  // New hooks are model-supplied records, same boundary as `factOps`.
  newHooks: any[]
}

/** One finding after evidence verification. */
interface Finding {
  code: string
  where: string
  problem: string
  evidence: string
  impact: string
  severity: string
  fix: string
  evidenceVerified: boolean | null
}

/** What one check's verification returns. */
interface VerifiedFindings {
  items: Finding[]
  warnings: string[]
}

/** One proposed delta to check. */
interface StateCheckInput {
  attempt?: number
  trigger?: string
  work: string
  chapter: number | string
  // Model-supplied operations are a dynamic JSON boundary typed by the projection.
  factOps?: any
  // Model-supplied hook operations, same boundary as `factOps`.
  hookOps?: any
  // New hooks are model-supplied records, same boundary as `factOps`.
  newHooks?: any[]
}

/** Host dependencies supplied by the action layer. */
interface StateCheckHost {
  // `ctx.get('subagents')` is a DSH dynamic boundary; the Harness owns the service shape.
  service?: any
  // `exec.agent` is a DSH dynamic boundary; the Harness owns the agent shape.
  agent?: any
  /** Caller cancellation from `exec.signal`. */
  signal?: AbortSignal
  /** Per-run budget override; defaults to STATE_CHECK_TIMEOUT_MS. */
  timeoutMs?: number
  /** Live session store for child usage. */
  sessions?: any
}

/** The prompt input assembled from the store and the proposed delta. */
interface PromptInput {
  workId: string
  chapter: number
  manifest: ManifestView
  body: string
  revision: number
  payload: StateDelta
  folded: FoldedView
  summary: string
  plan: string
  cards: CardView[]
  delegationId: string
}

/** What one check returns; never writes. */
interface StateCheckReceipt {
  ok: true
  workId: string
  chapter: number
  revision: number
  checked: true
  items: Finding[]
  counts: Record<string, number>
  warnings: string[]
  trace: { durationMs: number; submissionAttempts: number }
}

/** One check's child budget; a validator run is shorter than a chapter run. */
const STATE_CHECK_TIMEOUT_MS = 180000

const SEVERITY_RANK: Record<string, number> = { major: 0, minor: 1 }

/** The manifest entry of one chapter, when the manifest lists it. */
function entryOf(manifest: ManifestView, number: number): ManifestChapter | undefined {
  return manifest.chapters.find(item => item.number === number)
}

/** Collapse whitespace so a copied quote survives line endings. */
function compact(text: unknown): string {
  return String(text ?? '').replace(/\s+/gu, '')
}

/**
 * Attach a deterministic evidence verdict to every finding.
 *
 * A quote that is not a contiguous part of the body is kept but flagged, so a
 * hallucinated citation cannot pose as verified. Absence of a passage is
 * represented by `null`, not by a failed quote.
 * @param items - validator findings.
 * @param body - the checked chapter body.
 * @returns bounded findings.
 */
function verifyEvidence(items: any[], body: string): VerifiedFindings {
  // Validator findings arrive as model-produced JSON; every field is normalised below.
  const compactBody = compact(body)
  const warnings: string[] = []
  const checked = items.map(item => {
    const evidence = String(item.evidence).trim()
    let evidenceVerified = null
    if (evidence !== STATE_CHECK_NO_EVIDENCE) {
      evidenceVerified = compactBody.includes(compact(evidence))
      if (!evidenceVerified) warnings.push(`evidence-unverified: ${item.where}`)
    }
    return {
      code: String(item.code),
      where: String(item.where).trim(),
      problem: String(item.problem).trim(),
      evidence,
      impact: String(item.impact).trim(),
      severity: item.severity,
      fix: String(item.fix).trim(),
      evidenceVerified,
    }
  })
  checked.sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9))
  return { items: checked, warnings }
}

/** Render one optional prompt section. */
function section(title: string, content: unknown): string {
  const text = String(content ?? '').trim()
  return text === '' ? '' : `## ${title}\n${text}`
}

/**
 * Build the validator child prompt. The body is the only evidence; the other
 * sections are context and are labelled as such.
 * @param input - work, chapter, manifest, body, revision, delta, folded, summary, plan, cards, delegationId.
 * @returns prompt text.
 */
function promptFor(input: PromptInput): string {
  const subjects = new Set((input.payload.factOps?.upsert ?? []).map((fact: any) => fact?.subject).filter(Boolean))
  const hookIds = new Set(Object.values(input.payload.hookOps ?? {}).flat())
  const priorFacts = input.folded.facts.filter(fact => subjects.has(fact.subject))
  const priorHooks = input.folded.hooks.filter(hook => hookIds.has(hook.hookId))
  const cards = input.cards.filter(card => subjects.has(card.name)).slice(0, 8)
  const context = [
    section('折叠前状态（上下文，不是正文证据）', JSON.stringify({
      facts: priorFacts,
      hooks: priorHooks,
    }, null, 2)),
    section('本章摘要（上下文，不是正文证据）', input.summary),
    section('本章章纲（上下文，不是正文证据）', input.plan),
    section('人物卡（上下文）', JSON.stringify(cards, null, 2)),
  ].filter(Boolean).join('\n\n')

  return [
    `你是《${input.manifest.title}》（${input.workId}）第 ${input.chapter} 章的语义状态对账子代理。`,
    '开工前先调用 skill 工具加载 `storycraft-state-check`，严格按它判断。',
    '不要用 glob/grep 搜索技能或插件文件；方法以加载到的技能正文为准。',
    '',
    '## 本次任务',
    `核对下面拟写入的状态 payload 是否被本章正文 r${input.revision} 支持，找出正文里发生但 payload 没记的重要变化。`,
    '只核对本次 payload，不重审旧投影；正文是唯一事实证据，其他部分只作上下文。',
    '',
    `## 本章正文（r${input.revision}，唯一事实证据）`,
    input.body,
    '',
    ...(context === '' ? [] : [context, '']),
    '## 待对账 payload',
    JSON.stringify(input.payload, null, 2),
    '',
    '## 输出契约',
    `必须调用 story_submit，delegationId 是 ${input.delegationId}。`,
    'payload 格式：{"items":[{"code":"fact-unsupported","where":"…","problem":"…","evidence":"…","impact":"…","severity":"major","fix":"…"}]}。',
    '没有发现时 payload 为 {"items":[]}。',
    `证据必须是正文里的连续原文；只有非 missing-change 的 finding 在正文没有对应段落时写「${STATE_CHECK_NO_EVIDENCE}」；missing-change 必须给正文引文。`,
    '提交成功后最终只回「已提交」；不要手动调用落盘动作，不要改写正文。',
    'story_submit 返回 ok:false 时，按 error.retryable 修正 payload 后重提，最多 3 次；不要把工具错误当成最终失败。',
  ].join('\n')
}

/**
 * Check one proposed state payload against the current chapter body.
 * @param root - workspace directory.
 * @param input - work, chapter, factOps, hookOps, newHooks.
 * @param host - host dependencies.
 * @returns bounded findings; never writes.
 */
export async function checkChapterState(
  root: string,
  input: StateCheckInput,
  host: StateCheckHost = {},
): Promise<StateCheckReceipt> {
  const work = String(input.work)
  const chapter = chapterNumber(input.chapter)
  const payload: StateDelta = {
    factOps: input.factOps ?? {},
    hookOps: input.hookOps ?? {},
    newHooks: input.newHooks ?? [],
  }
  let preview
  try {
    preview = previewState(root, { work, chapter, ...payload })
  } catch (error: any) {
    // A store rejection crosses the SQLite boundary; only `code` is read.
    if (error?.code === 'empty-state') throw new StoryError('empty-state', '语义对账至少要给出一条人物事实或伏笔变化')
    throw error
  }
  if (preview.appended === 0) {
    throw new StoryError('empty-state', '语义对账至少要给出一条人物事实或伏笔变化')
  }

  const manifest: ManifestView = readManifest(root, work)
  const entry = entryOf(manifest, chapter)
  if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${chapter} 章`)
  if (stageOf(entry) === 'settled') {
    throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：不能再对状态 delta 做语义对账`)
  }
  if (entry.currentRevision === 0) {
    throw new StoryError('chapter-not-written', `第 ${chapter} 章还没有正文：先写正文，再对状态 delta 做语义对账`)
  }

  const folded: FoldedView = readFoldedState(root, work)

  const chapterBody = readChapter(root, { work, chapter })
  const body = chapterBody.content
  const revision = chapterBody.revision
  const summaryState = readSummaryState(root, work, chapter)
  const summary = summaryState.state === 'current' ? (readSummary(root, work, chapter) ?? '') : ''
  const plan = readPlan(root, work, chapter) ?? ''
  const cards = await readCards(root, work)

  const opened = openSubmission({ role: 'validator', workId: work, chapter })
  let child
  try {
    const started = Date.now()
    child = await runChild({
      service: host.service,
      agent: host.agent,
      cwd: root,
      prompt: promptFor({
        workId: work,
        chapter,
        manifest,
        body,
        revision,
        payload,
        folded,
        summary,
        plan,
        cards,
        delegationId: opened.delegationId,
      }),
      label: '故事工坊-状态对账',
      signal: host.signal,
      timeoutMs: Number.isFinite(host.timeoutMs) ? host.timeoutMs! : STATE_CHECK_TIMEOUT_MS,
      telemetry: {
        work, chapter, role: 'validator',
        scope: `validate:r${revision}`, attempt: nextAttempt(root, work, chapter, 'validator', `validate:r${revision}`), trigger: input.trigger ?? 'first',
        delegationId: opened.delegationId, sessions: host.sessions,
        sink: (call) => recordCall(root, work, call),
      },
      unavailableCode: 'state-check-unavailable',
      failedCode: 'state-check-failed',
      unavailableMessage: '当前组合没有可用的 subagents 服务：无法做语义状态对账',
    })
    const result = child.result
    const durationMs = Date.now() - started
    const submission = consumeSubmission(opened.delegationId)
    const attempts = submission?.attempts ?? 0

    if (result?.stopReason !== 'completed') {
      if (submission?.consumed !== true && attempts >= 3) {
        throw new StoryError('state-check-no-submission',
          `状态对账提交尝试用尽（${attempts} 次），未正常完成（${String(result?.stopReason ?? 'unknown')}）`)
      }
      throw new StoryError('state-check-failed',
        `状态对账子代理未正常完成（${String(result?.stopReason ?? 'unknown')}）${result?.diagnostic === undefined ? '' : `：${result.diagnostic}`}`)
    }
    if (submission?.consumed !== true || submission.payload === undefined) {
      if (result?.stopReason === 'completed' && child.call.callId !== undefined) finishCall(root, work, child.call.callId, { outcome: 'rejected', submissionAttempts: attempts, errorCode: 'state-check-no-submission' })
      throw new StoryError('state-check-no-submission',
        `状态对账子代理没有提交通过校验的结果（尝试 ${attempts} 次）`)
    }

    const latest: ManifestView = readManifest(root, work)
    const latestEntry = entryOf(latest, chapter)
    if (latestEntry === undefined || latestEntry.currentRevision !== revision) {
      throw new StoryError('state-check-stale', `第 ${chapter} 章在核对期间改版：请对当前版本重跑`)
    }

    const verified = verifyEvidence(submission.payload.items, body)
    if (child.call.callId !== undefined) finishCall(root, work, child.call.callId, { outcome: 'accepted', submissionAttempts: attempts })
    return {
      ok: true,
      workId: work,
      chapter,
      revision,
      checked: true,
      items: verified.items,
      counts: { ...preview.counts, items: verified.items.length },
      warnings: verified.warnings,
      trace: { durationMs, submissionAttempts: attempts },
    }
  } finally {
    closeSubmission(opened.delegationId)
    if (child !== undefined) await child.dispose()
  }
}

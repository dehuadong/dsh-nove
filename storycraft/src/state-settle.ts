/**
 * Automatic state settlement: settler child → deterministic preflight → R9b
 * semantic check → at most one feedback retry → fold.
 *
 * The action is explicit and main-session only. It never edits the body, never
 * writes before the whole chain accepts, and leaves `story_state` as the manual
 * fallback when reconciliation cannot be resolved.
 */

import { StoryError, chapterNumber } from './storage.ts'
import {
  chapterStageOf, previewState, readChapter, readEvents, readFoldedState, readManifest, readPlan, readSummary, writeStateDraft, statePreflight,
} from './storage.ts'
import { readCards } from './facts.ts'
import { closeSubmission, consumeSubmission, openSubmission } from './submission.ts'
import { runChild } from './delegate.ts'
import { checkChapterState } from './state-check.ts'

/** One chapter entry from the manifest. */
interface ManifestChapter {
  number: number
  currentRevision: number
}

/** Manifest fields the settler prompt reads; the store owns the full shape. */
interface ManifestView {
  title: string
  chapters: ManifestChapter[]
}

/** Folded state fields the prompt serialises; the projection owns the full shape. */
interface FoldedView {
  facts: unknown[]
  hooks: unknown[]
}

/** The card field the prompt filters on; the card contract belongs to `facts.ts`. */
interface CardView {
  name: string
}

/** Model-produced state delta; the projection and the store validate every field. */
interface StatePayload {
  // Model-supplied operations are a dynamic JSON boundary typed by the projection.
  factOps?: any
  // Model-supplied hook operations, same boundary as `factOps`.
  hookOps?: any
  // New hooks are model-supplied records, same boundary as `factOps`.
  newHooks?: any[]
}

/** One semantic-check finding as this module reports it back. */
interface Finding {
  code: string
  where: string
  problem: string
  severity?: string
  fix?: string
}

/** Host dependencies supplied by the action layer. */
interface SettleHost {
  // `ctx.get('subagents')` is a DSH dynamic boundary; the Harness owns the service shape.
  service?: any
  // `exec.agent` is a DSH dynamic boundary; the Harness owns the agent shape.
  agent?: any
  /** Caller cancellation from `exec.signal`. */
  signal?: AbortSignal
  /** Per-child budget override; defaults to STATE_SETTLE_TIMEOUT_MS. */
  timeoutMs?: number
  /** Whole-settlement budget override; defaults to SETTLE_TOTAL_TIMEOUT_MS. */
  settleTimeoutMs?: number
}

/** One settlement request. */
interface SettleInput {
  work: string
  chapter: number | string
}

/** What one settler run needs; the prompt adds the delegation identity. */
interface SettlerInput {
  workId: string
  chapter: number
  manifest: ManifestView
  body: string
  revision: number
  seq: number
  folded: FoldedView
  summary: string
  plan: string
  cards: CardView[]
  feedback: string
}

/** Settler prompt input: the run input plus the submission identity. */
interface SettlerPromptInput extends SettlerInput {
  delegationId: string
}

/** One child stage's timing on a settlement trace. */
interface AttemptTrace {
  stage: string
  ms: number
  error?: string
}

/** Whole-settlement timing while attempts run. */
interface SettlementTrace {
  durationMs: number
  perAttempt: AttemptTrace[]
  lastError?: string
}

/** Timing detail on a receipt; landing reports only the total. */
interface ReceiptTrace {
  durationMs: number
  perAttempt?: AttemptTrace[]
  lastError?: string
}

/** One unresolved receipt before any write. */
interface UnresolvedInput {
  work: string
  chapter: number
  revision: number
  reason: string
  message?: string
  proposed: StatePayload
  warnings: string[]
  items: Finding[]
  settlerAttempts: number
  validatorAttempts: number
  started: number
  trace?: SettlementTrace
}

/** Per-path overrides for a timeout receipt. */
interface TimeoutExtra {
  revision?: number
  proposed?: StatePayload
  warnings?: string[]
  items?: Finding[]
  settlerAttempts?: number
  validatorAttempts?: number
}

/** What the accepted payload lands with. */
interface LandInput {
  work: string
  chapter: number
  revision: number
  seq: number
  payload: StatePayload
  warnings: string[]
  items: Finding[]
  settlerAttempts: number
  validatorAttempts: number
  started: number
  /** Accepted for symmetry with the other paths; landing reports only the total. */
  trace?: SettlementTrace
}

/** What a settlement returns: a landed receipt or an unresolved proposal. */
interface SettleReceipt {
  ok: true
  settled: boolean
  workId: string
  chapter: number
  revision: number
  reason?: string
  message?: string
  proposed?: StatePayload
  warnings: string[]
  items: Finding[]
  attempts: { settler: number; validator: number }
  trace: ReceiptTrace
  counts?: Record<string, number>
  draft?: { artifactId: string; revisionId: string; revision: number; ready: boolean }
  artifact?: { workId: string; artifactId: string; revisionId: string; kind: string }
}

/** One settler/validator child run's budget. */
// The validator reads body, summary and folded state; real runs took 180-300s,
// so the old 180s per-child budget fired on healthy work (see #50 acceptance).
const STATE_SETTLE_TIMEOUT_MS = 300000

/** Whole settlement budget; a timeout returns a receipt instead of retrying. */
const SETTLE_TOTAL_TIMEOUT_MS = 600000

/** Severity values that force a second settler attempt. */
const BLOCKING_SEVERITY = 'major'

/** The manifest entry of one chapter, when the manifest lists it. */
function entryOf(manifest: ManifestView, number: number): ManifestChapter | undefined {
  return manifest.chapters.find(item => item.number === number)
}

/** The last appended state event's sequence, or zero for an empty log. */
function lastSeq(root: string, work: string): number {
  const events: Array<{ seq: number | string }> = readEvents(root, work)
  return events.length === 0 ? 0 : Number(events[events.length - 1].seq)
}

/** Render validation feedback for the second settler attempt. */
function feedbackFor(items: Finding[]): string {
  return items
    .map(item => `- [${item.code}] ${item.where}：${item.problem}；${item.fix}`)
    .join('\n')
}

/** Build one unresolved receipt; no write has happened at this point. */
function unresolved(input: UnresolvedInput): SettleReceipt {
  const trace: SettlementTrace = input.trace ?? { durationMs: 0, perAttempt: [] }
  trace.durationMs = Date.now() - input.started
  return {
    ok: true,
    settled: false,
    workId: input.work,
    chapter: input.chapter,
    revision: input.revision,
    reason: input.reason,
    ...(input.message === undefined ? {} : { message: input.message }),
    proposed: input.proposed,
    warnings: input.warnings,
    items: input.items,
    attempts: { settler: input.settlerAttempts, validator: input.validatorAttempts },
    trace,
  }
}

/** Render one optional prompt section. */
function section(title: string, content: unknown): string {
  const text = String(content ?? '').trim()
  return text === '' ? '' : `## ${title}\n${text}`
}

/**
 * Build the settler prompt. The body is the only evidence; prior state, plan,
 * summary and cards are context. `feedback` is present only on the retry.
 */
function settlerPrompt(input: SettlerPromptInput): string {
  const baseline = JSON.stringify({
    chapter: input.chapter,
    revision: input.revision,
    seq: input.seq,
    facts: input.folded.facts,
    hooks: input.folded.hooks,
  }, null, 2)
  const context = [
    section('本章摘要（上下文，不是正文证据）', input.summary),
    section('本章章纲（上下文，不是正文证据）', input.plan),
    section('人物卡（上下文）', JSON.stringify(input.cards, null, 2)),
  ].filter(Boolean).join('\n\n')
  return [
    `你是《${input.manifest.title}》（${input.workId}）第 ${input.chapter} 章的 settler 子代理。`,
    '开工前先调用 skill 工具加载 `storycraft-state-settler`，严格按它抽取。',
    '不要用 glob/grep 搜索技能或插件文件；方法以加载到的技能正文为准。',
    '',
    '## 本次任务',
    `把本章正文 r${input.revision} 明确发生的增量事实与伏笔变化投影成 delta。`,
    '只写正文明确发生的事；计划、摘要、人物卡只作上下文，不是已发生事件。事实只追加；伏笔只使用 baseline 里已有的 text，新伏笔用最终措辞。',
    '',
    `## 本章正文（r${input.revision}，唯一事实证据）`,
    input.body,
    '',
    '## baseline（上下文；只投影这版正文）',
    baseline,
    '',
    ...(context === '' ? [] : [context, '']),
    ...(input.feedback === '' ? [] : [section('上一次结算的反馈', input.feedback), '']),
    '## 输出契约',
    `必须调用 story_submit，delegationId 是 ${input.delegationId}。`,
    'payload 格式：{"factOps":{"upsert":[{"subject":"…","predicate":"…","object":"…"}],"expire":[{"subject":"…","predicate":"…"}]},'
    + '"hookOps":{"progress":["hookId"],"mention":["hookId"],"defer":["hookId"],"resolve":["hookId"],"supersede":["hookId"]},'
    + '"newHooks":[{"text":"…"}]}。',
    '已有伏笔只能引用 baseline 的 hookId；新伏笔放进 newHooks，不给 id。本章没有可记录的变化时三个字段都为空。',
    '提交成功后最终只回「已提交」；不要手动落盘，不要改正文。',
    'story_submit 返回 ok:false 时，按 error.retryable 修正 payload 后重提，最多 3 次。',
  ].join('\n')
}

/** Run one settler child and return its accepted delta payload. */
async function runSettler(root: string, input: SettlerInput, host: SettleHost, timeoutMs: number): Promise<StatePayload> {
  const opened = openSubmission({ role: 'settler', workId: input.workId, chapter: input.chapter })
  let child
  try {
    child = await runChild({
      service: host.service,
      agent: host.agent,
      cwd: root,
      prompt: settlerPrompt({ ...input, delegationId: opened.delegationId }),
      label: '故事工坊-状态结算',
      signal: host.signal,
      timeoutMs,
      unavailableCode: 'state-settle-unavailable',
      failedCode: 'state-settle-failed',
      unavailableMessage: '当前组合没有可用的 subagents 服务：无法自动结算状态',
    })
    const result = child.result
    const submission = consumeSubmission(opened.delegationId)
    const attempts = submission?.attempts ?? 0
    if (result?.stopReason !== 'completed') {
      if (submission?.consumed !== true && attempts >= 3) {
        throw new StoryError('state-settle-no-submission',
          `settler 提交尝试用尽（${attempts} 次），未正常完成（${String(result?.stopReason ?? 'unknown')}）`)
      }
      throw new StoryError('state-settle-failed',
        `settler 未正常完成（${String(result?.stopReason ?? 'unknown')}）${result?.diagnostic === undefined ? '' : `：${result.diagnostic}`}`)
    }
    if (submission?.consumed !== true || submission.payload === undefined) {
      throw new StoryError('state-settle-no-submission',
        `settler 没有提交通过校验的结果（尝试 ${attempts} 次）`)
    }
    return submission.payload
  } finally {
    closeSubmission(opened.delegationId)
    if (child !== undefined) await child.dispose()
  }
}

/**
 * Settle one chapter automatically.
 * @param root - workspace directory.
 * @param input - work/chapter.
 * @param host - host dependencies.
 * @returns settled receipt, or an unresolved proposed delta; never writes on unresolved.
 */
export async function settleChapterState(
  root: string,
  input: SettleInput,
  host: SettleHost = {},
): Promise<SettleReceipt> {
  const work = String(input.work)
  const chapter = chapterNumber(input.chapter)
  const started = Date.now()
  const settleTimeoutMs = Number.isFinite(host.settleTimeoutMs) ? host.settleTimeoutMs! : SETTLE_TOTAL_TIMEOUT_MS
  const deadline = started + settleTimeoutMs
  const trace: SettlementTrace = { durationMs: 0, perAttempt: [] }
  const remaining = (): number => Math.max(0, deadline - Date.now())
  const timedOut = (message: string, extra: TimeoutExtra = {}): SettleReceipt => {
    trace.durationMs = Date.now() - started
    return unresolved({
    work, chapter, revision: extra.revision ?? 0, reason: 'state-settle-timeout', message,
    proposed: extra.proposed ?? { factOps: {}, hookOps: {}, newHooks: [] },
    warnings: extra.warnings ?? [], items: extra.items ?? [],
    settlerAttempts: extra.settlerAttempts ?? 0, validatorAttempts: extra.validatorAttempts ?? 0,
    started, trace,
    })
  }
  const pre = statePreflight(root, { work, chapter, requireBody: true })
  const manifest: ManifestView = readManifest(root, work)
  if (chapterStageOf(root, work, chapter) === 'settled') {
    throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：先 reopen 再结算`)
  }
  const bodyRead = readChapter(root, { work, chapter })
  const revision = bodyRead.revision
  const seq = lastSeq(root, work)
  const folded: FoldedView = readFoldedState(root, work)
  const summary = pre.summaryState.state === 'current' ? (readSummary(root, work, chapter) ?? '') : ''
  const plan = readPlan(root, work, chapter) ?? ''
  const cards = (await readCards(root, work))
    .filter(card => bodyRead.content.includes(card.name))
    .slice(0, 8)

  let proposed: StatePayload = { factOps: {}, hookOps: {}, newHooks: [] }
  let feedback = ''
  let pendingWarnings: string[] = []
  let pendingItems: Finding[] = []
  let settlerAttempts = 0
  let validatorAttempts = 0

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (remaining() <= 0) return timedOut('结算总预算已用完', { revision, proposed, settlerAttempts, validatorAttempts })
    settlerAttempts = attempt
    const settlerStart = Date.now()
    let payload: StatePayload
    try {
      payload = await runSettler(root, {
        workId: work, chapter, manifest, body: bodyRead.content, revision, seq, folded, summary, plan, cards, feedback,
      }, host, Math.min(Number.isFinite(host.timeoutMs) ? host.timeoutMs! : STATE_SETTLE_TIMEOUT_MS, remaining()))
      trace.perAttempt.push({ stage: 'settler', ms: Date.now() - settlerStart })
    } catch (error: any) {
      // A thrown child/service error crosses a dynamic boundary; only `message` is read.
      trace.perAttempt.push({ stage: 'settler', ms: Date.now() - settlerStart, error: String(error?.message ?? error) })
      trace.lastError = String(error?.message ?? error)
      if (remaining() <= 0 || /超时|already aborted|timeout/u.test(String(error?.message ?? ''))) {
        return timedOut('settler 超时：' + String(error?.message ?? error), {
          revision, proposed, settlerAttempts, validatorAttempts,
        })
      }
      throw error
    }
    const afterSettler = entryOf(readManifest(root, work), chapter)
    if (afterSettler === undefined || afterSettler.currentRevision !== revision || lastSeq(root, work) !== seq) {
      throw new StoryError('state-settle-stale', `第 ${chapter} 章在结算期间发生变化：请对当前版本重跑`)
    }
    proposed = {
      factOps: payload.factOps ?? {},
      hookOps: payload.hookOps ?? {},
      newHooks: payload.newHooks ?? [],
    }

    let preview
    try {
      preview = previewState(root, { work, chapter, ...proposed, allowEmpty: true })
    } catch (error: any) {
      // A store rejection crosses the SQLite boundary; only `message` is read.
      if (attempt === 1) {
        feedback = `上一次 payload 不合法：${error?.message ?? error}`
        pendingWarnings = [`state-invalid: ${error?.message ?? error}`]
        continue
      }
      return unresolved({
        work, chapter, revision, reason: 'state-invalid', message: String(error?.message ?? error),
        proposed, warnings: [], items: [], settlerAttempts, validatorAttempts, started, trace,
      })
    }

    if (preview.appended === 0) {
      if (attempt === 1 || pendingItems.length === 0) {
        trace.durationMs = Date.now() - started
        return land(root, {
          work, chapter, revision, seq, payload: proposed, warnings: pendingWarnings, items: [], settlerAttempts, validatorAttempts, started, trace,
        })
      }
      return unresolved({
        work, chapter, revision, reason: 'state-reconcile-required',
        proposed, warnings: pendingWarnings, items: pendingItems, settlerAttempts, validatorAttempts, started, trace,
      })
    }

    if (remaining() <= 0) {
      return timedOut('结算总预算已用完', { revision, proposed, warnings: pendingWarnings, items: pendingItems, settlerAttempts, validatorAttempts })
    }
    validatorAttempts += 1
    const checkStart = Date.now()
    let check
    try {
      check = await checkChapterState(root, { work, chapter, ...proposed }, {
        service: host.service,
        agent: host.agent,
        signal: host.signal,
        timeoutMs: Math.min(Number.isFinite(host.timeoutMs) ? host.timeoutMs! : STATE_SETTLE_TIMEOUT_MS, remaining()),
      })
      trace.perAttempt.push({ stage: 'validator', ms: Date.now() - checkStart })
    } catch (error: any) {
      // The semantic check crosses a module boundary; only `code` and `message` are read.
      trace.perAttempt.push({ stage: 'validator', ms: Date.now() - checkStart, error: String(error?.message ?? error) })
      trace.lastError = String(error?.message ?? error)
      if (remaining() <= 0 || /超时|already aborted|timeout/u.test(String(error?.message ?? ''))) {
        return timedOut('validator 超时：' + String(error?.message ?? error), {
          revision, proposed, warnings: pendingWarnings, items: pendingItems, settlerAttempts, validatorAttempts,
        })
      }
      if (error?.code === 'state-check-stale') {
        throw new StoryError('state-settle-stale', `第 ${chapter} 章在结算期间改版：请对当前版本重跑`)
      }
      if (error?.code === 'state-check-unavailable') {
        throw new StoryError('state-settle-unavailable', error.message)
      }
      if (error?.code === 'state-check-no-submission') {
        throw new StoryError('state-settle-no-submission', error.message)
      }
      if (error?.code === 'state-check-failed') {
        throw new StoryError('state-settle-failed', error.message)
      }
      if (attempt === 1) {
        feedback = `上一次语义检查拒绝：${error?.message ?? error}`
        continue
      }
      return unresolved({
        work, chapter, revision, reason: 'state-invalid', message: String(error?.message ?? error),
        proposed, warnings: [], items: [], settlerAttempts, validatorAttempts, started, trace,
      })
    }

    if (check.revision !== revision) {
      throw new StoryError('state-settle-stale', `第 ${chapter} 章在结算期间改版：请对当前版本重跑`)
    }
    const blocking = check.items.filter(item => item.severity === BLOCKING_SEVERITY)
    if (blocking.length === 0) {
      trace.durationMs = Date.now() - started
      return land(root, {
        work, chapter, revision, seq, payload: proposed,
        warnings: check.warnings, items: check.items, settlerAttempts, validatorAttempts, started, trace,
      })
    }
    if (attempt === 1) {
      feedback = feedbackFor(blocking)
      pendingWarnings = blocking.map(item => `${item.code}: ${item.where} — ${item.problem}`)
      pendingItems = blocking
      continue
    }
    return unresolved({
      work, chapter, revision, reason: 'state-reconcile-required',
      proposed, warnings: check.warnings, items: check.items, settlerAttempts, validatorAttempts, started, trace,
    })
  }

  throw new StoryError('state-settle-failed', '自动结算没有产生可接受的状态')
}

/** Re-check staleness, write the accepted payload, and build the success receipt. */
function land(root: string, input: LandInput): SettleReceipt {
  const latest: ManifestView = readManifest(root, input.work)
  const latestEntry = entryOf(latest, input.chapter)
  if (latestEntry === undefined || latestEntry.currentRevision !== input.revision
    || lastSeq(root, input.work) !== input.seq) {
    throw new StoryError('state-settle-stale', `第 ${input.chapter} 章在结算期间发生变化：请对当前版本重跑`)
  }
  const preview = previewState(root, {
    work: input.work,
    chapter: input.chapter,
    ...input.payload,
    allowEmpty: true,
  })
  const draft = writeStateDraft(root, {
    work: input.work,
    chapter: input.chapter,
    ...input.payload,
    findings: input.items,
    ready: true,
  })
  const minor = input.items.map(item => `${item.code}: ${item.where} — ${item.problem}`)
  const warnings = [...new Set([...input.warnings, ...minor])]
  return {
    ok: true,
    settled: true,
    workId: input.work,
    chapter: input.chapter,
    revision: input.revision,
    counts: preview.counts,
    warnings,
    items: input.items,
    attempts: { settler: input.settlerAttempts, validator: input.validatorAttempts },
    trace: { durationMs: Date.now() - input.started },
    draft: { artifactId: draft.artifactId, revisionId: draft.revisionId, revision: draft.revision, ready: draft.ready },
    artifact: { workId: input.work, artifactId: draft.artifactId, revisionId: draft.revisionId, kind: 'state_draft' },
  }
}

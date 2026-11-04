/**
 * Host-side chapter production delegation.
 *
 * One model-visible action runs a single role (writer, reviewer, reviser or
 * summarizer) as a managed child through the official `subagents` service,
 * validates the child's
 * output in the host, lands it through the existing store functions, and returns
 * a compact receipt. The chapter body and assembled context never reach the
 * parent model.
 */

import {
  FORM_META, StoryError, chapterNumber, formOf, nextStep, readFoundationState, readManifest, stageOf, unitOf,
  writeFoundationBundle, writeFoundationStage,
  type Form,
} from '../storage.ts'
import { readFoundationDocuments, writeContextTrace } from '../artifact-store.ts'
import { callEvidence } from '../call-evidence.ts'
import { assertChapterBudget, finishCall, nextAttempt, recordCall } from '../telemetry.ts'
import type { CallInput } from '../telemetry.ts'
import { acceptedProposalOf, maxChapterTokensOf } from '../storage.ts'
import { withMechanicalFindings } from '../critique.ts'
import { loadRoleInput } from './role-input.ts'
import { assertChildAvailability, runChild } from './child-run.ts'
import { buildRolePrompt } from './prompt-kit.ts'
import { DELEGATE_ROLES, ROLES, ROLE_META } from '../roles/registry.ts'
import type { RoleLanding } from '../roles/landing-types.ts'
import type { ChildRun, DelegateHost } from './child-run.ts'
import { architectPrompt, isFoundationStage, type FoundationStage } from '../roles/architect/agent.ts'
import { closeSubmission, consumeFoundationSubmission, consumeSubmission, markFoundationConsumed, openSubmission } from './submission.ts'

/** One child run's budget; the timer is cleared before landing. */
const DELEGATE_TIMEOUT_MS = 600000
export const FOUNDATION_DELEGATE_TIMEOUT_MS = 20 * 60 * 1000

/** One review observation as the store returns it; only id and assessment are read. */
interface ReviewObservation {
  id: string
  assessment?: string
}

/** Observations that still block settlement. */
function openObservationsOf(review: { observations?: ReviewObservation[] } | undefined): ReviewObservation[] {
  return (review?.observations ?? []).filter(observation => observation.assessment === 'issue')
}

/** Maximum warnings carried by a receipt. */
const MAX_WARNINGS = 5

/** Maximum characters in one warning. */
const MAX_WARNING_CHARS = 120



import { roleMethod, roleSkills, writerSkills, plannerSkills } from '../skill-routing.ts'
import { skillEvidence } from '../skill-evidence.ts'

export { roleMethod, writerSkills, plannerSkills }

/** One role's receipt label; routing owns the skill. */
interface RoleMeta {
  label: string
}

/** Whether a model-supplied role name is declared in `ROLE_META`. */
function isRoleName(role: string): boolean {
  return (DELEGATE_ROLES as readonly string[]).includes(role)
}

/** One chapter entry from the manifest. */
interface ManifestChapter {
  number: number
  currentRevision: number
  planApproved?: boolean
  stage?: string
}

/** Manifest fields this module reads; the store owns the full shape. */
interface ManifestView {
  workId: string
  title: string
  chapters: ManifestChapter[]
  outline?: { approvedAt?: string }
  planApproval?: string
  wordRange?: { min: number, max: number }
}

/** The chapter entry of one manifest, when the manifest lists it. */
function chapterEntryOf(manifest: ManifestView, number: number): ManifestChapter | undefined {
  return manifest.chapters.find(item => item.number === number)
}

/** Latest review fields preflight reads; the store owns the rest. */
interface PreflightReview {
  revision: number
  items: Array<{ done?: boolean }>
  observations?: ReviewObservation[]
}

/** One preflight request. */
interface PreflightInput {
  work: string
  chapter: number
  role: string
  mode: string
}

/** Preflight result: the manifest and the chapter entry, when present. */
interface PreflightResult {
  manifest: ManifestView
  entry: ManifestChapter | undefined
}

/**
 * Stage preflight before a child is started, so a doomed run never burns a full
 * generation. Each role contract owns its gates; the codes match the store actions.
 */
function preflight(root: string, input: PreflightInput): PreflightResult {
  const manifest = readManifest(root, input.work)
  const entry = chapterEntryOf(manifest, input.chapter)
  const deps = {
    root, work: input.work, role: input.role, chapter: input.chapter, mode: input.mode, manifest, entry,
  }
  ROLES[input.role].contract.preflight?.(deps as any, (code: string, message: string) => {
    throw new StoryError(code, message)
  })
  return { manifest, entry }
}

/** Context package the shared role-input loader assembles. */
type RoleContext = Awaited<ReturnType<typeof loadRoleInput>>['context']

/** Shorten receipt warnings to the contract budget and mark truncation. */
function receiptWarnings(warnings: readonly unknown[] | undefined): string[] {
  const list = (warnings ?? []).map(warning => String(warning))
  const truncated = list.length > MAX_WARNINGS
  const kept = list.slice(0, truncated ? MAX_WARNINGS - 1 : MAX_WARNINGS)
    .map(warning => (warning.length > MAX_WARNING_CHARS
      ? `${warning.slice(0, MAX_WARNING_CHARS - 1)}…`
      : warning))
  if (truncated) kept.push(`另有 ${list.length - kept.length} 条警告已省略`)
  return kept
}

/** Compact receipt; the size guard trims only the warning list. */
type Receipt = Record<string, unknown> & { warnings?: string[] }

/** Keep one receipt under the serialized character budget. */
function fitReceipt(receipt: Receipt): Receipt {
  const budget = 1500
  const value = { ...receipt }
  if (JSON.stringify(value).length <= budget) return value
  if (Array.isArray(value.warnings)) {
    value.warnings = ['回执过长，警告已省略']
    if (JSON.stringify(value).length <= budget) return value
    delete value.warnings
  }
  return value
}

/** Refuse to land after the caller cancelled the run. */
function assertActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new StoryError('delegation-failed', '子代理调用已取消，结果未落库')
  }
}

/** Read the landed stage after one write. */
function landedStage(root: string, work: string, chapter: number): ReturnType<typeof stageOf> {
  const manifest = readManifest(root, work)
  return stageOf(chapterEntryOf(manifest, chapter))
}

/** Architect action arguments after the role dispatch. */
interface ArchitectInput {
  work: unknown
  stage?: unknown
  instruction?: unknown
}

/** Run one foundation stage through the architect child and land it. */
async function delegateArchitect(root: string, input: ArchitectInput, host: DelegateHost): Promise<Receipt> {
  const work = String(input.work)
  const stage = String(input.stage ?? '')
  if (!isFoundationStage(stage)) {
    throw new StoryError('foundation-stage-invalid', `未知的 foundation stage：${stage}`)
  }
  assertChildAvailability(host?.service, host?.agent)
  const manifest = readManifest(root, work)
  const state = readFoundationState(root, work)
  if (stage === 'cards' && state.stages.roles !== true) {
    throw new StoryError('foundation-order', '先生成 roles 索引，再生成角色卡')
  }
  const documents = readFoundationDocuments(root, work)
  const architectSkills = skillEvidence(roleSkills('architect', formOf(manifest)))
  const opened = openSubmission({ role: 'architect', workId: work, stage })
  const prompt = architectPrompt({
    work, stage, instruction: typeof input.instruction === 'string' ? input.instruction : '',
    delegationId: opened.delegationId, manifest,
    proposal: acceptedProposalOf(root, work),
    foundation: {
      storyFrame: documents.storyFrame === undefined ? undefined : documents.storyFrame.content,
      volumeMap: documents.volumeMap === undefined ? undefined : documents.volumeMap.content,
      rolesIndex: documents.rolesIndex?.content,
    },
  })
  // The architect is the one role whose output can contradict the proposal, so
  // its assembled input is recorded like the other roles. The shape follows the
  // trace contract; extra facts go into notes, which the contract allows.
  // tokenBudget/sections stay empty on purpose: this is a provenance marker, not
  // a replay of the assembled context.
  try {
    const sources = [
      ...(documents.storyFrame === undefined ? [] : ['story_frame']),
      ...(documents.volumeMap === undefined ? [] : ['volume_map']),
      ...(documents.rolesIndex === undefined ? [] : ['roles_index']),
    ]
    writeContextTrace(root, {
      work, chapter: 1, role: 'architect',
      trace: {
        chapter: 1,
        skills: architectSkills,
        // The architect's inputs are the foundation documents it was given.
        plannerInputs: sources,
        composerInputs: [],
        selectedSources: sources,
        contextTiers: { protectedSources: sources, compressibleSources: [] },
        tokenBudget: { protectedTokens: 0, compressibleTokens: 0, totalSelectedTokens: 0 },
        notes: [`stage=${stage}`, `complete=${JSON.stringify(state.stages)}`, `instruction=${typeof input.instruction === 'string' ? input.instruction : ''}`],
        sections: [],
        trimmed: [],
        dropped: [],
        missing: [],
        overflow: false,
      },
    })
  } catch (error) {
    if (process.env.DSH_TRACE_DEBUG === '1') console.error('architect trace:', error)
  }
  const foundationFlow = stage === 'foundation'
  const timeoutMs = Number.isFinite(host.timeoutMs) ? host.timeoutMs! : foundationFlow ? FOUNDATION_DELEGATE_TIMEOUT_MS : DELEGATE_TIMEOUT_MS
  const signal = host.signal ?? new AbortController().signal
  let child: ChildRun | undefined
  try {
    child = await runChild({
      service: host?.service,
      agent: host?.agent,
      cwd: root,
      prompt,
      label: `故事工坊-${ROLE_META.architect.label}`,
      signal: host.signal,
      timeoutMs,
      availability: false,
      telemetry: {
        work, chapter: null, role: 'architect', scope: `architect:${stage}`, attempt: nextAttempt(root, work, null, 'architect', `architect:${stage}`), trigger: 'first',
        delegationId: opened.delegationId, sessions: host.sessions, agents: host.agents,
        sink: (call) => recordCall(root, work, call),
      },
    })
    const result = child.result
    const submission = foundationFlow ? consumeFoundationSubmission(opened.delegationId) : consumeSubmission(opened.delegationId)
    const attempts = submission?.attempts ?? 0
    if (result?.stopReason !== 'completed') {
      throw new StoryError('delegation-failed', `子代理未正常完成（${String(result?.stopReason ?? 'unknown')}）`)
    }
    if (submission === undefined || (foundationFlow ? submission.phases === undefined : submission.payload === undefined)) {
      throw new StoryError('delegation-no-submission', `子代理没有提交通过校验的 ${stage} 结果（尝试 ${attempts} 次）`, undefined, true)
    }
    assertActive(signal)
    const landed = foundationFlow
      ? writeFoundationBundle(root, { work, phases: Object.fromEntries(submission.phases!.entries()) })
      : writeFoundationStage(root, { work, stage, payload: submission.payload })
    if (foundationFlow) markFoundationConsumed(opened.delegationId)
    if (child.call.callId !== undefined) finishCall(root, work, child.call.callId, { outcome: 'accepted', submissionAttempts: attempts })
    return fitReceipt({
        durationMs: child.call.durationMs,
        usage: child.call.usage,
        retries: child.call.retries,
      ok: true,
      workId: work,
      role: 'architect',
      foundationStage: stage,
      artifacts: landed.artifacts,
      foundation: landed.foundation,
      submissionAttempts: attempts,
    })
  } finally {
    closeSubmission(opened.delegationId)
    if (child !== undefined) await child.dispose()
  }
}

/** Action arguments for `story_delegate`; each field is validated before use. */
interface DelegateInput {
  work?: unknown
  role?: unknown
  chapter?: unknown
  mode?: unknown
  stage?: unknown
  instruction?: unknown
}

/**
 * Run one role through the subagents service and land its result.
 */
export async function delegateRole(root: string, input: DelegateInput, host: DelegateHost): Promise<Receipt> {
  const work = String(input.work)
  const role = String(input.role)
  if (!isRoleName(role)) {
    throw new StoryError('delegation-failed', `未知角色：${role}`)
  }
  if (role === 'architect') return delegateArchitect(root, { ...input, work }, host)
  if (input.chapter === undefined) throw new StoryError('chapter-required', `${role} 需要 chapter`)
  const chapter = chapterNumber(input.chapter)
  const contract = ROLES[role].contract
  const mode = contract.usesMode === true && typeof input.mode === 'string' ? input.mode : 'patch'
  assertChildAvailability(host?.service, host?.agent)

  const { manifest } = preflight(root, { work, chapter, role, mode })

  // The gate: the stage machine owns the order. A role that is not the current
  // next action is refused before any context is assembled or child started.
  const step = await nextStep(root, work)
  const expectedAction = ROLES[role].contract.nextAction
  if (expectedAction !== undefined && step.action !== expectedAction) {
    throw new StoryError(
      'not-next-action',
      `现在应做的是 ${step.action}（${step.reason ?? ''}）；${ROLE_META[role].label} 不在当前步骤上`,
      '按 story_next 返回的动作继续，不要换角色',
    )
  }
  if (contract.revisionLimitBlocked === true && Array.isArray(step.blocked) && step.blocked.includes('revision-limit')) {
    throw new StoryError('revision-limit', step.reason ?? `第 ${chapter} 章已达修订上限`, '用「接受当前版本」推进，或先停')
  }
  const loaded = await loadRoleInput(root, {
    work, chapter, role,
    ...(typeof input.instruction === 'string' ? { instruction: input.instruction } : {}),
    ...(contract.usesMode === true ? { mode } : {}),
  })
  // The mechanical checks are material for the reviewer: findings come first,
  // and the prompt asks the model not to repeat them.
  if (contract.mechanicalFindings === true) {
    loaded.context.taskText = withMechanicalFindings(loaded.context.taskText, loaded.body, manifest.wordRange)
  }
  // Record what this dispatch sends. The planner's plan does not exist yet, so
  // its trace is written after landing; a failed write never blocks dispatch.
  if (contract.traceAfterLand !== true) {
    try {
      writeContextTrace(root, { work, chapter, role, trace: loaded.context.trace })
    } catch {
      // Diagnostics only: the child still gets its context.
    }
  }
  const opened = openSubmission({
    role,
    workId: work,
    chapter,
    ...(contract.usesMode === true ? { mode } : {}),
    ...(loaded.manifest.wordRange === undefined ? {} : { wordRange: loaded.manifest.wordRange }),
  })
  const prompt = buildRolePrompt({ input: { role, chapter, mode }, manifest, context: loaded.context, delegationId: opened.delegationId })

  const timeoutMs = Number.isFinite(host.timeoutMs) ? host.timeoutMs! : DELEGATE_TIMEOUT_MS
  const signal = host.signal ?? new AbortController().signal
  let child: ChildRun | undefined
  try {
    child = await runChild({
      service: host?.service,
      agent: host?.agent,
      cwd: root,
      prompt,
      label: `故事工坊-${ROLE_META[role].label}`,
      signal: host.signal,
      timeoutMs,
      availability: false,
      telemetry: {
        work, chapter, role,
        scope: `${role}:r${manifest.chapters.find(item => item.number === chapter)?.currentRevision ?? 0}`,
        attempt: nextAttempt(root, work, chapter, role, `${role}:r${manifest.chapters.find(item => item.number === chapter)?.currentRevision ?? 0}`), trigger: 'first', delegationId: opened.delegationId,
        sessions: host.sessions, agents: host.agents, sink: (call) => recordCall(root, work, call),
        assertBudget: () => assertChapterBudget(root, work, chapter, maxChapterTokensOf(root, work)),
      },
    })
    const result = child.result
    const submission = consumeSubmission(opened.delegationId)
    const attempts = submission?.attempts ?? 0
    if (result?.stopReason !== 'completed') {
      if (submission?.consumed !== true && attempts >= 3) {
        throw new StoryError('delegation-no-submission',
          `子代理提交尝试用尽（${attempts} 次），未正常完成（${String(result?.stopReason ?? 'unknown')}）`)
      }
      throw new StoryError('delegation-failed',
        `子代理未正常完成（${String(result?.stopReason ?? 'unknown')}）${result?.diagnostic === undefined ? '' : `：${result.diagnostic}`}`)
    }
    if (submission?.consumed !== true || submission.payload === undefined) {
      if (result?.stopReason === 'completed' && child.call.callId !== undefined) {
        finishCall(root, work, child.call.callId, { outcome: 'rejected', submissionAttempts: attempts, errorCode: 'delegation-no-submission' })
      }
      throw new StoryError('delegation-no-submission',
        `子代理没有提交通过校验的角色结果（尝试 ${attempts} 次）`)
    }
    const payload = submission.payload
    assertActive(signal)
    const module = ROLES[role]
    if (module?.agent === undefined) throw new StoryError('delegation-failed', `角色 ${role} 没有入账实现`)
    let acceptedCallId = child.call.callId
    let retries = child.call.retries
    let attemptsTotal = attempts
    let landing: RoleLanding
    try {
      landing = await module.agent.land({ root, work, chapter, payload, mode, manifest, loaded })
    } catch (error: unknown) {
      if (acceptedCallId !== undefined) {
        finishCall(root, work, acceptedCallId, {
          outcome: 'rejected', submissionAttempts: attempts, errorCode: (error as { code?: string })?.code,
        })
      }
      const feedback = module.agent.landRetry?.(error as { code?: string, message?: string }, { revision: manifest.chapters.find(item => item.number === chapter)?.currentRevision ?? 0 })
      if (feedback === undefined) throw error
      const revision = manifest.chapters.find(item => item.number === chapter)?.currentRevision ?? 0
      const retryOpened = openSubmission({
        role,
        workId: work,
        chapter,
        ...(manifest.wordRange === undefined ? {} : { wordRange: manifest.wordRange }),
      })
      let retryChild: ChildRun | undefined
      try {
        retryChild = await runChild({
          service: host?.service,
          agent: host?.agent,
          cwd: root,
          prompt: `${prompt.replaceAll(opened.delegationId, retryOpened.delegationId)}\n\n## 上次提交被拒绝\n${feedback}`,
          label: `故事工坊-${ROLE_META[role].label}`,
          signal: host.signal,
          timeoutMs,
          availability: false,
          telemetry: {
            work, chapter, role, scope: `${role}:r${revision}`,
            attempt: nextAttempt(root, work, chapter, role, `${role}:r${revision}`),
            trigger: 'reviewer-quote-retry', delegationId: retryOpened.delegationId, sessions: host.sessions, agents: host.agents,
            sink: (call) => recordCall(root, work, call),
            assertBudget: () => assertChapterBudget(root, work, chapter, maxChapterTokensOf(root, work)),
          },
        })
        const retrySubmission = consumeSubmission(retryOpened.delegationId)
        if (retryChild.result?.stopReason !== 'completed' || retrySubmission?.consumed !== true || retrySubmission.payload === undefined) {
          throw new StoryError('delegation-no-submission', `引文被拒后的重试仍未提交通过校验的角色结果（尝试 ${retrySubmission?.attempts ?? 0} 次）`)
        }
        assertActive(signal)
        attemptsTotal = Math.min(3, attempts + (retrySubmission.attempts ?? 1))
        retries += retryChild.call.retries
        landing = await module.agent.land({ root, work, chapter, payload: retrySubmission.payload, mode, manifest, loaded })
        acceptedCallId = retryChild.call.callId
      } finally {
        closeSubmission(retryOpened.delegationId)
        if (retryChild !== undefined) await retryChild.dispose()
      }
    }
    if (module.contract.traceAfterLand === true) {
      try {
        writeContextTrace(root, { work, chapter, role, trace: loaded.context.trace })
      } catch {
        // Diagnostics only: the artifact already landed.
      }
    }
    if (acceptedCallId !== undefined) finishCall(root, work, acceptedCallId, { outcome: 'accepted', submissionAttempts: attemptsTotal })
    return fitReceipt({
      durationMs: child.call.durationMs,
      usage: child.call.usage,
      retries,
      ok: true,
      workId: work,
      chapter,
      role,
      stage: landedStage(root, work, chapter),
      ...landing,
      submissionAttempts: attemptsTotal,
      ...(landing.warnings === undefined || landing.warnings.length === 0 ? {} : { warnings: receiptWarnings(landing.warnings) }),
    })
  } finally {
    closeSubmission(opened.delegationId)
    if (child !== undefined) await child.dispose()
  }
}

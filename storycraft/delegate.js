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

import { createHash } from 'node:crypto'
import {
  FORM_META, StoryError, chapterNumber, formOf, latestReview, readManifest, readPlan, readSummary, readSummaryState, reviseChapter,
  stageOf, summaryAdmissible, unitOf, writeChapter, writeReview, writeSummary,
} from './storage.js'
import { loadRoleInput } from './role-input.js'
import { checkDraft } from './landing.js'
import { closeSubmission, consumeSubmission, openSubmission } from './submission.js'

/** One child run's budget; the timer is cleared before landing. */
const DELEGATE_TIMEOUT_MS = 600000

/** Short hash for a review receipt revision. */
function hashText(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12)
}

/** Maximum warnings carried by a receipt. */
const MAX_WARNINGS = 5

/** Maximum characters in one warning. */
const MAX_WARNING_CHARS = 120

/** Role labels and role-specific skills; writer adds the form skill separately. */
export const ROLE_META = {
  writer: { label: '写手', skill: 'storycraft-write-craft' },
  reviewer: { label: '审稿', skill: 'storycraft-review' },
  reviser: { label: '修订', skill: 'storycraft-revise-craft' },
  summarizer: { label: '摘要' },
}

export function writerSkills(form) {
  return [...new Set([ROLE_META.writer.skill, FORM_META[formOf({ form })].skill])]
}

function chapterEntryOf(manifest, number) {
  return manifest.chapters.find(item => item.number === number)
}

/**
 * Stage preflight before a child is started, so a doomed run never burns a full
 * generation. The codes match the existing store actions.
 * @param {string} root - workspace.
 * @param {{work: string, chapter: number, role: string, mode: string}} input - request.
 * @returns {{manifest: object, entry: object|undefined}} preflight result.
 */
function preflight(root, input) {
  const { work, chapter, role, mode } = input
  const manifest = readManifest(root, work)
  const entry = chapterEntryOf(manifest, chapter)

  if (role === 'writer') {
    const plan = readPlan(root, work, chapter)
    if (entry === undefined || plan === undefined) {
      throw new StoryError('plan-not-found', `第 ${chapter} 章还没有章纲：先 story_plan，再写正文`)
    }
    if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：改正文请先 reopen`)
    if (entry.currentRevision > 0) throw new StoryError('chapter-exists', `第 ${chapter} 章已有正文；改稿请走 story_revise 或手动 rewrite`)
    if (manifest.planApproval === 'required' && entry.planApproved !== true) {
      throw new StoryError('plan-not-approved', `第 ${chapter} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」后再写正文`)
    }
    return { manifest, entry }
  }

  if (role === 'summarizer') {
    if (entry === undefined || entry.currentRevision === 0) {
      throw new StoryError('chapter-not-written', `第 ${chapter} 章还没有正文：先写正文，再写摘要`)
    }
    const summary = readSummaryState(root, work, chapter)
    if (summary.state === 'current') {
      throw new StoryError('summary-exists', `第 ${chapter} 章当前版本已有摘要：作者的主动重写请走手动 story_summarize`)
    }
    const latest = latestReview(root, work, chapter)
    if (summaryAdmissible(entry, latest)) return { manifest, entry }
    throw new StoryError('review-required', `第 ${chapter} 章还没到可写摘要的阶段：先完成审稿与修订，或清稿`)
  }

  if (entry === undefined || entry.currentRevision === 0) {
    throw new StoryError('chapter-not-written', `第 ${chapter} 章还没有正文：先写正文，再${role === 'reviewer' ? '审稿' : '修订'}`)
  }
  if (stageOf(entry) === 'settled') throw new StoryError('chapter-settled', `第 ${chapter} 章已定稿：先 reopen 再${role === 'reviewer' ? '审稿' : '修订'}`)

  if (role === 'reviewer') return { manifest, entry }

  const latest = latestReview(root, work, chapter)
  if (latest === undefined) throw new StoryError('review-required', `第 ${chapter} 章还没有审稿：先 story_review`)
  const open = latest.items.filter(item => !item.done)
  if (open.length === 0) {
    throw new StoryError('review-required', `第 ${chapter} 章没有未处理的审稿条目：先 story_review，再修订`)
  }
  const current = entry.currentRevision
  const covers = latest.revision === current || (mode !== 'patch' && latest.revision === current - 1)
  if (!covers) throw new StoryError('review-required', `第 ${chapter} 章的审稿针对旧版本 r${latest.revision}：先重新审稿`)
  return { manifest, entry }
}

/** Render the assembled sections as the child's context block. */
function contextText(context) {
  return context.sections
    .filter(section => section.content !== '')
    .map(section => `## ${section.title}\n${section.content}`)
    .join('\n\n')
}

/** Build the child prompt for one role. */
function promptFor({ input, manifest, context, delegationId }) {
  const meta = ROLE_META[input.role]
  const form = formOf(manifest)
  const formMeta = FORM_META[form]
  const skills = input.role === 'writer' ? writerSkills(form) : (meta.skill === undefined ? [] : [meta.skill])
  const lines = [
    `你是${formMeta.label}《${manifest.title}》（${manifest.workId}）的${meta.label}子代理，负责第 ${input.chapter} ${unitOf(form)}。`,
    ...(skills.length === 0 ? [] : [`开工前先调用 skill 工具加载 ${skills.map(skill => `\`${skill}\``).join('、')}，严格按它们的方法执行。`]),
    '',
    '## 本次任务',
    context.taskText,
    '',
    '## 写前上下文',
    contextText(context),
    '',
    '## 输出契约',
    `必须调用 story_submit，delegationId 是 ${delegationId}。`,
  ]
  if (input.role === 'writer') {
    lines.push('payload 格式：{"title":"本章标题","body":"整章正文"}。')
    lines.push('不要省略正文，不要把正文作为最终回答；提交成功后最终只回「已提交」。')
  } else if (input.role === 'reviser') {
    lines.push('payload 格式：{"body":"修订后的整章正文"}。')
    const modeRule = input.mode === 'rewrite'
      ? '可以重组段落与场景，但必须保留章纲事实、人物动机与章末落点；'
      : input.mode === 'deslop'
        ? '只处理腔调词与套话，不改情节与段落结构；'
        : '只改本次任务点名的条目，未点名段落保持原样；'
    lines.push(`修订模式：${input.mode}。${modeRule}`)
    lines.push('提交成功后最终只回「已提交」；不要手动调用落盘动作。')
  } else if (input.role === 'summarizer') {
    lines.push('payload 格式：{"summary":"本章摘要"}。')
    lines.push('摘要只写本章发生的事实与状态变化，不超过 400 字；不评价、不补设定、不写下一章计划。')
    lines.push('提交成功后最终只回「已提交」；不要手动调用落盘动作。')
  } else {
    lines.push('payload 格式：{"items":[{"where":"正文里的具体位置","problem":"问题","impact":"读者影响","severity":"blocker|major|minor","fix":"怎么修","mode":"patch|polish|rewrite|deslop"}]}。')
    lines.push('没有问题时 payload 为 {"items":[]}；提交成功后最终只回「已提交」。')
  }
  lines.push('story_submit 返回 ok:false 时，按 error.retryable 修正 payload 后重提，最多 3 次；不要把工具错误当成最终失败。')
  return lines.join('\n')
}
function abortPromise(signal, message, code) {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new StoryError(code, message))
      return
    }
    signal.addEventListener('abort', () => reject(new StoryError(code, message)), { once: true })
  })
}

/**
 * Refuse a run before any preflight or DB read when no child can be started.
 * Shared by chapter delegation (to keep its error order) and the state check.
 * @param {object|undefined} service - subagents service.
 * @param {object|undefined} agent - calling agent.
 * @param {{unavailableCode?: string, unavailableMessage?: string}} [options] - error shape.
 */
function assertChildAvailability(service, agent, options = {}) {
  const unavailableCode = options.unavailableCode ?? 'delegation-unavailable'
  const unavailableMessage = options.unavailableMessage
    ?? '当前组合没有可用的 subagents 服务：请走手动 story_context + subagent 路径'
  if (service === undefined || agent === undefined) {
    throw new StoryError(unavailableCode, unavailableMessage)
  }
  if (typeof service.list === 'function') {
    const providers = service.list()
    if (Array.isArray(providers) && !providers.includes('spawn')) {
      throw new StoryError(unavailableCode, '当前组合没有 spawn 子代理 provider：请走手动 story_context + subagent 路径')
    }
  }
}

/**
 * Start one child and await its completion.
 *
 * The caller owns cleanup: this returns `{result, dispose}` so landing can
 * happen before the child is disposed, matching the pre-refactor order. On any
 * failure the helper disposes before rethrowing.
 * @param {object} input - service, agent, cwd, prompt, label, signal, timeoutMs.
 * @returns {Promise<{result: object, dispose: () => Promise<void>}>} child result and cleaner.
 */
export async function runChild(input) {
  const {
    service, agent, cwd, prompt, label, signal, timeoutMs,
    availability = true,
    unavailableCode = 'delegation-unavailable',
    failedCode = 'delegation-failed',
    unavailableMessage = '当前组合没有可用的 subagents 服务：请走手动 story_context + subagent 路径',
  } = input
  if (availability) {
    assertChildAvailability(service, agent, { unavailableCode, unavailableMessage })
  }

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const callerSignal = signal ?? new AbortController().signal
  const combined = AbortSignal.any([callerSignal, timeout.signal])
  let activation
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    if (activation !== undefined) {
      try {
        await activation.dispose()
      } catch (error) {
        console.warn(`[storycraft] 子代理清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  try {
    try {
      activation = await service.startActivation({
        provider: 'spawn',
        label,
        request: {
          parent: agent,
          cwd,
          prompt: [{ type: 'text', text: prompt }],
        },
        signal: combined,
        delivery: 'caller',
      })
    } catch (error) {
      if (error?.code === 'UNSUPPORTED_CAPABILITY' || /provider|capabilit/iu.test(String(error?.message))) {
        throw new StoryError(unavailableCode, `子代理 provider 不可用：${error?.message ?? error}`)
      }
      throw new StoryError(failedCode, `子代理启动失败：${error?.message ?? error}`)
    }

    const result = await Promise.race([
      activation.result,
      abortPromise(callerSignal, '子代理调用被取消', failedCode),
      abortPromise(timeout.signal, '子代理调用超时', failedCode),
    ]).catch(error => {
      if (error instanceof StoryError) throw error
      throw new StoryError(failedCode, `子代理调用失败：${error?.message ?? error}`)
    })
    clearTimeout(timer)
    return { result, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}

/** Shorten receipt warnings to the contract budget and mark truncation. */
function receiptWarnings(warnings) {
  const list = (warnings ?? []).map(warning => String(warning))
  const truncated = list.length > MAX_WARNINGS
  const kept = list.slice(0, truncated ? MAX_WARNINGS - 1 : MAX_WARNINGS)
    .map(warning => (warning.length > MAX_WARNING_CHARS
      ? `${warning.slice(0, MAX_WARNING_CHARS - 1)}…`
      : warning))
  if (truncated) kept.push(`另有 ${list.length - kept.length} 条警告已省略`)
  return kept
}

/** Keep one receipt under the serialized character budget. */
function fitReceipt(receipt) {
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
function assertActive(signal) {
  if (signal.aborted) {
    throw new StoryError('delegation-failed', '子代理调用已取消，结果未落库')
  }
}

/** Read the landed stage after one write. */
function landedStage(root, work, chapter) {
  const manifest = readManifest(root, work)
  return stageOf(chapterEntryOf(manifest, chapter))
}

/**
 * Run one role through the subagents service and land its result.
 * @param {string} root - workspace directory.
 * @param {object} input - action arguments.
 * @param {{service?: object, agent?: object, signal?: AbortSignal}} host - host dependencies.
 * @returns {Promise<object>} compact receipt.
 */
export async function delegateRole(root, input, host) {
  const work = String(input.work)
  const chapter = chapterNumber(input.chapter)
  const role = String(input.role)
  if (ROLE_META[role] === undefined) {
    throw new StoryError('delegation-failed', `未知角色：${role}`)
  }
  const mode = role === 'reviser' && typeof input.mode === 'string' ? input.mode : 'patch'
  assertChildAvailability(host?.service, host?.agent)

  preflight(root, { work, chapter, role, mode })
  const loaded = await loadRoleInput(root, {
    work, chapter, role,
    ...(typeof input.instruction === 'string' ? { instruction: input.instruction } : {}),
    ...(role === 'reviser' ? { mode } : {}),
  })
  const opened = openSubmission({
    role,
    workId: work,
    chapter,
    ...(role === 'reviser' ? { mode } : {}),
    ...(loaded.manifest.wordRange === undefined ? {} : { wordRange: loaded.manifest.wordRange }),
  })
  const prompt = promptFor({ input: { role, chapter, mode }, manifest: loaded.manifest, context: loaded.context, delegationId: opened.delegationId })

  const timeoutMs = Number.isFinite(host.timeoutMs) ? host.timeoutMs : DELEGATE_TIMEOUT_MS
  const signal = host.signal ?? new AbortController().signal
  let child
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
      throw new StoryError('delegation-no-submission',
        `子代理没有提交通过校验的角色结果（尝试 ${attempts} 次）`)
    }
    const payload = submission.payload
    assertActive(signal)

    if (role === 'writer') {
      const { title, body } = payload
      const { warnings } = await checkDraft(root, { work, chapter, body })
      assertActive(signal)
      const written = writeChapter(root, {
        work, chapter, title, body,
        requirePlanApproval: loaded.manifest.planApproval === 'required',
      })
      return fitReceipt({
        ok: true,
        workId: work,
        chapter,
        role,
        stage: landedStage(root, work, chapter),
        revision: written.revision,
        artifact: { workId: work, artifactId: `chapter:${chapter}`, revisionId: `r${written.revision}`, kind: 'chapter' },
        words: written.words,
        submissionAttempts: attempts,
        ...(loaded.manifest.wordRange === undefined ? {} : { wordRange: loaded.manifest.wordRange }),
        ...(warnings.length === 0 ? {} : { warnings: receiptWarnings(warnings) }),
      })
    }

    if (role === 'reviewer') {
      const problems = payload.items.map(item => ({
        location: item.where,
        problem: item.problem,
        suggestion: item.fix,
      }))
      const written = writeReview(root, { work, chapter, problems })
      const latest = latestReview(root, work, chapter)
      return fitReceipt({
        ok: true,
        workId: work,
        chapter,
        role,
        stage: landedStage(root, work, chapter),
        reviewRound: written.round,
        artifact: { workId: work, artifactId: `review:${chapter}:r${latest.revision}:${written.round}`, revisionId: hashText(latest.text), kind: 'review' },
        problems: { total: written.problems.length, open: written.problems.length },
        submissionAttempts: attempts,
      })
    }

    if (role === 'summarizer') {
      assertActive(signal)
      const receipt = writeSummary(root, { work, chapter, text: payload.summary, ifAbsent: true })
      const landed = readSummary(root, work, chapter) ?? ''
      return fitReceipt({
        ok: true,
        workId: work,
        chapter,
        role,
        stage: landedStage(root, work, chapter),
        artifact: { workId: work, artifactId: `summary:${chapter}`, revisionId: hashText(landed), kind: 'summary' },
        summaryChars: receipt.chars,
        submissionAttempts: attempts,
      })
    }

    const { body } = payload
    const { warnings } = await checkDraft(root, { work, chapter, body })
    assertActive(signal)
    const open = latestReview(root, work, chapter).items.filter(item => !item.done).map(item => item.id)
    const revised = reviseChapter(root, {
      work, chapter, body, problemIds: open, mode,
    })
    return fitReceipt({
      ok: true,
      workId: work,
      chapter,
      role,
      stage: landedStage(root, work, chapter),
      revision: revised.revision,
      artifact: { workId: work, artifactId: `chapter:${chapter}`, revisionId: `r${revised.revision}`, kind: 'chapter' },
      words: revised.words,
      resolved: revised.resolved,
      submissionAttempts: attempts,
      lastMode: mode,
      ...(loaded.manifest.wordRange === undefined ? {} : { wordRange: loaded.manifest.wordRange }),
      ...(warnings.length === 0 ? {} : { warnings: receiptWarnings(warnings) }),
    })
  } finally {
    closeSubmission(opened.delegationId)
    if (child !== undefined) await child.dispose()
  }
}

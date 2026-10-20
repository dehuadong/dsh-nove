/**
 * Host-side chapter production delegation.
 *
 * One model-visible action runs a single role (writer, reviewer or reviser) as a
 * managed child through the official `subagents` service, validates the child's
 * output in the host, lands it through the existing store functions, and returns
 * a compact receipt. The chapter body and assembled context never reach the
 * parent model.
 */

import {
  StoryError, chapterNumber, latestReview, readManifest, readPlan, reviseChapter, stageOf, writeChapter, writeReview,
} from './storage.js'
import { loadRoleInput } from './role-input.js'
import { checkDraft, checkWordRange } from './landing.js'

/** One child run's budget; the timer is cleared before landing. */
const DELEGATE_TIMEOUT_MS = 600000

/** Maximum warnings carried by a receipt. */
const MAX_WARNINGS = 5

/** Maximum characters in one warning. */
const MAX_WARNING_CHARS = 120

/** Role labels and skills the child must load. */
const ROLE_META = {
  writer: { label: '写手', skill: 'storycraft-write-craft' },
  reviewer: { label: '审稿', skill: 'storycraft-review' },
  reviser: { label: '修订', skill: 'storycraft-revise-craft' },
}

/** JSON schema for the reviewer's structured result. */
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          where: { type: 'string' },
          problem: { type: 'string' },
          impact: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          fix: { type: 'string' },
          mode: { type: 'string', enum: ['patch', 'polish', 'rewrite', 'deslop'] },
        },
        required: ['where', 'problem', 'severity', 'fix'],
      },
    },
  },
  required: ['items'],
}

/** Virtual path/read helpers keep errors consistent with the manual actions. */
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
    if (manifest.planApproval === 'required' && entry.planApprovedAt === undefined) {
      throw new StoryError('plan-not-approved', `第 ${chapter} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」后再写正文`)
    }
    return { manifest, entry }
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
function promptFor({ input, manifest, context }) {
  const meta = ROLE_META[input.role]
  const lines = [
    `你是长篇小说《${manifest.title}》（${manifest.workId}）的${meta.label}子代理，负责第 ${input.chapter} 章。`,
    `开工前先调用 skill 工具加载 \`${meta.skill}\`，严格按它的方法执行。`,
    '',
    '## 本次任务',
    context.taskText,
    '',
    '## 写前上下文',
    contextText(context),
    '',
    '## 输出契约',
  ]
  if (input.role === 'writer') {
    lines.push('只输出标题与整章正文，使用首尾标记：')
    lines.push('<<<TITLE 本章标题 TITLE>>>')
    lines.push('<<<CHAPTER 整章正文 CHAPTER>>>')
    lines.push('不要写解释、不要省略、不要调用任何动作。')
  } else if (input.role === 'reviser') {
    lines.push('只输出修订后的整章正文，使用首尾标记：')
    lines.push('<<<CHAPTER 修订后的整章正文 CHAPTER>>>')
    const modeRule = input.mode === 'rewrite'
      ? '可以重组段落与场景，但必须保留章纲事实、人物动机与章末落点；'
      : input.mode === 'deslop'
        ? '只处理腔调词与套话，不改情节与段落结构；'
        : '只改本次任务点名的条目，未点名段落保持原样；'
    lines.push(`修订模式：${input.mode}。${modeRule}不要调用任何动作。`)
  } else {
    lines.push('只输出一个 JSON 对象，不要写解释：')
    lines.push('{"items":[{"where":"正文里的具体位置","problem":"问题","impact":"读者影响","severity":"blocker|major|minor","fix":"怎么修","mode":"patch|polish|rewrite|deslop"}]}')
    lines.push('没有问题时输出 {"items":[]}。不要改正文、不要调用任何动作。')
  }
  return lines.join('\n')
}

/** Extract the first text result from a child's output blocks. */
function outputText(result) {
  return (result.output ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** Parse a JSON object from structured output or fenced/plain text. */
function reviewItems(result) {
  let value = result.structured
  if (value === undefined) {
    const text = outputText(result)
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new StoryError('delegation-output-invalid', '审稿子代理没有返回可解析的 JSON')
    }
    try {
      value = JSON.parse(text.slice(start, end + 1))
    } catch {
      throw new StoryError('delegation-output-invalid', '审稿子代理返回的 JSON 不合法')
    }
  }
  if (value === null || typeof value !== 'object' || !Array.isArray(value.items)) {
    throw new StoryError('delegation-output-invalid', '审稿子代理的输出缺少 items 数组')
  }
  return value.items.map((item, index) => {
    const where = String(item?.where ?? '').trim()
    const problem = String(item?.problem ?? '').trim()
    const fix = String(item?.fix ?? '').trim()
    if (where === '' || problem === '') {
      throw new StoryError('delegation-output-invalid', `审稿第 ${index + 1} 条缺少 where 或 problem`)
    }
    return {
      location: where,
      problem,
      suggestion: fix === '' ? '未给出建议' : fix,
    }
  })
}

/** Parse the writer/reviser marker contract. */
function bodyOf(result, { requireTitle }) {
  const text = outputText(result)
  const chapter = /<<<CHAPTER\s*([\s\S]*?)\s*CHAPTER>>>/u.exec(text)?.[1]?.trim()
  if (chapter === undefined || chapter === '') {
    throw new StoryError('delegation-output-invalid', '子代理输出缺少 <<<CHAPTER ... CHAPTER>>> 正文')
  }
  const title = /<<<TITLE\s*([\s\S]*?)\s*TITLE>>>/u.exec(text)?.[1]?.trim()
  if (requireTitle && (title === undefined || title === '')) {
    throw new StoryError('delegation-output-invalid', '写手输出缺少 <<<TITLE ... TITLE>>> 标题')
  }
  return { title, body: chapter }
}

/** Abort promise that rejects with the delegation error code. */
function abortPromise(signal, message) {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new StoryError('delegation-failed', message))
      return
    }
    signal.addEventListener('abort', () => reject(new StoryError('delegation-failed', message)), { once: true })
  })
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
  if (host?.service === undefined || host?.agent === undefined) {
    throw new StoryError('delegation-unavailable', '当前组合没有可用的 subagents 服务：请走手动 story_context + subagent 路径')
  }
  if (typeof host.service.list === 'function') {
    const providers = host.service.list()
    if (Array.isArray(providers) && !providers.includes('spawn')) {
      throw new StoryError('delegation-unavailable', '当前组合没有 spawn 子代理 provider：请走手动 story_context + subagent 路径')
    }
  }

  preflight(root, { work, chapter, role, mode })
  const loaded = await loadRoleInput(root, {
    work, chapter, role,
    ...(typeof input.instruction === 'string' ? { instruction: input.instruction } : {}),
    ...(role === 'reviser' ? { mode } : {}),
  })
  const prompt = promptFor({ input: { role, chapter, mode }, manifest: loaded.manifest, context: loaded.context })

  const timeoutMs = Number.isFinite(host.timeoutMs) ? host.timeoutMs : DELEGATE_TIMEOUT_MS
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const callerSignal = host.signal ?? new AbortController().signal
  const signal = AbortSignal.any([callerSignal, timeout.signal])
  let activation
  try {
    try {
      activation = await host.service.startActivation({
        provider: 'spawn',
        label: `故事工坊-${ROLE_META[role].label}`,
        request: {
          parent: host.agent,
          cwd: root,
          prompt: [{ type: 'text', text: prompt }],
          ...(role === 'reviewer' ? { outputSchema: REVIEW_SCHEMA } : {}),
        },
        signal,
        delivery: 'caller',
      })
    } catch (error) {
      if (error?.code === 'UNSUPPORTED_CAPABILITY' || /provider|capabilit/iu.test(String(error?.message))) {
        throw new StoryError('delegation-unavailable', `子代理 provider 不可用：${error?.message ?? error}`)
      }
      throw new StoryError('delegation-failed', `子代理启动失败：${error?.message ?? error}`)
    }

    let result
    try {
      result = await Promise.race([
        activation.result,
        abortPromise(callerSignal, '子代理调用被取消'),
        abortPromise(timeout.signal, '子代理调用超时'),
      ])
    } catch (error) {
      if (error instanceof StoryError) throw error
      throw new StoryError('delegation-failed', `子代理调用失败：${error?.message ?? error}`)
    } finally {
      clearTimeout(timer)
    }
    if (result?.stopReason !== 'completed') {
      throw new StoryError('delegation-failed',
        `子代理未正常完成（${String(result?.stopReason ?? 'unknown')}）${result?.diagnostic === undefined ? '' : `：${result.diagnostic}`}`)
    }

    if (role === 'writer') {
      const { title, body } = bodyOf(result, { requireTitle: true })
      const { warnings } = await checkDraft(root, { work, chapter, body })
      const range = checkWordRange({ role: 'writer', body, chapter, wordRange: loaded.manifest.wordRange })
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
        words: written.words,
        ...(warnings.length + range.warnings.length === 0 ? {} : { warnings: receiptWarnings([...warnings, ...range.warnings]) }),
      })
    }

    if (role === 'reviewer') {
      const problems = reviewItems(result)
      if (problems.length === 0) {
        throw new StoryError('empty-review', '问题清单为空：审稿至少要给出一条问题')
      }
      assertActive(signal)
      const written = writeReview(root, {
        work, chapter,
        problems: problems.map(item => ({
          location: item.location,
          problem: item.problem,
          suggestion: item.suggestion,
        })),
      })
      return fitReceipt({
        ok: true,
        workId: work,
        chapter,
        role,
        stage: landedStage(root, work, chapter),
        reviewRound: written.round,
        problems: { total: written.problems.length, open: written.problems.length },
      })
    }

    const { body } = bodyOf(result, { requireTitle: false })
    const { warnings } = await checkDraft(root, { work, chapter, body })
    const range = checkWordRange({ role: 'reviser', mode, body, chapter, wordRange: loaded.manifest.wordRange })
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
      words: revised.words,
      resolved: revised.resolved,
      ...(warnings.length + range.warnings.length === 0 ? {} : { warnings: receiptWarnings([...warnings, ...range.warnings]) }),
    })
  } finally {
    clearTimeout(timer)
    if (activation !== undefined) {
      try {
        await activation.dispose()
      } catch (error) {
        console.warn(`[storycraft] 子代理清理失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

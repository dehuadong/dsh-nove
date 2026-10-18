/**
 * Story actions for the long-form preset.
 *
 * The preset mounts this module, so `ctx.tools.register` files every action in
 * that preset's scope: only sessions composed from this mode see `story_*`.
 * Each action turns model input into artifacts under `<workspace>/works/<work>/`
 * and returns the artifact paths with their revisions; a failure never leaves a
 * partial chapter behind (see `storage.js`).
 *
 * Schemas are written in the tool registry's supported JSON Schema subset
 * (type / oneOf / properties / required / additionalProperties / items / enum /
 * const plus annotations): `required` is an array here, never a per-property
 * flag, because the registry asserts the output schema and rejects the whole
 * plugin row when it is wrong.
 */

import {
  StoryError, deleteWork, foldState, initWork, latestReview, listWorks, nextStep as nextStepFor, parseReview,
  readChapter, readManifest, reopenChapter as reopenChapterFor, renameWork, restoreWork, reviseChapter,
  status as readStatus, updateSettings, writeChapter, writeOutline as writeOutlineFor, writePlan, writeReview,
} from './storage.js'
import {
  assembleBrief as assembleBriefFor, importBible as importFromDesign, readBible as readBibleEntries,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from './bible.js'
import { readVolumes, writeVolume } from './volumes.js'
import { critique } from './critique.js'
import { getCurrent, resolveWork, setCurrent } from './current.js'
import { createProposal, markProposalUsed, readProposal } from './proposals.js'

/**
 * The session that owns one tool call.
 *
 * The tool runtime exposes the calling agent, whose `id` is the session id; the
 * positional `sessionId` is kept as a fallback for tests and older callers.
 * @param {object} exec - tool run context.
 * @returns {string|undefined} session identity.
 */
function sessionOf(exec) {
  const id = exec?.agent?.id ?? exec?.sessionId
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** Requires the tool registry; without it this row stays inert. */
export const inject = ['tools']

/** Plugin context of the mounted preset, used by tools that need host services. */
let pluginContext

/**
 * Pull a findings list out of a child agent's answer.
 *
 * The child is asked for JSON, but models wrap it in prose or fences; the parser
 * accepts both shapes and returns undefined when nothing usable is found.
 * @param {string} text - child output.
 * @returns {Array<{problem: string, where?: string}>|undefined} findings.
 */
export function parseFindings(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw)
  const candidate = fenced === null ? raw : fenced[1]
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  const arrayStart = candidate.indexOf('[')
  const arrayEnd = candidate.lastIndexOf(']')
  const slice = start !== -1 && end > start && (arrayStart === -1 || start < arrayStart)
    ? candidate.slice(start, end + 1)
    : arrayStart !== -1 && arrayEnd > arrayStart ? candidate.slice(arrayStart, arrayEnd + 1) : candidate
  let parsed
  try {
    parsed = JSON.parse(slice)
  } catch {
    return undefined
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.items ?? parsed?.problems
  if (!Array.isArray(list)) return undefined
  const findings = list
    .map(item => {
      const problem = typeof item === 'string' ? item : item?.problem
      if (typeof problem !== 'string' || problem.trim() === '') return undefined
      return {
        problem: problem.trim().slice(0, 300),
        ...(typeof item?.where === 'string' && item.where.trim() !== '' ? { where: item.where.trim().slice(0, 120) } : {}),
      }
    })
    .filter(item => item !== undefined)
  return findings.length === 0 ? undefined : findings
}

/**
 * Pull the chapter body out of a writer child's answer.
 *
 * The child wraps its prose in `<<<CHAPTER` / `CHAPTER>>>`; a missing marker means
 * the answer was truncated or off-contract, which the parent must not persist.
 * @param {string} text - child output.
 * @returns {string|undefined} the body, or undefined when the contract failed.
 */
export function parseChapterBody(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('<<<CHAPTER')
  const end = raw.lastIndexOf('CHAPTER>>>')
  if (start === -1 || end === -1 || end <= start) return undefined
  const body = raw.slice(start + '<<<CHAPTER'.length, end).trim()
  if (body.length < 200) return undefined
  return `${body}\n`
}

/** Provider label used in diagnostics. */
export const name = 'storycraft-tools'

/** Workspace directory for one call. */
function workspaceOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new StoryError('no-workspace', '这个会话没有工作区目录，无法定位作品根')
  }
  return cwd
}

/** Turn a thrown value into the structured failure every action returns. */
function failureOf(error) {
  if (error instanceof StoryError) {
    const missing = error.code === 'bible-missing'
      ? error.message.replace(/^.*?：/u, '').split('（')[0].split('、').map(name => name.trim()).filter(Boolean)
      : undefined
    return {
      ok: false,
      ...(missing === undefined ? {} : { missing }),
      error: { code: error.code, message: error.message },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

/** Output properties shared by every action. */
const OUTPUT_PROPERTIES = {
  ok: { type: 'boolean', description: 'Whether the action completed.' },
  workId: { type: 'string', description: 'Work identity.' },
  artifact: {
    type: 'object',
    additionalProperties: false,
    description: 'The file this action wrote, relative to the workspace root.',
    properties: {
      path: { type: 'string' },
      revision: { type: 'integer' },
    },
    required: ['path'],
  },
  words: { type: 'integer', description: 'Character count of the returned text (body or summary).' },
  problems: {
    type: 'array',
    description: 'Persisted review items.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        location: { type: 'string' },
        problem: { type: 'string' },
        suggestion: { type: 'string' },
        done: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  counts: {
    type: 'object',
    additionalProperties: false,
    description: 'How many state facts were folded.',
    properties: {
      entities: { type: 'integer' },
      opened: { type: 'integer' },
      used: { type: 'integer' },
      resolved: { type: 'integer' },
      open: { type: 'integer' },
    },
  },
  resolved: { type: 'array', description: 'Review item ids marked as addressed.', items: { type: 'string' } },
  files: {
    type: 'array',
    description: 'Truth files with their content version.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        path: { type: 'string' },
        version: { type: 'string' },
        content: { type: 'string' },
        draft: { type: 'boolean' },
      },
      required: ['name', 'path', 'version'],
    },
  },
  version: { type: 'string' },
  sections: {
    type: 'array',
    description: 'Assembled brief sections, highest priority first.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        title: { type: 'string' },
        source: { type: 'string' },
        content: { type: 'string' },
        bytes: { type: 'integer' },
        absent: { type: 'boolean' },
        draft: { type: 'boolean' },
        note: { type: 'string' },
      },
      required: ['name', 'title', 'bytes'],
    },
  },
  budget: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer' },
      used: { type: 'integer' },
      overBudget: { type: 'boolean' },
    },
    required: ['limit', 'used'],
  },
  missing: { type: 'array', description: 'Inputs that were absent.', items: { type: 'string' } },
  dropped: {
    type: 'array',
    description: 'Sections removed to fit the budget.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        bytes: { type: 'integer' },
        reason: { type: 'string' },
      },
      required: ['name'],
    },
  },
  imported: {
    type: 'array',
    description: 'Files copied by the import.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['from', 'to'],
    },
  },
  pending: { type: 'array', description: 'Truth still to be filled in.', items: { type: 'string' } },
  skipped: { type: 'array', description: 'Files the import left untouched because they already hold content.', items: { type: 'string' } },
  names: { type: 'array', description: 'Character names found in the old cast file.', items: { type: 'string' } },
  truncated: { type: 'boolean' },
  cleaned: { type: 'integer', description: 'Stale staging directories removed by this action.' },
  form: {
    type: 'string',
    enum: ['longform', 'short', 'script'],
    description: '作品的形态。',
  },
  proposal: {
    type: 'string',
    description: '提案 id（story_propose 的返回值）。',
  },
  title: {
    type: 'string',
    description: '作品或提案的标题。',
  },
  provider: {
    type: 'string',
    description: '子代理后端名（spawn / fork）。',
  },
  items: {
    type: 'integer',
    description: '子代理产出的审稿条目数。',
  },
  readOnly: {
    type: 'boolean',
    description: '子代理是否跑在只读预设里（false 表示退回了继承预设，需要人工确认它没有写文件）。',
  },
  childId: {
    type: 'string',
    description: '子代理的会话 id。',
  },
  output: {
    type: 'string',
    description: '子代理的最终文本输出（截断到 2000 字）。',
  },
  outline: {
    type: 'object',
    description: '全书计划状态：writtenAt 写过、approvedAt 作者已确认。',
    additionalProperties: false,
    properties: {
      writtenAt: { type: 'string' },
      approvedAt: { type: 'string' },
    },
  },
  unit: {
    type: 'string',
    description: '该形态的章节单位：章 / 篇 / 集。',
  },
  current: {
    oneOf: [{ type: 'string' }, { type: 'null' }],
    description: '本会话当前作品的 id；还没有时是 null。',
  },
  wordRange: {
    type: 'object',
    additionalProperties: false,
    properties: { min: { type: 'integer' }, max: { type: 'integer' } },
    required: ['min', 'max'],
  },
  metrics: {
    type: 'object',
    additionalProperties: false,
    properties: {
      words: { type: 'integer' },
      sentences: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          averageLength: { type: 'number' },
          longest: { type: 'integer' },
        },
        required: ['count', 'averageLength', 'longest'],
      },
      repeated: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' }, count: { type: 'integer' } },
          required: ['text', 'count'],
        },
      },
      aiPhrases: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          hits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { phrase: { type: 'string' }, count: { type: 'integer' } },
              required: ['phrase', 'count'],
            },
          },
        },
        required: ['count', 'hits'],
      },
      dialogueRatio: { type: 'number' },
      wordRange: {
        type: 'object',
        additionalProperties: false,
        properties: { min: { type: 'integer' }, max: { type: 'integer' } },
        required: ['min', 'max'],
      },
      withinRange: { type: 'boolean' },
      shortBy: { type: 'integer' },
      longBy: { type: 'integer' },
    },
    required: ['words', 'sentences', 'repeated', 'aiPhrases', 'dialogueRatio'],
  },
  volumes: {
    type: 'array',
    description: 'Volumes of this work, ascending by their first chapter.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        from: { type: 'integer' },
        to: { type: 'integer' },
        summary: { type: 'string' },
      },
      required: ['id', 'title', 'from', 'to'],
    },
  },
  volume: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      from: { type: 'integer' },
      to: { type: 'integer' },
      summary: { type: 'string' },
    },
    required: ['id', 'title', 'from', 'to'],
  },
  action: { type: 'string', description: 'Action to run next, e.g. story_write.' },
  chapter: { type: 'integer', description: 'Chapter number the next step applies to.' },
  reason: { type: 'string', description: 'Why that action is next.' },
  stage: { type: 'string', description: 'Current stage of the chapter being worked on.' },
  status: {
    type: 'object',
    additionalProperties: false,
    description: 'Progress summary of one work.',
    properties: {
      workId: { type: 'string' },
      title: { type: 'string' },
      form: { type: 'string' },
      writtenChapters: { type: 'integer' },
      latestChapter: { type: 'integer' },
      openProblems: { type: 'integer' },
      entities: { type: 'integer' },
      hooks: {
        type: 'object',
        additionalProperties: false,
        properties: {
          opened: { type: 'integer' },
          used: { type: 'integer' },
          resolved: { type: 'integer' },
        },
      },
      wordRange: {
        type: 'object',
        additionalProperties: false,
        properties: { min: { type: 'integer' }, max: { type: 'integer' } },
        required: ['min', 'max'],
      },
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            number: { type: 'integer' },
            status: { type: 'string' },
            stage: { type: 'string', description: 'Pipeline stage; later stages require the earlier ones.' },
            revision: { type: 'integer' },
            words: { type: 'integer' },
          },
        },
      },
    },
  },
  error: {
    type: 'object',
    additionalProperties: false,
    description: 'Structured failure.',
    properties: {
      code: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['code', 'message'],
  },
}

/** Output declaration shared by every action. */
const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: OUTPUT_PROPERTIES,
    required: ['ok'],
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

/**
 * One action definition.
 * @param {object} spec - name, description, parameters, execute.
 * @returns {object} a registry-ready ToolDefinition.
 */
function action(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: OUTPUT,
    async execute(args, exec) {
      try {
        return await spec.execute(args ?? {}, exec)
      } catch (error) {
        return failureOf(error)
      }
    },
  }
}

/** The long-form action set. */
function rawDefinitions() {
  return [
    action({
      name: 'story_init',
      description: '建立一部作品的骨架：作品目录、进度清单、章纲/正文/审稿/状态四个子目录。'
        + ' 用户要求开始写一部新作品时先调用它。作品 id 由标题生成；同 id 已存在时拒绝，不覆盖已有作品，'
        + ' 需要另起一部时换标题或显式给 workId。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: '作品标题。' },
          proposal: {
            type: 'string',
            description: '已获作者同意的提案 id（story_propose 返回）。立项必须带它。',
          },
          wordRange: {
            type: 'object',
            additionalProperties: false,
            properties: { min: { type: 'integer' }, max: { type: 'integer' } },
            required: ['min', 'max'],
            description: '单章字数范围，建档时与作者商定；省略表示不设限。',
          },
          workId: { type: 'string', description: '可选：显式指定作品 id（字母、数字、连字符）。' },
          tags: { type: 'array', description: '可选标签。', items: { type: 'string' } },
        },
        required: ['title', 'proposal'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        if (typeof args.proposal !== 'string' || args.proposal.trim() === '') {
          throw new StoryError('proposal-required',
            '立项前先和作者讨论，用 story_propose 落一份方案，并在作者明确同意后带 proposal 立项')
        }
        const proposal = await readProposal(root, args.proposal.trim())
        if (proposal.title !== String(args.title).trim()) {
          throw new StoryError('proposal-mismatch',
            `提案《${proposal.title}》与要建的作品《${args.title}》不一致：改标题或重新提案`)
        }
        if (args.form !== undefined && proposal.form !== args.form) {
          throw new StoryError('proposal-mismatch',
            `提案形态是 ${proposal.form}，与传入的 ${args.form} 不一致`)
        }
        const created = await initWork(root, {
          title: args.title,
          form: proposal.form,
          ...(typeof args.workId === 'string' ? { workId: args.workId } : {}),
          ...(typeof args.form === 'string' ? { form: args.form } : {}),
          ...(Array.isArray(args.tags) ? { tags: args.tags } : {}),
          ...(args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
        })
        await markProposalUsed(root, proposal.id, created.workId).catch(() => {})
        return { ok: true, workId: created.workId, artifact: { path: created.path } }
      },
    }),

    action({
      name: 'story_propose',
      description: '把与作者谈成的方案落成提案（标题、形态、一句话前提、主要人物与冲突）。'
        + ' 提案不是作品：不建目录、不写章节。方向成熟后写提案给作者看，作者明确同意后再 story_init。'
        + ' 讨论阶段不要调用它，也不要写任何文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: '作品标题。' },
          form: { type: 'string', enum: ['longform', 'short', 'script'], description: '形态，缺省长篇。' },
          premise: { type: 'string', description: '一句话前提或核心冲突。' },
          characters: { type: 'string', description: '主要人物与他们的目标（可选）。' },
          conflict: { type: 'string', description: '主要冲突或阻力（可选）。' },
          notes: { type: 'string', description: '其他约定，如字数范围、叙事视角（可选）。' },
        },
        required: ['title', 'premise'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const proposal = await createProposal(root, {
          title: args.title,
          form: args.form,
          premise: args.premise,
          ...(typeof args.characters === 'string' ? { characters: args.characters } : {}),
          ...(typeof args.conflict === 'string' ? { conflict: args.conflict } : {}),
          ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
        })
        return { ok: true, proposal: proposal.id, title: proposal.title, form: proposal.form }
      },
    }),

    action({
      name: 'story_agent_probe',
      description: '探针：从本插件派生一个只读子代理，让它回答一句话，用来确认子代理通道可用。'
        + ' 不改任何文件；通道不可用时返回可行动的说明。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', description: '交给子代理的一句话任务；省略则让它汇报自己的身份与可用动作。' },
        },
      },
      async execute(args, exec) {
        const subagents = pluginContext?.get?.('subagents')
        if (subagents === undefined || typeof subagents.startActivation !== 'function') {
          throw new StoryError('subagent-unavailable', '当前平台没有 subagents 服务：子代理通道不可用，单代理路径照常')
        }
        const provider = ['spawn', 'fork'].find(name => subagents.getProvider?.(name) !== undefined)
        if (provider === undefined) {
          throw new StoryError('subagent-unavailable',
            '没有已挂载的子代理后端（spawn / fork）：在 profile 里启用一个 subagent provider 后再试')
        }
        if (exec?.agent === undefined) {
          throw new StoryError('subagent-unavailable', '这次调用没有父代理身份，无法派生子代理')
        }
        const text = typeof args.task === 'string' && args.task.trim() !== ''
          ? args.task.trim()
          : '用一句话说明：你是谁、你能看到哪些动作、你被谁派生。不要读写任何文件。'
        const started = await subagents.startActivation({
          provider,
          label: 'storycraft-probe',
          request: { prompt: [{ type: 'text', text }], parent: exec.agent },
          signal: exec.signal,
          delivery: 'caller',
        })
        const result = await started.result
        const output = (result?.output ?? [])
          .filter(block => block?.type === 'text')
          .map(block => block.text)
          .join('\n')
        return { ok: true, provider, childId: String(started.childId), output: output.slice(0, 2000) }
      },
    }),

    action({
      name: 'story_review_agent',
      description: '审稿子代理：派生一个只读子代理读本章正文并给出问题清单，父代理把清单落盘（story_review）。'
        + ' 子代理不写文件；通道不可用时退回单代理审稿。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const subagents = pluginContext?.get?.('subagents')
        const provider = subagents === undefined ? undefined : ['spawn', 'fork'].find(name => subagents.getProvider?.(name) !== undefined)
        if (provider === undefined || exec?.agent === undefined) {
          throw new StoryError('subagent-unavailable', '子代理通道不可用：先用单代理 story_review')
        }
        const body = await readChapter(root, { work: args.work, chapter: args.chapter })
        const task = [
          '你是一个只读审稿人。不要修改、创建或删除任何文件；不要调用任何写文件的工具。按「审稿」技能执行。',
          `下面是第 ${args.chapter} 章的正文。每条问题给出：问题、位置、读者影响、严重度、修复方向与建议模式。`,
          '输出严格 JSON：{"items":[{"problem":"一句问题","where":"具体位置","impact":"读者影响","severity":"blocker / major / minor","fix":"修复方向","mode":"patch / polish / rewrite / deslop"}]}，最多 8 条，按严重度降序，不要输出其它文字。',
          '---正文开始---',
          body.content,
          '---正文结束---',
        ].join('\n')
        const canPreset = subagents.getProvider?.(provider)?.capabilities?.agentPreset === true
        const start = presetId => subagents.startActivation({
          provider,
          label: `storycraft-review-${args.chapter}`,
          request: {
            prompt: [{ type: 'text', text: task }],
            parent: exec.agent,
            ...(presetId === undefined ? {} : { agentPreset: presetId }),
          },
          signal: exec.signal,
          delivery: 'caller',
        })
        // The reviewer preset has no write tools and no actions; without it the
        // child would inherit the studio preset and could write by itself.
        let readOnly = canPreset
        let started
        try {
          started = await start(canPreset ? 'storycraft-reviewer' : undefined)
        } catch (error) {
          if (!canPreset) throw error
          readOnly = false
          started = await start(undefined)
        }
        const result = await started.result
        const output = (result?.output ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
        const findings = parseFindings(output)
        if (findings === undefined) {
          throw new StoryError('agent-output-invalid',
            `子代理没有给出可用清单：把它的输出交给 story_review 落盘，或改用单代理审稿。原文：${output.slice(0, 500)}`)
        }
        const review = await writeReview(root, { work: args.work, chapter: args.chapter, problems: findings })
        return {
          ok: true, provider, childId: String(started.childId), readOnly,
          items: findings.length,
          artifact: review.artifact,
        }
      },
    }),

    action({
      name: 'story_write_agent',
      description: '写手子代理：把本章 brief 与章纲交给只读写手，取回整章正文，校验后由主编落盘（story_write）。'
        + ' 子代理不写文件；通道不可用时请直接用 story_write。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id（可省略，用会话当前作品）。' },
          chapter: { type: 'integer', description: '章号。' },
          instruction: { type: 'string', description: '可选：本章的额外要求（语气、重点、禁忌）。' },
        },
        required: ['chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const subagents = pluginContext?.get?.('subagents')
        const provider = subagents === undefined ? undefined : ['spawn', 'fork'].find(name => subagents.getProvider?.(name) !== undefined)
        if (provider === undefined || exec?.agent === undefined) {
          throw new StoryError('subagent-unavailable', '子代理通道不可用：直接用 story_write 写正文')
        }
        const brief = await assembleBriefFor(root, args.work, args.chapter)
        const context = brief.sections
          .filter(section => section.absent !== true && typeof section.content === 'string' && section.content.trim() !== '')
          .map(section => `## ${section.title}\n${section.content}`)
          .join('\n\n')
        const task = [
          '你是写手：按下面的上下文写这一章正文，不要写文件、不要调用任何动作。',
          typeof args.instruction === 'string' && args.instruction.trim() !== ''
            ? `作者要求：${args.instruction.trim()}`
            : '',
          `作品形态：${brief.form ?? 'longform'}；本章是第 ${args.chapter} 章。`,
          '输出整章正文，用 <<<CHAPTER 与 CHAPTER>>> 包住，前后不要解释。',
          '---上下文开始---',
          context,
          '---上下文结束---',
        ].filter(line => line !== '').join('\n')
        const canPreset = subagents.getProvider?.(provider)?.capabilities?.agentPreset === true
        const start = presetId => subagents.startActivation({
          provider,
          label: `storycraft-write-${args.chapter}`,
          request: {
            prompt: [{ type: 'text', text: task }],
            parent: exec.agent,
            ...(presetId === undefined ? {} : { agentPreset: presetId }),
          },
          signal: exec.signal,
          delivery: 'caller',
        })
        let readOnly = canPreset
        let started
        try {
          started = await start(canPreset ? 'storycraft-writer' : undefined)
        } catch (error) {
          if (!canPreset) throw error
          readOnly = false
          started = await start(undefined)
        }
        const result = await started.result
        const output = (result?.output ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
        const body = parseChapterBody(output)
        if (body === undefined) {
          throw new StoryError('agent-output-invalid',
            `写手没有按契约返回整章正文（缺失 <<<CHAPTER / CHAPTER>>> 或过短）：把它的输出交给你自己改写后用 story_write 落盘。原文：${output.slice(0, 500)}`)
        }
        const written = await writeChapter(root, { work: args.work, chapter: args.chapter, body })
        return {
          ok: true, provider, childId: String(started.childId), readOnly,
          words: written.words, artifact: written.artifact,
        }
      },
    }),

    action({
      name: 'story_revise_agent',
      description: '修订子代理：把清单条目与模式交给只读修订者，取回完整新版本，校验后由主编落盘（story_revise）。'
        + ' 子代理不写文件；通道不可用时直接用 story_revise。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id（可省略，用会话当前作品）。' },
          chapter: { type: 'integer', description: '章号。' },
          mode: { type: 'string', enum: ['patch', 'polish', 'rewrite', 'deslop'], description: '修订模式，缺省 patch。' },
          problemIds: {
            type: 'array',
            description: '要处理的条目 id；缺省用最新清单里未处理的条目。',
            items: { type: 'string' },
          },
        },
        required: ['chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const subagents = pluginContext?.get?.('subagents')
        const provider = subagents === undefined ? undefined : ['spawn', 'fork'].find(name => subagents.getProvider?.(name) !== undefined)
        if (provider === undefined || exec?.agent === undefined) {
          throw new StoryError('subagent-unavailable', '子代理通道不可用：直接用 story_revise')
        }
        const mode = ['patch', 'polish', 'rewrite', 'deslop'].includes(args.mode) ? args.mode : 'patch'
        const manifest = await readManifest(root, args.work)
        const entry = manifest.chapters.find(chapter => chapter.number === args.chapter)
        if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${args.chapter} 章`)
        const latest = await latestReview(root, manifest, entry)
        if (latest === undefined) throw new StoryError('review-required', `第 ${args.chapter} 章还没有审稿清单：先审稿`)
        const items = parseReview(latest.text)
        const open = items.filter(item => !item.done)
        const ids = Array.isArray(args.problemIds) && args.problemIds.length > 0
          ? args.problemIds.map(String)
          : open.map(item => item.id)
        if (ids.length === 0 && mode === 'patch') {
          throw new StoryError('missing-problems', '清单里没有未处理条目：换模式（润色/重写/去 AI 味）或先审稿')
        }
        const current = await readChapter(root, { work: args.work, chapter: args.chapter })
        const selected = items.filter(item => ids.includes(item.id))
        const task = [
          '你是修订者：按下面的条目与模式改这一章，只返回完整新版本，不要写文件、不要调用动作。',
          `模式：${mode}。`,
          mode === 'patch' ? '只改条目点名的位置，其它段落逐字保留。' : '',
          mode === 'polish' ? '只顺语气与节奏，事实与走向不动。' : '',
          mode === 'rewrite' ? '整章重写，但事实、视角与章节走向不变。' : '',
          mode === 'deslop' ? '按语义去腔调，不按词表删词，事实与人物声音不变。' : '',
          selected.length === 0 ? '本次按模式整体处理，不针对具体条目。' : '要处理的条目：',
          ...selected.map(item => `- ${item.id}：${item.problem ?? item.text ?? ''}`),
          '输出完整新版本，用 <<<CHAPTER 与 CHAPTER>>> 包住，前后不要解释。',
          '---当前正文开始---',
          current.content,
          '---当前正文结束---',
        ].filter(line => line !== '').join('\n')
        const canPreset = subagents.getProvider?.(provider)?.capabilities?.agentPreset === true
        const start = presetId => subagents.startActivation({
          provider,
          label: `storycraft-revise-${args.chapter}`,
          request: {
            prompt: [{ type: 'text', text: task }],
            parent: exec.agent,
            ...(presetId === undefined ? {} : { agentPreset: presetId }),
          },
          signal: exec.signal,
          delivery: 'caller',
        })
        let readOnly = canPreset
        let started
        try {
          started = await start(canPreset ? 'storycraft-reviser' : undefined)
        } catch (error) {
          if (!canPreset) throw error
          readOnly = false
          started = await start(undefined)
        }
        const result = await started.result
        const output = (result?.output ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
        const body = parseChapterBody(output)
        if (body === undefined) {
          throw new StoryError('agent-output-invalid',
            `修订者没有按契约返回完整正文（缺失标记或过短）：用 story_revise 自己改并落盘。原文：${output.slice(0, 500)}`)
        }
        const revised = await reviseChapter(root, {
          work: args.work, chapter: args.chapter, body, problemIds: ids, mode,
        })
        return {
          ok: true, provider, childId: String(started.childId), readOnly, mode,
          revision: revised.artifact.revision, resolved: revised.resolved,
        }
      },
    }),

    action({
      name: 'story_outline',
      description: '全书计划：写主线、卷划分、结局方向到 bible/plan.md；作者同意后用 approve: true 记录下来。'
        + ' 立项后先做这一步，未确认前不能写第 1 章章纲。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          mainline: { type: 'string', description: '主线：主角要什么、被什么阻挡、大致怎么走。' },
          volumes: { type: 'string', description: '可选：卷划分的文字摘要。' },
          ending: { type: 'string', description: '可选：结局方向。' },
          approve: { type: 'boolean', description: '作者明确同意这份计划时传 true；只记录确认，不改内容。' },
        },
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await writeOutlineFor(root, {
          work: args.work,
          ...(args.approve === true ? { approve: true } : {}),
          ...(typeof args.mainline === 'string' ? { mainline: args.mainline } : {}),
          ...(typeof args.volumes === 'string' ? { volumes: args.volumes } : {}),
          ...(typeof args.ending === 'string' ? { ending: args.ending } : {}),
        })
        return { ok: true, workId: result.workId, outline: result.outline }
      },
    }),

    action({
      name: 'story_plan',
      description: '写一章的章纲并落盘。五项必须齐全：视角、目标、阻力、代价、结尾变化；缺项会被拒绝。'
        + ' 动笔前先出章纲，改章纲也用这个动作覆盖同一章的章纲文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id（story_init 返回）。' },
          chapter: { type: 'integer', description: '章号，从 1 开始。' },
          perspective: { type: 'string', description: '视角人物。' },
          goal: { type: 'string', description: '本章目标。' },
          obstacle: { type: 'string', description: '阻力。' },
          cost: { type: 'string', description: '代价。' },
          turn: { type: 'string', description: '结尾变化。' },
        },
        required: ['work', 'chapter', 'perspective', 'goal', 'obstacle', 'cost', 'turn'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        if (manifest.chapters.length === 0 && manifest.outline?.approvedAt === undefined) {
          throw new StoryError('outline-required',
            '全书计划还没确认：先 story_outline 写主线/卷划分/结局方向，等作者同意后 approve，再写章纲')
        }
        const result = await writePlan(root, args)
        return { ok: true, workId: args.work, artifact: result.artifact }
      },
    }),

    action({
      name: 'story_write',
      description: '把一章正文落盘并更新进度清单。已存在正文时默认拒绝；要改稿传 rewrite: true，会生成新版本而不覆盖旧版。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          title: { type: 'string', description: '章标题，可覆盖上一次的值。' },
          body: { type: 'string', description: '完整正文 Markdown。' },
          rewrite: { type: 'boolean', description: '已有正文时是否另存为新版本。' },
          reopen: { type: 'boolean', description: '已定稿章要改正文时传 true：回退到已写，旧定稿作废。' },
        },
        required: ['work', 'chapter', 'body'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await writeChapter(root, args)
        return {
          ok: true, workId: args.work, artifact: result.artifact, words: result.words,
          ...(result.cleaned > 0 ? { cleaned: result.cleaned } : {}),
        }
      },
    }),

    action({
      name: 'story_review',
      description: '把审稿发现落盘成问题清单。只写清单，绝不修改正文；每条含位置、问题、建议。'
        + ' 正文不存在时会被拒绝。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          problems: {
            type: 'array',
            description: '审稿发现，至少一条。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                location: { type: 'string', description: '位置：段落、场景或引用原文。' },
                problem: { type: 'string', description: '问题是什么。' },
                suggestion: { type: 'string', description: '建议怎么改。' },
              },
              required: ['location', 'problem'],
            },
          },
        },
        required: ['work', 'chapter', 'problems'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await writeReview(root, args)
        return { ok: true, workId: args.work, artifact: result.artifact, problems: result.problems }
      },
    }),

    action({
      name: 'story_revise',
      description: '按审稿清单改一章：生成新版本正文、把指定的问题条目标为已处理，旧版本保留。'
        + ' 必须先有审稿清单，且要指明处理哪些条目；条目不存在、正文与当前版本相同都会被拒绝。'
        + ' 只是重写而不针对清单条目时，用 story_write 的 rewrite。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          body: { type: 'string', description: '修订后的完整正文。' },
          problemIds: {
            type: 'array',
            description: '本次处理的问题条目 id（如 Q1、Q2）。patch 模式必填；polish/rewrite/deslop 可省略。',
            items: { type: 'string' },
          },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '修订模式：patch 只改点到的地方（字数变化 ≤20%）、polish 润色（≤40%）、rewrite 重写、deslop 去 AI 腔（必须减少命中）。省略为 patch。',
          },
        },
        required: ['work', 'chapter', 'body'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await reviseChapter(root, args)
        return { ok: true, workId: args.work, artifact: result.artifact, resolved: result.resolved }
      },
    }),

    action({
      name: 'story_state',
      description: '把本章产生的人物事实与伏笔变化定稿进作品状态，并刷新伏笔视图。'
        + ' 只写变化，不重抄全部设定；「已用」必须指向一条未解伏笔。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          entities: {
            type: 'array',
            description: '人物/关系/时间线的新事实。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                facts: { type: 'array', items: { type: 'string' }, description: '一条或几条事实；单个字符串也接受。' },
              },
              required: ['name', 'facts'],
            },
          },
          hooks: {
            type: 'array',
            description: '伏笔变化。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string' },
                state: { type: 'string', enum: ['opened', 'used', 'resolved'] },
              },
              required: ['text', 'state'],
            },
          },
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await foldState(root, args)
        return { ok: true, workId: args.work, counts: result.counts, artifact: result.artifact }
      },
    }),

    action({
      name: 'story_bible',
      description: '读取作品真值（世界观、人物档案、文风、写作计划、作者意图）。'
        + ' 动笔前需要确认设定、或要查某个人物的口吻与底线时先读它；文件缺失会指出缺哪几份。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          file: { type: 'string', enum: ['world', 'characters', 'style', 'plan', 'intent'], description: '可选：只读这一份。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await readBibleEntries(root, args.work, typeof args.file === 'string' ? args.file : undefined)
        return { ok: true, workId: args.work, files: result.files, ...(result.missing.length > 0 ? { missing: result.missing } : {}) }
      },
    }),

    action({
      name: 'story_bible_write',
      description: '写一份真值文件并返回内容版本。人物档案必须是六字段齐全的 JSON 数组；'
        + ' 结构不合法会被拒绝且文件不变。作者确认设定或补齐人物后再调用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          file: { type: 'string', enum: ['world', 'characters', 'style', 'plan', 'intent'], description: '写哪一份。' },
          content: { type: 'string', description: '完整内容（Markdown 或人物档案 JSON）。' },
        },
        required: ['work', 'file', 'content'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const written = await writeBibleEntry(root, args.work, args.file, args.content)
        return { ok: true, workId: args.work, artifact: { path: written.path }, version: written.version }
      },
    }),

    action({
      name: 'story_bible_import',
      description: '把旧作品 design/ 下的世界观与大纲收编进真值目录，并列出仍需作者补的项。'
        + ' 只收编结构已知的内容，不替作者编人物档案。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const report = await importFromDesign(root, args.work)
        return {
          ok: true, workId: args.work, imported: report.imported, pending: report.pending,
          names: report.names, skipped: report.skipped,
        }
      },
    }),

    action({
      name: 'story_brief',
      description: '装配写这一章前的上下文：作者意图、本章章纲、涉及人物、未解伏笔、上一章结尾、文风、字数口径。'
        + ' 动笔前先读它，而不是通读前文；超预算会说明裁掉了哪几段。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '要写的章号。' },
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const brief = await assembleBriefFor(root, args.work, args.chapter)
        return { ok: true, workId: args.work, sections: brief.sections, budget: brief.budget, missing: brief.missing, dropped: brief.dropped }
      },
    }),

    action({
      name: 'story_summarize',
      description: '把一章概括成摘要落盘（上限 400 字），供下一章的写前上下文使用。'
        + ' 写完整章并定稿后调用；摘要只写本章发生的事实与状态变化。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          summary: { type: 'string', description: '摘要正文。' },
        },
        required: ['work', 'chapter', 'summary'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const receipt = await writeSummaryEntry(root, args.work, args.chapter, args.summary)
        return { ok: true, workId: args.work, artifact: { path: receipt.path }, words: receipt.words, truncated: receipt.truncated }
      },
    }),

    action({
      name: 'story_reopen',
      description: '作废一章的定稿但不改正文：定稿后要补审稿或改稿时先用它。'
        + ' 只对已定稿章有效；作废后该章回到「已写」，再走审稿 → 修订 → 定稿。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await reopenChapterFor(root, { work: args.work, chapter: args.chapter })
        return { ok: true, workId: args.work, artifact: result.artifact, stage: 'written' }
      },
    }),

    action({
      name: 'story_rename',
      description: '改作品的标题或作品 id（目录会一起改）。id 必须是新的、不与他人冲突；'
        + ' 只改标题时目录不动。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '当前作品 id。' },
          title: { type: 'string', description: '新标题；省略则不改。' },
          workId: { type: 'string', description: '新作品 id；省略则不改。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await renameWork(root, {
          work: args.work,
          ...(typeof args.title === 'string' ? { title: args.title } : {}),
          ...(typeof args.workId === 'string' ? { workId: args.workId } : {}),
        })
        return { ok: true, workId: result.workId }
      },
    }),

    action({
      name: 'story_delete',
      description: '把作品移进回收站（works/.trash），不再出现在列表里；可用 story_restore 恢复。'
        + ' 不会真的删除文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await deleteWork(root, { work: args.work })
        return { ok: true, workId: result.workId, artifact: { path: result.path } }
      },
    }),

    action({
      name: 'story_restore',
      description: '把回收站里最近一次删除的同名作品恢复回 works/。目标名已被占用时拒绝。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: '删除前的作品 id。' },
        },
        required: ['name'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await restoreWork(root, { name: args.name })
        return { ok: true, workId: result.workId }
      },
    }),

    action({
      name: 'story_settings',
      description: '设定作品的写作参数：目前是单章字数范围（建档时与作者商定，之后也可改）。'
        + ' 传 null 表示清空、不按字数判定。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          wordRange: {
            type: 'object',
            additionalProperties: false,
            properties: { min: { type: 'integer' }, max: { type: 'integer' } },
            required: ['min', 'max'],
            description: '单章字数范围；省略表示不改。',
          },
          clear: { type: 'boolean', description: '传 true 清空字数范围（不按字数判定）。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await updateSettings(root, {
          work: args.work,
          ...(args.clear === true ? { wordRange: null } : args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
        })
        return { ok: true, workId: result.workId, ...(result.wordRange === undefined ? {} : { wordRange: result.wordRange }) }
      },
    }),

    action({
      name: 'story_current',
      description: '只读：本会话当前在做的作品。作品由面板进入时选定，模型不能自己切换；'
        + ' 返回 null 时说明还没有进入任何作品，请作者在面板里进入一部。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async execute(args, exec) {
        const current = getCurrent(sessionOf(exec))
        if (current === undefined) return { ok: true, current: null }
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, current).catch(() => undefined)
        return { ok: true, workId: current, ...(manifest === undefined ? {} : { title: manifest.title }), current }
      },
    }),

    action({
      name: 'story_critique',
      description: '给一章做只读质检：字数是否在该作品范围内、句子长度、重复句、AI 腔词命中、对话占比。'
        + ' 只打分、不写文件、不阻断定稿；把发现交给 story_review 才会变成清单。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        const current = await readChapter(root, { work: args.work, chapter: args.chapter })
        return { ok: true, workId: args.work, metrics: critique(current.content, manifest.wordRange) }
      },
    }),

    action({
      name: 'story_volume',
      description: '分卷：新建或更新一卷（标题、起止章、可选摘要）。'
        + ' 卷数不固定、按故事线由作者确认；区间不得与其它卷重叠，章必须已存在。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          id: { type: 'string', description: '要更新的卷 id；省略则新建。' },
          title: { type: 'string', description: '卷标题。' },
          from: { type: 'integer', description: '起始章号（含）。' },
          to: { type: 'integer', description: '结束章号（含）。' },
          summary: { type: 'string', description: '可选：本卷的短摘要。' },
        },
        required: ['work', 'title', 'from', 'to'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await writeVolume(root, {
          work: args.work,
          ...(typeof args.id === 'string' ? { id: args.id } : {}),
          title: args.title,
          from: args.from,
          to: args.to,
          ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
        })
        return { ok: true, workId: args.work, volumes: result.volumes, volume: result.volume }
      },
    }),

    action({
      name: 'story_volumes',
      description: '只读：列出作品的卷与起止章。写新章前想知道自己在哪一卷、上一卷写到哪时用它。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        return { ok: true, workId: args.work, volumes: await readVolumes(root, args.work) }
      },
    }),

    action({
      name: 'story_next',
      description: '查询这部作品下一步该做什么：动作名、章号、原因、缺什么（章纲/审稿/条目 id）。'
        + ' 每写完一步先调它，不要凭记忆猜下一步；它只读，不改任何文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const next = await nextStepFor(root, args.work)
        return { ok: true, ...next }
      },
    }),

    action({
      name: 'story_status',
      description: '只读查看一部作品的进度：章数与状态、当前版本、未处理审稿问题、未解伏笔。'
        + ' 不知道下一步该写什么时先读它。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const summary = await readStatus(root, args.work)
        return { ok: true, workId: summary.workId, status: summary }
      },
    }),
  ]
}

/**
 * The registered action list: `work` is optional and resolved per session.
 * @returns {object[]} action definitions.
 */
function definitions() {
  return rawDefinitions().map(withCurrentWork)
}

/**
 * Make `work` optional on one action and resolve it from the session.
 *
 * An explicit `work` still wins, so callers that know the id are unaffected; the
 * schema stops requiring it so a session pointed at a work can omit it.
 * @param {object} definition - registered action definition.
 * @returns {object} the same definition with a wrapped execute.
 */
function withCurrentWork(definition) {
  // story_current reports the pointer itself; resolving it first would throw
  // exactly when the author still has no work.
  if (definition.name === 'story_current') return definition
  const parameters = definition.parameters
  const hasWork = parameters?.properties !== undefined && 'work' in parameters.properties
  if (!hasWork) return definition
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter(name => name !== 'work')
    : []
  const execute = definition.execute
  return {
    ...definition,
    parameters: { ...parameters, ...(required.length === 0 ? { required: [] } : { required }) },
    async execute(args, exec) {
      const session = sessionOf(exec)
      const current = getCurrent(session)
      const explicit = typeof args?.work === 'string' && args.work.trim() !== '' ? args.work.trim() : undefined
      // One session drives one work: a call that names a different work would
      // silently write into the wrong book, so it is refused and the author
      // switches in the panel instead.
      // Without an active work the session may not reach into the works tree at
      // all: discussion happens before any book is entered, and the panel is the
      // only way to point a session at one.
      if (explicit !== undefined && current === undefined) {
        throw new StoryError('work-not-selected',
          '本会话还没有进入任何作品：先在面板进入一个作品，再操作它；讨论阶段不读历史作品')
      }
      if (explicit !== undefined && current !== undefined && explicit !== current) {
        throw new StoryError('work-mismatch',
          `本会话当前作品是 ${current}，不能直接操作 ${explicit}：先在面板切换到那部作品`)
      }
      const work = resolveWork(session, explicit)
      if (work === undefined) {
        throw new StoryError('work-not-selected',
          '本会话还没有当前作品：先在面板进入一个作品，或在调用里带上 work')
      }
      return execute({ ...args, work }, exec)
    },
  }
}

/**
 * Register the studio actions in the calling (preset) scope.
 * @param {object} ctx - plugin context (services: tools).
 */
export function apply(ctx) {
  pluginContext = ctx
  const disposers = definitions().map(definition => ctx.tools.register(definition))
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}

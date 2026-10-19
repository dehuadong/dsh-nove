/**
 * Story actions for the storycraft work mode.
 *
 * The preset mounts this module, so `ctx.tools.register` files every action in
 * that preset's scope: only sessions composed from this mode see `story_*`.
 * The same scope owns the delegation guard: subagents spawned into this
 * composition may read, but their file writes and landing actions are refused.
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
  StoryError, deleteWork, foldState, initWork, latestReview, listWorks, nextStep as nextStepFor,
  parseReview, readChapter, readManifest, reopenChapter as reopenChapterFor, renameWork, restoreWork, reviseChapter,
  status as readStatus, updateSettings, writeChapter, writeOutline as writeOutlineFor, writePlan, writeReview,
} from './storage.js'
import {
  assembleBrief as assembleBriefFor, importBible as importFromDesign, readBible as readBibleEntries,
  readSummary,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from './bible.js'
import { readVolumes, writeVolume } from './volumes.js'
import { critique } from './critique.js'
import { assembleRoleContext } from './context.js'
import { checkConsistency } from './consistency.js'
import { deriveWhitelist, summariseWhitelist } from './facts.js'
import { getCurrent, resolveWork } from './current.js'
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

/**
 * Delegation depth of the calling agent.
 *
 * A spawned subagent's session header carries the depth fixed at delegation,
 * so a resumed child keeps it; the main session is 0.
 * @param {object} exec - tool run context.
 * @returns {number} positive delegation depth, or 0 for the main session.
 */
function delegationDepthOf(exec) {
  const depth = exec?.agent?.session?.header?.delegationDepth
  return typeof depth === 'number' && depth > 0 ? depth : 0
}

/**
 * Tools a delegated subagent may not call.
 *
 * Subagents return text; the delegating agent lands artifacts through the
 * `story_*` actions, so their file and shell access is refused at runtime
 * rather than hidden from the tool catalog.
 */
const DELEGATED_DENIED_TOOLS = new Set(['write', 'edit', 'pwsh', 'bash'])

/** Model-facing denial shared by the guard and the mutating actions. */
const DELEGATED_DENIAL = '你是被派发的子代理：只把结果返回给派发者，不写文件。落盘由派发者用故事工坊动作完成。'

/** Requires the tool registry; without it this row stays inert. */
export const inject = ['tools']

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
  warnings: { type: 'array', description: 'Consistency warnings that did not block the write.', items: { type: 'string' } },
  role: { type: 'string' },
  trace: {
    type: 'object',
    additionalProperties: false,
    description: 'Budget and trimming record for one dispatch.',
    properties: {
      budget: { type: 'integer' },
      trimmed: { type: 'array', items: { type: 'string' } },
      dropped: { type: 'array', items: { type: 'string' } },
      missing: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string' }, reason: { type: 'string' } },
          required: ['name', 'reason'],
        },
      },
      overflow: { type: 'boolean' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            protection: { type: 'string' },
            source: { type: 'string' },
            chars: { type: 'integer' },
            dropped: { type: 'boolean' },
            trimmed: { type: 'boolean' },
          },
          required: ['name', 'protection'],
        },
      },
      review: {
        type: 'object',
        additionalProperties: false,
        properties: { round: { type: 'integer' }, revision: { type: 'integer' } },
        required: ['round', 'revision'],
      },
    },
    required: ['budget'],
  },
  whitelist: {
    type: 'object',
    additionalProperties: false,
    description: 'Fact whitelist summary: counts and a few samples only.',
    properties: {
      counts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          names: { type: 'integer' },
          places: { type: 'integer' },
          numbers: { type: 'integer' },
        },
        required: ['names', 'places', 'numbers'],
      },
      sample: {
        type: 'object',
        additionalProperties: false,
        properties: {
          names: { type: 'array', items: { type: 'string' } },
          places: { type: 'array', items: { type: 'string' } },
          numbers: { type: 'array', items: { type: 'string' } },
        },
        required: ['names', 'places', 'numbers'],
      },
    },
    required: ['counts', 'sample'],
  },
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
        protection: { type: 'string' },
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
 * Output contract for `story_context`. It cannot reuse the brief's section shape:
 * those sections require `bytes` and have no protection level.
 */
const CONTEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      role: OUTPUT_PROPERTIES.role,
      chapter: { type: 'integer' },
      sections: {
        type: 'array',
        description: 'Role context sections, in prompt order (success only).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            title: { type: 'string' },
            source: { type: 'string' },
            content: { type: 'string' },
            protection: { type: 'string' },
          },
          required: ['name', 'title', 'content', 'protection'],
        },
      },
      trace: OUTPUT_PROPERTIES.trace,
      whitelist: OUTPUT_PROPERTIES.whitelist,
      error: OUTPUT_PROPERTIES.error,
      missing: { type: 'array', items: { type: 'string' } },
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}

/**
 * Refuse a chapter body that invents people, warns about unknown places or sizes.
 * @param {string} root - workspace directory.
 * @param {{work: string, chapter: number, body: string}} draft - the body about to land.
 * @returns {Promise<{warnings: string[]}>} warnings that do not block.
 */
async function checkDraft(root, draft) {
  const whitelist = await deriveWhitelist(root, { work: draft.work, chapter: draft.chapter })
  const consistency = checkConsistency({ body: draft.body, whitelist })
  if (consistency.unknownNames.length > 0) {
    throw new StoryError('consistency-violation',
      `正文出现上下文里没有的人名：${consistency.unknownNames.join('、')}。改写后再落盘`)
  }
  return { warnings: consistency.warnings }
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
    output: spec.output ?? OUTPUT,
    mutates: spec.mutates === true,
    async execute(args, exec) {
      if (spec.mutates === true && delegationDepthOf(exec) > 0) {
        return failureOf(new StoryError('subagent-cannot-land', DELEGATED_DENIAL))
      }
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
      mutates: true,
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
      mutates: true,
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
      name: 'story_outline',
      mutates: true,
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
      mutates: true,
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
      name: 'story_context',
      description: '派发前取一份按角色分层的故事上下文：权威顺序、任务、硬约束、章纲/全书计划、正文、人物与状态、最近脉络、标准。'
        + ' 只读；返回每段的保护级别、预算轨迹与白名单摘要，供主编拼子代理 prompt。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号；作品级规划可省略。' },
          role: {
            type: 'string',
            enum: ['writer', 'planner', 'reviewer', 'reviser'],
            description: '派给谁：写手、规划、审稿或修订。',
          },
          instruction: { type: 'string', description: '作者本轮要求，会并入任务段。' },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '仅修订使用，缺省 patch。',
          },
        },
        required: ['work', 'role'],
      },
      output: CONTEXT_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const role = args.role
        const chapter = args.chapter
        if (role !== 'planner' && chapter === undefined) {
          throw new StoryError('chapter-required', `${role} 必须给出章号：只有作品级规划可以省略 chapter`)
        }
        const instruction = typeof args.instruction === 'string' ? args.instruction : ''
        const mode = typeof args.mode === 'string' ? args.mode : 'patch'

        // The action reads the chapter, its plan and its latest review itself;
        // the caller never pastes a body or a list.
        let body = ''
        let review
        if (role === 'reviewer' || role === 'reviser') {
          const manifest = await readManifest(root, args.work)
          const entry = manifest.chapters.find(item => item.number === chapter)
          if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${chapter} 章：先写章纲再派活`)
          try {
            body = (await readChapter(root, { work: args.work, chapter })).content
          } catch (error) {
            if (error?.code === 'body-not-found') {
              throw new StoryError('chapter-not-written', `第 ${chapter} 章还没有正文：先写正文，再审稿或修订`)
            }
            throw error
          }
          const latest = await latestReview(root, manifest, entry)
          const open = latest === undefined ? [] : parseReview(latest.text).filter(item => !item.done)
          if (role === 'reviser' && open.length === 0) {
            throw new StoryError('review-required', `第 ${chapter} 章没有未处理的审稿条目：先 story_review，再修订`)
          }
          review = {
            round: latest?.round,
            revision: latest?.revision,
            open: open.map(item => ({ id: item.id, problem: item.problem })),
          }
        }

        const context = await assembleRoleContext({
          root,
          work: args.work,
          ...(chapter === undefined ? {} : { chapter }),
          role,
          ...(role === 'planner' ? { scope: chapter === undefined ? 'work' : 'chapter' } : {}),
          ...(role === 'planner' ? { task: chapter === undefined
            ? '为这部作品出全书计划：主线、卷划分、结局方向。'
            : `为第 ${chapter} 章出章纲：五项齐全且互相咬合。` } : {}),
          instruction,
          ...(role === 'reviser' ? { mode } : {}),
          ...(body === '' ? {} : { body }),
          ...(review === undefined ? {} : { review }),
        })
        return {
          ok: true,
          workId: args.work,
          role,
          ...(chapter === undefined ? {} : { chapter }),
          sections: context.sections
            .filter(item => item.content !== '')
            .map(item => ({
              name: item.name,
              title: item.title,
              source: item.source ?? '',
              content: item.content,
              protection: item.protection,
            })),
          trace: {
            ...context.trace,
            ...(review === undefined ? {} : { review: { round: review.round ?? 0, revision: review.revision ?? 0 } }),
          },
          whitelist: context.whitelist,
        }
      },
    }),

    action({
      name: 'story_write',
      mutates: true,
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
        const { warnings } = await checkDraft(root, args)
        const result = await writeChapter(root, { ...args, requirePlanApproval: true })
        return {
          ok: true, workId: args.work, artifact: result.artifact, words: result.words,
          ...(result.cleaned > 0 ? { cleaned: result.cleaned } : {}),
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_review',
      mutates: true,
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
      mutates: true,
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
        const { warnings } = await checkDraft(root, args)
        const result = await reviseChapter(root, args)
        return {
          ok: true, workId: args.work, artifact: result.artifact, resolved: result.resolved,
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_state',
      mutates: true,
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
        const summary = await readSummary(root, args.work, args.chapter).catch(() => undefined)
        if (summary === undefined || String(summary).trim() === '') {
          throw new StoryError('summary-required',
            `第 ${args.chapter} 章还没有摘要：先用 story_summarize 写摘要，再定稿`)
        }
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      mutates: true,
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
      // Refuse a delegated writer before resolving `work`, so the child sees
      // "subagents do not land" instead of a misleading work-selection error.
      if (definition.mutates === true && delegationDepthOf(exec) > 0) {
        return failureOf(new StoryError('subagent-cannot-land', DELEGATED_DENIAL))
      }
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
  // The guard lives in this preset's scope, so it applies to the main agent and
  // to every subagent spawned into the same composition; the depth predicate
  // keeps the main agent unrestricted.
  const denyDelegatedWrites = exec => (
    delegationDepthOf(exec) > 0 && DELEGATED_DENIED_TOOLS.has(exec.name) ? DELEGATED_DENIAL : undefined
  )
  const disposers = [
    ctx.tools.guard(denyDelegatedWrites),
    ...definitions().map(definition => ctx.tools.register(definition)),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}

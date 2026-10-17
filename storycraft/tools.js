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
  StoryError, foldState, initWork, reviseChapter, status as readStatus, writeChapter, writePlan, writeReview,
} from './storage.js'

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
    return { ok: false, error: { code: error.code, message: error.message } }
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
  words: { type: 'integer', description: 'Word count of the written body.' },
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
      chapters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            number: { type: 'integer' },
            status: { type: 'string' },
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
function definitions() {
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
          workId: { type: 'string', description: '可选：显式指定作品 id（字母、数字、连字符）。' },
          form: { type: 'string', description: '作品形态，默认 longform。' },
          tags: { type: 'array', description: '可选标签。', items: { type: 'string' } },
        },
        required: ['title'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const created = await initWork(root, {
          title: args.title,
          ...(typeof args.workId === 'string' ? { workId: args.workId } : {}),
          ...(typeof args.form === 'string' ? { form: args.form } : {}),
          ...(Array.isArray(args.tags) ? { tags: args.tags } : {}),
        })
        return { ok: true, workId: created.workId, artifact: { path: created.path } }
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
        },
        required: ['work', 'chapter', 'body'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await writeChapter(root, args)
        return { ok: true, workId: args.work, artifact: result.artifact, words: result.words }
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
            description: '本次处理的问题条目 id（如 Q1、Q2），至少一个。',
            items: { type: 'string' },
          },
        },
        required: ['work', 'chapter', 'body', 'problemIds'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await reviseChapter(root, args)
        return { ok: true, workId: args.work, artifact: result.artifact, resolved: result.resolved }
      },
    }),

    action({
      name: 'story_state',
      description: '把本章产生的人物事实与伏笔变化结算进作品状态，并刷新伏笔视图。'
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
                facts: { type: 'array', items: { type: 'string' } },
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
 * Register the long-form actions in the calling (preset) scope.
 * @param {object} ctx - plugin context (services: tools).
 */
export function apply(ctx) {
  const disposers = definitions().map(definition => ctx.tools.register(definition))
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}

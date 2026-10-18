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
  StoryError, deleteWork, foldState, initWork, nextStep as nextStepFor, reopenChapter as reopenChapterFor,
  renameWork, restoreWork, reviseChapter,
  status as readStatus, writeChapter, writePlan,
  writeReview,
} from './storage.js'
import {
  assembleBrief as assembleBriefFor, importBible as importFromDesign, readBible as readBibleEntries,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from './bible.js'
import { readVolumes, writeVolume } from './volumes.js'
import { critique } from './critique.js'

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
          wordRange: {
            type: 'object',
            additionalProperties: false,
            properties: { min: { type: 'integer' }, max: { type: 'integer' } },
            required: ['min', 'max'],
            description: '单章字数范围，建档时与作者商定；省略表示不设限。',
          },
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
          ...(args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
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
          reopen: { type: 'boolean', description: '已结算章要改正文时传 true：回退到已写，旧结算作废。' },
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
            description: '本次处理的问题条目 id（如 Q1、Q2），至少一个。',
            items: { type: 'string' },
          },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '修订模式：patch 只改点到的地方（字数变化 ≤20%）、polish 润色（≤40%）、rewrite 重写、deslop 去 AI 腔（必须减少命中）。省略为 patch。',
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
        + ' 写完整章并结算后调用；摘要只写本章发生的事实与状态变化。',
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
      description: '作废一章的结算但不改正文：结算后要补审稿或改稿时先用它。'
        + ' 只对已结算章有效；作废后该章回到「已写」，再走审稿 → 修订 → 结算。',
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
      name: 'story_critique',
      description: '给一章做只读质检：字数是否在该作品范围内、句子长度、重复句、AI 腔词命中、对话占比。'
        + ' 只打分、不写文件、不阻断结算；把发现交给 story_review 才会变成清单。',
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
 * Register the long-form actions in the calling (preset) scope.
 * @param {object} ctx - plugin context (services: tools).
 */
export function apply(ctx) {
  const disposers = definitions().map(definition => ctx.tools.register(definition))
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}

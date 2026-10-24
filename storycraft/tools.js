/**
 * Story actions for the storycraft work mode.
 *
 * The preset mounts this module, so `ctx.tools.register` files every action in
 * that preset's scope: only sessions composed from this mode see `story_*`.
 * The same scope owns the delegation guard: subagents spawned into this
 * composition may read, but their file writes and landing actions are refused.
 * Each action turns model input into rows inside the current work database and
 * returns virtual `works/<workId>/...` artifact paths with their revisions; a
 * failure never leaves a partial chapter behind (see `storage.js`).
 *
 * Schemas are written in the tool registry's supported JSON Schema subset
 * (type / oneOf / properties / required / additionalProperties / items / enum /
 * const plus annotations): `required` is an array here, never a per-property
 * flag, because the registry asserts the output schema and rejects the whole
 * plugin row when it is wrong.
 */

import { createHash } from 'node:crypto'
import {
  StoryError, backupWork, deleteWork, exportWork, initWork, nextStep as nextStepFor, settleState,
  planApprovalPolicy,
  latestReview, readBibleEntry, readChapter, readEvents, readEventsText, readManifest, readPlan, readSessionCurrent,
  readSummaryState,
  reopenChapter as reopenChapterFor, renameWork, restoreWork, reviseChapter, setSessionCurrent,
  status as readStatus, updateSettings, workIdOf, writeChapter, writeOutline as writeOutlineFor, writePlan, writeReview,
} from './storage.js'
import { readChapterMemo, readChapterSummary } from './artifact-store.js'
import {
  assembleBrief as assembleBriefFor, importBible as importFromDesign, readBible as readBibleEntries,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from './bible.js'
import { readVolumes, writeVolume } from './volumes.js'
import { critique } from './critique.js'
import { loadRoleInput } from './role-input.js'
import { delegateRole } from './delegate.js'
import { checkChapterState } from './state-check.js'
import { settleChapterState } from './state-settle.js'
import { submitPayload } from './submission.js'
import { checkDraft } from './landing.js'
import { getCurrent, hydrate as hydrateCurrent, markHydrated, resolveWork, setCurrent, shouldHydrate } from './current.js'
import { join } from 'node:path'
import { createProposal, markProposalUsed, readProposal } from './proposals.js'
import { SCOPE_MESSAGES, scopeDenial } from './scope.js'

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

/**
 * Read a session's current work, hydrating the persisted row once.
 *
 * The pointer is memory-first because the panel updates it through `/current`.
 * After a host restart only `session_current` remains, so the first read for a
 * root/session loads it. A catalog failure is treated as "no pointer": this
 * helper is also called from the total, non-throwing scope guard.
 * @param {string} root - workspace directory.
 * @param {string|undefined} sessionId - session identity.
 * @returns {string|undefined} current work id.
 */
function sessionCurrentOf(root, sessionId) {
  const current = getCurrent(sessionId)
  if (current !== undefined) return current
  if (typeof root !== 'string' || root === '' || typeof sessionId !== 'string' || sessionId === '') {
    return undefined
  }
  if (!shouldHydrate(sessionId, root)) return getCurrent(sessionId)
  markHydrated(sessionId, root)
  try {
    hydrateCurrent(readSessionCurrent(root))
  } catch {
    // A broken or locked catalog must not turn file-tool guards into failures.
  }
  return getCurrent(sessionId)
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

const RETRIEVAL_TRACE = {
  type: 'object',
  additionalProperties: false,
  description: 'FTS retrieval trace for one role context or brief.',
  properties: {
    enabled: { type: 'boolean' },
    query: { type: 'string' },
    candidateCount: { type: 'integer' },
    error: { type: 'string' },
    hits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'string' } },
          score: { type: 'number' },
          sent: { type: 'boolean' },
        },
        required: ['id', 'kind', 'sourceIds', 'score', 'sent'],
      },
    },
  },
  required: ['enabled', 'query', 'candidateCount', 'hits'],
}

const BRIEF_RETRIEVAL_TRACE = {
  ...RETRIEVAL_TRACE,
  properties: {
    ...RETRIEVAL_TRACE.properties,
    chars: { type: 'integer' },
  },
}

/** Output properties shared by every action. */
const OUTPUT_PROPERTIES = {
  ok: { type: 'boolean', description: 'Whether the action completed.' },
  workId: { type: 'string', description: 'Work identity.' },
  artifact: {
    type: 'object',
    additionalProperties: false,
    description: 'Registered artifact identity. The host owns the storage path; never construct one from an ID.',
    properties: {
      workId: { type: 'string' },
      artifactId: { type: 'string' },
      revisionId: { type: 'string' },
      kind: { type: 'string' },
    },
    required: ['artifactId', 'revisionId', 'kind'],
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
    description: 'How many state ops were projected.',
    properties: {
      facts: { type: 'integer' },
      hooks: { type: 'integer' },
      newHooks: { type: 'integer' },
    },
  },
  resolved: { type: 'array', description: 'Review item ids marked as addressed.', items: { type: 'string' } },
  warnings: { type: 'array', description: 'Consistency warnings that did not block the write.', items: { type: 'string' } },
  role: { type: 'string' },
  retrieval: BRIEF_RETRIEVAL_TRACE,
  planApproval: { type: 'string', enum: ['required', 'off'] },
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
            sourceIds: { type: 'array', items: { type: 'string' } },
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
      retrieval: RETRIEVAL_TRACE,
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
        file: { type: 'string' },
        artifactId: { type: 'string' },
        revisionId: { type: 'string' },
        kind: { type: 'string' },
        version: { type: 'string' },
        content: { type: 'string' },
        draft: { type: 'boolean' },
      },
      required: ['name', 'file'],
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
        sourceIds: { type: 'array', items: { type: 'string' } },
        content: { type: 'string' },
        bytes: { type: 'integer' },
        protection: { type: 'string' },
        absent: { type: 'boolean' },
        draft: { type: 'boolean' },
        fallback: { type: 'boolean', description: 'Section used a fallback source (for example, no matched character cards).' },
        bodyFallback: { type: 'boolean', description: 'Previous chapter used the body tail because no summary exists.' },
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
  content: { type: 'string', description: 'Returned text for one artifact.' },
  startLine: { type: 'integer' },
  endLine: { type: 'integer' },
  totalLines: { type: 'integer' },
  exported: {
    type: 'object',
    additionalProperties: false,
    description: '导出 ID 与文件数；作者从只读路由取目录。',
    properties: {
      exportId: { type: 'string' },
      files: { type: 'integer' },
    },
    required: ['exportId', 'files'],
  },
  backup: {
    type: 'object',
    additionalProperties: false,
    description: '单作品备份 ID 与完整性检查结果。',
    properties: {
      backupId: { type: 'string' },
      integrity: { type: 'string' },
    },
    required: ['backupId', 'integrity'],
  },
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
      chars: { type: 'integer' },
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
      planApproval: { type: 'string', enum: ['required', 'off'] },
      outline: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              writtenAt: { type: 'string' },
              approvedAt: { type: 'string' },
            },
          },
          { type: 'null' },
        ],
        description: 'Full-book outline timestamps; approvedAt proves the author confirmed it.',
      },
      writtenChapters: { type: 'integer' },
      latestChapter: { type: 'integer' },
      openProblems: { type: 'integer' },
      facts: { type: 'integer' },
      hooks: {
        type: 'object',
        additionalProperties: false,
        properties: {
          open: { type: 'integer' },
          progressing: { type: 'integer' },
          deferred: { type: 'integer' },
          resolved: { type: 'integer' },
          superseded: { type: 'integer' },
          unresolved: { type: 'integer' },
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
            hasSummary: { type: 'boolean' },
            summaryRevision: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
            summaryStale: { type: 'boolean' },
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

/** Reject reads of an older chapter; summaries remain available through brief. */
function assertCurrentChapter(manifest, chapter) {
  const latest = manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number
  if (chapter !== undefined && Number.isFinite(chapter) && chapter < latest) {
    throw new StoryError('artifact-not-readable', `只能读当前章 ${latest}；旧章请用 story_brief 的摘要`)
  }
}

/** Short content hash used as a stable upsert revision. */
function contentRevision(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12)
}

/**
 * Turn one internal virtual artifact into the model-facing identity.
 * The path stays inside the host; the model only receives IDs.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @param {{path?: string, revision?: number}} artifact - internal artifact.
 * @returns {Promise<object|undefined>} model-facing reference.
 */
async function artifactRef(root, workId, artifact) {
  const path = String(artifact?.path ?? '')
  if (path === '') return undefined
  const rel = path.replace(/^works\/[^/]+\//u, '')
  try {
    if (/^outline\/ch-\d+\.plan\.md$/u.test(rel)) {
      const chapter = Number(/ch-(\d+)/u.exec(rel)?.[1])
      const memo = readChapterMemo(root, { work: workId, chapter })
      return { workId, artifactId: `plan:${chapter}`, revisionId: memo.artifact.revisionId, kind: 'plan' }
    }
    if (/^chapters\/ch-\d+(?:\.r\d+)?\.md$/u.test(rel)) {
      const chapter = Number(/ch-(\d+)/u.exec(rel)?.[1])
      const revision = artifact?.revision ?? Number(/\.r(\d+)\.md$/u.exec(rel)?.[1] ?? 1)
      return { workId, artifactId: `chapter:${chapter}`, revisionId: `r${revision}`, kind: 'chapter' }
    }
    if (/^reviews\/ch-\d+\.r\d+\.md$/u.test(rel)) {
      const chapter = Number(/ch-(\d+)/u.exec(rel)?.[1])
      const round = Number(/\.r(\d+)\.md$/u.exec(rel)?.[1] ?? 1)
      const review = latestReview(root, workId, chapter)
      const bodyRev = review?.revision ?? 1
      return {
        workId,
        artifactId: `review:${chapter}:r${bodyRev}:${round}`,
        revisionId: contentRevision(review?.text ?? ''),
        kind: 'review',
      }
    }
    if (/^summaries\/ch-\d+\.md$/u.test(rel)) {
      const chapter = Number(/ch-(\d+)/u.exec(rel)?.[1])
      const summary = readChapterSummary(root, { work: workId, chapter })
      return { workId, artifactId: `summary:${chapter}`, revisionId: summary.artifact.revisionId, kind: 'summary' }
    }
    if (/^bible\//u.test(rel)) {
      const file = rel.slice('bible/'.length).replace(/\.(?:md|json)$/u, '')
      return { workId, artifactId: `bible:${file}`, revisionId: contentRevision(readBibleEntry(root, workId, file)?.content), kind: 'bible' }
    }
    if (rel === 'state/events.jsonl') {
      const events = readEvents(root, workId)
      const seq = events.length === 0 ? 0 : events[events.length - 1].seq
      return { workId, artifactId: 'state', revisionId: `seq:${seq}`, kind: 'state' }
    }
    if (rel === 'manifest') {
      return { workId, artifactId: 'manifest', revisionId: 'current', kind: 'manifest' }
    }
  } catch {
    // Fall through to the generic identity if the content is already gone.
  }
  const base = rel.split('/').pop() ?? rel
  return { workId, artifactId: base.replace(/\.(?:md|json|jsonl)$/u, ''), revisionId: 'current', kind: 'artifact' }
}

/** Map one internal source string to model-facing source IDs. */
async function sourceIdsOf(root, workId, source) {
  if (typeof source !== 'string' || source.trim() === '') return []
  const refs = []
  for (const part of source.split(/\s+\+\s+/u).map(value => value.trim()).filter(Boolean)) {
    if (!/^works\//u.test(part)) {
      refs.push(part)
      continue
    }
    const ref = await artifactRef(root, workId, { path: part })
    if (ref !== undefined) refs.push(ref.artifactId)
  }
  return [...new Set(refs)]
}

/**
 * Replace every model-visible path with an artifact identity.
 * Internal storage keeps `virtualPath`; only this boundary is sanitized.
 * @param {unknown} value - action output.
 * @param {string} root - workspace directory.
 * @param {string} workId - work identity.
 * @returns {Promise<unknown>} sanitized output.
 */
async function sanitizeOutput(value, root, workId) {
  if (Array.isArray(value)) return Promise.all(value.map(item => sanitizeOutput(item, root, workId)))
  if (value === null || typeof value !== 'object') return value
  const output = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'artifact' && item !== null && typeof item === 'object' && typeof item.path === 'string') {
      const ref = await artifactRef(root, workId, item)
      if (ref !== undefined) output.artifact = ref
      continue
    }
    if (key === 'path' && typeof item === 'string' && /^(?:works|\.storycraft)\//u.test(item)) continue
    if (key === 'source' && typeof item === 'string') {
      output.sourceIds = await sourceIdsOf(root, workId, item)
      continue
    }
    if (key === 'sections' && Array.isArray(item)) {
      output.sections = await Promise.all(item.map(async section => {
        const clean = await sanitizeOutput(section, root, workId)
        if (clean !== null && typeof clean === 'object' && typeof section.source === 'string') {
          clean.sourceIds = await sourceIdsOf(root, workId, section.source)
        }
        return clean
      }))
      continue
    }
    if (key === 'files' && Array.isArray(item) && item.some(file => typeof file?.path === 'string')) {
      output.files = await Promise.all(item.map(async file => {
        const ref = typeof file.path === 'string' ? await artifactRef(root, workId, file) : undefined
        return {
          ...file,
          ...(typeof file.name === 'string' ? { file: file.name } : {}),
          ...(ref === undefined ? {} : { artifactId: ref.artifactId, revisionId: ref.revisionId, kind: ref.kind }),
          path: undefined,
        }
      }))
      output.files = output.files.map(file => Object.fromEntries(Object.entries(file).filter(([name, v]) => name !== 'path' && v !== undefined)))
      continue
    }
    if (key === 'exported' && item !== null && typeof item === 'object') {
      output.exported = { exportId: `export:${workId}`, files: item.files }
      continue
    }
    if (key === 'backup' && item !== null && typeof item === 'object') {
      const stamp = typeof item.file === 'string' ? (/(\d{8,}|\d{4}-\d{2}-\d{2}[^/\\]*)/u.exec(item.file)?.[1] ?? 'current') : 'current'
      output.backup = { backupId: `backup:${workId}:${String(stamp).replace(/[^\w.-]/gu, '')}`, integrity: item.integrity }
      continue
    }
    output[key] = await sanitizeOutput(item, root, workId)
  }
  return output
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
 * `story_next` adds one optional hint without changing the shared schema every
 * other action advertises.
 */
const NEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...OUTPUT_PROPERTIES,
      blocked: {
        type: 'array',
        description: 'Author or host actions that must happen before the action can run.',
        items: { type: 'string', enum: ['outline-approval', 'plan-approval'] },
      },
      delegate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['writer', 'reviewer', 'reviser', 'summarizer'] },
        },
        required: ['role'],
      },
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}

/** Shared v2 state payload schema for `story_state` and `story_state_check`. */
const STATE_PAYLOAD_PROPERTIES = {
  factOps: {
    type: 'object',
    additionalProperties: false,
    description: '事实变化：upsert 三元组，expire 用 subject/predicate（object 可选）选择器。',
    properties: {
      upsert: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subject: { type: 'string' },
            predicate: { type: 'string' },
            object: { type: 'string' },
            source: { type: 'string', description: '可选：正文依据原句。' },
          },
          required: ['subject', 'predicate', 'object'],
        },
      },
      expire: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subject: { type: 'string' },
            predicate: { type: 'string' },
            object: { type: 'string' },
          },
          required: ['subject', 'predicate'],
        },
      },
    },
  },
  hookOps: {
    type: 'object',
    additionalProperties: false,
    description: '伏笔状态变化：只引用已有 hookId，状态转移由宿主校验。',
    properties: {
      progress: { type: 'array', items: { type: 'string' } },
      mention: { type: 'array', items: { type: 'string' } },
      defer: { type: 'array', items: { type: 'string' } },
      resolve: { type: 'array', items: { type: 'string' } },
      supersede: { type: 'array', items: { type: 'string' } },
    },
  },
  newHooks: {
    type: 'array',
    description: '新伏笔：只给文本与元数据，hookId 由宿主铸造。',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        type: { type: 'string' },
        expectedPayoff: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['text'],
    },
  },
}

/** Output contract for one delegated role submission. */
export const SUBMIT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      submitted: { type: 'boolean' },
      bytes: { type: 'integer' },
      words: { type: 'integer' },
      error: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['code', 'message'],
      },
      retryable: { type: 'boolean' },
      actual: { type: 'string' },
      limit: { type: 'string' },
      min: { type: 'integer' },
      max: { type: 'integer' },
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}
/** Compact receipt of one host-side role delegation. */
const DELEGATE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      chapter: OUTPUT_PROPERTIES.chapter,
      role: { type: 'string', enum: ['writer', 'reviewer', 'reviser', 'summarizer'] },
      stage: OUTPUT_PROPERTIES.stage,
      revision: { type: 'integer' },
      words: OUTPUT_PROPERTIES.words,
      summaryChars: { type: 'integer' },
      reviewRound: { type: 'integer' },
      submissionAttempts: { type: 'integer' },
      lastMode: { type: 'string', enum: ['patch', 'polish', 'rewrite', 'deslop'] },
      wordRange: {
        type: 'object',
        additionalProperties: false,
        properties: { min: { type: 'integer' }, max: { type: 'integer' } },
        required: ['min', 'max'],
      },
      artifact: OUTPUT_PROPERTIES.artifact,
      problems: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer' },
          open: { type: 'integer' },
        },
        required: ['total', 'open'],
      },
      resolved: OUTPUT_PROPERTIES.resolved,
      warnings: OUTPUT_PROPERTIES.warnings,
      missing: OUTPUT_PROPERTIES.missing,
      error: OUTPUT_PROPERTIES.error,
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}

/** One advisory semantic finding returned by `story_state_check`. */
const STATE_CHECK_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: {
      type: 'string',
      enum: ['fact-unsupported', 'fact-ambiguous', 'missing-change', 'hook-state-mismatch', 'hook-evidence-weak'],
    },
    where: { type: 'string' },
    problem: { type: 'string' },
    evidence: { type: 'string' },
    impact: { type: 'string' },
    severity: { type: 'string', enum: ['major', 'minor'] },
    fix: { type: 'string' },
    evidenceVerified: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
  },
  required: ['code', 'where', 'problem', 'evidence', 'impact', 'severity', 'fix', 'evidenceVerified'],
}

/** Read-only output of one semantic state check. */
const STATE_CHECK_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      chapter: { type: 'integer' },
      revision: { type: 'integer' },
      checked: { type: 'boolean' },
      items: { type: 'array', items: STATE_CHECK_ITEM },
      counts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          facts: { type: 'integer' },
          hooks: { type: 'integer' },
          newHooks: { type: 'integer' },
          items: { type: 'integer' },
        },
        required: ['facts', 'hooks', 'newHooks', 'items'],
      },
      warnings: OUTPUT_PROPERTIES.warnings,
      trace: {
        type: 'object',
        additionalProperties: false,
        properties: {
          durationMs: { type: 'integer' },
          submissionAttempts: { type: 'integer' },
        },
        required: ['durationMs', 'submissionAttempts'],
      },
      error: OUTPUT_PROPERTIES.error,
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}

/** Proposed settler payload echoed on an unresolved automatic settlement. */
const STATE_SETTLE_PROPOSED = {
  type: 'object',
  additionalProperties: false,
  properties: STATE_PAYLOAD_PROPERTIES,
}

/** Output of one automatic state settlement. */
const STATE_SETTLE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      chapter: { type: 'integer' },
      revision: { type: 'integer' },
      settled: { type: 'boolean' },
      counts: OUTPUT_PROPERTIES.counts,
      warnings: OUTPUT_PROPERTIES.warnings,
      items: { type: 'array', items: STATE_CHECK_ITEM },
      proposed: STATE_SETTLE_PROPOSED,
      reason: { type: 'string', enum: ['state-reconcile-required', 'state-invalid'] },
      message: { type: 'string' },
      attempts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          settler: { type: 'integer' },
          validator: { type: 'integer' },
        },
        required: ['settler', 'validator'],
      },
      trace: {
        type: 'object',
        additionalProperties: false,
        properties: { durationMs: { type: 'integer' } },
        required: ['durationMs'],
      },
      artifact: OUTPUT_PROPERTIES.artifact,
      error: OUTPUT_PROPERTIES.error,
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
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
            sourceIds: { type: 'array', items: { type: 'string' } },
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
        const result = await spec.execute(args ?? {}, exec)
        try {
          const workId = typeof result?.workId === 'string'
            ? result.workId
            : typeof args?.work === 'string' ? args.work : undefined
          if (workId !== undefined) return await sanitizeOutput(result, workspaceOf(exec), workId)
        } catch {
          return failureOf(new StoryError('output-unsafe', '动作结果无法安全转成 artifact ID；拒绝返回原始路径'))
        }
        return result
      } catch (error) {
        return failureOf(error)
      }
    },
  }
}

/** The long-form action set. */
function rawDefinitions(ctx) {
  return [
    action({
      name: 'story_init',
      mutates: true,
      description: '建立一部作品：真值五件与检索表。'
        + ' 先有作者同意的提案，再调用它立项。作品 id 由标题生成；同 id 已存在时拒绝，不覆盖已有作品。'

        + ' 会话没有当前作品时，成功后会把新作品设为当前；已有其他当前作品时拒绝（请新建会话再立项）。',
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
        const session = sessionOf(exec)
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
        const targetId = typeof args.workId === 'string' && args.workId.trim() !== ''
          ? workIdOf(args.workId)
          : workIdOf(args.title)
        const current = sessionCurrentOf(root, session)
        if (current !== undefined && current !== targetId) {
          throw new StoryError('work-mismatch',
            `本会话当前作品是 ${current}，不能再立项另一部：请新建会话再立项`)
        }
        const created = await initWork(root, {
          title: args.title,
          form: proposal.form,
          ...(typeof args.workId === 'string' ? { workId: args.workId } : {}),
          ...(typeof args.form === 'string' ? { form: args.form } : {}),
          ...(Array.isArray(args.tags) ? { tags: args.tags } : {}),
          ...(args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
        })
        if (session !== undefined) {
          setCurrent(session, created.workId)
          try {
            setSessionCurrent(root, session, created.workId)
          } catch (error) {
            console.warn(`[storycraft] 当前作品指针持久化失败：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        await markProposalUsed(root, proposal.id, created.workId).catch(() => {})
        return { ok: true, workId: created.workId }
      },
    }),

    action({
      name: 'story_propose',
      mutates: true,
      description: '把与作者谈成的方案落成提案（标题、形态、一句话前提、主要人物与冲突）。'
        + ' 提案不是作品：不建目录、不写章节。方向成熟后写提案给作者看，作者明确同意后再 story_init。'
        + ' 讨论阶段不要调用它，也不要写任何文件；缺信息时先只问一个最关键的问题，不要一次抛出问卷。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: '作品标题。' },
          form: { type: 'string', enum: ['longform', 'short', 'script'], description: '形态，缺省长篇。' },
          premise: { type: 'string', description: '一句话前提或核心冲突。' },
          characters: { type: 'string', description: '主要人物与他们的目标（可选）。' },
          conflict: { type: 'string', description: '主要冲突或阻力（可选）。' },
          notes: { type: 'string', description: '完整创意 brief：约定、字数范围、叙事视角、参考与禁区（可选，但方向成熟时建议写全）。' },
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
      description: '全书计划：写主线、卷划分、结局方向；返回 outline artifact ID。'
        + ' 写完后请作者在面板点「确认全书计划」；模型不能代签确认。未确认前不能写任何章的章纲。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          mainline: { type: 'string', description: '主线：主角要什么、被什么阻挡、大致怎么走。' },
          volumes: { type: 'string', description: '可选：卷划分的文字摘要。' },
          ending: { type: 'string', description: '可选：结局方向。' },
          approve: { type: 'boolean', description: '已停用：确认改由作者在面板完成。传入会返回 approval-moved。' },
        },
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        if (args.approve === true) {
          throw new StoryError('approval-moved',
            '全书计划的确认已移到面板：请作者在工作台点「确认全书计划」，模型不能代签')
        }
        const result = await writeOutlineFor(root, {
          work: args.work,
          ...(typeof args.mainline === 'string' ? { mainline: args.mainline } : {}),
          ...(typeof args.volumes === 'string' ? { volumes: args.volumes } : {}),
          ...(typeof args.ending === 'string' ? { ending: args.ending } : {}),
        })
        const content = readBibleEntry(root, result.workId, 'plan')?.content ?? ''
        return {
          ok: true,
          workId: result.workId,
          outline: result.outline,
          artifact: { workId: result.workId, artifactId: 'outline', revisionId: contentRevision(content), kind: 'outline' },
        }
      },
    }),

    action({
      name: 'story_plan',
      mutates: true,
      description: '写一章的章纲。五项必须齐全：视角、目标、阻力、代价、结尾变化；另需 body（章纲正文）与 threadRefs（伏笔数组，可为空）。'
        + ' 动笔前先出章纲，改章纲也用这个动作覆盖同一章的章纲。',
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
          body: { type: 'string', description: '章纲正文；不能为空。' },
          threadRefs: { type: 'array', items: { type: 'string' }, description: '本章涉及的伏笔 ID；可为空数组。' },
        },
        required: ['work', 'chapter', 'perspective', 'goal', 'obstacle', 'cost', 'turn', 'body', 'threadRefs'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        if (manifest.outline?.approvedAt === undefined) {
          throw new StoryError('outline-required',
            '全书计划还没确认：写完后请作者在面板点「确认全书计划」，再写章纲（模型不能代签）')
        }
        const result = await writePlan(root, { ...args, requireBody: true })
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
        if (args.chapter !== undefined) assertCurrentChapter(readManifest(root, args.work), Number(args.chapter))
        const loaded = await loadRoleInput(root, args)
        const context = loaded.context
        const chapter = args.chapter === undefined ? undefined : (loaded.entry?.number ?? Number(args.chapter))
        const review = loaded.review
        return {
          ok: true,
          workId: args.work,
          role: args.role,
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
      description: '把一章正文落库并更新进度。已存在正文时默认拒绝；要改稿传 rewrite: true，会生成新版本而不覆盖旧版。',
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
        const policy = planApprovalPolicy(await readManifest(root, args.work))
        const { warnings } = await checkDraft(root, args)
        const result = await writeChapter(root, { ...args, requirePlanApproval: policy === 'required' })
        return {
          ok: true, workId: args.work, artifact: result.artifact, words: result.words,
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_review',
      mutates: true,
      description: '把审稿发现落盘成问题清单。只写清单，绝不修改正文；每条含位置、问题、建议。'
        + ' 空数组合法，表示清稿审稿；正文不存在时会被拒绝。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          problems: {
            type: 'array',
            description: '审稿发现；空数组合法，表示清稿审稿。',
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
        const policy = planApprovalPolicy(await readManifest(root, args.work))
        const { warnings } = await checkDraft(root, args)
        const result = await reviseChapter(root, { ...args, requirePlanApproval: policy === 'required' })
        return {
          ok: true, workId: args.work, artifact: result.artifact, resolved: result.resolved,
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_state_check',
      description: '只读：在 story_state 之前核对拟写入的 payload 是否被本章正文支持，并找出正文里漏记的重要变化。'
        + ' 只返回建议性 findings，不改正文、不写 events、不改阶段；是否修改 payload 由主编决定。'
        + ' 只允许主会话调用，会启动一个 validator 子代理。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          ...STATE_PAYLOAD_PROPERTIES,
        },
        required: ['work', 'chapter'],
      },
      output: STATE_CHECK_OUTPUT,
      async execute(args, exec) {
        if (delegationDepthOf(exec) > 0) {
          throw new StoryError('state-check-parent-denied', 'story_state_check 只允许主会话调用；子代理不能发起语义对账')
        }
        const root = workspaceOf(exec)
        const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : undefined
        return checkChapterState(root, args, {
          service,
          agent: exec.agent,
          signal: exec.signal,
        })
      },
    }),

    action({
      name: 'story_settle',
      mutates: true,
      description: '自动结算本章状态：settler 从正文抽取事实与伏笔 delta，先做确定性预检，再用 R9b 语义检查；'
        + 'major/确定性 error 带反馈重算一次，仍不一致则返回 settled:false 且不写库。'
        + '成功时写入 events 并定稿；手动修正仍用 story_state。只允许主会话调用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      output: STATE_SETTLE_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : undefined
        return settleChapterState(root, args, {
          service,
          agent: exec.agent,
          signal: exec.signal,
        })
      },
    }),

    action({
      name: 'story_state',
      mutates: true,
      description: '把本章产生的 hook/fact 变化定稿进作品状态，并返回投影后的计数。'
        + ' 只写变化：已有伏笔用 hookOps 引 hookId，新伏笔放 newHooks（宿主铸 id）；fact 用三元组 + 有效期。'
        + ' 当前正文版本没有摘要返回 summary-required，摘要过期返回 summary-stale；钩子 id 不存在返回 hook-not-found，非法转移返回 hook-transition-invalid，无可失效 fact 返回 fact-not-found；已定稿再次归档返回 chapter-settled。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          ...STATE_PAYLOAD_PROPERTIES,
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const summary = readSummaryState(root, args.work, args.chapter)
        if (summary.state === 'missing') {
          throw new StoryError('summary-required',
            `第 ${args.chapter} 章还没有摘要：先用 story_summarize 写摘要，再定稿`)
        }
        if (summary.state === 'stale') {
          throw new StoryError('summary-stale',
            `第 ${args.chapter} 章摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，再定稿`)
        }
        const result = await settleState(root, args)
        return {
          ok: true,
          workId: args.work,
          counts: result.counts,
          warnings: result.warnings,
          artifact: { workId: args.work, artifactId: 'state', revisionId: `seq:${result.seq}`, kind: 'state' },
        }
      },
    }),

    action({
      name: 'story_bible',
      description: '读取作品真值（世界观、人物档案、文风、写作计划、作者意图）。'
        + ' 动笔前需要确认设定、或要查某个人物的口吻与底线时先读它；真值缺失会指出缺哪几份。',
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
        + ' 结构不合法会被拒绝且原内容不变。作者确认设定或补齐人物后再调用。',
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
        if (args.file === 'plan') {
          throw new StoryError('approval-moved', '全书计划只能通过 story_outline 写入；不要用 story_bible_write 绕过作者确认')
        }
        const written = await writeBibleEntry(root, args.work, args.file, args.content)
        return { ok: true, workId: args.work, artifact: { path: written.path }, version: written.version }
      },
    }),

    action({
      name: 'story_bible_import',
      mutates: true,
      description: '把旧文件作品里的世界观收编进真值，并列出仍需作者补的项；不导入 plan/outline，不返回路径。',
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
      name: 'story_read',
      description: '只读：按 artifactId 读取已登记的作品内容（chapter/plan/review/summary/state/bible/outline/volume）。宿主校验作品与当前章作用域；不返回文件路径。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          artifactId: { type: 'string', description: '如 chapter:1、plan:1、bible:characters。' },
          revisionId: { type: 'string', description: '可选；不传则读当前版本。' },
          startLine: { type: 'integer', description: '可选：从第几行开始（1 起）。' },
          lineCount: { type: 'integer', description: '可选：最多返回多少行。' },
        },
        required: ['work', 'artifactId'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const workId = String(args.work)
        const manifest = readManifest(root, workId)
        const latest = manifest.chapters.length === 0 ? 1 : manifest.chapters[manifest.chapters.length - 1].number
        const id = String(args.artifactId)
        const [kind, ...parts] = id.split(':')
        let content = ''
        let ref = { workId, artifactId: id, revisionId: String(args.revisionId ?? 'current'), kind }
        const chapterNumber = Number(parts[0])
        if (kind === 'chapter' || kind === 'review') {
          if (!Number.isInteger(chapterNumber) || chapterNumber !== latest) {
            throw new StoryError('artifact-not-readable', `只能读当前章 ${latest}；旧章请用 story_brief 的摘要`)
          }
        }
        if (kind === 'outline') {
          const entry = readBibleEntry(root, workId, 'plan')
          content = entry?.content ?? ''
          ref = { ...ref, artifactId: 'outline', revisionId: entry?.version ?? 'current', kind: 'outline' }
        } else if (kind === 'plan') {
          let memo
          try {
            memo = readChapterMemo(root, {
              work: workId,
              chapter: chapterNumber,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
          } catch (error) {
            if (error?.code === 'artifact-not-found' || error?.code === 'chapter-not-found') {
              throw new StoryError('plan-not-found', `第 ${chapterNumber} 章还没有章纲`)
            }
            throw error
          }
          content = JSON.stringify(memo.artifact.content, null, 2)
          ref = { ...ref, artifactId: `plan:${chapterNumber}`, revisionId: memo.artifact.revisionId, kind: 'plan' }
        } else if (kind === 'chapter') {
          const revision = args.revisionId === undefined ? undefined : Number(String(args.revisionId).replace(/^r/u, ''))
          const read = readChapter(root, { work: workId, chapter: chapterNumber, ...(revision === undefined ? {} : { revision }) })
          content = read.content
          ref = { ...ref, artifactId: `chapter:${chapterNumber}`, revisionId: `r${read.revision}`, kind: 'chapter' }
        } else if (kind === 'review') {
          const review = latestReview(root, workId, chapterNumber)
          if (review === undefined) throw new StoryError('review-required', `第 ${chapterNumber} 章还没有审稿`)
          if ((parts[1] !== undefined && parts[1] !== `r${review.revision}`) || (parts[2] !== undefined && parts[2] !== String(review.round))) {
            throw new StoryError('artifact-not-readable', '只保留当前审稿版本与轮次；旧版本不提供读取')
          }
          content = review.text
          ref = { ...ref, artifactId: `review:${chapterNumber}:r${review.revision}:${review.round}`, revisionId: contentRevision(content), kind: 'review' }
        } else if (kind === 'summary') {
          let summary
          try {
            summary = readChapterSummary(root, {
              work: workId,
              chapter: chapterNumber,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
          } catch (error) {
            if (error?.code === 'artifact-not-found' || error?.code === 'chapter-not-found') {
              throw new StoryError('summary-not-found', `第 ${chapterNumber} 章还没有摘要`)
            }
            throw error
          }
          content = JSON.stringify(summary.artifact.content, null, 2)
          ref = { ...ref, artifactId: `summary:${chapterNumber}`, revisionId: summary.artifact.revisionId, kind: 'summary' }
        } else if (kind === 'bible') {
          const file = parts.join(':')
          const entry = readBibleEntry(root, workId, file)
          content = entry?.content ?? ''
          ref = {
            ...ref,
            artifactId: file === 'plan' ? 'outline' : `bible:${file}`,
            revisionId: entry?.version ?? 'current',
            kind: file === 'plan' ? 'outline' : file,
          }
        } else if (kind === 'state') {
          content = readEventsText(root, workId)
          const events = readEvents(root, workId)
          ref = { ...ref, artifactId: 'state', revisionId: `seq:${events.length === 0 ? 0 : events[events.length - 1].seq}`, kind: 'state' }
        } else if (kind === 'volume') {
          const volume = (await readVolumes(root, workId)).find(item => String(item.id) === parts.join(':'))
          if (volume === undefined) throw new StoryError('artifact-not-readable', `没有卷：${parts.join(':')}`)
          content = JSON.stringify(volume, null, 2)
          ref = { ...ref, artifactId: `volume:${volume.id}`, revisionId: contentRevision(content), kind: 'volume' }
        } else {
          throw new StoryError('artifact-not-readable', `不认识的 artifactId：${id}`)
        }
        if (args.revisionId !== undefined && String(args.revisionId) !== ref.revisionId) {
          throw new StoryError('revision-not-found', `artifact ${ref.artifactId} 的 revisionId ${String(args.revisionId)} 已不是当前版本`)
        }
        const lines = String(content).split(/\r?\n/u)
        const start = Math.max(1, Number(args.startLine ?? 1))
        const count = Math.max(1, Math.min(500, Number(args.lineCount ?? 200)))
        const slice = lines.slice(start - 1, start - 1 + count)
        return {
          ok: true,
          workId,
          artifact: ref,
          content: slice.join('\n'),
          startLine: start,
          endLine: start + slice.length - 1,
          totalLines: lines.length,
        }
      },
    }),

    action({
      name: 'story_brief',
      description: '装配写这一章前的上下文：作者意图、本章章纲、涉及人物、未解伏笔、卷摘要、最近摘要、上一章结尾、文风、字数口径；已写 ≥3 章时追加相关素材。'
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
        assertCurrentChapter(readManifest(root, args.work), Number(args.chapter))
        const brief = await assembleBriefFor(root, args.work, args.chapter)
        return { ok: true, workId: args.work, sections: brief.sections, budget: brief.budget, missing: brief.missing, dropped: brief.dropped, retrieval: brief.retrieval }
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
      description: '改作品的标题或作品 id（库文件会一起改）。id 必须是新的、不与他人冲突；'
        + ' 只改标题时库文件不动。',
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
      description: '把作品移进回收站，不再出现在列表里；可用 story_restore 恢复。不返回路径。',
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
      description: '把回收站里最近一次删除的同名作品恢复回作品列表。目标名已被占用时拒绝。',
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
      description: '设定作品的写作参数：单章字数范围与章纲确认策略。'
        + ' 字数传 null 表示清空、不按字数判定；planApproval 传 required 表示每章章纲必须作者在面板确认，传 off 表示不需要确认。',
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
          planApproval: {
            type: 'string',
            enum: ['required', 'off'],
            description: '章纲确认策略：required 每章必须确认；off 不需要确认。省略表示不改。',
          },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await updateSettings(root, {
          work: args.work,
          ...(args.clear === true ? { wordRange: null } : args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
          ...(args.planApproval === undefined ? {} : { planApproval: args.planApproval }),
        })
        return {
          ok: true,
          workId: result.workId,
          ...(result.wordRange === undefined ? {} : { wordRange: result.wordRange }),
          ...(result.planApproval === undefined ? {} : { planApproval: result.planApproval }),
        }
      },
    }),

    action({
      name: 'story_current',
      description: '只读：本会话当前在做的作品。通常由面板进入时选定；'
        + ' 会话没有当前作品时，story_init 成功后会设为当前。其他情况模型不能自己切换；'
        + ' 返回 null 时说明还没有进入任何作品，请作者在面板里进入一部。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const current = sessionCurrentOf(root, sessionOf(exec))
        if (current === undefined) return { ok: true, current: null }
        let manifest
        try {
          manifest = readManifest(root, current)
        } catch {
          manifest = undefined
        }
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
        const volume = result.volume
        return {
          ok: true,
          workId: args.work,
          volumes: result.volumes,
          volume,
          artifact: { workId: args.work, artifactId: `volume:${volume.id}`, revisionId: contentRevision(JSON.stringify(volume)), kind: 'volume' },
        }
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
      name: 'story_submit',
      description: '只允许被 story_delegate / story_settle 派发的子代理调用：把角色结果提交给宿主校验。校验失败可修正后重提；成功后父代理才会落盘。不要把正文当最终回答返回。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delegationId: { type: 'string', description: 'story_delegate 注入的一次性身份。' },
          payload: { type: 'object', additionalProperties: true, description: '角色结构化结果。' },
        },
        required: ['delegationId', 'payload'],
      },
      output: SUBMIT_OUTPUT,
      async execute(args, exec) {
        return submitPayload({
          delegationId: args.delegationId,
          payload: args.payload,
          depth: delegationDepthOf(exec),
          root: workspaceOf(exec),
        })
      },
    }),

    action({
      name: 'story_delegate',
      mutates: true,
      description: '宿主侧委派一个角色完成单步：writer 写首版正文、reviewer 审稿并落清单、reviser 按未处理条目修订、summarizer 写本章摘要。'
        + ' 主编只收回执（版本/字数/审稿计数/警告），不接触正文与上下文；子代理通过 story_submit 提交，失败返回 delegation-no-submission。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          role: { type: 'string', enum: ['writer', 'reviewer', 'reviser', 'summarizer'], description: '本次要跑的角色。' },
          instruction: { type: 'string', description: '作者本轮要求，会并入子代理任务。' },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '仅 reviser 使用；缺省 patch。',
          },
        },
        required: ['work', 'chapter', 'role'],
      },
      output: DELEGATE_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : undefined
        return delegateRole(root, args, {
          service,
          agent: exec.agent,
          signal: exec.signal,
        })
      },
    }),

    action({
      name: 'story_next',
      description: '查询这部作品下一步该做什么：动作名、章号、原因、缺什么（章纲/审稿/条目 id）与 blocked。'
        + ' blocked 非空表示必须等作者在面板动作（全书计划/章纲确认），此时不要执行 action，也不要委派。'
        + ' 返回 delegate 时优先用 story_delegate（writer/reviewer/reviser/summarizer）；没有 delegate 时按 action 走手动路径。'
        + ' 每写完一步先调它，不要凭记忆猜下一步；它只读，不改任何文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      output: NEXT_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const next = await nextStepFor(root, args.work)
        return { ok: true, ...next }
      },
    }),

    action({
      name: 'story_status',
      description: '只读查看一部作品的进度：全书计划是否已确认、章数与状态、当前版本、未处理审稿问题、未解伏笔，'
        + '以及每章的 hasSummary / summaryRevision / summaryStale。不知道下一步该写什么时先读它。',
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

    action({
      name: 'story_export',
      mutates: true,
      description: '把一部作品导出成可读目录，返回 export:<workId>；作者从面板的只读导出路由取用，模型不接触路径。',
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
        const exported = exportWork(root, args.work)
        return { ok: true, workId: args.work, exported }
      },
    }),

    action({
      name: 'story_backup',
      mutates: true,
      description: '把一部作品的库备份成单个文件，返回 backup:<workId>:<timestamp> 与完整性检查结果；作者从只读备份路由取用。',
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
        const backup = await backupWork(root, args.work)
        return { ok: true, workId: args.work, backup }
      },
    }),
  ]
}

/**
 * The registered action list: `work` is optional and resolved per session.
 * @returns {object[]} action definitions.
 */
function definitions(ctx) {
  return rawDefinitions(ctx).map(withCurrentWork)
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
      const root = workspaceOf(exec)
      const current = sessionCurrentOf(root, session)
      const explicit = typeof args?.work === 'string' && args.work.trim() !== '' ? args.work.trim() : undefined
      // One session drives one work: a call that names a different work would
      // silently write into the wrong book, so it is refused and the author
      // switches in the panel instead.
      // Without an active work the session may not reach into the works tree at
      // all: discussion happens before any book is entered, and only the panel
      // (or a successful story_init in an empty session) points it at one.
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
 * Walk to the root session of one call (a subagent points at its dispatcher).
 * @param {object} ctx - plugin context.
 * @param {object} session - calling session.
 * @returns {object|undefined} root session.
 */
function rootSessionOf(ctx, session) {
  let current = session
  const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = current?.header?.parentSession
    if (typeof parent !== 'string' || parent === '') return current
    const next = sessions?.get?.(parent)
    if (next === undefined) return current
    current = next
  }
  return current
}

/**
 * The live working directory of one session, falling back to its header.
 * @param {object} ctx - plugin context.
 * @param {object} session - calling session.
 * @returns {string|undefined} absolute directory.
 */
function workingDirectoryOf(ctx, session) {
  const service = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined
  try {
    const value = service?.get?.(session)
    if (typeof value === 'string' && value !== '') return value
  } catch {
    // fall through to the immutable header
  }
  const header = session?.header?.cwd
  return typeof header === 'string' && header !== '' ? header : undefined
}

/**
 * Deny file/DB access outside the session's work scope. Details live in scope.js.
 * @param {object} ctx - plugin context.
 * @param {object} exec - pending tool call.
 * @returns {string|undefined} denial copy.
 */
function scopeDenialOf(ctx, exec) {
  const session = exec?.agent?.session
  if (session === undefined) return undefined
  const root = rootSessionOf(ctx, session)
  const rootCwd = root?.header?.cwd
  const cwd = workingDirectoryOf(ctx, session)
  if (typeof rootCwd !== 'string' || rootCwd === '' || cwd === undefined) return SCOPE_MESSAGES.discussion
  const currentWork = sessionCurrentOf(rootCwd, root?.header?.id ?? session.header?.id)
  return scopeDenial({
    tool: exec.name,
    arguments: exec.arguments ?? {},
    cwd,
    worksRoot: join(rootCwd, 'works'),
    dbRoot: join(rootCwd, '.storycraft'),
    ...(currentWork === undefined ? {} : { currentWork }),
  })
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
  const denyOutOfScope = exec => scopeDenialOf(ctx, exec)
  const disposers = [
    ctx.tools.guard(denyDelegatedWrites),
    ctx.tools.guard(denyOutOfScope),
    ...definitions(ctx).map(definition => ctx.tools.register(definition)),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}

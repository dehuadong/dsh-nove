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
  approveFoundation, approveOutline, approveChapterPlan,
  planApprovalPolicy,
  latestReview, readBibleEntry, readChapter, readEvents, readEventsText, readManifest, readPlan, readSessionCurrent,
  readSummaryState,
  reopenChapter as reopenChapterFor, renameWork, restoreWork, reviseChapter, setSessionCurrent,
  status as readStatus, updateSettings, workIdOf, writeChapter, writeOutline as writeOutlineFor, writePlan, writeReview,
} from './storage.ts'
import { listRoleCards, readArtifact, readChapterMemo, readChapterSummary, readRoleCard, readTextArtifact } from './artifact-store.ts'
import {
  assembleBrief as assembleBriefFor, readBible as readBibleEntries,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from './bible.ts'
import { readVolumes, writeVolume } from './volumes.ts'
import { critique, findingsOf } from './critique.ts'
import { loadRoleInput } from './role-input.ts'
import { delegateRole } from './delegate.ts'
import { checkChapterState } from './state-check.ts'
import { settleChapterState } from './state-settle.ts'
import { submitPayload } from './submission.ts'
import { checkDraft } from './landing.ts'
import { clearCurrent, getCurrent, hydrate as hydrateCurrent, markHydrated, resolveWork, setCurrent, shouldHydrate } from './current.ts'
import { join } from 'node:path'
import { createProposal, markProposalUsed, readProposal } from './proposals.ts'
import { SCOPE_MESSAGES, scopeDenial } from './scope.ts'

/**
 * A JSON Schema node as this module writes it.
 *
 * Schemas are data the registry reads; nested members stay loose so shared
 * fragments can be spread without redeclaring the whole subset.
 */
type SchemaNode = Record<string, any>

/**
 * Parsed model arguments of one action call.
 *
 * Model JSON is a DSH dynamic boundary: the registry validates it against the
 * action's `parameters` schema and the store validates every field again, so
 * actions read it as an untyped record instead of a hand-maintained mirror.
 */
type ModelArgs = Record<string, any>

/** Model-facing artifact identity; the host owns the storage path. */
interface ArtifactRef {
  workId: string
  artifactId: string
  // The store hands back its typed SQLite column; at runtime it is always the revision text.
  revisionId: any
  kind: string
}

/** The structured failure every action returns. */
interface FailureEnvelope {
  ok: false
  missing?: string[]
  error: { code: string, message: string, next?: string }
}

/** Manifest fields the actions read; the store owns the full shape. */
interface ManifestView {
  title?: string
  chapters: Array<{ number: number, currentRevision: number }>
  outline?: { approvedAt?: string }
  wordRange?: { min: number, max: number }
}

/** One action spec accepted by the {@link action} factory. */
interface ActionSpec {
  name: string
  description: string
  parameters: SchemaNode
  output?: DshToolOutput
  mutates?: boolean
  execute(args: ModelArgs, exec: DshToolExecution): Promise<any>
}

/** A registry-ready action; `mutates` drives the delegation guard. */
interface ActionDefinition extends DshToolDefinition {
  description: string
  parameters: SchemaNode
  output: DshToolOutput
  mutates: boolean
}

/**
 * The session that owns one tool call.
 *
 * The tool runtime exposes the calling agent, whose `id` is the session id; the
 * positional `sessionId` is kept as a fallback for tests and older callers.
 * @param exec - tool run context.
 * @returns session identity.
 */
function sessionOf(exec: DshToolExecution): string | undefined {
  const id = exec?.agent?.id ?? exec?.sessionId
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Delegation depth of the calling agent.
 *
 * A spawned subagent's session header carries the depth fixed at delegation,
 * so a resumed child keeps it; the main session is 0.
 * @param exec - tool run context.
 * @returns positive delegation depth, or 0 for the main session.
 */
function delegationDepthOf(exec: DshToolExecution): number {
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
export const inject: string[] = ['tools']

/** Provider label used in diagnostics. */
export const name: string = 'storycraft-tools'

/** Workspace directory for one call. */
function workspaceOf(exec: DshToolExecution): string {
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
 * @param root - workspace directory.
 * @param sessionId - session identity.
 * @returns current work id.
 */
function sessionCurrentOf(root: string, sessionId: string | undefined): string | undefined {
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

/** The stable code of a thrown store error, at a dynamic boundary. */
function storeErrorCodeOf(error: unknown): string | undefined {
  return (error as { code?: unknown } | null | undefined)?.code as string | undefined
}

/** Turn a thrown value into the structured failure every action returns. */
export function failureOf(error: unknown): FailureEnvelope {
  if (error instanceof StoryError) {
    const missing = error.code === 'bible-missing'
      ? error.message.replace(/^.*?：/u, '').split('（')[0].split('、').map(name => name.trim()).filter(Boolean)
      : undefined
    return {
      ok: false,
      ...(missing === undefined ? {} : { missing }),
      error: {
        code: error.code,
        message: error.message,
        ...(error.next === undefined ? {} : { next: error.next }),
        ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
      },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

/** Contract shape of a retrieval record inside a trace. */
const TRACE_RETRIEVAL: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  description: 'FTS retrieval record: the query and the candidates that were selected.',
  properties: {
    engine: { type: 'string', enum: ['sqlite-fts5-bm25'] },
    query: { type: 'string' },
    selectionMode: { type: 'string', enum: ['semantic', 'complete'] },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          source: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['id', 'kind', 'source', 'score'],
      },
    },
    semanticSelectedIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['engine', 'query', 'selectionMode', 'candidates', 'semanticSelectedIds'],
}

/** One section as the trace reports it. */
const TRACE_SECTION: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    protection: { type: 'string', enum: ['protected', 'compressible'] },
    sourceIds: { type: 'array', items: { type: 'string' } },
    chars: { type: 'integer' },
    tokens: { type: 'integer' },
    dropped: { type: 'boolean' },
    trimmed: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['name', 'protection', 'sourceIds', 'chars', 'tokens'],
}

/** The trace every context or brief receipt carries. */
const TRACE_OUTPUT: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  description: 'Token accounting and trimming record for one assembly.',
  properties: {
    chapter: { type: 'integer' },
    plannerInputs: { type: 'array', items: { type: 'string' } },
    composerInputs: { type: 'array', items: { type: 'string' } },
    selectedSources: { type: 'array', items: { type: 'string' } },
    contextTiers: {
      type: 'object',
      additionalProperties: false,
      properties: {
        protectedSources: { type: 'array', items: { type: 'string' } },
        compressibleSources: { type: 'array', items: { type: 'string' } },
      },
      required: ['protectedSources', 'compressibleSources'],
    },
    tokenBudget: {
      type: 'object',
      additionalProperties: false,
      properties: {
        protectedTokens: { type: 'integer' },
        compressibleTokens: { type: 'integer' },
        totalSelectedTokens: { type: 'integer' },
      },
      required: ['protectedTokens', 'compressibleTokens', 'totalSelectedTokens'],
    },
    retrieval: TRACE_RETRIEVAL,
    notes: { type: 'array', items: { type: 'string' } },
    trimmed: { type: 'array', items: { type: 'string' } },
    dropped: { type: 'array', items: { type: 'string' } },
    budget: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer' },
        used: { type: 'integer' },
        unit: { type: 'string', enum: ['tokens'] },
      },
      required: ['limit', 'used', 'unit'],
    },
    sections: { type: 'array', items: TRACE_SECTION },
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
    review: {
      type: 'object',
      additionalProperties: false,
      properties: { round: { type: 'integer' }, revision: { type: 'integer' } },
      required: ['round', 'revision'],
    },
  },
  required: ['selectedSources', 'contextTiers', 'tokenBudget', 'notes', 'trimmed', 'dropped', 'budget', 'sections', 'missing', 'overflow'],
}

/** Output properties shared by every action. */
const OUTPUT_PROPERTIES: SchemaNode = {
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
  planApproval: { type: 'string', enum: ['required', 'off'] },
  trace: TRACE_OUTPUT,
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
    description: '全书计划状态：writtenAt 写过、approvedAt 作者已确认、revision 为写入的 artifact revision。',
    additionalProperties: false,
    properties: {
      writtenAt: { type: 'string' },
      approvedAt: { type: 'string' },
      revision: { type: 'string' },
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
            planRevision: { type: 'string' },
            provenance: { type: 'string' },
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
      // Failure envelopes carry the next step and the retry hint; the host
      // validates this shape, so the fields belong here rather than in a cast.
      next: { type: 'string' },
      retryable: { type: 'boolean' },
    },
    required: ['code', 'message'],
  },
}

/** Reject reads of an older chapter; summaries remain available through brief. */
function assertCurrentChapter(manifest: ManifestView, chapter: number | undefined): void {
  const latest = manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number
  if (chapter !== undefined && Number.isFinite(chapter) && chapter < latest) {
    throw new StoryError('artifact-not-readable', `只能读当前章 ${latest}；旧章请用 story_brief 的摘要`)
  }
}

/** Short content hash used as a stable upsert revision. */
function contentRevision(text: unknown): string {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12)
}

/**
 * Turn one internal virtual artifact into the model-facing identity.
 * The path stays inside the host; the model only receives IDs.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @param artifact - internal artifact.
 * @returns model-facing reference.
 */
async function artifactRef(
  root: string,
  workId: string,
  artifact: { path?: string, revision?: number } | null | undefined,
): Promise<ArtifactRef | undefined> {
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
      // The store owns the review shape; this layer only reads its current text out.
      const review: any = latestReview(root, workId, chapter)
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
    if (rel === 'outline/plan.md') {
      const entry = readBibleEntry(root, workId, 'plan')
      return { workId, artifactId: 'outline', revisionId: entry?.version ?? 'current', kind: 'outline' }
    }
    if (/^bible\//u.test(rel)) {
      const file = rel.slice('bible/'.length).replace(/\.(?:md|json)$/u, '')
      const entry = readBibleEntry(root, workId, file)
      return {
        workId,
        artifactId: `bible:${file}`,
        revisionId: entry?.version ?? 'current',
        kind: file === 'characters' ? 'bible' : file,
      }
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
async function sourceIdsOf(root: string, workId: string, source: unknown): Promise<string[]> {
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
 * @param value - action output.
 * @param root - workspace directory.
 * @param workId - work identity.
 * @returns sanitized output.
 */
// The result is arbitrary receipt JSON: its keys depend on the action, and only
// the action boundary serialises it.
async function sanitizeOutput(value: unknown, root: string, workId: string): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map(item => sanitizeOutput(item, root, workId)))
  if (value === null || typeof value !== 'object') return value
  // Fields are copied one by one below; each carries the source object's own type.
  const output: Record<string, any> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'artifact' && item !== null && typeof item === 'object' && typeof item.path === 'string') {
      const ref = await artifactRef(root, workId, item)
      if (ref !== undefined) output.artifact = ref
      continue
    }
    if (key === 'path' && typeof item === 'string' && /^(?:works|\.storycraft)\//u.test(item)) continue
    if (key === 'source' && item === '') continue
    if (key === 'source' && typeof item === 'string' && /^(?:works|\.storycraft)\//u.test(item)) {
      output.sourceIds = await sourceIdsOf(root, workId, item)
      continue
    }
    if (key === 'sections' && Array.isArray(item)) {
      output.sections = await Promise.all(item.map(async section => {
        const clean = await sanitizeOutput(section, root, workId)
        if (clean !== null && typeof clean === 'object') {
          // Every section exposes source ids; a virtual path is resolved, an
          // already-identified source passes through, and an absent one is empty.
          clean.sourceIds = typeof section.source === 'string' && /^(?:works|\.storycraft)\//u.test(section.source)
            ? await sourceIdsOf(root, workId, section.source)
            : (Array.isArray(section.sourceIds) ? section.sourceIds : [])
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
      output.files = output.files.map((file: any) => Object.fromEntries(Object.entries(file).filter(([name, v]) => name !== 'path' && v !== undefined)))
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
const OUTPUT: DshToolOutput = {
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
const NEXT_OUTPUT: DshToolOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...OUTPUT_PROPERTIES,
      foundationStage: { type: 'string', enum: ['frame', 'rules', 'roles', 'cards'] },
      blocked: {
        type: 'array',
        description: 'Author or host actions that must happen before the action can run.',
        items: {
          type: 'string',
          enum: ['outline-approval', 'plan-approval', 'foundation-approval', 'revision-limit'],
        },
      },
      delegate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['writer', 'reviewer', 'reviser', 'summarizer', 'architect', 'planner'] },
          stage: { type: 'string', enum: ['frame', 'rules', 'roles', 'cards'] },
        },
        required: ['role'],
      },
      ask: {
        type: 'object',
        description: 'Material and the single question a judgement point puts to the author.',
        additionalProperties: false,
        properties: {
          present: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['observation', 'plan', 'text', 'findings'] },
                items: { type: 'array', items: { type: 'string' } },
              },
              required: ['kind', 'items'],
            },
          },
          question: { type: 'string' },
        },
        required: ['present', 'question'],
      },
      method: {
        type: 'object',
        description: 'The single method reference the next action needs; the host picks it, not the skill.',
        additionalProperties: false,
        properties: {
          skill: { type: 'string' },
          reference: { type: 'string' },
        },
        required: ['skill'],
      },
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}

/** Shared v2 state payload schema for `story_state` and `story_state_check`. */
const STATE_PAYLOAD_PROPERTIES: SchemaNode = {
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
export const SUBMIT_OUTPUT: DshToolOutput = {
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
          // A failure can carry the next step and whether a retry helps; the host
          // validates this envelope, so both belong to the declared shape.
          next: { type: 'string' },
          retryable: { type: 'boolean' },
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
const DELEGATE_OUTPUT: DshToolOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      chapter: OUTPUT_PROPERTIES.chapter,
      role: { type: 'string', enum: ['writer', 'reviewer', 'reviser', 'summarizer', 'architect', 'planner'] },
      stage: OUTPUT_PROPERTIES.stage,
      foundationStage: { type: 'string', enum: ['frame', 'rules', 'roles', 'cards'] },
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            artifactId: { type: 'string' },
            revisionId: { type: 'string' },
            kind: { type: 'string' },
          },
          required: ['artifactId', 'revisionId', 'kind'],
        },
      },
      foundation: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stages: {
            type: 'object',
            additionalProperties: false,
            properties: {
              frame: { type: 'boolean' },
              rules: { type: 'boolean' },
              roles: { type: 'boolean' },
              cards: { type: 'boolean' },
            },
            required: ['frame', 'rules', 'roles', 'cards'],
          },
          complete: { type: 'boolean' },
          writtenAt: { type: 'string' },
          nextStage: { type: 'string', enum: ['frame', 'rules', 'roles', 'cards'] },
          approvedAt: { type: 'string' },
        },
        required: ['stages', 'complete'],
      },
      revision: { type: 'integer' },
      planApproved: { type: 'boolean' },
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
const STATE_CHECK_ITEM: SchemaNode = {
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
const STATE_CHECK_OUTPUT: DshToolOutput = {
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
const STATE_SETTLE_PROPOSED: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  properties: STATE_PAYLOAD_PROPERTIES,
}

/** Output of one automatic state settlement. */
const STATE_SETTLE_OUTPUT: DshToolOutput = {
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
      reason: { type: 'string', enum: ['state-reconcile-required', 'state-invalid', 'state-settle-timeout'] },
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
        properties: {
          durationMs: { type: 'integer' },
          lastError: { type: 'string' },
          perAttempt: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                stage: { type: 'string', enum: ['settler', 'validator'] },
                ms: { type: 'integer' },
                error: { type: 'string' },
              },
              required: ['stage', 'ms'],
            },
          },
        },
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
const CONTEXT_OUTPUT: DshToolOutput = {
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

/** Output of `story_brief`: the sections plus the same trace shape context uses. */
const BRIEF_OUTPUT: DshToolOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      chapter: { type: 'integer' },
      sections: {
        type: 'array',
        description: 'Brief sections in assembly order; absent sections carry empty content.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            title: { type: 'string' },
            source: { type: 'string' },
            sourceIds: { type: 'array', items: { type: 'string' } },
            content: { type: 'string' },
            bytes: { type: 'integer' },
            tokens: { type: 'integer' },
            absent: { type: 'boolean' },
            draft: { type: 'boolean' },
            fallback: { type: 'boolean' },
          },
          required: ['name', 'title', 'content', 'bytes', 'tokens'],
        },
      },
      budget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer' },
          used: { type: 'integer' },
          unit: { type: 'string', enum: ['tokens'] },
          overBudget: { type: 'boolean' },
        },
        required: ['limit', 'used', 'unit', 'overBudget'],
      },
      missing: { type: 'array', items: { type: 'string' } },
      dropped: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string' }, tokens: { type: 'integer' }, reason: { type: 'string' } },
          required: ['name', 'tokens', 'reason'],
        },
      },
      trace: OUTPUT_PROPERTIES.trace,
      error: OUTPUT_PROPERTIES.error,
    },
    required: ['ok'],
  },
  render: OUTPUT.render,
}

/**
 * The production loop. Write, review, and revise run only when the stage
 * machine says they are next; summarizing and settling are terminal steps with
 * their own preconditions (and a settled chapter may legitimately re-summarize).
 */
const NEXT_ACTION_GATES: Record<string, string> = {
  story_write: 'story_write',
  story_review: 'story_review',
  story_revise: 'story_revise',
}

/**
 * One action definition.
 * @param spec - name, description, parameters, execute.
 * @returns a registry-ready ToolDefinition.
 */
function action(spec: ActionSpec): ActionDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: spec.output ?? OUTPUT,
    mutates: spec.mutates === true,
    async execute(args: ModelArgs, exec: DshToolExecution) {
      if (spec.mutates === true && delegationDepthOf(exec) > 0) {
        return failureOf(new StoryError('subagent-cannot-land', DELEGATED_DENIAL))
      }
      const expected = NEXT_ACTION_GATES[spec.name]
      if (expected !== undefined && typeof args?.work === 'string') {
        // A rewrite/reopen is an explicit author intent about an existing draft,
        // not a step in the chain, so it skips the order check.
        const explicitRewrite = spec.name === 'story_write' && (args.rewrite === true || args.reopen === true)
        if (!explicitRewrite) {
          try {
            const step = await nextStepFor(workspaceOf(exec), args.work)
            if (step.action !== expected) {
              return failureOf(new StoryError(
                'not-next-action',
                `现在应做的是 ${step.action}（${step.reason ?? ''}）；${spec.name} 不在当前步骤上`,
              ))
            }
            if (spec.name === 'story_revise' && Array.isArray(step.blocked) && step.blocked.includes('revision-limit')) {
              return failureOf(new StoryError('revision-limit', step.reason ?? '已达修订上限，请作者裁决'))
            }
          } catch (error) {
            return failureOf(error)
          }
        }
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
function rawDefinitions(ctx: DshContext): ActionDefinition[] {
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
        const entry = readBibleEntry(root, result.workId, 'plan')
        return {
          ok: true,
          workId: result.workId,
          outline: result.outline,
          artifact: { workId: result.workId, artifactId: 'outline', revisionId: entry?.version ?? 'current', kind: 'outline' },
        }
      },
    }),

    action({
      name: 'story_approve',
      mutates: true,
      description: '记录作者对基础设定 / 全书计划 / 章纲的确认，来源记为 conversation。'
        + ' 只在作者明确说「确认 / 就按这个来」之后调用；面板上的按钮写同一事件，两者都会绑定内容指纹。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          kind: { type: 'string', enum: ['foundation', 'outline', 'plan'], description: '确认哪一项。' },
          chapter: { type: 'integer', description: 'kind=plan 时必填：第几章。' },
          reason: { type: 'string', description: '可选：作者原话片段，作为批准审计记录。' },
        },
        required: ['work', 'kind'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            workId: { type: 'string' },
            kind: { type: 'string' },
            source: { type: 'string', enum: ['conversation', 'panel'] },
          },
          required: ['ok', 'workId', 'kind', 'source'],
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const workId = String(args.work)
        const kind = String(args.kind)
        if (kind === 'foundation') {
          approveFoundation(root, { work: workId, source: 'conversation', ...(typeof args.reason === 'string' ? { reason: args.reason } : {}) })
          return { ok: true, workId, kind, source: 'conversation' }
        }
        if (kind === 'outline') {
          approveOutline(root, { work: workId, source: 'conversation', ...(typeof args.reason === 'string' ? { reason: args.reason } : {}) })
          return { ok: true, workId, kind, source: 'conversation' }
        }
        if (kind === 'plan') {
          if (args.chapter === undefined) throw new StoryError('chapter-required', '记录章纲确认需要 chapter')
          approveChapterPlan(root, { work: workId, chapter: args.chapter, source: 'conversation', ...(typeof args.reason === 'string' ? { reason: args.reason } : {}) })
          return { ok: true, workId, kind, source: 'conversation' }
        }
        throw new StoryError('invalid-kind', `未知的确认类型：${kind}`)
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
        return {
          ok: true,
          workId: args.work,
          artifact: { artifactId: result.artifact.artifactId, revisionId: result.artifact.revisionId, kind: result.artifact.kind },
        }
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
          budget: { type: 'integer', description: '可选：本次装配的 token 预算（估算值），缺省用角色默认。' },
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
        const loaded = await loadRoleInput(root, args as Parameters<typeof loadRoleInput>[1])
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
              sourceIds: context.trace.sections.find(entry => entry.name === item.name)?.sourceIds ?? [],
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
        const { warnings } = await checkDraft(root, args as Parameters<typeof checkDraft>[1])
        const result = await writeChapter(root, { ...args, requirePlanApproval: policy === 'required' } as Parameters<typeof writeChapter>[1])
        return {
          ok: true, workId: args.work, artifact: result.artifact, words: result.words,
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_review',
      mutates: true,
      description: '把审稿发现落盘成一轮 observation。只写审稿，绝不修改正文；每条含逐字引文、问题与修法。'
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
                quote: { type: 'string', description: '正文或章纲里的逐字引文。' },
                problem: { type: 'string', description: '问题是什么。' },
                fix: { type: 'string', description: '建议怎么改。' },
                severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
                resolves: { type: 'string', description: '可选：上一轮的 observation id；填了表示已解决。' },
              },
              required: ['quote', 'problem'],
            },
          },
        },
        required: ['work', 'chapter', 'problems'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: OUTPUT_PROPERTIES.ok,
            workId: OUTPUT_PROPERTIES.workId,
            artifact: OUTPUT_PROPERTIES.artifact,
            problems: {
              type: 'object',
              additionalProperties: false,
              properties: { total: { type: 'integer' }, open: { type: 'integer' } },
              required: ['total', 'open'],
            },
          },
          required: ['ok', 'workId', 'artifact', 'problems'],
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        const entry = manifest.chapters.find((item: any) => item.number === args.chapter)
        if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${args.chapter} 章`)
        const observations = args.problems.map((problem: any, index: number) => ({
          id: `O${index + 1}`,
          summary: problem.problem,
          evidence: [],
          category: 'quality',
          assessment: problem.resolves === undefined ? 'issue' : 'resolved',
          ...(problem.resolves === undefined ? {} : { resolves: problem.resolves }),
          ...(problem.severity === undefined ? {} : { severity: problem.severity }),
          ...(problem.fix === undefined ? {} : { fix: problem.fix }),
          sourceRefs: [{ sourceId: `chapter:${args.chapter}:r${entry.currentRevision}`, quote: problem.quote }],
        }))
        const result = await writeReview(root, { work: args.work, chapter: args.chapter, observations })
        return {
          ok: true,
          workId: args.work,
          artifact: { workId: args.work, artifactId: result.artifactId, revisionId: result.revisionId, kind: 'review' },
          problems: {
            total: observations.length,
            open: observations.filter((observation: any) => observation.assessment === 'issue').length,
          },
        }
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
        const { warnings } = await checkDraft(root, args as Parameters<typeof checkDraft>[1])
        const result = await reviseChapter(root, { ...args, requirePlanApproval: policy === 'required' } as unknown as Parameters<typeof reviseChapter>[1])
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
        return checkChapterState(root, args as Parameters<typeof checkChapterState>[1], {
          service,
          agent: exec.agent,
          signal: exec.signal,
        })
      },
    }),

    action({
      name: 'story_settle',
      mutates: true,
      description: '定稿本章：settler 从正文抽取事实与伏笔，先做确定性预检，再做语义对账；'
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
        return settleChapterState(root, args as Parameters<typeof settleChapterState>[1], {
          service,
          agent: exec.agent,
          signal: exec.signal,
        })
      },
    }),

    action({
      name: 'story_state',
      mutates: true,
      description: '把本章产生的 hook/fact 变化入账，并返回投影后的计数。'
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
          file: { type: 'string', enum: ['world', 'characters', 'style', 'intent'], description: '写哪一份。' },
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
      name: 'story_read',
      description: '只读：按 artifactId 读取已登记的作品内容（chapter/plan/review/summary/state/bible/outline/volume/role:<slug>/trace）。宿主校验作品与当前章作用域；不返回文件路径。角色卡按 slug 读，字段是卡合同（不含索引六字段）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          artifactId: { type: 'string', description: '如 chapter:1、plan:1、bible:characters、role:<slug>（如 role:jia）。' },
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
        if (kind === 'chapter' || kind === 'review' || kind === 'trace') {
          if (!Number.isInteger(chapterNumber) || chapterNumber !== latest) {
            throw new StoryError('artifact-not-readable', `只能读当前章 ${latest}；旧章请用 story_brief 的摘要`)
          }
        }
        if (kind === 'trace') {
          if (parts.length !== 2) throw new StoryError('artifact-not-readable', 'trace 的 artifactId 形如 trace:1:writer')
          const read = readArtifact(root, {
            work: workId,
            artifactId: id,
            ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
          })
          content = JSON.stringify(read.artifact.content, null, 2)
          ref = { ...ref, artifactId: id, revisionId: read.artifact.revisionId as string, kind: 'trace' }
        } else if (kind === 'outline') {
          const read = readTextArtifact(root, {
            work: workId,
            artifactId: 'outline',
            kind: 'outline',
            ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
          })
          content = String(read.artifact.content)
          // The store column is text even though its return type is the SQLite value union.
          ref = { ...ref, artifactId: 'outline', revisionId: read.artifact.revisionId as string, kind: 'outline' }
        } else if (kind === 'plan') {
          // Store reads return the artifact envelope, which only this branch unwraps.
          let memo: any
          try {
            memo = readChapterMemo(root, {
              work: workId,
              chapter: chapterNumber,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
          } catch (error) {
            // A thrown store error is a dynamic boundary: only its stable `code` is read.
            const code = storeErrorCodeOf(error)
            if (code === 'artifact-not-found' || code === 'chapter-not-found') {
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
          content = JSON.stringify({ observations: review.observations }, null, 2)
          ref = { ...ref, artifactId: review.artifactId, revisionId: review.revisionId, kind: 'review' }
        } else if (kind === 'summary') {
          // Store reads return the artifact envelope, which only this branch unwraps.
          let summary: any
          try {
            summary = readChapterSummary(root, {
              work: workId,
              chapter: chapterNumber,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
          } catch (error) {
            // A thrown store error is a dynamic boundary: only its stable `code` is read.
            const code = storeErrorCodeOf(error)
            if (code === 'artifact-not-found' || code === 'chapter-not-found') {
              throw new StoryError('summary-not-found', `第 ${chapterNumber} 章还没有摘要`)
            }
            throw error
          }
          content = JSON.stringify(summary.artifact.content, null, 2)
          ref = { ...ref, artifactId: `summary:${chapterNumber}`, revisionId: summary.artifact.revisionId, kind: 'summary' }
        } else if (kind === 'bible') {
          const file = parts.join(':')
          if (file === 'characters') {
            const entry = readBibleEntry(root, workId, file)
            content = entry?.content ?? ''
            ref = { ...ref, artifactId: `bible:${file}`, revisionId: entry?.version ?? 'current', kind: file }
          } else {
            const name = file === 'plan' ? 'plan' : file
            const expected = name === 'plan'
              ? { artifactId: 'outline', kind: 'outline' }
              : { artifactId: `bible:${name}`, kind: name }
            const read = readTextArtifact(root, {
              work: workId,
              ...expected,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
            content = String(read.artifact.content)
            ref = { ...ref, ...expected, revisionId: read.artifact.revisionId as string }
          }
        } else if (kind === 'role') {
          const slug = parts.join(':')
          try {
            const card = readRoleCard(root, {
              work: workId,
              slug,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
            content = JSON.stringify(card.artifact.content, null, 2)
            ref = { ...ref, artifactId: String(card.artifact.artifactId), revisionId: String(card.artifact.revisionId), kind: 'role_card' }
          } catch (error) {
            const code = storeErrorCodeOf(error)
            const slugs = listRoleCards(root, workId).map(item => String(item.artifactId).slice('role:'.length))
            // A deleted card has no rows at all, so even an explicit revision is "not found";
            // an existing card with a missing revision keeps the revision error.
            if (code === 'revision-not-found' && slugs.includes(slug)) throw error
            if (code !== 'artifact-not-found' && code !== 'revision-not-found') throw error
            throw new StoryError(
              'artifact-not-found',
              `没有角色卡：role:${slug}`,
              slugs.length === 0 ? '先跑角色卡阶段（架构师 roles/cards），再按 slug 读' : `已有角色卡：${slugs.join('、')}`,
            )
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
      description: '装配写这一章前的上下文：作者意图、故事框架、作品规则、本章章纲、当前焦点、涉及人物、未解伏笔、卷图、卷摘要、最近摘要、上一章结尾、文风、字数口径；已写 ≥3 章时追加相关素材。'
        + ' 故事框架与作品规则是硬约束，预算不足时不会被裁掉；其他段超预算会说明裁掉了哪几段。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '要写的章号。' },
          budget: { type: 'integer', description: '可选：本次装配的 token 预算（估算值），缺省用简报默认。' },
        },
        required: ['work', 'chapter'],
      },
      output: BRIEF_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        assertCurrentChapter(readManifest(root, args.work), Number(args.chapter))
        const brief = await assembleBriefFor(root, args.work, args.chapter, {
          ...(typeof args.budget === 'number' ? { budget: args.budget } : {}),
        })
        return { ok: true, workId: args.work, chapter: Number(args.chapter), sections: brief.sections, budget: brief.budget, missing: brief.missing, dropped: brief.dropped, trace: brief.trace }
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
        if (sessionCurrentOf(root, sessionOf(exec)) === String(args.work)) clearCurrent(sessionOf(exec))
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
        let manifest: ManifestView | undefined
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
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            workId: { type: 'string' },
            metrics: { type: 'object', additionalProperties: true },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', enum: ['word-range', 'repeated-sentence', 'ai-phrase', 'person-consistency', 'dialogue-ratio'] },
                  severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
                  detail: { type: 'string' },
                  refs: { type: 'array', items: { type: 'string' } },
                  quote: { type: 'string' },
                },
                required: ['code', 'severity', 'detail', 'refs'],
              },
            },
          },
          required: ['ok', 'workId', 'metrics', 'findings'],
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        const current = await readChapter(root, { work: args.work, chapter: args.chapter })
        const metrics = critique(current.content, manifest.wordRange)
        let perspective = ''
        try {
          const stored = readArtifact(root, { work: args.work, artifactId: `plan:${args.chapter}` })
          const memo = stored.artifact.content as { perspective?: unknown } | undefined
          perspective = typeof memo?.perspective === 'string' ? memo.perspective : ''
        } catch (error) {
          if ((error as { code?: unknown })?.code !== 'artifact-not-found') throw error
          perspective = ''
        }
        return { ok: true, workId: args.work, metrics, findings: findingsOf(String(current.content ?? ''), metrics, perspective) }
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
      description: '宿主侧委派一个角色完成单步：writer 写首版正文、reviewer 审稿并落清单、reviser 按未处理条目修订、summarizer 写本章摘要、'
        + 'architect 按 stage 生成基础设定（frame/rules/roles/cards），planner 写首次章纲。'
        + ' 主编只收回执（版本/字数/审稿计数/警告/阶段），不接触正文与上下文；子代理通过 story_submit 提交，失败返回 delegation-no-submission。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号；architect 不需要。' },
          role: { type: 'string', enum: ['writer', 'reviewer', 'reviser', 'summarizer', 'architect', 'planner'], description: '本次要跑的角色。' },
          stage: { type: 'string', enum: ['frame', 'rules', 'roles', 'cards'], description: 'architect 的阶段；其他角色忽略。' },
          instruction: { type: 'string', description: '作者本轮要求，会并入子代理任务。' },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '仅 reviser 使用；缺省 patch。',
          },
        },
        required: ['work', 'role'],
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
      description: '查询这部作品下一步该做什么：动作名、章号、原因、缺什么（章纲/审稿/条目 id/foundation stage）与 blocked。'
        + ' blocked 非空表示必须等作者在面板动作（全书计划/章纲/基础设定确认），此时不要执行 action，也不要委派。'
        + ' 返回 delegate 时优先用 story_delegate（writer/reviewer/reviser/summarizer/architect/planner）；没有 delegate 时按 action 走手动路径。'
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
 * @returns action definitions.
 */
function definitions(ctx: DshContext): ActionDefinition[] {
  return rawDefinitions(ctx).map(withCurrentWork)
}

/**
 * Make `work` optional on one action and resolve it from the session.
 *
 * An explicit `work` still wins, so callers that know the id are unaffected; the
 * schema stops requiring it so a session pointed at a work can omit it.
 * @param definition - registered action definition.
 * @returns the same definition with a wrapped execute.
 */
function withCurrentWork(definition: ActionDefinition): ActionDefinition {
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
 * @param ctx - plugin context.
 * @param session - calling session.
 * @returns root session.
 */
function rootSessionOf(ctx: DshContext, session: DshSession): DshSession | undefined {
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
 * @param ctx - plugin context.
 * @param session - calling session.
 * @returns absolute directory.
 */
function workingDirectoryOf(ctx: DshContext, session: DshSession): string | undefined {
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
 * @param ctx - plugin context.
 * @param exec - pending tool call.
 * @returns denial copy.
 */
function scopeDenialOf(ctx: DshContext, exec: DshToolExecution): string | undefined {
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
 * @param ctx - plugin context (services: tools).
 */
export function apply(ctx: DshContext): void {
  // The guard lives in this preset's scope, so it applies to the main agent and
  // to every subagent spawned into the same composition; the depth predicate
  // keeps the main agent unrestricted.
  const denyDelegatedWrites = (exec: DshToolExecution) => (
    delegationDepthOf(exec) > 0 && DELEGATED_DENIED_TOOLS.has(exec.name as string) ? DELEGATED_DENIAL : undefined
  )
  const denyOutOfScope = (exec: DshToolExecution) => scopeDenialOf(ctx, exec)
  const disposers = [
    ctx.tools.guard(denyDelegatedWrites),
    ctx.tools.guard(denyOutOfScope),
    ...definitions(ctx).map(definition => ctx.tools.register(definition)),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}

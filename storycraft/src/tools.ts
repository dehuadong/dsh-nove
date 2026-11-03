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
  StoryError, createBackup, deleteWork, exportWork, initWork, nextStep as nextStepFor, 
  approveFoundation, approveOutline, approveChapterPlan, finalizeChapter, markStateDraftReady, mergeStateDraft,
  planApprovalPolicy,
  latestReview, readBibleEntry, readChapter, readChapterHistory, readEvents, readEventsText, readManifest, readPlan, readSessionCurrent,
  readStateDraft, readSummaryState,
  reopenChapter as reopenChapterFor, renameWork, restoreWork, reviseChapter, setSessionCurrent,
  status as readStatus, updateSettings, workIdOf, writeChapter, writeOutline as writeOutlineFor, writePlan, writeReview,
} from './storage.ts'
import { listRoleCards, readArtifact, readChapterMemo, readChapterSummary, readFoundationDocument, readRoleCard, readTextArtifact, renderFoundationContent } from './artifact-store.ts'
import {
  assembleBrief as assembleBriefFor, readBible as readBibleEntries,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from './bible/index.ts'
import { readVolumes, writeVolume } from './volumes.ts'
import { critique, findingsOf } from './critique.ts'
import { loadRoleInput } from './runtime/role-input.ts'
import { delegateRole } from './runtime/delegate-runner.ts'
import { checkChapterState } from './state-check.ts'
import { settleChapterState } from './state-settle.ts'
import { submitPayload } from './runtime/submission.ts'
import { FOUNDATION_PHASES, FOUNDATION_STAGES } from './roles/architect/contract.ts'
import { DELEGATE_ROLES } from './roles/registry.ts'
import { checkDraft } from './landing.ts'
import { clearCurrent, getCurrent, hydrate as hydrateCurrent, markHydrated, resolveWork, setCurrent, shouldHydrate } from './current.ts'
import { scanWork, scanWorkspace } from './recovery.ts'
import { join } from 'node:path'
import { createProposal, markProposalUsed, readProposal } from './proposals.ts'
import { SCOPE_MESSAGES, scopeDenial } from './scope.ts'

/**
 * A JSON Schema node as this module writes it.
 *
 * Schemas are data the registry reads; nested members stay loose so shared
 * fragments can be spread without redeclaring the whole subset.
 */

/**
 * The session that owns one tool call.
 *
 * The tool runtime exposes the calling agent, whose `id` is the session id; the
 * positional `sessionId` is kept as a fallback for tests and older callers.
 * @param exec - tool run context.
 * @returns session identity.
 */
import { rawDefinitions } from './tools/actions/index.ts'
export function sessionOf(exec: DshToolExecution): string | undefined {
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
export function delegationDepthOf(exec: DshToolExecution): number {
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
import type {
  SchemaNode,
  ModelArgs,
  ArtifactRef,
  FailureEnvelope,
  ManifestView,
  ActionSpec,
  ActionDefinition,
} from './tools/types.ts'

import { failureOf, inject, name, storeErrorCodeOf } from './tools/registry.ts'
export { failureOf, inject, name } from './tools/registry.ts'

/** Workspace directory for one call. */
export function workspaceOf(exec: DshToolExecution): string {
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
export function sessionCurrentOf(root: string, sessionId: string | undefined): string | undefined {
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

/** Contract shape of a retrieval record inside a trace. */
const TRACE_RETRIEVAL: SchemaNode = {
  type: 'object',
  additionalProperties: false,
  description: 'FTS retrieval record: the query and the candidates that were selected.',
  properties: {
    engine: { type: 'string', enum: ['sqlite-fts5-bm25', 'sqlite-fts5-bm25+host-lexical'] },
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
          location: { type: 'string' },
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
    skills: {
      type: 'array',
      description: '宿主装配时要求角色加载的技能与内容 revision；不代表子代理已实际加载。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          revision: { type: 'string' },
          stage: { type: 'string', enum: ['settler', 'validator'] },
        },
        required: ['id', 'revision'],
      },
    },
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
export const OUTPUT_PROPERTIES: SchemaNode = {
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
  hasMore: { type: 'boolean', description: 'Whether more lines remain after endLine.' },
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
      calls: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          totalDurationMs: { type: 'integer' },
          totalTokens: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          callsWithUsage: { type: 'integer' },
          callsPartial: { type: 'integer' },
          callsWithoutUsage: { type: 'integer' },
          usageComplete: { type: 'boolean' },
          byRole: { type: 'object', additionalProperties: true },
        },
        required: ['count', 'totalDurationMs', 'totalTokens', 'callsWithUsage', 'callsPartial', 'callsWithoutUsage', 'usageComplete', 'byRole'],
      },
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
export function assertCurrentChapter(manifest: ManifestView, chapter: number | undefined): void {
  const latest = manifest.chapters.length === 0 ? 0 : manifest.chapters[manifest.chapters.length - 1].number
  if (chapter !== undefined && Number.isFinite(chapter) && chapter < latest) {
    throw new StoryError('artifact-not-readable', `只能读当前章 ${latest}；旧章请用 story_brief 的摘要`)
  }
}

/** Short content hash used as a stable upsert revision. */
export function contentRevision(text: unknown): string {
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
export const OUTPUT: DshToolOutput = {
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
export const NEXT_OUTPUT: DshToolOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...OUTPUT_PROPERTIES,
      foundationStage: { type: 'string', enum: [...FOUNDATION_STAGES] },
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
          role: { type: 'string', enum: [...DELEGATE_ROLES] },
          stage: { type: 'string', enum: [...FOUNDATION_STAGES] },
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
export const STATE_PAYLOAD_PROPERTIES: SchemaNode = {
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
      phase: { type: 'string', enum: [...FOUNDATION_PHASES] },
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
export const DELEGATE_OUTPUT: DshToolOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: OUTPUT_PROPERTIES.ok,
      workId: OUTPUT_PROPERTIES.workId,
      chapter: OUTPUT_PROPERTIES.chapter,
      role: { type: 'string', enum: [...DELEGATE_ROLES] },
      stage: OUTPUT_PROPERTIES.stage,
      foundationStage: { type: 'string', enum: [...FOUNDATION_STAGES] },
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
              hooks: { type: 'boolean' },
              roles: { type: 'boolean' },
              cards: { type: 'boolean' },
            },
            required: ['frame', 'rules', 'hooks', 'roles', 'cards'],
          },
          complete: { type: 'boolean' },
          writtenAt: { type: 'string' },
          nextStage: { type: 'string', enum: ['frame', 'rules', 'hooks', 'roles', 'cards'] },
          dispatchStage: { type: 'string', enum: ['foundation'] },
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
      durationMs: { type: 'integer' },
      usage: { type: 'object', additionalProperties: true },
      retries: { type: 'integer' },
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
export const STATE_CHECK_OUTPUT: DshToolOutput = {
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
          skills: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                revision: { type: 'string' },
                stage: { type: 'string', enum: ['settler', 'validator'] },
              },
              required: ['id', 'revision'],
            },
          },
          usage: { type: 'object', additionalProperties: true },
        },
        required: ['durationMs', 'submissionAttempts', 'skills'],
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
export const STATE_SETTLE_OUTPUT: DshToolOutput = {
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
      appended: { type: 'integer' },
      seq: { type: 'integer' },
      hooks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      facts: { type: 'array', items: { type: 'object', additionalProperties: true } },
      draft: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string' },
          revisionId: { type: 'string' },
          revision: { type: 'integer' },
          ready: { type: 'boolean' },
        },
        required: ['artifactId', 'revisionId', 'revision', 'ready'],
      },
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
          skills: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                revision: { type: 'string' },
                stage: { type: 'string', enum: ['settler', 'validator'] },
              },
              required: ['id', 'revision'],
            },
          },
          usage: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
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
        required: ['durationMs', 'skills'],
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
export const CONTEXT_OUTPUT: DshToolOutput = {
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
export const BRIEF_OUTPUT: DshToolOutput = {
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
export function action(spec: ActionSpec): ActionDefinition {
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
  if (definition.name === 'story_current' || definition.name === 'story_recover') return definition
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

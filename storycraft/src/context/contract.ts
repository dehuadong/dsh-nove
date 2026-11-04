/** Context contract: budgets, authority and the shapes the composer returns. */

/**
 * Role-scoped context assembly.
 *
 * A sub-agent never receives "the brief". It receives the sections its role needs,
 * each marked protected (never trimmed) or compressible (trimmed when the budget
 * is tight), plus a whitelist summary the caller validates against. The trace
 * records what was sent, what was shortened, and what was dropped.
 *
 * Every section source is a virtual `works/<workId>/...` path: the content lives
 * in the work database, not in files.
 */

import { deriveWhitelist, summariseWhitelist } from '../facts.ts'
import { roleSkills, skillReferenceScope } from '../skill-routing.ts'
import { skillEvidence, type SkillEvidence } from '../skill-evidence.ts'
import { listRoleCards, readFoundationDocuments, renderFoundationContent } from '../artifact-store.ts'
import {
  StoryError, chapterNumber, chapterStem, formOf, planApprovalPolicy, sourceIdOf, unitOf,
} from '../domain.ts'
import {
  readBibleMap, readChapter as readChapterRow, readFoldedState, readManifest, readPlan, readPlanMemo,
  readVolumes, readSummaryState, searchMemory, virtualPath,
} from '../storage.ts'
import { buildQuery, select, snippetFor } from '../retrieval.ts'
import { searchSkillReferences } from '../skill-search.ts'
import { searchTokens } from '../search-text.ts'
import { accountOf } from '../accounting.ts'

/** Default budget for one role context, in estimated tokens. */

export const DEFAULT_CONTEXT_BUDGET = 8000

/** Per-section caps for compressible sections, in estimated tokens. */
export const SECTION_CAPS: Record<string, number> = {
  state: 600,
  recent: 1000,
  retrieval: 800,
  style: 400,
  characters: 600,
  volumeMap: 800,
}

/** Section order used when trimming: earlier compressible sections go first. */
export const TRIM_ORDER = ['retrieval', 'recent', 'state', 'characters', 'volumeMap', 'style']

/** Roles one context can be assembled for. */
export type Role = 'writer' | 'planner' | 'reviewer' | 'reviser' | 'summarizer'

/** How the budget treats one section. */
export type SectionProtection = 'protected' | 'compressible'

/** Fixed authority order per role. */
export const AUTHORITY: Record<Role, string> = {
  writer: [
    '权威顺序：作者本轮要求 > 本章章纲 > 既成事实与禁令 > 卷纲兜底。',
    '章纲里写的必须落地；上下文里没有的人名、地名、数字不得自造。',
  ].join('\n'),
  planner: [
    '权威顺序：作者本轮要求 > 全书计划与卷图 > 最近脉络。',
    '只能引用上下文里存在的人物、卷与伏笔；不得发明新的设定名词。',
  ].join('\n'),
  reviewer: [
    '权威顺序：作品真值与事件日志 > 本章正文 > 章纲。',
    '只按你读到的内容判断；正文缺失或被截断时判「审稿不可用」。',
  ].join('\n'),
  reviser: [
    '权威顺序：点名条目与模式 > 未被点名的正文 > 章纲。',
    '只改点名位置；不得引入上下文里没有的人名、地名与数字。',
  ].join('\n'),
  summarizer: [
    '权威顺序：本章正文 > 人物与状态。',
    '只写正文里能核实的事实与状态变化；不评价、不补设定、不写下一章计划。',
  ].join('\n'),
}

/** One standards segment and the skill it summarises. */
export interface StandardSegment {
  source: string
  content: string
}

/** Standards segments, summarised from the role skills. */
export const STANDARDS: Record<'reviewer' | 'reviser', StandardSegment> = {
  reviewer: {
    source: 'storycraft-review',
    content: [
      '审稿看四件事：事件是否推进、人物动机是否成立、信息是否自洽、结尾是否留下未解。',
      '每条给出位置、问题、读者影响、严重度与建议模式（patch/polish/rewrite/deslop）；最多 8 条，按严重度排序。',
      '不要把风格偏好写成问题；没有问题的章节就少写条目。',
    ].join('\n'),
  },
  reviser: {
    source: 'storycraft-revise-craft',
    content: [
      'patch：只改点名条目涉及的位置，字数变化不超过两成；',
      'polish：润色措辞，情节与信息不变；rewrite：按条目重写整章；deslop：去掉空转与套话。',
      '未点名的段落保持原样；不得借修订引入新人名、地名与尺寸。',
    ].join('\n'),
  },
}

/** One review already on record, as the context reads it. */
export interface ContextReview {
  round?: number
  revision?: number
  open?: Array<{ id: string, problem: string }>
}

/** Assembly input. */
export interface RoleContextInput {
  /** workspace directory. */
  root: string
  /** work identity. */
  work: string
  /** chapter number; optional for work-scoped planning. */
  chapter?: number | string
  /** role name. */
  role: Role
  /** author instruction for this run. */
  instruction?: string
  /** task text composed by the calling action. */
  task?: string
  /** chapter body (reviewer/reviser/summarizer paths). */
  body?: string
  /** planning scope. */
  scope?: 'work' | 'chapter'
  /** character budget. */
  budget?: number
  /** latest review, when the calling action already read one. */
  review?: ContextReview
  /** revision mode (reviser path). */
  mode?: string
}

/** Injectable store reads, used by tests to exercise fail-open retrieval. */
export interface ContextDependencies {
  searchMemory?: typeof searchMemory
  searchSkills?: typeof searchSkillReferences
}

/** One section record. */
export interface ContextSection {
  name: string
  title: string
  content: string
  protection: SectionProtection
  source: string
}

/** One section after budgeting: `trimmed` marks the compressed ones. */
export interface TracedSection extends ContextSection {
  trimmed: boolean
}

/** One retrieval candidate as the contract reports it. */
export interface TraceRetrievalCandidate {
  id: string
  kind: string
  source: string
  location?: string
  score: number
}

/** Retrieval record in the artifact contract's trace shape. */
export interface TraceRetrieval {
  engine: 'sqlite-fts5-bm25' | 'sqlite-fts5-bm25+host-lexical'
  query: string
  selectionMode: 'complete'
  candidates: TraceRetrievalCandidate[]
  semanticSelectedIds: string[]
}

/** One section as the trace reports it. */
export interface TraceSection {
  name: string
  protection: SectionProtection
  sourceIds: string[]
  chars: number
  tokens: number
  dropped?: true
  trimmed?: true
  reason?: string
}

/** What the assembly sent, shortened and dropped, in the contract's trace shape. */
export interface ContextTrace {
  chapter?: number
  skills: SkillEvidence[]
  plannerInputs: string[]
  composerInputs: string[]
  selectedSources: string[]
  contextTiers: { protectedSources: string[], compressibleSources: string[] }
  tokenBudget: { protectedTokens: number, compressibleTokens: number, totalSelectedTokens: number }
  retrieval?: TraceRetrieval
  notes: string[]
  trimmed: string[]
  dropped: string[]
  budget: { limit: number, used: number, unit: 'tokens' }
  sections: TraceSection[]
  missing: Array<{ name: string, reason: string }>
  overflow: boolean
}

/** The assembled context package. */
export interface RoleContext {
  sections: TracedSection[]
  text: string
  trace: ContextTrace
  whitelist: ReturnType<typeof summariseWhitelist>
  taskText: string
}

/** Character view this module renders: one role card. */
export interface CharacterView {
  name?: string
  tier?: string
  role?: string
  limit?: string
  voice?: string
  markdown?: string
}

/** Chapter fields this module reads from the manifest. */
export interface ContextChapter {
  number: number
  currentRevision?: number
  planApproved?: boolean
}

/** Manifest fields this module reads; the manifest itself comes from the store. */
export interface ContextManifest {
  workId: string
  chapters: ContextChapter[]
  wordRange?: { min: number, max: number }
}

/** One folded event hook. */
export interface FoldedHook {
  hookId: string
  status: string
  text: string
  startChapter: number
  lastAdvancedChapter: number
}

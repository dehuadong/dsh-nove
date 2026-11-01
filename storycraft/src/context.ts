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

import { deriveWhitelist, readCards, summariseWhitelist } from './facts.ts'
import { roleSkills, skillReferenceScope } from './skill-routing.ts'
import { skillEvidence, type SkillEvidence } from './skill-evidence.ts'
import { listRoleCards, readFoundationDocuments, renderFoundationContent } from './artifact-store.ts'
import {
  StoryError, chapterNumber, chapterStem, formOf, planApprovalPolicy, sourceIdOf, unitOf,
} from './domain.ts'
import {
  readBibleMap, readChapter as readChapterRow, readFoldedState, readManifest, readPlan, readPlanMemo,
  readVolumes, readSummaryState, searchMemory, virtualPath,
} from './store-db.ts'
import { buildQuery, select, snippetFor } from './retrieval.ts'
import { searchSkillReferences } from './skill-search.ts'
import { searchTokens } from './search-text.ts'
import { accountOf } from './accounting.ts'

/** Default budget for one role context, in estimated tokens. */
export const DEFAULT_CONTEXT_BUDGET = 8000

/** Per-section caps for compressible sections, in estimated tokens. */
const SECTION_CAPS: Record<string, number> = {
  state: 600,
  recent: 1000,
  retrieval: 800,
  style: 400,
  characters: 600,
  volumeMap: 800,
}

/** Section order used when trimming: earlier compressible sections go first. */
const TRIM_ORDER = ['retrieval', 'recent', 'state', 'characters', 'volumeMap', 'style']

/** Roles one context can be assembled for. */
type Role = 'writer' | 'planner' | 'reviewer' | 'reviser' | 'summarizer'

/** How the budget treats one section. */
type SectionProtection = 'protected' | 'compressible'

/** Fixed authority order per role. */
const AUTHORITY: Record<Role, string> = {
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
interface StandardSegment {
  source: string
  content: string
}

/** Standards segments, summarised from the role skills. */
const STANDARDS: Record<'reviewer' | 'reviser', StandardSegment> = {
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
interface ContextReview {
  round?: number
  revision?: number
  open?: Array<{ id: string, problem: string }>
}

/** Assembly input. */
interface RoleContextInput {
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
interface ContextDependencies {
  searchMemory?: typeof searchMemory
  searchSkills?: typeof searchSkillReferences
}

/** One section record. */
interface ContextSection {
  name: string
  title: string
  content: string
  protection: SectionProtection
  source: string
}

/** One section after budgeting: `trimmed` marks the compressed ones. */
interface TracedSection extends ContextSection {
  trimmed: boolean
}

/** One retrieval candidate as the contract reports it. */
interface TraceRetrievalCandidate {
  id: string
  kind: string
  source: string
  location?: string
  score: number
}

/** Retrieval record in the artifact contract's trace shape. */
interface TraceRetrieval {
  engine: 'sqlite-fts5-bm25' | 'sqlite-fts5-bm25+host-lexical'
  query: string
  selectionMode: 'complete'
  candidates: TraceRetrievalCandidate[]
  semanticSelectedIds: string[]
}

/** One section as the trace reports it. */
interface TraceSection {
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
interface ContextTrace {
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
interface RoleContext {
  sections: TracedSection[]
  text: string
  trace: ContextTrace
  whitelist: ReturnType<typeof summariseWhitelist>
  taskText: string
}

/** Character view this module renders: a role card in long-form, else bible.characters. */
interface CharacterView {
  name?: string
  tier?: string
  role?: string
  limit?: string
  voice?: string
  markdown?: string
}

/** Chapter fields this module reads from the manifest. */
interface ContextChapter {
  number: number
  currentRevision?: number
  planApproved?: boolean
}

/** Manifest fields this module reads; the manifest itself comes from the store. */
interface ContextManifest {
  workId: string
  chapters: ContextChapter[]
  wordRange?: { min: number, max: number }
}

/** One folded event hook. */
interface FoldedHook {
  hookId: string
  status: string
  text: string
  startChapter: number
  lastAdvancedChapter: number
}

/** Read hook IDs from the structured chapter-plan memo. */
function threadRefsOf(memo: any): { ids: string[], invalid: string[] } {
  if (!Array.isArray(memo?.threadRefs)) return { ids: [], invalid: [] }
  const ids: string[] = []
  const invalid: string[] = []
  for (const raw of memo.threadRefs) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      invalid.push(String(raw))
      continue
    }
    const id = raw.trim()
    if (!ids.includes(id)) ids.push(id)
  }
  return { ids, invalid }
}

/** One folded event fact. */
interface FoldedFact {
  subject: string
  predicate: string
  object: string
  validUntilChapter: number | null
}

/** The folded event projection, owned by the store. */
interface FoldedState {
  hooks: FoldedHook[]
  facts: FoldedFact[]
}

/** One summary state row; `text` is set whenever `state` is `current`. */
interface SummaryStateRow {
  state: 'current' | 'stale' | 'missing'
  text: string
  revision: number | null
  currentRevision: number
}

/** Read one summary state; the store types `text` loosely for missing summaries. */
function summaryStateOf(root: string, work: string, chapter: number): SummaryStateRow {
  // Dynamic boundary: `text` is absent only outside `current`, which this module
  // never reads; every other field is carried through unchanged.
  return readSummaryState(root, work, chapter) as SummaryStateRow
}

/** One section record. */
function section(
  name: string,
  title: string,
  // Callers hand in strings or an absent value; content is normalised below.
  content: unknown,
  protection: SectionProtection,
  source: string,
): ContextSection {
  return { name, title, content: String(content ?? '').trim(), protection, source }
}

/**
 * Assemble the context one role needs.
 */
export async function assembleRoleContext(
  input: RoleContextInput,
  dependencies: ContextDependencies = {},
): Promise<RoleContext> {
  const { root, role } = input
  const retrieve = typeof dependencies.searchMemory === 'function' ? dependencies.searchMemory : searchMemory
  const retrieveSkills = typeof dependencies.searchSkills === 'function' ? dependencies.searchSkills : searchSkillReferences
  const scope = input.scope === 'work' ? 'work' : 'chapter'
  const manifest: ContextManifest = readManifest(root, input.work)
  const work = manifest.workId
  const number = scope === 'work' ? undefined : chapterNumber(input.chapter)
  const entry = number === undefined ? undefined : manifest.chapters.find(item => item.number === number)
  if (scope === 'chapter' && role !== 'planner' && entry === undefined) {
    throw new StoryError('chapter-not-found', `没有第 ${number} 章：先写章纲再派活`)
  }
  const form = formOf(manifest)
  const unit = unitOf(form)
  const needsPlan = role === 'writer' || role === 'reviewer' || role === 'reviser'

  const chapterPlan: string | undefined = entry === undefined ? undefined : readPlan(root, work, entry.number)
  const planMemo = entry === undefined ? undefined : readPlanMemo(root, work, entry.number)
  if (needsPlan && chapterPlan === undefined) {
    throw new StoryError('plan-not-found', `第 ${number} 章还没有章纲：先 story_plan，再派活`)
  }

  // Stop before a writer/reviser is dispatched: an unconfirmed plan means no draft/revision yet.
  if ((role === 'writer' || role === 'reviser') && planApprovalPolicy(manifest) === 'required'
    && entry !== undefined && entry.planApproved !== true) {
    throw new StoryError('plan-not-approved',
      `第 ${number} 章章纲还没经作者确认：请在面板「章纲」里点「确认章纲」，再取写手上下文`)
  }

  const foundation = readFoundationDocuments(root, work)
  const cardRows = listRoleCards(root, work)
  const useRoleCards = formOf(manifest) === 'longform' && cardRows.length > 0
  const characters: CharacterView[] = useRoleCards
    ? cardRows.map(row => row.content).filter(card => card !== null && typeof card === 'object').map((card: any) => ({
      name: String(card.name ?? ''),
      tier: String(card.tier ?? ''),
      limit: String(card.limits ?? ''),
      markdown: String(card.markdown ?? ''),
    }))
    : (await readCards(root, work)) ?? []
  const storyFrameText: string = renderFoundationContent(foundation.storyFrame?.content)
  const bookRulesText: string = renderFoundationContent(foundation.bookRules?.content)
  const volumeMapText: string = renderFoundationContent(foundation.volumeMap?.content)
  const focusText: string = renderFoundationContent(foundation.currentFocus?.content)
  if (characters.length === 0 && role !== 'planner' && role !== 'summarizer') {
    throw new StoryError('bible-missing', useRoleCards
      ? '人物卡缺失：先跑基础设定 roles/cards'
      : '人物卡缺失：先用 story_bible_write 建 bible/characters.json 再派活')
  }

  const body = String(input.body ?? '').trim()
  if ((role === 'reviewer' || role === 'reviser' || role === 'summarizer') && body === '') {
    throw new StoryError('chapter-not-written', `第 ${number} 章还没有正文：先写正文，再审稿、修订或写摘要`)
  }

  const bible = readBibleMap(root, work)
  const intent: string = bible.get('intent') ?? ''
  const planText: string = bible.get('plan') ?? ''
  const volumes = readVolumes(root, work)
  const volumeTitles = volumes
    .map(volume => `- ${volume.title}（第 ${volume.from}–${volume.to} 章）${volume.summary === undefined || volume.summary === '' ? '' : `：${volume.summary}`}`)
    .join('\n')

  // 1. authority — protected
  const authority = section('authority', '权威顺序', AUTHORITY[role] ?? AUTHORITY.writer, 'protected', 'storycraft/context.js')

  // 2. task — protected; the action composes it, the author instruction joins it
  const instruction = String(input.instruction ?? '').trim()
  const review = input.review ?? {}
  const openItems = Array.isArray(review.open) ? review.open : []
  let taskText = String(input.task ?? '').trim()
  if (role === 'reviewer') {
    taskText = [`审第 ${number} 章。`, ...openItems.map(item => `- ${item.id}：${item.problem}`)].join('\n')
  } else if (role === 'reviser') {
    const mode = typeof input.mode === 'string' ? input.mode : 'patch'
    taskText = [`按条目修订第 ${number} 章，模式：${mode}。`, ...openItems.map(item => `- ${item.id}：${item.problem}`)].join('\n')
  } else if (role === 'writer') {
    taskText = `写第 ${number} 章正文。`
  } else if (role === 'summarizer') {
    taskText = `给第 ${number} 章写摘要：只写本章发生的事实与状态变化，≤400 字；不评价、不写下一章计划。`
  }
  if (taskText === '') throw new StoryError('task-required', '派发需要一句任务说明')
  const task = section('task', scope === 'work' ? '作品任务' : '本章任务', [
    instruction === '' ? '' : `作者要求：${instruction}`,
    role === 'writer' ? chapterPlan : taskText,
  ].filter(line => line !== '').join('\n'), 'protected', role === 'writer' ? 'outline + 本次要求' : '本次要求')

  // 3. constraints — protected
  const perspective = scope === 'work' || chapterPlan === undefined ? undefined : /- 视角：(.+)/u.exec(chapterPlan)?.[1]?.trim()
  const lead = characters.find(item => item?.name !== undefined && perspective !== undefined && perspective.includes(item.name))
  const constraintLines = [
    `形态：${form}（单位：${unit}）`,
    scope === 'work'
      ? ''
      : manifest.wordRange === undefined
        ? '字数：未设定（按作者习惯）'
        : `字数：单章 ${manifest.wordRange.min}–${manifest.wordRange.max} 字`,
    ...(lead === undefined ? [] : [
      `主角：${lead.name}`,
      ...(lead.limit === undefined || lead.limit === '' ? [] : [`行为边界：${lead.limit}`]),
      ...(useRoleCards || lead.voice === undefined ? [] : [`语气：${lead.voice}`]),
    ]),
    ...(intent.trim() === '' ? [] : ['本书口径（摘自意图文件）：', intent.trim().slice(0, 600)]),
    ...(role === 'planner' || storyFrameText === '' ? [] : ['故事框架：', storyFrameText.trim().slice(0, 1200)]),
    ...(role === 'planner' || bookRulesText === '' ? [] : ['作品规则：', bookRulesText.trim().slice(0, 1200)]),
  ].filter(line => line !== '')
  const constraints = role === 'summarizer'
    ? undefined
    : section('constraints', '硬约束', constraintLines.join('\n'), 'protected',
      useRoleCards
        ? `${virtualPath(work, 'manifest')} + ${virtualPath(work, 'foundation/roles')} + ${virtualPath(work, 'bible/intent.md')}`
        : `${virtualPath(work, 'manifest')} + ${virtualPath(work, 'bible/characters.json')} + ${virtualPath(work, 'bible/intent.md')}`)

  // 4. state — compressible
  const folded: FoldedState = readFoldedState(root, work)
  const openHooks = folded.hooks.filter(hook => ['open', 'progressing', 'deferred'].includes(hook.status))
  const factGroups = new Map<string, string[]>()
  for (const fact of folded.facts) {
    if (fact.validUntilChapter !== null) continue
    const list = factGroups.get(fact.subject) ?? []
    list.push(`${fact.predicate}：${fact.object}`)
    factGroups.set(fact.subject, list)
  }
  const stateLines = [
    ...(factGroups.size === 0 ? [] : [
      '人物事实：',
      ...[...factGroups].slice(0, 8).map(([subject, facts]) => `- ${subject}：${facts.slice(-3).join('；')}`),
    ]),
    ...(openHooks.length === 0 ? ['未解伏笔：无'] : [
      '未解伏笔：',
      ...openHooks.slice(0, 8).map(hook => `- ${hook.text}（${hook.status}，第 ${hook.startChapter} 章）`),
    ]),
  ]
  const state = section('state', '人物与状态', stateLines.join('\n'), 'compressible', virtualPath(work, 'state/events.jsonl'))

  // 5. recent — compressible; the summary stage reads only the current chapter and state.
  let recent: ContextSection | undefined
  const recentSummaryIds: string[] = []
  if (role !== 'summarizer') {
    const summaries: string[] = []
    const lastNumber = number ?? (manifest.chapters.length === 0 ? 1 : manifest.chapters[manifest.chapters.length - 1].number + 1)
    for (let index = Math.max(1, lastNumber - 3); index < lastNumber; index += 1) {
      const summary = summaryStateOf(root, work, index)
      if (summary.state === 'current') {
        summaries.push(`第 ${index} 章：${summary.text.trim()}`)
        recentSummaryIds.push(`summary:${index}`)
      }
    }
    if (lastNumber > 1) {
      let previousBody: string | undefined
      try {
        previousBody = readChapterRow(root, { work, chapter: lastNumber - 1 }).content
      } catch {
        previousBody = undefined
      }
      if (previousBody !== undefined) summaries.push(`上一章结尾：…${previousBody.trim().slice(-400)}`)
    }
    recent = section('recent', '最近脉络', summaries.join('\n'), 'compressible', `${virtualPath(work, 'summaries/')} + 上一章结尾`)
  }

  // 5b. retrieval — compressible; FTS candidates are already ranked by the store.
  const written = manifest.chapters.filter(chapter => Number(chapter.currentRevision) > 0).length
  const retrievalEnabled = role !== 'summarizer' && written >= 3
  const query = retrievalEnabled
    ? buildQuery({ taskText, chapterPlan, openHooks, instruction })
    : ''
  let retrieval: ContextSection | undefined
  let retrievalCandidates: TraceRetrievalCandidate[] | undefined
  const retrievalNotes: string[] = []
  let retrievalHasSentSkill = false
  if (query.trim() !== '') {
    try {
      const candidates = retrieve(root, work, query, number === undefined ? {} : { beforeChapter: number })
      const refs = threadRefsOf(planMemo)
      const directedState = number === undefined ? folded : readFoldedState(root, work, { beforeChapter: number })
      for (const invalid of refs.invalid) retrievalNotes.push(`章纲伏笔 ID 无效：${invalid}`)
      const referenced = new Set(refs.ids)
      const directHooks: any[] = []
      for (const [index, hookId] of refs.ids.entries()) {
        const hook = directedState.hooks.find((item: FoldedHook) => item.hookId === hookId)
        if (hook === undefined) {
          retrievalNotes.push(`章纲伏笔未找到：${hookId}`)
          continue
        }
        if (!['open', 'progressing', 'deferred'].includes(hook.status)) continue
        if (number !== undefined && hook.startChapter >= number) continue
        const advanced = Number(hook.lastAdvancedChapter)
        const suffix = number !== undefined && advanced < number ? `；最近推进第 ${advanced} 章` : ''
        directHooks.push({
          id: `hook:${hook.hookId}`,
          kind: 'hook',
          source: 'state',
          sourceIds: ['state'],
          chapter: hook.startChapter,
          text: `${hook.text}（建立第 ${hook.startChapter} 章${suffix}）`,
          score: -index,
          priority: 1,
        })
      }
      const memoryCandidates = candidates.filter(candidate => !(candidate.kind === 'hook' && referenced.has(candidate.hookId)))
      const allowed = skillReferenceScope(role, form)
      const references = Object.fromEntries(allowed.map(item => [item.skill, item.references]))
      const tokens = searchTokens(query).split(' ').filter(token => token !== '')
      let skillNote: string | undefined
      let skills: any[] = []
      try {
        skills = retrieveSkills(query, {
          skills: allowed.map(item => item.skill),
          references,
          onError: (error: unknown) => {
            const code = (error as { code?: unknown } | null | undefined)?.code
            skillNote = `技能检索警告：${typeof code === 'string' ? code : 'retrieval-failed'}`
          },
        }).map(hit => ({ ...hit, priority: 1, text: snippetFor(hit.text, tokens, 400) }))
      } catch (error) {
        const code = (error as { code?: unknown } | null | undefined)?.code
        skillNote = `技能检索警告：${typeof code === 'string' ? code : 'retrieval-failed'}`
      }
      if (skillNote !== undefined) retrievalNotes.push(skillNote)
      const picked = select([...memoryCandidates, ...directHooks, ...skills], { excludeIds: recentSummaryIds })
      const skillSent = picked.hits.some(hit => hit.sent === true && hit.kind === 'skill')
      retrievalHasSentSkill = skillSent
      if (picked.text !== '') {
        retrieval = section('retrieval', skillSent ? '相关参考' : '相关往事', picked.text, 'compressible',
          `${virtualPath(work, 'summaries/')} + ${virtualPath(work, 'state/events.jsonl')} + ${virtualPath(work, 'volumes')} + ${virtualPath(work, 'materials/')}`)
      }
      retrievalCandidates = picked.hits.map(hit => ({
        id: hit.id, kind: hit.kind,
        source: hit.kind === 'skill' ? (hit.source ?? '') : (hit.sourceIds[0] ?? hit.source ?? ''),
        score: hit.score,
        ...(hit.location === undefined ? {} : { location: hit.location }),
      }))
    } catch (error) {
      // A thrown store error is a dynamic boundary: only its stable `code` is read.
      const code = (error as { code?: unknown } | null | undefined)?.code
      retrievalCandidates = []
      retrievalNotes.push(`检索失败：${typeof code === 'string' ? code : 'retrieval-failed'}`)
    }
  }

  // 6. style — compressible
  const style = section('style', '文风要点', bible.get('style') ?? '', 'compressible', virtualPath(work, 'bible/style.md'))

  // planner-only: book plan, volume map and character cards
  const planSection: ContextSection | undefined = role === 'planner'
    ? section('plan', '全书计划与故事框架', [
      focusText === '' ? '' : `当前焦点：${focusText.trim()}`,
      planText === '' ? '（还没有全书计划）' : planText.trim(),
      storyFrameText === '' ? '' : `故事框架：\n${storyFrameText.trim()}`,
    ].filter(line => line !== '').join('\n'), 'protected', `${virtualPath(work, 'foundation')} + ${virtualPath(work, 'outline/plan.md')}`)
    : undefined
  const volumeMapSection: ContextSection | undefined = role === 'planner'
    ? section('volumeMap', '卷图', volumeMapText === '' ? volumeTitles : volumeMapText.trim(),
      'compressible', volumeMapText === '' ? virtualPath(work, 'volumes') : virtualPath(work, 'foundation/volume_map.md'))
    : undefined
  const characterBrief: ContextSection | undefined = role === 'planner'
    ? section('characters', '人物卡（节选）', (() => {
      const named = String(chapterPlan ?? '')
      const matched = characters.filter(item => item.name !== undefined && item.name !== '' && named.includes(item.name))
      const chosen = [...matched, ...characters.filter(item => !matched.includes(item))].slice(0, 6)
      return chosen.map(item => useRoleCards
        ? `- ${item.name}（${item.tier ?? ''}）：${String(item.markdown ?? '').replace(/\s+/gu, ' ').trim().slice(0, 300)}`
        : [
          `- ${item.name}：${item.role ?? ''}`,
          ...(item.limit === undefined ? [] : [`  边界：${item.limit}`]),
          ...(item.voice === undefined ? [] : [`  语气：${item.voice}`]),
        ].join('\n')).join('\n')
    })(), 'compressible', useRoleCards ? virtualPath(work, 'foundation/roles') : virtualPath(work, 'bible/characters.json'))
    : undefined

  // The plan feeds writer/reviewer/reviser; writer/reviewer/reviser/summarizer read the body.
  // `number` is defined whenever a chapter-plan section exists: work-scoped planning
  // never reaches `needsPlan`, which is writer/reviewer/reviser only.
  const chapterPlanSection = role === 'writer' ? undefined
    : needsPlan ? section('plan', '本章章纲', chapterPlan ?? '', 'protected', virtualPath(work, `outline/${chapterStem(number as number)}.plan.md`)) : undefined
  const bodySection = body === ''
    ? undefined
    : section('body', '待处理的正文', `---正文开始---\n${body}\n---正文结束---`, 'protected', virtualPath(work, 'chapters/'))
  const standard = role === 'reviewer' || role === 'reviser'
    ? section('standard', role === 'reviewer' ? '审稿标准' : '修订标准', STANDARDS[role].content, 'protected', STANDARDS[role].source)
    : undefined

  // Section order follows the role contract.
  const sections: ContextSection[] = [authority, task, ...(constraints === undefined ? [] : [constraints])]
  if (role === 'planner') {
    if (planSection !== undefined) sections.push(planSection)
    if (volumeMapSection !== undefined) sections.push(volumeMapSection)
    if (characterBrief !== undefined) sections.push(characterBrief)
  }
  if (chapterPlanSection !== undefined) sections.push(chapterPlanSection)
  if (bodySection !== undefined) sections.push(bodySection)
  sections.push(state)
  if (recent !== undefined) sections.push(recent)
  if (retrieval !== undefined) sections.push(retrieval)
  if (role === 'writer' || role === 'planner') sections.push(style)
  if (standard !== undefined) sections.push(standard)

  // Budget: cap the compressible sections, then trim by the fixed order.
  // Protected sections are never compressed or dropped; they only raise overflow.
  const requestedBudget = input.budget
  const limit = requestedBudget !== undefined && Number.isInteger(requestedBudget) && requestedBudget > 0
    ? requestedBudget
    : DEFAULT_CONTEXT_BUDGET
  const notes: string[] = ['tokens 为估算值（cjk 1:1，其它 4:1）']
  notes.push(...retrievalNotes)
  const missing: Array<{ name: string, reason: string }> = []
  const segments: TracedSection[] = sections.map(item => ({ ...item, trimmed: false }))
  for (const item of segments) {
    if (item.content === '') missing.push({ name: item.name, reason: '没有可用内容' })
  }
  const trimmed: string[] = []
  const dropped: string[] = []
  const tokensOf = (item: ContextSection): number => accountOf(item.content).tokens
  const totalTokens = (): number => segments.reduce((sum, item) => sum + tokensOf(item), 0)
  const charsFor = (tokens: number, content: string): number => {
    const account = accountOf(content)
    return account.tokens === 0 ? 0 : Math.floor(tokens * account.chars / account.tokens)
  }
  const compress = (item: TracedSection, allowedChars: number): void => {
    item.content = `${item.content.slice(0, Math.floor(allowedChars * 0.7))}\n…（已压缩）…\n${item.content.slice(-Math.floor(allowedChars * 0.25))}`
    item.trimmed = true
    if (!trimmed.includes(item.name)) trimmed.push(item.name)
  }
  const drop = (item: TracedSection): void => {
    item.content = ''
    // A section is either compressed or dropped, never both.
    const at = trimmed.indexOf(item.name)
    if (at >= 0) trimmed.splice(at, 1)
    if (!dropped.includes(item.name)) dropped.push(item.name)
  }

  for (const item of segments) {
    const cap = SECTION_CAPS[item.name]
    if (cap === undefined || item.protection !== 'compressible' || item.content === '') continue
    let allowed = charsFor(cap, item.content)
    while (tokensOf(item) > cap && allowed >= 80) {
      compress(item, allowed)
      allowed = Math.floor(allowed * 0.9)
    }
    if (tokensOf(item) > cap) drop(item)
  }
  for (const name of TRIM_ORDER) {
    if (totalTokens() <= limit) break
    const target = segments.find(item => item.name === name)
    if (target === undefined || target.protection !== 'compressible' || target.content === '') continue
    const allowed = charsFor(Math.max(0, limit - (totalTokens() - tokensOf(target))), target.content)
    if (allowed >= 80) compress(target, allowed)
    else drop(target)
    if (tokensOf(target) > 0 && totalTokens() > limit) drop(target)
  }
  const overflow = totalTokens() > limit
  if (overflow) notes.push('protected 段超出总预算：未压缩，仅标记 overflow')

  const sourceIdsOf = (source: string): string[] => source.split(' + ').map(part => part.trim()).filter(part => part !== '').map(part => sourceIdOf(work, part))
  const sent = segments.filter(item => item.content !== '')
  const protectedSegments = sent.filter(item => item.protection === 'protected')
  const compressibleSegments = sent.filter(item => item.protection === 'compressible')
  const trace: ContextTrace = {
    ...(number === undefined ? {} : { chapter: number }),
    skills: skillEvidence(roleSkills(role, form)),
    plannerInputs: role === 'planner' ? sent.flatMap(item => sourceIdsOf(item.source)) : [],
    composerInputs: role === 'writer' ? sent.flatMap(item => sourceIdsOf(item.source)) : [],
    selectedSources: sent.flatMap(item => sourceIdsOf(item.source)),
    contextTiers: {
      protectedSources: protectedSegments.flatMap(item => sourceIdsOf(item.source)),
      compressibleSources: compressibleSegments.flatMap(item => sourceIdsOf(item.source)),
    },
    tokenBudget: {
      protectedTokens: protectedSegments.reduce((sum, item) => sum + tokensOf(item), 0),
      compressibleTokens: compressibleSegments.reduce((sum, item) => sum + tokensOf(item), 0),
      totalSelectedTokens: totalTokens(),
    },
    ...(retrievalCandidates === undefined ? {} : {
      retrieval: {
        engine: sent.some(item => item.name === 'retrieval') && retrievalHasSentSkill
          ? 'sqlite-fts5-bm25+host-lexical' : 'sqlite-fts5-bm25',
        query,
        selectionMode: 'complete',
        candidates: retrievalCandidates,
        semanticSelectedIds: [],
      } satisfies TraceRetrieval,
    }),
    notes,
    trimmed,
    dropped,
    budget: { limit, used: totalTokens(), unit: 'tokens' },
    sections: segments.map(item => ({
      name: item.name,
      protection: item.protection,
      sourceIds: sourceIdsOf(item.source),
      chars: item.content.length,
      tokens: tokensOf(item),
      ...(dropped.includes(item.name) ? { dropped: true as const, reason: 'budget' } : {}),
      ...(item.trimmed === true && !dropped.includes(item.name) ? { trimmed: true as const } : {}),
    })),
    missing,
    overflow,
  }
  const text = segments
    .filter(item => item.content !== '')
    .map(item => `## ${item.title}\n${item.content}`)
    .join('\n\n')

  const whitelist = await deriveWhitelist(root, { work, ...(number === undefined ? {} : { chapter: number }) })
  return { sections: segments, text, trace, whitelist: summariseWhitelist(whitelist), taskText }
}

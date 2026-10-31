/**
 * Artifact contract v2: canonical shapes for story artifacts.
 *
 * This module is the single validation surface for the A0 contract. It does
 * not read or write a work database; stores and consumers validate at their
 * boundary with these functions.
 */

import { StoryError, STAGES, SUMMARY_FIELDS, WORK_FORMS } from './domain.ts'

/** Contract version carried by new works. */
export const ARTIFACT_CONTRACT_VERSION = 2

/** Artifact kinds that can appear in an envelope or artifact registry. */
export const ARTIFACT_KINDS = [
  'outline', 'plan', 'chapter', 'summary', 'review', 'state', 'context', 'trace',
  'world', 'style', 'intent', 'current_focus', 'story_frame', 'volume_map', 'book_rules',
  'role_index', 'role_card', 'state_draft', 'volume', 'material', 'export', 'backup',
  'short_story', 'script', 'storyboard', 'interactive_film', 'play_world', 'cover', 'translation',
]

/** Form-specific pipelines. Short/script do not share the longform stage machine. */
export const FORM_PIPELINES = {
  longform: ['foundation', 'plan', 'compose', 'write', 'review', 'revise', 'summary', 'settle'],
  short: ['outline', 'batch_draft', 'draft_review', 'revision_plan', 'package'],
  script: ['spec', 'script', 'episodes_scenes', 'review'],
}

/** Hook lifecycle states. */
export const HOOK_STATUSES = ['open', 'progressing', 'deferred', 'resolved', 'superseded']

/** Allowed hook transitions; the transition is applied by a hook op, never by upsert. */
export const HOOK_TRANSITIONS = {
  open: ['progressing', 'deferred', 'resolved', 'superseded'],
  progressing: ['deferred', 'resolved', 'superseded'],
  deferred: ['progressing', 'resolved', 'superseded'],
  resolved: ['superseded'],
  superseded: [],
}

export const OBSERVATION_CATEGORIES = ['execution', 'quality', 'scope']
export const OBSERVATION_ASSESSMENTS = ['issue', 'resolved', 'unavailable', 'observation']
export const OBSERVATION_SEVERITIES = ['blocking', 'major', 'minor']
export const REVISE_MODES = ['patch', 'polish', 'rewrite', 'deslop']
export const CHAPTER_STAGES = STAGES
export const ARTIFACT_PROVENANCE = ['generated', 'imported', 'edited']
export const SCRIPT_FORMATS = ['vertical_short_drama', 'screenplay', 'audio_drama', 'interactive_script', 'general_script']

export type ArtifactRecord = Record<string, any>

const ID_PATTERN = /^[a-z][a-z0-9_]*(?::[^\s:]+)*$/u

/** Throw one contract error with a stable code. */
function invalid(message: string, code = 'artifact-invalid'): never {
  throw new StoryError(code, message)
}

function object(value: any, label: string): any {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 必须是对象`)
  return value
}

function keys(value: any, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${label} 含未知字段：${key}`)
  }
}

function text(value: any, label: string, optional = false): any {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.trim() === '') invalid(`${label} 必须是非空字符串`)
  return value
}

function textAllowEmpty(value: any, label: string, optional = false): any {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') invalid(`${label} 必须是字符串`)
  return value
}

function integer(value: any, label: string, min = 0): any {
  if (!Number.isInteger(value) || value < min) invalid(`${label} 必须是 >= ${min} 的整数`)
  return value
}

function optionalInteger(value: any, label: string, min = 0): any {
  if (value === undefined) return undefined
  return integer(value, label, min)
}

function boolean(value: any, label: string): any {
  if (typeof value !== 'boolean') invalid(`${label} 必须是布尔值`)
  return value
}

function oneOf(value: any, allowed: readonly any[], label: string): any {
  if (!allowed.includes(value)) invalid(`${label} 只能是 ${allowed.join(' / ')}`)
  return value
}

function strings(value: any, label: string, { min = 0, max = Infinity } = {}): any {
  if (!Array.isArray(value)) invalid(`${label} 必须是数组`)
  if (value.length < min) invalid(`${label} 至少 ${min} 项`)
  if (value.length > max) invalid(`${label} 最多 ${max} 项`)
  for (const [index, item] of value.entries()) text(item, `${label}[${index}]`)
  return value
}

function list(value: any, label: string, validator: (value: any, label: string) => any, { min = 0, max = Infinity } = {}): any {
  if (!Array.isArray(value)) invalid(`${label} 必须是数组`)
  if (value.length < min) invalid(`${label} 至少 ${min} 项`)
  if (value.length > max) invalid(`${label} 最多 ${max} 项`)
  return value.map((item: any, index: number) => validator(object(item, `${label}[${index}]`), `${label}[${index}]`))
}

/** Validate an artifact ID; IDs are lowercase, colon-separated, no paths. */
export function validateArtifactId(value: ArtifactRecord): ArtifactRecord {
  const id = text(value, 'artifactId')
  if (!ID_PATTERN.test(id)) invalid(`artifactId 不合法：${id}`)
  return id
}

/** Validate an artifact envelope. */
export function validateArtifactEnvelope(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'artifact')
  keys(input, ['workId', 'artifactId', 'kind', 'scope', 'revisionId', 'content', 'provenance', 'createdAt'], 'artifact')
  text(input.workId, 'workId')
  const artifactId = validateArtifactId(input.artifactId)
  oneOf(input.kind, ARTIFACT_KINDS, 'kind')
  text(input.revisionId, 'revisionId')
  oneOf(input.provenance, ARTIFACT_PROVENANCE, 'provenance')
  if (input.scope !== undefined) {
    const scope = object(input.scope, 'scope')
    keys(scope, ['chapter'], 'scope')
    optionalInteger(scope.chapter, 'scope.chapter', 1)
  }
  if (['chapter', 'plan', 'summary', 'review', 'context', 'trace'].includes(input.kind)
    && input.scope?.chapter === undefined) {
    invalid(`${input.kind} 必须带 scope.chapter`)
  }
  if (input.content === undefined) invalid('artifact.content 缺失')
  if (typeof input.content !== 'string'
    && (input.content === null || typeof input.content !== 'object' || Array.isArray(input.content))) {
    invalid('artifact.content 只能是对象或字符串')
  }
  text(input.createdAt, 'createdAt')
  return { ...input, artifactId }
}

/** Validate a WorkConfig projection. */
export function validateWorkConfig(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'work')
  keys(input, ['workId', 'title', 'form', 'platform', 'genre', 'status', 'targetChapters',
    'chapterWordCount', 'language', 'parentWorkId', 'fanficMode', 'tags', 'planApproval',
    'outline', 'createdAt', 'updatedAt'], 'work')
  text(input.workId, 'workId')
  text(input.title, 'title')
  oneOf(input.form, WORK_FORMS, 'form')
  oneOf(input.language, ['zh', 'en'], 'language')
  if (input.platform !== undefined) text(input.platform, 'platform')
  if (input.genre !== undefined) text(input.genre, 'genre')
  if (input.status === undefined) invalid('work.status 缺失')
  oneOf(input.status, ['incubating', 'outlining', 'active', 'paused', 'completed', 'dropped'], 'status')
  optionalInteger(input.targetChapters, 'targetChapters', 1)
  if (input.chapterWordCount === undefined) invalid('chapterWordCount 缺失')
  {
    const range = object(input.chapterWordCount, 'chapterWordCount')
    keys(range, ['min', 'max', 'target'], 'chapterWordCount')
    integer(range.min, 'chapterWordCount.min', 1)
    integer(range.max, 'chapterWordCount.max', 1)
    if (range.max < range.min) invalid('chapterWordCount.max 不能小于 min')
    optionalInteger(range.target, 'chapterWordCount.target', 1)
  }
  if (input.planApproval === undefined) invalid('planApproval 缺失')
  oneOf(input.planApproval, ['required', 'off'], 'planApproval')
  if (input.outline === undefined) invalid('outline 缺失')
  {
    const outline = object(input.outline, 'outline')
    keys(outline, ['writtenAt', 'approvedAt'], 'outline')
    if (outline.writtenAt !== undefined) text(outline.writtenAt, 'outline.writtenAt')
    if (outline.approvedAt !== undefined) text(outline.approvedAt, 'outline.approvedAt')
  }
  if (input.tags === undefined) invalid('tags 缺失')
  strings(input.tags, 'tags')
  text(input.createdAt, 'createdAt')
  text(input.updatedAt, 'updatedAt')
  return input
}

/** Validate a readable story_frame Markdown document. */
export function validateStoryFrame(value: ArtifactRecord): ArtifactRecord {
  const content = text(value, 'story_frame')
  for (const heading of ['## 前提', '## 核心冲突', '## 主角动机', '## 约束', '## 因果解决']) {
    if (!content.includes(heading)) invalid(`story_frame 缺少 ${heading}`)
  }
  return content
}

/** Fields every volume section of a volume_map must carry. */
export const VOLUME_MAP_FIELDS = ['卷目标', '起止章', '关键节拍', '卷末承诺']

/** Validate a readable volume_map Markdown document. */
export function validateVolumeMap(value: ArtifactRecord): ArtifactRecord {
  const content = text(value, 'volume_map')
  const sections = content.split(/^##\s+/mu).slice(1)
  if (sections.length === 0) invalid('volume_map 至少需要一个卷标题')
  for (const [index, section] of sections.entries()) {
    for (const field of VOLUME_MAP_FIELDS) {
      if (!new RegExp(`^\\s*[-*]?\\s*${field}\\s*[：:]`, 'mu').test(section)) {
        invalid(`volume_map 第 ${index + 1} 节缺少 ${field}`)
      }
    }
  }
  return content
}

/** Validate book_rules.json plus its readable markdown. */
export function validateBookRules(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'book_rules')
  keys(input, ['version', 'narrativePerson', 'prohibitions', 'protagonist', 'genreLock',
    'enableFullCastTracking', 'fanficMode', 'allowedDeviations', 'markdown'], 'book_rules')
  if (input.version !== '2') invalid('book_rules.version 必须是 2')
  text(input.narrativePerson, 'book_rules.narrativePerson')
  strings(input.prohibitions, 'book_rules.prohibitions')
  const protagonist = object(input.protagonist, 'book_rules.protagonist')
  keys(protagonist, ['name', 'personalityLock', 'behavioralConstraints'], 'book_rules.protagonist')
  text(protagonist.name, 'book_rules.protagonist.name')
  strings(protagonist.personalityLock, 'book_rules.protagonist.personalityLock')
  strings(protagonist.behavioralConstraints, 'book_rules.protagonist.behavioralConstraints')
  const genre = object(input.genreLock, 'book_rules.genreLock')
  keys(genre, ['primary', 'forbidden'], 'book_rules.genreLock')
  text(genre.primary, 'book_rules.genreLock.primary')
  strings(genre.forbidden, 'book_rules.genreLock.forbidden')
  boolean(input.enableFullCastTracking, 'book_rules.enableFullCastTracking')
  if (input.fanficMode !== undefined) text(input.fanficMode, 'book_rules.fanficMode')
  strings(input.allowedDeviations, 'book_rules.allowedDeviations')
  text(input.markdown, 'book_rules.markdown')
  return input
}

/** Validate the thin roles index: name + tier, at least one, no count cap. */
export function validateRolesIndex(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'roles')
  keys(input, ['roles'], 'roles')
  list(input.roles, 'roles.roles', (role, label) => {
    keys(role, ['name', 'tier'], label)
    text(role.name, `${label}.name`)
    oneOf(role.tier, ['major', 'minor'], `${label}.tier`)
    return role
  }, { min: 1 })
  const names = new Set(input.roles.map((role: any) => role.name))
  if (names.size !== input.roles.length) invalid('roles.roles 姓名重复')
  return input
}

/** Validate a role card; the index only carries name/tier. */
export function validateRoleCard(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'role_card')
  keys(input, ['slug', 'name', 'tier', 'motivation', 'knowledge', 'relationshipPressure', 'limits', 'arc', 'markdown'], 'role_card')
  text(input.slug, 'role_card.slug')
  if (/[\s:\\/]/u.test(input.slug) || input.slug === '.' || input.slug === '..') invalid('role_card.slug 不能含空白、冒号或路径分隔符')
  text(input.name, 'role_card.name')
  oneOf(input.tier, ['major', 'minor'], 'role_card.tier')
  for (const field of ['motivation', 'knowledge', 'relationshipPressure', 'limits']) text(input[field], `role_card.${field}`)
  if (input.arc !== undefined) text(input.arc, 'role_card.arc')
  text(input.markdown, 'role_card.markdown')
  return input
}

/** Validate a chapter memo (stored as plan:<n>). */
export function validateChapterMemo(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'chapter_memo')
  keys(input, ['chapter', 'goal', 'body', 'threadRefs', 'perspective', 'obstacle', 'cost', 'turn'], 'chapter_memo')
  integer(input.chapter, 'chapter_memo.chapter', 1)
  text(input.goal, 'chapter_memo.goal')
  text(input.body, 'chapter_memo.body')
  strings(input.threadRefs, 'chapter_memo.threadRefs')
  for (const field of ['perspective', 'obstacle', 'cost', 'turn']) {
    if (input[field] !== undefined) text(input[field], `chapter_memo.${field}`)
  }
  return input
}

/** Validate chapter metadata (a projection of chapter:<n>). */
export function validateChapterMeta(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'chapter_meta')
  keys(input, ['number', 'title', 'wordCount', 'stage', 'planApprovedAt', 'planRevision',
    'provenance', 'lengthTelemetry', 'tokenUsage', 'observationIds'], 'chapter_meta')
  integer(input.number, 'chapter_meta.number', 1)
  textAllowEmpty(input.title, 'chapter_meta.title')
  integer(input.wordCount, 'chapter_meta.wordCount')
  oneOf(input.stage, CHAPTER_STAGES, 'chapter_meta.stage')
  if (input.planApprovedAt !== undefined) text(input.planApprovedAt, 'chapter_meta.planApprovedAt')
  if (input.planRevision !== undefined) text(input.planRevision, 'chapter_meta.planRevision')
  if (input.provenance === undefined) invalid('chapter_meta.provenance 缺失')
  oneOf(input.provenance, ARTIFACT_PROVENANCE, 'chapter_meta.provenance')
  if (input.lengthTelemetry !== undefined) {
    const telemetry = object(input.lengthTelemetry, 'lengthTelemetry')
    keys(telemetry, ['target', 'actual', 'unit'], 'lengthTelemetry')
    integer(telemetry.target, 'lengthTelemetry.target')
    integer(telemetry.actual, 'lengthTelemetry.actual')
    oneOf(telemetry.unit, ['words', 'non-whitespace-characters'], 'lengthTelemetry.unit')
  }
  if (input.tokenUsage !== undefined) {
    const usage = object(input.tokenUsage, 'tokenUsage')
    keys(usage, ['promptTokens', 'completionTokens', 'totalTokens'], 'tokenUsage')
    for (const field of ['promptTokens', 'completionTokens', 'totalTokens']) integer(usage[field], `tokenUsage.${field}`)
  }
  if (input.observationIds === undefined) invalid('chapter_meta.observationIds 缺失')
  strings(input.observationIds, 'chapter_meta.observationIds')
  return input
}

/** Validate a structured chapter summary. */
export function validateChapterSummary(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'summary')
  keys(input, ['chapter', 'title', 'characters', 'events', 'stateChanges', 'hookActivity',
    'mood', 'chapterType', 'bodyRevision', 'rawText'], 'summary')
  integer(input.chapter, 'summary.chapter', 1)
  for (const field of SUMMARY_FIELDS) {
    textAllowEmpty(input[field], `summary.${field}`)
  }
  integer(input.bodyRevision, 'summary.bodyRevision', 1)
  textAllowEmpty(input.rawText, 'summary.rawText')
  return input
}

/** Validate an observation. */
export function validateObservation(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'observation')
  keys(input, ['id', 'code', 'summary', 'evidence', 'category', 'assessment', 'resolves', 'scope', 'target',
    'sourceRefs', 'severity', 'fix', 'mode'], 'observation')
  text(input.id, 'observation.id')
  if (!/^O[1-9]\d*$/u.test(input.id)) invalid('observation.id 必须是 O<正整数>')
  if (input.code !== undefined) text(input.code, 'observation.code')
  text(input.summary, 'observation.summary')
  strings(input.evidence, 'observation.evidence')
  oneOf(input.category, OBSERVATION_CATEGORIES, 'observation.category')
  oneOf(input.assessment, OBSERVATION_ASSESSMENTS, 'observation.assessment')
  if (input.resolves !== undefined) {
    text(input.resolves, 'observation.resolves')
    if (!/^O[1-9]\d*$/u.test(input.resolves)) invalid('observation.resolves 必须是 O<正整数>')
  }
  if (input.assessment === 'resolved' && input.resolves === undefined) invalid('resolved observation 必须带 resolves')
  if (input.scope !== undefined) text(input.scope, 'observation.scope')
  if (input.target !== undefined) {
    const target = object(input.target, 'observation.target')
    keys(target, ['workId', 'artifactId', 'revisionId'], 'observation.target')
    text(target.workId, 'observation.target.workId')
    validateArtifactId(target.artifactId)
    text(target.revisionId, 'observation.target.revisionId')
  }
  list(input.sourceRefs, 'observation.sourceRefs', (ref, label) => {
    keys(ref, ['sourceId', 'quote'], label)
    text(ref.sourceId, `${label}.sourceId`)
    text(ref.quote, `${label}.quote`)
    return ref
  }, { min: 1 })
  if (input.severity !== undefined) oneOf(input.severity, OBSERVATION_SEVERITIES, 'observation.severity')
  if (input.fix !== undefined) text(input.fix, 'observation.fix')
  if (input.mode !== undefined) oneOf(input.mode, REVISE_MODES, 'observation.mode')
  return input
}

/** Validate one review artifact: its observations carry bounded source refs. */
export function validateReviewObservations(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'review')
  keys(input, ['observations'], 'review')
  list(input.observations, 'review.observations', validateObservation)
  const ids = new Set()
  for (const observation of input.observations) {
    if (ids.has(observation.id)) invalid(`review 内 observation.id 重复：${observation.id}`)
    ids.add(observation.id)
  }
  return input
}

/** Validate a hook record. Upsert may not change status; ops use assertHookTransition. */
export function validateHook(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'hook')
  keys(input, ['hookId', 'startChapter', 'type', 'status', 'lastAdvancedChapter',
    'expectedPayoff', 'notes', 'dependsOn', 'paysOffInArc', 'text'], 'hook')
  text(input.hookId, 'hook.hookId')
  integer(input.startChapter, 'hook.startChapter')
  text(input.type, 'hook.type')
  oneOf(input.status, HOOK_STATUSES, 'hook.status')
  integer(input.lastAdvancedChapter, 'hook.lastAdvancedChapter')
  textAllowEmpty(input.expectedPayoff, 'hook.expectedPayoff')
  textAllowEmpty(input.notes, 'hook.notes')
  strings(input.dependsOn, 'hook.dependsOn')
  if (input.paysOffInArc !== undefined) text(input.paysOffInArc, 'hook.paysOffInArc')
  text(input.text, 'hook.text')
  if (input.lastAdvancedChapter < input.startChapter) invalid('hook.lastAdvancedChapter 不能早于 startChapter')
  return input
}

/** Assert one hook status transition. */
export function assertHookTransition(from: string, to: string): string {
  oneOf(from, HOOK_STATUSES, 'hook.from')
  oneOf(to, HOOK_STATUSES, 'hook.to')
  if (!(HOOK_TRANSITIONS as Record<string, string[]>)[from].includes(to)) invalid(`非法伏笔状态转移：${from} → ${to}`, 'hook-transition-invalid')
  return to
}

/** Validate a projected fact. */
export function validateFact(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'fact')
  keys(input, ['subject', 'predicate', 'object', 'validFromChapter', 'validUntilChapter', 'sourceChapter'], 'fact')
  for (const field of ['subject', 'predicate', 'object']) text(input[field], `fact.${field}`)
  integer(input.validFromChapter, 'fact.validFromChapter')
  if (input.validUntilChapter !== null) integer(input.validUntilChapter, 'fact.validUntilChapter')
  integer(input.sourceChapter, 'fact.sourceChapter')
  if (input.validUntilChapter !== null && input.validUntilChapter < input.validFromChapter) {
    invalid('fact.validUntilChapter 不能早于 validFromChapter')
  }
  return input
}

/** Validate one context source. */
export function validateContextSource(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'context_source')
  keys(input, ['source', 'reason', 'excerpt', 'protection'], 'context_source')
  text(input.source, 'context_source.source')
  text(input.reason, 'context_source.reason')
  if (input.excerpt !== undefined) textAllowEmpty(input.excerpt, 'context_source.excerpt')
  oneOf(input.protection, ['protected', 'compressible'], 'context_source.protection')
  return input
}

/** Validate a context package. */
export function validateContextPackage(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'context_package')
  keys(input, ['chapter', 'selectedContext'], 'context_package')
  integer(input.chapter, 'context_package.chapter', 1)
  list(input.selectedContext, 'context_package.selectedContext', validateContextSource, { min: 1 })
  return input
}

/** Validate a state draft: the pre-finalize state proposal of one revision. */
export function validateStateDraft(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'state_draft')
  keys(input, ['chapter', 'revision', 'factOps', 'hookOps', 'newHooks', 'findings', 'ready', 'resolvedBy', 'createdAt'], 'state_draft')
  integer(input.chapter, 'state_draft.chapter', 1)
  integer(input.revision, 'state_draft.revision', 1)
  if (input.factOps === null) invalid('state_draft.factOps 不能是 null')
  if (input.hookOps === null) invalid('state_draft.hookOps 不能是 null')
  object(input.factOps ?? {}, 'state_draft.factOps')
  object(input.hookOps ?? {}, 'state_draft.hookOps')
  if (input.newHooks !== undefined && !Array.isArray(input.newHooks)) invalid('state_draft.newHooks 必须是数组')
  if (input.findings !== undefined) {
    if (!Array.isArray(input.findings)) invalid('state_draft.findings 必须是数组')
    for (const finding of input.findings) {
      const item = object(finding, 'state_draft.findings[]')
      // Findings come from the validator and may carry extra evidence fields.
      if (typeof item.code !== 'string') invalid('state_draft.findings[].code 必须是字符串')
      if (typeof item.problem !== 'string') invalid('state_draft.findings[].problem 必须是字符串')
    }
  }
  if (typeof input.ready !== 'boolean') invalid('state_draft.ready 必须是布尔值')
  if (input.resolvedBy !== null && input.resolvedBy !== undefined && input.resolvedBy !== 'author') {
    invalid('state_draft.resolvedBy 只能是 author 或 null')
  }
  text(input.createdAt, 'state_draft.createdAt')
  return input
}

/** Validate a chapter trace. */
export function validateChapterTrace(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'trace')
  keys(input, ['chapter', 'skills', 'plannerInputs', 'composerInputs', 'selectedSources', 'contextTiers',
    'tokenBudget', 'compression', 'retrieval', 'notes', 'sections', 'trimmed', 'dropped', 'budget',
    'missing', 'overflow'], 'trace')
  integer(input.chapter, 'trace.chapter', 1)
  list(input.skills, 'trace.skills', (skill, label) => {
    keys(skill, ['id', 'revision', 'stage'], label)
    text(skill.id, `${label}.id`)
    text(skill.revision, `${label}.revision`)
    if (skill.stage !== undefined) oneOf(skill.stage, ['settler', 'validator'], `${label}.stage`)
  })
  strings(input.plannerInputs, 'trace.plannerInputs')
  strings(input.composerInputs, 'trace.composerInputs')
  strings(input.selectedSources, 'trace.selectedSources')
  const tiers = object(input.contextTiers, 'trace.contextTiers')
  keys(tiers, ['protectedSources', 'compressibleSources'], 'trace.contextTiers')
  strings(tiers.protectedSources, 'trace.contextTiers.protectedSources')
  strings(tiers.compressibleSources, 'trace.contextTiers.compressibleSources')
  const budget = object(input.tokenBudget, 'trace.tokenBudget')
  keys(budget, ['protectedTokens', 'compressibleTokens', 'totalSelectedTokens'], 'trace.tokenBudget')
  for (const field of ['protectedTokens', 'compressibleTokens', 'totalSelectedTokens']) integer(budget[field], `trace.tokenBudget.${field}`)
  if (input.compression !== undefined) {
    const compression = object(input.compression, 'trace.compression')
    keys(compression, ['compiledSource', 'protectedSources', 'compressedSources', 'protectedTokens', 'compressibleTokens', 'budgetTokens'], 'trace.compression')
    text(compression.compiledSource, 'trace.compression.compiledSource')
    strings(compression.protectedSources, 'trace.compression.protectedSources')
    strings(compression.compressedSources, 'trace.compression.compressedSources')
    for (const field of ['protectedTokens', 'compressibleTokens', 'budgetTokens']) integer(compression[field], `trace.compression.${field}`)
  }
  if (input.retrieval !== undefined) {
    const retrieval = object(input.retrieval, 'trace.retrieval')
    keys(retrieval, ['engine', 'query', 'selectionMode', 'candidates', 'semanticSelectedIds'], 'trace.retrieval')
    oneOf(retrieval.engine, ['sqlite-fts5-bm25'], 'trace.retrieval.engine')
    text(retrieval.query, 'trace.retrieval.query')
    oneOf(retrieval.selectionMode, ['semantic', 'complete'], 'trace.retrieval.selectionMode')
    if (!Array.isArray(retrieval.candidates)) invalid('trace.retrieval.candidates 必须是数组')
    strings(retrieval.semanticSelectedIds, 'trace.retrieval.semanticSelectedIds')
  }
  strings(input.notes, 'trace.notes')
  if (input.sections !== undefined) {
    list(input.sections, 'trace.sections', (section, label) => {
      keys(section, ['name', 'protection', 'sourceIds', 'chars', 'tokens', 'dropped', 'trimmed', 'reason'], label)
      text(section.name, `${label}.name`)
      oneOf(section.protection, ['protected', 'compressible'], `${label}.protection`)
      strings(section.sourceIds, `${label}.sourceIds`)
      if (section.chars !== undefined) integer(section.chars, `${label}.chars`)
      if (section.tokens !== undefined) integer(section.tokens, `${label}.tokens`)
      if (section.dropped !== undefined) oneOf(section.dropped, [true], `${label}.dropped`)
      if (section.trimmed !== undefined) oneOf(section.trimmed, [true], `${label}.trimmed`)
      if (section.reason !== undefined) text(section.reason, `${label}.reason`)
      return section
    })
  }
  if (input.missing !== undefined) {
    list(input.missing, 'trace.missing', (entry, label) => {
      keys(entry, ['name', 'reason'], label)
      text(entry.name, `${label}.name`)
      text(entry.reason, `${label}.reason`)
      return entry
    })
  }
  if (input.overflow !== undefined) oneOf(input.overflow, [true, false], 'trace.overflow')
  if (input.trimmed === undefined) invalid('trace.trimmed 缺失')
  strings(input.trimmed, 'trace.trimmed')
  if (input.dropped === undefined) invalid('trace.dropped 缺失')
  strings(input.dropped, 'trace.dropped')
  if (input.budget !== undefined) {
    const budget = object(input.budget, 'trace.budget')
    keys(budget, ['limit', 'used', 'unit'], 'trace.budget')
    integer(budget.limit, 'trace.budget.limit')
    integer(budget.used, 'trace.budget.used')
    oneOf(budget.unit, ['characters', 'tokens'], 'trace.budget.unit')
  }
  return input
}

/** Validate a short-story artifact. */
export function validateShortStory(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'short_story')
  keys(input, ['storyTitle', 'openingHook', 'chapters', 'rawContent', 'outline', 'draftReview',
    'revisionPlan', 'salesPackage', 'measurements'], 'short_story')
  text(input.storyTitle, 'short_story.storyTitle')
  if (input.openingHook !== undefined) textAllowEmpty(input.openingHook, 'short_story.openingHook')
  list(input.chapters, 'short_story.chapters', (chapter, label) => {
    keys(chapter, ['number', 'title', 'content', 'charCount'], label)
    integer(chapter.number, `${label}.number`, 1)
    textAllowEmpty(chapter.title, `${label}.title`)
    textAllowEmpty(chapter.content, `${label}.content`)
    integer(chapter.charCount, `${label}.charCount`)
    return chapter
  })
  const numbers = new Set(input.chapters.map((chapter: any) => chapter.number))
  if (numbers.size !== input.chapters.length) invalid('short_story.chapters 编号重复')
  textAllowEmpty(input.rawContent, 'short_story.rawContent')
  textAllowEmpty(input.outline, 'short_story.outline')
  textAllowEmpty(input.draftReview, 'short_story.draftReview')
  textAllowEmpty(input.revisionPlan, 'short_story.revisionPlan')
  const sales = object(input.salesPackage, 'short_story.salesPackage')
  keys(sales, ['title', 'intro', 'sellingPoints', 'coverPrompt'], 'short_story.salesPackage')
  text(sales.title, 'short_story.salesPackage.title')
  textAllowEmpty(sales.intro, 'short_story.salesPackage.intro')
  strings(sales.sellingPoints, 'short_story.salesPackage.sellingPoints')
  textAllowEmpty(sales.coverPrompt, 'short_story.salesPackage.coverPrompt')
  const measurements = object(input.measurements, 'short_story.measurements')
  keys(measurements, ['chapterCount', 'totalLength', 'unit', 'openingHookLength', 'chapterLengths'], 'short_story.measurements')
  integer(measurements.chapterCount, 'short_story.measurements.chapterCount')
  integer(measurements.totalLength, 'short_story.measurements.totalLength')
  oneOf(measurements.unit, ['words', 'non-whitespace-characters'], 'short_story.measurements.unit')
  integer(measurements.openingHookLength, 'short_story.measurements.openingHookLength')
  list(measurements.chapterLengths, 'short_story.measurements.chapterLengths', (entry, label) => {
    keys(entry, ['number', 'length'], label)
    integer(entry.number, `${label}.number`, 1)
    integer(entry.length, `${label}.length`)
    return entry
  })
  if (measurements.chapterCount !== input.chapters.length) {
    invalid('short_story.measurements.chapterCount 必须等于章节数')
  }
  if (measurements.chapterLengths.length !== input.chapters.length) {
    invalid('short_story.measurements.chapterLengths 必须逐章对应')
  }
  const byNumber = new Map<any, any>(input.chapters.map((chapter: any) => [chapter.number, chapter]))
  for (const [index, entry] of measurements.chapterLengths.entries()) {
    const chapter = byNumber.get(entry.number)
    if (chapter === undefined) invalid(`short_story.measurements.chapterLengths[${index}] 指向不存在的章 ${entry.number}`)
    if (entry.length !== chapter.charCount) {
      invalid(`short_story.measurements.chapterLengths[${index}] 与第 ${entry.number} 章 charCount 不一致`)
    }
  }
  const totalLength = input.chapters.reduce((total: number, chapter: any) => total + chapter.charCount, 0)
  if (measurements.totalLength !== totalLength) invalid('short_story.measurements.totalLength 必须等于 charCount 之和')
  return input
}

/** Validate a script artifact. */
export function validateScript(value: ArtifactRecord): ArtifactRecord {
  const input = object(value, 'script')
  keys(input, ['title', 'sourceKind', 'targetFormat', 'episodeCount', 'episodeDuration', 'spec', 'script', 'episodes'], 'script')
  text(input.title, 'script.title')
  if (input.sourceKind !== undefined) text(input.sourceKind, 'script.sourceKind')
  oneOf(input.targetFormat, SCRIPT_FORMATS, 'script.targetFormat')
  optionalInteger(input.episodeCount, 'script.episodeCount', 1)
  if (input.episodeDuration !== undefined) text(input.episodeDuration, 'script.episodeDuration')
  textAllowEmpty(input.spec, 'script.spec')
  textAllowEmpty(input.script, 'script.script')
  list(input.episodes, 'script.episodes', (episode, label) => {
    keys(episode, ['number', 'title', 'scenes'], label)
    integer(episode.number, `${label}.number`, 1)
    textAllowEmpty(episode.title, `${label}.title`)
    list(episode.scenes, `${label}.scenes`, (scene, sceneLabel) => {
      keys(scene, ['slug', 'location', 'time', 'action', 'dialogue'], sceneLabel)
      textAllowEmpty(scene.slug, `${sceneLabel}.slug`)
      textAllowEmpty(scene.location, `${sceneLabel}.location`)
      textAllowEmpty(scene.time, `${sceneLabel}.time`)
      textAllowEmpty(scene.action, `${sceneLabel}.action`)
      if (!Array.isArray(scene.dialogue)) invalid(`${sceneLabel}.dialogue 必须是数组`)
      return scene
    })
    return episode
  })
  const numbers = new Set(input.episodes.map((episode: any) => episode.number))
  if (numbers.size !== input.episodes.length) invalid('script.episodes 编号重复')
  return input
}

/**
 * Content validators for artifact kinds with a canonical shape.
 *
 * Kinds without an entry are still envelope-checked by the store; their field
 * contract arrives with the ticket that owns that artifact (R8 for storyboard
 * and the other production artifacts).
 */
export const ARTIFACT_CONTENT_VALIDATORS = {
  plan: validateChapterMemo,
  summary: validateChapterSummary,
  story_frame: validateStoryFrame,
  volume_map: validateVolumeMap,
  book_rules: validateBookRules,
  role_index: validateRolesIndex,
  role_card: validateRoleCard,
  state_draft: validateStateDraft,
  review: validateReviewObservations,
  trace: validateChapterTrace,
  short_story: validateShortStory,
  script: validateScript,
}

/** Canonical artifact IDs, or the chapter-scoped pattern, for typed kinds. */
export const ARTIFACT_IDENTITY = {
  story_frame: { artifactId: 'bible:story_frame' },
  volume_map: { artifactId: 'bible:volume_map' },
  book_rules: { artifactId: 'bible:book_rules' },
  role_index: { artifactId: 'roles:index' },
  role_card: { pattern: /^role:[^\s:]+$/u },
  state_draft: { pattern: /^state:draft:([1-9]\d*):r([1-9]\d*)$/u, chapterScoped: true },
  plan: { pattern: /^plan:([1-9]\d*)$/u, chapterScoped: true },
  summary: { pattern: /^summary:([1-9]\d*)$/u, chapterScoped: true },
  review: { pattern: /^review:([1-9]\d*):r([1-9]\d*):([1-9]\d*)$/u, chapterScoped: true },
  trace: { pattern: /^trace:([1-9]\d*):(writer|planner|reviewer|reviser|summarizer|architect)$/u, chapterScoped: true },
  short_story: { pattern: /^short:[^\s:]+$/u },
  script: { pattern: /^script:[^\s:]+$/u },
}

/**
 * Assert that an artifactId, kind and scope agree for a typed kind.
 */
export function assertArtifactIdentity(kind: string, artifactId: string, scope: { chapter?: number } | undefined): number | undefined {
  const spec = (ARTIFACT_IDENTITY as Record<string, any>)[kind]
  if (spec === undefined) return undefined
  if (spec.chapterScoped !== true && scope?.chapter !== undefined) {
    invalid(`${kind} 不接受 scope.chapter`)
  }
  if (spec.artifactId !== undefined) {
    if (artifactId !== spec.artifactId) invalid(`${kind} 的 artifactId 必须是 ${spec.artifactId}`)
    return undefined
  }
  if (spec.pattern === undefined) return undefined
  const match = spec.pattern.exec(artifactId)
  if (match === null) invalid(`${kind} 的 artifactId 不合法：${artifactId}`)
  if (spec.chapterScoped !== true) return undefined
  const chapter = Number(match[1])
  if (scope?.chapter !== chapter) invalid(`${kind} 的 scope.chapter 必须等于 ${chapter}`)
  return chapter
}

/**
 * Validate a complete artifact record: envelope, identity and kind-specific
 * content. This is the write boundary of the v6 registry.
 */
export function validateArtifactRecord(value: ArtifactRecord): ArtifactRecord {
  const envelope = validateArtifactEnvelope(value)
  const chapter = assertArtifactIdentity(envelope.kind, envelope.artifactId, envelope.scope)
  const validator = (ARTIFACT_CONTENT_VALIDATORS as Record<string, any>)[envelope.kind]
  const content = validator === undefined ? envelope.content : validator(envelope.content)
  if ((envelope.kind === 'plan' || envelope.kind === 'summary' || envelope.kind === 'trace') && content.chapter !== chapter) {
    invalid(`${envelope.kind} 的 content.chapter 必须等于 ${chapter}`)
  }
  if (envelope.kind === 'role_card' && content.slug !== envelope.artifactId.slice('role:'.length)) {
    invalid('role_card 的 slug 必须等于 artifactId 的 role 段')
  }
  if (envelope.kind === 'state_draft') {
    const match = /^state:draft:([1-9]\d*):r([1-9]\d*)$/u.exec(envelope.artifactId)
    if (match === null || Number(match[1]) !== content.chapter || Number(match[2]) !== content.revision) {
      invalid('state_draft 的 artifactId 必须与 content.chapter/revision 一致')
    }
  }
  return { ...envelope, content }
}

/** foundation.ts repository. */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import type { Database } from '../db.ts'
import type { ArtifactRow, BibleRow, ChapterRow, ChapterVersionRow, EventRow, MaterialRow, MetaRow, VolumeRow, WorkRow } from '../store-rows.ts'
import {
  backupTo, checkpoint, createWorkDatabase, exportsDir, integrityCheck, WORK_SCHEMA_VERSION,
  materialsDir, moveDatabaseFiles, openCatalog, openDatabase, openWork, removeDatabaseFiles, touchMeta, transaction,
  trashDir, trashFile, workFile, worksDir, backupsDir,
} from '../db.ts'
import { MATERIAL_PURPOSES, MATERIAL_TITLE_MAX, materialMetadata, normalizeMaterialPurpose, prepareMaterial } from '../../materials.ts'
import { chapterRemap } from '../../chapter-edit.ts'
import { filterChapters, filterWorks, workStatus, type ChapterFilters, type WorkFilters } from '../../work-filters.ts'
import { buildEpub } from '../../epub.ts'
import { snippetFor } from '../../retrieval.ts'
import { materialIndexText, searchTokens } from '../../search-text.ts'
import { dropSearchDoc, syncSearchDoc } from '../../search-index.ts'
import { STATE_LIMITS, applyFactOp, applyHookOp, mintHookId, projectState } from '../../state-projection.ts'
import {
  StoryError, SUMMARY_FIELDS, SUMMARY_MAX_CHARS, WORK_FORMS, chapterNumber, chapterStem, contentVersion, countWords,
  formOf, now, planApprovalPolicy, stageOf, summaryAdmissible, trimSummary, unitOf, workIdOf,
} from '../../domain.ts'
import { assertRevisionMode } from '../../revision.ts'
import { INITIAL_HOOKS_HEADING, assertHookTransition, validateArtifactRecord, validateHook, validateInitialHooks } from '../../artifact-contract.ts'
import {
  artifactRevision, deleteArtifactOnDb, dropRoleCardsOnDb, FOUNDATION_DOCUMENTS, indexTiersOf, latestRoleCardsOnDb, putArtifactOnDb, remapChapterArtifacts, renderChapterMemo, renderFoundationContent,
  writeChapterMemoOnDb, writeChapterObservationsOnDb, writeChapterSummaryOnDb, writeTextArtifactOnDb, readTextArtifactOnDb,
} from '../../artifact-store.ts'
import { reviewInputOf } from '../../review-binding.ts'
import { methodForStep } from '../../skill-routing.ts'
import { callSummary } from '../../telemetry.ts'
import {
  backupWork,
} from '../../storage/repositories/export.ts'
import {
  readManifest,
  status,
  delegateOf,
} from '../../storage/repositories/catalog.ts'
import {
  TRUTH_ARTIFACTS,
} from '../../storage/repositories/bible.ts'
import {
  invalidateStateDraftOnDb,
  readEvents,
  exportSummaryRows,
} from '../../storage/repositories/state.ts'
import {
  renderReviewMarkdown,
} from '../../storage/repositories/reviews.ts'
import {
  metaOf,
  summaryStateOf,
  latestReviewRow,
  openObservations,
  foundationRevisionOf,
  foundationApprovedAt,
  planMemoFrom,
  methodFor,
  approvalReasonOf,
  approvalSourceOf,
  foundationSummaryOf,
  askFor,
  reviewCovers,
  isCleanReview,
  eventsOf,
  foldedOf,
  FOUNDATION_STAGE_ARTIFACTS,
} from './shared.ts'
import {
  revisionRounds,
  MAX_REVISION_ROUNDS,
} from '../types.ts'

// ---------------------------------------------------------------------------
// Foundation production: architect stages land validated artifacts; the author
// confirms the finished set from the panel. Stages are derived from the registry
// so a rerun or a manual edit cannot desync the state.
// ---------------------------------------------------------------------------

/** Architect state stages in order. */
export const FOUNDATION_STAGES = ['frame', 'rules', 'hooks', 'roles', 'cards']

/** Normal architect dispatch is one foundation bundle; manual stages remain for repair. */
export const FOUNDATION_DISPATCH_STAGES = ['foundation']
export const FOUNDATION_WRITE_STAGES = ['design', 'frame', 'rules', 'hooks', 'roles', 'cards']


/** Every index person has exactly one card, and the card tier matches. */
function foundationCardsComplete(db: any): boolean {
  const index = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'roles:index' ORDER BY rowid DESC LIMIT 1").get()
  if (index === undefined) return false
  const tiers = indexTiersOf(JSON.parse(String(index.content)))
  if (tiers.size === 0) return false
  const seen = new Map<string, string>()
  for (const row of latestRoleCardsOnDb(db)) {
    const card = JSON.parse(String(row.content))
    const name = String(card?.name ?? '')
    if (seen.has(name)) return false
    seen.set(name, String(card?.tier ?? ''))
  }
  if (seen.size !== tiers.size) return false
  for (const [name, tier] of tiers) {
    if (seen.get(name) !== tier) return false
  }
  return true
}

/** Derived foundation state of one open work. */
export function foundationStateOf(db: any) {
  const has = (artifactId: any) => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? LIMIT 1').get(artifactId) !== undefined
  const stages = {
    frame: FOUNDATION_STAGE_ARTIFACTS.frame.every(has),
    rules: FOUNDATION_STAGE_ARTIFACTS.rules.every(has),
    hooks: FOUNDATION_STAGE_ARTIFACTS.hooks.every(has),
    roles: FOUNDATION_STAGE_ARTIFACTS.roles.every(has),
    cards: foundationCardsComplete(db),
  }
  const complete = FOUNDATION_STAGES.every(stage => (stages as Record<string, boolean>)[stage] === true)
  const nextStage = FOUNDATION_STAGES.find(stage => (stages as Record<string, boolean>)[stage] !== true)
  const dispatchStage = complete ? undefined : FOUNDATION_DISPATCH_STAGES[0]
  return {
    stages,
    complete,
    ...(nextStage === undefined ? {} : { nextStage }),
    ...(dispatchStage === undefined ? {} : { dispatchStage }),
    ...(foundationApprovedAt(db) === undefined ? {} : { approvedAt: foundationApprovedAt(db) }),
    ...(metaOf(db).foundation_approved_source === null ? {} : { approvedSource: metaOf(db).foundation_approved_source }),
    ...(metaOf(db).foundation_approved_reason === null ? {} : { approvedReason: metaOf(db).foundation_approved_reason }),
  }
}

/** Read the derived foundation state of one work. */
export function readFoundationState(root: any, work: any) {
  const db = openWork(root, work)
  try {
    return foundationStateOf(db)
  } finally {
    db.close()
  }
}

/**
 * Land one architect stage atomically.
 * All artifacts are validated before any write; a rerun appends revisions and
 * clears the author's foundation confirmation.
 * @param {string} root - workspace directory.
 * @param {{work: string, stage: string, payload: object}} input - stage payload.
 * @returns {{workId: string, stage: string, artifacts: object[], foundation: object}} receipt.
 */
/**
 * Tokens from the accepted proposal that a foundation should mention.
 *
 * The proposal is the author contract: a frame that names none of its premise
 * words or characters was generated from something else, so it must not land.
 * @returns deduplicated tokens; empty when the work has no accepted proposal.
 */
/** The accepted proposal of one work, when the catalog has it. */
export function acceptedProposalOf(root: any, workId: string): { premise: string, characters: string } | undefined {
  let catalog: ReturnType<typeof openCatalog>
  try {
    catalog = openCatalog(root, { create: false })
  } catch {
    throw new StoryError('foundation-mismatch', '读不到提案，无法校验基础设定', '先确认作品库可读，再重试')
  }
  if (catalog === undefined) {
    throw new StoryError('foundation-mismatch', '读不到提案，无法校验基础设定', '先确认作品库可读，再重试')
  }
  try {
    const row = catalog.prepare('SELECT premise, characters FROM proposals WHERE used_work_id = ? ORDER BY created_at DESC LIMIT 1').get(workId)
    if (row === undefined) return undefined
    return { premise: String(row.premise ?? ''), characters: String(row.characters ?? '[]') }
  } finally {
    catalog.close()
  }
}
function proposalTokensOf(root: any, workId: string): string[] {
  const proposal = acceptedProposalOf(root, workId)
  if (proposal === undefined) return []
  const tokens: string[] = []
  for (const part of proposal.premise.split(/[，。；、：！？\s“”"（）()]+/u)) {
    const chars = [...part]
    if (chars.length >= 2) tokens.push(part)
    for (let index = 0; index + 3 <= chars.length; index += 1) tokens.push(chars.slice(index, index + 3).join(''))
  }
  try {
    const list = JSON.parse(proposal.characters === '' ? '[]' : proposal.characters)
    if (Array.isArray(list)) {
      for (const item of list) {
        const name = typeof item === 'string' ? item : item?.name
        if (typeof name === 'string' && [...name].length >= 2) tokens.push(name)
      }
    }
  } catch {
    // characters are optional
  }
  return [...new Set(tokens)]
}

/** Escape one hook table cell so the readable projection stays a valid table. */
function hooksTableCell(value: any): string {
  return String(value ?? '').replace(/\r?\n/gu, ' ').replace(/\|/gu, '\\|').trim()
}

/** Render the architect seed as the readable table stored in `bible:hooks`. */
export function renderInitialHooksMarkdown(hooks: ReadonlyArray<any>): string {
  const head = '| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 备注 | text |'
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- |'
  const rows = hooks.map(hook => `| ${[
    hook.hookId, '开篇', hook.type, 'deferred', '开篇', hook.expectedPayoff, hook.notes, hook.text,
  ].map(hooksTableCell).join(' | ')} |`)
  return [INITIAL_HOOKS_HEADING, '', head, rule, ...rows, ''].join('\n')
}

/** The `bible:hooks` payload: the seed fields plus their readable table. */
function initialHooksArtifact(hooks: ReadonlyArray<any>) {
  return { hooks: hooks.map(hook => ({ ...hook })), markdown: renderInitialHooksMarkdown(hooks) }
}

/** Latest architect seed, read from `bible:hooks`; empty when never seeded. */
function initialHooksSeedOf(db: any): any[] {
  const row = db.prepare("SELECT content_type, content FROM artifacts WHERE artifact_id = 'bible:hooks' ORDER BY rowid DESC LIMIT 1").get()
  if (row === undefined) return []
  try {
    const content = row.content_type === 'json' ? JSON.parse(String(row.content)) : undefined
    return Array.isArray(content?.hooks) ? content.hooks : []
  } catch {
    return []
  }
}

/**
 * Plant the architect's initial hooks in the v2 event log at chapter 0.
 *
 * Settlement may only create `open` hooks inside a written chapter; the
 * architect plants promises before any chapter exists, so this path writes the
 * seed directly with `deferred`. Re-seeding diffs by hookId: changed metadata is
 * upserted (the current status is kept), a removed seed is superseded, a new
 * seed is created. Events are never deleted: chapter hookOps refer to ids.
 * The caller owns the transaction and therefore the rollback.
 */
function seedFoundationHooksOnDb(db: any, input: { hooks: ReadonlyArray<any>, previous: ReadonlyArray<any>, at: string }): number {
  const state = foldedOf(db)
  // A hook id belongs to the seed when its first upsert landed at chapter 0;
  // chapter-minted ids come from settlement at chapter >= 1. Ownership is read
  // from the event log, not the latest artifact, so a removed seed stays known.
  const seedIds = new Set<string>()
  for (const event of eventsOf(db)) {
    if (event.kind === 'hook' && event.op === 'upsert' && Number(event.chapter) === 0 && event.hook !== undefined) {
      seedIds.add(String(event.hook.hookId))
    }
  }
  const previousIds = new Set(input.previous.map((hook: any) => String(hook?.hookId ?? '')))
  const nextIds = new Set(input.hooks.map((hook: any) => String(hook.hookId)))
  for (const hook of input.hooks) {
    const current = state.hooks.find((item: any) => String(item.hookId) === String(hook.hookId))
    if (current === undefined) continue
    if (!seedIds.has(String(hook.hookId))) {
      throw new StoryError(
        'foundation-hooks-conflict',
        `初始伏笔 id 与已有伏笔冲突：${hook.hookId}`,
        '换一个 hookId；章节内的伏笔由结算铸造，不能复用',
      )
    }
    if (current.status === 'superseded') {
      throw new StoryError(
        'foundation-hooks-retired',
        `初始伏笔 id 已退役：${hook.hookId}`,
        '换一个 hookId；被移除的初始伏笔不能复活',
      )
    }
  }
  let seq = Number((db.prepare('SELECT max(seq) AS n FROM events').get() as { n?: number } | undefined)?.n ?? 0)
  const push = (payload: any): void => {
    seq += 1
    const text = JSON.stringify(payload)
    db.prepare('INSERT INTO events (seq, at, chapter, kind, payload) VALUES (?, ?, ?, ?, ?)')
      .run(seq, input.at, 0, 'hook', text)
    syncSearchDoc(db, `event:${seq}`, 'hook', 'state/events', 0, text)
  }
  let written = 0
  for (const hook of input.hooks) {
    const current = state.hooks.find((item: any) => String(item.hookId) === String(hook.hookId))
    const record = validateHook({
      hookId: hook.hookId,
      startChapter: current?.startChapter ?? 0,
      type: hook.type,
      status: current?.status ?? 'deferred',
      lastAdvancedChapter: current?.lastAdvancedChapter ?? 0,
      expectedPayoff: hook.expectedPayoff,
      notes: hook.notes,
      text: hook.text,
      dependsOn: current?.dependsOn ?? [],
      ...(current?.paysOffInArc === undefined ? {} : { paysOffInArc: current.paysOffInArc }),
    })
    if (current !== undefined) {
      const unchanged = ['type', 'expectedPayoff', 'notes', 'text']
        .every(key => String(current[key] ?? '') === String(record[key] ?? ''))
      if (unchanged) continue
    }
    push({ op: 'upsert', hook: record })
    written += 1
  }
  for (const hookId of previousIds) {
    if (nextIds.has(hookId)) continue
    const current = state.hooks.find((item: any) => String(item.hookId) === hookId)
    if (current === undefined || current.status === 'superseded') continue
    assertHookTransition(String(current.status), 'superseded')
    push({ op: 'supersede', hookId, chapter: 0 })
    written += 1
  }
  return written
}

export function writeFoundationStage(root: any, input: any) {
  const workId = String(input.work)
  const stage = String(input.stage)
  if (!FOUNDATION_WRITE_STAGES.includes(stage)) throw new StoryError('foundation-stage-invalid', `未知的 foundation stage：${stage}`)
  const payload = input.payload ?? {}
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const state = foundationStateOf(db)
      if (stage !== 'frame' && stage !== 'design' && state.stages.frame !== true) {
        throw new StoryError('foundation-order', '先生成 frame（故事框架/卷图/当前焦点），再生成后续阶段')
      }
      if (stage === 'cards' && state.stages.roles !== true) {
        throw new StoryError('foundation-order', '先生成 roles 索引，再生成角色卡')
      }
      const at = now()
      const record = (artifactId: any, kind: any, content: any, source: any) => {
        const value = {
          workId,
          artifactId,
          kind,
          revisionId: artifactRevision(content),
          content,
          provenance: 'generated',
          createdAt: at,
        }
        const envelope = validateArtifactRecord(value)
        return { envelope, source, text: renderFoundationContent(content) }
      }
      let records
      /** Architect seed to plant after the artifacts land. */
      let seed: { hooks: any[], previous: any[] } | undefined
      if (stage === 'design') {
        const tokens = proposalTokensOf(root, workId)
        const frameText = `${String(payload.storyFrame ?? '')}\n${String(payload.volumeMap ?? '')}\n${String(payload.currentFocus ?? '')}`
        if (tokens.length > 0 && !tokens.some(token => frameText.includes(token))) {
          throw new StoryError('foundation-mismatch', '基础设定与提案没有一处对得上：提案里的关键人物或前提没有出现在故事框架里', '按提案重写基础设定，或先说明为什么改方向')
        }
        const focus = String(payload.currentFocus ?? '')
        if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
        const protagonist = String(payload.bookRules?.protagonist?.name ?? '').trim()
        const rulesFrameText = String(payload.storyFrame ?? '')
        if (protagonist !== '') {
          const proposal = acceptedProposalOf(root, workId)
          const known = new Set<string>()
          try {
            const list = JSON.parse(proposal?.characters ?? '[]')
            for (const item of Array.isArray(list) ? list : []) {
              const name = typeof item === 'string' ? item : item?.name
              if (typeof name === 'string' && name !== '') known.add(name)
            }
          } catch {}
          const frameNamesSomeone = [...known].some(name => rulesFrameText.includes(name))
          if (rulesFrameText !== '' && frameNamesSomeone && !rulesFrameText.includes(protagonist)) {
            throw new StoryError('foundation-inconsistent', `作品规则的主角「${protagonist}」没有出现在故事框架里`, '按框架改规则里的主角名；确实要换主角时，先说明为什么改方向')
          }
        }
        records = [
          record('bible:story_frame', 'story_frame', String(payload.storyFrame ?? ''), 'foundation/story_frame'),
          record('bible:volume_map', 'volume_map', String(payload.volumeMap ?? ''), 'foundation/volume_map'),
          record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
          record('bible:book_rules', 'book_rules', payload.bookRules, 'foundation/book_rules'),
          record('roles:index', 'role_index', payload.rolesIndex, 'foundation/roles/index'),
        ]
      } else if (stage === 'frame') {
        const tokens = proposalTokensOf(root, workId)
        const frameText = `${String(payload.storyFrame ?? '')}\n${String(payload.volumeMap ?? '')}\n${String(payload.currentFocus ?? '')}`
        if (tokens.length > 0 && !tokens.some(token => frameText.includes(token))) {
          throw new StoryError('foundation-mismatch', '基础设定与提案没有一处对得上：提案里的关键人物或前提没有出现在故事框架里', '按提案重写基础设定，或先说明为什么改方向')
        }
        const focus = String(payload.currentFocus ?? '')
        if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
        records = [
          record('bible:story_frame', 'story_frame', String(payload.storyFrame ?? ''), 'foundation/story_frame'),
          record('bible:volume_map', 'volume_map', String(payload.volumeMap ?? ''), 'foundation/volume_map'),
          record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
        ]
      } else if (stage === 'rules') {
        // The frame carries the protagonist the author confirmed; a rules-stage
        // name that never appears there means the stages drifted apart.
        const protagonist = String(payload.bookRules?.protagonist?.name ?? '').trim()
        if (protagonist !== '') {
          const frame = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:story_frame' ORDER BY rowid DESC LIMIT 1").get()
          const frameText = frame === undefined ? '' : String(frame.content)
          // Only judge when the frame actually names proposal people; a frame that
          // names nobody gives the guard nothing to compare against.
          const proposal = acceptedProposalOf(root, workId)
          const known = new Set<string>()
          try {
            const list = JSON.parse(proposal?.characters ?? '[]')
            for (const item of Array.isArray(list) ? list : []) {
              const name = typeof item === 'string' ? item : item?.name
              if (typeof name === 'string' && name !== '') known.add(name)
            }
          } catch {
            // A malformed proposal list is not this guard's to report.
          }
          const frameNamesSomeone = [...known].some(name => frameText.includes(name))
          if (frameText !== '' && frameNamesSomeone && !frameText.includes(protagonist)) {
            throw new StoryError(
              'foundation-inconsistent',
              `作品规则的主角「${protagonist}」没有出现在故事框架里`,
              '按框架改规则里的主角名；确实要换主角时，先说明为什么改方向',
            )
          }
        }
        records = [record('bible:book_rules', 'book_rules', payload.bookRules, 'foundation/book_rules')]
      } else if (stage === 'roles') {
        records = [record('roles:index', 'role_index', payload.rolesIndex, 'foundation/roles/index')]
      } else if (stage === 'hooks') {
        const hooks = validateInitialHooks(payload.pendingHooks)
        seed = { hooks, previous: initialHooksSeedOf(db) }
        records = [record('bible:hooks', 'hooks', initialHooksArtifact(hooks), 'foundation/hooks')]
      } else {
        const cards = Array.isArray(payload.roleCards) ? payload.roleCards : []
        if (cards.length === 0) throw new StoryError('artifact-invalid', '角色卡至少需要一张')
        const index = db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'roles:index' ORDER BY rowid DESC LIMIT 1").get()
        const tiers = index === undefined ? new Map<string, string>() : indexTiersOf(JSON.parse(String(index.content)))
        if (tiers.size === 0) throw new StoryError('artifact-invalid', '还没有 roles 索引：先跑 roles 阶段')
        const names = new Set()
        const slugs = new Set()
        records = cards.map((card: any) => {
          const name = String(card?.name ?? '')
          if (!tiers.has(name)) {
            throw new StoryError('artifact-invalid', `角色卡 ${name} 不在 roles 索引里`)
          }
          if (card?.tier !== tiers.get(name)) {
            throw new StoryError('artifact-invalid', `角色卡 ${name} 的 tier 必须等于索引里的 ${tiers.get(name)}`)
          }
          const slug = String(card?.slug ?? '').trim()
          if (names.has(name) || slugs.has(slug)) {
            throw new StoryError('artifact-invalid', `角色卡重复：${name}/${slug}`)
          }
          names.add(name)
          slugs.add(slug)
          return record(`role:${slug}`, 'role_card', card, `foundation/roles/${slug}`)
        })
        for (const [name] of tiers) {
          if (!names.has(name)) throw new StoryError('artifact-invalid', `角色卡缺少索引人物：${name}`)
        }
        // Name is the identity; a rerun with a new slug replaces the old card in
        // the same transaction so one person never has two cards.
        const existingCards = latestRoleCardsOnDb(db)
        const slugByName = new Map<string, string>(cards.map((item: any) => [String(item?.name ?? ''), String(item?.slug ?? '').trim()]))
        const nameBySlug = new Map<string, string>(cards.map((item: any) => [String(item?.slug ?? '').trim(), String(item?.name ?? '')]))
        for (const row of existingCards) {
          let old: any
          try { old = JSON.parse(String(row.content)) } catch { continue }
          const oldName = String(old?.name ?? '')
          const oldSlug = String(old?.slug ?? '')
          if (slugs.has(oldSlug) && nameBySlug.get(oldSlug) !== oldName) {
            throw new StoryError('artifact-invalid', `slug 已被其他姓名占用：${oldSlug}`)
          }
          if (names.has(oldName) && String(row.artifact_id) !== `role:${slugByName.get(oldName) ?? ''}`) {
            // Same person moved to a new slug: the old card is replaced.
            deleteArtifactOnDb(db, String(row.artifact_id))
          }
        }
      }
      let anyWritten = false
      const artifacts = records.map(({ envelope, source, text }: any) => {
        const existing = db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?')
          .get(envelope.artifactId, envelope.revisionId)
        if (existing === undefined) {
          putArtifactOnDb(db, envelope, { search: { docId: envelope.artifactId, kind: envelope.kind, source, text } })
          anyWritten = true
        }
        return { artifactId: envelope.artifactId, revisionId: envelope.revisionId, kind: envelope.kind }
      })
      if (stage === 'roles' || stage === 'design') {
        // The index is the person list and the tier authority; stale cards go.
        dropRoleCardsOnDb(db, indexTiersOf(payload.rolesIndex))
      }
      if (seed !== undefined) {
        seedFoundationHooksOnDb(db, { hooks: seed.hooks, previous: seed.previous, at })
      }
      return { workId, stage, artifacts, foundation: foundationStateOf(db) }
    })
  } finally {
    db.close()
  }
}

/** Land all four architect phases in one transaction; any failure leaves no artifact. */
export function writeFoundationBundle(root: any, input: any) {
  const workId = String(input.work)
  const phases = input.phases ?? {}
  const outline = phases.outline ?? {}
  const details = phases.details ?? {}
  const castIndex = phases.cast_index ?? {}
  const cardPhase = phases.cards ?? {}
  const db = openWork(root, workId)
  try {
    return transaction(db, () => {
      const at = now()
      const record = (artifactId: any, kind: any, content: any, source: any) => {
        const value = {
          workId, artifactId, kind,
          revisionId: artifactRevision(content), content, provenance: 'generated', createdAt: at,
        }
        return { envelope: validateArtifactRecord(value), source, text: renderFoundationContent(content) }
      }
      const initialHooks = validateInitialHooks(details.pendingHooks)
      const previousHooks = initialHooksSeedOf(db)
      const frameText = `${String(outline.storyFrame ?? '')}\n${String(outline.volumeMap ?? '')}\n${String(outline.currentFocus ?? '')}`
      const tokens = proposalTokensOf(root, workId)
      if (tokens.length > 0 && !tokens.some(token => frameText.includes(token))) {
        throw new StoryError('foundation-mismatch', '基础设定与提案没有一处对得上：提案里的关键人物或前提没有出现在故事框架里', '按提案重写基础设定，或先说明为什么改方向')
      }
      const focus = String(outline.currentFocus ?? '')
      if ([...focus].length > 600) throw new StoryError('artifact-invalid', 'current_focus 超过 600 字')
      const protagonist = String(details.bookRules?.protagonist?.name ?? '').trim()
      const rulesFrameText = String(outline.storyFrame ?? '')
      if (protagonist !== '') {
        const proposal = acceptedProposalOf(root, workId)
        const known = new Set<string>()
        try {
          const list = JSON.parse(proposal?.characters ?? '[]')
          for (const item of Array.isArray(list) ? list : []) {
            const name = typeof item === 'string' ? item : item?.name
            if (typeof name === 'string' && name !== '') known.add(name)
          }
        } catch {}
        if (rulesFrameText !== '' && [...known].some(name => rulesFrameText.includes(name)) && !rulesFrameText.includes(protagonist)) {
          throw new StoryError('foundation-inconsistent', `作品规则的主角「${protagonist}」没有出现在故事框架里`, '按框架改规则里的主角名；确实要换主角时，先说明为什么改方向')
        }
      }
      const baseRecords = [
        record('bible:story_frame', 'story_frame', String(outline.storyFrame ?? ''), 'foundation/story_frame'),
        record('bible:volume_map', 'volume_map', String(outline.volumeMap ?? ''), 'foundation/volume_map'),
        record('bible:current_focus', 'current_focus', focus, 'foundation/current_focus'),
        record('bible:book_rules', 'book_rules', details.bookRules, 'foundation/book_rules'),
        record('bible:hooks', 'hooks', initialHooksArtifact(initialHooks), 'foundation/hooks'),
        record('roles:index', 'role_index', castIndex.rolesIndex, 'foundation/roles/index'),
      ]
      const tiers = indexTiersOf(castIndex.rolesIndex)
      const cards = Array.isArray(cardPhase.roleCards) ? cardPhase.roleCards : []
      if (cards.length === 0) throw new StoryError('artifact-invalid', '角色卡至少需要一张')
      const names = new Set<string>()
      const slugs = new Set<string>()
      const cardRecords = cards.map((card: any) => {
        const name = String(card?.name ?? '')
        if (!tiers.has(name)) throw new StoryError('artifact-invalid', `角色卡 ${name} 不在 roles 索引里`)
        if (card?.tier !== tiers.get(name)) throw new StoryError('artifact-invalid', `角色卡 ${name} 的 tier 必须等于索引里的 ${tiers.get(name)}`)
        const slug = String(card?.slug ?? '').trim()
        if (names.has(name) || slugs.has(slug)) throw new StoryError('artifact-invalid', `角色卡重复：${name}/${slug}`)
        names.add(name); slugs.add(slug)
        return record(`role:${slug}`, 'role_card', card, `foundation/roles/${slug}`)
      })
      for (const [name] of tiers) if (!names.has(name)) throw new StoryError('artifact-invalid', `角色卡缺少索引人物：${name}`)
      const existingCards = latestRoleCardsOnDb(db)
      const slugByName = new Map<string, string>(cards.map((item: any) => [String(item?.name ?? ''), String(item?.slug ?? '').trim()]))
      const nameBySlug = new Map<string, string>(cards.map((item: any) => [String(item?.slug ?? '').trim(), String(item?.name ?? '')]))
      for (const row of existingCards) {
        let old: any
        try { old = JSON.parse(String(row.content)) } catch { continue }
        const oldName = String(old?.name ?? '')
        const oldSlug = String(old?.slug ?? '')
        if (slugs.has(oldSlug) && nameBySlug.get(oldSlug) !== oldName) {
          throw new StoryError('artifact-invalid', `slug 已被其他姓名占用：${oldSlug}`)
        }
        if (names.has(oldName) && String(row.artifact_id) !== `role:${slugByName.get(oldName) ?? ''}`) {
          deleteArtifactOnDb(db, String(row.artifact_id))
        }
      }
      const artifacts = []
      for (const item of baseRecords) {
        if (db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?').get(item.envelope.artifactId, item.envelope.revisionId) === undefined) {
          putArtifactOnDb(db, item.envelope, { search: { docId: item.envelope.artifactId, kind: item.envelope.kind, source: item.source, text: item.text } })
        }
        artifacts.push({ artifactId: item.envelope.artifactId, revisionId: item.envelope.revisionId, kind: item.envelope.kind })
      }
      dropRoleCardsOnDb(db, tiers)
      for (const item of cardRecords) {
        if (db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ? AND revision_id = ?').get(item.envelope.artifactId, item.envelope.revisionId) === undefined) {
          putArtifactOnDb(db, item.envelope, { search: { docId: item.envelope.artifactId, kind: item.envelope.kind, source: item.source, text: item.text } })
        }
        artifacts.push({ artifactId: item.envelope.artifactId, revisionId: item.envelope.revisionId, kind: item.envelope.kind })
      }
      seedFoundationHooksOnDb(db, { hooks: initialHooks, previous: previousHooks, at })
      const foundation = foundationStateOf(db)
      if (!foundation.complete) throw new StoryError('foundation-incomplete', '基础设定 bundle 写入后仍不完整')
      return { workId, stage: 'foundation', artifacts, foundation }
    })
  } finally { db.close() }
}

/** Author confirmation of a complete foundation; panel-only in the product. */
export function approveFoundation(root: any, input: any) {
  const db = openWork(root, String(input.work))
  try {
    return transaction(db, () => {
      const state = foundationStateOf(db)
      if (state.complete !== true) throw new StoryError('foundation-incomplete', 'foundation 还没生成完整：先跑完 foundation（框架/规则/初始伏笔/角色索引/角色卡）')
      const at = now()
      const source = approvalSourceOf(input)
      db.prepare('UPDATE meta SET foundation_approved_at = ?, foundation_approved_revision = ?, foundation_approved_source = ?, foundation_approved_reason = ?, updated_at = ? WHERE id = 1').run(at, foundationRevisionOf(db), source, approvalReasonOf(input), at)
      return { workId: String(input.work), approvedAt: at, foundation: foundationStateOf(db) }
    })
  } finally {
    db.close()
  }
}

/**
 * The next step of one work, derived from the stage machine. Read-only.
 * @param {string} root - workspace directory.
 * @param {string} work - work identity.
 * @returns {object} next step.
 */
export function nextStep(root: any, work: any) {
  const manifest = readManifest(root, work)
  const plannerDelegate = formOf(manifest) === 'longform' ? { delegate: { role: 'planner' } } : {}
  const db = openWork(root, manifest.workId)
  try {
    const hasPlan = (number: any) => db.prepare('SELECT 1 FROM artifacts WHERE artifact_id = ?').get(`plan:${number}`) !== undefined
    const summaryOf = (number: any) => summaryStateOf(db, number)
    const chapters = manifest.chapters
    // A reopened earlier chapter must be finished before later ones; otherwise the
  // flow keeps targeting the last chapter as before.
  const reopened = new Set<number>()
  for (const event of db.prepare("SELECT chapter, kind FROM events WHERE kind IN ('reopen', 'settle') ORDER BY seq").all()) {
    if (event.chapter === null || event.chapter === undefined) continue
    if (event.kind === 'reopen') reopened.add(Number(event.chapter))
    else reopened.delete(Number(event.chapter))
  }
  const reopenedChapter = chapters.find((entry: any) => reopened.has(entry.number) && entry.stage !== 'settled')
  const last = chapters.length === 0 ? undefined : (reopenedChapter ?? chapters[chapters.length - 1])
    const chapter = last === undefined ? 1 : last.number
    const outline = manifest.outline
    let candidate
    const step = (() => {
      if (last === undefined) {
        if (outline === undefined || outline.writtenAt === undefined) {
          if (formOf(manifest) === 'longform') {
            const foundation = foundationStateOf(db)
            if (foundation.complete !== true) {
              const dispatchStage = foundation.dispatchStage
              return {
                chapter, stage: 'planned', action: 'story_architect', foundationStage: dispatchStage,
                reason: `还没有基础设定（${dispatchStage}）：让 architect 生成故事框架、规则与角色，再写全书计划`,
                missing: [`foundation:${dispatchStage}`],
              }
            }
            if (foundation.approvedAt === undefined) {
              return {
                chapter, stage: 'planned', action: 'story_architect',
                reason: '基础设定已生成，等作者确认（面板「基础设定」或会话里的 story_approve），再写全书计划',
                blocked: ['foundation-approval'],
              }
            }
          }
          return {
            chapter, stage: 'planned', action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向，等作者确认', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter, stage: 'planned', action: 'story_plan',
            reason: '全书计划等作者确认：在面板点「确认全书计划」，然后写第 1 章章纲',
            blocked: ['outline-approval'],
          }
        }
        return { chapter, stage: 'planned', action: 'story_plan', reason: '还没有任何章节：先写第 1 章章纲', missing: [], ...plannerDelegate }
      }
      const stage = stageOf(last)
      const hasBody = last.currentRevision > 0
      if (stage === 'settled') {
        const summary = summaryOf(last.number)
        if (summary.state !== 'current') {
          return {
            chapter: last.number, stage, action: 'story_summarize',
            reason: summary.state === 'stale'
              ? `第 ${last.number} 章已定稿，但摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，后面几章的写前上下文才用得上`
              : `第 ${last.number} 章已定稿但没有摘要：先补摘要，后面几章的写前上下文才用得上`,
            missing: ['summary'],
          }
        }
        const closing = db.prepare('SELECT * FROM volumes WHERE to_ch = ?').all(last.number)
          .find(volume => typeof volume.summary !== 'string' || volume.summary.trim() === '')
        if (closing !== undefined) {
          return {
            chapter: last.number, stage, action: 'story_volume',
            reason: `第 ${last.number} 章是「${closing.title}」的最后一章：给它补一段卷摘要，下一卷的写前上下文要用`,
            missing: ['volume-summary'],
          }
        }
        const next = last.number + 1
        if (outline === undefined || outline.writtenAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter: next, stage: 'planned', action: 'story_plan',
            reason: '全书计划等作者确认：先在面板点「确认全书计划」，再写下一章章纲', blocked: ['outline-approval'],
          }
        }
        return { chapter: next, stage: 'planned', action: 'story_plan', reason: `第 ${last.number} 章已定稿：写第 ${next} 章章纲`, missing: [], ...plannerDelegate }
      }
      if (!hasPlan(last.number)) {
        if (outline === undefined || outline.writtenAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_outline',
            reason: '还没有全书计划：先写主线、卷划分与结局方向', missing: ['outline'],
          }
        }
        if (outline.approvedAt === undefined) {
          return {
            chapter: last.number, stage, action: 'story_plan',
            reason: '全书计划等作者确认：在面板点「确认全书计划」，再写章纲', blocked: ['outline-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_plan', reason: `第 ${last.number} 章缺章纲`, missing: [], ...plannerDelegate }
      }
      if (!hasBody) {
        if (planApprovalPolicy(manifest) === 'required' && last.planApproved !== true) {
          return {
            chapter: last.number, stage, action: 'story_write',
            reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」，然后写正文`,
            missing: ['body'], blocked: ['plan-approval'],
          }
        }
        return { chapter: last.number, stage, action: 'story_write', reason: `第 ${last.number} 章已有章纲，写正文`, missing: ['body'] }
      }
      // An unconfirmed plan wins over any chapter step: revising or re-reviewing
      // under a plan the author has not accepted would write against a draft.
      if (hasPlan(last.number) && planApprovalPolicy(manifest) === 'required' && last.planApproved !== true) {
        return {
          chapter: last.number, stage, action: 'story_plan',
          reason: `第 ${last.number} 章章纲等作者确认：在面板「章纲」里点「确认章纲」`,
          missing: [], blocked: ['plan-approval'],
        }
      }
      if (stage === 'written') {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      candidate = latestReviewRow(db, last.number)
      if (!reviewCovers(candidate, last)) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章已有正文，先审稿`, missing: ['review'] }
      }
      if (isCleanReview(candidate) && candidate.revision !== last.currentRevision) {
        return { chapter: last.number, stage, action: 'story_review', reason: `第 ${last.number} 章的清稿审稿针对旧版本 r${candidate.revision}：先重新审稿`, missing: ['review'] }
      }
      const blocked = {}
      const open = openObservations(candidate)
      if (open.length > 0) {
        const rounds = revisionRounds(last.currentRevision)
        if (rounds >= MAX_REVISION_ROUNDS) {
          return {
            chapter: last.number, stage, action: 'story_revise',
            reason: `第 ${last.number} 章已修订 ${rounds} 轮（上限 ${MAX_REVISION_ROUNDS}），仍有 ${open.length} 条未处理审稿：请作者裁决（接受当前版本，或说明继续修订）`,
            missing: open.map((item: any) => item.id),
            ...blocked,
            blocked: ['revision-limit', ...((blocked as { blocked?: string[] }).blocked ?? [])],
          }
        }
        return {
          chapter: last.number, stage, action: 'story_revise',
          reason: `第 ${last.number} 章还有 ${open.length} 条未处理审稿`, missing: open.map((item: any) => item.id), ...blocked,
        }
      }
      const draftRow = db.prepare("SELECT content FROM artifacts WHERE kind = 'state_draft' AND scope_chapter = ? ORDER BY rowid DESC LIMIT 1").get(last.number)
      const draft = draftRow === undefined ? undefined : JSON.parse(String(draftRow.content))
      const draftCurrent = draft !== undefined && Number(draft.revision) === Number(last.currentRevision)
      if (draftCurrent && draft.ready !== true) {
        return {
          chapter: last.number, stage, action: 'story_apply_draft',
          reason: `第 ${last.number} 章的状态草案等作者确认：接受草案或先改状态`,
          missing: [],
        }
      }
      const summary = summaryOf(last.number)
      if (summary.state !== 'current') {
        return {
          chapter: last.number, stage, action: 'story_summarize',
          reason: summary.state === 'stale'
            ? `第 ${last.number} 章摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，再定稿`
            : isCleanReview(candidate)
              ? `第 ${last.number} 章清稿审稿无问题：先写摘要，再定稿`
              : `第 ${last.number} 章已修订：先写摘要，再定稿`,
          missing: ['summary'],
        }
      }
      if (draftCurrent && draft.ready === true) {
        return {
          chapter: last.number, stage, action: 'story_finalize',
          reason: `第 ${last.number} 章状态已就绪：定稿（应用草案并入账）`,
          missing: [],
        }
      }
      return { chapter: last.number, stage, action: 'story_settle', reason: isCleanReview(candidate) ? `第 ${last.number} 章清稿审稿无问题：结算状态` : `第 ${last.number} 章已修订：结算状态`, missing: [] }
    })()
    const delegate = delegateOf(step, last, candidate)
    const method = methodFor(step, formOf(manifest))
    const planMemo = (step.blocked ?? []).includes('plan-approval')
      ? planMemoFrom(db, step.chapter)
      : undefined
    const foundationSummary = (step.blocked ?? []).includes('foundation-approval') ? foundationSummaryOf(db) : undefined
    const ask = askFor(step, last, candidate, planMemo, foundationSummary)
    return {
      workId: manifest.workId,
      ...step,
      form: formOf(manifest),
      unit: unitOf(formOf(manifest)),
      ...(delegate === undefined ? {} : { delegate }),
      ...(ask === undefined ? {} : { ask }),
      ...(method === undefined ? {} : { method }),
    }
  } finally {
    db.close()
  }
}

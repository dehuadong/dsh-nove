/**
 * Shared domain vocabulary: errors, ids, chapter stages and review text.
 *
 * These helpers carry no storage policy, so the SQLite layer, the action layer
 * and the read-only workbench can all depend on them without a cycle.
 */

import { createHash } from 'node:crypto'

export type Form = 'longform' | 'short' | 'script'
export type Stage = 'planned' | 'written' | 'reviewed' | 'revised' | 'settled'

export interface ChapterEntry {
  currentRevision?: number
  stage?: string
}

export interface ReviewLike {
  revision?: number
  observations?: Array<{ assessment?: string }>
}

/** Failure carrying a stable code for the actions' structured results. */
export class StoryError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StoryError'
    this.code = code
  }
}

/** Forms a work may declare; the form is data on the work, not a preset. */
export const WORK_FORMS = ['longform', 'short', 'script'] as const

/**
 * Display label, form contract skill and form craft skill for each form.
 *
 * `skill` is the form's own flow contract; `craft` is the shared method for that
 * form. Neither covers more than one form.
 */
export const FORM_META = Object.freeze({
  longform: { label: '长篇小说', skill: 'storycraft-longform-chapter', craft: 'storycraft-long-prose' },
  short: { label: '短篇小说', skill: 'storycraft-short-story', craft: 'storycraft-short-prose' },
  script: { label: '剧本', skill: 'storycraft-short-drama', craft: 'storycraft-script-scene' },
})

/** Current time in ISO form. */
export function now() {
  return new Date().toISOString()
}

/**
 * The unit one form calls its chapters: 章 / 篇 / 集.
 */
export function unitOf(form: unknown): string {
  if (form === 'script') return '集'
  if (form === 'short') return '篇'
  return '章'
}

/**
 * The form of one work, defaulting to the long-form flow for older works.
 */
export function formOf(manifest: unknown): Form {
  const form = (manifest as { form?: unknown } | null | undefined)?.form
  return typeof form === 'string' && (WORK_FORMS as readonly string[]).includes(form) ? form as Form : 'longform'
}

/** Whether a new chapter needs the author's plan confirmation.
 */
export function planApprovalPolicy(manifest: unknown): 'required' | 'off' {
  const value = (manifest as { planApproval?: unknown }).planApproval
  return value === 'off' ? 'off' : 'required'
}

/**
 * Turn a title into a file-safe work identity.
 */
export function slugify(title: unknown): string {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const cut = slug.slice(0, 40).replace(/-+$/g, '')
  return cut === '' ? 'work' : cut
}

/** Identities the store keeps for itself. */
const RESERVED_IDS = new Set(['works', 'trash', 'catalog', 'exports', 'backups'])

/**
 * Whether a value is already a canonical work identity (file stem / URL segment).
 */
export function isWorkId(value: unknown): boolean {
  return typeof value === 'string'
    && /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}-]*$/u.test(value)
    && !RESERVED_IDS.has(value)
}

/**
 * Normalise and validate a work identity.
 *
 * An identity is both a file stem and a URL-safe segment, so it may only hold
 * letters, numbers and inner hyphens; reserved names would collide with the
 * store's own directories.
 */
export function workIdOf(value: unknown): string {
  const id = slugify(value)
  if (!isWorkId(id)) {
    throw new StoryError('invalid-work-id', `作品 id 不合法：${String(value)}`)
  }
  return id
}

/** A file's content version: first 12 hex digits of its SHA-256. */
export function contentVersion(text: unknown): string {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12)
}

/** Zero-padded chapter file stem: 1 → `ch-0001`. */
export function chapterStem(number: number | string): string {
  return `ch-${String(number).padStart(4, '0')}`
}

/**
 * Turn a section's virtual source into an id the model may see.
 *
 * Receipts and traces never expose `works/<work>/` paths, so the work prefix and
 * a trailing slash are stripped here.
 * @param workId - work identity.
 * @param source - a section source, possibly a ` + `-joined expression.
 * @returns the first split part without the work prefix.
 */
export function sourceIdOf(workId: string, source: string): string {
  const prefix = `works/${workId}/`
  const trimmed = source.startsWith(prefix) ? source.slice(prefix.length) : source
  return trimmed.replace(/\/+$/u, '')
}

/**
 * Parse a chapter number.
 */
export function chapterNumber(value: unknown): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new StoryError('invalid-chapter', `章号必须是正整数，收到：${String(value)}`)
  }
  return number
}

/**
 * The ordered stage of one chapter. Stages only move forward unless a settled
 * chapter is explicitly reopened.
 */
export const STAGES = ['planned', 'written', 'reviewed', 'revised', 'settled'] as const

/**
 * Read a chapter's stage.
 */
export function stageOf(entry: unknown): Stage {
  const stage = (entry as ChapterEntry | null | undefined)?.stage
  return typeof stage === 'string' && (STAGES as readonly string[]).includes(stage) ? stage as Stage : 'planned'
}

/**
 * Whether a chapter may receive a delegated summary.
 *
 * Shared by `story_next` and `story_delegate` preflight so the advertised role
 * never disagrees with the admission check: revised or settled chapters pass;
 * a reviewed chapter passes only when its latest review is clean and targets
 * the current revision.
 */
export function summaryAdmissible(entry: ChapterEntry | undefined, latest: ReviewLike | undefined): boolean {
  if (entry === undefined || entry.currentRevision === 0) return false
  const stage = stageOf(entry)
  if (stage === 'revised' || stage === 'settled') return true
  return stage === 'reviewed'
    && latest !== undefined
    && latest.revision === entry.currentRevision
    && (latest.observations ?? []).filter(item => item.assessment === 'issue').length === 0
}

/**
 * Count characters of the body (CJK-aware: whitespace is excluded).
 */
export function countWords(text: unknown): number {
  const cjk = String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0
  const latin = String(text).match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0
  return cjk + latin
}

/** Character cap of one chapter summary, counted in Unicode code points. */
export const SUMMARY_MAX_CHARS = 400

/** Structured ChapterSummary fields carried by the summarizer payload. */
export const SUMMARY_FIELDS = ['title', 'characters', 'events', 'stateChanges', 'hookActivity', 'mood', 'chapterType']

/**
 * Trim a summary and count it by Unicode code point.
 */
export function trimSummary(text: unknown): { text: string, chars: number } {
  const trimmed = String(text ?? '').trim()
  return { text: trimmed, chars: [...trimmed].length }
}


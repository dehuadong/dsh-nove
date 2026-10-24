/**
 * Shared domain vocabulary: errors, ids, chapter stages and review text.
 *
 * These helpers carry no storage policy, so the SQLite layer, the action layer
 * and the read-only workbench can all depend on them without a cycle.
 */

import { createHash } from 'node:crypto'

/** Failure carrying a stable code for the actions' structured results. */
export class StoryError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - user-facing message.
   */
  constructor(code, message) {
    super(message)
    this.name = 'StoryError'
    this.code = code
  }
}

/** Forms a work may declare; the form is data on the work, not a preset. */
export const WORK_FORMS = ['longform', 'short', 'script']

/** Display label and form-specific writing skill for each form. */
export const FORM_META = Object.freeze({
  longform: { label: '长篇小说', skill: 'storycraft-write-craft' },
  short: { label: '短篇小说', skill: 'storycraft-short-story' },
  script: { label: '剧本', skill: 'storycraft-short-drama' },
})

/** Current time in ISO form. */
export function now() {
  return new Date().toISOString()
}

/**
 * The unit one form calls its chapters: 章 / 篇 / 集.
 * @param {string} form - work form.
 * @returns {string} unit noun.
 */
export function unitOf(form) {
  if (form === 'script') return '集'
  if (form === 'short') return '篇'
  return '章'
}

/**
 * The form of one work, defaulting to the long-form flow for older works.
 * @param {object} manifest - work manifest.
 * @returns {'longform'|'short'|'script'} the form.
 */
export function formOf(manifest) {
  return WORK_FORMS.includes(manifest?.form) ? manifest.form : 'longform'
}

/** Whether a new chapter needs the author's plan confirmation.
 * @param {object} manifest - work manifest.
 * @returns {'required'|'off'} the current policy.
 */
export function planApprovalPolicy(manifest) {
  return manifest.planApproval === 'off' ? 'off' : 'required'
}

/**
 * Turn a title into a file-safe work identity.
 * @param {string} title - work title.
 * @returns {string} lowercase kebab slug; falls back to `work`.
 */
export function slugify(title) {
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
 * @param {unknown} value - candidate identity.
 * @returns {boolean} true for letters/numbers with inner hyphens and no reserved name.
 */
export function isWorkId(value) {
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
 * @param {string} value - requested identity.
 * @returns {string} the normalised identity.
 */
export function workIdOf(value) {
  const id = slugify(value)
  if (!isWorkId(id)) {
    throw new StoryError('invalid-work-id', `作品 id 不合法：${String(value)}`)
  }
  return id
}

/** A file's content version: first 12 hex digits of its SHA-256. */
export function contentVersion(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12)
}

/** Zero-padded chapter file stem: 1 → `ch-0001`. */
export function chapterStem(number) {
  return `ch-${String(number).padStart(4, '0')}`
}

/**
 * Parse a chapter number.
 * @param {unknown} value - model-supplied chapter number.
 * @returns {number} a positive integer.
 */
export function chapterNumber(value) {
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
export const STAGES = ['planned', 'written', 'reviewed', 'revised', 'settled']

/**
 * Read a chapter's stage.
 * @param {object} entry - chapter entry.
 * @returns {string} one of {@link STAGES}.
 */
export function stageOf(entry) {
  return entry !== null && typeof entry === 'object' && STAGES.includes(entry.stage) ? entry.stage : 'planned'
}

/**
 * Whether a chapter may receive a delegated summary.
 *
 * Shared by `story_next` and `story_delegate` preflight so the advertised role
 * never disagrees with the admission check: revised or settled chapters pass;
 * a reviewed chapter passes only when its latest review is clean and targets
 * the current revision.
 * @param {object|undefined} entry - chapter entry.
 * @param {{text: string, revision: number}|undefined} latest - latest review.
 * @returns {boolean} true when a summarizer delegation would pass preflight.
 */
export function summaryAdmissible(entry, latest) {
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
 * @param {string} text - body text.
 * @returns {number} character count.
 */
export function countWords(text) {
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
 * @param {unknown} text - summary text.
 * @returns {{text: string, chars: number}} trimmed text and its code-point length.
 */
export function trimSummary(text) {
  const trimmed = String(text ?? '').trim()
  return { text: trimmed, chars: [...trimmed].length }
}


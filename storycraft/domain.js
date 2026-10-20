/**
 * Shared domain vocabulary: errors, ids, chapter stages and review text.
 *
 * These helpers carry no storage policy, so the SQLite layer, the action layer
 * and the read-only workbench can all depend on them without a cycle.
 */

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
  if (!/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}-]*$/u.test(id) || RESERVED_IDS.has(id)) {
    throw new StoryError('invalid-work-id', `作品 id 不合法：${String(value)}`)
  }
  return id
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
 * Read a chapter's stage, falling back to the legacy `status` field.
 * @param {object} entry - chapter entry.
 * @returns {string} one of {@link STAGES}.
 */
export function stageOf(entry) {
  if (entry !== null && typeof entry === 'object' && STAGES.includes(entry.stage)) return entry.stage
  const legacy = entry?.status
  return STAGES.includes(legacy) ? legacy : 'planned'
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

/**
 * Parse one review text into items.
 * @param {string} text - review markdown.
 * @returns {Array<{id: string, done: boolean, line: number}>} parsed items.
 */
export function parseReview(text) {
  const items = []
  for (const [index, line] of String(text).split(/\r?\n/).entries()) {
    const match = /^- \[( |x)\] (Q\d+) :: (.*)$/u.exec(line)
    if (match !== null) items.push({ id: match[2], done: match[1] === 'x', line: index })
  }
  return items
}

/**
 * Parse one review text into full items (location, problem, suggestion).
 * @param {string} text - review markdown.
 * @returns {Array<{id: string, done: boolean, location: string, problem: string, suggestion: string}>} items.
 */
export function parseReviewItems(text) {
  return String(text).split(/\r?\n/).flatMap((line) => {
    const match = /^- \[( |x)\] (Q\d+) :: (.*?) :: (.*?) :: (.*)$/u.exec(line)
    return match === null
      ? []
      : [{ id: match[2], done: match[1] === 'x', location: match[3], problem: match[4], suggestion: match[5] }]
  })
}

/**
 * Fold the event log into current entities and hooks.
 * @param {string} text - events JSONL contents.
 * @returns {{entities: Array<{name: string, facts: string[]}>, hooks: Array<{text: string, state: string, openedChapter: number}>}} folded state.
 */
export function foldEvents(text) {
  const entities = new Map()
  const hooks = new Map()
  const lines = String(text).split(/\r?\n/)
  // A reopened chapter's events before its last reopen no longer describe the
  // current state: the author rewrote the body, so the old settlement is void.
  const reopenAt = new Map()
  for (const [index, line] of lines.entries()) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.kind === 'reopen' && Number.isInteger(event.chapter)) reopenAt.set(event.chapter, index)
  }
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const reopenedAt = reopenAt.get(event?.chapter)
    if (reopenedAt !== undefined && index < reopenedAt) continue
    if (event?.kind === 'entity') {
      const existing = entities.get(event.name) ?? { name: event.name, facts: [] }
      existing.facts.push(...(event.facts ?? []))
      entities.set(event.name, existing)
    } else if (event?.kind === 'hook') {
      const existing = hooks.get(event.text) ?? { text: event.text, state: 'opened', openedChapter: event.chapter }
      hooks.set(event.text, { ...existing, state: event.state, updatedChapter: event.chapter })
    }
  }
  return { entities: [...entities.values()], hooks: [...hooks.values()] }
}

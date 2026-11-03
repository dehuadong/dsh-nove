/** Shared domain vocabulary: errors, forms, stages, ids and formatting. */

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

export class StoryError extends Error {
  code: string
  /** What the caller should do next; part of the failure receipt, not prose to parse. */
  next?: string
  /** Whether the same call may succeed after the described correction. */
  retryable?: boolean
  constructor(code: string, message: string, next?: string, retryable?: boolean) {
    super(message)
    this.name = 'StoryError'
    this.code = code
    if (next !== undefined) this.next = next
    if (retryable !== undefined) this.retryable = retryable
  }
}

export const WORK_FORMS = ['longform', 'short', 'script'] as const

export const FORM_META = Object.freeze({
  longform: { label: '长篇小说', skill: 'storycraft-longform-chapter', craft: 'storycraft-long-prose' },
  short: { label: '短篇小说', skill: 'storycraft-short-story', craft: 'storycraft-short-prose' },
  script: { label: '剧本', skill: 'storycraft-short-drama', craft: 'storycraft-script-scene' },
})

export function now() {
  return new Date().toISOString()
}

export function unitOf(form: unknown): string {
  if (form === 'script') return '集'
  if (form === 'short') return '篇'
  return '章'
}

export function formOf(manifest: unknown): Form {
  const form = (manifest as { form?: unknown } | null | undefined)?.form
  return typeof form === 'string' && (WORK_FORMS as readonly string[]).includes(form) ? form as Form : 'longform'
}

export function slugify(title: unknown): string {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const cut = slug.slice(0, 40).replace(/-+$/g, '')
  return cut === '' ? 'work' : cut
}

const RESERVED_IDS = new Set(['works', 'trash', 'catalog', 'exports', 'backups'])

export function isWorkId(value: unknown): boolean {
  return typeof value === 'string'
    && /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}-]*$/u.test(value)
    && !RESERVED_IDS.has(value)
}

export function workIdOf(value: unknown): string {
  const id = slugify(value)
  if (!isWorkId(id)) {
    throw new StoryError('invalid-work-id', `作品 id 不合法：${String(value)}`)
  }
  return id
}

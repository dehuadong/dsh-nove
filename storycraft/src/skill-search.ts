/** Host-side skill reference search: SKILL.md and Markdown references only. */

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { searchTokens } from './search-text.ts'
import { skillRevision } from './skill-evidence.ts'
import { catalogSkillIds, skillDirectory } from './skills.ts'

export interface SkillHit {
  id: string
  kind: 'skill'
  source: string
  location: string
  text: string
  score: number
  chapter: null
}

interface Segment {
  id: string
  path: string
  source: string
  location: string
  heading: string
  body: string
}

interface CacheEntry {
  revision: string
  segments: Segment[]
}

const cache = new Map<string, CacheEntry>()
const SLUG_MAX = 40

function markdownFiles(dir: string, prefix = ''): Array<{ path: string, file: string }> {
  const out: Array<{ path: string, file: string }> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...markdownFiles(full, relative))
    else if (entry.isFile() && (relative === 'SKILL.md' || (relative.startsWith('references/') && relative.endsWith('.md')))) {
      out.push({ path: relative, file: full })
    }
  }
  return out
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '').slice(0, SLUG_MAX) || 'section'
}

function segmentsOf(skill: string, path: string, text: string): Segment[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const segments: Segment[] = []
  let first = 0
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    if (close > 0) first = close + 1
  }
  let heading = basename(path).replace(/\.md$/u, '')
  let start = first + 1
  let body: string[] = []
  let fenced = false
  const flush = (_end: number) => {
    const content = body.join('\n').trim()
    if (content !== '') {
      const firstBody = body.findIndex(line => line.trim() !== '')
      let lastBody = body.length - 1
      while (lastBody > firstBody && body[lastBody]?.trim() === '') lastBody -= 1
      const bodyStart = start + firstBody
      const bodyEnd = start + lastBody
      const source = `skill:${skill}/${path}`
      segments.push({
        id: `${source}#${slug(heading)}:${bodyStart}`,
        path,
        source,
        location: `${heading} · L${bodyStart}-${bodyEnd}`,
        heading,
        body: content,
      })
    }
  }
  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^\s*```/u.test(line)) {
      fenced = !fenced
      body.push(line)
      continue
    }
    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*$/u.exec(line)
    if (match !== null) {
      flush(index)
      heading = match[2] ?? basename(path)
      start = index + 2
      body = []
    } else {
      body.push(line)
    }
  }
  const last = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  flush(last)
  return segments
}

function skillSegments(id: string, packageRoot?: string, onError?: (error: unknown) => void): Segment[] | undefined {
  const dir = skillDirectory(id, packageRoot)
  if (dir === undefined) return undefined
  let revision: string
  try {
    revision = skillRevision(id, { root: packageRoot })
  } catch (error) {
    onError?.(error)
    console.warn(`[storycraft] skill ${id} is unreadable for search: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  const cacheKey = `${packageRoot ?? ''}:${id}`
  const cached = cache.get(cacheKey)
  if (cached?.revision === revision) return cached.segments
  try {
    const segments = markdownFiles(dir).flatMap(file => segmentsOf(id, file.path, readFileSync(file.file, 'utf8')))
    cache.set(cacheKey, { revision, segments })
    return segments
  } catch (error) {
    onError?.(error)
    console.warn(`[storycraft] skill ${id} failed to index: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** Search skill Markdown by lexical token coverage; missing skills yield no hits. */
export function searchSkillReferences(query: string, options: { root?: string, skills?: readonly string[], references?: Record<string, string[]>, onError?: (error: unknown) => void } = {}): SkillHit[] {
  const tokens = [...new Set(searchTokens(query).split(' ').filter(token => token !== ''))]
  if (tokens.length === 0) return []
  const ids = options.skills ?? [...catalogSkillIds(options.root)]
  const hits: SkillHit[] = []
  for (const id of ids) {
    const segments = skillSegments(id, options.root, options.onError)
    if (segments === undefined) continue
    const allowed = options.references?.[id]
    for (const segment of segments) {
      if (options.references !== undefined && segment.path.startsWith('references/') && !(allowed ?? []).includes(segment.path)) continue
      const haystack = searchTokens(`${segment.heading}\n${segment.body}`).split(' ')
      const counts = new Map<string, number>()
      for (const token of haystack) counts.set(token, (counts.get(token) ?? 0) + 1)
      let matched = 0
      let occurrences = 0
      for (const token of tokens) {
        const count = counts.get(token) ?? 0
        if (count > 0) matched += 1
        occurrences += count
      }
      if (matched === 0) continue
      const headingBonus = tokens.filter(token => segment.heading.toLowerCase().includes(token)).length
      const score = matched / tokens.length + occurrences / (haystack.length + 1) + headingBonus * 0.05
      hits.push({ id: segment.id, kind: 'skill', source: segment.source, location: segment.location, text: segment.body, score, chapter: null })
    }
  }
  return hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
}

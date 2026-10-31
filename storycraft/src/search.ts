/** Unified panel search: story memory/material candidates plus skill references. */

import { snippetFor } from './retrieval.ts'
import { searchSkillReferences } from './skill-search.ts'
import { searchTokens } from './search-text.ts'
import { readManifest } from './storage.ts'
import { searchMemory } from './store-db.ts'

export type SearchKind = 'memory' | 'material' | 'skill'

/** Per-kind result quota for the panel/API. */
export const SEARCH_KIND_LIMIT = 3
/** Snippet length; full candidate bodies never reach the panel. */
export const SEARCH_SNIPPET_CHARS = 240
/** Query is clipped in the consumer, not rejected. */
export const SEARCH_QUERY_MAX = 500

export interface UnifiedHit {
  id: string
  kind: string
  source: string
  location?: string
  snippet: string
  score: number
  chapter: number | null
}

export interface SearchGroup {
  kind: SearchKind
  hits: UnifiedHit[]
}

function topHits(candidates: any[], tokens: string[]): UnifiedHit[] {
  return [...candidates]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0) || String(left.id).localeCompare(String(right.id)))
    .slice(0, SEARCH_KIND_LIMIT)
    .map(candidate => ({
      id: String(candidate.id),
      kind: String(candidate.kind ?? ''),
      source: String(candidate.source ?? ''),
      ...(candidate.location === undefined ? {} : { location: String(candidate.location) }),
      snippet: snippetFor(candidate.text, tokens, SEARCH_SNIPPET_CHARS),
      score: Number(candidate.score ?? 0),
      chapter: candidate.chapter === null || candidate.chapter === undefined ? null : Number(candidate.chapter),
    }))
}

/** Search one work's memory/materials plus global skill references. */
export function searchUnified(
  root: string,
  work: string,
  query: string,
  options: { skillRoot?: string } = {},
): { groups: SearchGroup[] } {
  readManifest(root, work)
  const clipped = String(query).slice(0, SEARCH_QUERY_MAX)
  const tokens = [...new Set(searchTokens(clipped).split(' ').filter(token => token !== ''))]
  if (tokens.length === 0) return { groups: [] }
  const groups: SearchGroup[] = []
  const candidates = searchMemory(root, work, clipped)
  groups.push({ kind: 'memory', hits: topHits(candidates.filter(candidate => candidate.kind !== 'material'), tokens) })
  groups.push({ kind: 'material', hits: topHits(candidates.filter(candidate => candidate.kind === 'material'), tokens) })
  groups.push({ kind: 'skill', hits: topHits(searchSkillReferences(clipped, { root: options.skillRoot }), tokens) })
  return { groups }
}

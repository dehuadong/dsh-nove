/** Host-side skill evidence: which skills an assembly asked the child to load. */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { StoryError } from './domain.ts'
import { catalogSkillIds, skillDirectory } from './skills.ts'

/** One skill id and its content revision, never the body text. */
export interface SkillEvidence {
  id: string
  revision: string
  stage?: 'settler' | 'validator'
}

function filesUnder(dir: string, prefix = ''): Array<{ path: string; file: string }> {
  const out: Array<{ path: string; file: string }> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(full, relative))
    else if (entry.isFile() && (relative === 'SKILL.md' || relative.startsWith('references/'))) {
      out.push({ path: relative.replaceAll('\\', '/'), file: full })
    }
  }
  return out
}

/** Stable short hash over SKILL.md and every reference, independent of path separators. */
export function skillRevision(id: string, options: { root?: string } = {}): string {
  const dir = skillDirectory(id, options.root)
  if (dir === undefined) throw new StoryError('skill-missing', `技能 ${id} 没有可读目录`)
  try {
    const hash = createHash('sha256')
    for (const item of filesUnder(dir).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
      hash.update(item.path)
      hash.update('\0')
      hash.update(readFileSync(item.file))
      hash.update('\0')
    }
    return hash.digest('hex').slice(0, 12)
  } catch {
    throw new StoryError('skill-missing', `技能 ${id} 的内容不可读`)
  }
}

/** Evidence for every requested skill; missing catalog/directory/file fails loudly. */
export function skillEvidence(ids: readonly string[], options: { root?: string } = {}): SkillEvidence[] {
  if (ids.length === 0) return []
  const catalog = catalogSkillIds(options.root)
  const seen = new Set<string>()
  const evidence: SkillEvidence[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    if (!catalog.has(id)) throw new StoryError('skill-missing', `技能 ${id} 不在 catalog.json`)
    evidence.push({ id, revision: skillRevision(id, options) })
  }
  return evidence
}

/** Mark evidence with the stage that requested it. */
export function atStage(evidence: readonly SkillEvidence[], stage: 'settler' | 'validator'): SkillEvidence[] {
  return evidence.map(item => ({ ...item, stage }))
}

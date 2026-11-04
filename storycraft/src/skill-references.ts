/** Deterministic reference loading for role prompts that must not depend on model choice. */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StoryError } from './domain.ts'
import { SKILLS_ROOT } from './skills.ts'

/** One skill reference the runtime reads into a prompt. */
export interface SkillReference {
  skill: string
  path: string
}

const cache = new Map<string, string>()

/** The packaged skills directory; `SKILLS_ROOT` owns the package layout. */
export function skillRoots(): string[] {
  return [join(SKILLS_ROOT, 'skills')]
}

/**
 * References the architect must receive at one foundation stage.
 *
 * `foundation` carries the method plus the hook ledger contract; the manual
 * `hooks` stage only needs the ledger contract.
 */
export function architectReferences(stage: string): SkillReference[] {
  if (stage === 'foundation') {
    return [
      { skill: 'storycraft-architect', path: 'references/foundation-design.md' },
      { skill: 'storycraft-long-settle', path: 'references/state-projection.md' },
    ]
  }
  if (stage === 'hooks') return [{ skill: 'storycraft-long-settle', path: 'references/state-projection.md' }]
  return []
}

/** Read one reference, failing loudly when the packaged skills are missing. */
export function loadSkillReference(reference: SkillReference, roots: string[] = skillRoots()): string {
  const key = `${reference.skill}/${reference.path}@${roots.join('|')}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  for (const root of roots) {
    const file = join(root, reference.skill, reference.path)
    try {
      if (!statSync(file).isFile()) continue
    } catch {
      continue
    }
    const content = readFileSync(file, 'utf8')
    cache.set(key, content)
    return content
  }
  throw new StoryError(
    'architect-reference-missing',
    `缺少 architect 的必读参考：${reference.skill}/${reference.path}`,
    `预期位置：${roots.map(root => join(root, reference.skill, reference.path)).join(' 或 ')}`,
  )
}

/** The prompt block listing the already-loaded references. */
export function renderReferenceBlock(references: SkillReference[], roots: string[] = skillRoots()): string {
  if (references.length === 0) return ''
  return [
    '## 必读参考（运行时已加载，直接遵守）',
    '',
    ...references.map(reference => `### ${reference.skill}/${reference.path}\n\n${loadSkillReference(reference, roots)}\n`),
  ].join('\n')
}

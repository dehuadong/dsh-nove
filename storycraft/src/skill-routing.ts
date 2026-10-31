/** Single source of role/form/step → skill and method-reference routing. */

import { FORM_META } from './domain.ts'

type FormName = 'longform' | 'short' | 'script'

/** One skill plus the reference the role is allowed to read at this node. */
export interface RoleMethod {
  skill: string
  reference?: string
}

function formName(value: unknown): FormName {
  return value === 'short' || value === 'script' ? value : 'longform'
}

function craft(form: FormName): string {
  return FORM_META[form].craft
}

/** Skills one role loads; fixed roles are independent of form. */
export function roleSkills(role: string, form: unknown): string[] {
  const normalized = formName(form)
  if (role === 'writer') return [craft(normalized)]
  if (role === 'planner') {
    const method = roleMethod('planner', normalized)
    return method === undefined ? [craft(normalized)] : [...new Set([craft(normalized), method.skill])]
  }
  if (role === 'reviewer') return ['storycraft-review']
  if (role === 'reviser') return ['storycraft-revise-craft']
  if (role === 'architect') return ['storycraft-architect', 'storycraft-long-foundation']
  if (role === 'settler') return ['storycraft-state-settler']
  if (role === 'validator') return ['storycraft-state-check']
  return []
}

/** The method reference one role reads at this node. */
export function roleMethod(role: string, form: unknown): RoleMethod | undefined {
  const normalized = formName(form)
  if (role === 'writer') {
    return {
      skill: craft(normalized),
      reference: normalized === 'script'
        ? 'references/episode-scene-craft.md'
        : normalized === 'short' ? 'references/production-checklist.md' : 'references/scene-dialogue-and-length-budget.md',
    }
  }
  if (role === 'planner') {
    return {
      skill: normalized === 'script' ? 'storycraft-script-spec' : normalized === 'short' ? 'storycraft-short-outline' : 'storycraft-long-plan',
      reference: normalized === 'script' ? 'references/spec.md' : normalized === 'short' ? 'references/outline.md' : 'references/chapter-plan.md',
    }
  }
  if (role === 'reviewer') return { skill: 'storycraft-review', reference: 'references/review-dimensions.md' }
  return undefined
}

/** Step-level method routing used by `story_next`. */
export function methodForStep(action: string, form: unknown): RoleMethod | undefined {
  const normalized = formName(form)
  if (action === 'story_outline') {
    return {
      skill: normalized === 'script' ? 'storycraft-script-spec' : normalized === 'short' ? 'storycraft-short-outline' : 'storycraft-long-foundation',
      reference: normalized === 'script' ? 'references/spec.md' : normalized === 'short' ? 'references/outline.md' : 'references/foundation-design.md',
    }
  }
  if (action === 'story_plan') return roleMethod('planner', normalized)
  if (action === 'story_write') return roleMethod('writer', normalized)
  if (action === 'story_review') return { skill: 'storycraft-review', reference: 'references/review-dimensions.md' }
  if (action === 'story_revise') return { skill: 'storycraft-revise-craft' }
  if (action === 'story_settle') return { skill: 'storycraft-long-settle', reference: 'references/state-projection.md' }
  return undefined
}

/** Existing test/import names kept stable while routing moves here. */
export function writerSkills(form: unknown): string[] {
  return [craft(formName(form))]
}

export function plannerSkills(form: unknown): string[] {
  return roleSkills('planner', form)
}

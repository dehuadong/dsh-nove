/** Architect foundation contract: ordered phases and stage identity. */

export const FOUNDATION_PHASES = ['outline', 'details', 'cast_index', 'cards'] as const

export const FOUNDATION_STAGES = ['foundation', 'design', 'frame', 'rules', 'roles', 'cards'] as const

export type FoundationStage = typeof FOUNDATION_STAGES[number]

export function isFoundationStage(stage: string): stage is FoundationStage {
  return (FOUNDATION_STAGES as readonly string[]).includes(stage)
}

export interface FoundationDocuments {
  storyFrame?: string
  volumeMap?: string
  rolesIndex?: unknown
}

export interface ArchitectPromptRequest {
  proposal?: { premise: string, characters: string }
  work: string
  stage: FoundationStage
  instruction: string
  delegationId: string
  manifest: any
  foundation: FoundationDocuments
}

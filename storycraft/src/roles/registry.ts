/** Single registry of role modules: contract, prompt lines, payload schema and landing. */

import { contract as architectContract } from './architect/contract.ts'
import { validateArchitect } from './architect/tool-schema.ts'
import { land as plannerLand } from './planner/agent.ts'
import { contract as plannerContract, loadInput as plannerLoadInput, preflight as plannerPreflight } from './planner/contract.ts'
import { lines as plannerLines } from './planner/prompts.ts'
import { validate as planner } from './planner/tool-schema.ts'
import { land as writerLand } from './writer/agent.ts'
import { contract as writerContract, loadInput as writerLoadInput, preflight as writerPreflight } from './writer/contract.ts'
import { lines as writerLines } from './writer/prompts.ts'
import { validate as writer } from './writer/tool-schema.ts'
import { land as reviewerLand, landRetry as reviewerLandRetry } from './reviewer/agent.ts'
import { contract as reviewerContract, loadInput as reviewerLoadInput, preflight as reviewerPreflight } from './reviewer/contract.ts'
import { lines as reviewerLines } from './reviewer/prompts.ts'
import { validate as reviewer } from './reviewer/tool-schema.ts'
import { land as reviserLand } from './reviser/agent.ts'
import { contract as reviserContract, loadInput as reviserLoadInput, preflight as reviserPreflight } from './reviser/contract.ts'
import { lines as reviserLines } from './reviser/prompts.ts'
import { validate as reviser } from './reviser/tool-schema.ts'
import { land as summarizerLand } from './summarizer/agent.ts'
import { contract as summarizerContract, loadInput as summarizerLoadInput, preflight as summarizerPreflight } from './summarizer/contract.ts'
import { lines as summarizerLines } from './summarizer/prompts.ts'
import { validate as summarizer } from './summarizer/tool-schema.ts'
import { contract as settlerContract } from './settler/contract.ts'
import { validate as settler } from './settler/tool-schema.ts'
import { contract as validatorContract } from './validator/contract.ts'
import { validate as validator } from './validator/tool-schema.ts'
import type { LandInput, RoleLanding } from './landing-types.ts'
import type { RoleInputDeps, RoleInputState } from '../runtime/role-input-kit.ts'

/** Context one payload validator may read; most roles ignore it. */
export interface RoleValidationInput {
  stage?: string
}

/** One role's module surface. */
export interface RoleModule {
  schema: { validate(payload: any, input?: RoleValidationInput): string | undefined }
  contract: {
    name: string
    label: string
    nextAction?: string
    requiresChapter: boolean
    traceAfterLand?: boolean
    usesMode?: boolean
    revisionLimitBlocked?: boolean
    mechanicalFindings?: boolean
    loadInput?(deps: RoleInputDeps): RoleInputState
    preflight?(deps: RoleInputDeps, error: (code: string, message: string) => never): void
  }
  prompts?: { lines(input: { mode: string }): string[] }
  agent?: {
    land(input: LandInput): Promise<RoleLanding>
    landRetry?(error: { code?: string, message?: string } | undefined, input?: { revision?: number }): string | undefined
  }
}

/** Role name → module. */
export const ROLES: Record<string, RoleModule> = {
  architect: { schema: { validate: (payload, input) => validateArchitect(payload, input?.stage) }, contract: architectContract },
  planner: {
    schema: { validate: payload => planner(payload) },
    contract: { ...plannerContract, loadInput: plannerLoadInput, preflight: plannerPreflight },
    prompts: { lines: plannerLines },
    agent: { land: plannerLand },
  },
  writer: {
    schema: { validate: payload => writer(payload) },
    contract: { ...writerContract, loadInput: writerLoadInput, preflight: writerPreflight },
    prompts: { lines: writerLines },
    agent: { land: writerLand },
  },
  reviewer: {
    schema: { validate: payload => reviewer(payload) },
    contract: { ...reviewerContract, loadInput: reviewerLoadInput, preflight: reviewerPreflight },
    prompts: { lines: reviewerLines },
    agent: { land: reviewerLand, landRetry: reviewerLandRetry },
  },
  reviser: {
    schema: { validate: payload => reviser(payload) },
    contract: { ...reviserContract, loadInput: reviserLoadInput, preflight: reviserPreflight },
    prompts: { lines: reviserLines },
    agent: { land: reviserLand },
  },
  summarizer: {
    schema: { validate: payload => summarizer(payload) },
    contract: { ...summarizerContract, loadInput: summarizerLoadInput, preflight: summarizerPreflight },
    prompts: { lines: summarizerLines },
    agent: { land: summarizerLand },
  },
  settler: { schema: { validate: payload => settler(payload) }, contract: settlerContract },
  validator: { schema: { validate: payload => validator(payload) }, contract: validatorContract },
}

/** Roles `story_delegate` accepts. */
export const DELEGATE_ROLES = ['architect', 'planner', 'writer', 'reviewer', 'reviser', 'summarizer'] as const

/** Receipt label per delegated role. */
export const ROLE_META = Object.fromEntries(
  DELEGATE_ROLES.map(role => [role, { label: ROLES[role].contract.label }]),
) as Record<string, { label: string }>

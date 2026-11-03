/** Tool registry surface: plugin metadata and stable error envelopes for every action. */

import { StoryError } from '../domain.ts'
import type { FailureEnvelope } from './types.ts'

/** Services this plugin injects. */
export const inject: string[] = ['tools']

/** Provider label used in diagnostics. */
export const name: string = 'storycraft-tools'

import {
  delegationDepthOf,
  sessionOf,
  workspaceOf,
  sessionCurrentOf,
  DELEGATED_DENIAL,
  DELEGATED_DENIED_TOOLS,
  failureOf,
} from './runtime.ts'
import { rawDefinitions } from './actions/index.ts'
import { resolveWork } from '../current.ts'
import { SCOPE_MESSAGES, scopeDenial } from '../scope.ts'
import { join } from 'node:path'
import type { ActionDefinition } from './types.ts'

/**
 * The registered action list: `work` is optional and resolved per session.
 * @returns action definitions.
 */
function definitions(ctx: DshContext): ActionDefinition[] {
  return rawDefinitions(ctx).map(withCurrentWork)
}

/**
 * Make `work` optional on one action and resolve it from the session.
 *
 * An explicit `work` still wins, so callers that know the id are unaffected; the
 * schema stops requiring it so a session pointed at a work can omit it.
 * @param definition - registered action definition.
 * @returns the same definition with a wrapped execute.
 */
function withCurrentWork(definition: ActionDefinition): ActionDefinition {
  // story_current reports the pointer itself; resolving it first would throw
  // exactly when the author still has no work.
  if (definition.name === 'story_current' || definition.name === 'story_recover') return definition
  const parameters = definition.parameters
  const hasWork = parameters?.properties !== undefined && 'work' in parameters.properties
  if (!hasWork) return definition
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter(name => name !== 'work')
    : []
  const execute = definition.execute
  return {
    ...definition,
    parameters: { ...parameters, ...(required.length === 0 ? { required: [] } : { required }) },
    async execute(args, exec) {
      // Refuse a delegated writer before resolving `work`, so the child sees
      // "subagents do not land" instead of a misleading work-selection error.
      if (definition.mutates === true && delegationDepthOf(exec) > 0) {
        return failureOf(new StoryError('subagent-cannot-land', DELEGATED_DENIAL))
      }
      const session = sessionOf(exec)
      const root = workspaceOf(exec)
      const current = sessionCurrentOf(root, session)
      const explicit = typeof args?.work === 'string' && args.work.trim() !== '' ? args.work.trim() : undefined
      // One session drives one work: a call that names a different work would
      // silently write into the wrong book, so it is refused and the author
      // switches in the panel instead.
      // Without an active work the session may not reach into the works tree at
      // all: discussion happens before any book is entered, and only the panel
      // (or a successful story_init in an empty session) points it at one.
      if (explicit !== undefined && current === undefined) {
        throw new StoryError('work-not-selected',
          '本会话还没有进入任何作品：先在面板进入一个作品，再操作它；讨论阶段不读历史作品')
      }
      if (explicit !== undefined && current !== undefined && explicit !== current) {
        throw new StoryError('work-mismatch',
          `本会话当前作品是 ${current}，不能直接操作 ${explicit}：先在面板切换到那部作品`)
      }
      const work = resolveWork(session, explicit)
      if (work === undefined) {
        throw new StoryError('work-not-selected',
          '本会话还没有当前作品：先在面板进入一个作品，或在调用里带上 work')
      }
      return execute({ ...args, work }, exec)
    },
  }
}

/**
 * Walk to the root session of one call (a subagent points at its dispatcher).
 * @param ctx - plugin context.
 * @param session - calling session.
 * @returns root session.
 */
function rootSessionOf(ctx: DshContext, session: DshSession): DshSession | undefined {
  let current = session
  const sessions = typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = current?.header?.parentSession
    if (typeof parent !== 'string' || parent === '') return current
    const next = sessions?.get?.(parent)
    if (next === undefined) return current
    current = next
  }
  return current
}

/**
 * The live working directory of one session, falling back to its header.
 * @param ctx - plugin context.
 * @param session - calling session.
 * @returns absolute directory.
 */
function workingDirectoryOf(ctx: DshContext, session: DshSession): string | undefined {
  const service = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined
  try {
    const value = service?.get?.(session)
    if (typeof value === 'string' && value !== '') return value
  } catch {
    // fall through to the immutable header
  }
  const header = session?.header?.cwd
  return typeof header === 'string' && header !== '' ? header : undefined
}

/**
 * Deny file/DB access outside the session's work scope. Details live in scope.js.
 * @param ctx - plugin context.
 * @param exec - pending tool call.
 * @returns denial copy.
 */
function scopeDenialOf(ctx: DshContext, exec: DshToolExecution): string | undefined {
  const session = exec?.agent?.session
  if (session === undefined) return undefined
  const root = rootSessionOf(ctx, session)
  const rootCwd = root?.header?.cwd
  const cwd = workingDirectoryOf(ctx, session)
  if (typeof rootCwd !== 'string' || rootCwd === '' || cwd === undefined) return SCOPE_MESSAGES.discussion
  const currentWork = sessionCurrentOf(rootCwd, root?.header?.id ?? session.header?.id)
  return scopeDenial({
    tool: exec.name,
    arguments: exec.arguments ?? {},
    cwd,
    worksRoot: join(rootCwd, 'works'),
    dbRoot: join(rootCwd, '.storycraft'),
    ...(currentWork === undefined ? {} : { currentWork }),
  })
}

/**
 * Register the studio actions in the calling (preset) scope.
 * @param ctx - plugin context (services: tools).
 */
export function apply(ctx: DshContext): void {
  // The guard lives in this preset's scope, so it applies to the main agent and
  // to every subagent spawned into the same composition; the depth predicate
  // keeps the main agent unrestricted.
  const denyDelegatedWrites = (exec: DshToolExecution) => (
    delegationDepthOf(exec) > 0 && DELEGATED_DENIED_TOOLS.has(exec.name as string) ? DELEGATED_DENIAL : undefined
  )
  const denyOutOfScope = (exec: DshToolExecution) => scopeDenialOf(ctx, exec)
  const disposers = [
    ctx.tools.guard(denyDelegatedWrites),
    ctx.tools.guard(denyOutOfScope),
    ...definitions(ctx).map(definition => ctx.tools.register(definition)),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'storycraft-tools: work actions')
}


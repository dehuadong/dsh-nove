/**
 * Refuse destructive shell commands aimed outside the workspace, before the
 * tool is dispatched.
 *
 * The check is a static classification of the command text (see `classify.js`):
 * a delete or move whose resolved target falls outside the workspace root is
 * denied, and the reason names the path plus the reversible alternative. Writes
 * inside the workspace are untouched, so ordinary build and test commands keep
 * working.
 *
 * The root is the session's sandbox boundary — the same value the file sandbox
 * enforces — not this process's directory (the Host runs inside the profile) and
 * not a configuration value (a configurable guard is one edit away from being
 * turned off by the same mistake it exists to stop).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { classifyCommand, describeDenial } from './classify.js'

export const inject = ['tools']

/**
 * The boundary this call belongs to.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ session?: unknown } | undefined} agent - the calling agent, when any.
 * @returns {string | undefined} an absolute workspace root.
 */
function workspaceBoundary(ctx, agent) {
  const policy = ctx.get('sandboxPolicy')
  if (policy === undefined) return undefined
  try {
    const session = agent?.session
    const resolved = session === undefined ? policy.workspaceRoot : policy.resolve({ session }).workspaceRoot
    return path.resolve(resolved)
  } catch {
    // A session without a usable cwd still gets the deployment default.
    return path.resolve(policy.workspaceRoot)
  }
}

export function apply(ctx) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'pwsh' && exec.name !== 'bash') return next()
    const args = exec.arguments
    if (args === null || typeof args !== 'object') return next()
    const command = args.command
    if (typeof command !== 'string' || command.trim() === '') return next()

    const root = workspaceBoundary(ctx, exec.agent)
    if (root === undefined) return next()

    const cwd = typeof args.workdir === 'string' && args.workdir !== ''
      ? path.resolve(root, args.workdir)
      : root
    const trashScript = path.join(root, 'scripts', 'trash.mjs')
    const verdict = classifyCommand(command, { allowedRoots: [root], cwd })
    if (verdict.ok) return next()
    return {
      kind: 'deny',
      reason: describeDenial(verdict, {
        allowedRoots: [root],
        trashHint: existsSync(trashScript) ? trashScript : undefined,
      }),
    }
  })
}

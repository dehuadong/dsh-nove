/**
 * Source-write gate: no implement authorization, no source write.
 *
 * Authorization comes from the exact GATES command in an owner-authored
 * message, or from `implement_gate({action:'authorize'})` asking the DSH
 * approval service for a task-level grant. Documentation paths and docs-only
 * git/trash operations stay writable so the note lifecycle is never blocked.
 */

import path from 'node:path'
import { classifyPath, gateCommand, shellAccess, shellOutside } from './classify.js'

export const inject = ['tools']

/** Resolve the same workspace boundary the shell guard uses. */
function workspaceBoundary(ctx, agent) {
  const policy = ctx.get('sandboxPolicy')
  try {
    if (policy !== undefined) {
      const session = agent?.session
      return path.resolve(session === undefined ? policy.workspaceRoot : policy.resolve({ session }).workspaceRoot)
    }
  } catch {
    // Fall through to the process directory when a policy cannot resolve.
  }
  return process.cwd()
}

function deny(reason) {
  return { kind: 'deny', reason, info: { name: 'implement-gate', code: 'implement-required' } }
}

/** One agent's gate state; absent means none. */
function stateOf(states, agent, root) {
  const key = (agent === undefined || agent === null ? 'anonymous' : String(agent.id)) + '\0' + root
  let state = states.get(key)
  if (state === undefined) {
    state = { authorization: 'none', work: 'active', task: null, blockReason: null }
    states.set(key, state)
  }
  return state
}

/** Render the gate tool result as one JSON text block. */
function toolOutput(value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function apply(ctx) {
  const states = new Map()

  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    const header = agent?.session?.header
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    let transition
    for (const message of messages) {
      transition = gateCommand(message, header) ?? transition
    }
    if (transition !== undefined) {
      const state = stateOf(states, agent, workspaceBoundary(ctx, agent))
      if (transition.kind === 'planning') {
        state.authorization = 'planning'
        state.work = 'active'
        state.task = transition.task
      } else {
        state.authorization = 'implement'
        state.work = 'active'
        state.task = transition.task
      }
    }
    return next()
  })

  ctx.tools.register({
    name: 'implement_gate',
    description: 'Implement authorization state for this session. authorize asks the approval service for task-level source-write permission; block freezes source writes; complete clears the authorization after Verify. status is read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['authorize', 'block', 'complete', 'status'] },
        reason: { type: 'string' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => toolOutput(value),
    },
    async execute(args, exec) {
      const state = stateOf(states, exec.agent, workspaceBoundary(ctx, exec.agent))
      if (args.action === 'status') {
        return { ok: true, authorization: state.authorization, work: state.work, task: state.task, blockReason: state.blockReason }
      }
      if (args.action === 'complete') {
        state.authorization = 'none'
        state.work = 'complete'
        state.blockReason = null
        return { ok: true, authorization: state.authorization, work: state.work, task: state.task }
      }
      if (args.action === 'block') {
        state.work = 'blocked'
        state.blockReason = typeof args.reason === 'string' ? args.reason : null
        return { ok: true, authorization: state.authorization, work: state.work, task: state.task, blockReason: state.blockReason }
      }
      if (args.action !== 'authorize') throw new Error(`unknown implement_gate action: ${String(args.action)}`)
      if (state.work === 'blocked') return { ok: false, code: 'blocked', next: '先解决合同阻塞并输入规范 implement 命令' }
      if (state.authorization === 'implement' && state.work === 'active') {
        return { ok: true, authorization: state.authorization, work: state.work, task: state.task }
      }
      const approval = ctx.get('approval')
      if (approval === undefined) return { ok: false, code: 'approval-unavailable', next: '输入规范 implement 命令' }
      let override
      try { override = approval.overrideOf?.(exec.agent?.session) } catch { override = undefined }
      if (override === 'never') return { ok: false, code: 'approval-disabled', next: '输入规范 implement 命令' }
      let outcome
      try {
        outcome = await approval.request({
          agent: exec.agent,
          toolName: 'implement_gate',
          reason: typeof args.reason === 'string' && args.reason.trim() !== '' ? args.reason : `授权任务「${state.task ?? '当前任务'}」后续源码写入，直到 Verify 完成`,
          displayReason: {
            en: `Authorize source writes for task ${state.task ?? 'current task'} until Verify completes`,
            zh: `授权任务「${state.task ?? '当前任务'}」后续源码写入，直到 Verify 完成`,
          },
          signal: exec.signal,
        })
      } catch {
        return { ok: false, code: 'approval-unavailable', next: '输入规范 implement 命令' }
      }
      if (outcome === 'allowed-once') {
        state.authorization = 'implement'
        state.work = 'active'
        state.task = state.task ?? 'approval'
        return { ok: true, authorization: state.authorization, work: state.work, task: state.task, outcome }
      }
      return { ok: false, code: `approval-${String(outcome)}`, next: '输入规范 implement 命令' }
    },
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'implement_gate') return next()
    const root = workspaceBoundary(ctx, exec.agent)
    const state = stateOf(states, exec.agent, root)

    if (exec.name === 'write' || exec.name === 'edit') {
      const file = exec.arguments?.file_path
      if (typeof file !== 'string' || file === '') return next()
      const target = classifyPath(root, file)
      if (target.outside) return deny('工作区外写入被拒绝')
      if (target.docs) return next()
      if (state.authorization === 'implement' && state.work === 'active') return next()
      return deny(state.work === 'blocked'
        ? `当前任务已 blocked${state.blockReason === null ? '' : `（${state.blockReason}）`}：先解决合同阻塞，再输入「批准，使用技能 implement 执行实现 {工作项}」重新授权。`
        : '当前任务没有 implement 授权：你只批准了 planning。输入「批准，使用技能 implement 执行实现 {工作项}」，或使用 implement_gate authorize。')
    }

    if (exec.name === 'pwsh' || exec.name === 'bash') {
      const command = exec.arguments?.command
      if (typeof command !== 'string' || command.trim() === '') return next()
      const requested = exec.arguments?.workdir
      const cwd = typeof requested === 'string' && requested !== '' ? path.resolve(root, requested) : root
      if (classifyPath(root, cwd).outside) return deny('工作区外写入被拒绝')
      if (shellOutside(command, cwd)) return deny('工作区外写入被拒绝')
      const access = shellAccess(command, cwd)
      if (!access.write) return next()
      if (access.docsOnly) return next()
      if (state.authorization === 'implement' && state.work === 'active') return next()
      return deny(state.work === 'blocked'
        ? `当前任务已 blocked${state.blockReason === null ? '' : `（${state.blockReason}）`}：源码写被拒绝。`
        : '当前任务没有 implement 授权：源码写被拒绝。先输入「批准，使用技能 implement 执行实现 {工作项}」。')
    }

    return next()
  })
}

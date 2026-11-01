/**
 * Source-write gate with project opt-in and per-session persisted state.
 *
 * A workspace enables the gate with `.agents/implement-gate.json`
 * (`{"enabled": true}`). Without it every write passes through, so other
 * projects never see this repository's policy. Enabled workspaces keep one
 * state file per session under `.agents/state/implement-gate/`, so parallel
 * sessions and reloads do not share or lose authorization.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess, shellOutside } from './classify.js'

export const inject = ['tools']

const MARKER = '.agents/implement-gate.json'
const STATE_DIR = '.agents/state/implement-gate'

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

function enabled(root) {
  try {
    const value = JSON.parse(readFileSync(path.join(root, MARKER), 'utf8'))
    return value?.enabled === true
  } catch {
    return false
  }
}

function stateFile(root, agent) {
  const id = createHash('sha1').update(String(agent?.id ?? 'anonymous')).digest('hex').slice(0, 16)
  return path.join(root, STATE_DIR, `${id}.json`)
}

function defaultState() {
  return { phase: 'discuss', work: 'active', task: null, blockReason: null, updatedAt: null }
}

function loadState(root, agent) {
  try {
    const value = JSON.parse(readFileSync(stateFile(root, agent), 'utf8'))
    const phase = ['discuss', 'planning', 'implement', 'complete'].includes(value?.phase) ? value.phase : 'discuss'
    return {
      phase,
      work: value?.work === 'blocked' ? 'blocked' : 'active',
      task: typeof value?.task === 'string' ? value.task : null,
      blockReason: typeof value?.blockReason === 'string' ? value.blockReason : null,
      updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    }
  } catch {
    return defaultState()
  }
}

function saveState(root, agent, state) {
  const file = stateFile(root, agent)
  mkdirSync(path.dirname(file), { recursive: true })
  const next = { ...state, updatedAt: new Date().toISOString() }
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2))
  renameSync(temp, file)
  return next
}

function deny(reason) {
  return { kind: 'deny', reason, info: { name: 'implement-gate', code: 'implement-required' } }
}

function sourceDeny(state) {
  if (state.work === 'blocked') return deny('当前任务已 blocked：先解决合同阻塞，再输入规范 implement 命令。')
  if (state.phase === 'discuss') return deny('当前处于 discuss：只允许沟通与阅读，不允许写源码或规划 Note。')
  if (state.phase === 'complete') return deny('当前任务已完成：源码写需要新的 implement 授权。')
  return deny('当前任务没有 implement 授权：先输入「批准，使用技能 implement 执行实现 {工作项}」。')
}

function protectedCommand(command) {
  return /\.agents[\\/]implement-gate\.json|\.agents[\\/]state[\\/]implement-gate/iu.test(String(command ?? ''))
}

function toolOutput(value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    const root = workspaceBoundary(ctx, agent)
    if (!enabled(root)) return next()
    const header = agent?.session?.header
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    let transition
    for (const message of messages) {
      transition = gateCommand(message, header) ?? transition
    }
    if (transition !== undefined) {
      const state = loadState(root, agent)
      state.phase = transition.kind
      state.work = 'active'
      state.task = transition.task
      state.blockReason = null
      try { saveState(root, agent, state) } catch { /* fail closed; old state stays */ }
    }
    return next()
  })

  ctx.tools.register({
    name: 'implement_gate',
    description: 'Session and workspace authorization state for source writes. authorize asks the approval service for task-level permission; end-planning returns to discuss (blocking both source and planning-note writes); block freezes source writes; complete ends the task; status is read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['authorize', 'end-planning', 'block', 'complete', 'status'] },
        reason: { type: 'string' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => toolOutput(value),
    },
    async execute(args, exec) {
      const root = workspaceBoundary(ctx, exec.agent)
      const isEnabled = enabled(root)
      if (args.action === 'status') {
        const state = isEnabled ? loadState(root, exec.agent) : defaultState()
        return { ok: true, enabled: isEnabled, ...state }
      }
      if (!isEnabled) return { ok: false, code: 'not-enabled', next: '当前项目没有 .agents/implement-gate.json' }
      const state = loadState(root, exec.agent)
      if (args.action === 'end-planning') {
        if (state.phase !== 'planning') return { ok: false, code: 'not-planning', phase: state.phase }
        state.phase = 'discuss'
        state.blockReason = null
        return { ok: true, enabled: true, ...saveState(root, exec.agent, state) }
      }
      if (args.action === 'complete') {
        state.phase = 'complete'
        state.blockReason = null
        return { ok: true, enabled: true, ...saveState(root, exec.agent, state) }
      }
      if (args.action === 'block') {
        state.work = 'blocked'
        state.blockReason = typeof args.reason === 'string' ? args.reason : null
        return { ok: true, enabled: true, ...saveState(root, exec.agent, state) }
      }
      if (args.action !== 'authorize') throw new Error(`unknown implement_gate action: ${String(args.action)}`)
      if (state.work === 'blocked') return { ok: false, code: 'blocked', phase: state.phase }
      if (state.phase === 'implement' && state.work === 'active') return { ok: true, enabled: true, ...state }
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
          reason: typeof args.reason === 'string' && args.reason.trim() !== ''
            ? args.reason
            : `授权任务「${state.task ?? '当前任务'}」后续源码写入，直到 Verify 完成`,
          displayReason: {
            en: `Authorize source writes for task ${state.task ?? 'current task'} until Verify completes`,
            zh: `授权任务「${state.task ?? '当前任务'}」后续源码写入，直到 Verify 完成`,
          },
          signal: exec.signal,
        })
      } catch {
        return { ok: false, code: 'approval-unavailable', next: '输入规范 implement 命令' }
      }
      if (outcome !== 'allowed-once') return { ok: false, code: `approval-${String(outcome)}`, next: '输入规范 implement 命令' }
      state.phase = 'implement'
      state.work = 'active'
      state.task = state.task ?? 'approval'
      return { ok: true, enabled: true, ...saveState(root, exec.agent, state), outcome }
    },
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'implement_gate') return next()
    const root = workspaceBoundary(ctx, exec.agent)
    if (!enabled(root)) return next()
    const state = loadState(root, exec.agent)

    if (exec.name === 'write' || exec.name === 'edit') {
      const file = exec.arguments?.file_path
      if (typeof file !== 'string' || file === '') return next()
      const target = classifyPath(root, file)
      if (target.outside) return deny('工作区外写入被拒绝')
      if (target.protected) return deny('implement-gate 的状态与启用标记不允许模型写入')
      if (target.proposed) {
        if (state.phase !== 'planning' && state.phase !== 'implement') return deny('propose 规划 Note 只在 planning/implement 阶段可写；要修改请先输入 planning 命令。')
        return next()
      }
      if (target.docs) return next()
      if (state.phase === 'implement' && state.work === 'active') return next()
      return sourceDeny(state)
    }

    if (exec.name === 'pwsh' || exec.name === 'bash') {
      const command = exec.arguments?.command
      if (typeof command !== 'string' || command.trim() === '') return next()
      if (protectedCommand(command)) return deny('implement-gate 的状态与启用标记不允许模型写入')
      const requested = exec.arguments?.workdir
      const cwd = typeof requested === 'string' && requested !== '' ? path.resolve(root, requested) : root
      if (classifyPath(root, cwd).outside) return deny('工作区外写入被拒绝')
      if (shellOutside(command, cwd)) return deny('工作区外写入被拒绝')
      const access = shellAccess(command, cwd)
      if (!access.write) return next()
      if (access.docsOnly && !access.touchesProposed) return next()
      if (access.docsOnly && (state.phase === 'planning' || state.phase === 'implement')) return next()
      if (state.phase === 'discuss') return deny('当前处于 discuss：不允许写源码或 propose 规划 Note；只允许阅读与沟通。')
      if (state.phase === 'complete') return deny('当前任务已完成：需要新的 implement 授权。')
      if (state.phase === 'implement' && state.work === 'active') return next()
      return sourceDeny(state)
    }
    return next()
  })
}

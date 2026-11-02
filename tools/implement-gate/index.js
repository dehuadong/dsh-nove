/**
 * Code-write gate with project opt-in, per-project config, and per-session
 * persisted state. Policy comes from .agents/implement-gate.json (version 2).
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess } from './classify.js'
import { loadConfig, STATE_DIR } from './config.js'

export const inject = ['tools']

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

function misconfigured(config) {
  return deny(`implement-gate 配置不可用：${config.reason ?? 'invalid config'}（${config.configPath}）`)
}

function sourceDeny(state) {
  if (state.work === 'blocked') return deny('当前任务已 blocked：先解决合同阻塞，再输入规范 implement 命令。')
  if (state.phase === 'discuss') return deny('当前处于 discuss：只允许沟通与阅读，不允许写代码文件。')
  if (state.phase === 'complete') return deny('当前任务已完成：代码写需要新的 implement 授权。')
  return deny('当前任务没有 implement 授权：先输入「批准，使用技能 implement 执行实现 {工作项}」。')
}

function toolOutput(value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    const root = workspaceBoundary(ctx, agent)
    const config = loadConfig(root)
    if (config.kind !== 'ok') return next()
    const header = agent?.session?.header
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    let transition
    for (const message of messages) {
      transition = gateCommand(message, header, config.policy.commands) ?? transition
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
    description: 'Session and workspace authorization state for code files. authorize asks the approval service for task-level permission; end-planning returns to discuss; block freezes code writes; complete ends the task; status is read-only. Policy comes from .agents/implement-gate.json.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['authorize', 'end-planning', 'end-docs', 'block', 'complete', 'status'] },
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
      const config = loadConfig(root)
      if (args.action === 'status') {
        if (config.kind === 'invalid') return { ok: false, code: 'misconfigured', reason: config.reason, configPath: config.configPath }
        if (config.kind !== 'ok') return { ok: true, enabled: false, configPath: config.configPath, ...defaultState() }
        return {
          ok: true,
          enabled: true,
          configPath: config.configPath,
          configVersion: config.policy.version,
          ...loadState(root, exec.agent),
        }
      }
      if (args.action === 'end-docs') return { ok: false, code: 'not-supported', next: '文档不再需要范围授权' }
      if (config.kind === 'invalid') return { ok: false, code: 'misconfigured', reason: config.reason, configPath: config.configPath }
      if (config.kind !== 'ok') return { ok: false, code: 'not-enabled', next: '当前项目没有 .agents/implement-gate.json 或未启用' }
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
            : `授权任务「${state.task ?? '当前任务'}」后续代码写入，直到 Verify 完成`,
          displayReason: {
            en: `Authorize code writes for task ${state.task ?? 'current task'} until Verify completes`,
            zh: `授权任务「${state.task ?? '当前任务'}」后续代码写入，直到 Verify 完成`,
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
    const config = loadConfig(root)
    if (config.kind === 'invalid') return misconfigured(config)
    if (config.kind !== 'ok') return next()
    const policy = config.policy
    const state = loadState(root, exec.agent)

    if (exec.name === 'write' || exec.name === 'edit') {
      const file = exec.arguments?.file_path
      if (typeof file !== 'string' || file === '') return next()
      const target = classifyPath(root, file, policy)
      if (target.outside) return deny('工作区外写入被拒绝')
      if (target.protected) return deny('implement-gate 的状态与启用标记不允许模型写入')
      if (target.proposed) {
        if (state.phase !== 'planning' && state.phase !== 'implement') return deny('propose 规划 Note 只在 planning/implement 阶段可写；要修改请先输入 planning 命令。')
        return next()
      }
      if (!target.code) return next()
      if (state.phase === 'implement' && state.work === 'active') return next()
      return sourceDeny(state)
    }

    if (exec.name === 'pwsh' || exec.name === 'bash') {
      const command = exec.arguments?.command
      if (typeof command !== 'string' || command.trim() === '') return next()
      const requested = exec.arguments?.workdir
      const cwd = typeof requested === 'string' && requested !== '' ? path.resolve(root, requested) : root
      const access = shellAccess(command, root, policy, cwd)
      if (!access.write) return next()
      if (access.protectedTargets.length > 0) return deny('implement-gate 的状态与启用标记不允许模型写入')
      if (access.outsideTargets.length > 0) return deny('工作区外写入被拒绝')
      if (classifyPath(root, cwd, policy).outside) return deny('工作区外写入被拒绝')
      if (access.codeTargets.length > 0 || access.forceCode) {
        if (state.phase === 'implement' && state.work === 'active') return next()
        return sourceDeny(state)
      }
      return next()
    }
    return next()
  })
}

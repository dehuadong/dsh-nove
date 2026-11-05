/**
 * Code-write gate with project opt-in, per-project config, and per-session
 * persisted state. Policy comes from the nearest .agents/implement-gate.json at
 * or above the session workspace (version 2).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { classifyPath, gateCommand, shellAccess } from './classify.js'
import { findGateRoot, findProjectRoot, loadConfig, MARKER, STATE_DIR, validateConfig } from './config.js'

const DEFAULT_CODE_EXTENSIONS = [
  '.rs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.kt', '.kts',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs',
  '.rb', '.php', '.swift', '.scala', '.lua',
  '.sh', '.ps1', '.sql',
  '.css', '.scss', '.html', '.vue', '.svelte', '.astro',
]
const DEFAULT_CODE_PATHS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.client.json',
  'cordis.patch.yml',
  '.github/workflows/',
]
const DEFAULT_COMMANDS = {
  planning: '^批准，使用(?:技能\\s*)?planning\\s+执行规划\\s+(.+)$',
  implement: '^批准，使用(?:技能\\s*)?implement\\s+执行实现\\s+(.+)$',
}

export const inject = ['tools']

/**
 * Resolve the session workspace root, or undefined when no policy can name it.
 * @param ctx - plugin context carrying the sandbox policy.
 * @param agent - receiving Agent.
 * @returns the absolute workspace root.
 */
function workspaceBoundary(ctx, agent) {
  const policy = ctx.get('sandboxPolicy')
  if (policy === undefined) return undefined
  try {
    const session = agent?.session
    return path.resolve(session === undefined ? policy.workspaceRoot : policy.resolve({ session }).workspaceRoot)
  } catch {
    return undefined
  }
}

function stateFile(root, agent) {
  const id = createHash('sha1').update(String(agent?.id ?? 'anonymous')).digest('hex').slice(0, 16)
  return path.join(root, STATE_DIR, `${id}.json`)
}

/** Resolve the session workspace and the policy that governs it. */
function resolveGate(ctx, agent) {
  const workspace = workspaceBoundary(ctx, agent)
  if (workspace === undefined) {
    return { workspace: undefined, root: undefined, config: { kind: 'missing', configPath: null } }
  }
  const root = findGateRoot(workspace)
  return {
    workspace,
    root,
    config: root === undefined
      ? { kind: 'missing', configPath: path.join(workspace, MARKER) }
      : loadConfig(root),
  }
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

function initConfig() {
  return {
    enabled: true,
    version: 2,
    codeExtensions: DEFAULT_CODE_EXTENSIONS,
    codePaths: DEFAULT_CODE_PATHS,
    protected: [MARKER, STATE_DIR],
    commands: DEFAULT_COMMANDS,
  }
}

/**
 * Create the default policy at `root`. The generated object is validated before
 * any file exists, so a broken default can never leave a marker that denies all
 * writes.
 * @param root - project root that receives the marker.
 * @returns the created marker path and version, or the refusal.
 */
function writeInit(root) {
  const marker = path.join(root, MARKER)
  if (existsSync(marker)) return { ok: false, code: 'already-exists', configPath: marker }
  const value = initConfig()
  const config = validateConfig(value, marker)
  if (config.kind !== 'ok') {
    return { ok: false, code: 'misconfigured', reason: config.reason, configPath: marker }
  }
  mkdirSync(path.dirname(marker), { recursive: true })
  const temp = `${marker}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temp, marker)
  return { ok: true, enabled: true, configPath: marker, configVersion: config.policy.version }
}

/**
 * Execute the owner-only `/implement-gate init` command. It creates the marker
 * only when the session workspace is itself the project root, so a subdirectory
 * session can never grow a nested policy.
 * @param ctx - plugin context carrying the sandbox policy.
 * @param invocation - submitted command line and receiving agent.
 * @returns a human-facing success or error outcome.
 */
async function initCommand(ctx, invocation) {
  if (String(invocation?.rawInput ?? '').trim() !== 'init') {
    return { kind: 'error', text: '用法：/implement-gate init' }
  }
  const workspace = workspaceBoundary(ctx, invocation.agent)
  if (workspace === undefined) {
    return { kind: 'error', text: '无法确定当前会话的工作区，未初始化。' }
  }
  const existing = findGateRoot(workspace)
  if (existing !== undefined) {
    return { kind: 'error', text: `implement-gate 已存在：${path.join(existing, MARKER)}（未覆盖）` }
  }
  const project = findProjectRoot(workspace)
  if (project !== undefined && path.resolve(project) !== path.resolve(workspace)) {
    return { kind: 'error', text: `当前工作区不是项目根（项目根：${project}）；请在项目根打开会话后执行 /implement-gate init。` }
  }
  const result = writeInit(workspace)
  if (result.ok !== true) {
    return { kind: 'error', text: `初始化失败：${result.reason ?? result.code}（${result.configPath ?? workspace}）` }
  }
  return { kind: 'success', text: `已启用 implement-gate：${result.configPath}（v${result.configVersion}）。写代码需要 implement 授权。` }
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent
    const gate = resolveGate(ctx, agent)
    if (gate.config.kind !== 'ok') return next()
    const header = agent?.session?.header
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    let transition
    for (const message of messages) {
      transition = gateCommand(message, header, gate.config.policy.commands) ?? transition
    }
    if (transition !== undefined) {
      const state = loadState(gate.root, agent)
      state.phase = transition.kind
      state.work = 'active'
      state.task = transition.task
      state.blockReason = null
      try { saveState(gate.root, agent, state) } catch { /* fail closed; old state stays */ }
    }
    return next()
  })

  ctx.tools.register({
    name: 'implement_gate',
    description: 'Session and workspace authorization state for code files in a project governed by .agents/implement-gate.json. authorize asks the approval service for task-level permission; end-planning returns to discuss; block freezes code writes; complete ends the task; status is read-only.',
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
      const gate = resolveGate(ctx, exec.agent)
      const config = gate.config
      if (args.action === 'status') {
        if (config.kind === 'invalid') return { ok: false, code: 'misconfigured', reason: config.reason, configPath: config.configPath }
        if (config.kind !== 'ok') return { ok: true, enabled: false, configPath: config.configPath, ...defaultState() }
        return {
          ok: true,
          enabled: true,
          configPath: config.configPath,
          configVersion: config.policy.version,
          ...loadState(gate.root, exec.agent),
        }
      }
      if (args.action === 'end-docs') return { ok: false, code: 'not-supported', next: '文档不再需要范围授权' }
      if (config.kind === 'invalid') return { ok: false, code: 'misconfigured', reason: config.reason, configPath: config.configPath }
      if (config.kind !== 'ok') return { ok: false, code: 'not-enabled', next: '当前项目没有 .agents/implement-gate.json 或未启用' }
      const state = loadState(gate.root, exec.agent)
      if (args.action === 'end-planning') {
        if (state.phase !== 'planning') return { ok: false, code: 'not-planning', phase: state.phase }
        state.phase = 'discuss'
        state.blockReason = null
        return { ok: true, enabled: true, ...saveState(gate.root, exec.agent, state) }
      }
      if (args.action === 'complete') {
        state.phase = 'complete'
        state.blockReason = null
        return { ok: true, enabled: true, ...saveState(gate.root, exec.agent, state) }
      }
      if (args.action === 'block') {
        state.work = 'blocked'
        state.blockReason = typeof args.reason === 'string' ? args.reason : null
        return { ok: true, enabled: true, ...saveState(gate.root, exec.agent, state) }
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
      return { ok: true, enabled: true, ...saveState(gate.root, exec.agent, state), outcome }
    },
  }, {
    when: context => {
      const gate = resolveGate(ctx, context.agent)
      return gate.config.kind === 'ok' || gate.config.kind === 'invalid'
    },
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'implement_gate') return next()
    const gate = resolveGate(ctx, exec.agent)
    const config = gate.config
    if (config.kind === 'invalid') return misconfigured(config)
    if (config.kind !== 'ok') return next()
    const policy = config.policy
    const workspace = gate.workspace
    const state = loadState(gate.root, exec.agent)

    if (exec.name === 'write' || exec.name === 'edit') {
      const file = exec.arguments?.file_path
      if (typeof file !== 'string' || file === '') return next()
      const target = classifyPath(workspace, file, policy)
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
      const cwd = typeof requested === 'string' && requested !== '' ? path.resolve(workspace, requested) : workspace
      const access = shellAccess(command, workspace, policy, cwd)
      if (!access.write) return next()
      if (access.protectedTargets.length > 0) return deny('implement-gate 的状态与启用标记不允许模型写入')
      if (access.outsideTargets.length > 0) return deny('工作区外写入被拒绝')
      if (classifyPath(workspace, cwd, policy).outside) return deny('工作区外写入被拒绝')
      if (access.codeTargets.length > 0 || access.forceCode) {
        if (state.phase === 'implement' && state.work === 'active') return next()
        return sourceDeny(state)
      }
      return next()
    }
    return next()
  })

  // The command is optional: the gate must still apply in a profile without the
  // human-command service. `ctx.inject` starts this child once the service exists,
  // so reading it here cannot race the service's own registration.
  ctx.inject(['commands'], commandCtx => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: 'implement-gate',
      description: 'Initialize the implement-gate code-write policy for this project',
      input: { hint: 'init' },
      handler: invocation => initCommand(ctx, invocation),
    }))
  })
}

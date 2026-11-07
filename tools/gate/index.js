import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPath, shellAccess } from './src/classify.js'
import { findGateRoot, loadConfig } from './src/config.js'
import { childStateId, defaultState, loadState, saveState } from './src/state.js'

export const inject = ['tools']
const SKILLS = fileURLToPath(new URL('./skills', import.meta.url))
const SKILL_NAMES = ['gate-planning', 'gate-plan-review', 'gate-implement', 'gate-code-review', 'gate-verify']
const REVIEW_LIMIT = 5
const MAX_WORKERS = 12

function workspaceBoundary(ctx, agent) {
  try {
    const policy = ctx.get('sandboxPolicy')
    const resolved = policy?.resolve?.(agent)
    if (resolved?.workspaceRoot !== undefined) return resolved.workspaceRoot
  } catch { /* fall through */ }
  return agent?.session?.header?.cwd
}

function resolveGate(ctx, agent) {
  const workspace = workspaceBoundary(ctx, agent)
  if (workspace === undefined) return { workspace: undefined, root: undefined, config: { kind: 'none' } }
  const root = findGateRoot(workspace)
  if (root === undefined) return { workspace, root: undefined, config: { kind: 'none' } }
  return { workspace, root, config: loadConfig(root) }
}

function skillText(name) {
  try {
    return readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8')
  } catch {
    return ''
  }
}

function jsonOf(result) {
  return result?.structured ?? result?.payload ?? result?.value
}

function findingsOf(result) {
  const value = jsonOf(result)
  if (Array.isArray(value?.findings)) return value.findings
  return []
}

function workerPrompt({ node, task, skill, input, round, write }) {
  return [
    `# Gate phase worker: ${node}`,
    `task: ${task}`,
    `round: ${round ?? 'n/a'}`,
    `write: ${write}`,
    'The following skill is the method for this node. Follow it fully.',
    skill,
    '## Inputs',
    input ?? '(none)',
    '## Output contract',
    'Finish by calling structured_output with an object: {"ok":true,"findings":[],"summary":"..."}.',
    'findings must be an array of material findings; do not invent them.',
    'Do not spawn subagents. Do not edit outside the stated write scope.',
  ].join('\n')
}

function workerPhase(node) {
  if (node === 'plan' || node === 'plan-revise') return 'planning'
  if (node === 'implement' || node === 'implement-revise') return 'implement'
  if (node === 'verify') return 'docs'
  return 'discuss'
}

function stateForWorker(root, childId, node, task) {
  const agent = childStateId(childId)
  saveState(root, agent, { ...defaultState(), phase: workerPhase(node), node, task })
  return agent
}

function clearWorker(root, childId) {
  try { rmSync(path.join(root, '.agents/state/gate', `${createHash('sha1').update(String(childId)).digest('hex').slice(0, 16)}.json`), { force: true }) } catch { /* best effort */ }
}

async function worker(ctx, gate, parent, state, node, task, skillName, input, write, round) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) throw new Error('subagents service unavailable')
  const childId = `session-${randomUUID()}`
  stateForWorker(gate.root, childId, node, task)
  const controller = new AbortController()
  let activation
  try {
    activation = await subagents.startActivation({
      provider: 'spawn',
      label: `gate-${node}`,
      childId,
      parent,
      cwd: gate.workspace,
      delivery: 'caller',
      signal: controller.signal,
      prompt: [{ type: 'text', text: workerPrompt({ node, task, skill: skillText(skillName), input, round, write }) }],
    })
    return await activation.result
  } finally {
    try { await activation?.dispose() } catch { /* best effort */ }
    clearWorker(gate.root, childId)
  }
}

async function planRun(ctx, gate, parent, state) {
  const task = state.task
  let findings = []
  for (;;) {
    const planned = await worker(ctx, gate, parent, state, 'plan', task, 'gate-planning', `Work item: ${task}`, 'proposed Note/working item only', state.rounds.planReview)
    void planned
    findings = []
    for (;;) {
      state.rounds.planReview += 1
      saveState(gate.root, parent, state)
      const review = await worker(ctx, gate, parent, state, 'plan-review', task, 'gate-plan-review', `Work item: ${task}`, 'read-only', state.rounds.planReview)
      findings = findingsOf(review)
      if (findings.length === 0) break
      if (state.rounds.planReview >= REVIEW_LIMIT) {
        state.phase = 'discuss'
        state.work = 'blocked'
        state.blockReason = 'plan-review-rounds-exhausted'
        saveState(gate.root, parent, state)
        return
      }
      await worker(ctx, gate, parent, state, 'plan-revise', task, 'gate-planning', `Resolve: ${JSON.stringify(findings)}`, 'proposed Note/working item only', state.rounds.planReview)
    }
    state.phase = 'discuss'
    state.node = null
    state.work = 'active'
    state.blockReason = null
    saveState(gate.root, parent, state)
    return
  }
}

async function implementRun(ctx, gate, parent, state) {
  const task = state.task
  const implemented = await worker(ctx, gate, parent, state, 'implement', task, 'gate-implement', `Work item: ${task}`, 'code', state.rounds.codeReview)
  void implemented
  for (;;) {
    state.rounds.codeReview += 1
    saveState(gate.root, parent, state)
    const [standards, spec] = await Promise.all([
      worker(ctx, gate, parent, state, 'code-review', task, 'gate-code-review', 'Axis: Standards', 'read-only', state.rounds.codeReview),
      worker(ctx, gate, parent, state, 'code-review', task, 'gate-code-review', 'Axis: Spec', 'read-only', state.rounds.codeReview),
    ])
    const findings = [...findingsOf(standards), ...findingsOf(spec)]
    if (findings.length > 0) {
      if (state.rounds.codeReview >= REVIEW_LIMIT) {
        state.phase = 'discuss'
        state.work = 'blocked'
        state.blockReason = 'code-review-rounds-exhausted'
        saveState(gate.root, parent, state)
        return
      }
      await worker(ctx, gate, parent, state, 'implement-revise', task, 'gate-implement', `Resolve: ${JSON.stringify(findings)}`, 'code', state.rounds.codeReview)
      continue
    }
    const verified = await worker(ctx, gate, parent, state, 'verify', task, 'gate-verify', `Work item: ${task}`, 'read-only/receipts', state.rounds.codeReview)
    if (jsonOf(verified)?.ok === false) {
      await worker(ctx, gate, parent, state, 'implement-revise', task, 'gate-implement', `Verify failed: ${JSON.stringify(jsonOf(verified))}`, 'code', state.rounds.codeReview)
      continue
    }
    state.phase = 'complete'
    state.node = null
    state.work = 'active'
    state.blockReason = null
    saveState(gate.root, parent, state)
    return
  }
}

function statusText(state) {
  return [`状态：${state.phase}`, `节点：${state.node ?? '无'}`, `工作项：${state.task ?? '无'}`, `work：${state.work}`, `blockReason：${state.blockReason ?? '无'}`].join('\n')
}

function command(ctx, agent, rawInput) {
  const task = String(rawInput ?? '').trim()
  const gate = resolveGate(ctx, agent)
  if (gate.config.kind !== 'ok') return { kind: 'error', text: '当前项目没有启用的 .agents/gate.json' }
  if (task === '') return { kind: 'error', text: '缺少工作项' }
  const state = loadState(gate.root, agent)
  if (state.phase !== 'discuss' && state.phase !== 'complete') return { kind: 'error', text: `当前 phase 是 ${state.phase}` }
  state.phase = 'orchestrating'
  state.task = task
  state.work = 'active'
  state.blockReason = null
  state.node = null
  state.rounds = { planReview: 0, codeReview: 0 }
  saveState(gate.root, agent, state)
  return { gate, state }
}

export function apply(ctx) {
  ctx.inject(['systemPrompt'], scope => {
    scope.systemPrompt.section({
      name: 'gate:protocol',
      order: scope.systemPrompt.getSectionOrder('PLAN_POLICY') + 1,
      text: context => {
        const gate = resolveGate(ctx, context.agent)
        if (gate.config.kind !== 'ok') return ''
        const state = loadState(gate.root, context.agent)
        return `## Gate\n${statusText(state)}\nMain agent is orchestrating; do not write code or docs. Report the state block and worker results only.`
      },
    })
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'write' || exec.name === 'edit') {
      const gate = resolveGate(ctx, exec.agent)
      if (gate.config.kind !== 'ok') return next()
      const state = loadState(gate.root, exec.agent)
      const target = classifyPath(gate.workspace, exec.arguments?.file_path, gate.config.policy)
      if (target.outside) return { kind: 'deny', reason: '工作区外写入被拒绝' }
      if (target.protected) return { kind: 'deny', reason: 'Gate 配置和状态不可写' }
      if (state.phase === 'discuss' || state.phase === 'complete') return { kind: 'deny', reason: '当前阶段不允许写入' }
      if (state.phase === 'orchestrating') return { kind: 'deny', reason: '主代理编排中，不允许直接写入' }
      if (target.code && state.phase !== 'implement') return { kind: 'deny', reason: '只有 implement 阶段允许写代码' }
      if (target.docs && !['planning', 'docs', 'implement'].includes(state.phase)) return { kind: 'deny', reason: '文档写入未授权' }
      return next()
    }
    if (exec.name === 'pwsh' || exec.name === 'bash') {
      const gate = resolveGate(ctx, exec.agent)
      if (gate.config.kind !== 'ok') return next()
      const state = loadState(gate.root, exec.agent)
      const cwd = exec.arguments?.workdir ?? gate.workspace
      const access = shellAccess(exec.arguments?.command ?? '', gate.workspace, gate.config.policy, cwd)
      if (!access.write) return next()
      if (access.protectedTargets.length > 0) return { kind: 'deny', reason: 'Gate 配置和状态不可写' }
      if (access.outsideTargets.length > 0) return { kind: 'deny', reason: '工作区外写入被拒绝' }
      if (state.phase === 'orchestrating' || state.phase === 'discuss' || state.phase === 'complete') return { kind: 'deny', reason: '当前阶段不允许写入' }
      if (access.codeTargets.length > 0 && state.phase !== 'implement') return { kind: 'deny', reason: '只有 implement 阶段允许写代码' }
      return next()
    }
    return next()
  })

  ctx.inject(['skills'], scope => {
    for (const name of SKILL_NAMES) {
      const content = skillText(name)
      if (content === '') continue
      scope.skills.register({ name, description: `Gate phase skill: ${name}`, source: 'plugin:gate', content })
    }
  })

  ctx.inject(['commands'], scope => {
    const register = (name, description, handler) => scope.commands.register({
      name,
      description,
      input: { hint: '<工作项>' },
      handler,
    })
    register('gate-plan', 'Start planning orchestration', async invocation => {
      const result = command(ctx, invocation.agent, invocation.rawInput)
      if (result.kind === 'error') return result
      void planRun(ctx, result.gate, invocation.agent, result.state).catch(error => {
        const state = loadState(result.gate.root, invocation.agent)
        state.phase = 'discuss'; state.work = 'blocked'; state.blockReason = String(error?.message ?? error)
        saveState(result.gate.root, invocation.agent, state)
      })
      return { kind: 'success', text: `已启动 planning：${result.state.task}` }
    })
    register('gate-implement', 'Start implementation orchestration', async invocation => {
      const result = command(ctx, invocation.agent, invocation.rawInput)
      if (result.kind === 'error') return result
      void implementRun(ctx, result.gate, invocation.agent, result.state).catch(error => {
        const state = loadState(result.gate.root, invocation.agent)
        state.phase = 'discuss'; state.work = 'blocked'; state.blockReason = String(error?.message ?? error)
        saveState(result.gate.root, invocation.agent, state)
      })
      return { kind: 'success', text: `已启动 implement：${result.state.task}` }
    })
    register('gate-docs', 'Start docs governance', async invocation => {
      const task = String(invocation.rawInput ?? '').trim()
      if (task === '') return { kind: 'error', text: '缺少范围' }
      const gate = resolveGate(ctx, invocation.agent)
      if (gate.config.kind !== 'ok') return { kind: 'error', text: '当前项目没有启用的 .agents/gate.json' }
      const state = loadState(gate.root, invocation.agent)
      state.phase = 'docs'; state.task = task; state.work = 'active'; state.blockReason = null; state.node = null
      saveState(gate.root, invocation.agent, state)
      return { kind: 'success', text: `进入 docs：${task}` }
    })
    register('gate-return', 'Return to discuss', async invocation => {
      const gate = resolveGate(ctx, invocation.agent)
      if (gate.config.kind !== 'ok') return { kind: 'error', text: '当前项目没有启用的 .agents/gate.json' }
      const state = loadState(gate.root, invocation.agent)
      state.phase = 'discuss'; state.node = null; state.blockReason = null
      saveState(gate.root, invocation.agent, state)
      return { kind: 'success', text: '已回到 discuss' }
    })
    register('gate-status', 'Show current gate state', async invocation => {
      const gate = resolveGate(ctx, invocation.agent)
      if (gate.config.kind !== 'ok') return { kind: 'error', text: '当前项目没有启用的 .agents/gate.json' }
      return { kind: 'success', text: statusText(loadState(gate.root, invocation.agent)) }
    })
  })
}

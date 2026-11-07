import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPath, shellAccess } from './src/classify.js'
import { findGateRoot, loadConfig } from './src/config.js'
import { childStateId, defaultState, loadState, saveState } from './src/state.js'

export const inject = ['tools']
const SKILLS = fileURLToPath(new URL('./skills', import.meta.url))
const SKILL_NAMES = ['gate-planning', 'gate-plan-review', 'gate-implement', 'gate-code-review-standards', 'gate-code-review-spec', 'gate-verify']
const REVIEW_LIMIT = 5

export const PLAN_ORCHESTRATION = `## /gate-plan orchestration
Main agent dispatches workers; gate does not dispatch.
1. Dispatch gate-planning with the task, gate-planning method, proposal.md, rfc.md, the global write-agent-notes method, and the canonical proposed template.
2. Call gate_record({node:'plan'}).
3. Dispatch gate-plan-review read-only; call gate_record({node:'plan-review',findings,requiresDiscussion}).
4. If requiresDiscussion: call /gate-return and stop. If findings remain: dispatch gate-planning revise, call gate_record({node:'plan-revise'}), then review again.
5. At five review rounds with findings, gate marks blocked; never claim pass.
6. Empty review returns to discuss.`

export const IMPLEMENT_ORCHESTRATION = `## /gate-implement orchestration
Main agent dispatches workers; gate does not dispatch.
1. Dispatch gate-implement with the accepted work item and implementation method.
2. Call gate_record({node:'implement'}).
3. Dispatch gate-code-review-standards and gate-code-review-spec, both read-only.
4. Call gate_record({node:'code-review',findings,requiresDiscussion}) with the two-axis result.
5. If requiresDiscussion: call /gate-return and stop. If findings remain: dispatch gate-implement revise, call gate_record({node:'implement-revise'}), then review again.
6. Empty findings: dispatch gate-verify and call gate_record({node:'verify',ok}).
7. Verify FAIL routes back to implement-revise; PASS completes. At five rounds, blocked.`

export const DOCS_ORCHESTRATION = `## /gate-docs orchestration
Edit only documents and notes; no planning or implementation skill, no code.
Return to discuss explicitly.`

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

function statusText(state) {
  return [
    `状态：${state.phase}`,
    `节点：${state.node ?? '无'}`,
    `工作项：${state.task ?? '无'}`,
    `work：${state.work}`,
    `blockReason：${state.blockReason ?? '无'}`,
    `rounds：plan ${state.rounds?.planReview ?? 0}/5, code ${state.rounds?.codeReview ?? 0}/5`,
  ].join('\n')
}

function rootAgentOf(ctx, agent) {
  try {
    return ctx.get('subagents')?.rootOf?.(agent) ?? agent
  } catch {
    return agent
  }
}

function effectiveState(ctx, agent, gate) {
  const root = rootAgentOf(ctx, agent)
  return { root, state: loadState(gate.root, root), worker: root?.id !== agent?.id }
}

function workerWriteAllowed(state, target) {
  if (state.phase !== 'orchestrating') return false
  if (state.node === 'plan' || state.node === 'plan-revise') return target.docs === true
  if (state.node === 'implement' || state.node === 'implement-revise') return target.docs === true || target.code === true
  if (state.node === 'verify') return target.docs === true
  return false
}

function normalizeTopic(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

function isMechanical(task) {
  return /^mechanical:/iu.test(String(task ?? '').trim())
}

function hasProposedNote(root, task) {
  const wanted = normalizeTopic(String(task ?? '').trim().replace(/^proposed:/iu, ''))
  if (wanted === '') return false
  const dir = path.join(root, '.agents', 'notes', 'proposed')
  if (!existsSync(dir)) return false
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const nested of readdirSync(path.join(dir, entry.name), { withFileTypes: true })) {
      if (!nested.isFile() || !nested.name.endsWith('.md')) continue
      const topic = normalizeTopic(nested.name.replace(/^\d{4}-\d{2}-\d{2}-/u, '').replace(/\.md$/u, '').replace(/-implemented$/u, ''))
      if (topic === wanted) return true
    }
  }
  return false
}

function workItemAllowed(root, task, allowMechanical) {
  if (isMechanical(task)) return allowMechanical
  return hasProposedNote(root, task)
}

function command(ctx, agent, rawInput, allowMechanical, node) {
  const task = String(rawInput ?? '').trim()
  const gate = resolveGate(ctx, agent)
  if (gate.config.kind !== 'ok') return { kind: 'error', text: '当前项目没有启用的 .agents/gate.json' }
  if (task === '') return { kind: 'error', text: '缺少工作项' }
  if (!workItemAllowed(gate.root, task, allowMechanical)) return { kind: 'error', text: '工作项不存在：需要同 topic 的 proposed Note' + (allowMechanical ? ' 或 mechanical:' : '') }
  const state = loadState(gate.root, agent)
  if (state.phase !== 'discuss' && state.phase !== 'complete') return { kind: 'error', text: `当前 phase 是 ${state.phase}` }
  state.phase = 'orchestrating'
  state.task = task
  state.work = 'active'
  state.blockReason = null
  state.node = node
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
        const protocol = state.phase === 'docs'
          ? DOCS_ORCHESTRATION
          : state.node === 'plan'
            ? PLAN_ORCHESTRATION
            : state.node === 'implement'
              ? IMPLEMENT_ORCHESTRATION
              : ''
        return [`## Gate`, statusText(state), protocol, 'Main agent is orchestrating; do not write code or docs. Report the state block and worker results only.'].filter(Boolean).join('\n\n')
      },
    })
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'write' || exec.name === 'edit') {
      const gate = resolveGate(ctx, exec.agent)
      if (gate.config.kind !== 'ok') return next()
      const effective = effectiveState(ctx, exec.agent, gate)
      const state = effective.state
      const target = classifyPath(gate.workspace, exec.arguments?.file_path, gate.config.policy)
      if (target.outside) return { kind: 'deny', reason: '工作区外写入被拒绝' }
      if (target.protected) return { kind: 'deny', reason: 'Gate 配置和状态不可写' }
      if (effective.worker) {
        return workerWriteAllowed(state, target)
          ? next()
          : { kind: 'deny', reason: `worker ${state.node ?? 'unknown'} 不允许写该目标` }
      }
      if (state.phase === 'discuss' || state.phase === 'complete') return { kind: 'deny', reason: '当前阶段不允许写入' }
      if (state.phase === 'orchestrating') return { kind: 'deny', reason: '主代理编排中，不允许直接写入' }
      if (target.code && state.phase !== 'implement') return { kind: 'deny', reason: '只有 implement 阶段允许写代码' }
      if (target.docs && !['planning', 'docs', 'implement'].includes(state.phase)) return { kind: 'deny', reason: '文档写入未授权' }
      return next()
    }
    if (exec.name === 'pwsh' || exec.name === 'bash') {
      const gate = resolveGate(ctx, exec.agent)
      if (gate.config.kind !== 'ok') return next()
      const effective = effectiveState(ctx, exec.agent, gate)
      const state = effective.state
      const cwd = exec.arguments?.workdir ?? gate.workspace
      const access = shellAccess(exec.arguments?.command ?? '', gate.workspace, gate.config.policy, cwd)
      if (!access.write) return next()
      if (access.protectedTargets.length > 0) return { kind: 'deny', reason: 'Gate 配置和状态不可写' }
      if (access.outsideTargets.length > 0) return { kind: 'deny', reason: '工作区外写入被拒绝' }
      if (effective.worker) {
        const allowed = access.codeTargets.length > 0
          ? (state.node === 'implement' || state.node === 'implement-revise')
          : state.node !== 'plan-review' && state.node !== 'code-review'
        return allowed ? next() : { kind: 'deny', reason: `worker ${state.node ?? 'unknown'} 不允许写该目标` }
      }
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
      const result = command(ctx, invocation.agent, invocation.rawInput, false, 'plan')
      if (result.kind === 'error') return result
      return { kind: 'success', text: `进入 planning：${result.state.task}\n按注入协议派发 gate-planning。` }
    })
    register('gate-implement', 'Start implementation orchestration', async invocation => {
      const result = command(ctx, invocation.agent, invocation.rawInput, true, 'implement')
      if (result.kind === 'error') return result
      return { kind: 'success', text: `进入 implement：${result.state.task}\n按注入协议派发 gate-implement。` }
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

  ctx.tools.register({
    name: 'gate_record',
    description: 'Record the result of one main-agent-dispatched phase worker (plan, plan-review, plan-revise, implement, code-review, implement-revise, verify) and advance the gate state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        node: { type: 'string', enum: ['plan', 'plan-review', 'plan-revise', 'implement', 'code-review', 'implement-revise', 'verify'] },
        findings: { type: 'array', items: { type: 'object', additionalProperties: true } },
        requiresDiscussion: { type: 'boolean' },
        discussionReason: { type: 'string' },
        ok: { type: 'boolean' },
      },
      required: ['node'],
    },
    async execute(args, exec) {
      const gate = resolveGate(ctx, exec.agent)
      if (gate.config.kind !== 'ok') return { ok: false, code: 'not-enabled' }
      const state = loadState(gate.root, exec.agent)
      if (state.phase !== 'orchestrating') return { ok: false, code: 'not-orchestrating', phase: state.phase }
      if (state.node !== args.node) return { ok: false, code: 'wrong-node', expected: state.node, got: args.node }
      const findings = Array.isArray(args.findings) ? args.findings : []
      if (args.requiresDiscussion === true) {
        state.phase = 'discuss'
        state.node = null
        state.blockReason = 'needs-user-decision'
        saveState(gate.root, exec.agent, state)
        return { ok: true, phase: 'discuss', blockReason: state.blockReason, reason: args.discussionReason ?? null }
      }
      if (args.node === 'plan') state.node = 'plan-review'
      else if (args.node === 'plan-revise') state.node = 'plan-review'
      else if (args.node === 'plan-review') {
        state.rounds.planReview += 1
        if (findings.length === 0) { state.phase = 'discuss'; state.node = null; state.blockReason = null }
        else if (state.rounds.planReview >= REVIEW_LIMIT) { state.phase = 'discuss'; state.node = null; state.work = 'blocked'; state.blockReason = 'plan-review-rounds-exhausted' }
        else state.node = 'plan-revise'
      } else if (args.node === 'implement') state.node = 'code-review'
      else if (args.node === 'implement-revise') state.node = 'code-review'
      else if (args.node === 'code-review') {
        state.rounds.codeReview += 1
        if (findings.length === 0) state.node = 'verify'
        else if (state.rounds.codeReview >= REVIEW_LIMIT) { state.phase = 'discuss'; state.node = null; state.work = 'blocked'; state.blockReason = 'code-review-rounds-exhausted' }
        else state.node = 'implement-revise'
      } else if (args.node === 'verify') {
        if (args.ok === false) state.node = 'implement-revise'
        else { state.phase = 'complete'; state.node = null; state.blockReason = null; state.work = 'active' }
      }
      saveState(gate.root, exec.agent, state)
      return { ok: true, phase: state.phase, node: state.node, rounds: state.rounds, blockReason: state.blockReason }
    },
  })
}

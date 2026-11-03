/** Long-form actions: one array, grouped for the tool registry. */

import { createHash } from 'node:crypto'
import {
  StoryError, createBackup, deleteWork, exportWork, initWork, nextStep as nextStepFor, 
  approveFoundation, approveOutline, approveChapterPlan, finalizeChapter, markStateDraftReady, mergeStateDraft,
  planApprovalPolicy,
  latestReview, readBibleEntry, readChapter, readChapterHistory, readEvents, readEventsText, readManifest, readPlan, readSessionCurrent,
  readStateDraft, readSummaryState,
  reopenChapter as reopenChapterFor, renameWork, restoreWork, reviseChapter, setSessionCurrent,
  status as readStatus, updateSettings, workIdOf, writeChapter, writeOutline as writeOutlineFor, writePlan, writeReview,
} from '../../storage.ts'
import { listRoleCards, readArtifact, readChapterMemo, readChapterSummary, readFoundationDocument, readRoleCard, readTextArtifact, renderFoundationContent } from '../../artifact-store.ts'
import {
  assembleBrief as assembleBriefFor, readBible as readBibleEntries,
  writeBible as writeBibleEntry, writeSummary as writeSummaryEntry,
} from '../../bible/index.ts'
import { readVolumes, writeVolume } from '../../volumes.ts'
import { critique, findingsOf } from '../../critique.ts'
import { loadRoleInput } from '../../runtime/role-input.ts'
import { delegateRole } from '../../runtime/delegate-runner.ts'
import { checkChapterState } from '../../state-check.ts'
import { settleChapterState } from '../../state-settle.ts'
import { submitPayload } from '../../runtime/submission.ts'
import { FOUNDATION_PHASES, FOUNDATION_STAGES } from '../../roles/architect/contract.ts'
import { DELEGATE_ROLES } from '../../roles/registry.ts'
import { checkDraft } from '../../landing.ts'
import { clearCurrent, getCurrent, hydrate as hydrateCurrent, markHydrated, resolveWork, setCurrent, shouldHydrate } from '../../current.ts'
import { scanWork, scanWorkspace } from '../../recovery.ts'
import { join } from 'node:path'
import { createProposal, markProposalUsed, readProposal } from '../../proposals.ts'
import { SCOPE_MESSAGES, scopeDenial } from '../../scope.ts'
import type {
  SchemaNode,
  ModelArgs,
  ArtifactRef,
  FailureEnvelope,
  ManifestView,
  ActionSpec,
  ActionDefinition,
} from '../types.ts'
import { failureOf, inject, name, storeErrorCodeOf } from '../registry.ts'
import {
  sessionOf,
  delegationDepthOf,
  workspaceOf,
  sessionCurrentOf,
  OUTPUT_PROPERTIES,
  assertCurrentChapter,
  contentRevision,
  OUTPUT,
  NEXT_OUTPUT,
  STATE_PAYLOAD_PROPERTIES,
  DELEGATE_OUTPUT,
  STATE_CHECK_OUTPUT,
  STATE_SETTLE_OUTPUT,
  CONTEXT_OUTPUT,
  BRIEF_OUTPUT,
  SUBMIT_OUTPUT,
  action,
} from '../../tools.ts'

export /** The long-form action set. */
function rawDefinitions(ctx: DshContext): ActionDefinition[] {
  return [
    action({
      name: 'story_init',
      mutates: true,
      description: '建立一部作品：真值五件与检索表。'
        + ' 先有作者同意的提案，再调用它立项。作品 id 由标题生成；同 id 已存在时拒绝，不覆盖已有作品。'

        + ' 会话没有当前作品时，成功后会把新作品设为当前；已有其他当前作品时拒绝（请新建会话再立项）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: '作品标题。' },
          proposal: {
            type: 'string',
            description: '已获作者同意的提案 id（story_propose 返回）。立项必须带它。',
          },
          wordRange: {
            type: 'object',
            additionalProperties: false,
            properties: { min: { type: 'integer' }, max: { type: 'integer' } },
            required: ['min', 'max'],
            description: '单章字数范围，建档时与作者商定；省略表示不设限。',
          },
          workId: { type: 'string', description: '可选：显式指定作品 id（字母、数字、连字符）。' },
          tags: { type: 'array', description: '可选标签。', items: { type: 'string' } },
        },
        required: ['title', 'proposal'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const session = sessionOf(exec)
        if (typeof args.proposal !== 'string' || args.proposal.trim() === '') {
          throw new StoryError('proposal-required',
            '立项前先和作者讨论，用 story_propose 落一份方案，并在作者明确同意后带 proposal 立项')
        }
        const proposal = await readProposal(root, args.proposal.trim())
        if (proposal.title !== String(args.title).trim()) {
          throw new StoryError('proposal-mismatch',
            `提案《${proposal.title}》与要建的作品《${args.title}》不一致：改标题或重新提案`)
        }
        if (args.form !== undefined && proposal.form !== args.form) {
          throw new StoryError('proposal-mismatch',
            `提案形态是 ${proposal.form}，与传入的 ${args.form} 不一致`)
        }
        const targetId = typeof args.workId === 'string' && args.workId.trim() !== ''
          ? workIdOf(args.workId)
          : workIdOf(args.title)
        const current = sessionCurrentOf(root, session)
        if (current !== undefined && current !== targetId) {
          throw new StoryError('work-mismatch',
            `本会话当前作品是 ${current}，不能再立项另一部：请新建会话再立项`)
        }
        const created = await initWork(root, {
          title: args.title,
          form: proposal.form,
          ...(typeof args.workId === 'string' ? { workId: args.workId } : {}),
          ...(typeof args.form === 'string' ? { form: args.form } : {}),
          ...(Array.isArray(args.tags) ? { tags: args.tags } : {}),
          ...(args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
        })
        if (session !== undefined) {
          setCurrent(session, created.workId)
          try {
            setSessionCurrent(root, session, created.workId)
          } catch (error) {
            console.warn(`[storycraft] 当前作品指针持久化失败：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        await markProposalUsed(root, proposal.id, created.workId).catch(() => {})
        return { ok: true, workId: created.workId }
      },
    }),

    action({
      name: 'story_propose',
      mutates: true,
      description: '把与作者谈成的方案落成提案（标题、形态、一句话前提、主要人物与冲突）。'
        + ' 提案不是作品：不建目录、不写章节。方向成熟后写提案给作者看，作者明确同意后再 story_init。'
        + ' 讨论阶段不要调用它，也不要写任何文件；缺信息时先只问一个最关键的问题，不要一次抛出问卷。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: '作品标题。' },
          form: { type: 'string', enum: ['longform', 'short', 'script'], description: '形态，缺省长篇。' },
          premise: { type: 'string', description: '一句话前提或核心冲突。' },
          characters: { type: 'string', description: '主要人物与他们的目标（可选）。' },
          conflict: { type: 'string', description: '主要冲突或阻力（可选）。' },
          notes: { type: 'string', description: '完整创意 brief：约定、字数范围、叙事视角、参考与禁区（可选，但方向成熟时建议写全）。' },
        },
        required: ['title', 'premise'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const proposal = await createProposal(root, {
          title: args.title,
          form: args.form,
          premise: args.premise,
          ...(typeof args.characters === 'string' ? { characters: args.characters } : {}),
          ...(typeof args.conflict === 'string' ? { conflict: args.conflict } : {}),
          ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
        })
        return { ok: true, proposal: proposal.id, title: proposal.title, form: proposal.form }
      },
    }),

    action({
      name: 'story_outline',
      mutates: true,
      description: '全书计划：写主线、卷划分、结局方向；返回 outline artifact ID。'
        + ' 写完后请作者在面板点「确认全书计划」；模型不能代签确认。未确认前不能写任何章的章纲。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          mainline: { type: 'string', description: '主线：主角要什么、被什么阻挡、大致怎么走。' },
          volumes: { type: 'string', description: '可选：卷划分的文字摘要。' },
          ending: { type: 'string', description: '可选：结局方向。' },
          approve: { type: 'boolean', description: '已停用：确认改由作者在面板完成。传入会返回 approval-moved。' },
        },
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        if (args.approve === true) {
          throw new StoryError('approval-moved',
            '全书计划的确认已移到面板：请作者在工作台点「确认全书计划」，模型不能代签')
        }
        const result = await writeOutlineFor(root, {
          work: args.work,
          ...(typeof args.mainline === 'string' ? { mainline: args.mainline } : {}),
          ...(typeof args.volumes === 'string' ? { volumes: args.volumes } : {}),
          ...(typeof args.ending === 'string' ? { ending: args.ending } : {}),
        })
        const entry = readBibleEntry(root, result.workId, 'plan')
        return {
          ok: true,
          workId: result.workId,
          outline: result.outline,
          artifact: { workId: result.workId, artifactId: 'outline', revisionId: entry?.version ?? 'current', kind: 'outline' },
        }
      },
    }),

    action({
      name: 'story_approve',
      mutates: true,
      description: '记录作者对基础设定 / 全书计划 / 章纲的确认，来源记为 conversation。'
        + ' 只在作者明确说「确认 / 就按这个来」之后调用；面板上的按钮写同一事件，两者都会绑定内容指纹。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          kind: { type: 'string', enum: ['foundation', 'outline', 'plan'], description: '确认哪一项。' },
          chapter: { type: 'integer', description: 'kind=plan 时必填：第几章。' },
          reason: { type: 'string', description: '可选：作者原话片段，作为批准审计记录。' },
        },
        required: ['work', 'kind'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            workId: { type: 'string' },
            kind: { type: 'string' },
            source: { type: 'string', enum: ['conversation', 'panel'] },
          },
          required: ['ok', 'workId', 'kind', 'source'],
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const workId = String(args.work)
        const kind = String(args.kind)
        if (kind === 'foundation') {
          approveFoundation(root, { work: workId, source: 'conversation', ...(typeof args.reason === 'string' ? { reason: args.reason } : {}) })
          return { ok: true, workId, kind, source: 'conversation' }
        }
        if (kind === 'outline') {
          approveOutline(root, { work: workId, source: 'conversation', ...(typeof args.reason === 'string' ? { reason: args.reason } : {}) })
          return { ok: true, workId, kind, source: 'conversation' }
        }
        if (kind === 'plan') {
          if (args.chapter === undefined) throw new StoryError('chapter-required', '记录章纲确认需要 chapter')
          approveChapterPlan(root, { work: workId, chapter: args.chapter, source: 'conversation', ...(typeof args.reason === 'string' ? { reason: args.reason } : {}) })
          return { ok: true, workId, kind, source: 'conversation' }
        }
        throw new StoryError('invalid-kind', `未知的确认类型：${kind}`)
      },
    }),
    action({
      name: 'story_plan',
      mutates: true,
      description: '写一章的章纲。五项必须齐全：视角、目标、阻力、代价、结尾变化；另需 body（章纲正文）与 threadRefs（伏笔数组，可为空）。'
        + ' 动笔前先出章纲，改章纲也用这个动作覆盖同一章的章纲。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id（story_init 返回）。' },
          chapter: { type: 'integer', description: '章号，从 1 开始。' },
          perspective: { type: 'string', description: '视角人物。' },
          goal: { type: 'string', description: '本章目标。' },
          obstacle: { type: 'string', description: '阻力。' },
          cost: { type: 'string', description: '代价。' },
          turn: { type: 'string', description: '结尾变化。' },
          body: { type: 'string', description: '章纲正文；不能为空。' },
          threadRefs: { type: 'array', items: { type: 'string' }, description: '本章涉及的伏笔 ID；可为空数组。' },
        },
        required: ['work', 'chapter', 'perspective', 'goal', 'obstacle', 'cost', 'turn', 'body', 'threadRefs'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        if (manifest.outline?.approvedAt === undefined) {
          throw new StoryError('outline-required',
            '全书计划还没确认：写完后请作者在面板点「确认全书计划」，再写章纲（模型不能代签）')
        }
        const result = await writePlan(root, { ...args, requireBody: true })
        return {
          ok: true,
          workId: args.work,
          artifact: { artifactId: result.artifact.artifactId, revisionId: result.artifact.revisionId, kind: result.artifact.kind },
        }
      },
    }),

    action({
      name: 'story_context',
      description: '派发前取一份按角色分层的故事上下文：权威顺序、任务、硬约束、章纲/全书计划、正文、人物与状态、最近脉络、标准。'
        + ' 只读；返回每段的保护级别、预算轨迹与白名单摘要，供主编拼子代理 prompt。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号；作品级规划可省略。' },
          role: {
            type: 'string',
            enum: ['writer', 'planner', 'reviewer', 'reviser'],
            description: '派给谁：写手、规划、审稿或修订。',
          },
          instruction: { type: 'string', description: '作者本轮要求，会并入任务段。' },
          budget: { type: 'integer', description: '可选：本次装配的 token 预算（估算值），缺省用角色默认。' },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '仅修订使用，缺省 patch。',
          },
        },
        required: ['work', 'role'],
      },
      output: CONTEXT_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        if (args.chapter !== undefined) assertCurrentChapter(readManifest(root, args.work), Number(args.chapter))
        const loaded = await loadRoleInput(root, args as Parameters<typeof loadRoleInput>[1])
        const context = loaded.context
        const chapter = args.chapter === undefined ? undefined : (loaded.entry?.number ?? Number(args.chapter))
        const review = loaded.review
        return {
          ok: true,
          workId: args.work,
          role: args.role,
          ...(chapter === undefined ? {} : { chapter }),
          sections: context.sections
            .filter(item => item.content !== '')
            .map(item => ({
              name: item.name,
              title: item.title,
              sourceIds: context.trace.sections.find(entry => entry.name === item.name)?.sourceIds ?? [],
              content: item.content,
              protection: item.protection,
            })),
          trace: {
            ...context.trace,
            ...(review === undefined ? {} : { review: { round: review.round ?? 0, revision: review.revision ?? 0 } }),
          },
          whitelist: context.whitelist,
        }
      },
    }),

    action({
      name: 'story_write',
      mutates: true,
      description: '把一章正文落库并更新进度。已存在正文时默认拒绝；要改稿传 rewrite: true，会生成新版本而不覆盖旧版。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          title: { type: 'string', description: '章标题，可覆盖上一次的值。' },
          body: { type: 'string', description: '完整正文 Markdown。' },
          rewrite: { type: 'boolean', description: '已有正文时是否另存为新版本。' },
          reopen: { type: 'boolean', description: '已定稿章要改正文时传 true：回退到已写，旧定稿作废。' },
        },
        required: ['work', 'chapter', 'body'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const policy = planApprovalPolicy(await readManifest(root, args.work))
        const { warnings } = await checkDraft(root, args as Parameters<typeof checkDraft>[1])
        const result = await writeChapter(root, { ...args, requirePlanApproval: policy === 'required' } as Parameters<typeof writeChapter>[1])
        return {
          ok: true, workId: args.work, artifact: result.artifact, words: result.words,
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_review',
      mutates: true,
      description: '把审稿发现落盘成一轮 observation。只写审稿，绝不修改正文；每条含逐字引文、问题与修法。'
        + ' 空数组合法，表示清稿审稿；正文不存在时会被拒绝。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          problems: {
            type: 'array',
            description: '审稿发现；空数组合法，表示清稿审稿。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                quote: { type: 'string', description: '正文或章纲里的逐字引文。' },
                problem: { type: 'string', description: '问题是什么。' },
                fix: { type: 'string', description: '建议怎么改。' },
                severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
                resolves: { type: 'string', description: '可选：上一轮的 observation id；填了表示已解决。' },
              },
              required: ['quote', 'problem'],
            },
          },
        },
        required: ['work', 'chapter', 'problems'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: OUTPUT_PROPERTIES.ok,
            workId: OUTPUT_PROPERTIES.workId,
            artifact: OUTPUT_PROPERTIES.artifact,
            problems: {
              type: 'object',
              additionalProperties: false,
              properties: { total: { type: 'integer' }, open: { type: 'integer' } },
              required: ['total', 'open'],
            },
          },
          required: ['ok', 'workId', 'artifact', 'problems'],
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        const entry = manifest.chapters.find((item: any) => item.number === args.chapter)
        if (entry === undefined) throw new StoryError('chapter-not-found', `没有第 ${args.chapter} 章`)
        const observations = args.problems.map((problem: any, index: number) => ({
          id: `O${index + 1}`,
          summary: problem.problem,
          evidence: [],
          category: 'quality',
          assessment: problem.resolves === undefined ? 'issue' : 'resolved',
          ...(problem.resolves === undefined ? {} : { resolves: problem.resolves }),
          ...(problem.severity === undefined ? {} : { severity: problem.severity }),
          ...(problem.fix === undefined ? {} : { fix: problem.fix }),
          sourceRefs: [{ sourceId: `chapter:${args.chapter}:r${entry.currentRevision}`, quote: problem.quote }],
        }))
        const result = await writeReview(root, { work: args.work, chapter: args.chapter, observations })
        return {
          ok: true,
          workId: args.work,
          artifact: { workId: args.work, artifactId: result.artifactId, revisionId: result.revisionId, kind: 'review' },
          problems: {
            total: observations.length,
            open: observations.filter((observation: any) => observation.assessment === 'issue').length,
          },
        }
      },
    }),

    action({
      name: 'story_revise',
      mutates: true,
      description: '按审稿清单改一章：生成新版本正文、把指定的问题条目标为已处理，旧版本保留。'
        + ' 必须先有审稿清单，且要指明处理哪些条目；条目不存在、正文与当前版本相同都会被拒绝。'
        + ' 只是重写而不针对清单条目时，用 story_write 的 rewrite。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          body: { type: 'string', description: '修订后的完整正文。' },
          problemIds: {
            type: 'array',
            description: '本次处理的问题条目 id（如 Q1、Q2）。patch 模式必填；polish/rewrite/deslop 可省略。',
            items: { type: 'string' },
          },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '修订模式：patch 只改点到的地方（字数变化 ≤20%）、polish 润色（≤40%）、rewrite 重写、deslop 去 AI 腔（必须减少命中）。省略为 patch。',
          },
        },
        required: ['work', 'chapter', 'body'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const policy = planApprovalPolicy(await readManifest(root, args.work))
        const { warnings } = await checkDraft(root, args as Parameters<typeof checkDraft>[1])
        const result = await reviseChapter(root, { ...args, requirePlanApproval: policy === 'required' } as unknown as Parameters<typeof reviseChapter>[1])
        return {
          ok: true, workId: args.work, artifact: result.artifact, resolved: result.resolved,
          ...(warnings.length === 0 ? {} : { warnings }),
        }
      },
    }),

    action({
      name: 'story_state_check',
      description: '只读：在 story_state 之前核对拟写入的 payload 是否被本章正文支持，并找出正文里漏记的重要变化。'
        + ' 只返回建议性 findings，不改正文、不写 events、不改阶段；是否修改 payload 由主编决定。'
        + ' 只允许主会话调用，会启动一个 validator 子代理。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          ...STATE_PAYLOAD_PROPERTIES,
        },
        required: ['work', 'chapter'],
      },
      output: STATE_CHECK_OUTPUT,
      async execute(args, exec) {
        if (delegationDepthOf(exec) > 0) {
          throw new StoryError('state-check-parent-denied', 'story_state_check 只允许主会话调用；子代理不能发起语义对账')
        }
        const root = workspaceOf(exec)
        const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : undefined
        return checkChapterState(root, args as Parameters<typeof checkChapterState>[1], {
          service,
          agent: exec.agent,
          sessions: typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined,
          signal: exec.signal,
        })
      },
    }),

    action({
      name: 'story_settle',
      mutates: true,
      description: '自动结算本章状态：settler 从正文抽取事实与伏笔 delta，先做确定性预检，再用 R9b 语义检查；'
        + 'major/确定性 error 带反馈重算一次；对账退回或超时带可用 ops 时写未就绪草案（可接受后定稿），state-invalid 不写库。'
        + '成功时只写状态草案（state:draft），不写事实/伏笔事件、不定稿；作者接受草案或改状态后再 story_finalize。只允许主会话调用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      output: STATE_SETTLE_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : undefined
        return settleChapterState(root, args as Parameters<typeof settleChapterState>[1], {
          service,
          agent: exec.agent,
          signal: exec.signal,
          sessions: typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined,
        })
      },
    }),

    action({
      name: 'story_state',
      mutates: true,
      description: '修改本章状态草案（定稿前）：作者 ops 合并进草案，不写事件、不定稿。'
        + ' 只写变化：已有伏笔用 hookOps 引 hookId，新伏笔放 newHooks（宿主铸 id）；fact 用三元组 + 有效期。'
        + ' 当前正文版本没有摘要返回 summary-required，摘要过期返回 summary-stale；钩子 id 不存在返回 hook-not-found，非法转移返回 hook-transition-invalid，无可失效 fact 返回 fact-not-found；已定稿再次归档返回 chapter-settled。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          ...STATE_PAYLOAD_PROPERTIES,
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const summary = readSummaryState(root, args.work, args.chapter)
        if (summary.state === 'missing') {
          throw new StoryError('summary-required',
            `第 ${args.chapter} 章还没有摘要：先用 story_summarize 写摘要，再定稿`)
        }
        if (summary.state === 'stale') {
          throw new StoryError('summary-stale',
            `第 ${args.chapter} 章摘要针对旧版本 r${summary.revision ?? '?'}：先重写摘要，再定稿`)
        }
        const draft = mergeStateDraft(root, args)
        return {
          ok: true,
          workId: args.work,
          artifact: { workId: args.work, artifactId: draft.artifactId, revisionId: draft.revisionId, kind: 'state_draft' },
        }
      },
    }),

    action({
      name: 'story_apply_draft',
      mutates: true,
      description: '接受本章当前的状态草案（作者确认“按这个来”）：只把草案标记为 ready，不写事件、不定稿。'
        + '没有草案返回 draft-not-found；草案不是当前正文版本返回 draft-stale。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const draft = markStateDraftReady(root, args)
        return {
          ok: true,
          workId: args.work,
          artifact: { workId: args.work, artifactId: draft.artifactId, revisionId: draft.revisionId, kind: 'state_draft' },
        }
      },
    }),

    action({
      name: 'story_finalize',
      mutates: true,
      description: '定稿本章：应用当前 ready 草案（写事实/伏笔事件与 settle 标记），锁定章节并删除草案。'
        + '没有 ready 草案返回 state-not-ready；摘要/审稿不满足沿用 summary-required / review-required。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      output: STATE_SETTLE_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        return { ok: true, ...finalizeChapter(root, args) }
      },
    }),

    action({
      name: 'story_bible',
      description: '读取作品真值（世界观、人物档案、文风、写作计划、作者意图）。'
        + ' 动笔前需要确认设定、或要查某个人物的口吻与底线时先读它；真值缺失会指出缺哪几份。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          file: { type: 'string', enum: ['world', 'characters', 'style', 'plan', 'intent'], description: '可选：只读这一份。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await readBibleEntries(root, args.work, typeof args.file === 'string' ? args.file : undefined)
        return { ok: true, workId: args.work, files: result.files, ...(result.missing.length > 0 ? { missing: result.missing } : {}) }
      },
    }),

    action({
      name: 'story_bible_write',
      mutates: true,
      description: '写一份真值文件并返回内容版本。人物档案必须是六字段齐全的 JSON 数组；'
        + ' 结构不合法会被拒绝且原内容不变。作者确认设定或补齐人物后再调用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          file: { type: 'string', enum: ['world', 'characters', 'style', 'intent'], description: '写哪一份。' },
          content: { type: 'string', description: '完整内容（Markdown 或人物档案 JSON）。' },
        },
        required: ['work', 'file', 'content'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        if (args.file === 'plan') {
          throw new StoryError('approval-moved', '全书计划只能通过 story_outline 写入；不要用 story_bible_write 绕过作者确认')
        }
        const written = await writeBibleEntry(root, args.work, args.file, args.content)
        return { ok: true, workId: args.work, artifact: { path: written.path }, version: written.version }
      },
    }),

    action({
      name: 'story_read',
      description: '只读：按 artifactId 读取已登记的作品内容（chapter/plan/review/summary/state/state:draft:<章>:r<版本>/bible/outline/volume/role:<slug>/roles:index/trace）。宿主校验作品与当前章作用域；不返回文件路径。bible:book_rules 返回 Markdown；roles:index 返回完整 JSON；角色卡按 slug 读。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          artifactId: { type: 'string', description: '如 chapter:1、plan:1、bible:characters、bible:book_rules、roles:index、role:<slug>（如 role:jia）。' },
          revisionId: { type: 'string', description: '可选；不传则读当前版本。' },
          startLine: { type: 'integer', description: '可选：从第几行开始（1 起）。' },
          lineCount: { type: 'integer', description: '可选：最多返回多少行。' },
        },
        required: ['work', 'artifactId'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const workId = String(args.work)
        const manifest = readManifest(root, workId)
        const latest = manifest.chapters.length === 0 ? 1 : manifest.chapters[manifest.chapters.length - 1].number
        const id = String(args.artifactId)
        const [kind, ...parts] = id.split(':')
        let content = ''
        let ref = { workId, artifactId: id, revisionId: String(args.revisionId ?? 'current'), kind }
        const chapterNumber = Number(parts[0])
        if (kind === 'chapter' || kind === 'review' || kind === 'trace') {
          if (!Number.isInteger(chapterNumber) || chapterNumber !== latest) {
            throw new StoryError('artifact-not-readable', `只能读当前章 ${latest}；旧章请用 story_brief 的摘要`)
          }
        }
        if (kind === 'trace') {
          if (parts.length !== 2) throw new StoryError('artifact-not-readable', 'trace 的 artifactId 形如 trace:1:writer')
          const read = readArtifact(root, {
            work: workId,
            artifactId: id,
            ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
          })
          content = JSON.stringify(read.artifact.content, null, 2)
          ref = { ...ref, artifactId: id, revisionId: read.artifact.revisionId as string, kind: 'trace' }
        } else if (kind === 'outline') {
          const read = readTextArtifact(root, {
            work: workId,
            artifactId: 'outline',
            kind: 'outline',
            ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
          })
          content = String(read.artifact.content)
          // The store column is text even though its return type is the SQLite value union.
          ref = { ...ref, artifactId: 'outline', revisionId: read.artifact.revisionId as string, kind: 'outline' }
        } else if (kind === 'plan') {
          // Store reads return the artifact envelope, which only this branch unwraps.
          let memo: any
          try {
            memo = readChapterMemo(root, {
              work: workId,
              chapter: chapterNumber,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
          } catch (error) {
            // A thrown store error is a dynamic boundary: only its stable `code` is read.
            const code = storeErrorCodeOf(error)
            if (code === 'artifact-not-found' || code === 'chapter-not-found') {
              throw new StoryError('plan-not-found', `第 ${chapterNumber} 章还没有章纲`)
            }
            throw error
          }
          content = JSON.stringify(memo.artifact.content, null, 2)
          ref = { ...ref, artifactId: `plan:${chapterNumber}`, revisionId: memo.artifact.revisionId, kind: 'plan' }
        } else if (kind === 'chapter') {
          const revision = args.revisionId === undefined ? undefined : Number(String(args.revisionId).replace(/^r/u, ''))
          const read = readChapter(root, { work: workId, chapter: chapterNumber, ...(revision === undefined ? {} : { revision }) })
          content = read.content
          ref = { ...ref, artifactId: `chapter:${chapterNumber}`, revisionId: `r${read.revision}`, kind: 'chapter' }
        } else if (kind === 'review') {
          const review = latestReview(root, workId, chapterNumber)
          if (review === undefined) throw new StoryError('review-required', `第 ${chapterNumber} 章还没有审稿`)
          if ((parts[1] !== undefined && parts[1] !== `r${review.revision}`) || (parts[2] !== undefined && parts[2] !== String(review.round))) {
            throw new StoryError('artifact-not-readable', '只保留当前审稿版本与轮次；旧版本不提供读取')
          }
          content = JSON.stringify({ observations: review.observations }, null, 2)
          ref = { ...ref, artifactId: review.artifactId, revisionId: review.revisionId, kind: 'review' }
        } else if (kind === 'summary') {
          // Store reads return the artifact envelope, which only this branch unwraps.
          let summary: any
          try {
            summary = readChapterSummary(root, {
              work: workId,
              chapter: chapterNumber,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
          } catch (error) {
            // A thrown store error is a dynamic boundary: only its stable `code` is read.
            const code = storeErrorCodeOf(error)
            if (code === 'artifact-not-found' || code === 'chapter-not-found') {
              throw new StoryError('summary-not-found', `第 ${chapterNumber} 章还没有摘要`)
            }
            throw error
          }
          content = JSON.stringify(summary.artifact.content, null, 2)
          ref = { ...ref, artifactId: `summary:${chapterNumber}`, revisionId: summary.artifact.revisionId, kind: 'summary' }
        } else if (kind === 'bible') {
          const file = parts.join(':')
          if (file === 'characters') {
            const entry = readBibleEntry(root, workId, file)
            content = entry?.content ?? ''
            ref = { ...ref, artifactId: `bible:${file}`, revisionId: entry?.version ?? 'current', kind: file }
          } else if (file === 'book_rules') {
            const read = readFoundationDocument(root, {
              work: workId,
              name: 'book_rules',
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
            content = renderFoundationContent(read.artifact.content)
            ref = { ...ref, artifactId: String(read.artifact.artifactId), revisionId: String(read.artifact.revisionId), kind: String(read.artifact.kind) }
          } else {
            const name = file === 'plan' ? 'plan' : file
            const expected = name === 'plan'
              ? { artifactId: 'outline', kind: 'outline' }
              : { artifactId: `bible:${name}`, kind: name }
            const read = readTextArtifact(root, {
              work: workId,
              ...expected,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
            content = String(read.artifact.content)
            ref = { ...ref, ...expected, revisionId: read.artifact.revisionId as string }
          }
        } else if (kind === 'roles') {
          if (parts.length !== 1 || parts[0] !== 'index') throw new StoryError('artifact-not-readable', `不认识的 roles artifactId：${id}`)
          const read = readFoundationDocument(root, {
            work: workId,
            name: 'roles_index',
            ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
          })
          content = JSON.stringify(read.artifact.content, null, 2)
          ref = { ...ref, artifactId: String(read.artifact.artifactId), revisionId: String(read.artifact.revisionId), kind: String(read.artifact.kind) }
        } else if (kind === 'role') {
          const slug = parts.join(':')
          try {
            const card = readRoleCard(root, {
              work: workId,
              slug,
              ...(args.revisionId === undefined ? {} : { revisionId: String(args.revisionId) }),
            })
            content = JSON.stringify(card.artifact.content, null, 2)
            ref = { ...ref, artifactId: String(card.artifact.artifactId), revisionId: String(card.artifact.revisionId), kind: 'role_card' }
          } catch (error) {
            const code = storeErrorCodeOf(error)
            const slugs = listRoleCards(root, workId).map(item => String(item.artifactId).slice('role:'.length))
            // A deleted card has no rows at all, so even an explicit revision is "not found";
            // an existing card with a missing revision keeps the revision error.
            if (code === 'revision-not-found' && slugs.includes(slug)) throw error
            if (code !== 'artifact-not-found' && code !== 'revision-not-found') throw error
            throw new StoryError(
              'artifact-not-found',
              `没有角色卡：role:${slug}`,
              slugs.length === 0 ? '先跑角色卡阶段（架构师 roles/cards），再按 slug 读' : `已有角色卡：${slugs.join('、')}`,
            )
          }
        } else if (kind === 'state') {
          if (id === 'state') {
            content = readEventsText(root, workId)
            const events = readEvents(root, workId)
            ref = { ...ref, artifactId: 'state', revisionId: `seq:${events.length === 0 ? 0 : events[events.length - 1].seq}`, kind: 'state' }
          } else if (parts[0] === 'draft') {
            const draftChapter = Number(parts[1])
            const draftRevision = /^r([1-9]\d*)$/u.exec(String(parts[2] ?? ''))?.[1]
            if (parts.length !== 3 || !Number.isInteger(draftChapter) || draftChapter < 1 || draftRevision === undefined) {
              throw new StoryError('artifact-not-readable', 'state:draft 的 artifactId 形如 state:draft:<章>:r<版本>')
            }
            const draft = readStateDraft(root, { work: workId, chapter: draftChapter })
            if (draft === undefined) throw new StoryError('artifact-not-found', `第 ${draftChapter} 章没有状态草案`)
            if (Number(draftRevision) !== Number(draft.revision)) {
              throw new StoryError('revision-not-found', `状态草案的 revision 不是 r${String(draftRevision)}`)
            }
            content = JSON.stringify(draft.content, null, 2)
            ref = { ...ref, artifactId: id, revisionId: draft.revisionId, kind: 'state_draft' }
          } else {
            throw new StoryError('artifact-not-readable', `不认识的 state artifactId：${id}`)
          }
        } else if (kind === 'volume') {
          const volume = (await readVolumes(root, workId)).find(item => String(item.id) === parts.join(':'))
          if (volume === undefined) throw new StoryError('artifact-not-readable', `没有卷：${parts.join(':')}`)
          content = JSON.stringify(volume, null, 2)
          ref = { ...ref, artifactId: `volume:${volume.id}`, revisionId: contentRevision(content), kind: 'volume' }
        } else {
          throw new StoryError('artifact-not-readable', `不认识的 artifactId：${id}`)
        }
        if (args.revisionId !== undefined && String(args.revisionId) !== ref.revisionId) {
          throw new StoryError('revision-not-found', `artifact ${ref.artifactId} 的 revisionId ${String(args.revisionId)} 已不是当前版本`)
        }
        const lines = String(content).split(/\r?\n/u)
        const full = kind === 'roles'
        const start = Math.max(1, Number(args.startLine ?? 1))
        const count = Math.max(1, Math.min(500, Number(args.lineCount ?? 200)))
        const slice = full ? lines : lines.slice(start - 1, start - 1 + count)
        return {
          ok: true,
          workId,
          artifact: ref,
          content: slice.join('\n'),
          startLine: full ? 1 : start,
          endLine: full ? lines.length : start + slice.length - 1,
          totalLines: lines.length,
          hasMore: !full && start + slice.length - 1 < lines.length,
        }
      },
    }),

    action({
      name: 'story_brief',
      description: '装配写这一章前的上下文：作者意图、故事框架、作品规则、本章章纲、当前焦点、涉及人物、未解伏笔、卷图、卷摘要、最近摘要、上一章结尾、文风、字数口径；已写 ≥3 章时追加相关素材。'
        + ' 故事框架与作品规则是硬约束，预算不足时不会被裁掉；其他段超预算会说明裁掉了哪几段。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '要写的章号。' },
          budget: { type: 'integer', description: '可选：本次装配的 token 预算（估算值），缺省用简报默认。' },
        },
        required: ['work', 'chapter'],
      },
      output: BRIEF_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        assertCurrentChapter(readManifest(root, args.work), Number(args.chapter))
        const brief = await assembleBriefFor(root, args.work, args.chapter, {
          ...(typeof args.budget === 'number' ? { budget: args.budget } : {}),
        })
        return { ok: true, workId: args.work, chapter: Number(args.chapter), sections: brief.sections, budget: brief.budget, missing: brief.missing, dropped: brief.dropped, trace: brief.trace }
      },
    }),

    action({
      name: 'story_summarize',
      mutates: true,
      description: '把一章概括成摘要落盘（上限 400 字），供下一章的写前上下文使用。'
        + ' 写完整章并定稿后调用；摘要只写本章发生的事实与状态变化。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
          summary: { type: 'string', description: '摘要正文。' },
        },
        required: ['work', 'chapter', 'summary'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const receipt = await writeSummaryEntry(root, args.work, args.chapter, args.summary)
        return { ok: true, workId: args.work, artifact: { path: receipt.path }, words: receipt.words, truncated: receipt.truncated }
      },
    }),

    action({
      name: 'story_reopen',
      mutates: true,
      description: '作废一章的定稿但不改正文：定稿后要补审稿或改稿时先用它。'
        + ' 只对已定稿章有效；作废后该章回到「已写」，再走审稿 → 修订 → 定稿。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await reopenChapterFor(root, { work: args.work, chapter: args.chapter })
        return { ok: true, workId: args.work, artifact: result.artifact, stage: 'written' }
      },
    }),

    action({
      name: 'story_rename',
      mutates: true,
      description: '改作品的标题或作品 id（库文件会一起改）。id 必须是新的、不与他人冲突；'
        + ' 只改标题时库文件不动。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '当前作品 id。' },
          title: { type: 'string', description: '新标题；省略则不改。' },
          workId: { type: 'string', description: '新作品 id；省略则不改。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await renameWork(root, {
          work: args.work,
          ...(typeof args.title === 'string' ? { title: args.title } : {}),
          ...(typeof args.workId === 'string' ? { workId: args.workId } : {}),
        })
        return { ok: true, workId: result.workId }
      },
    }),

    action({
      name: 'story_delete',
      mutates: true,
      description: '把作品移进回收站，不再出现在列表里；可用 story_restore 恢复。不返回路径。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await deleteWork(root, { work: args.work })
        if (sessionCurrentOf(root, sessionOf(exec)) === String(args.work)) clearCurrent(sessionOf(exec))
        return { ok: true, workId: result.workId, artifact: { path: result.path } }
      },
    }),

    action({
      name: 'story_restore',
      mutates: true,
      description: '把回收站里最近一次删除的同名作品恢复回作品列表。目标名已被占用时拒绝。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: '删除前的作品 id。' },
        },
        required: ['name'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await restoreWork(root, { name: args.name })
        return { ok: true, workId: result.workId }
      },
    }),

    action({
      name: 'story_settings',
      mutates: true,
      description: '设定作品的写作参数：单章字数范围、章纲确认策略与可选单章 token 上限。'
        + ' 字数传 null 表示清空、不按字数判定；planApproval 传 required 表示每章章纲必须作者在面板确认，传 off 表示不需要确认；'
        + 'maxChapterTokens 传正整数设置上限、传 null 清空，省略表示不改；未设置不限制。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          wordRange: {
            type: 'object',
            additionalProperties: false,
            properties: { min: { type: 'integer' }, max: { type: 'integer' } },
            required: ['min', 'max'],
            description: '单章字数范围；省略表示不改。',
          },
          clear: { type: 'boolean', description: '传 true 清空字数范围（不按字数判定）。' },
          planApproval: {
            type: 'string',
            enum: ['required', 'off'],
            description: '章纲确认策略：required 每章必须确认；off 不需要确认。省略表示不改。',
          },
          maxChapterTokens: {
            oneOf: [{ type: 'integer' }, { type: 'null' }],
            description: '单章已观测 token 上限；传 null 清空。省略表示不改；不设置不限制。',
          },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await updateSettings(root, {
          work: args.work,
          ...(args.clear === true ? { wordRange: null } : args.wordRange === undefined ? {} : { wordRange: args.wordRange }),
          ...(args.planApproval === undefined ? {} : { planApproval: args.planApproval }),
          ...(args.maxChapterTokens === undefined ? {} : { maxChapterTokens: args.maxChapterTokens }),
        })
        return {
          ok: true,
          workId: result.workId,
          ...(result.wordRange === undefined ? {} : { wordRange: result.wordRange }),
          ...(result.planApproval === undefined ? {} : { planApproval: result.planApproval }),
          ...(result.maxChapterTokens === undefined ? {} : { maxChapterTokens: result.maxChapterTokens }),
        }
      },
    }),

    action({
      name: 'story_current',
      description: '只读：本会话当前在做的作品。通常由面板进入时选定；'
        + ' 会话没有当前作品时，story_init 成功后会设为当前。其他情况模型不能自己切换；'
        + ' 返回 null 时说明还没有进入任何作品，请作者在面板里进入一部。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const current = sessionCurrentOf(root, sessionOf(exec))
        if (current === undefined) return { ok: true, current: null }
        let manifest: ManifestView | undefined
        try {
          manifest = readManifest(root, current)
        } catch {
          manifest = undefined
        }
        return { ok: true, workId: current, ...(manifest === undefined ? {} : { title: manifest.title }), current }
      },
    }),

    action({
      name: 'story_recover',
      description: '只读：扫描作品库健康状态。workspace:true 检查 catalog/孤儿库/失效会话/临时残留；'
        + ' 指定 work（或使用当前作品）检查完整性、检索索引与 FTS。只报告，不修改内容、索引或 catalog；'
        + ' 修复索引与备份恢复由作者在面板操作。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspace: { type: 'boolean', description: '扫描整个工作区的元数据；与 work 不能同时给。' },
          work: { type: 'string', description: '作品 id；省略时用当前作品。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          required: ['ok', 'report'],
          properties: {
            ok: { type: 'boolean' },
            report: { type: 'object', additionalProperties: true },
          },
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const session = sessionOf(exec)
        if (args?.workspace === true) {
          if (typeof args.work === 'string' && args.work.trim() !== '') {
            throw new StoryError('recover-arguments-invalid', 'workspace:true 与 work 不能同时给：工作区扫描不针对单部作品')
          }
          return { ok: true, report: scanWorkspace(root) }
        }
        const current = sessionCurrentOf(root, session)
        const explicit = typeof args?.work === 'string' && args.work.trim() !== '' ? args.work.trim() : undefined
        if (explicit !== undefined && current === undefined) {
          throw new StoryError('work-not-selected', '本会话还没有进入任何作品：先在面板进入一个作品，再扫描它')
        }
        if (explicit !== undefined && current !== undefined && explicit !== current) {
          throw new StoryError('work-mismatch', `本会话当前作品是 ${current}，不能直接扫描 ${explicit}`)
        }
        const work = resolveWork(session, explicit)
        if (work === undefined) throw new StoryError('work-not-selected', '本会话还没有当前作品：先在面板进入一个作品，或传入 workspace:true')
        return { ok: true, report: scanWork(root, work) }
      },
    }),

    action({
      name: 'story_history',
      description: '只读：列出一章的正文与章纲版本，标记当前版本与章纲批准状态。'
        + ' 回滚由作者在面板「版本」页操作，模型不要自行改版本。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          required: ['ok', 'history'],
          properties: {
            ok: { type: 'boolean' },
            history: { type: 'object', additionalProperties: true },
          },
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        return { ok: true, history: readChapterHistory(root, { work: args.work, chapter: args.chapter }) }
      },
    }),

    action({
      name: 'story_critique',
      description: '给一章做只读质检：字数是否在该作品范围内、句子长度、重复句、AI 腔词命中、对话占比。'
        + ' 只打分、不写文件、不阻断定稿；把发现交给 story_review 才会变成清单。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号。' },
        },
        required: ['work', 'chapter'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            workId: { type: 'string' },
            metrics: { type: 'object', additionalProperties: true },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', enum: ['word-range', 'repeated-sentence', 'ai-phrase', 'person-consistency', 'dialogue-ratio'] },
                  severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
                  detail: { type: 'string' },
                  refs: { type: 'array', items: { type: 'string' } },
                  quote: { type: 'string' },
                },
                required: ['code', 'severity', 'detail', 'refs'],
              },
            },
          },
          required: ['ok', 'workId', 'metrics', 'findings'],
        },
        render: OUTPUT.render,
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const manifest = await readManifest(root, args.work)
        const current = await readChapter(root, { work: args.work, chapter: args.chapter })
        const metrics = critique(current.content, manifest.wordRange)
        let perspective = ''
        try {
          const stored = readArtifact(root, { work: args.work, artifactId: `plan:${args.chapter}` })
          const memo = stored.artifact.content as { perspective?: unknown } | undefined
          perspective = typeof memo?.perspective === 'string' ? memo.perspective : ''
        } catch (error) {
          if ((error as { code?: unknown })?.code !== 'artifact-not-found') throw error
          perspective = ''
        }
        return { ok: true, workId: args.work, metrics, findings: findingsOf(String(current.content ?? ''), metrics, perspective) }
      },
    }),

    action({
      name: 'story_volume',
      mutates: true,
      description: '分卷：新建或更新一卷（标题、起止章、可选摘要）。'
        + ' 卷数不固定、按故事线由作者确认；区间不得与其它卷重叠，章必须已存在。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          id: { type: 'string', description: '要更新的卷 id；省略则新建。' },
          title: { type: 'string', description: '卷标题。' },
          from: { type: 'integer', description: '起始章号（含）。' },
          to: { type: 'integer', description: '结束章号（含）。' },
          summary: { type: 'string', description: '可选：本卷的短摘要。' },
        },
        required: ['work', 'title', 'from', 'to'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const result = await writeVolume(root, {
          work: args.work,
          ...(typeof args.id === 'string' ? { id: args.id } : {}),
          title: args.title,
          from: args.from,
          to: args.to,
          ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
        })
        const volume = result.volume
        return {
          ok: true,
          workId: args.work,
          volumes: result.volumes,
          volume,
          artifact: { workId: args.work, artifactId: `volume:${volume.id}`, revisionId: contentRevision(JSON.stringify(volume)), kind: 'volume' },
        }
      },
    }),

    action({
      name: 'story_volumes',
      description: '只读：列出作品的卷与起止章。写新章前想知道自己在哪一卷、上一卷写到哪时用它。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        return { ok: true, workId: args.work, volumes: await readVolumes(root, args.work) }
      },
    }),

    action({
      name: 'story_submit',
      description: '只允许被 story_delegate / story_settle 派发的子代理调用：把角色结果提交给宿主校验。校验失败可修正后重提；成功后父代理才会落盘。不要把正文当最终回答返回。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delegationId: { type: 'string', description: 'story_delegate 注入的一次性身份。' },
          phase: { type: 'string', enum: [...FOUNDATION_PHASES], description: 'architect foundation 的 phase；仅 stage=foundation 使用。' },
          payload: { type: 'object', additionalProperties: true, description: '角色结构化结果。' },
        },
        required: ['delegationId', 'payload'],
      },
      output: SUBMIT_OUTPUT,
      async execute(args, exec) {
        return submitPayload({
          delegationId: args.delegationId,
          ...(args.phase === undefined ? {} : { phase: String(args.phase) }),
          payload: args.payload,
          depth: delegationDepthOf(exec),
          root: workspaceOf(exec),
        })
      },
    }),

    action({
      name: 'story_delegate',
      mutates: true,
      description: '宿主侧委派一个角色完成单步：writer 写首版正文、reviewer 审稿并落清单、reviser 按未处理条目修订、summarizer 写本章摘要、'
        + 'architect 按 stage 生成基础设定（foundation 四 phase，details 带初始伏笔；design/cards/frame/rules/hooks/roles 手动兼容），planner 写首次章纲。'
        + ' 主编只收回执（版本/字数/审稿计数/警告/阶段），不接触正文与上下文；子代理通过 story_submit 提交，失败返回 delegation-no-submission。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
          chapter: { type: 'integer', description: '章号；architect 不需要。' },
          role: { type: 'string', enum: [...DELEGATE_ROLES], description: '本次要跑的角色。' },
          stage: { type: 'string', enum: [...FOUNDATION_STAGES], description: 'architect 的阶段；foundation 为同一 child 四 phase；其他角色忽略。' },
          instruction: { type: 'string', description: '作者本轮要求，会并入子代理任务。' },
          mode: {
            type: 'string',
            enum: ['patch', 'polish', 'rewrite', 'deslop'],
            description: '仅 reviser 使用；缺省 patch。',
          },
        },
        required: ['work', 'role'],
      },
      output: DELEGATE_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : undefined
        return delegateRole(root, args, {
          service,
          agent: exec.agent,
          signal: exec.signal,
          sessions: typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined,
        })
      },
    }),

    action({
      name: 'story_next',
      description: '查询这部作品下一步该做什么：动作名、章号、原因、缺什么（章纲/审稿/条目 id/foundation stage）与 blocked。'
        + ' blocked 非空表示必须等作者在面板动作（全书计划/章纲/基础设定确认），此时不要执行 action，也不要委派。'
        + ' 返回 delegate 时优先用 story_delegate（writer/reviewer/reviser/summarizer/architect/planner）；没有 delegate 时按 action 走手动路径。'
        + ' 每写完一步先调它，不要凭记忆猜下一步；它只读，不改任何文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      output: NEXT_OUTPUT,
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const next = await nextStepFor(root, args.work)
        return { ok: true, ...next }
      },
    }),

    action({
      name: 'story_status',
      description: '只读查看一部作品的进度：全书计划是否已确认、章数与状态、当前版本、未处理审稿问题、未解伏笔，'
        + '以及每章的 hasSummary / summaryRevision / summaryStale。不知道下一步该写什么时先读它。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const summary = await readStatus(root, args.work)
        return { ok: true, workId: summary.workId, status: summary }
      },
    }),

    action({
      name: 'story_export',
      mutates: true,
      description: '把一部作品导出成可读目录，返回 export:<workId>；作者从面板的只读导出路由取用，模型不接触路径。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const exported = exportWork(root, args.work)
        return { ok: true, workId: args.work, exported }
      },
    }),

    action({
      name: 'story_backup',
      mutates: true,
      description: '把一部作品的库与素材原文件备份成 DB + materials sidecar，返回 backup:<workId>:<timestamp> 与完整性检查结果；作者从只读备份路由取用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          work: { type: 'string', description: '作品 id。' },
        },
        required: ['work'],
      },
      async execute(args, exec) {
        const root = workspaceOf(exec)
        const backup = await createBackup(root, args.work, 0)
        return { ok: true, workId: args.work, backup }
      },
    }),
  ]
}

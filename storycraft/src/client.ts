import type * as ReactTypes from 'react'
import { fetchOwnRoute, probe, withinDeadline } from './client/api'

import type {
  ClientContext,
  ClientSlots,
  ClientLayout,
  ClientTabRegistration,
  ClientSessionSummary,
  ClientSessionSnapshot,
  PromptController,
  PromptResult,
  Bindings,
  FaceContext,
  WorkSummary,
  WorksPayload,
  WorkQueryFilters,
  ChapterQueryFilters,
  TrashItem,
  TrashPayload,
  WordRange,
  WorkOutline,
  WorkManifest,
  ChapterSummary,
  StateFact,
  StateHook,
  WorkState,
  WorkDetailPayload,
  DashboardChapter,
  DashboardHook,
  DashboardPayload,
  DashboardLoadState,
  AnalysisCallRow,
  AnalysisPayload,
  AnalysisLoadState,
  SelfCheckIssue,
  SelfCheckReport,
  SelfCheckState,
  CallLogRow,
  CallLogPage,
  LogsState,
  SearchHit,
  SearchGroup,
  SearchState,
  ChapterPayload,
  HistoryPayload,
  ReviewItem,
  ReviewPayload,
  CritiqueMetrics,
  Volume,
  VolumePayload,
  BibleFile,
  BiblePayload,
  FoundationState,
  FoundationDocument,
  FoundationPayload,
  BriefSection,
  BriefPayload,
  Material,
  MaterialPayload,
  BackupFile,
  BackupPayload,
  ExportsPayload,
  NextStep,
  WorkbenchAction,
  Workbench,
  NextPayload,
  CurrentPayload,
  ChapterMutationPayload,
  StyleExtraction,
  RosterPayload,
  Face,
  Instructions,
  WorkForm,
  VolumeForm,
  SettingsForm,
  MaterialEditing,
  BibleEditor,
  ChapterGroup,
  Notice,
  DetailState,
  ContentState,
  ReviewState,
  BibleState,
  FoundationLoadState,
  BriefLoadState,
  PresetHealth,
  ProjectListProps,
  EmptyStateProps,
  ChapterPanelProps,
  WorkDetailProps,
  StorycraftPageProps,
  StorycraftSideTabProps,
} from './client/types'

import { CSS } from './client/styles'

import { FOUNDATION_DOC_LABELS, FOUNDATION_STAGE_LABELS, MATERIAL_PURPOSE_LABELS, ROUTE, callOutcomeLabel, foundationDocLabel, hookStatusLabel } from './client/labels'


window.__ModuleLoader__.load({
  id: 'see-storycraft',
  factory(require: (name: string) => unknown) {
    const React = require('react') as typeof ReactTypes
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /**
     * The message the panel sends after an author approval.
     *
     * It stops the run: every later step is a judgement point (plan review,
     * observation triage, revision scope, chapter acceptance), so the panel only
     * records the decision and the conversation decides what happens next (#76).
     */
    const approvalMessage = (what: string): string =>
      `${what}已确认。请停在这一步，不要自动继续；等作者在会话里决定下一步。`

    // ---------------------------------------------------------------------
    // Types this bundle hands around. All of it is erased at build time: the
    // published file stays one plain script holding the loader's require('react').
    // ---------------------------------------------------------------------

    const BIBLE_LABELS: Record<string, string> = { world: '世界观', characters: '人物档案', style: '文风基准', plan: '全书计划', intent: '作者意图' }
    const CHAPTER_PAGE_SIZE = 20

    /** How long one Host answer may take before the page stops waiting. */


    /**
     * Read one client service without tripping the decoration guard.
     * @param ctx - browser plugin context.
     * @param name - exact service name.
     * @returns the service, or undefined.
     */
    // Dynamic boundary: the returned Host service shape is not declared here.

    /** Race one promise against the read deadline. */

    /**
     * Fetch one of this bundle's read-only routes.
     * @param path - path with query string.
     * @returns parsed JSON, or a thrown error carrying the server message.
     */
    // Dynamic boundary: each route's JSON payload is narrowed by its caller.

    /** The workspace the page is about: the shown Session's cwd. */
    function currentContext(ctx: ClientContext): FaceContext {
      const snapshot: ClientSessionSnapshot | undefined = (() => {
        try {
          return probe(ctx, 'sessions')?.list?.getSnapshot?.()
        } catch {
          return undefined
        }
      })()
      const byId = snapshot?.byId ?? {}
      const entries = Object.entries(byId).map(([sessionId, summary]) => ({ sessionId, summary }))
      const shown = entries.find(entry => (entry.summary?.retainedBy?.mainView ?? 0) > 0
        && typeof entry.summary?.cwd === 'string')
      const anySession = shown ?? entries.find(entry => typeof entry.summary?.cwd === 'string')
      if (anySession === undefined) return { root: undefined, sessionId: undefined, preset: undefined }
      return {
        root: anySession.summary.cwd,
        sessionId: anySession.summary.id ?? anySession.sessionId,
        preset: anySession.summary.projectionValues?.agentPreset,
      }
    }

    /** Fixed instruction templates the workbench sends to the current Session. */
    const INSTRUCTIONS: Instructions = {
      flowToRevision(workId, chapter) {
        return `写作品 ${workId} 第 ${chapter} 章：先调 story_next；有 delegate.role 时按角色调 story_delegate（writer 写正文、reviewer 审稿、reviser 修订），没有 delegate 时才按 action 走手动路径。`
          + '做到修订为止停下：把修订结果、剩余未处理条目与字数变化报给我，等我决定是否润色或去 AI 味，再定稿。汇报不粘贴正文。'
      },
      flowFull(workId, chapter) {
        return `写作品 ${workId} 第 ${chapter} 章并一路做完：先调 story_next；有 delegate.role 时按角色调 story_delegate，没有 delegate 时才按 action 手动做（章纲 → 正文 → 质检 → 审稿 → 修订/清稿 → 摘要 → 定稿）。摘要步骤若委派不可用或未提交，只报告并停手，不自动读正文、不重派。每步结果简短汇报，不粘贴正文，结尾给出本章摘要与下一步。`
      },
      step(workId, chapter, action) {
        const label = ({
          story_plan: '写本章章纲',
          story_write: '写本章正文',
          story_review: '审本章',
          story_revise: '按清单修订本章',
          story_settle: '结算：抽取状态草案（不写事件）',
          story_apply_draft: '接受状态草案（作者确认）',
          story_finalize: '定稿：应用草案并入账',
          story_state: '改状态草案（定稿前）',
          story_summarize: '写本章摘要',
          story_volume: '补本卷摘要',
        } as Record<string, string>)[action] ?? action
        const delegated = ({ story_write: 'writer', story_review: 'reviewer', story_revise: 'reviser' } as Record<string, string | undefined>)[action]
        const path = delegated === undefined
          ? `调 ${action}`
          : `先调 story_next，有 delegate.role 时调 story_delegate(role: ${delegated})，没有 delegate 时才调 ${action}`
        return `对作品 ${workId} 第 ${chapter} 章只做一步：${label}（${path}）。做完就停，把结果告诉我（不要粘贴正文），不要继续后面的步骤。`
      },
      nextChapter(workId, chapter) {
        return `继续写作品 ${workId} 第 ${chapter} 章：先调 story_next；有 delegate.role 时按角色调 story_delegate，没有 delegate 时才按 action 手动做（章纲 → 正文 → 质检 → 审稿 → 修订/清稿 → 摘要 → 定稿）。汇报不粘贴正文。`
      },
      review(workId, chapter) {
        return `对作品 ${workId} 第 ${chapter} 章做审稿：先调 story_next，有 delegate.role reviewer 时用 story_delegate；否则用 story_review。只找问题，不改正文，把问题清单落盘。`
      },
      revise(workId, chapter, mode) {
        const label = ({ patch: '局部修补', polish: '润色', rewrite: '重写', deslop: '去 AI 味' } as Record<string, string>)[mode] ?? '局部修补'
        if (mode === 'patch') {
          return `按作品 ${workId} 第 ${chapter} 章最新的审稿清单里未处理的条目修订正文：先调 story_next，有 delegate.role reviser 时用 story_delegate(mode: patch)；否则用 story_revise(mode: patch)，落盘并标记处理过的条目。汇报不粘贴正文。`
        }
        return `把作品 ${workId} 第 ${chapter} 章按「${label}」再修一遍：先调 story_next，有 delegate.role reviser 时用 story_delegate(mode: ${mode})；否则用 story_revise(mode: ${mode})，落盘为新版本。汇报不粘贴正文。`
      },
      planApproved(workId, chapter) {
        return `作品 ${workId} 第 ${chapter} 章的章纲已在面板确认，继续写正文：先调 story_next，有 delegate.role writer 时用 story_delegate；否则用 story_write。落盘后只汇报字数、版本与下一步，不要粘贴正文。`
      },
      outlineApproved(workId) {
        return `作品 ${workId} 的全书计划已在面板确认，按 story_next 给出的下一步继续。`
      },
      settings(workId, range, planApproval) {
        const policy = planApproval === 'off'
          ? '章纲确认设为不需要（planApproval 传 off），之后写正文前不必逐章确认。'
          : '章纲确认设为每章必须（planApproval 传 required），写正文前需要作者在面板确认章纲。'
        const size = range === null
          ? '清空字数范围（不按字数判定）'
          : `设定单章字数范围 ${range.min}–${range.max} 字`
        return `用 story_settings 给作品 ${workId} ${size}；${policy}`
      },
      volume(workId, volume) {
        const summary = typeof volume.summary === 'string' && volume.summary.trim() !== ''
          ? `，摘要：${volume.summary.trim()}`
          : ''
        const id = volume.id === undefined ? '' : `（更新卷 ${volume.id}）`
        return `用 story_volume 给作品 ${workId} 分卷${id}：标题「${volume.title}」，第 ${volume.from}–${volume.to} 章${summary}。`
      },
      restore(name) {
        return `用 story_restore 把回收站里的作品 ${name} 恢复回作品列表。`
      },
      rename(workId, title) {
        return `用 story_rename 把作品 ${workId} 的标题改成「${title}」。`
      },
      remove(workId) {
        return `用 story_delete 把作品 ${workId} 移入回收站（不要真的删除作品库）。`
      },
      reopen(workId, chapter) {
        return `把作品 ${workId} 第 ${chapter} 章的定稿撤销（story_reopen：只作废定稿，不改正文），然后重新审稿、按清单修订、再定稿。`
      },
      summarize(workId, chapter) {
        return `给作品 ${workId} 第 ${chapter} 章写摘要：先调 story_next；只有返回 delegate.role=summarizer 时才用 story_delegate(role: summarizer)；否则不读正文，回报「摘要已存在、已过期或当前阶段不需要摘要，重写请明确要求」。`
      },
      fold(workId, chapter) {
        return `把作品 ${workId} 第 ${chapter} 章已经发生的事实定稿进状态：先调 story_settle 自动抽取并校验；`
          + '返回 settled:false 时把 proposed 与 findings 报给我，按我的决定用 story_state 手动修正；'
          + '自动链路不可用时才直接用 story_state。'
      },
      newIdea(form, idea) {
        const formLabel = ({ longform: '长篇', short: '短篇', script: '剧本' } as Record<string, string>)[form] ?? '长篇'
        const text = String(idea ?? '').trim()
        return text === ''
          ? `我想写一部${formLabel}，还没想好具体写什么，先聊聊。`
          : `我想写一部${formLabel}，想法是：${text}`
      },
      confirm(proposalId) {
        return `我确认这份方案，可以立项：用 story_init 建作品（带 proposal: ${proposalId}），建完停下来告诉我作品 id 与下一步，不要继续写章纲。`
      },
    }

    /** Build the business face the page renders from. */
    function createFace(ctx: ClientContext, bindings: Bindings): Face {
      const route = (path: string, query: Record<string, unknown>, options: { cache?: RequestCache } = {}) => {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) params.set(key, String(value))
        }
        return fetchOwnRoute(`${path}?${params.toString()}`, options)
      }
      // Dynamic boundary: the Host answers each POST with its own JSON payload.
      const post = async (path: string, body: Record<string, unknown>): Promise<any> => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json()
        if (payload?.ok !== true) {
          const failure = new Error(payload?.error?.message ?? `请求失败：${response.status}`)
          ;(failure as Error & { code?: string }).code = payload?.error?.code
          throw failure
        }
        return payload
      }
      return {
        context: () => currentContext(ctx),
        listWorks: (root, filters) => route(ROUTE.works, { root, ...(filters ?? {}) }),
        listTrash: (root) => route(ROUTE.trash, { root }),
        restoreTrash: (root, workId) => post('/api/see-storycraft/trash/restore', { root, workId }),
        purgeTrash: (root, workId) => post('/api/see-storycraft/trash/purge', { root, workId, confirm: true }),
        createBackup: (root, sessionId, workId, keep) => post('/api/see-storycraft/backups/create', { root, sessionId, workId, keep }),
        rebuildIndex: (root, sessionId, workId) => post('/api/see-storycraft/recover/rebuild-index', { root, sessionId, workId, confirm: true }),
        restoreBackup: (root, sessionId, workId, backupId) => post('/api/see-storycraft/backups/restore', { root, sessionId, workId, backupId, confirm: true }),
        deleteBackup: (root, sessionId, workId, backupId) => post('/api/see-storycraft/backups/delete', { root, sessionId, workId, backupId, confirm: true }),
        volumes: (root, id) => route(ROUTE.volumes, { root, id }),
        critique: (root, id, chapter) => route(ROUTE.critique, { root, id, chapter }),
        next: (root, id) => route(ROUTE.next, { root, id }),
        getCurrent: (root, sessionId) => route(ROUTE.current, { root, sessionId }),
        setCurrent: (root, sessionId, workId) => post(ROUTE.current, { root, sessionId, workId }),
        work: (root, id, filters) => route(ROUTE.work, { root, id, ...(filters ?? {}) }),
        chapter: (root, id, chapter, view, revision) => route(ROUTE.chapter, { root, id, chapter, view, revision }),
        approveChapterPlan: (root, sessionId, workId, chapter) => post(ROUTE.approve, { root, sessionId, workId, chapter }),
        acceptChapter: (root, sessionId, workId, chapter) => post(ROUTE.accept, { root, sessionId, workId, chapter }),
        approveOutline: (root, sessionId, workId) => post(ROUTE.outlineApprove, { root, sessionId, workId }),
        dashboard: (root, id) => route(ROUTE.dashboard, { root, id }),
        analysis: (root, id) => route(ROUTE.analysis, { root, id }),
        selfCheck: (root, id) => route(ROUTE.selfCheck, { root, id }),
        search: (root, id, query) => route(ROUTE.search, { root, id, q: query }),
        logs: (root, id, options: { before?: number, failed?: boolean } = {}) => route(ROUTE.logs, { root, id, ...options }),
        transitionHook: (root, sessionId, workId, hookId, op) => post(ROUTE.hookTransition, { root, sessionId, workId, hookId, op }),
        foundation: (root, id) => route(ROUTE.foundation, { root, id }),
        approveFoundation: (root, sessionId, workId) => post(ROUTE.foundationApprove, { root, sessionId, workId }),
        history: (root, sessionId, workId, chapter) => post('/api/see-storycraft/chapter/history', { root, sessionId, workId, chapter }),
        adoptRevision: (root, sessionId, workId, chapter, target, revision, expectedCurrent) => post('/api/see-storycraft/chapter/adopt', {
          root, sessionId, workId, chapter, target, revision, expectedCurrent, confirm: true,
        }),
        review: (root, id, chapter) => route(ROUTE.review, { root, id, chapter }),
        bible: (root, id) => route(ROUTE.bible, { root, id }),
        writeBible: (root, sessionId, workId, file, content, expectedVersion) => post('/api/see-storycraft/bible/write', {
          root, sessionId, workId, file, content, expectedVersion,
        }),
        brief: (root, id, chapter) => route(ROUTE.brief, { root, id, chapter }),
        materials: (root, workId, purpose) => route(ROUTE.materials, {
          root, workId, ...(purpose === undefined ? {} : { purpose }),
        }, { cache: 'no-store' }),
        importMaterial: (root, sessionId, workId, name, contentBase64, title, purpose) => post(ROUTE.materialImport, {
          root, sessionId, workId, name, contentBase64,
          ...(title === undefined ? {} : { title }),
          ...(purpose === undefined ? {} : { purpose }),
        }),
        renameMaterial: (root, sessionId, workId, id, title) => post(ROUTE.materialRename, { root, sessionId, workId, id, title }),
        setMaterialPurpose: (root, sessionId, workId, id, purpose) => post(ROUTE.materialPurpose, { root, sessionId, workId, id, purpose }),
        deleteMaterial: (root, sessionId, workId, id) => post(ROUTE.materialDelete, { root, sessionId, workId, id }),
        extractStyle: (root, sessionId, workId) => post('/api/see-storycraft/style/extract', { root, sessionId, workId }),
        deleteChapter: (root, sessionId, workId, chapter) => post('/api/see-storycraft/chapter/delete', {
          root, sessionId, workId, chapter, confirm: true,
        }),
        moveChapter: (root, sessionId, workId, from, to) => post('/api/see-storycraft/chapter/move', {
          root, sessionId, workId, from, to,
        }),
        exportWork: (root, sessionId, workId) => post(ROUTE.exportWork, { root, sessionId, workId }),
        exports: (root, id) => route(ROUTE.exports, { root, id }),
        backups: (root, id) => route(ROUTE.backups, { root, id }),

        /** Open the right-sidebar tab by kind; false when the sidebar is absent. */
        openSidebarTab(kind) {
          const sidebar = ctx.get('sidebarRight')
          const layout = ctx.get('layout')
          if (sidebar === undefined) return false
          try {
            layout?.openRightbar?.(false, false)
            sidebar.openTab(kind, undefined)
            return true
          } catch {
            return false
          }
        },
        /** Send the main panel back to the conversation. */
        showConversation() {
          ctx.get('layout')?.selectPanel?.('conversation')
        },

        async send(text) {
          const context = currentContext(ctx)
          const sessionId = context.sessionId
          if (sessionId === undefined) {
            return '当前没有打开的会话：先在对话页打开或新建一个会话，再回来下发指令。'
          }
          if (!isStudio(context.preset)) {
            const shown = context.preset === undefined ? '没有记录预设' : `当前是 ${context.preset}`
            return `当前会话不是「故事工坊」模式（${shown}）：新建会话时选择「故事工坊」，再回来下发指令。`
          }
          const prompt: PromptController | undefined = bindings.prompt ?? probe(ctx, 'remote.session') ?? probe(ctx, 'remote')?.session
          if (prompt === undefined || typeof prompt.prompt !== 'function') {
            return '会话消息接口不可用：这个页面拿不到会话控制器，无法下发指令。'
          }
          try {
            const result = await withinDeadline(prompt.prompt({
              requestId: `storycraft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text }],
            }), '下发指令')
            if (result?.ok === false) return result.error?.message ?? '宿主拒绝了这条指令。'
            return undefined
          } catch (error) {
            return `下发失败：${error instanceof Error ? error.message : String(error)}`
          }
        },
      }
    }

    /**
     * Render the small Markdown subset works are written in.
     * @param text - markdown source.
     * @returns React nodes.
     */
    function renderMarkdown(text: string): ReactTypes.ReactNode[] {
      const lines = String(text ?? '').split(/\r?\n/)
      const blocks: ReactTypes.ReactNode[] = []
      let paragraph: string[] = []
      let list: string[] = []
      let ordered = false
      let code: string[] | null = null
      let key = 0
      const flushParagraph = () => {
        if (paragraph.length === 0) return
        blocks.push(h('p', { key: `p${key++}` }, paragraph.join(' ')))
        paragraph = []
      }
      const flushList = () => {
        if (list.length === 0) return
        blocks.push(h(ordered ? 'ol' : 'ul', { key: `l${key++}` }, ...list.map((item, index) => h('li', { key: index }, item))))
        list = []
        ordered = false
      }
      for (const line of lines) {
        if (code !== null) {
          if (/^\s*```/.test(line)) {
            blocks.push(h('pre', { key: `c${key++}` }, code.join('\n')))
            code = null
          } else {
            code.push(line)
          }
          continue
        }
        if (/^\s*```/.test(line)) {
          flushParagraph(); flushList()
          code = []
          continue
        }
        if (/^\s*$/.test(line)) {
          flushParagraph(); flushList()
          continue
        }
        if (/^\s*(---|\*\s*\*\s*\*)\s*$/.test(line)) {
          flushParagraph(); flushList()
          blocks.push(h('hr', { key: `h${key++}` }))
          continue
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(line)
        if (heading !== null) {
          flushParagraph(); flushList()
          blocks.push(h(`h${heading[1].length}`, { key: `t${key++}` }, heading[2]))
          continue
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
        if (bullet !== null) {
          flushParagraph()
          if (list.length > 0 && ordered) flushList()
          list.push(bullet[1])
          continue
        }
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
        if (numbered !== null) {
          flushParagraph()
          if (list.length > 0 && !ordered) flushList()
          ordered = true
          list.push(numbered[1])
          continue
        }
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote !== null) {
          flushParagraph(); flushList()
          blocks.push(h('blockquote', { key: `q${key++}` }, quote[1]))
          continue
        }
        paragraph.push(line.trim())
      }
      flushParagraph()
      flushList()
      if (code !== null) blocks.push(h('pre', { key: `c${key++}` }, code.join('\n')))
      return blocks.length === 0 ? [h('p', { key: 'empty', className: 'sc-muted' }, '（空）')] : blocks
    }

    /**
     * Whether a session may drive the studio.
     *
     * The old form-specific id is accepted while sessions created before the
     * preset merge still exist; new sessions use `storycraft`.
     * @param preset - session preset id.
     * @returns {boolean} true when the session is a studio session.
     */
    function isStudio(preset: string | undefined): boolean {
      return typeof preset === 'string' && preset.startsWith('storycraft')
    }

    /** Poll while the page is visible, plus immediate refresh on focus/reveal. */
    function useVisiblePolling(intervalMs: number, refresh: () => Promise<void>): void {
      useEffect(() => {
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const schedule = () => {
          if (cancelled) return
          timer = setTimeout(async () => {
            if (document.visibilityState === 'visible') await refresh()
            schedule()
          }, intervalMs)
        }
        const refreshNow = () => {
          if (document.visibilityState === 'visible') void refresh()
        }
        document.addEventListener('visibilitychange', refreshNow)
        window.addEventListener('focus', refreshNow)
        schedule()
        return () => {
          cancelled = true
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', refreshNow)
          window.removeEventListener('focus', refreshNow)
        }
      }, [intervalMs, refresh])
    }

    /** The forms a project may have, in the order the rail shows them. */
    const FORMS: WorkForm[] = [
      { id: 'longform', label: '长篇' },
      { id: 'short', label: '短篇' },
      { id: 'script', label: '剧本' },
    ]

    /**
     * The unit a work uses for its chapters.
     * @param form - work form.
     * @returns {string} 章 / 篇 / 集.
     */
    function unitOf(form: string): string {
      if (form === 'script') return '集'
      if (form === 'short') return '篇'
      return '章'
    }

    /** Human label of a pipeline stage. */
    function stageLabel(stage: string): string {
      const map: Record<string, string> = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
        settled: '已定稿',
      }
      return map[stage] ?? stage
    }

    /** Badge for a chapter state. */
    function statusBadge(status: string): string {
      const map: Record<string, string> = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
      }
      return map[status] ?? status
    }

    /**
     * Home view: the projects of one form, each opening into its detail page.
     * @param {object} props - works of this form, the form itself, open/create handlers.
     * @returns {object} the view.
     */
    function ProjectList({ works, form, filters, onFilters, onOpen, onCreate }: ProjectListProps) {
      const [idea, setIdea] = useState('')
      const [query, setQuery] = useState(filters.q ?? '')
      const workTitleRef = useRef<HTMLSelectElement>(null)
      const statusRef = useRef<HTMLSelectElement>(null)
      const issuesRef = useRef<HTMLSelectElement>(null)
      const apply = (next: WorkQueryFilters) => onFilters(next)
      const applyWorkFilters = () => apply({
        ...(query.trim() === '' && (workTitleRef.current?.value ?? '') === '' ? {} : { q: query.trim() || workTitleRef.current?.value }),
        ...(statusRef.current?.value === undefined || statusRef.current.value === '' ? {} : { status: statusRef.current.value }),
        ...(issuesRef.current?.value === undefined || issuesRef.current.value === '' ? {} : { issues: issuesRef.current.value === 'true' }),
      })
      const filtered = String(filters.q ?? '') !== '' || String(filters.status ?? '') !== '' || filters.issues !== undefined
      return h('div', { className: 'sc-projects' },
        h('h2', { className: 'sc-detail-title' }, `${form?.label ?? '作品'}`),
        h('div', { className: 'sc-filter-bar' },
          h('input', {
            className: 'sc-input sc-filter-input', 'aria-label': '搜索作品', placeholder: '搜索标题', list: 'sc-work-title-options',
            value: query, onChange: (event: Event) => setQuery((event.target as HTMLInputElement).value),
          }),
          h('datalist', { id: 'sc-work-title-options' }, ...works.map(work => h('option', { key: work.workId, value: work.title }))),
          h('select', { className: 'sc-input sc-narrow', 'aria-label': '作品标题', defaultValue: filters.q ?? '', ref: workTitleRef },
            h('option', { value: '' }, '全部标题'),
            ...works.map(work => h('option', { key: work.workId, value: work.title }, work.title)),
          ),
          form?.id === 'longform'
            ? h('select', { className: 'sc-input sc-narrow', 'aria-label': '作品状态', defaultValue: filters.status ?? '', ref: statusRef },
              h('option', { value: '' }, '全部状态'),
              h('option', { value: 'empty' }, '未开始'),
              h('option', { value: 'planning' }, '筹备中'),
              h('option', { value: 'writing' }, '写作中'),
              h('option', { value: 'settled' }, '已收尾'),
              h('option', { value: 'degraded' }, '不可读'),
            )
            : null,
          h('select', { className: 'sc-input sc-narrow', 'aria-label': '未处理筛选', defaultValue: filters.issues === undefined ? '' : filters.issues ? 'true' : 'false', ref: issuesRef },
            h('option', { value: '' }, '全部未处理'),
            h('option', { value: 'true' }, '有未处理'),
            h('option', { value: 'false' }, '无未处理'),
          ),
          h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: applyWorkFilters }, '筛选'),
          h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => {
            setQuery('')
            if (workTitleRef.current !== null) workTitleRef.current.value = ''
            if (statusRef.current !== null) statusRef.current.value = ''
            if (issuesRef.current !== null) issuesRef.current.value = ''
            apply({})
          } }, '清空'),
        ),
        works.length === 0
          ? h('p', { className: 'sc-muted' }, filtered ? '没有匹配的作品。' : `还没有${form?.label ?? ''}作品：在下面起一个。`)
          : h('div', { className: 'sc-project-grid' },
            ...works.map(work => h('button', {
              key: work.workId,
              type: 'button',
              className: 'sc-project',
              onClick: () => onOpen(work.workId),
            },
              h('span', { className: 'sc-project-title' }, work.title),
              h('span', { className: 'sc-work-meta' },
                work.degraded === true
                  ? `作品库打开失败：${work.openError?.code ?? 'unknown'}`
                  : `已写 ${work.writtenChapters}/${work.chapters} 章 · 最新第 ${work.latestChapter} 章`),
              h('span', { className: 'sc-work-meta' },
                work.degraded === true
                  ? work.openError?.retryable === true ? '库忙，稍后重试' : '请备份后重试或联系维护者'
                  : `未处理 ${work.openProblems} · 更新 ${String(work.updatedAt ?? '').replace('T', ' ').slice(0, 16)}`),
            )),
          ),
        h('div', { className: 'sc-field', style: { marginTop: 14 } },
          h('textarea', {
            className: 'sc-input',
            rows: 2,
            placeholder: `想写一部什么样的${form?.label ?? ''}？一句想法就够，也可以留空先聊`,
            value: idea,
            'aria-label': '作品想法',
            onChange: (event: ReactTypes.ChangeEvent<HTMLTextAreaElement>) => setIdea(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-primary',
            onClick: () => { onCreate(idea); setIdea('') },
          }, '新建作品'),
        ),
      )
    }

    /** Empty state: no work yet, with the one instruction that creates one. */
    function EmptyState({ face, notice, root, form, onCreated, canSend }: EmptyStateProps) {
      const [idea, setIdea] = useState('')
      const submit = async () => {
        const failure = await face.send(INSTRUCTIONS.newIdea(form, idea))
        onCreated(failure)
        setIdea('')
      }
      return h('div', { className: 'sc-empty' },
        h('h2', { className: 'sc-detail-title' }, '还没有作品'),
        h('p', null, '先和模型把想法聊清楚：讨论阶段不写文件；方向定了它会给一份建项方案，你确认后才立项。'),
        h('ul', { className: 'sc-steps' },
          h('li', null, '长篇 / 短篇 / 剧本各有独立流水线：长篇走章纲 → 正文 → 审稿 → 修订 → 摘要 → 定稿；形态在建档时写进作品，面板按形态给出下一步。'),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}` }, notice.text),
        h('div', { className: 'sc-field' },
          h('textarea', {
            className: 'sc-input',
            rows: 2,
            placeholder: '想写一部什么样的作品？一句想法就够，也可以留空先聊',
            value: idea,
            'aria-label': '作品想法',
            onChange: (event: ReactTypes.ChangeEvent<HTMLTextAreaElement>) => setIdea(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-primary',
            onClick: () => { void submit() },
          }, '新建作品'),
        ),
        h('p', { className: 'sc-item-body', style: { marginTop: 10 } },
          root === undefined
            ? '当前没有打开的工作区会话：先打开一个会话，页面才知道读哪个工作区。'
            : `当前工作区：${root}`),
      )
    }

    /** One chapter reader with plan/body tabs, review list and state. */
    /** Inline editor: shows the canned instruction, lets the author add specifics. */
    function ChapterPanel({
      face, root, workId, sessionId, chapter, latestChapter, unit, onNotice, onApproved, canSend, compose, hideActions,
    }: ChapterPanelProps) {
      const [view, setView] = useState('body')
      const [metrics, setMetrics] = useState<CritiqueMetrics | undefined>(undefined)
      const [reviseMode, setReviseMode] = useState('patch')
      const [revision, setRevision] = useState(0)
      const [history, setHistory] = useState<HistoryPayload | undefined>(undefined)
      const isLatest = latestChapter === undefined || chapter.number === latestChapter

      useEffect(() => { setRevision(0) }, [chapter.number])
      const [content, setContent] = useState<ContentState>({ status: 'loading' })
      const [review, setReview] = useState<ReviewState>({ status: 'loading' })

      const load = useCallback(async () => {
        if (view === 'versions') return
        setContent({ status: 'loading' })
        try {
          const target = view === 'body' ? (revision === 0 ? chapter.revision : revision) : undefined
          const payload = await face.chapter(root, workId, chapter.number, view, target)
          setContent({ status: 'ready', content: payload.content, path: payload.path, revision: payload.revision })
        } catch (error) {
          setContent({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }, [face, root, workId, chapter.number, chapter.revision, view, revision])

      useEffect(() => { void load() }, [load])

      const loadHistory = useCallback(async () => {
        if (sessionId === undefined) return
        try { setHistory(await face.history(root, sessionId, workId, chapter.number)) } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }, [face, root, workId, chapter.number, onNotice])

      useEffect(() => { if (view === 'versions') void loadHistory() }, [view, loadHistory])

      const adoptRevision = async (target: string, targetRevision: string, expected: string) => {
        if (sessionId === undefined) return
        if (!window.confirm(`回滚到 ${targetRevision}？这会生成一个新版本并把该章带回可重审状态。`)) return
        try {
          const result = await face.adoptRevision(root, sessionId, workId, chapter.number, target, targetRevision, expected)
          onNotice({ kind: 'ok', text: `已回滚，新版本 ${result.newRevision}；请重新审稿。` })
          setHistory(undefined)
          setView('body')
          setRevision(0)
          onApproved?.()
          await loadHistory()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      useEffect(() => {
        let cancelled = false
        setReview({ status: 'loading' })
        face.review(root, workId, chapter.number).then(
          (payload) => { if (!cancelled) setReview({ status: 'ready', items: payload.items, round: payload.round, revision: payload.revision }) },
          (error) => { if (!cancelled) setReview({ status: 'error', error: error instanceof Error ? error.message : String(error) }) },
        )
        return () => { cancelled = true }
      }, [face, root, workId, chapter.number, chapter.reviewRound])

      const send = async (text: string) => {
        const failure = await face.send(text)
        onNotice(failure === undefined ? { kind: 'ok', text: '指令已投递给当前会话。' } : { kind: 'error', text: failure })
      }


      return h('div', null,
        h('div', { className: 'sc-detail-head' },
          h('div', null,
            h('h2', { className: 'sc-detail-title' }, `第 ${chapter.number} ${unit ?? '章'}${chapter.title === '' ? '' : ` · ${chapter.title}`}`),
            h('p', { className: 'sc-detail-tagline' },
              `${stageLabel(chapter.stage)} · 当前版本 r${chapter.revision} · ${chapter.words} 字 · 审稿 ${chapter.reviewRound} 轮 · 未处理 ${chapter.openProblems} 条`),
          ),
          hideActions === true ? null : h('div', { className: 'sc-header-actions' },
            chapter.stage === 'settled'
              ? null
              : h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                onClick: () => compose(INSTRUCTIONS.review(workId, chapter.number)),
                disabled: chapter.revision === 0,
                title: '只找问题、不改正文，把问题清单落盘',
              }, '审稿'),
            chapter.stage === 'settled'
              ? null
              : h('select', {
                className: 'sc-input sc-narrow',
                'aria-label': '修订模式',
                value: reviseMode,
                onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => setReviseMode(event.target.value),
              },
                h('option', { value: 'patch' }, '局部修补'),
                h('option', { value: 'polish' }, '润色'),
                h('option', { value: 'rewrite' }, '重写'),
                h('option', { value: 'deslop' }, '去 AI 味'),
              ),
            chapter.stage === 'settled'
              ? null
              : h('button', {
                type: 'button',
                className: 'sc-btn',
                onClick: () => compose(INSTRUCTIONS.revise(workId, chapter.number, reviseMode)),
                disabled: chapter.openProblems === 0 && reviseMode === 'patch',
                title: chapter.openProblems === 0 && reviseMode === 'patch'
                  ? '局部修补要按审稿条目改：先审稿，或把模式换成润色/去 AI 味'
                  : '按条目或按模式再修一遍',
              }, reviseMode === 'patch' ? '按清单修订' : '按模式修订'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '只读质检：字数范围、句子长度、重复句、AI 腔命中',
              onClick: async () => {
                try {
                  const payload = await face.critique(root, workId, chapter.number)
                  setMetrics(payload.metrics)
                } catch (error) {
                  onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
                }
              },
            }, '质检'),
            chapter.stage === 'settled'
              ? h('button', {
                type: 'button',
                className: 'sc-btn',
                title: '只作废本章定稿、不改正文；之后重走 审稿 → 修订 → 定稿',
                onClick: () => compose(INSTRUCTIONS.reopen(workId, chapter.number)),
              }, '撤回定稿')
              : h('button', {
                type: 'button',
                className: 'sc-btn',
                disabled: !(chapter.stage === 'revised' || (chapter.stage === 'reviewed' && chapter.openProblems === 0))
                  || chapter.openProblems > 0
                  || chapter.hasSummary !== true,
                title: chapter.hasSummary !== true && chapter.openProblems === 0
                  && (chapter.stage === 'revised' || chapter.stage === 'reviewed')
                  ? chapter.summaryStale === true ? '摘要过期：先重写摘要，再定稿' : '先写摘要，再定稿'
                  : chapter.stage !== 'revised' && chapter.stage !== 'reviewed'
                    ? '先审稿、再按清单修订，才能定稿'
                    : chapter.openProblems > 0
                      ? `还有 ${chapter.openProblems} 条审稿未处理：先修订`
                      : '把本章的人物变化与伏笔记进书里，并把该章锁为已定稿',
                onClick: () => compose(INSTRUCTIONS.step(workId, chapter.number, chapter.stateDraftReady === true ? 'story_finalize' : 'story_settle')),
              }, chapter.stateDraftReady === true ? '定稿' : '结算'),
          ),
        ),
        chapter.stage === 'settled'
          ? h('p', { className: 'sc-muted' },
            '本章已定稿并锁定。要补审稿或改稿：点「撤回定稿」——只作废定稿、不动正文，然后重走 审稿 → 修订 → 定稿；要连正文一起重写，才让模型带 reopen 重写。')
          : null,
        chapter.stage !== 'settled' && chapter.openProblems === 0 && reviseMode === 'patch'
          ? h('p', { className: 'sc-muted' },
            chapter.stage === 'written'
              ? '还没有审稿清单：先点「审稿」，再按清单修订。'
              : '没有未处理条目：把模式换成润色/重写/去 AI 味可以直接再修一遍。')
          : null,
        metrics === undefined
          ? null
          : h('div', { className: 'sc-metrics' },
            h('div', { className: 'sc-actions' },
              h('span', { className: 'sc-badge' }, `${metrics.words} 字`),
              metrics.withinRange === undefined
                ? h('span', { className: 'sc-badge' }, '字数未设定')
                : h('span', { className: metrics.withinRange ? 'sc-badge sc-badge-ok' : 'sc-badge sc-badge-warn' },
                  metrics.withinRange
                    ? `在 ${metrics.wordRange!.min}–${metrics.wordRange!.max} 内`
                    : (metrics.shortBy !== undefined ? `少 ${metrics.shortBy} 字` : `多 ${metrics.longBy} 字`)),
              h('span', { className: 'sc-badge' }, `平均句长 ${metrics.sentences.averageLength}`),
              h('span', { className: 'sc-badge' }, `重复句 ${metrics.repeated.length}`),
              h('span', { className: metrics.aiPhrases.count > 0 ? 'sc-badge sc-badge-warn' : 'sc-badge' },
                `AI 腔命中 ${metrics.aiPhrases.count}`),
              h('span', { className: 'sc-badge' }, `对话占比 ${Math.round(metrics.dialogueRatio * 100)}%`),
            ),
            metrics.repeated.length === 0
              ? null
              : h('ul', { className: 'sc-metrics-list' },
                ...metrics.repeated.slice(0, 3).map(item => h('li', { key: item.text }, `${item.text}（${item.count} 次）`))),
            metrics.aiPhrases.hits.length === 0
              ? null
              : h('p', { className: 'sc-muted' },
                `命中：${metrics.aiPhrases.hits.slice(0, 6).map(hit => `${hit.phrase}×${hit.count}`).join('、')}`),
          ),
        h('div', { className: 'sc-tabs' },
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'body' ? 'true' : 'false', onClick: () => setView('body') }, '正文'),
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'plan' ? 'true' : 'false', onClick: () => setView('plan') }, '章纲'),
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'summary' ? 'true' : 'false', onClick: () => setView('summary') }, '摘要'),
          h('button', { type: 'button', className: 'sc-tab', 'aria-selected': view === 'versions' ? 'true' : 'false', onClick: () => setView('versions') }, '版本'),
        ),
        view === 'plan'
          ? h('div', { className: 'sc-row' },
            chapter.planApproved === true
              ? h('span', { className: 'sc-badge sc-badge-ok' }, '章纲已确认')
              : h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-small',
                onClick: async () => {
                  try {
                    await face.approveChapterPlan(root, sessionId, workId, chapter.number)
                    const failure = await face.send(approvalMessage(`第 ${chapter.number} 章章纲`))
                    onNotice?.(failure === undefined
                      ? { kind: 'ok', text: '章纲已确认，已通知会话继续。' }
                      : { kind: 'error', text: `章纲已确认，但通知会话失败：${failure}` })
                    onApproved?.()
                  } catch (error) {
                    onNotice?.({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
                  }
                },
              }, '确认章纲'),
          )
          : null,
        view === 'versions'
          ? h('div', { className: 'sc-section' },
            h('h3', { className: 'sc-section-title' }, '正文版本'),
            history === undefined
              ? h('p', { className: 'sc-muted' }, '读取中…')
              : h('div', null, ...history.body.map(row => h('div', { className: 'sc-item', key: row.revision },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-badge' }, `r${row.revision}`),
                  h('span', { className: 'sc-item-body' }, `${row.words} 字 · ${String(row.createdAt).slice(0, 16)}`),
                  row.current ? h('span', { className: 'sc-badge sc-badge-ok' }, '当前') : null,
                ),
                row.current ? null : h('button', {
                  type: 'button', className: 'sc-btn sc-btn-small',
                  disabled: chapter.stage === 'settled' || !isLatest,
                  title: chapter.stage === 'settled' ? '本章已定稿：先撤回定稿再回滚正文' : !isLatest ? '只能回滚当前章；旧章先切回' : undefined,
                  onClick: () => { void adoptRevision('body', `r${row.revision}`, history.currentRevision) },
                }, '回滚到这一版'),
              ))),
            h('h3', { className: 'sc-section-title' }, '章纲版本'),
            history === undefined
              ? h('p', { className: 'sc-muted' }, '读取中…')
              : h('div', null, ...history.plan.map(row => h('div', { className: 'sc-item', key: row.revisionId },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-id' }, row.revisionId),
                  h('span', { className: 'sc-item-body' }, String(row.createdAt).slice(0, 16)),
                  row.current ? h('span', { className: 'sc-badge sc-badge-ok' }, '当前') : null,
                  row.approved ? h('span', { className: 'sc-badge' }, '已确认') : null,
                  history.planApproval === 'off' ? h('span', { className: 'sc-badge' }, '无需确认') : null,
                ),
                row.current ? null : h('button', {
                  type: 'button', className: 'sc-btn sc-btn-small',
                  disabled: chapter.stage !== 'planned' || !isLatest,
                  title: chapter.stage !== 'planned' ? '章纲回滚只允许未写正文的章节' : !isLatest ? '只能回滚当前章；旧章先切回' : undefined,
                  onClick: () => { void adoptRevision('plan', row.revisionId, history.plan.find(item => item.current)?.revisionId ?? '') },
                }, '回滚到这一版'),
              ))),
          )
          : null,
        view === 'body' && chapter.revision > 1
          ? h('div', { className: 'sc-tabs' },
            ...Array.from({ length: chapter.revision }, (_, index) => index + 1).map(version => h('button', {
              key: version,
              type: 'button',
              className: 'sc-tab',
              'aria-selected': (revision === 0 ? chapter.revision : revision) === version ? 'true' : 'false',
              onClick: () => setRevision(version === chapter.revision ? 0 : version),
            }, `r${version}`)),
          )
          : null,
        view === 'versions' ? null : content.status === 'loading' ? h('p', { className: 'sc-muted' }, '读取中…') : null,
        view === 'versions' ? null : content.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, content.error) : null,
        view === 'versions' || content.status !== 'ready'
          ? null
          : h('div', { className: 'sc-prose' }, ...renderMarkdown(content.content)),
        view === 'versions' || content.status !== 'ready'
          ? null
          : h('p', { className: 'sc-item-body', style: { marginTop: 8 } }, `${content.path}${view === 'body' ? `（r${content.revision}）` : ''}`),

        view === 'versions' ? null : h('div', { className: 'sc-section' },
          h('h3', { className: 'sc-section-title' }, '审稿清单'),
          review.status === 'loading' ? h('p', { className: 'sc-muted' }, '读取中…') : null,
          review.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, review.error) : null,
          review.status === 'ready' && review.items.length === 0
            ? h('p', { className: 'sc-muted' }, review.revision === chapter.revision && chapter.reviewRound > 0 ? '本章为清稿审稿：没有未处理问题。' : '这一章还没有针对当前版本的审稿记录。')
            : null,
          review.status === 'ready'
            ? review.items.map(item => h('div', { className: 'sc-item', key: item.id },
              h('div', { className: 'sc-item-head' },
                h('span', { className: 'sc-item-id' }, item.id),
                h('span', { className: item.done ? 'sc-done' : 'sc-open' },
                  item.assessment === 'resolved' ? '已解决' : item.done ? '不阻断' : '未处理'),
                item.severity === undefined ? null : h('span', { className: 'sc-badge' }, item.severity),
                h('span', { className: 'sc-item-body' }, item.location),
              ),
              h('p', { className: 'sc-item-body' }, item.problem),
              ...(item.evidence ?? []).map((evidence, index) => h('p', { className: 'sc-item-body', key: `e${index}` }, `证据：${evidence}`)),
              item.suggestion === '' ? null : h('p', { className: 'sc-item-body' }, `修法：${item.suggestion}`),
            ))
            : null,
        ),
      )
    }

    /** Read-only self-check shared by the dashboard and the detail error branch. */
    function SelfCheckPanel({ face, root, workId }: { face: Face, root: string | undefined, workId: string }) {
      const [state, setState] = useState<SelfCheckState>({ status: 'idle' })
      const [open, setOpen] = useState(false)
      const request = useRef(0)

      useEffect(() => {
        request.current += 1
        setState({ status: 'idle' })
        setOpen(false)
      }, [workId])

      const run = async () => {
        const ticket = ++request.current
        setState({ status: 'loading' })
        try {
          const payload = await face.selfCheck(root, workId)
          if (ticket !== request.current) return
          setState({ status: 'ready', report: payload.report })
        } catch (error) {
          if (ticket !== request.current) return
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const label = state.status === 'loading' ? '检查中…' : state.status === 'ready' ? '重新自检' : '运行自检'
      return h('section', { className: 'sc-dash-section sc-self-check', 'aria-label': '自检' },
        h('div', { className: 'sc-item-head' },
          h('h3', { className: 'sc-section-title' }, '自检'),
          h('button', {
            type: 'button', className: 'sc-btn sc-btn-small',
            onClick: () => setOpen(value => !value),
          }, open ? '收起自检' : '展开自检'),
        ),
        open
          ? h('div', { className: 'sc-self-check-body' },
            h('div', { className: 'sc-actions' },
              h('button', {
                type: 'button', className: 'sc-btn sc-btn-small',
                disabled: state.status === 'loading',
                onClick: () => { void run() },
              }, label),
            ),
            state.status === 'idle'
              ? h('p', { className: 'sc-muted' }, '运行自检检查库完整性、检索索引、章节版本与状态草案；只读，不自动修复。')
              : state.status === 'loading'
                ? h('p', { className: 'sc-muted' }, '读取自检…')
                : state.status === 'error'
                  ? h('div', null,
                    h('p', { className: 'sc-notice sc-notice-error' }, state.error),
                    h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void run() } }, '重试'),
                  )
                  : h('div', { className: 'sc-self-check-result', 'aria-live': 'polite' },
                    h('p', {
                      className: state.report.ok
                        ? (state.report.issues.length === 0 ? 'sc-badge sc-badge-ok' : 'sc-badge sc-badge-warn')
                        : 'sc-badge sc-badge-error',
                    },
                      state.report.ok
                        ? (state.report.issues.length === 0 ? '未发现问题' : '无错误 · ' + state.report.issues.length + ' 条提醒')
                        : '发现 ' + state.report.issues.filter(item => item.severity === 'error').length + ' 个错误'),
                    h('p', { className: 'sc-muted' }, '检查 ' + state.report.checked + ' 组 · ' + state.report.issues.length + ' 条结果'),
                    state.report.issues.length === 0
                      ? null
                      : h('ul', { className: 'sc-self-check-list' },
                        ...state.report.issues.map((item, index) => h('li', { key: item.code + '-' + index },
                          h('span', { className: item.severity === 'error' ? 'sc-badge sc-badge-error' : 'sc-badge sc-badge-warn' }, item.severity),
                          h('span', null, (item.chapter === undefined ? '' : '第 ' + item.chapter + ' 章 · ') + item.message + '（' + item.code + '）'),
                        ))),
                  ),
          )
          : null,
      )
    }

    /** Lazy call log for the current work; no prompt or output text. */
    function LogsPanel({ face, root, workId }: { face: Face, root: string | undefined, workId: string }) {
      const [logs, setLogs] = useState<LogsState>({ status: 'idle' })
      const [open, setOpen] = useState(false)
      const [failedOnly, setFailedOnly] = useState(false)
      const request = useRef(0)

      useEffect(() => {
        request.current += 1
        setLogs({ status: 'idle' })
        setOpen(false)
        setFailedOnly(false)
      }, [workId])

      const load = async (append: boolean, failed: boolean, before?: number) => {
        const ticket = ++request.current
        const previous = append && logs.status === 'ready' ? logs.rows : []
        setLogs({ status: 'loading' })
        try {
          const payload = await face.logs(root, workId, {
            ...(before === undefined ? {} : { before }),
            ...(failed ? { failed: true } : {}),
          })
          if (ticket !== request.current) return
          setLogs({
            status: 'ready',
            rows: append ? [...previous, ...payload.logs.rows] : payload.logs.rows,
            nextBefore: payload.logs.nextBefore,
          })
        } catch (error) {
          if (ticket !== request.current) return
          setLogs({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const toggle = () => {
        const next = !open
        setOpen(next)
        if (next && logs.status === 'idle') void load(false, failedOnly)
      }

      return h('section', { className: 'sc-dash-section sc-logs', 'aria-label': '日志' },
        h('div', { className: 'sc-item-head' },
          h('h3', { className: 'sc-section-title' }, '日志'),
          h('button', {
            type: 'button', className: 'sc-btn sc-btn-small',
            onClick: toggle,
          }, open ? '收起日志' : '展开日志'),
        ),
        open
          ? h('div', { className: 'sc-logs-body' },
            h('div', { className: 'sc-actions' },
              h('button', {
                type: 'button', className: failedOnly ? 'sc-btn sc-btn-small' : 'sc-btn sc-btn-small sc-btn-primary',
                'aria-pressed': !failedOnly,
                onClick: () => {
                  if (failedOnly) {
                    setFailedOnly(false)
                    void load(false, false)
                  }
                },
              }, '全部'),
              h('button', {
                type: 'button', className: failedOnly ? 'sc-btn sc-btn-small sc-btn-primary' : 'sc-btn sc-btn-small',
                'aria-pressed': failedOnly,
                onClick: () => {
                  if (!failedOnly) {
                    setFailedOnly(true)
                    void load(false, true)
                  }
                },
              }, '仅失败'),
              h('button', {
                type: 'button', className: 'sc-btn sc-btn-small',
                disabled: logs.status === 'loading',
                onClick: () => { void load(false, failedOnly) },
              }, '刷新'),
            ),
            logs.status === 'idle'
              ? h('p', { className: 'sc-muted' }, '展开后读取调用记录。')
              : logs.status === 'loading'
                ? h('p', { className: 'sc-muted' }, '读取日志…')
                : logs.status === 'error'
                  ? h('div', null,
                    h('p', { className: 'sc-notice sc-notice-error' }, logs.error),
                    h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void load(false, failedOnly) } }, '重新加载'),
                  )
                  : logs.rows.length === 0
                    ? h('p', { className: 'sc-muted' }, failedOnly ? '没有失败调用。' : '还没有调用记录。')
                    : h('div', { className: 'sc-log-list', role: 'list' },
                      ...logs.rows.map(row => h('div', { className: 'sc-log-row', key: row.id, role: 'listitem' },
                        h('div', { className: 'sc-log-line' },
                          h('span', {
                            className: row.outcome === 'accepted'
                              ? 'sc-badge sc-badge-ok'
                              : row.outcome === 'completed' || row.outcome === 'cancelled'
                                ? 'sc-badge sc-badge-warn' : 'sc-badge sc-badge-error',
                          }, callOutcomeLabel(row.outcome)),
                          h('span', { className: 'sc-item-name' }, row.role + (row.chapter === null ? '' : ' · 第 ' + row.chapter + ' 章')),
                          h('span', { className: 'sc-muted' }, '第 ' + row.attempt + ' 次' + (row.submissionAttempts === null ? '' : ' · 提交 ' + row.submissionAttempts)),
                        ),
                        h('div', { className: 'sc-log-meta' },
                          h('span', null, row.trigger),
                          h('span', null, row.durationMs + 'ms'),
                          h('span', null, row.totalTokens === null ? 'token 未知' : row.totalTokens + ' tokens'),
                          h('span', null, row.usageSource),
                          h('span', null, row.model ?? '模型未记录'),
                          h('span', null, row.provider ?? 'provider 未记录'),
                          h('span', null, new Date(row.startedAt).toLocaleString()),
                          row.errorCode === null ? null : h('span', { className: 'sc-badge sc-badge-error' }, row.errorCode),
                          row.stopReason === null ? null : h('span', { className: 'sc-muted' }, row.stopReason),
                        ),
                      )),
                      logs.nextBefore === null
                        ? null
                        : h('button', {
                          type: 'button', className: 'sc-btn sc-btn-small',
                          onClick: () => { void load(true, failedOnly, logs.nextBefore as number) },
                        }, '更早'),
                    ),
          )
          : null,
      )
    }

    /** Unified read-only search: memory, materials and skill references. */
    function SearchPanel({ face, root, workId }: { face: Face, root: string | undefined, workId: string }) {
      const [state, setState] = useState<SearchState>({ status: 'idle' })
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const request = useRef(0)

      useEffect(() => {
        request.current += 1
        setState({ status: 'idle' })
        setOpen(false)
        setQuery('')
      }, [workId])

      const run = async () => {
        const text = query.trim()
        if (text === '') {
          setState({ status: 'ready', groups: [] })
          return
        }
        const ticket = ++request.current
        setState({ status: 'loading' })
        try {
          const payload = await face.search(root, workId, text)
          if (ticket !== request.current) return
          setState({ status: 'ready', groups: payload.search.groups })
        } catch (error) {
          if (ticket !== request.current) return
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const labels: Record<string, string> = { memory: '记忆', material: '素材', skill: '技能' }
      let content: any
      if (state.status === 'loading') content = h('p', { className: 'sc-muted' }, '检索中…')
      else if (state.status === 'error') content = h('p', { className: 'sc-notice sc-notice-error' }, state.error)
      else if (state.status === 'ready' && state.groups.length === 0) {
        content = h('p', { className: 'sc-muted' }, query.trim() === '' ? '输入关键词后检索。' : '没有命中。')
      } else if (state.status === 'ready') {
        content = h('div', { className: 'sc-search-groups' },
          ...state.groups.map(group => h('div', { className: 'sc-search-group', key: group.kind, 'data-search-kind': group.kind },
            h('div', { className: 'sc-search-group-head' }, labels[group.kind] ?? group.kind),
            group.hits.length === 0
              ? h('p', { className: 'sc-muted' }, '没有命中。')
              : h('div', { className: 'sc-search-hits' },
                ...group.hits.map(hit => h('div', { className: 'sc-search-hit', key: hit.id },
                  h('div', { className: 'sc-search-hit-head' },
                    h('span', { className: 'sc-badge' }, hit.kind),
                    h('span', null, hit.source),
                    hit.location === undefined ? null : h('span', { className: 'sc-muted' }, hit.location),
                  ),
                  h('p', { className: 'sc-search-snippet' }, hit.snippet),
                ))),
          )));
      } else {
        content = h('p', { className: 'sc-muted' }, '输入关键词检索记忆、素材与技能参考。')
      }
      return h('section', { className: 'sc-dash-section sc-search', 'aria-label': '检索' },
        h('div', { className: 'sc-item-head' },
          h('h3', { className: 'sc-section-title' }, '检索'),
          h('button', {
            type: 'button', className: 'sc-btn sc-btn-small',
            onClick: () => setOpen(value => !value),
          }, open ? '收起检索' : '展开检索'),
        ),
        open
          ? h('div', { className: 'sc-search-body' },
            h('div', { className: 'sc-search-form' },
              h('input', {
                className: 'sc-input', 'aria-label': '检索关键词', placeholder: '查记忆、素材或技能参考',
                value: query,
                onChange: (event: Event) => setQuery((event.target as HTMLInputElement).value),
                onKeyDown: (event: KeyboardEvent) => {
                  if (event.key === 'Enter') { event.preventDefault(); void run() }
                },
              }),
              h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void run() } }, '检索'),
            ),
            content,
          )
          : null,
      )
    }

    /** Work detail: header actions, chapter list, selected chapter, state. */
    function WorkDetail({
      face, root, workId, sessionId, onBack, onNotice, notice, canSend, compose,
    }: WorkDetailProps) {
      const [detail, setDetail] = useState<DetailState>({ status: 'loading' })
      const [selected, setSelected] = useState<number | undefined>(undefined)
      const [stateOpen, setStateOpen] = useState(false)
      const [bible, setBible] = useState<BibleState>({ status: 'idle' })
      const [foundation, setFoundation] = useState<FoundationLoadState>({ status: 'idle' })
      const [dashboard, setDashboard] = useState<DashboardLoadState>({ status: 'idle' })
      const [analysis, setAnalysis] = useState<AnalysisLoadState>({ status: 'idle' })
      const [analysisOpen, setAnalysisOpen] = useState(false)
      const [rhythmChapter, setRhythmChapter] = useState<number | undefined>(undefined)
      const [rhythm, setRhythm] = useState<CritiqueMetrics | undefined>(undefined)
      const analysisRequest = useRef(0)
      const rhythmRequest = useRef(0)
      const [summaryView, setSummaryView] = useState<{ chapter: number, content: string } | undefined>(undefined)
      const [bibleEditor, setBibleEditor] = useState<BibleEditor | undefined>(undefined)
      const bibleTextareaRef = useRef<HTMLTextAreaElement | null | undefined>(undefined)
      const bibleTriggerRef = useRef<HTMLElement | null | undefined>(undefined)
      const [tab, setTab] = useState('chapters')
      const [chapterPage, setChapterPage] = useState(1)
      const [chapterFilters, setChapterFilters] = useState<ChapterQueryFilters>({})
      const [chapterQuery, setChapterQuery] = useState('')
      const chapterTitleRef = useRef<HTMLSelectElement>(null)
      const chapterStageRef = useRef<HTMLSelectElement>(null)
      const chapterIssuesRef = useRef<HTMLSelectElement>(null)
      const [exportInfo, setExportInfo] = useState<ExportsPayload | undefined>(undefined)
      const [backupList, setBackupList] = useState<BackupFile[]>([])
      const [backupKeep, setBackupKeep] = useState(() => {
        try {
          const saved = Number(localStorage.getItem('storycraft.backup.keep'))
          return [0, 5, 10, 20].includes(saved) ? saved : 10
        } catch {
          return 10
        }
      })
      const [brief, setBrief] = useState<BriefLoadState>({ status: 'idle' })
      const [materials, setMaterials] = useState<Material[]>([])
      const [exporting, setExporting] = useState(false)
      const [materialBusy, setMaterialBusy] = useState(false)
      const [materialError, setMaterialError] = useState<string | undefined>(undefined)
      const [materialEditing, setMaterialEditing] = useState<MaterialEditing | undefined>(undefined)
      const [chapterBusy, setChapterBusy] = useState(false)
      const [styleBusy, setStyleBusy] = useState(false)
      const [materialPurpose, setMaterialPurpose] = useState('reference')
      const [materialFilter, setMaterialFilter] = useState('all')
      const [briefChapter, setBriefChapter] = useState(1)
      const materialFileRef = useRef<HTMLInputElement>(null)
      const materialTitleInputRef = useRef<HTMLInputElement>(null)
      const [renaming, setRenaming] = useState<string | undefined>(undefined)
      const [volumes, setVolumes] = useState<Volume[]>([])
      const [volumeForm, setVolumeForm] = useState<VolumeForm | undefined>(undefined)
      const [settingsForm, setSettingsForm] = useState<SettingsForm | undefined>(undefined)
      const [next, setNext] = useState<NextStep | undefined>(undefined)
      const [workbench, setWorkbench] = useState<Workbench | undefined>(undefined)
      const [reviseMode, setReviseMode] = useState('patch')
      const [refreshError, setRefreshError] = useState<string | undefined>(undefined)
      const refreshInFlight = useRef(false)

      const load = useCallback(async () => {
        try {
          const payload = await face.work(root, workId, chapterFilters)
          setDetail({ status: 'ready', ...payload })
          const listed = await face.volumes(root, workId).catch(() => ({ volumes: [] }))
          setVolumes(listed.volumes ?? [])
          const step = await face.next(root, workId).catch(() => ({ next: undefined, workbench: undefined }))
          setNext(step.next)
          setWorkbench(step.workbench)
          if (sessionId !== undefined) {
            void face.setCurrent(root, sessionId, workId).catch(() => {})
          }
          const matches = payload.chapterMatches ?? payload.chapters
          const filtering = Object.keys(chapterFilters).length > 0
          setSelected(current => matches.some(item => item.number === current)
            ? current
            : (filtering || matches.length === 0 ? undefined : matches[matches.length - 1].number))
        } catch (error) {
          setDetail({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }, [face, root, workId, chapterFilters])

      const moveChapter = async (item: ChapterSummary, delta: number) => {
        if (sessionId === undefined || detail.status !== 'ready' || chapterBusy) return
        const ordered = [...detail.chapters].sort((left, right) => left.number - right.number)
        const index = ordered.findIndex(chapter => chapter.number === item.number)
        const target = ordered[index + delta]
        if (target === undefined) return
        setChapterBusy(true)
        try {
          const payload = await face.moveChapter(root, sessionId, workId, item.number, target.number)
          setSelected(target.number)
          onNotice({ kind: 'ok', text: `已移动：第 ${item.number} 章 → 第 ${target.number} 章` })
          if ((payload.staleVolumes ?? []).length > 0) {
            onNotice({ kind: 'error', text: `章序已改；卷区间需要调整：${payload.staleVolumes.join('、')}` })
          }
          await load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setChapterBusy(false)
        }
      }

      const removeChapter = async (item: ChapterSummary) => {
        if (sessionId === undefined || chapterBusy) return
        if (typeof window !== 'undefined' && !window.confirm(`删除第 ${item.number} 章？这会删除其正文、章纲、摘要和审稿；删除前会自动备份。`)) return
        setChapterBusy(true)
        try {
          const payload = await face.deleteChapter(root, sessionId, workId, item.number)
          const remaining = payload.chapters ?? []
          const nextSelected = remaining.includes(item.number)
            ? item.number
            : [...remaining].filter(number => number < item.number).at(-1)
          setSelected(nextSelected)
          onNotice({ kind: 'ok', text: `已删除第 ${item.number} 章；删除前已备份。` })
          if ((payload.staleVolumes ?? []).length > 0) {
            onNotice({ kind: 'error', text: `卷区间需要调整：${payload.staleVolumes.join('、')}` })
          }
          await load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setChapterBusy(false)
        }
      }

      const extractStyle = async () => {
        if (sessionId === undefined || styleBusy) return
        setStyleBusy(true)
        try {
          const payload = await face.extractStyle(root, sessionId, workId)
          onNotice({
            kind: 'ok',
            text: `已抽取 ${payload.sampleCount} 段文风样例（${payload.sampleChars} 字）；句数 ${payload.metrics?.sentences ?? 0}，平均句长 ${payload.metrics?.avgSentence ?? 0}`,
          })
          await load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setStyleBusy(false)
        }
      }

      const createBackupNow = async () => {
        if (sessionId === undefined) return
        try {
          localStorage.setItem('storycraft.backup.keep', String(backupKeep))
        } catch {}
        try {
          const result = await face.createBackup(root, sessionId, workId, backupKeep)
          onNotice({ kind: 'ok', text: `已备份；按策略清理 ${result.pruned ?? 0} 份旧备份` })
          await refreshBackups()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const rebuildSearchNow = async () => {
        if (sessionId === undefined) return
        if (!window.confirm('重建检索索引会用作品库里的章节、摘要、事件和素材重新生成索引；不改正文。继续？')) return
        try {
          const result = await face.rebuildIndex(root, sessionId, workId)
          const total = Object.values(result.counts ?? {}).reduce((sum, count) => sum + Number(count ?? 0), 0)
          onNotice({ kind: 'ok', text: `已重建检索索引：${total} 条文档` })
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const restoreBackupItem = async (item: BackupFile) => {
        if (sessionId === undefined) return
        if (!window.confirm(item.materials !== undefined
          ? '恢复会用这个备份覆盖当前作品库和素材原文件；恢复前会自动备份当前版本。继续？'
          : '恢复会用这个备份覆盖当前作品库（不含素材原文件）；恢复前会自动备份当前版本。继续？')) return
        try {
          const result = await face.restoreBackup(root, sessionId, workId, item.backupId) as { materialsRestored?: number, hasMaterials?: boolean }
          setSelected(undefined)
          setChapterPage(1)
          setBible({ status: 'idle' })
          setBrief({ status: 'idle' })
          onNotice({ kind: 'ok', text: result.hasMaterials === true
            ? `已恢复备份与 ${result.materialsRestored ?? 0} 份素材；当前作品已重新读取`
            : '已恢复备份（不含素材 sidecar）；当前作品已重新读取' })
          await load()
          await refreshBackups()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const deleteBackupItem = async (item: BackupFile) => {
        if (sessionId === undefined) return
        if (!window.confirm('删除这个备份文件？此操作不可撤销。')) return
        try {
          await face.deleteBackup(root, sessionId, workId, item.backupId)
          onNotice({ kind: 'ok', text: '已删除备份' })
          await refreshBackups()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const refreshDetail = useCallback(async () => {
        if (refreshInFlight.current) return
        refreshInFlight.current = true
        try {
          const [payload, listed, step] = await Promise.all([
            face.work(root, workId, chapterFilters),
            face.volumes(root, workId).catch(() => ({ volumes: [] })),
            face.next(root, workId).catch(() => ({ next: undefined, workbench: undefined })),
          ])
          setDetail({ status: 'ready', ...payload })
          setVolumes(listed.volumes ?? [])
          setNext(step.next)
          setWorkbench(step.workbench)
          setRefreshError(undefined)
        } catch (error) {
          setRefreshError(error instanceof Error ? error.message : String(error))
        } finally {
          refreshInFlight.current = false
        }
      }, [face, root, workId, chapterFilters])

      useEffect(() => { void load() }, [load])
      useEffect(() => { setBriefChapter(selected ?? 1) }, [selected])

      // A silent poll keeps the detail honest without replaying the loading
      // state, resetting the chapter selection, or writing the current pointer.
      useVisiblePolling(15000, refreshDetail)

      const loadFoundation = async () => {
        setFoundation({ status: 'loading' })
        try {
          const payload = await face.foundation(root, workId)
          setFoundation({ status: 'ready', foundation: payload.foundation, documents: payload.documents ?? [] })
        } catch (error) {
          setFoundation({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const loadDashboard = async () => {
        setDashboard({ status: 'loading' })
        try {
          const payload = await face.dashboard(root, workId)
          setDashboard({ status: 'ready', dashboard: payload.dashboard })
        } catch (error) {
          setDashboard({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const transitionHook = async (hookId: string, op: 'progress' | 'resolve') => {
        if (sessionId === undefined) {
          onNotice({ kind: 'error', text: '先打开一个会话再标记伏笔' })
          return
        }
        try {
          const payload = await face.transitionHook(root, sessionId, workId, hookId, op)
          setDashboard({ status: 'ready', dashboard: payload.dashboard })
          setSummaryView(undefined)
          onNotice({ kind: 'ok', text: op === 'progress' ? '已标记为已用（推进）' : '已标记为已解' })
          void load()
        } catch (error) {
          const code = (error as Error & { code?: string }).code
          const text = code === 'chapter-settled'
            ? '当前没有未定稿的已写章：先撤回定稿或写正文，再标记伏笔。'
            : code === 'state-draft-pending'
              ? '本章还有状态草案：先接受或丢弃草案，再标记伏笔。'
              : error instanceof Error ? error.message : String(error)
          onNotice({ kind: 'error', text })
        }
      }

      const openSummary = async (chapter: number) => {
        try {
          const payload = await face.chapter(root, workId, chapter, 'summary', undefined)
          setSummaryView({ chapter, content: payload.content })
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      useEffect(() => {
        if (summaryView === undefined) return undefined
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') setSummaryView(undefined)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [summaryView])

      useEffect(() => {
        // WorkDetail is not re-keyed per work; drop analysis from the previous work.
        analysisRequest.current += 1
        rhythmRequest.current += 1
        setAnalysis({ status: 'idle' })
        setAnalysisOpen(false)
        setRhythmChapter(undefined)
        setRhythm(undefined)
      }, [workId])

      const loadAnalysis = async () => {
        const request = ++analysisRequest.current
        setAnalysis({ status: 'loading' })
        try {
          const payload = await face.analysis(root, workId)
          if (request !== analysisRequest.current) return
          setAnalysis({ status: 'ready', analysis: payload.analysis })
        } catch (error) {
          if (request !== analysisRequest.current) return
          setAnalysis({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const loadRhythm = async (chapter: number) => {
        const request = ++rhythmRequest.current
        setRhythmChapter(chapter)
        setRhythm(undefined)
        try {
          const payload = await face.critique(root, workId, chapter)
          if (request !== rhythmRequest.current) return
          setRhythm(payload.metrics)
        } catch (error) {
          if (request !== rhythmRequest.current) return
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const loadBible = async () => {
        setBible({ status: 'loading' })
        try {
          const payload = await face.bible(root, workId)
          setBible({
            status: 'ready',
            files: payload.files ?? [],
            missing: payload.missing ?? [],
            editable: payload.editable ?? [],
          })
        } catch (error) {
          setBible({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const editableTemplates: Record<string, string> = {
        world: '# 世界观\n\n',
        style: '# 文风基准\n\n',
        intent: '# 作者意图\n\n',
        characters: '[]',
      }

      const openBibleEditor = (file: BibleFile) => {
        if (bibleEditor !== undefined) return
        bibleTriggerRef.current = typeof document === 'undefined' ? undefined : document.activeElement as HTMLElement | null
        setBibleEditor({
          name: file.name,
          content: file.content,
          original: file.content,
          version: file.version,
          saving: false,
          error: undefined,
        })
      }

      const openMissingBible = (name: string) => {
        if (bibleEditor !== undefined || !editableTemplates[name]) return
        bibleTriggerRef.current = typeof document === 'undefined' ? undefined : document.activeElement as HTMLElement | null
        setBibleEditor({
          name,
          content: editableTemplates[name],
          original: editableTemplates[name],
          version: undefined,
          saving: false,
          error: undefined,
        })
      }

      const cancelBibleEditor = () => {
        if (bibleEditor?.saving === true) return
        setBibleEditor(undefined)
        setTimeout(() => bibleTriggerRef.current?.focus?.(), 0)
      }

      const saveBibleEditor = async () => {
        if (bibleEditor === undefined || bibleEditor.saving || sessionId === undefined) return
        setBibleEditor(current => current === undefined ? current : { ...current, saving: true, error: undefined })
        const content = bibleTextareaRef.current?.value ?? bibleEditor.content
        try {
          const saved = await face.writeBible(root, sessionId, workId, bibleEditor.name, content, bibleEditor.version)
          onNotice({ kind: 'ok', text: `已保存 v${saved.version}` })
          setBibleEditor(undefined)
          setTimeout(() => bibleTriggerRef.current?.focus?.(), 0)
          await loadBible()
        } catch (error) {
          setBibleEditor(current => current === undefined ? current : {
            ...current,
            saving: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const bibleLabel = (name: string) => BIBLE_LABELS[name] ?? name
      const isBibleDirty = () => bibleEditor !== undefined
        && (bibleTextareaRef.current?.value ?? bibleEditor.content) !== bibleEditor.original

      const requestCloseBible = () => {
        if (bibleEditor?.saving === true) return
        if (isBibleDirty()) {
          onNotice({ kind: 'error', text: '真值还有未保存内容：先保存或取消' })
          return
        }
        setBibleEditor(undefined)
        setTimeout(() => bibleTriggerRef.current?.focus?.(), 0)
      }

      useEffect(() => {
        if (bibleEditor === undefined) return undefined
        const timer = setTimeout(() => bibleTextareaRef.current?.focus(), 0)
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            requestCloseBible()
            return
          }
          if (event.key !== 'Tab') return
          const drawer = document.querySelector('.sc-drawer')
          const focusables = drawer === null ? [] : [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')]
          if (focusables.length === 0) return
          const first = focusables[0]
          const last = focusables.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last!.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => {
          clearTimeout(timer)
          window.removeEventListener('keydown', onKey)
        }
      }, [bibleEditor])

      const switchTab = (next: string): boolean => {
        if (next === tab) return false
        if (isBibleDirty()) {
          onNotice({ kind: 'error', text: '真值还有未保存内容：先保存或取消' })
          return false
        }
        setTab(next)
        if (next === 'truth' && bible.status === 'idle') void loadBible()
        if (next === 'dashboard') void loadDashboard()
        return true
      }

      useEffect(() => {
        if (detail.status !== 'ready') return
        const index = [...(detail.chapterMatches ?? detail.chapters)].sort((left, right) => right.number - left.number)
          .findIndex(chapter => chapter.number === selected)
        if (index >= 0) setChapterPage(Math.floor(index / CHAPTER_PAGE_SIZE) + 1)
      }, [selected])

      useEffect(() => {
        if (tab !== 'exports') return
        face.exports(root, workId).then(setExportInfo).catch(() => setExportInfo({ exists: false }))
      }, [tab, face, root, workId])

      const refreshBackups = () => face.backups(root, workId)
        .then(result => setBackupList(result.backups ?? []))
        .catch(error => onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }))

      useEffect(() => {
        if (tab !== 'backups') return
        void refreshBackups()
      }, [tab, face, root, workId])

      const loadBrief = async (chapter: number) => {
        setBrief({ status: 'loading', chapter })
        try {
          const payload = await face.brief(root, workId, chapter)
          setBrief({ status: 'ready', chapter, ...payload })
        } catch (error) {
          setBrief({ status: 'error', chapter, error: error instanceof Error ? error.message : String(error) })
        }
      }

      const loadMaterials = useCallback(async () => {
        try {
          const payload = await face.materials(root, workId, materialFilter === 'all' ? undefined : materialFilter)
          setMaterials(payload.materials ?? [])
          setMaterialError(undefined)
        } catch (error) {
          setMaterialError(error instanceof Error ? error.message : String(error))
        }
      }, [face, root, workId, materialFilter])

      useEffect(() => { void loadMaterials() }, [loadMaterials])

      const importMaterialFile = async (event: ReactTypes.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file === undefined || sessionId === undefined) return
        setMaterialBusy(true)
        setMaterialError(undefined)
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          let binary = ''
          for (let index = 0; index < bytes.length; index += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
          }
          await face.importMaterial(root, sessionId, workId, file.name, btoa(binary), undefined, materialPurpose)
          await loadMaterials()
        } catch (error) {
          setMaterialError(error instanceof Error ? error.message : String(error))
        } finally {
          setMaterialBusy(false)
        }
      }

      const changeMaterialPurpose = async (material: Material, purpose: string) => {
        if (sessionId === undefined) return
        setMaterialBusy(true)
        setMaterialError(undefined)
        try {
          await face.setMaterialPurpose(root, sessionId, workId, material.id, purpose)
          await loadMaterials()
        } catch (error) {
          setMaterialError(error instanceof Error ? error.message : String(error))
        } finally {
          setMaterialBusy(false)
        }
      }

      const renameMaterial = async () => {
        if (materialEditing === undefined || sessionId === undefined) return
        setMaterialBusy(true)
        setMaterialError(undefined)
        try {
          const title = materialTitleInputRef.current?.value ?? materialEditing.title
          await face.renameMaterial(root, sessionId, workId, materialEditing.id, title)
          setMaterialEditing(undefined)
          await loadMaterials()
        } catch (error) {
          setMaterialError(error instanceof Error ? error.message : String(error))
        } finally {
          setMaterialBusy(false)
        }
      }

      const removeMaterial = async (material: Material) => {
        if (sessionId === undefined) return
        if (!window.confirm(`删除素材「${material.title}」？作品库与检索会移除，磁盘副本保留。`)) return
        setMaterialBusy(true)
        setMaterialError(undefined)
        try {
          await face.deleteMaterial(root, sessionId, workId, material.id)
          await loadMaterials()
        } catch (error) {
          setMaterialError(error instanceof Error ? error.message : String(error))
        } finally {
          setMaterialBusy(false)
        }
      }

      const runExport = async () => {
        if (sessionId === undefined || exporting) return
        setExporting(true)
        try {
          const payload = await face.exportWork(root, sessionId, workId)
          onNotice({ kind: 'ok', text: `已导出 ${payload.files} 个文件：${payload.directory}` })
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setExporting(false)
        }
      }

      const showExportDirectory = async () => {
        try {
          const payload = await face.exports(root, workId)
          onNotice({
            kind: 'ok',
            text: payload.exists === true ? `导出目录：${payload.directory}` : '还没有导出：点「导出」生成。',
          })
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      if (detail.status === 'loading') return h('p', { className: 'sc-muted' }, '读取作品…')
      if (detail.status === 'error') {
        return h('div', { className: 'sc-self-check-fallback' },
          h('div', { className: 'sc-actions' },
            h('button', { type: 'button', className: 'sc-btn', onClick: onBack }, '← 全部作品'),
          ),
          h('p', { className: 'sc-notice sc-notice-error' }, detail.error),
          h(SelfCheckPanel, { face, root, workId }),
        )
      }

      const manifest = detail.manifest
      const chapters = detail.chapters
      const chapterMatches = detail.chapterMatches ?? chapters
      const chapterFiltered = Object.keys(chapterFilters).length > 0
      const chapter = chapters.find(item => item.number === selected)
      const orderedChapters = [...chapters].sort((left, right) => left.number - right.number)
      const reversedChapters = [...chapterMatches].sort((left, right) => right.number - left.number)
      const pageCount = Math.max(1, Math.ceil(reversedChapters.length / CHAPTER_PAGE_SIZE))
      const safePage = Math.min(Math.max(1, chapterPage), pageCount)
      const pageChapters = reversedChapters.slice((safePage - 1) * CHAPTER_PAGE_SIZE, safePage * CHAPTER_PAGE_SIZE)
      const pageGroups = chapterGroups(pageChapters, volumes)
        .map(group => ({ ...group, chapters: [...group.chapters].sort((left, right) => right.number - left.number) }))
        .filter(group => group.chapters.length > 0)
        .sort((left, right) => Math.max(...right.chapters.map(chapter => chapter.number)) - Math.max(...left.chapters.map(chapter => chapter.number)))
      const nextNumber = chapters.length === 0 ? 1 : chapters[chapters.length - 1].number + 1

      const send = async (text: string) => {
        const failure = await face.send(text)
        onNotice(failure === undefined ? { kind: 'ok', text: '指令已投递给当前会话。' } : { kind: 'error', text: failure })
      }

      const cardChapter = next === undefined ? nextNumber : next.chapter
      const confirmFoundationNow = async () => {
        if (sessionId === undefined) {
          onNotice({ kind: 'error', text: '先打开一个会话再确认基础设定' })
          return
        }
        try {
          await face.approveFoundation(root, sessionId, manifest.workId)
          const failure = await face.send(approvalMessage('基础设定'))
          onNotice(failure === undefined
            ? { kind: 'ok', text: '基础设定已确认，已通知会话继续。' }
            : { kind: 'error', text: `基础设定已确认，但通知会话失败：${failure}` })
          void loadFoundation()
          void load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }
      const confirmOutlineNow = async () => {
        if (sessionId === undefined) return
        try {
          await face.approveOutline(root, sessionId, manifest.workId)
          const failure = await face.send(approvalMessage('全书计划'))
          onNotice(failure === undefined
            ? { kind: 'ok', text: '全书计划已确认，已通知会话继续。' }
            : { kind: 'error', text: `全书计划已确认，但通知会话失败：${failure}` })
          void load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }
      const confirmPlanNow = async (chapter: number) => {
        if (sessionId === undefined) return
        try {
          await face.approveChapterPlan(root, sessionId, manifest.workId, chapter)
          const failure = await face.send(approvalMessage(`第 ${chapter} 章章纲`))
          onNotice(failure === undefined
            ? { kind: 'ok', text: '章纲已确认，已通知会话继续。' }
            : { kind: 'error', text: `章纲已确认，但通知会话失败：${failure}` })
          void load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }
      const acceptChapterNow = async (chapter: number) => {
        if (sessionId === undefined) return
        try {
          const accepted = await face.acceptChapter(root, sessionId, manifest.workId, chapter)
          const failure = await face.send(
            `第 ${chapter} 章已由作者接受当前版本（${accepted.accepted} 条审稿不再修改）。`
            + '请调 story_next，按返回的下一步继续；遇到下一个作者闸门就停下等我确认，不要跳过。',
          )
          onNotice(failure === undefined
            ? { kind: 'ok', text: '已接受当前版本，已通知会话继续。' }
            : { kind: 'error', text: `已接受当前版本，但通知会话失败：${failure}` })
          void load()
        } catch (error) {
          onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }
      const runWorkbench = (id: string) => {
        const chapter = cardChapter
        switch (id) {
          case 'confirm-foundation': void confirmFoundationNow(); return
          case 'confirm-outline': void confirmOutlineNow(); return
          case 'confirm-plan': void confirmPlanNow(chapter); return
          case 'accept': void acceptChapterNow(chapter); return
          case 'write-chapter': compose(INSTRUCTIONS.flowToRevision(workId, chapter)); return
          case 'full-flow': compose(INSTRUCTIONS.flowFull(workId, chapter)); return
          case 'export': void runExport(); return
          case 'write-plan': compose(INSTRUCTIONS.step(workId, chapter, 'story_plan')); return
          case 'rewrite-plan': compose(INSTRUCTIONS.step(workId, chapter, 'story_plan')); return
          case 'next-plan': compose(INSTRUCTIONS.step(workId, chapter + 1, 'story_plan')); return
          case 'rewrite-outline': compose(INSTRUCTIONS.step(workId, 1, 'story_outline')); return
          case 'open-outline': switchTab('truth'); return
          case 'write-outline': compose(INSTRUCTIONS.step(workId, chapter, 'story_outline')); return
                case 'review': compose(INSTRUCTIONS.review(workId, chapter)); return
          case 'revise': compose(INSTRUCTIONS.revise(workId, chapter, reviseMode)); return
          case 'summarize': compose(INSTRUCTIONS.step(workId, chapter, 'story_summarize')); return
          case 'settle': compose(INSTRUCTIONS.step(workId, chapter, 'story_settle')); return
          case 'apply-draft': compose(INSTRUCTIONS.step(workId, chapter, 'story_apply_draft')); return
          case 'finalize': compose(INSTRUCTIONS.step(workId, chapter, 'story_finalize')); return
          case 'volume-summary': compose(INSTRUCTIONS.step(workId, chapter, 'story_volume')); return
          default: onNotice({ kind: 'error', text: `面板不认识这个动作：${id}` })
        }
      }
      const workbenchButton = (item: WorkbenchAction, primary: boolean) => h('button', {
        type: 'button',
        className: primary ? 'sc-btn sc-btn-primary' : 'sc-btn',
        'data-workbench': item.id,
        ...(item.disabled === undefined
          ? {}
          : {
            disabled: true,
            title: item.disabled.reason,
            'aria-label': `${item.label}（${item.disabled.reason}）`,
            'aria-describedby': `wb-reason-${item.id}`,
          }),
        onClick: () => { runWorkbench(item.id) },
      }, item.label)
      const workbenchReason = (item: WorkbenchAction) => item.disabled === undefined
        ? null
        : h('span', { key: `reason-${item.id}`, id: `wb-reason-${item.id}`, className: 'sc-sr-only' }, item.disabled.reason)

      return h('div', null,
        refreshError !== undefined
          ? h('p', { className: 'sc-notice sc-notice-info' }, `刷新失败：${refreshError}`)
          : null,
        h('div', { className: 'sc-detail-head' },
          h('div', null,
            h('button', {
              type: 'button',
              className: 'sc-back',
              onClick: () => {
                if (isBibleDirty()) {
                  onNotice({ kind: 'error', text: '先保存或取消当前真值编辑' })
                  return
                }
                onBack()
              },
            }, '← 全部作品'),
            h('h2', { className: 'sc-detail-title' }, manifest.title),
            h('p', { className: 'sc-detail-tagline' }, `${manifest.form} · ${manifest.workId} · ${chapters.length} ${unitOf(manifest.form)} · 已写 ${chapters.filter(item => item.revision > 0).length} ${unitOf(manifest.form)}`),
          ),
          h('div', { className: 'sc-header-actions' },
            h('button', {
              type: 'button',
              className: 'sc-btn',
              disabled: styleBusy || sessionId === undefined,
              title: '从当前正文确定性地抽取文风样例，写入 style 的受管区块',
              onClick: () => { void extractStyle() },
            }, styleBusy ? '抽取中…' : '抽取文风'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              disabled: exporting || sessionId === undefined,
              title: '由宿主直接导出到 .storycraft/exports；不经过模型',
              onClick: () => { void runExport() },
            }, exporting ? '导出中…' : '导出'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '显示作者导出目录（只读路由，不把路径交给模型）',
              onClick: () => { void showExportDirectory() },
            }, '导出目录'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '查看基础设定（故事框架/卷图/规则/角色）与确认状态',
              onClick: () => {
                if (tab !== 'truth' && !switchTab('truth')) return
                void loadFoundation()
              },
            }, foundation.status === 'loading' ? '读取基础设定…' : '基础设定'),
            foundation.status === 'ready' && foundation.foundation?.complete === true && foundation.foundation?.approvedAt === undefined
              && workbench?.primary.id !== 'confirm-foundation'
              ? h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                disabled: sessionId === undefined,
                title: sessionId === undefined ? '先打开一个会话再确认基础设定' : '确认基础设定后，再写全书计划',
                onClick: async () => {
                  try {
                    await face.approveFoundation(root, sessionId, manifest.workId)
                    const failure = await face.send(approvalMessage('基础设定'))
                    onNotice(failure === undefined
                      ? { kind: 'ok', text: '基础设定已确认，已通知会话继续。' }
                      : { kind: 'error', text: `基础设定已确认，但通知会话失败：${failure}` })
                    void loadFoundation()
                    void load()
                  } catch (error) {
                    onNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
                  }
                },
              }, '确认基础设定')
              : null,
            manifest.outline?.approvedAt !== undefined
              ? h('span', { className: 'sc-badge sc-badge-ok' }, '计划已确认')
              : null,
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '设定单章字数范围（不设就不判定）',
              onClick: () => setSettingsForm({
                ...(manifest.wordRange ?? { min: 3000, max: 5000 }),
                planApproval: manifest.planApproval ?? 'required',
              }),
            }, '字数范围'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '把若干章划成一卷（模型建议，作者确认）',
              onClick: () => setVolumeForm({ title: '', from: 1, to: chapters.length === 0 ? 1 : chapters.length, summary: '' }),
            }, '新建卷'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '改作品标题（目录与 id 不变）',
              onClick: () => { setRenaming(manifest.title) },
            }, '改名'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              title: '移入回收站，可用 story_restore 恢复',
              onClick: () => {
                if (!window.confirm(`把作品「${manifest.title}」移入回收站？作品库不会真删，可用 story_restore 恢复。`)) return
                compose(INSTRUCTIONS.remove(manifest.workId))
              },
            }, '删除'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void load() } }, '刷新'),
          ),
        ),
        workbench === undefined
          ? null
          : h('div', { className: 'sc-state-card', 'data-state': workbench.key },
            h('div', { className: 'sc-state-head' },
              h('span', { className: 'sc-state-label' }, workbench.label),
              h('span', { className: 'sc-state-hint' }, workbench.hint)),
            h('div', { className: 'sc-state-actions' },
              workbenchButton(workbench.primary, true),
              ...workbench.secondary.map(item => workbenchButton(item, false)),
              ...workbench.secondary.map(item => workbenchReason(item)))),
        settingsForm === undefined
          ? null
          : h('div', { className: 'sc-rename' },
            h('span', { className: 'sc-muted' }, '单章字数'),
            h('input', {
              className: 'sc-input sc-narrow',
              type: 'number',
              value: settingsForm.min,
              'aria-label': '最少字数',
              onChange: event => setSettingsForm(form => ({ ...form, min: Number(event.target.value) } as SettingsForm)),
            }),
            h('span', { className: 'sc-muted' }, '到'),
            h('input', {
              className: 'sc-input sc-narrow',
              type: 'number',
              value: settingsForm.max,
              'aria-label': '最多字数',
              onChange: event => setSettingsForm(form => ({ ...form, max: Number(event.target.value) } as SettingsForm)),
            }),
            h('span', { className: 'sc-muted' }, '章纲确认'),
            h('select', {
              className: 'sc-input sc-narrow',
              'aria-label': '章纲确认策略',
              value: settingsForm.planApproval ?? 'required',
              onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => setSettingsForm(form => ({ ...form, planApproval: event.target.value } as SettingsForm)),
            },
            h('option', { value: 'required' }, '每章必须确认'),
            h('option', { value: 'off' }, '不需要确认'),
            ),
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              onClick: () => {
                compose(INSTRUCTIONS.settings(manifest.workId, settingsForm, settingsForm.planApproval))
                setSettingsForm(undefined)
              },
            }, '保存设置'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              onClick: () => {
                compose(INSTRUCTIONS.settings(manifest.workId, null, settingsForm.planApproval))
                setSettingsForm(undefined)
              },
            }, '清空'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => setSettingsForm(undefined) }, '取消'),
          ),
        volumeForm === undefined
          ? null
          : h('div', { className: 'sc-volume-form' },
            h('input', {
              className: 'sc-input',
              placeholder: '卷标题，例如：第一折：塌方',
              value: volumeForm.title,
              'aria-label': '卷标题',
              onChange: event => setVolumeForm(form => ({ ...form, title: event.target.value } as VolumeForm)),
            }),
            h('div', { className: 'sc-actions' },
              h('input', {
                className: 'sc-input sc-narrow',
                type: 'number',
                value: volumeForm.from,
                'aria-label': '起始章',
                onChange: event => setVolumeForm(form => ({ ...form, from: Number(event.target.value) } as VolumeForm)),
              }),
              h('span', { className: 'sc-muted' }, '到'),
              h('input', {
                className: 'sc-input sc-narrow',
                type: 'number',
                value: volumeForm.to,
                'aria-label': '结束章',
                onChange: event => setVolumeForm(form => ({ ...form, to: Number(event.target.value) } as VolumeForm)),
              }),
            ),
            h('textarea', {
              className: 'sc-input',
              rows: 2,
              placeholder: '可选：本卷摘要',
              value: volumeForm.summary,
              'aria-label': '卷摘要',
              onChange: (event: ReactTypes.ChangeEvent<HTMLTextAreaElement>) => setVolumeForm(form => ({ ...form, summary: event.target.value } as VolumeForm)),
            }),
            h('div', { className: 'sc-actions' },
              h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                disabled: volumeForm.title.trim() === '',
                onClick: () => {
                  compose(INSTRUCTIONS.volume(manifest.workId, volumeForm))
                  setVolumeForm(undefined)
                },
              }, volumeForm.id === undefined ? '创建卷' : '保存卷'),
              h('button', { type: 'button', className: 'sc-btn', onClick: () => setVolumeForm(undefined) }, '取消'),
            ),
          ),
        renaming === undefined
          ? null
          : h('div', { className: 'sc-rename' },
            h('input', {
              className: 'sc-input',
              value: renaming,
              'aria-label': '新的作品标题',
              onChange: event => setRenaming(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && renaming.trim() !== '') {
                  compose(INSTRUCTIONS.rename(manifest.workId, renaming.trim()))
                  setRenaming(undefined)
                }
                if (event.key === 'Escape') setRenaming(undefined)
              },
            }),
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              disabled: renaming.trim() === '',
              onClick: () => {
                compose(INSTRUCTIONS.rename(manifest.workId, renaming.trim()))
                setRenaming(undefined)
              },
            }, '确认改名'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => setRenaming(undefined) }, '取消'),
          ),
        h('div', { className: 'sc-badges' },
          chapters.some(item => item.openProblems > 0)
            ? h('span', { className: 'sc-badge sc-badge-warn' }, `未处理问题 ${chapters.filter(item => item.openProblems > 0).length} 章 · ${chapters.reduce((sum, item) => sum + item.openProblems, 0)} 条`)
            : h('span', { className: 'sc-badge sc-badge-ok' }, '没有未处理问题'),
          h('span', { className: 'sc-badge' }, `伏笔 未解 ${detail.state.hooks.filter(hook => ['open', 'progressing', 'deferred'].includes(hook.status)).length}`),
        ),
        h('div', { className: 'sc-main-tabs', role: 'tablist', 'aria-label': '作品面板' },
          ...['dashboard', 'chapters', 'truth', 'context', 'materials', 'exports', 'backups'].map((name, index) => h('button', {
            key: name,
            type: 'button',
            role: 'tab',
            id: `sc-tab-${name}`,
            'aria-selected': tab === name ? 'true' : 'false',
            'aria-controls': `sc-panel-${name}`,
            tabIndex: tab === name ? 0 : -1,
            className: 'sc-main-tab',
            onClick: () => switchTab(name),
            onKeyDown: event => {
              const order = ['dashboard', 'chapters', 'truth', 'context', 'materials', 'exports', 'backups']
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length
              if (switchTab(order[next])) document.getElementById(`sc-tab-${order[next]}`)?.focus()
            },
          }, name === 'dashboard' ? '看板' : name === 'chapters' ? '章节' : name === 'truth' ? '真值' : name === 'context' ? '写前上下文' : name === 'materials' ? '素材' : name === 'exports' ? '导出' : '备份')),
        ),
        notice === undefined ? null : h('p', { className: `sc-notice sc-notice-${notice.kind}`, style: { marginTop: 12 } }, notice.text),

        h('div', {
          className: 'sc-two-col sc-tab-panel',
          id: 'sc-panel-chapters',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-chapters',
          hidden: tab !== 'chapters',
        },
          h('div', { className: 'sc-col' },
            h('h3', { className: 'sc-section-title' }, '章节'),
            h('div', { className: 'sc-filter-bar' },
              h('input', {
                className: 'sc-input sc-filter-input', 'aria-label': '搜索章节', placeholder: '章号或标题', list: 'sc-chapter-title-options',
                value: chapterQuery, onChange: (event: Event) => setChapterQuery((event.target as HTMLInputElement).value),
              }),
              h('datalist', { id: 'sc-chapter-title-options' }, ...chapters.map(item => h('option', { key: item.number, value: item.title }))),
              h('select', { className: 'sc-input sc-narrow', 'aria-label': '章节标题', defaultValue: '', ref: chapterTitleRef },
                h('option', { value: '' }, '全部标题'),
                ...chapters.map(item => h('option', { key: item.number, value: item.title }, `第 ${item.number} 章 · ${item.title}`)),
              ),
              h('select', { className: 'sc-input sc-narrow', 'aria-label': '章节阶段', defaultValue: chapterFilters.stage ?? '', ref: chapterStageRef },
                h('option', { value: '' }, '全部阶段'),
                h('option', { value: 'planned' }, '已规划'),
                h('option', { value: 'written' }, '已写'),
                h('option', { value: 'reviewed' }, '已审'),
                h('option', { value: 'revised' }, '已修订'),
                h('option', { value: 'settled' }, '已定稿'),
              ),
              h('select', { className: 'sc-input sc-narrow', 'aria-label': '章节未处理', defaultValue: chapterFilters.issues === undefined ? '' : chapterFilters.issues ? 'true' : 'false', ref: chapterIssuesRef },
                h('option', { value: '' }, '全部未处理'),
                h('option', { value: 'true' }, '有未处理'),
                h('option', { value: 'false' }, '无未处理'),
              ),
              h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => {
                setSelected(current => chapterMatches.some(item => item.number === current) ? current : undefined)
                setChapterPage(1)
                setChapterFilters({
                  ...(chapterQuery.trim() === '' && (chapterTitleRef.current?.value ?? '') === '' ? {} : { q: chapterQuery.trim() || chapterTitleRef.current?.value }),
                  ...(chapterStageRef.current?.value === undefined || chapterStageRef.current.value === '' ? {} : { stage: chapterStageRef.current.value }),
                  ...(chapterIssuesRef.current?.value === undefined || chapterIssuesRef.current.value === '' ? {} : { issues: chapterIssuesRef.current.value === 'true' }),
                })
              } }, '筛选'),
              h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => {
                setSelected(undefined)
                setChapterQuery('')
                if (chapterTitleRef.current !== null) chapterTitleRef.current.value = ''
                if (chapterStageRef.current !== null) chapterStageRef.current.value = ''
                if (chapterIssuesRef.current !== null) chapterIssuesRef.current.value = ''
                setChapterPage(1); setChapterFilters({})
              } }, '清空'),
            ),
            chapterMatches.length === 0
              ? h('p', { className: 'sc-muted' }, chapterFiltered ? '没有匹配的章节。' : '还没有章节。点「写第 1 章」让模型出章纲并写正文。')
              : h('div', null,
                ...pageGroups.map(group => h('div', { key: group.key, className: 'sc-volume' },
                  h('div', { className: 'sc-volume-head' },
                    h('span', { className: 'sc-volume-title' }, group.title),
                    h('span', { className: 'sc-badge' }, `${group.chapters.length} ${unitOf(manifest.form)}`),
                    group.volume?.summary ? h('span', { className: 'sc-badge sc-badge-ok' }, '有卷摘要') : null,
                    group.volume === undefined
                      ? null
                      : h('button', {
                        type: 'button',
                        className: 'sc-btn sc-btn-small',
                        onClick: () => setVolumeForm({
                          id: group.volume!.id,
                          title: group.volume!.title,
                          from: group.volume!.from,
                          to: group.volume!.to,
                          summary: group.volume!.summary ?? '',
                        }),
                      }, '编辑卷'),
                  ),
                  h('div', { className: 'sc-chapters' }, ...group.chapters.map(item => h('div', { key: item.number },
                    h('button', {
                      type: 'button',
                      className: 'sc-chapter',
                      'data-chapter-number': item.number,
                      'aria-current': item.number === selected ? 'true' : 'false',
                      onClick: () => setSelected(item.number),
                    },
                      h('span', { className: 'sc-chapter-no' }, `第 ${item.number} ${unitOf(manifest.form)}`),
                      h('span', { className: 'sc-chapter-title' }, item.title === '' ? '' : item.title),
                      h('span', { className: 'sc-badge' }, stageLabel(item.stage)),
                      h('span', { className: 'sc-badge' }, `r${item.revision}`),
                      item.openProblems > 0 ? h('span', { className: 'sc-badge sc-badge-warn' }, `${item.openProblems}`) : null,
                    ),
                    item.number === selected
                      ? h('div', { className: 'sc-chapter-actions' },
                        h('button', {
                          type: 'button',
                          className: 'sc-btn sc-btn-small',
                          disabled: chapterBusy || item.number === orderedChapters[0]?.number,
                          title: '与上一章交换章号',
                          onClick: () => { void moveChapter(item, -1) },
                        }, '前移'),
                        h('button', {
                          type: 'button',
                          className: 'sc-btn sc-btn-small',
                          disabled: chapterBusy || item.number === orderedChapters.at(-1)?.number,
                          title: '与下一章交换章号',
                          onClick: () => { void moveChapter(item, 1) },
                        }, '后移'),
                        h('button', {
                          type: 'button',
                          className: 'sc-btn sc-btn-small',
                          disabled: chapterBusy,
                          title: '删除本章并前移后续章号；删除前自动备份',
                          onClick: () => { void removeChapter(item) },
                        }, '删除'),
                        item.stage === 'settled'
                          ? null
                          : h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            disabled: item.revision === 0,
                            onClick: () => compose(INSTRUCTIONS.review(manifest.workId, item.number)),
                          }, '审稿'),
                        item.stage === 'settled'
                          ? null
                          : h('select', {
                            className: 'sc-input sc-narrow',
                            'aria-label': `第 ${item.number} 章修订模式`,
                            value: reviseMode,
                            onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => setReviseMode(event.target.value),
                          },
                            h('option', { value: 'patch' }, '局部修补'),
                            h('option', { value: 'polish' }, '润色'),
                            h('option', { value: 'rewrite' }, '重写'),
                            h('option', { value: 'deslop' }, '去 AI 味'),
                          ),
                        item.stage === 'settled'
                          ? null
                          : h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            disabled: item.openProblems === 0 && reviseMode === 'patch',
                            onClick: () => compose(INSTRUCTIONS.revise(manifest.workId, item.number, reviseMode)),
                          }, '修订'),
                        item.revision > 0 && item.hasSummary !== true
                          ? h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            title: INSTRUCTIONS.summarize(manifest.workId, item.number),
                            onClick: () => compose(INSTRUCTIONS.summarize(manifest.workId, item.number)),
                          }, item.summaryStale === true ? '重写摘要' : '摘要')
                          : null,
                        item.summaryStale === true
                          ? h('span', { className: 'sc-badge sc-badge-warn' }, '摘要过期')
                          : item.hasSummary === true
                            ? h('span', { className: 'sc-badge sc-badge-ok' }, '有摘要')
                            : null,
                        item.stage === 'settled'
                          ? h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            onClick: () => compose(INSTRUCTIONS.reopen(manifest.workId, item.number)),
                          }, '撤回定稿')
                          : h('button', {
                            type: 'button',
                            className: 'sc-btn sc-btn-small',
                            disabled: !(item.stage === 'revised' || (item.stage === 'reviewed' && item.openProblems === 0))
                              || item.openProblems > 0 || item.hasSummary !== true,
                            title: item.hasSummary === true
                              ? '把事实与伏笔记进书里并锁定本章'
                              : item.summaryStale === true ? '摘要过期：先重写摘要，再定稿' : '先写摘要，再定稿',
                            onClick: () => compose(INSTRUCTIONS.step(manifest.workId, item.number, item.stateDraftReady === true ? 'story_finalize' : 'story_settle')),
                          }, item.stateDraftReady === true ? '定稿' : '结算'),
                      )
                      : null,
                  ))),
                )),
              ),
          ),
          h('div', { className: 'sc-col' },
            chapter === undefined
              ? h('p', { className: 'sc-muted' }, '选一章看正文、章纲与审稿清单。')
              : h(ChapterPanel, {
                face,
                root,
                workId: manifest.workId,
                sessionId,
                onApproved: () => { void load() },
                chapter,
                latestChapter: chapters.at(-1)?.number,
                unit: unitOf(manifest.form),
                onNotice,
                canSend,
                compose,
                hideActions: true,
              }),
          ),
        ),

        h('div', {
          className: 'sc-section sc-tab-panel',
          id: 'sc-panel-dashboard',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-dashboard',
          hidden: tab !== 'dashboard',
        },
          dashboard.status === 'loading'
            ? h('p', { className: 'sc-muted' }, '读取看板…')
            : dashboard.status === 'error'
              ? h('p', { className: 'sc-notice sc-notice-info' }, dashboard.error)
              : dashboard.status === 'ready'
                ? (() => {
                  const dash = dashboard.dashboard
                  const list = dash.status.chapters
                  const maxWords = Math.max(1, ...list.map(chapter => chapter.words))
                  const groups = new Map<number, typeof dash.hooks>()
                  for (const hook of dash.hooks) {
                    const key = hook.startChapter ?? 0
                    groups.set(key, [...(groups.get(key) ?? []), hook])
                  }
                  const disabledReason = sessionId === undefined
                    ? '先打开一个会话再标记伏笔'
                    : dash.transitionChapter === null ? '当前没有未定稿的已写章：先写正文或撤回定稿' : undefined
                  return h('div', { className: 'sc-dashboard' },
                    h('div', { className: 'sc-actions' },
                      h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void loadDashboard() } }, '刷新看板'),
                    ),
                    h('div', { className: 'sc-dash-cards' },
                      ...[
                        ['已写章', String(dash.status.writtenChapters)],
                        ['已审', String(list.filter(chapter => ['reviewed', 'revised'].includes(chapter.stage)).length)],
                        ['已定稿', String(list.filter(chapter => chapter.stage === 'settled').length)],
                        ['未处理审稿', String(dash.status.openProblems)],
                        ['未解伏笔', String(dash.status.hooks.unresolved)],
                        ['调用/token', dash.status.calls === undefined ? '—' : String(dash.status.calls.count) + ' 次' + (dash.status.calls.totalTokens === null ? '' : ' · ' + String(dash.status.calls.totalTokens) + ' tokens')],
                      ].map(([label, value]) => h('div', { className: 'sc-dash-card', key: label },
                        h('span', { className: 'sc-muted' }, label),
                        h('strong', null, value),
                      )),
                    ),
                    h('section', { className: 'sc-dash-section' },
                      h('h3', { className: 'sc-section-title' }, '章节进度'),
                      list.length === 0
                        ? h('p', { className: 'sc-muted' }, '还没有章节。')
                        : h('div', null, ...list.map(chapter => h('div', { className: 'sc-word-row', key: chapter.number },
                          h('span', null, '第 ' + chapter.number + ' 章'),
                          h('div', { className: 'sc-word-bar' }, h('span', { style: { width: Math.round(chapter.words / maxWords * 100) + '%' } })),
                          h('span', { className: 'sc-muted' }, stageLabel(chapter.stage) + ' · ' + chapter.words + ' 字'),
                        ))),
                    ),
                    h('section', { className: 'sc-dash-section' },
                      h('h3', { className: 'sc-section-title' }, '待处理伏笔'),
                      groups.size === 0
                        ? h('p', { className: 'sc-muted' }, '没有未解伏笔。')
                        : h('div', null, ...[...groups.entries()].map(([start, hooks]) => h('div', { className: 'sc-hook-group', key: String(start) },
                          h('div', { className: 'sc-hook-group-head' }, start === 0 ? '开篇伏笔' : '第 ' + start + ' 章起的伏笔'),
                          ...hooks.map(hook => h('div', { className: 'sc-hook', key: hook.hookId },
                            h('div', { className: 'sc-hook-main' },
                              h('span', { className: 'sc-item-name' }, hook.text),
                              h('span', { className: 'sc-badge' }, hookStatusLabel(hook.status)),
                              hook.lastAdvancedChapter === undefined
                                ? null
                                : h('span', { className: 'sc-muted' }, '最近推进第 ' + hook.lastAdvancedChapter + ' 章'),
                            ),
                            h('div', { className: 'sc-hook-actions' },
                              h('button', {
                                type: 'button', className: 'sc-btn sc-btn-small', disabled: disabledReason !== undefined,
                                title: disabledReason ?? '把伏笔推进到当前章',
                                onClick: () => { void transitionHook(hook.hookId, 'progress') },
                              }, '已用（推进）'),
                              h('button', {
                                type: 'button', className: 'sc-btn sc-btn-small', disabled: disabledReason !== undefined,
                                title: disabledReason ?? '把伏笔标记为已解',
                                onClick: () => { void transitionHook(hook.hookId, 'resolve') },
                              }, '已解'),
                            ),
                          )),
                        ))),
                    ),
                    h('section', { className: 'sc-dash-section' },
                      h('h3', { className: 'sc-section-title' }, '摘要'),
                      list.length === 0
                        ? h('p', { className: 'sc-muted' }, '还没有章节摘要。')
                        : h('div', null, ...list.map(chapter => h('div', { className: 'sc-summary-row', key: chapter.number },
                          h('span', { className: 'sc-item-name' }, '第 ' + chapter.number + ' 章'),
                          h('span', { className: chapter.hasSummary || chapter.summaryStale ? 'sc-badge sc-badge-ok' : 'sc-badge' },
                            chapter.summaryStale ? '摘要过期' : chapter.hasSummary ? '摘要已就绪' : '无摘要'),
                          h('span', { className: 'sc-muted' }, chapter.words + ' 字'),
                          h('button', {
                            type: 'button', className: 'sc-btn sc-btn-small',
                            disabled: !chapter.hasSummary && !chapter.summaryStale,
                            onClick: () => { void openSummary(chapter.number) },
                          }, '查看摘要'),
                        ))),
                    ),
                    h('section', { className: 'sc-dash-section' },
                      h('div', { className: 'sc-item-head' },
                        h('h3', { className: 'sc-section-title' }, '分析'),
                        h('button', {
                          type: 'button', className: 'sc-btn sc-btn-small',
                          onClick: () => {
                            if (!analysisOpen && analysis.status === 'idle') void loadAnalysis()
                            setAnalysisOpen(open => !open)
                          },
                        }, analysisOpen ? '收起分析' : '展开分析'),
                      ),
                      analysisOpen
                        ? analysis.status === 'loading'
                          ? h('p', { className: 'sc-muted' }, '读取分析…')
                          : analysis.status === 'error'
                            ? h('div', null,
                              h('p', { className: 'sc-notice sc-notice-info' }, analysis.error),
                              h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void loadAnalysis() } }, '重试'),
                            )
                            : analysis.status === 'ready'
                              ? (() => {
                                const a = analysis.analysis
                                const severity: Array<[string, number]> = [
                                  ['blocking', a.reviews.issues.bySeverity.blocking],
                                  ['major', a.reviews.issues.bySeverity.major],
                                  ['minor', a.reviews.issues.bySeverity.minor],
                                  ['unspecified', a.reviews.issues.bySeverity.unspecified],
                                ]
                                return h('div', { className: 'sc-analysis' },
                                  h('p', { className: 'sc-muted' }, '全书 ' + list.reduce((sum, chapter) => sum + chapter.words, 0) + ' 字 · ' + list.length + ' 章'),
                                  h('div', { className: 'sc-analysis-grid' },
                                    h('div', { className: 'sc-analysis-block' },
                                      h('strong', null, a.reviews.issues.total + ' 个未处理审稿问题'),
                                      ...severity.map(([label, value]) => h('div', { className: 'sc-analysis-row', key: label },
                                        h('span', null, label),
                                        h('span', { className: 'sc-muted' }, String(value) + ' 条'),
                                      )),
                                      h('div', { className: 'sc-analysis-row' },
                                        h('span', null, '已解决'),
                                        h('span', { className: 'sc-muted' }, String(a.reviews.resolved) + ' 条'),
                                      ),
                                      ...([
                                        ['execution', a.reviews.issues.byCategory.execution],
                                        ['quality', a.reviews.issues.byCategory.quality],
                                        ['scope', a.reviews.issues.byCategory.scope],
                                      ] as Array<[string, number]>).map(([label, value]) => h('div', { className: 'sc-analysis-row', key: 'category-' + label },
                                        h('span', null, label),
                                        h('span', { className: 'sc-muted' }, String(value) + ' 条'),
                                      )),
                                      ...a.reviews.chapters.map(chapter => h('div', { className: 'sc-analysis-row', key: 'review-chapter-' + chapter.chapter },
                                        h('span', null, '第 ' + chapter.chapter + ' 章'),
                                        h('span', { className: 'sc-muted' }, String(chapter.issues) + ' 未处理 · ' + String(chapter.resolved) + ' 已解决'),
                                      )),
                                    ),
                                    h('div', { className: 'sc-analysis-block' },
                                      h('strong', null, a.calls.total.count + ' 次调用'),
                                      h('div', { className: 'sc-analysis-row' },
                                        h('span', null, 'token'),
                                        h('span', { className: 'sc-muted' }, a.calls.total.totalTokens === null ? '未记录' : String(a.calls.total.totalTokens)),
                                      ),
                                      h('div', { className: 'sc-analysis-row' },
                                        h('span', null, '缺 usage'),
                                        h('span', { className: 'sc-muted' }, String(a.calls.total.callsWithoutUsage) + ' 次'),
                                      ),
                                      ...a.calls.byRole.map(row => h('div', { className: 'sc-analysis-row', key: 'role-' + row.role },
                                        h('span', null, row.role),
                                        h('span', { className: 'sc-muted' }, String(row.count) + ' 次 · ' + (row.totalTokens === null ? 'token 未知' : String(row.totalTokens))),
                                      )),
                                      ...a.calls.byModel.map(row => h('div', { className: 'sc-analysis-row', key: 'model-' + row.model },
                                        h('span', null, 'model ' + (row.model ?? '未记录')),
                                        h('span', { className: 'sc-muted' }, String(row.count) + ' 次 · ' + (row.totalTokens === null ? 'token 未知' : String(row.totalTokens))),
                                      )),
                                    ),
                                  ),
                                  h('div', { className: 'sc-rhythm' },
                                    h('span', { className: 'sc-muted' }, '节奏（按章读取正文，复用 critique）'),
                                    h('select', {
                                      className: 'sc-input',
                                      value: rhythmChapter === undefined ? '' : String(rhythmChapter),
                                      onChange: (event: Event) => {
                                        const number = Number((event.target as HTMLSelectElement).value)
                                        if (Number.isInteger(number) && number > 0) void loadRhythm(number)
                                      },
                                    },
                                      h('option', { value: '' }, '选择章节'),
                                      ...list.filter(chapter => chapter.revision > 0).map(chapter => h('option', { value: String(chapter.number), key: chapter.number }, '第 ' + chapter.number + ' 章')),
                                    ),
                                    rhythm === undefined
                                      ? null
                                      : h('p', { className: 'sc-muted' },
                                        '字数 ' + rhythm.words + ' · 字符 ' + rhythm.chars + ' · 平均句长 ' + rhythm.sentences.averageLength
                                        + ' · 最长句 ' + rhythm.sentences.longest + ' · 对话比例 ' + Math.round(rhythm.dialogueRatio * 100) + '% · 重复 ' + rhythm.repeated.length
                                        + ' · AI 短语 ' + rhythm.aiPhrases.count),
                                  ),
                                  a.reviews.issues.total === 0
                                    ? h('p', { className: 'sc-muted' }, '还没有审稿。')
                                    : null,
                                  a.calls.total.count === 0
                                    ? h('p', { className: 'sc-muted' }, '还没有调用。')
                                    : null,
                                )
                              })()
                              : null
                        : h('p', { className: 'sc-muted' }, '展开查看审稿分布、调用成本与节奏。'),
                    ),
                    h(SelfCheckPanel, { face, root, workId }),
                    h(LogsPanel, { key: workId, face, root, workId }),
                    h(SearchPanel, { key: workId, face, root, workId }),
                    summaryView === undefined
                      ? null
                      : h('div', { className: 'sc-drawer-mask', onClick: () => setSummaryView(undefined) },
                        h('div', {
                          className: 'sc-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '章节摘要',
                          onClick: (event: MouseEvent) => event.stopPropagation(),
                        },
                          h('div', { className: 'sc-drawer-head' },
                            h('h3', { className: 'sc-section-title' }, '第 ' + summaryView.chapter + ' 章摘要'),
                            h('button', {
                              type: 'button', className: 'sc-btn sc-btn-small', autoFocus: true,
                              onClick: () => setSummaryView(undefined),
                            }, '关闭'),
                          ),
                          h('pre', { className: 'sc-summary-body' }, summaryView.content),
                        ),
                      ),
                  )
                })()
                : h('p', { className: 'sc-muted' }, '打开看板读取进度。'),
        ),

        h('div', { className: 'sc-page', hidden: tab !== 'chapters' },
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-small',
            disabled: safePage <= 1,
            onClick: () => setChapterPage(page => Math.max(1, page - 1)),
          }, '上一页'),
          h('span', { className: 'sc-muted' }, `第 ${safePage} / ${pageCount} 页 · 共 ${chapterMatches.length} 章`),
          h('button', {
            type: 'button',
            className: 'sc-btn sc-btn-small',
            disabled: safePage >= pageCount,
            onClick: () => setChapterPage(page => Math.min(pageCount, page + 1)),
          }, '下一页'),
        ),

        h('div', {
          className: 'sc-section sc-tab-panel',
          id: 'sc-panel-truth',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-truth',
          hidden: tab !== 'truth',
        },
          h('div', { className: 'sc-actions' },
            h('button', {
              type: 'button',
              className: 'sc-btn',
              onClick: () => {
                if (bibleEditor !== undefined) {
                  onNotice({ kind: 'error', text: '先保存或取消当前真值编辑' })
                  return
                }
                void loadBible()
              },
            }, '刷新真值'),
          ),
          foundation.status === 'loading'
            ? h('p', { className: 'sc-muted' }, '读取基础设定…')
            : foundation.status === 'error'
              ? h('p', { className: 'sc-notice sc-notice-info' }, foundation.error)
              : foundation.status === 'ready'
                ? h('section', { className: 'sc-foundation', 'aria-label': '基础设定' },
                  h('div', { className: 'sc-foundation-head' },
                    h('div', null,
                      h('h3', { className: 'sc-section-title' }, '基础设定'),
                      h('p', { className: 'sc-muted' }, 'architect 生成的故事框架、卷图、规则与角色；brief/上下文/审稿会读取。'),
                    ),
                    h('div', { className: 'sc-badges' },
                      h('span', { className: foundation.foundation?.complete === true ? 'sc-badge sc-badge-ok' : 'sc-badge' },
                        foundation.foundation?.complete === true ? '已生成' : '未完成'),
                      foundation.foundation?.approvedAt === undefined
                        ? null
                        : h('span', { className: 'sc-badge sc-badge-ok' }, '已确认'),
                    ),
                  ),
                  h('div', { className: 'sc-foundation-stages' },
                    ...Object.entries(FOUNDATION_STAGE_LABELS).map(([key, label]) => {
                      const done = foundation.foundation?.stages?.[key as keyof NonNullable<FoundationState['stages']>] === true
                      return h('div', { className: done ? 'sc-stage sc-stage-done' : 'sc-stage', key },
                        h('span', { className: 'sc-stage-mark' }, done ? '✓' : '—'),
                        h('span', { className: 'sc-stage-label' }, label),
                        h('span', { className: 'sc-stage-state' }, done ? '已生成' : '待生成'),
                      )
                    }),
                  ),
                  (foundation.documents ?? []).length === 0
                    ? h('p', { className: 'sc-muted' },
                      foundation.foundation?.complete === true
                        ? '没有可读的基础设定文档。'
                        : '尚未生成。让主编委派 architect 生成基础设定。')
                    : h('div', { className: 'sc-bible-grid sc-foundation-docs' },
                      ...(foundation.documents ?? []).map(document => h('details', { className: 'sc-item sc-foundation-doc', key: document.name },
                        h('summary', null,
                          h('span', { className: 'sc-item-name' }, foundationDocLabel(document.name)),
                          h('span', { className: 'sc-badge' }, 'v' + String(document.revisionId).slice(0, 8)),
                        ),
                        h('pre', { className: 'sc-yaml' }, document.content),
                      )),
                    ),
                )
                : h('p', { className: 'sc-muted' }, '点上方「基础设定」读取状态。'),
          bible.status === 'loading' ? h('p', { className: 'sc-muted' }, '读取真值…') : null,
          bible.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, bible.error) : null,
          bible.status === 'ready'
            ? h('div', { className: 'sc-bible-grid' },
              ...(bible.missing ?? []).map(name => h('div', { className: 'sc-item sc-bible-card', key: name },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-name' }, bibleLabel(name)),
                  h('span', { className: 'sc-badge sc-badge-warn' }, '缺失'),
                  name === 'plan' ? h('span', { className: 'sc-badge' }, '只读') : null,
                  name === 'plan' || !(bible.editable ?? []).includes(name)
                    ? null
                    : h('button', {
                      type: 'button',
                      className: 'sc-btn sc-btn-small',
                      disabled: sessionId === undefined,
                      title: sessionId === undefined ? '先打开一个会话再编辑真值' : '新建这份真值',
                      onClick: () => openMissingBible(name),
                    }, '新建'),
                ),
                h('p', { className: 'sc-item-body' }, name === 'plan' ? '用全书计划确认流程创建。' : '用「新建」补建这份真值。'),
              )),
              ...bible.files.map(file => h('div', { className: 'sc-item sc-bible-card', key: file.name },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-name' }, bibleLabel(file.name)),
                  h('span', { className: 'sc-item-id' }, file.path),
                  h('span', { className: 'sc-badge' }, `v${file.version}`),
                  file.draft ? h('span', { className: 'sc-badge sc-badge-warn' }, '草稿') : null,
                  file.name === 'plan' ? h('span', { className: 'sc-badge' }, '只读') : null,
                  file.name === 'plan' || !(bible.editable ?? []).includes(file.name)
                    ? null
                    : h('button', {
                      type: 'button',
                      className: 'sc-btn sc-btn-small',
                      disabled: sessionId === undefined,
                      title: sessionId === undefined ? '先打开一个会话再编辑真值' : '编辑这份真值',
                      onClick: () => openBibleEditor(file),
                    }, '编辑'),
                ),
                h('pre', { className: 'sc-yaml' }, file.content),
              )))
            : null,
        ),

        h('div', {
          className: 'sc-section sc-tab-panel',
          id: 'sc-panel-context',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-context',
          hidden: tab !== 'context',
        },
          h('h3', { className: 'sc-section-title' }, '写前上下文'),
          h('div', { className: 'sc-actions' },
            h('select', {
              className: 'sc-input',
              'aria-label': '写前上下文目标章',
              value: briefChapter,
              onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => setBriefChapter(Number(event.target.value)),
            }, ...chapters.map(item => h('option', { key: item.number, value: item.number }, `第 ${item.number} 章`))),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              onClick: () => { void loadBrief(briefChapter) },
            }, '装配写前上下文'),
          ),
          brief.status === 'loading' ? h('p', { className: 'sc-muted' }, '装配写前上下文…') : null,
          brief.status === 'error' ? h('p', { className: 'sc-notice sc-notice-info' }, brief.error) : null,
          brief.status === 'ready'
            ? h('div', { style: { marginTop: 10 } },
              h('p', { className: 'sc-item-body' },
                `第 ${brief.chapter} 章 · 已用 ${brief.budget.used} / ${brief.budget.limit} token（估算）`
                + `${brief.budget.overBudget ? ' · 超预算' : ''}`
                + `${(brief.dropped ?? []).length > 0 ? ` · 裁掉 ${brief.dropped!.map(item => item.name).join('、')}` : ''}`),
              ...brief.sections.map(item => h('div', { className: 'sc-item', key: item.name },
                h('div', { className: 'sc-item-head' },
                  h('span', { className: 'sc-item-name' }, item.title),
                  h('span', { className: 'sc-badge' }, `${item.tokens} tok`),
                  h('span', { className: 'sc-item-id' }, item.source),
                  item.absent ? h('span', { className: 'sc-badge' }, '缺失') : null,
                  item.draft ? h('span', { className: 'sc-badge sc-badge-warn' }, '草稿') : null,
                  item.note !== undefined ? h('span', { className: 'sc-badge' }, item.note) : null,
                ),
                h('pre', { className: 'sc-yaml' }, item.content === '' ? '（空）' : item.content),
              )),
            )
            : null,
        ),

        h('div', {
          className: 'sc-section sc-tab-panel',
          id: 'sc-panel-materials',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-materials',
          hidden: tab !== 'materials',
        },
          h('div', { className: 'sc-actions' },
            h('button', {
              type: 'button',
              className: 'sc-btn',
              disabled: materialBusy || sessionId === undefined,
              onClick: () => materialFileRef.current?.click(),
            }, materialBusy ? '处理中…' : '导入素材'),
            h('select', {
              className: 'sc-input',
              'aria-label': '导入素材用途',
              value: materialPurpose,
              disabled: materialBusy,
              onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => setMaterialPurpose(event.target.value),
            }, ...Object.entries(MATERIAL_PURPOSE_LABELS).map(([value, label]) => h('option', { value }, label))),
            h('input', {
              type: 'file',
              accept: '.txt,.md,.epub,.pdf',
              'aria-label': '导入素材文件',
              ref: materialFileRef,
              style: { display: 'none' },
              onChange: event => { void importMaterialFile(event) },
            }),
            h('span', { className: 'sc-muted' }, `素材库：${materials.length} 份`),
            h('select', {
              className: 'sc-input',
              'aria-label': '按用途筛选素材',
              value: materialFilter,
              onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => setMaterialFilter(event.target.value),
            }, h('option', { value: 'all' }, '全部用途'),
            ...Object.entries(MATERIAL_PURPOSE_LABELS).map(([value, label]) => h('option', { value }, label))),
          ),
          materialError === undefined
            ? null
            : h('p', { className: 'sc-notice sc-notice-info' }, materialError),
          materials.length === 0
            ? h('p', { className: 'sc-muted', style: { marginTop: 8 } }, '还没有素材。点「导入素材」选 .txt / .md 文件。')
            : h('div', { style: { marginTop: 10 } }, ...materials.map(material => h('div', { className: 'sc-item', key: material.id },
              h('div', { className: 'sc-item-head' },
                h('span', { className: 'sc-item-name' }, material.title),
                h('span', { className: 'sc-badge', 'data-material-format': material.format }, material.format),
                material.sourceName === undefined ? null : h('span', { className: 'sc-muted' }, material.sourceName),
                h('select', {
                  className: 'sc-input',
                  'aria-label': `素材「${material.title}」的用途`,
                  value: material.purpose ?? 'reference',
                  disabled: materialBusy,
                  onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => { void changeMaterialPurpose(material, event.target.value) },
                }, ...Object.entries(MATERIAL_PURPOSE_LABELS).map(([value, label]) => h('option', { value }, label))),
                h('span', { className: 'sc-badge' }, `${material.bytes} B`),
                h('span', { className: 'sc-item-id' }, `${material.id} · ${String(material.createdAt ?? '').replace('T', ' ').slice(0, 16)}`),
                materialEditing?.id === material.id
                  ? null
                  : h('button', {
                    type: 'button',
                    className: 'sc-btn sc-btn-small',
                    onClick: () => setMaterialEditing({ id: material.id, title: material.title }),
                  }, '重命名'),
                h('button', {
                  type: 'button',
                  className: 'sc-btn sc-btn-small',
                  onClick: () => { void removeMaterial(material) },
                }, '删除'),
              ),
              materialEditing?.id === material.id
                ? h('div', { className: 'sc-rename' },
                  h('input', {
                    className: 'sc-input',
                    defaultValue: material.title,
                    ref: materialTitleInputRef,
                    'aria-label': `素材「${material.title}」的新标题`,
                    onKeyDown: event => {
                      if (event.key === 'Enter') void renameMaterial()
                      if (event.key === 'Escape') setMaterialEditing(undefined)
                    },
                  }),
                  h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: () => { void renameMaterial() } }, '保存'),
                  h('button', { type: 'button', className: 'sc-btn', onClick: () => setMaterialEditing(undefined) }, '取消'),
                )
                : null,
            ))),
        ),

        h('div', { className: 'sc-section', hidden: tab !== 'chapters' },
          h('button', {
            type: 'button',
            className: 'sc-btn',
            onClick: () => setStateOpen(open => !open),
          }, stateOpen ? '收起状态与伏笔' : '状态与伏笔'),
          stateOpen
            ? h('div', { style: { marginTop: 10 } },
              h('h3', { className: 'sc-section-title' }, '人物事实'),
              (() => {
                const groups = new Map<string, string[]>()
                for (const fact of detail.state.facts) {
                  if (fact.validUntilChapter !== null) continue
                  const list = groups.get(fact.subject) ?? []
                  list.push(`${fact.predicate}：${fact.object}`)
                  groups.set(fact.subject, list)
                }
                if (groups.size === 0) return h('p', { className: 'sc-muted' }, detail.state.events > 0
                  ? '已有事件记录，但没有 v2 状态投影；请重新结算本章。'
                  : '还没有定稿过人物事实。')
                return [...groups].map(([subject, facts]) => h('div', { className: 'sc-item', key: subject },
                  h('div', { className: 'sc-item-head' }, h('span', { className: 'sc-item-name' }, subject)),
                  h('ul', { className: 'sc-item-body' }, ...facts.map((fact, index) => h('li', { key: index }, fact))),
                ))
              })(),
              h('h3', { className: 'sc-section-title' }, '伏笔'),
              h('p', { className: 'sc-item-body' },
                `未解 ${detail.state.hooks.filter(hook => ['open', 'progressing', 'deferred'].includes(hook.status)).length} 条`
                + `（其中推进中 ${detail.state.hooks.filter(hook => hook.status === 'progressing').length} 条）· `
                + `已解 ${detail.state.hooks.filter(hook => hook.status === 'resolved').length} 条`),
              detail.state.hooks.length === 0
                ? h('p', { className: 'sc-muted' }, '还没有记录伏笔。')
                : detail.state.hooks.map(hook => h('div', { className: 'sc-item', key: hook.hookId },
                  h('div', { className: 'sc-item-head' },
                    h('span', { className: 'sc-item-name' }, hook.text),
                    h('span', { className: ['resolved', 'superseded'].includes(hook.status) ? 'sc-done' : 'sc-open' }, hook.status),
                    h('span', { className: 'sc-badge' }, hook.startChapter === 0 ? '开篇埋' : `第 ${hook.startChapter} 章埋`),
                  ),
                )),
            )
            : null,
        ),

        h('div', {
          className: 'sc-section sc-tab-panel',
          id: 'sc-panel-exports',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-exports',
          hidden: tab !== 'exports',
        },
          h('h3', { className: 'sc-section-title' }, '导出'),
          h('p', { className: 'sc-item-body' }, '导出是覆盖快照：每次替换 .storycraft/exports 下的当前版本，不保留历史。'),
          h('p', { className: 'sc-item-body' }, exportInfo === undefined ? '读取导出目录…' : exportInfo.exists === true ? `已导出：${exportInfo.directory}` : '还没有导出。'),
          h('div', { className: 'sc-actions' },
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              disabled: exporting || sessionId === undefined,
              onClick: () => {
                void runExport().then(() => face.exports(root, workId).then(setExportInfo).catch(() => {}))
              },
            }, exporting ? '导出中…' : '导出 TXT / EPUB'),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void showExportDirectory() } }, '查看导出目录'),
          ),
        ),

        h('div', {
          className: 'sc-section sc-tab-panel',
          id: 'sc-panel-backups',
          role: 'tabpanel',
          'aria-labelledby': 'sc-tab-backups',
          hidden: tab !== 'backups',
        },
          h('h3', { className: 'sc-section-title' }, '备份'),
          h('p', { className: 'sc-item-body' }, `备份 ${backupList.length} 份；每份含数据库，显式备份还含素材原文件，可恢复或删除。`),
          h('div', { className: 'sc-actions' },
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btn-primary',
              disabled: sessionId === undefined,
              onClick: () => { void createBackupNow() },
            }, '立即备份'),
            h('button', {
              type: 'button',
              className: 'sc-btn',
              disabled: sessionId === undefined,
              onClick: () => { void rebuildSearchNow() },
            }, '重建检索索引'),
            h('select', {
              className: 'sc-input sc-narrow',
              'aria-label': '备份保留策略',
              value: backupKeep,
              onChange: (event: ReactTypes.ChangeEvent<HTMLSelectElement>) => {
                const keep = Number(event.target.value)
                setBackupKeep(keep)
                try { localStorage.setItem('storycraft.backup.keep', String(keep)) } catch {}
              },
            },
              h('option', { value: 5 }, '保留 5 份'),
              h('option', { value: 10 }, '保留 10 份'),
              h('option', { value: 20 }, '保留 20 份'),
              h('option', { value: 0 }, '不自动清理'),
            ),
          ),
          backupList.length === 0
            ? h('p', { className: 'sc-muted' }, '还没有备份。')
            : h('div', null, ...backupList.map((item, index) => h('div', { className: 'sc-item', key: item.backupId },
              h('div', { className: 'sc-item-head' },
                h('span', { className: 'sc-badge' }, String(index + 1).padStart(2, '0')),
                h('span', { className: 'sc-item-name' }, item.file.split(/[\\/]/u).at(-1)),
                h('span', { className: 'sc-badge' }, `${item.bytes} B 总量`),
                item.materials !== undefined
                  ? h('span', { className: 'sc-badge' }, `素材 ${item.materials.count} 份 · ${item.materials.bytes} B`)
                  : item.corrupt === true
                    ? h('span', { className: 'sc-badge sc-badge-warn' }, '素材 sidecar 损坏')
                    : item.incomplete === true
                      ? h('span', { className: 'sc-badge sc-badge-warn' }, '不完整：缺素材 sidecar')
                      : h('span', { className: 'sc-badge' }, item.noMaterials === true ? '仅数据库（无素材）' : '仅数据库'),
                h('span', { className: 'sc-item-id' }, String(item.createdAt ?? '').replace('T', ' ').slice(0, 16)),
              ),
              h('div', { className: 'sc-actions' },
                h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void restoreBackupItem(item) } }, '恢复'),
                h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void deleteBackupItem(item) } }, '删除'),
              ),
            ))),
        ),


        bibleEditor === undefined
          ? null
          : h('div', { className: 'sc-drawer-mask', onClick: requestCloseBible },
            h('aside', {
              className: 'sc-drawer',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'sc-drawer-title',
              onClick: (event: ReactTypes.MouseEvent<HTMLElement>) => event.stopPropagation(),
            },
              h('div', { className: 'sc-drawer-head' },
                h('h3', { id: 'sc-drawer-title', className: 'sc-section-title' }, `编辑${bibleLabel(bibleEditor.name)}`),
                h('span', { className: 'sc-item-id' }, bibleEditor.version === undefined ? '新建' : `v${bibleEditor.version}`),
              ),
              h('textarea', {
                className: 'sc-input sc-drawer-input',
                'aria-label': `编辑真值 ${bibleEditor.name}`,
                ref: (node: HTMLTextAreaElement | null): void => { bibleTextareaRef.current = node },
                defaultValue: bibleEditor.content,
                disabled: bibleEditor.saving,
              }),
              bibleEditor.error === undefined ? null : h('p', { className: 'sc-notice sc-notice-info' }, bibleEditor.error),
              h('div', { className: 'sc-drawer-foot' },
                h('button', { type: 'button', className: 'sc-btn', disabled: bibleEditor.saving, onClick: cancelBibleEditor }, '取消'),
                h('button', {
                  type: 'button',
                  className: 'sc-btn sc-btn-primary',
                  disabled: bibleEditor.saving || sessionId === undefined,
                  onClick: () => { void saveBibleEditor() },
                }, bibleEditor.saving ? '保存中…' : '保存'),
              ),
            ),
          ),

        h('details', { className: 'sc-help' },
          h('summary', null, '这一页怎么工作'),
          h('ol', null,
            h('li', null, '顶部有「看板 / 章节 / 真值 / 写前上下文 / 素材 / 导出 / 备份」七个标签；章节默认倒序、20 章/页。'),
            h('li', null, '页面只读：作品、章节、审稿与状态都从作品目录读取，不另存一份。'),
            h('li', null, '按钮不写文件：它把一条固定指令投递给当前会话，由模型调用 story_init / story_plan / story_write / story_review / story_revise / story_state 落盘。'),
            h('li', null, '所以写完一章后点「刷新」，或重新进入本页，就能看到新章节与新字数。'),
            h('li', null, '审稿只产出问题清单，正文不动；修订会生成新版本文件，旧版本保留。'),
          ),
        ),
      )
    }


    /** The face the tab body uses; set once when the plugin applies. */
    let pluginFace: Face | undefined

    /** Right-sidebar tab body: the workbench in a narrow column. */
    function StorycraftSideTab(props: StorycraftSideTabProps) {
      // A hidden marker states whether the composer writer arrived; the specs
      // assert it instead of guessing from behavior.
      return h(React.Fragment, null,
        h('span', {
          'data-storycraft-input': typeof props.inputActions?.setDraft === 'function' ? 'yes' : 'no',
          style: { display: 'none' },
        }),
        h(StorycraftPage, {
          storycraft: props.storycraft ?? pluginFace,
          compact: true,
          prefill: typeof props.inputActions?.setDraft === 'function'
            ? (text: string) => { props.inputActions!.setDraft!(text) }
            : undefined,
        }),
      )
    }

    /** Tab chip title. */
    function StorycraftTabTitle() {
      return h('span', null, '故事工坊')
    }

    /**
     * Group chapters by volume, unassigned last.
     * @param {object[]} chapters - chapter rows.
     * @param {object[]} volumes - volumes of the work.
     * @returns {Array<{key: string, title: string, volume?: object, chapters: object[]}>} groups.
     */
    function chapterGroups(chapters: ChapterSummary[], volumes: Volume[]): ChapterGroup[] {
      const groups: ChapterGroup[] = volumes
        .slice()
        .sort((left, right) => left.from - right.from)
        .map(volume => ({
          key: `v-${volume.id}`,
          title: `${volume.title}（${volume.from}–${volume.to}）`,
          volume,
          chapters: chapters.filter(item => item.number >= volume.from && item.number <= volume.to),
        }))
      const covered = new Set(groups.flatMap(group => group.chapters.map(item => item.number)))
      const rest = chapters.filter(item => !covered.has(item.number))
      if (rest.length > 0) groups.push({ key: 'unassigned', title: '未分卷', chapters: rest })
      return groups
    }

    /** The workbench page. */
    function StorycraftPage(props: StorycraftPageProps) {
      const face = props.storycraft
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState<string | null>(null)
      const [root, setRoot] = useState<string | undefined>(undefined)
      const [sessionId, setSessionId] = useState<string | undefined>(undefined)
      const [sessionPreset, setSessionPreset] = useState<string | undefined>(undefined)
      const [presetHealth, setPresetHealth] = useState<PresetHealth>({ state: 'unknown' })
      const [works, setWorks] = useState<WorkSummary[]>([])
      const [trash, setTrash] = useState<TrashItem[]>([])
      const [homeView, setHomeView] = useState('works')
      const [typeFilter, setTypeFilter] = useState('longform')
      const [workFilters, setWorkFilters] = useState<WorkQueryFilters>({})
      const [currentId, setCurrentId] = useState<string | undefined>(undefined)
      const [trashNote, setTrashNote] = useState<string | undefined>(undefined)
      const [selected, setSelected] = useState<string | undefined>(undefined)
      const [notice, setNotice] = useState<Notice | undefined>(undefined)
      const [refreshError, setRefreshError] = useState<string | undefined>(undefined)
      const refreshInFlight = useRef(false)
      const compose = useCallback((text: string) => {
        // Writing the real composer bypasses the workbench's own gate, so the
        // gate runs first: only a long-form session may receive an action.
        if (!isStudio(sessionPreset)) {
          const shown = sessionPreset === undefined ? '没有记录预设' : `当前是 ${sessionPreset}`
          setNotice({
            kind: 'error',
            text: `当前会话不是「故事工坊」模式（${shown}）：新建会话时选择「故事工坊」，再点一次。`,
          })
          return
        }
        if (typeof props.prefill !== 'function') {
          setNotice({ kind: 'error', text: '聊天输入框暂时不可写入：刷新页面后再试。' })
          return
        }
        props.prefill(text)
        setNotice({ kind: 'ok', text: '已填入聊天输入框：可以继续改，改完发送。' })
      }, [props.prefill, sessionPreset])


      const load = useCallback(async () => {
        if (face === undefined || face === null) {
          setStatus('error')
          setError('故事工坊没有连接到宿主服务：这个页面需要在 DSH Web 客户端里打开。')
          return
        }
        setStatus('loading')
        setError(null)
        const context = face.context()
        setRoot(context.root)
        setSessionId(context.sessionId)
        setSessionPreset(context.preset)
        if (context.root === undefined) {
          setWorks([])
          setStatus('ready')
          return
        }
        try {
          if (sessionId !== undefined) {
            const pointer = await face.getCurrent(root, sessionId).catch(() => ({ current: undefined }))
            setCurrentId(pointer.current ?? undefined)
          }
          const payload = await face.listWorks(context.root, workFilters)
          setWorks(payload.works ?? [])
          try {
            const trashed = await face.listTrash(context.root)
            setTrash(trashed.items ?? [])
            setTrashNote(undefined)
          } catch {
            // The trash route lives in the Host half: a client-only reload cannot
            // see it until DSH restarts.
            setTrash([])
            setTrashNote('回收站不可用：这次改了宿主路由，重启 DSH 后可见')
          }
          // The home view is the default; an entered work survives a refresh.
          setSelected(current => (payload.works ?? []).some(work => work.workId === current)
            ? current
            : undefined)
          setStatus('ready')
        } catch (cause) {
          setStatus('error')
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [face, workFilters])

      const refreshWorks = useCallback(async () => {
        if (face === undefined || face === null || refreshInFlight.current) return
        const context = face.context()
        if (context.root === undefined) return
        refreshInFlight.current = true
        try {
          let pointer: CurrentPayload | null | undefined
          if (context.sessionId !== undefined) {
            try {
              pointer = await face.getCurrent(context.root, context.sessionId)
            } catch {
              pointer = null
            }
          }
          const payload = await face.listWorks(context.root, workFilters)
          setWorks(payload.works ?? [])
          if (pointer !== null) setCurrentId(pointer?.current ?? undefined)
          setRefreshError(undefined)
        } catch (cause) {
          setRefreshError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          refreshInFlight.current = false
        }
      }, [face, workFilters])

      useEffect(() => { void load() }, [load])

      useVisiblePolling(10000, refreshWorks)


      useEffect(() => {
        let cancelled = false
        fetchOwnRoute('/api/see-storycraft/roster').then(
          (body: RosterPayload) => {
            if (cancelled) return
            const row = (body.presets ?? []).find(item => item.id === 'storycraft')
            if (row === undefined) setPresetHealth({ state: 'missing' })
            else if (typeof row.broken === 'string' && row.broken !== '') setPresetHealth({ state: 'broken', reason: row.broken })
            else setPresetHealth({ state: 'ok' })
          },
          () => { if (!cancelled) setPresetHealth({ state: 'unknown' }) },
        )
        return () => { cancelled = true }
      }, [])

      useEffect(() => {
        if (notice === undefined) return
        const timer = setTimeout(() => setNotice(undefined), 8000)
        return () => clearTimeout(timer)
      }, [notice])

      const worksList = works

      const restoreTrashed = async (item: TrashItem) => {
        try {
          await face!.restoreTrash(root, item.workId)
          setNotice({ kind: 'ok', text: `已恢复：${item.title}` })
          await load()
        } catch (error) {
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const purgeTrashed = async (item: TrashItem) => {
        if (!window.confirm(`彻底删除「${item.title}」？数据库文件会删除，不能恢复。`)) return
        try {
          await face!.purgeTrash(root, item.workId)
          setNotice({ kind: 'ok', text: `已彻底删除：${item.title}` })
          await load()
        } catch (error) {
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      return h('div', { className: 'sc-root' },
        h('style', null, CSS),
        h('header', { className: 'sc-header' },
          h('div', null,
            h('h1', { className: 'sc-title' }, '故事工坊'),
            h('p', { className: 'sc-subtitle' }, '作品编排：看作品与章节，按固定指令让当前会话继续写。'),
          ),
          h('div', { className: 'sc-header-actions' },
            currentId === undefined
              ? null
              : h('span', { className: 'sc-badge' },
                `当前作品：${works.find(work => work.workId === currentId)?.title ?? currentId}`),
            h('button', { type: 'button', className: 'sc-btn', onClick: () => { void load() } }, '刷新'),
          ),
        ),
        h('div', { className: selected === undefined ? 'sc-body' : 'sc-body sc-body-detail' },
          selected === undefined ? h('nav', { className: 'sc-list', 'aria-label': '作品类型' },
            h('div', { className: 'sc-list-label' }, '视图'),
            h('button', { type: 'button', className: 'sc-work', 'aria-current': homeView === 'works' ? 'true' : 'false', onClick: () => setHomeView('works') }, '作品'),
            h('button', { type: 'button', className: 'sc-work', 'aria-current': homeView === 'trash' ? 'true' : 'false', onClick: () => setHomeView('trash') }, '回收站'),
            h('div', { className: 'sc-list-label' }, '类型'),
            ...FORMS.map(form => h('button', {
              key: form.id,
              type: 'button',
              className: 'sc-work',
              'aria-current': typeFilter === form.id ? 'true' : 'false',
              onClick: () => { setTypeFilter(form.id); setWorkFilters({}); setSelected(undefined); setNotice(undefined) },
            },
              h('span', { className: 'sc-work-title' }, form.label),
              h('span', { className: 'sc-work-meta' },
                `${worksList.filter(work => work.form === form.id).length} 部`),
            )),
            trashNote === undefined
              ? null
              : h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } }, trashNote),
            h('div', { className: 'sc-list-label' }, '工作区'),
            h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } },
              root === undefined ? '没有打开的会话' : root),
            sessionId === undefined
              ? h('p', { className: 'sc-muted', style: { padding: '0 10px', fontSize: 11 } }, '没有当前会话：按钮只能读，不能下发指令')
              : null,
          ) : null,
          h('section', { className: 'sc-detail' },
            selected === undefined
              ? homeView === 'trash'
                ? h('div', { className: 'sc-projects' },
                  h('h2', { className: 'sc-detail-title' }, '回收站'),
                  h('p', { className: 'sc-detail-tagline' }, '恢复回作品列表，或彻底删除数据库文件。彻底删除不能撤销。'),
                  trash.length === 0
                    ? h('p', { className: 'sc-muted', style: { marginTop: 12 } }, '回收站是空的。')
                    : h('div', { className: 'sc-project-grid', style: { marginTop: 12 } },
                      ...trash.map(item => h('div', { className: 'sc-project', key: item.path },
                        h('span', { className: 'sc-project-title' }, item.title),
                        h('span', { className: 'sc-work-meta' }, `${item.workId} · ${String(item.trashedAt ?? '').replace('T', ' ').slice(0, 16)}`),
                        h('div', { className: 'sc-actions', style: { marginTop: 4 } },
                          h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void restoreTrashed(item) } }, '恢复'),
                          h('button', { type: 'button', className: 'sc-btn sc-btn-small', onClick: () => { void purgeTrashed(item) } }, '彻底删除'),
                        ),
                      ))),
                )
                : h(ProjectList, {
                  key: typeFilter,
                  works: worksList.filter(work => work.form === typeFilter),
                  form: FORMS.find(form => form.id === typeFilter),
                  filters: workFilters,
                  onFilters: filters => { setWorkFilters(filters); setSelected(undefined) },
                  onOpen: workId => {
                    setSelected(workId)
                    setNotice(undefined)
                    if (sessionId !== undefined) {
                      void face!.setCurrent(root, sessionId, workId).catch(() => {})
                    }
                  },
                  onCreate: idea => compose(INSTRUCTIONS.newIdea(typeFilter, idea)),
                })
              : null,
            presetHealth.state === 'broken'
              ? h('p', { className: 'sc-notice sc-notice-error' }, `故事工坊预设装载失败：${presetHealth.reason}`)
              : null,
            presetHealth.state === 'missing'
              ? h('p', { className: 'sc-notice sc-notice-error' }, '故事工坊预设不在名册里：bundle 未启用，或 profile 里这条预设行被禁用。')
              : null,
            sessionId !== undefined && !isStudio(sessionPreset)
              ? h('p', { className: 'sc-notice sc-notice-info' },
                `当前会话${sessionPreset === undefined ? '没有记录预设' : `是 ${sessionPreset} 模式`}：工作台只读展示，按钮会拒绝下发指令。新建会话时选「故事工坊」即可生产。`)
              : null,
            status === 'error' ? h('p', { className: 'sc-notice sc-notice-error' }, error) : null,
            status === 'loading' ? h('p', { className: 'sc-muted' }, '读取作品列表…') : null,
            refreshError !== undefined
              ? h('p', { className: 'sc-notice sc-notice-info' }, `刷新失败：${refreshError}`)
              : null,
            status === 'ready' && worksList.length === 0 && Object.keys(workFilters).length === 0
              ? h(EmptyState, {
                face: face!,
                notice,
                root,
                form: typeFilter,
                canSend: sessionId !== undefined && isStudio(sessionPreset),
                onCreated: failure => setNotice(failure === undefined ? { kind: 'ok', text: '立项指令已投递；作品建成后会自动出现在列表。' } : { kind: 'error', text: failure }),
              })
              : null,
            status === 'ready' && worksList.length > 0 && selected !== undefined
              ? h(WorkDetail, {
                face: face!,
                root,
                workId: selected,
                sessionId,
                onBack: () => { setSelected(undefined); setNotice(undefined) },
                notice,
                canSend: sessionId !== undefined && isStudio(sessionPreset),
                compose,
                prefill: props.prefill,
                onNotice: setNotice,
              })
              : null,
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs'],
      /**
       * Register the right-sidebar tab that hosts the workbench.
       *
       * There is deliberately no main-panel entry and no left-sidebar row: the
       * workbench keeps the conversation (and its composer) on screen. The
       * Remote namespace is bound lazily: without it the workbench still reads,
       * it just cannot push instructions.
       * @param {object} ctx - the browser plugin context.
       */
      apply(ctx: ClientContext) {
        const bindings = { prompt: undefined }
        const face = createFace(ctx, bindings)
        pluginFace = face
        const tabId = 'see-storycraft'
        // Registration is an effect: the type lives exactly as long as this plugin.
        const disposeType = ctx.effect(() => {
          return ctx.sidebarRightTabs.register({
            id: tabId,
            kind: 'storycraft',
            multiple: false,
            keepMounted: true,
            priority: 'extension',
            title: () => '故事工坊',
            guide: [{ id: 'open', order: 30, title: () => '故事工坊', description: () => '作品编排、真值与章节生产' }],
          })
        })
        const disposeTabBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: tabId,
        }, StorycraftSideTab))
        const disposeTabTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: tabId,
        }, StorycraftTabTitle))
        let disposeBindings: (() => void) | undefined
        try {
          disposeBindings = ctx.inject(['remote.session'], (scope) => {
            bindings.prompt = scope.remote?.session
          })
        } catch (error) {
          console.warn('[see-storycraft] session Remote is unavailable:', error)
        }
        ctx.effect(() => () => {
          disposeBindings?.()
          disposeTabBody()
          disposeTabTitle()
        }, 'see-storycraft: sidebar entry and workbench')
      },
    }
  },
})


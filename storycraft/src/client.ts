import type * as ReactTypes from 'react'
import { WorkDetail } from './client/panels/workbench'
import { approvalMessage } from './client/instructions'
import { ChapterPanel } from './client/panels/chapter'
import { renderMarkdown } from './client/panels/render'
import { useVisiblePolling } from './client/panels/polling'
import { ProjectList } from './client/panels/projects'
import { SelfCheckPanel } from './client/panels/selfCheck'
import { LogsPanel } from './client/panels/logs'
import { SearchPanel } from './client/panels/search'
import { INSTRUCTIONS } from './client/instructions'
import { EmptyState } from './client/panels/empty'
import { bindReact } from './client/react'
import { isStudio, stageLabel, statusBadge, unitOf } from './client/panels/shared'

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
    bindReact(React)
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React


    // ---------------------------------------------------------------------
    // Types this bundle hands around. All of it is erased at build time: the
    // published file stays one plain script holding the loader's require('react').
    // ---------------------------------------------------------------------


    /** Fixed instruction templates the workbench sends to the current Session. */

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

    /**
     * Whether a session may drive the studio.
     *
     * The old form-specific id is accepted while sessions created before the
     * preset merge still exist; new sessions use `storycraft`.
     * @param preset - session preset id.
     * @returns {boolean} true when the session is a studio session.
     */

    /** Poll while the page is visible, plus immediate refresh on focus/reveal. */

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

    /** Human label of a pipeline stage. */

    /** Badge for a chapter state. */

    /**
     * Home view: the projects of one form, each opening into its detail page.
     * @param {object} props - works of this form, the form itself, open/create handlers.
     * @returns {object} the view.
     */

    /** Empty state: no work yet, with the one instruction that creates one. */

    /** One chapter reader with plan/body tabs, review list and state. */
    /** Inline editor: shows the canned instruction, lets the author add specifics. */

    /** Read-only self-check shared by the dashboard and the detail error branch. */

    /** Lazy call log for the current work; no prompt or output text. */

    /** Unified read-only search: memory, materials and skill references. */



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


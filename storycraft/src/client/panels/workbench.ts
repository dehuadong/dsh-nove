/** Work detail: foundation, chapters, state, bible, brief, analysis and backup pages. */

import type * as ReactTypes from 'react'
import { fetchOwnRoute } from '../api'
import { INSTRUCTIONS, approvalMessage } from '../instructions'
import { FOUNDATION_DOC_LABELS, FOUNDATION_STAGE_LABELS, MATERIAL_PURPOSE_LABELS, ROUTE, callOutcomeLabel, foundationDocLabel, hookStatusLabel } from '../labels'
import { useVisiblePolling } from './polling'
import { renderMarkdown } from './render'
import { SelfCheckPanel } from './selfCheck'
import { ChapterPanel } from './chapter'
import { SearchPanel } from './search'
import { LogsPanel } from './logs'
import { EmptyState } from './empty'
import { BIBLE_LABELS, CHAPTER_PAGE_SIZE, chapterGroups, isStudio, stageLabel, statusBadge, unitOf } from './shared'
import { h, useCallback, useEffect, useRef, useState } from '../react'
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
} from '../types'

    /** Work detail: header actions, chapter list, selected chapter, state. */
    export function WorkDetail({
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

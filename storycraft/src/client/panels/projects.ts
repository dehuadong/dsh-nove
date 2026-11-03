/** Home view: the projects of one form, each opening into its detail page. */

import type * as ReactTypes from 'react'
import { h, useRef, useState } from '../react'
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

    export function ProjectList({ works, form, filters, onFilters, onOpen, onCreate }: ProjectListProps) {
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

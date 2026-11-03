/** SearchPanel panel. */

import type * as ReactTypes from 'react'
import { fetchOwnRoute } from '../api'
import { ROUTE } from '../labels'
import { renderMarkdown } from './render'
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

    export function SearchPanel({ face, root, workId }: { face: Face, root: string | undefined, workId: string }) {
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

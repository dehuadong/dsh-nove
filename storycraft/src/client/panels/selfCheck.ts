/** SelfCheckPanel panel. */

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

    export function SelfCheckPanel({ face, root, workId }: { face: Face, root: string | undefined, workId: string }) {
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

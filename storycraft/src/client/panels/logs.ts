/** LogsPanel panel. */

import type * as ReactTypes from 'react'
import { fetchOwnRoute } from '../api'
import { ROUTE, callOutcomeLabel } from '../labels'
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

    export function LogsPanel({ face, root, workId }: { face: Face, root: string | undefined, workId: string }) {
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

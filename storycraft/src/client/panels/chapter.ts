/** Chapter reader: plan/body/review tabs, edits, revisions and the action buttons. */

import type * as ReactTypes from 'react'
import { fetchOwnRoute } from '../api'
import { INSTRUCTIONS, approvalMessage } from '../instructions'
import { FOUNDATION_DOC_LABELS, MATERIAL_PURPOSE_LABELS, ROUTE, callOutcomeLabel, foundationDocLabel, hookStatusLabel } from '../labels'
import { useVisiblePolling } from './polling'
import { renderMarkdown } from './render'
import { stageLabel, statusBadge, unitOf } from './shared'
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

    export function ChapterPanel({
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

import type * as ReactTypes from 'react'

/** Client contract: host context, slots, tabs, API payloads and panel models. */

    /** The subset of the Host browser plugin context this bundle calls. */
    export interface ClientContext {
      /** Dynamic boundary: the Host service registry is untyped by design. */
      get(name: string): any
      effect(execute: () => void | (() => void), label?: string): unknown
      /** Dynamic boundary: the injected service scope is owned by the Host. */
      inject(services: string[], callback: (scope: any) => void | (() => void)): () => void
      slots: ClientSlots
      sidebarRightTabs: { register(tab: ClientTabRegistration): () => void }
      sidebarRight: { openTab(kind: string, value?: unknown): void }
      layout: ClientLayout
    }

    /** Slot members this bundle calls. */
    export interface ClientSlots {
      inject(name: string, callback: () => () => void): () => void
      register(target: { name: string, key: string }, component: ReactTypes.FunctionComponent<never>): () => void
    }

    /** Layout members this bundle calls. */
    export interface ClientLayout {
      openRightbar?(pinned: boolean, reveal: boolean): void
      selectPanel?(panel: string): void
    }

    /** One right-sidebar tab registration. */
    export interface ClientTabRegistration {
      id: string
      kind: string
      multiple: boolean
      keepMounted: boolean
      priority: string
      title: () => string
      guide: Array<{ id: string, order: number, title: () => string, description: () => string }>
    }

    /** The session summary the page reads its workspace from. */
    export interface ClientSessionSummary {
      id?: string
      cwd?: string
      retainedBy?: { mainView?: number }
      projectionValues?: { agentPreset?: string }
    }

    export interface ClientSessionSnapshot {
      byId?: Record<string, ClientSessionSummary>
    }

    /** The Host session Remote the page pushes instructions through. */
    export interface PromptController {
      prompt(request: {
        requestId: string
        sessionId: string
        mode: 'queue'
        content: Array<{ type: 'text', text: string }>
      }): Promise<PromptResult>
    }

    export interface PromptResult {
      ok?: boolean
      error?: { message?: string }
    }

    /** Late-bound Host services the face may use. */
    export interface Bindings {
      prompt: PromptController | undefined
    }

    /** The workspace a page render is about. */
    export interface FaceContext {
      root: string | undefined
      sessionId: string | undefined
      preset: string | undefined
    }

    /** One work row of the list route. */
    export interface WorkSummary {
      workId: string
      title: string
      form: string
      chapters: number | null
      writtenChapters: number | null
      latestChapter: number | null
      openProblems: number | null
      latestStage?: string | null
      status?: string | null
      updatedAt: string
      degraded?: boolean
      schemaVersion?: number
      openError?: { code: string, message: string, retryable: boolean }
    }

    export interface WorksPayload {
      root?: string
      works: WorkSummary[]
    }

    export interface WorkQueryFilters {
      q?: string
      status?: string
      issues?: boolean
    }

    export interface ChapterQueryFilters {
      q?: string
      stage?: string
      issues?: boolean
    }

    export interface TrashItem {
      workId: string
      title: string
      trashedAt?: string
      path: string
    }

    export interface TrashPayload {
      items: TrashItem[]
    }

    export interface WordRange {
      min: number
      max: number
    }

    /** The outline timestamps the write buttons are gated on. */
    export interface WorkOutline {
      writtenAt?: string
      approvedAt?: string
      revision?: string
    }

    export interface WorkManifest {
      version: number
      workId: string
      planApproval: string
      outline?: WorkOutline
      title: string
      form: string
      tags?: string[]
      createdAt?: string
      updatedAt?: string
      /** The detail route omits it today; the settings form falls back. */
      wordRange?: WordRange
    }

    /** One chapter row of the work detail route. */
    export interface ChapterSummary {
      number: number
      id: string
      title: string
      status: string
      revision: number
      words: number
      stage: string
      hasPlan: boolean
      planApproved: boolean
      planRevision?: number
      hasSummary: boolean
      summaryRevision: number | null
      summaryStale: boolean
  stateReadyRevision: number
  stateDraftReady: boolean
      reviewRound: number
      openProblems: number
      updatedAt: string
    }

    export interface StateFact {
      subject: string
      predicate: string
      object: string
      validUntilChapter: number | null
    }

    export interface StateHook {
      hookId: string
      status: string
      text: string
      startChapter: number
    }

    export interface WorkState {
      facts: StateFact[]
      hooks: StateHook[]
      events: number
    }

    export interface WorkDetailPayload {
      manifest: WorkManifest
      chapters: ChapterSummary[]
      chapterMatches?: ChapterSummary[]
      state: WorkState
    }

    export interface DashboardChapter {
      number: number
      status: string
      stage: string
      revision: number
      words: number
      hasSummary: boolean
      summaryRevision: number | null
      summaryStale: boolean
    }

    export interface DashboardHook {
      hookId: string
      text: string
      status: string
      type?: string
      startChapter?: number
      lastAdvancedChapter?: number
      expectedPayoff?: string
    }

    export interface DashboardPayload {
      status: {
        writtenChapters: number
        latestChapter: number
        openProblems: number
        chapters: DashboardChapter[]
        hooks: { unresolved: number }
        calls?: { count: number, totalTokens: number | null }
      }
      hooks: DashboardHook[]
      transitionChapter: number | null
    }

    export type DashboardLoadState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', dashboard: DashboardPayload }

    export interface AnalysisCallRow {
      count: number
      totalDurationMs: number
      totalTokens: number | null
      callsWithoutUsage: number
    }

    export interface AnalysisPayload {
      reviews: {
        issues: {
          total: number
          bySeverity: { blocking: number, major: number, minor: number, unspecified: number }
          byCategory: { execution: number, quality: number, scope: number }
        }
        resolved: number
        chapters: Array<{ chapter: number, issues: number, resolved: number }>
      }
      calls: {
        total: AnalysisCallRow
        byRole: Array<AnalysisCallRow & { role: string }>
        byModel: Array<AnalysisCallRow & { model: string | null }>
      }
    }

    export type AnalysisLoadState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', analysis: AnalysisPayload }

    export interface SelfCheckIssue {
      code: string
      severity: 'error' | 'warning'
      message: string
      chapter?: number
    }

    export interface SelfCheckReport {
      ok: boolean
      checked: number
      issues: SelfCheckIssue[]
    }

    export type SelfCheckState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', report: SelfCheckReport }

    export interface CallLogRow {
      id: number
      chapter: number | null
      role: string
      scope: string
      attempt: number
      submissionAttempts: number | null
      trigger: string
      stopReason: string | null
      outcome: string
      errorCode: string | null
      durationMs: number
      promptChars: number
      outputChars: number
      totalTokens: number | null
      usageSource: string
      model: string | null
      provider: string | null
      startedAt: string
    }

    export interface CallLogPage {
      rows: CallLogRow[]
      nextBefore: number | null
    }

    export type LogsState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', rows: CallLogRow[], nextBefore: number | null }

    export interface SearchHit {
      id: string
      kind: string
      source: string
      location?: string
      snippet: string
      score: number
      chapter: number | null
    }

    export interface SearchGroup {
      kind: 'memory' | 'material' | 'skill'
      hits: SearchHit[]
    }

    export type SearchState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', groups: SearchGroup[] }

    export interface ChapterPayload {
      view: string
      path: string
      content: string
      revision: number
    }

    export interface HistoryPayload {
      workId: string
      chapter: number
      stage: string
      currentRevision: string
      planApproval: string
      body: Array<{ revision: number, words: number, createdAt: string, current: boolean }>
      plan: Array<{ revisionId: string, createdAt: string, current: boolean, approved: boolean }>
    }

    /** One review observation as the panel renders it. */
    export interface ReviewItem {
      id: string
      done: boolean
      assessment: string
      severity?: string
      evidence?: string[]
      location: string
      problem: string
      suggestion: string
    }

    export interface ReviewPayload {
      path?: string
      round: number
      revision: number
      rounds?: number
      observations?: unknown[]
      items: ReviewItem[]
    }

    /** Deterministic prose metrics of one chapter body. */
    export interface CritiqueMetrics {
      words: number
      chars: number
      sentences: { count: number, averageLength: number, longest: number }
      repeated: Array<{ text: string, count: number }>
      aiPhrases: { count: number, hits: Array<{ phrase: string, count: number }> }
      dialogueRatio: number
      wordRange?: WordRange
      withinRange?: boolean
      shortBy?: number
      longBy?: number
    }

    export interface Volume {
      id: number
      title: string
      from: number
      to: number
      summary: string
    }

    export interface VolumePayload {
      volumes: Volume[]
    }

    export interface BibleFile {
      name: string
      path: string
      version: string
      content: string
      draft: boolean
    }

    export interface BiblePayload {
      files: BibleFile[]
      missing: string[]
      editable: string[]
    }

    export interface FoundationState {
      stages?: { frame?: boolean, rules?: boolean, hooks?: boolean, roles?: boolean, cards?: boolean }
      complete: boolean
      nextStage?: string
      dispatchStage?: string
      approvedAt?: string
    }

    export interface FoundationDocument {
      name: string
      revisionId: string
      content: string
    }

    export interface FoundationPayload {
      workId: string
      foundation: FoundationState
      documents: FoundationDocument[]
    }

    /** One section of the assembled pre-write brief. */
    export interface BriefSection {
      name: string
      title: string
      source?: string
      content: string
      bytes: number
      tokens: number
      absent: boolean
      draft?: boolean
      /** Not emitted by the Host today; kept for the optional note badge. */
      note?: string
    }

    export interface BriefPayload {
      sections: BriefSection[]
      budget: { limit: number, used: number, unit?: string, overBudget: boolean }
      missing?: string[]
      dropped?: Array<{ name: string, tokens: number, reason: string }>
    }

    export interface Material {
      id: string
      title: string
      format: string
      purpose: string
      bytes: number
      createdAt: string
      hashPrefix?: string
      sourceName?: string
    }

    export interface MaterialPayload {
      materials: Material[]
    }

    export interface BackupFile {
      backupId: string
      file: string
      bytes: number
      createdAt: string
      materials?: { count: number, bytes: number }
      incomplete?: boolean
      corrupt?: boolean
      noMaterials?: boolean
    }

    export interface BackupPayload {
      backups: BackupFile[]
    }

    export interface ExportsPayload {
      exportId?: string
      directory?: string
      exists: boolean
    }

    /** One step of the stage machine shown above the tabs. */
    export interface NextStep {
      chapter: number
      stage: string
      action: string
      reason: string
      missing?: string[]
      blocked?: string[]
      foundationStage?: string
    }

    export interface WorkbenchAction {
      id: string
      label: string
      disabled?: { code: string, reason: string }
    }

    export interface Workbench {
      key: string
      label: string
      hint: string
      primary: WorkbenchAction
      secondary: WorkbenchAction[]
    }

    export interface NextPayload {
      next?: NextStep
      workbench?: Workbench
    }

    export interface CurrentPayload {
      current?: string
    }

    /** Receipt of the chapter delete/move routes. */
    export interface ChapterMutationPayload {
      changed: boolean
      chapters: number[]
      staleVolumes: string[]
      deleted?: number
      backup?: boolean
    }

    /** Result of the deterministic style extraction. */
    export interface StyleExtraction {
      metrics?: { sentences: number, avgSentence: number }
      sampleCount: number
      sampleChars: number
      chapters: number[]
      version: string
    }

    export interface RosterPayload {
      available?: boolean
      presets?: Array<{
        id?: string
        name?: string | null
        description?: string | null
        isDefault?: boolean
        broken?: string | null
      }>
    }

    /** The business face the page renders from. */
    export interface Face {
      context(): FaceContext
      listWorks(root: string | undefined, filters?: WorkQueryFilters): Promise<WorksPayload>
      listTrash(root: string | undefined): Promise<TrashPayload>
      restoreTrash(root: string | undefined, workId: string): Promise<{ workId: string }>
      purgeTrash(root: string | undefined, workId: string): Promise<{ workId: string }>
      createBackup(root: string | undefined, sessionId: string, workId: string, keep: number): Promise<{ pruned?: number }>
      rebuildIndex(root: string | undefined, sessionId: string, workId: string): Promise<{ counts: Record<string, number> }>
      restoreBackup(root: string | undefined, sessionId: string, workId: string, backupId: string): Promise<unknown>
      deleteBackup(root: string | undefined, sessionId: string, workId: string, backupId: string): Promise<unknown>
      volumes(root: string | undefined, id: string): Promise<VolumePayload>
      critique(root: string | undefined, id: string, chapter: number): Promise<{ metrics: CritiqueMetrics }>
      next(root: string | undefined, id: string): Promise<NextPayload>
      getCurrent(root: string | undefined, sessionId: string): Promise<CurrentPayload>
      setCurrent(root: string | undefined, sessionId: string, workId: string): Promise<CurrentPayload>
      work(root: string | undefined, id: string, filters?: ChapterQueryFilters): Promise<WorkDetailPayload>
      chapter(
        root: string | undefined,
        id: string,
        chapter: number,
        view: string,
        revision: number | undefined,
      ): Promise<ChapterPayload>
      history(root: string | undefined, sessionId: string | undefined, workId: string, chapter: number): Promise<HistoryPayload>
      adoptRevision(
        root: string | undefined,
        sessionId: string | undefined,
        workId: string,
        chapter: number,
        target: string,
        revision: string,
        expectedCurrent: string,
      ): Promise<{ newRevision: string }>
      approveChapterPlan(
        root: string | undefined,
        sessionId: string | undefined,
        workId: string,
        chapter: number,
      ): Promise<unknown>
      acceptChapter(
        root: string | undefined,
        sessionId: string | undefined,
        workId: string,
        chapter: number,
      ): Promise<{ accepted: number }>
      approveOutline(root: string | undefined, sessionId: string | undefined, workId: string): Promise<unknown>
      dashboard(root: string | undefined, id: string): Promise<{ dashboard: DashboardPayload }>
      analysis(root: string | undefined, id: string): Promise<{ analysis: AnalysisPayload }>
      selfCheck(root: string | undefined, id: string): Promise<{ report: SelfCheckReport }>
      search(root: string | undefined, id: string, query: string): Promise<{ search: { groups: SearchGroup[] } }>
      logs(
        root: string | undefined, id: string, options?: { before?: number, failed?: boolean },
      ): Promise<{ logs: CallLogPage }>
      transitionHook(
        root: string | undefined, sessionId: string | undefined, workId: string, hookId: string, op: 'progress' | 'resolve',
      ): Promise<{ dashboard: DashboardPayload }>
      foundation(root: string | undefined, id: string): Promise<FoundationPayload>
      approveFoundation(root: string | undefined, sessionId: string | undefined, workId: string): Promise<unknown>
      review(root: string | undefined, id: string, chapter: number): Promise<ReviewPayload>
      bible(root: string | undefined, id: string): Promise<BiblePayload>
      writeBible(
        root: string | undefined,
        sessionId: string,
        workId: string,
        file: string,
        content: string,
        expectedVersion: string | undefined,
      ): Promise<{ name: string, path: string, version: string }>
      brief(root: string | undefined, id: string, chapter: number): Promise<BriefPayload>
      materials(root: string | undefined, workId: string, purpose: string | undefined): Promise<MaterialPayload>
      importMaterial(
        root: string | undefined,
        sessionId: string,
        workId: string,
        name: string,
        contentBase64: string,
        title: string | undefined,
        purpose: string,
      ): Promise<unknown>
      renameMaterial(
        root: string | undefined,
        sessionId: string,
        workId: string,
        id: string,
        title: string,
      ): Promise<unknown>
      setMaterialPurpose(
        root: string | undefined,
        sessionId: string,
        workId: string,
        id: string,
        purpose: string,
      ): Promise<unknown>
      deleteMaterial(root: string | undefined, sessionId: string, workId: string, id: string): Promise<unknown>
      extractStyle(root: string | undefined, sessionId: string, workId: string): Promise<StyleExtraction>
      deleteChapter(
        root: string | undefined,
        sessionId: string,
        workId: string,
        chapter: number,
      ): Promise<ChapterMutationPayload>
      moveChapter(
        root: string | undefined,
        sessionId: string,
        workId: string,
        from: number,
        to: number,
      ): Promise<ChapterMutationPayload>
      exportWork(
        root: string | undefined,
        sessionId: string,
        workId: string,
      ): Promise<{ directory: string, files: number }>
      exports(root: string | undefined, id: string): Promise<ExportsPayload>
      backups(root: string | undefined, id: string): Promise<BackupPayload>
      /** Open the right-sidebar tab by kind; false when the sidebar is absent. */
      openSidebarTab(kind: string): boolean
      /** Send the main panel back to the conversation. */
      showConversation(): void
      send(text: string): Promise<string | undefined>
    }

    /** The fixed instruction templates the workbench sends. */
    export interface Instructions {
      flowToRevision(workId: string, chapter: number): string
      flowFull(workId: string, chapter: number): string
      step(workId: string, chapter: number, action: string): string
      nextChapter(workId: string, chapter: number): string
      review(workId: string, chapter: number): string
      revise(workId: string, chapter: number, mode: string): string
      planApproved(workId: string, chapter: number): string
      outlineApproved(workId: string): string
      settings(workId: string, range: WordRange | null, planApproval: string | undefined): string
      volume(workId: string, volume: VolumeForm): string
      restore(name: string): string
      rename(workId: string, title: string): string
      remove(workId: string): string
      reopen(workId: string, chapter: number): string
      summarize(workId: string, chapter: number): string
      fold(workId: string, chapter: number): string
      newIdea(form: string, idea: string): string
      confirm(proposalId: string): string
    }

    export interface WorkForm {
      id: string
      label: string
    }

    export interface VolumeForm {
      id?: number
      title: string
      from: number
      to: number
      summary: string
    }

    export interface SettingsForm {
      min: number
      max: number
      planApproval?: string
    }

    export interface MaterialEditing {
      id: string
      title: string
    }

    export interface BibleEditor {
      name: string
      content: string
      original: string
      version?: string
      saving: boolean
      error?: string
    }

    export interface ChapterGroup {
      key: string
      title: string
      volume?: Volume
      chapters: ChapterSummary[]
    }

    /** A transient banner under the header. */
    export interface Notice {
      kind: string
      text: string
    }

    export type DetailState =
      | { status: 'loading' }
      | { status: 'error', error: string }
      | ({ status: 'ready' } & WorkDetailPayload)

    export type ContentState =
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', content: string, path: string, revision: number }

    export type ReviewState =
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', items: ReviewItem[], round: number, revision: number }

    export type BibleState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', files: BibleFile[], missing: string[], editable: string[] }

    export type FoundationLoadState =
      | { status: 'idle' }
      | { status: 'loading' }
      | { status: 'error', error: string }
      | { status: 'ready', foundation: FoundationState, documents: FoundationDocument[] }

    export type BriefLoadState =
      | { status: 'idle' }
      | { status: 'loading', chapter: number }
      | { status: 'error', chapter: number, error: string }
      | ({ status: 'ready', chapter: number } & BriefPayload)

    export type PresetHealth =
      | { state: 'unknown' }
      | { state: 'ok' }
      | { state: 'missing' }
      | { state: 'broken', reason: string }

    export interface ProjectListProps {
      works: WorkSummary[]
      form: WorkForm | undefined
      filters: WorkQueryFilters
      onFilters(filters: WorkQueryFilters): void
      onOpen(workId: string): void
      onCreate(idea: string): void
    }

    export interface EmptyStateProps {
      face: Face
      notice: Notice | undefined
      root: string | undefined
      form: string
      onCreated(failure: string | undefined): void
      canSend: boolean
    }

    export interface ChapterPanelProps {
      face: Face
      root: string | undefined
      workId: string
      sessionId: string | undefined
      chapter: ChapterSummary
      latestChapter?: number
      unit: string
      onNotice(notice: Notice): void
      onApproved(): void
      canSend: boolean
      compose(text: string): void
      hideActions: boolean
    }

    export interface WorkDetailProps {
      face: Face
      root: string | undefined
      workId: string
      sessionId: string | undefined
      onBack(): void
      onNotice(notice: Notice): void
      notice: Notice | undefined
      canSend: boolean
      compose(text: string): void
      /** Reserved for the sidebar composer; the page composes its own text today. */
      prefill?: (text: string) => void
    }

    export interface StorycraftPageProps {
      storycraft: Face | undefined
      compact?: boolean
      prefill?: (text: string) => void
    }

    export interface StorycraftSideTabProps {
      storycraft?: Face
      inputActions?: { setDraft?: (text: string) => void }
    }

    /** Read-only routes this bundle serves. */


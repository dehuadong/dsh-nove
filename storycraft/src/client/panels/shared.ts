/** Pure panel helpers shared by the workbench pages. */

    import type { ChapterGroup, ChapterSummary, Volume } from '../types'

export function unitOf(form: string): string {
      if (form === 'script') return '集'
      if (form === 'short') return '篇'
      return '章'
    }

    export function stageLabel(stage: string): string {
      const map: Record<string, string> = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
        settled: '已定稿',
      }
      return map[stage] ?? stage
    }

    export function statusBadge(status: string): string {
      const map: Record<string, string> = {
        planned: '已规划',
        written: '已写',
        reviewed: '已审',
        revised: '已修订',
      }
      return map[status] ?? status
    }

    export function isStudio(preset: string | undefined): boolean {
      return typeof preset === 'string' && preset.startsWith('storycraft')
    }

    export const BIBLE_LABELS: Record<string, string> = { world: '世界观', style: '文风基准', plan: '全书计划', intent: '作者意图' }

    export const CHAPTER_PAGE_SIZE = 20

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

    export function chapterGroups(chapters: ChapterSummary[], volumes: Volume[]): ChapterGroup[] {
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

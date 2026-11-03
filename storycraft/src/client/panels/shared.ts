/** Pure panel helpers shared by the workbench pages. */

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

/** Visible-only polling used by the panel pages. */

import { useEffect, useRef } from '../react'

    export function useVisiblePolling(intervalMs: number, refresh: () => Promise<void>): void {
      useEffect(() => {
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const schedule = () => {
          if (cancelled) return
          timer = setTimeout(async () => {
            if (document.visibilityState === 'visible') await refresh()
            schedule()
          }, intervalMs)
        }
        const refreshNow = () => {
          if (document.visibilityState === 'visible') void refresh()
        }
        document.addEventListener('visibilitychange', refreshNow)
        window.addEventListener('focus', refreshNow)
        schedule()
        return () => {
          cancelled = true
          clearTimeout(timer)
          document.removeEventListener('visibilitychange', refreshNow)
          window.removeEventListener('focus', refreshNow)
        }
      }, [intervalMs, refresh])
    }

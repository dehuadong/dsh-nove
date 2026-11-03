/** Browser half of the read-only routes: service probing, deadlines and JSON fetch. */

import type { ClientContext } from './types'

/** How long one Host answer may take before the page stops waiting. */
const READ_TIMEOUT_MS = 8000

    export function probe(ctx: ClientContext, name: string): any {
      try {
        const value = ctx.get(name)
        return value === null || value === undefined ? undefined : value
      } catch {
        return undefined
      }
    }

    export function withinDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`${label}没有在 ${READ_TIMEOUT_MS / 1000} 秒内返回`))
        }, READ_TIMEOUT_MS)
        promise.then(
          (value) => { clearTimeout(timer); resolve(value) },
          (error) => { clearTimeout(timer); reject(error) },
        )
      })
    }

    export async function fetchOwnRoute(path: string, options: { cache?: RequestCache } = {}): Promise<any> {
      const response = await fetch(path, {
        method: 'GET',
        credentials: 'same-origin',
        ...(options.cache === undefined ? {} : { cache: options.cache }),
        headers: { accept: 'application/json' },
      })
      if (response.status === 404) {
        throw new Error('宿主没有加载这条只读接口：重启应用让插件更新生效。')
      }
      const body = await response.json().catch(() => undefined)
      if (body === undefined) throw new Error(`HTTP ${response.status}`)
      if (body.ok === false) throw new Error(body.error?.message ?? `HTTP ${response.status}`)
      return body
    }

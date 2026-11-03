/** Tool registry surface: plugin metadata and stable error envelopes for every action. */

import { StoryError } from '../domain.ts'
import type { FailureEnvelope } from './types.ts'

/** Services this plugin injects. */
export const inject: string[] = ['tools']

/** Provider label used in diagnostics. */
export const name: string = 'storycraft-tools'

export function storeErrorCodeOf(error: unknown): string | undefined {
  return (error as { code?: unknown } | null | undefined)?.code as string | undefined
}

export function failureOf(error: unknown): FailureEnvelope {
  if (error instanceof StoryError) {
    const missing = error.code === 'bible-missing'
      ? error.message.replace(/^.*?：/u, '').split('（')[0].split('、').map(name => name.trim()).filter(Boolean)
      : undefined
    return {
      ok: false,
      ...(missing === undefined ? {} : { missing }),
      error: {
        code: error.code,
        message: error.message,
        ...(error.next === undefined ? {} : { next: error.next }),
        ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
      },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message } }
}

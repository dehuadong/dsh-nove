/** Summarizer submission schema: the raw summary and its structured fields. */

import { SUMMARY_FIELDS } from '../../domain.ts'

/** Validate one summarizer payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
    if (payload.rawText === undefined || typeof payload.rawText !== 'string' || payload.rawText.trim() === '') {
      return 'summarizer 缺少 rawText'
    }
    for (const field of SUMMARY_FIELDS) {
      if (payload[field] !== undefined && typeof payload[field] !== 'string') {
        return `summarizer 的 ${field} 必须是字符串`
      }
    }
    return undefined
}

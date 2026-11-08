/** Validator submission schema: reconciliation findings. */

import { STATE_CHECK_NO_EVIDENCE, VALIDATOR_CODES, VALIDATOR_LIMITS } from './constants.ts'

/** Validate one validator payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
    if (!Array.isArray(payload.items)) return 'validator 缺少 items 数组'
    if (payload.reconciliationRequired !== undefined && typeof payload.reconciliationRequired !== 'boolean') {
      return 'validator reconciliationRequired 必须是布尔值'
    }
    if (payload.items.length > 8) return 'validator items 最多 8 条'
    if (payload.reconciliationRequired === true && payload.items.length === 0) {
      return 'validator reconciliationRequired=true 时必须至少一条 finding 说明理由'
    }
    for (const [index, item] of payload.items.entries()) {
      if (item === null || typeof item !== 'object') return `validator 第 ${index + 1} 条不是对象`
      if (!VALIDATOR_CODES.has(item.code)) return `validator 第 ${index + 1} 条 code 非法`
      for (const key of ['where', 'problem', 'evidence', 'impact', 'fix']) {
        if (typeof item[key] !== 'string' || item[key].trim() === '') {
          return `validator 第 ${index + 1} 条缺少 ${key}`
        }
        if ([...item[key]].length > VALIDATOR_LIMITS[key]) {
          return `validator 第 ${index + 1} 条 ${key} 超过 ${VALIDATOR_LIMITS[key]} 字`
        }
      }
      if (item.code === 'missing-change' && item.evidence.trim() === STATE_CHECK_NO_EVIDENCE) {
        return `validator 第 ${index + 1} 条 missing-change 需要正文引文`
      }
      if (!['major', 'minor'].includes(item.severity)) {
        return `validator 第 ${index + 1} 条 severity 非法`
      }
    }
    return undefined
}

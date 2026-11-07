/** Reviewer submission schema: per-item quote/problem/fix/mode/severity. */


/** Validate one reviewer payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
  if (!Array.isArray(payload.items)) return 'reviewer 缺少 items 数组'
  if (payload.items.length > 8) return 'reviewer items 最多 8 条'
  for (const [index, item] of payload.items.entries()) {
    if (item === null || typeof item !== 'object') return `reviewer 第 ${index + 1} 条不是对象`
    for (const key of ['quote', 'problem', 'fix']) {
      if (typeof item[key] !== 'string' || item[key].trim() === '') return `reviewer 第 ${index + 1} 条缺少 ${key}`
    }
    if (!['blocking', 'major', 'minor'].includes(item.severity)) return `reviewer 第 ${index + 1} 条 severity 非法`
    if (!['patch', 'polish', 'rewrite', 'deslop', 'rework', 'anti-detect', 'spot-fix'].includes(item.mode)) return `reviewer 第 ${index + 1} 条 mode 非法`
    if (item.resolves !== undefined && (typeof item.resolves !== 'string' || !/^O[1-9]\d*$/u.test(item.resolves))) {
      return `reviewer 第 ${index + 1} 条 resolves 非法`
    }
  }
}

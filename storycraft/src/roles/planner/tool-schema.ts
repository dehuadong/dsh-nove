/** Planner submission schema: the five plan fields plus threadRefs. */


/** Validate one planner payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
    const allowed = ['perspective', 'goal', 'obstacle', 'cost', 'turn', 'body', 'threadRefs']
    for (const key of Object.keys(payload)) {
      if (!allowed.includes(key)) return `planner 不接受字段 ${key}`
    }
    for (const key of ['perspective', 'goal', 'obstacle', 'cost', 'turn', 'body']) {
      if (typeof payload[key] !== 'string' || payload[key].trim() === '') return `planner 缺少 ${key}`
    }
    if (!Array.isArray(payload.threadRefs) || payload.threadRefs.some((ref: unknown) => typeof ref !== 'string')) {
      return 'planner 的 threadRefs 必须是字符串数组'
    }
    return undefined
}

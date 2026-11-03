/** Reviser submission schema: revised body and resolved observation ids. */


/** Validate one reviser payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
    if (typeof payload.body !== 'string' || payload.body.trim() === '') return 'reviser 缺少 body'
    if (payload.resolved !== undefined) {
      if (!Array.isArray(payload.resolved)) return 'reviser 的 resolved 必须是数组'
      if (payload.resolved.some((id: unknown) => typeof id !== 'string' || !/^O[1-9]\d*$/u.test(id))) return 'reviser 的 resolved 必须是 observation id'
    }
    return undefined
}

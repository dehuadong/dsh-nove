/** Writer submission schema: chapter title and full body. */


/** Validate one writer payload; a message means the child must correct it. */
export function validate(payload: any): string | undefined {
    if (typeof payload.title !== 'string' || payload.title.trim() === '') return 'writer 缺少 title'
    if (typeof payload.body !== 'string' || payload.body.trim() === '') return 'writer 缺少 body'
    return undefined
}

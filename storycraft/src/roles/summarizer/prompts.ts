/** Summarizer prompt: the raw summary plus structured fields. */

/** Role-specific prompt lines, appended after the shared scaffold. */
export function lines(input: { mode: string }): string[] {
  const out: string[] = []
    out.push('payload 格式：{"rawText":"本章摘要","title":"…","characters":"…","events":"…","stateChanges":"…","hookActivity":"…","mood":"…","chapterType":"…"}。')
    out.push('rawText 必填，只写本章发生的事实与状态变化，不超过 400 字；结构字段各不超过 120 字、可为空串；不评价、不补设定、不写下一章计划。')
    out.push('提交成功后最终只回「已提交」；不要手动调用落盘动作。')
  return out
}

/** Reviewer prompt: evidence-backed findings, no edits. */

/** Role-specific prompt lines, appended after the shared scaffold. */
export function lines(input: { mode: string }): string[] {
  const out: string[] = []
    out.push('payload 格式：{"items":[{"quote":"正文或章纲里的逐字引文","problem":"问题","impact":"读者影响","severity":"blocking|major|minor","fix":"怎么修","mode":"patch|polish|rewrite|deslop","resolves":"可选：上一轮的 observation id"}]}。')
    out.push('quote 必须逐字出现在正文或本章章纲里；已修复的上一轮 issue 用 assessment resolved 的方式提交：填 resolves=上一轮 id，quote 填修复后的正文引文。')
    out.push('没有问题时 payload 为 {"items":[]}；提交成功后最终只回「已提交」。')
  return out
}

/** Reviser prompt: one revision mode, resolved observation ids optional. */

/** Role-specific prompt lines, appended after the shared scaffold. */
export function lines(input: { mode: string }): string[] {
  const out: string[] = []
    out.push('payload 格式：{"body":"修订后的整章正文","resolved":["可选：本轮处理的 observation id"]}。')
    const modeRule = input.mode === 'rewrite'
      ? '可以重组段落与场景，但必须保留章纲事实、人物动机与章末落点；'
      : input.mode === 'deslop'
        ? '只处理腔调词与套话，不改情节与段落结构；'
        : '只改本次任务点名的条目，未点名段落保持原样；'
    out.push(`修订模式：${input.mode}。${modeRule}`)
    out.push('提交成功后最终只回「已提交」；不要手动调用落盘动作。')
  return out
}

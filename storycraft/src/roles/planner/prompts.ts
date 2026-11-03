/** Planner prompt: the five plan fields plus threadRefs. */

/** Role-specific prompt lines, appended after the shared scaffold. */
export function lines(input: { mode: string }): string[] {
  const out: string[] = []
    out.push('payload 格式：{"perspective":"视角人物","goal":"本章目标","obstacle":"阻力","cost":"代价","turn":"结尾变化","body":"章纲正文","threadRefs":["可选：伏笔 id"]}。')
    out.push('五项、body、threadRefs 都必须提交；threadRefs 是字符串数组，可为空。不要写正文，不要确认章纲；提交成功后最终只回「已提交」。')
  return out
}

/** Writer prompt: chapter title and full body, no other output. */

/** Role-specific prompt lines, appended after the shared scaffold. */
export function lines(input: { mode: string }): string[] {
  const out: string[] = []
    out.push('标题不超过 20 字，概括本章发生的那个变化，不要用「第 N 章」。')
    out.push('只用手头上下文出现过的人名、地名、官职、数字与尺寸；需要新角色时用无名角色；不要读其它作品。')
    out.push('payload 格式：{"title":"本章标题","body":"整章正文"}。')
    out.push('不要省略正文，不要把正文作为最终回答；提交成功后最终只回「已提交」。')
  return out
}

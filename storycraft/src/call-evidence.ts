/** Read child-session evidence for one dispatch without storing text. */

export interface CallUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  usageSource: 'session' | 'partial' | 'unavailable'
  modelCalls: number
  outputChars: number
  model: string | null
  provider: string | null
}

function textLength(value: unknown): number {
  return typeof value === 'string' ? [...value].length : 0
}

/** Sum usage and character counts from a live child session before it is disposed. */
export function callEvidence(sessions: any, childId: string | undefined, result: any, promptChars: number): CallUsage {
  const evidence: CallUsage = {
    inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    usageSource: 'unavailable', modelCalls: 0, outputChars: 0, model: null, provider: null,
  }
  let session: any
  try {
    session = childId === undefined ? undefined : sessions?.get?.(childId)
  } catch {
    session = undefined
  }
  if (session === undefined) {
    for (const block of result?.output ?? []) evidence.outputChars += textLength(block?.text)
    return evidence
  }
  let messages = 0
  let missing = 0
  let input = 0
  let output = 0
  let total = 0
  let cacheRead = 0
  let cacheWrite = 0
  let usageRows = 0
  let events: any[] = []
  try { events = session.ownEvents?.() ?? [] } catch { events = [] }
  for (const event of events) {
    if (event?.type === 'assistant/message') {
      messages += 1
      for (const block of event.data?.message?.content ?? []) evidence.outputChars += textLength(block?.text)
      const usage = event.data?.usage
      if (usage === undefined) missing += 1
      else {
        usageRows += 1
        input += Number(usage.inputTokens ?? 0)
        output += Number(usage.outputTokens ?? 0)
        total += Number(usage.totalTokens ?? (Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0)))
        cacheRead += Number(usage.cacheReadTokens ?? 0)
        cacheWrite += Number(usage.cacheWriteTokens ?? 0)
      }
    } else if (event?.type === 'tool/call') {
      evidence.outputChars += textLength(event.data?.arguments)
    }
  }
  evidence.modelCalls = messages
  if (usageRows === 0) return evidence
  evidence.inputTokens = input
  evidence.outputTokens = output
  evidence.totalTokens = total
  evidence.cacheReadTokens = cacheRead
  evidence.cacheWriteTokens = cacheWrite
  evidence.usageSource = missing === 0 ? 'session' : 'partial'
  try {
    const context = session.requestContext?.()
    const header = session.requestHeader?.()
    evidence.model = context?.model ?? header?.config?.model ?? null
    evidence.provider = context?.provider ?? header?.config?.provider ?? null
  } catch {
    // Evidence only; missing identity stays null.
  }
  return evidence
}

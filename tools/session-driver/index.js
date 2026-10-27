/**
 * Deliver one user message into an existing session by id.
 *
 * The GUI sends user messages through the same `sessionController.prompt`
 * entry point; this exposes it as a tool so the acceptance driver can paste
 * instructions into a story session without a human relaying them.
 *
 * Deliberately narrow: text only, no attachments, no model/preset changes.
 */

export const inject = ['tools']

export function apply(ctx) {
  const controller = ctx.get('sessionController')
  if (controller === undefined) return

  ctx.tools.register({
    name: 'session_prompt',
    description: 'Deliver one user message into an existing session by id (acceptance driving only).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'Exact session id, e.g. session-<uuid>.' },
        text: { type: 'string', description: 'Message text to deliver as the user.' },
      },
      required: ['sessionId', 'text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean' },
          sessionId: { type: 'string' },
        },
        required: ['accepted', 'sessionId'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `prompt accepted=${value.accepted} session=${value.sessionId}`,
      }],
    },
    mutates: true,
    timeoutMs: 60_000,
    async execute(args, exec) {
      const value = await controller.prompt({
        requestId: `acceptance-${crypto.randomUUID()}`,
        sessionId: args.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: args.text }],
        clientTimeZone: 'Asia/Shanghai',
      }, exec.signal)
      return { accepted: value.accepted === true, sessionId: args.sessionId }
    },
  })
}

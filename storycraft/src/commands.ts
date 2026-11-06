/**
 * Human-command entry points for the longform workspace.
 *
 * Commands run in the Session's workspace and never send their payload to the
 * model. `/story-init` initializes a project directory and fixes its form; it is
 * the CLI-equivalent entry beside the model-facing `story_init` action.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureWorkspaceForm } from './storage.ts'

/** Minimal host context this module needs. */
export interface CommandContext {
  commands: {
    register(definition: {
      name: string
      description: string
      handler: (invocation: any) => Promise<{ kind: 'success' | 'error', text?: string }>
    }): () => void
  }
}

/**
 * Initialize one longform workspace, or a named subdirectory of it.
 * @param invocation - command invocation carrying the agent and raw input.
 * @returns command result.
 */
export async function initializeWorkspace(invocation: any): Promise<{ kind: 'success' | 'error', text?: string }> {
  try {
    const cwd = invocation?.agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') {
      return { kind: 'error', text: '当前会话没有工作目录：先打开一个工作区' }
    }
    const name = String(invocation.rawInput ?? '').trim()
    const root = name === '' ? cwd : join(cwd, name)
    await mkdir(root, { recursive: true })
    ensureWorkspaceForm(root, 'longform', 'storycraft')
    return { kind: 'success', text: `已初始化长篇工作区：${root}` }
  } catch (error: any) {
    return { kind: 'error', text: String(error?.message ?? error) }
  }
}

/** Register the workspace commands on the host command registry. */
export function registerStoryCommands(ctx: CommandContext): void {
  ctx.commands.register({
    name: 'story-init',
    description: '初始化当前工作区为长篇项目',
    handler: initializeWorkspace,
  })
}

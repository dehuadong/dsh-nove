/** Storycraft human commands as their own preset plugin. */
import { registerStoryCommands } from './commands.ts'

/** The command registry is the only service this plugin needs. */
export const inject = ['commands']

/**
 * Register the workspace commands in this plugin's agent scope.
 * @param ctx - host context carrying the command registry.
 */
export function apply(ctx: any): void {
  registerStoryCommands({ commands: ctx.commands })
}

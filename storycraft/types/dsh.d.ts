/**
 * The DeepSeek Harness surface the storycraft Host modules consume.
 *
 * Host modules never import `@deepseek-ai/*`; the harness reaches them through
 * the `ctx` plugin context and the `exec` tool-run context, so only those two
 * values are declared here. Membership mirrors the Harness service definitions
 * (`WebRoute` in `host/webserver`, `ToolDefinition`/`ToolGuard`/`ToolExecution`
 * in `core/tools`, `effect`/`get` in the Cordis context) for the members this
 * package calls. The declarations are global on purpose: migration keeps this
 * package a single `src/` program, and an imported `.d.ts` outside `rootDir`
 * would not compile.
 *
 * When the harness publishes stable declarations, replace this file with them.
 */

/** One registered route on the harness web server. */
interface DshWebRoute {
  /** `exact` matches the pathname verbatim; `prefix` also matches nested paths. */
  kind: 'exact' | 'prefix'
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the whole response lifecycle. */
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
}

/** Web server service members this package calls. */
interface DshWebServer {
  /** Register one route and return its disposer. */
  register(route: DshWebRoute): () => void
}

/** A model-facing content block. */
interface DshContentBlock {
  type: 'text'
  text: string
}

/** A JSON Schema node as the tool registry accepts it. */
type DshJsonSchema = Record<string, unknown>

/** The canonical output declaration of one tool. */
interface DshToolOutput {
  /** Schema enforced against every successful value. */
  schema: DshJsonSchema
  /** Project the value into model-facing content. */
  render(args: unknown, value: unknown): DshContentBlock[]
}

/** Session header fields the actions read. */
interface DshSessionHeader {
  /** Session identity. */
  id?: string
  /** Working directory fixed at session start. */
  cwd?: string
  /** Parent session for a delegated child. */
  parentSession?: string
  /** Delegation depth fixed at spawn; the main session is 0. */
  delegationDepth?: number
}

/** Session fields the actions read. */
interface DshSession {
  /** Session identity. */
  id?: string
  /** Immutable header. */
  header?: DshSessionHeader
}

/** The calling agent of one tool run. */
interface DshAgent {
  /** Session identity of the caller. */
  id?: string
  /** Session the caller belongs to. */
  session?: DshSession
}

/** One tool call's execution context. */
interface DshToolExecution {
  /** Registered tool name. */
  name?: string
  /** Parsed model arguments. */
  arguments?: Record<string, unknown>
  /** Calling agent. */
  agent?: DshAgent
  /** Caller cancellation. */
  signal?: AbortSignal
  /** Positional session identity used by tests and older callers. */
  sessionId?: string
}

/** A deny-or-allow predicate run before a tool call. */
type DshToolGuard = (execution: DshToolExecution) => string | undefined

/** A registered tool: schema plus the execution function. */
interface DshToolDefinition {
  /** Registry name the model calls. */
  name: string
  /** Model-facing description. */
  description?: string
  /** Arguments schema. */
  parameters?: DshJsonSchema
  /** Canonical output declaration. */
  output?: DshToolOutput
  /** Run one accepted call. */
  execute(args: any, exec: DshToolExecution): Promise<unknown>
}

/** Tool registry members this package calls. */
interface DshTools {
  /** Register one tool and return its disposer. */
  register(definition: DshToolDefinition): () => void
  /** Install one guard and return its disposer. */
  guard(guard: DshToolGuard): () => void
}

/** One skill candidate as the skill registry stores it. */
interface DshSkillCandidate {
  /** Absolute file path of the skill body. */
  path: string
  /** Skill name. */
  name: string
  /** One-line description. */
  description?: string
  /** When to load this skill. */
  whenToUse?: string
}

/** One skill definition as the skill registry serves it. */
interface DshSkillDefinition extends DshSkillCandidate {
  /** Markdown body. */
  content: string
}

/** The provider row a mode registers. */
interface DshSkillProvider {
  /** Provider label. */
  name: string
  /** List every candidate of this provider. */
  list(): Promise<DshSkillCandidate[]>
  /**
   * Load one candidate's body. The registry hands back a candidate this provider
   * produced, so the concrete fields belong to the provider.
   * @param candidate - entry previously returned by `list`.
   */
  get(candidate: any): Promise<DshSkillDefinition | undefined>
}

/** Skill registry members this package calls. */
interface DshSkills {
  /** Register one provider and return its disposer. */
  registerProvider(factory: () => DshSkillProvider): () => void
}

/** The plugin logger. */
interface DshLogger {
  /**
   * Report a recoverable problem.
   * @param message - diagnostic text.
   */
  warn?(message: string): void
}

/** The plugin context handed to `apply`. */
interface DshContext {
  /** Web server service; declared by injecting `webServer`. */
  webServer: DshWebServer
  /** Tool registry; declared by injecting `tools`. */
  tools: DshTools
  /** Skill registry; declared by injecting `skills`. */
  skills: DshSkills
  /** Plugin logger. */
  logger?: DshLogger
  /**
   * Read a global service by name. The harness returns `any`: callers narrow.
   * @param name - service name.
   * @param strict - throw instead of returning undefined.
   */
  get(name: string, strict?: boolean): any
  /**
   * Run a registration body and dispose its result with the plugin fiber.
   * @param execute - body returning a disposer.
   * @param label - diagnostic label.
   */
  effect(execute: () => void | (() => void), label?: string): unknown
}

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

/** Invocation controls every skill entry carries. */
interface DshSkillInvocation {
  /** Whether model-facing catalogs include this skill. */
  modelInvocable: boolean
  /** Whether human-facing catalogs include this skill. */
  userInvocable: boolean
}

/** Provider-specific base a loaded body resolves relative resources against. */
type DshSkillResourceBase =
  | { kind: 'directory', path: string }
  | { kind: 'url', url: string }
  | { kind: 'opaque', description: string }

/** Discovery-neutral skill metadata. */
interface DshSkillSummary {
  /** Absolute body path, absent for virtual skills. */
  path?: string
  /** Kebab-case identifier. */
  name: string
  /** Short routing description. */
  description: string
  /** Extra routing guidance. */
  whenToUse?: string
  /** Resolved invocation controls. */
  invocation: DshSkillInvocation
  /** Discovery source. */
  source: string
  /** Provider that owns the body. */
  provider: string
  /** Base for relative resources. */
  resourceBase?: DshSkillResourceBase
}

/** Provider catalog entry the registry merges and later loads. */
interface DshSkillCandidate extends DshSkillSummary {
  /** Lower ranks win duplicate names. */
  rank: number
  /** Provider-owned handle the registry passes back to `get`. */
  locator: unknown
  /** Provider-specific frontmatter metadata. */
  metadata?: Readonly<Record<string, unknown>>
}

/** Complete parsed skill, including the loaded body. */
interface DshSkillDefinition extends DshSkillSummary {
  /** Markdown body after frontmatter removal. */
  content: string
  /** Provider-specific frontmatter metadata. */
  metadata?: Readonly<Record<string, unknown>>
}

/** The provider row a mode registers. */
interface DshSkillProvider {
  /** Provider label. */
  name: string
  /** List every candidate of this provider. */
  list(): Promise<DshSkillCandidate[]>
  /**
   * Load one candidate's body.
   * @param candidate - entry previously returned by `list`.
   */
  get(candidate: DshSkillCandidate): Promise<DshSkillDefinition | undefined>
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

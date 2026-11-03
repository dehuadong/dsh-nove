/** Tool-definition shapes shared by the registry and the action modules. */

export type SchemaNode = Record<string, any>

/**
 * Parsed model arguments of one action call.
 *
 * Model JSON is a DSH dynamic boundary: the registry validates it against the
 * action's `parameters` schema and the store validates every field again, so
 * actions read it as an untyped record instead of a hand-maintained mirror.
 */
export type ModelArgs = Record<string, any>

/** Model-facing artifact identity; the host owns the storage path. */
export interface ArtifactRef {
  workId: string
  artifactId: string
  // The store hands back its typed SQLite column; at runtime it is always the revision text.
  revisionId: any
  kind: string
}

/** The structured failure every action returns. */
export interface FailureEnvelope {
  ok: false
  missing?: string[]
  error: { code: string, message: string, next?: string }
}

/** Manifest fields the actions read; the store owns the full shape. */
export interface ManifestView {
  title?: string
  chapters: Array<{ number: number, currentRevision: number }>
  outline?: { approvedAt?: string }
  wordRange?: { min: number, max: number }
}

/** One action spec accepted by the {@link action} factory. */
export interface ActionSpec {
  name: string
  description: string
  parameters: SchemaNode
  output?: DshToolOutput
  mutates?: boolean
  execute(args: ModelArgs, exec: DshToolExecution): Promise<any>
}

/** A registry-ready action; `mutates` drives the delegation guard. */
export interface ActionDefinition extends DshToolDefinition {
  description: string
  parameters: SchemaNode
  output: DshToolOutput
  mutates: boolean
}

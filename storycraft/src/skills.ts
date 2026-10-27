/**
 * Skill provider for the Storycraft studio preset.
 *
 * The module mounts with `config.mode`: a single catalog, or `all` for the
 * storycraft work mode, which serves every form and every role craft. The
 * work's own form and the assigned role decide which body the model reads. The
 * bodies and their helper scripts ship beside the package root under
 * `skills/<mode>/<skill>/`, so a catalog is one directory, not a configuration
 * chore.
 *
 * The provider is read-only and re-reads from disk on every `list`/`get`; the
 * catalog is small and the files are the authority.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Provider name advertised to the skill registry. */
export const name = 'storycraft-skills'

/** Requires the skill registry; without it this row stays inert. */
export const inject = ['skills']

/**
 * Directory this module lives in: `lib/` in the built package and `src/` when a
 * test imports the source. Both sit one level below the package root, where the
 * catalogs ship, so `SKILLS_ROOT` steps one level up either way.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

/** Package root, the directory that owns `skills/`. */
const SKILLS_ROOT = join(HERE, '..')

/** A mode that serves every catalog: the work mode mounts this. */
const ALL = 'all'

/** A mode that serves every form catalog, without the studio or role catalogs. */
const FORMS = 'forms'

/** Discovery rank; lower wins a name collision, and a preset-local catalog is authoritative. */
const RANK = 100

/** The catalog file: mode → skill names. */
const CATALOG_FILE = join(SKILLS_ROOT, 'skills', 'catalog.json')

/** Parsed mode catalog. */
interface Catalog {
  readonly modes: Record<string, readonly string[]>
}

/**
 * Read the mode catalog.
 *
 * The file is the authority, not the directory path: a skill lives at a flat
 * `skills/<name>/` and moving it between catalogs is one edit here.
 * @returns parsed modes; empty when the file is missing or malformed.
 */
function readCatalog(): Catalog {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'))
  } catch {
    return { modes: {} }
  }
  const modes = (parsed as { modes?: unknown })?.modes
  const result: Record<string, string[]> = {}
  if (modes !== null && typeof modes === 'object') {
    for (const [name, list] of Object.entries(modes as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      result[name] = list.filter((item): item is string => typeof item === 'string')
    }
  }
  return { modes: result }
}

/**
 * Index every skill directory under `skills/` by its front-matter name.
 *
 * The walk accepts both the flat layout and a nested one, so this step can land
 * before the directories are flattened.
 * @returns name → absolute skill directory; the first directory wins.
 */
function skillIndex(): Map<string, string> {
  const index = new Map<string, string>()
  const root = join(SKILLS_ROOT, 'skills')
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return index
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(root, entry.name)
    const file = join(full, 'SKILL.md')
    let content: string | undefined
    try {
      if (statSync(file).isFile()) content = readFileSync(file, 'utf8')
    } catch {
      content = undefined
    }
    if (content === undefined) continue
    const { meta } = parseSkill(content)
    const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : entry.name
    if (!index.has(name)) index.set(name, full)
  }
  return index
}

/**
 * What this provider stores in `locator` and reads back in `get`. The registry
 * treats it as opaque, so the shape belongs to this module.
 */
interface SkillLocator {
  /** Catalog the skill belongs to. */
  mode: string
  /** Absolute skill directory. */
  dir: string
  /** Absolute SKILL.md path. */
  file: string
  /** Skill name. */
  name: string
  /** Description found at discovery time. */
  description: string
}

/** Frontmatter keys `parseSkill` returns. */
type SkillMeta = Record<string, string>

/** Parsed skill file. */
interface ParsedSkill {
  /** Flat frontmatter keys. */
  meta: SkillMeta
  /** Markdown body after the fence. */
  body: string
}

/**
 * Parse the YAML-ish frontmatter of a SKILL.md file.
 *
 * Only the flat `key: value` shape skills use is supported, which is all the
 * registry consumes for routing.
 * @param text - complete file contents.
 * @returns parsed keys plus the Markdown body that follows the fence.
 */
function parseSkill(text: string): ParsedSkill {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { meta: {}, body: text }
  const meta: SkillMeta = {}
  let index = 1
  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '---') { index += 1; break }
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[match[1]] = value
  }
  return { meta, body: lines.slice(index).join('\n').replace(/^\s+/, '') }
}

/**
 * Read one skill directory into a registry candidate.
 * @param mode - catalog the skill belongs to.
 * @param provider - provider label reported on every entry.
 * @param dir - absolute skill directory.
 * @returns the candidate, or undefined when the directory holds no usable SKILL.md.
 */
function readCandidate(mode: string, provider: string, dir: string): DshSkillCandidate | undefined {
  const file = join(dir, 'SKILL.md')
  const folder = dir.split(/[\\/]/u).pop() ?? ''
  let text: string
  try {
    if (!statSync(file).isFile()) return undefined
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const { meta } = parseSkill(text)
  const skillName = typeof meta.name === 'string' && meta.name !== '' ? meta.name : folder
  const description = typeof meta.description === 'string' ? meta.description : ''
  return {
    path: file,
    name: skillName,
    description,
    ...(typeof meta.whenToUse === 'string' ? { whenToUse: meta.whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider,
    resourceBase: { kind: 'directory', path: dir },
    rank: RANK,
    locator: { mode, dir, file, name: skillName, description },
  }
}

/**
 * Turn one candidate into the full definition the registry serves.
 * @param candidate - entry previously returned by this provider.
 * @returns the definition, or undefined when the body disappeared.
 */
function readDefinition(candidate: DshSkillCandidate): DshSkillDefinition | undefined {
  // The registry treats the locator as opaque and hands back what `list` built.
  const locator = candidate.locator as SkillLocator
  let text: string
  try {
    text = readFileSync(locator.file, 'utf8')
  } catch {
    return undefined
  }
  const { meta, body } = parseSkill(text)
  return {
    path: locator.file,
    name: locator.name,
    description: typeof meta.description === 'string' ? meta.description : locator.description,
    ...(typeof meta.whenToUse === 'string' ? { whenToUse: meta.whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: candidate.provider,
    resourceBase: { kind: 'directory', path: locator.dir },
    content: body,
    metadata: { mode: locator.mode },
  }
}

/**
 * Register the catalog of one mode on the skill registry.
 * @param ctx - the plugin context (services: skills).
 * @param config - the preset row's `config`.
 */
export function apply(ctx: DshContext, config: { mode?: unknown } = {}): void {
  const mode = typeof config?.mode === 'string' ? config.mode : ''
  const catalog = readCatalog()
  const available = Object.keys(catalog.modes)
  const modes = mode === ALL
    ? available
    : mode === FORMS
      ? ['longform', 'shortform', 'screenplay'].filter(entry => catalog.modes[entry] !== undefined)
      : [mode]
  if (modes.length === 0 || modes.some(entry => catalog.modes[entry] === undefined)) {
    ctx.logger?.warn?.(`storycraft-skills: unknown mode "${String(mode)}"; serving no skills`)
    return
  }
  const provider = `storycraft-${mode}`
  const names = [...new Set(modes.flatMap(entry => catalog.modes[entry] ?? []))]
  const index = skillIndex()

  const list = async (): Promise<DshSkillCandidate[]> => {
    const candidates: DshSkillCandidate[] = []
    for (const name of names) {
      const dir = index.get(name)
      if (dir === undefined) continue
      const candidate = readCandidate(mode, provider, dir)
      if (candidate !== undefined) candidates.push(candidate)
    }
    return candidates
  }

  const get = async (candidate: DshSkillCandidate): Promise<DshSkillDefinition | undefined> => {
    if (candidate === null || typeof candidate !== 'object') return undefined
    return readDefinition(candidate)
  }

  const dispose = ctx.skills.registerProvider(() => ({ name: provider, list, get }))
  ctx.effect(() => () => { dispose() })
}


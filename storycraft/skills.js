/**
 * Skill provider for the Storycraft studio preset.
 *
 * The module mounts with `config.mode`: a single catalog, or `all` for the
 * storycraft work mode, which serves every form and every role craft. The
 * work's own form and the assigned role decide which body the model reads. The
 * bodies and their helper scripts ship beside this file under
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

/** Directory this module lives in, the root every mode is resolved against. */
const HERE = dirname(fileURLToPath(import.meta.url))

/** Modes a preset may mount, each mapped to its catalog directory. */
const MODES = {
  shared: '通用',
  longform: '长篇小说',
  shortform: '短篇小说',
  screenplay: '短剧剧本',
  review: '审稿',
  write: '写作',
  revise: '修订',
  plan: '规划',
}

/** Catalogs the single work mode serves: every form and every role craft. */
const STUDIO_MODES = ['shared', 'longform', 'shortform', 'screenplay', 'review', 'write', 'revise', 'plan']

/** Catalogs a worker role serves: the craft docs of every form, without the studio method. */
const FORM_MODES = ['longform', 'shortform', 'screenplay']

/** A mode that serves every form and every role catalog: the work mode mounts this. */
const ALL = 'all'

/** Discovery rank; lower wins a name collision, and a preset-local catalog is authoritative. */
const RANK = 100

/**
 * Parse the YAML-ish frontmatter of a SKILL.md file.
 *
 * Only the flat `key: value` shape skills use is supported, which is all the
 * registry consumes for routing.
 * @param text - complete file contents.
 * @returns parsed keys plus the Markdown body that follows the fence.
 */
function parseSkill(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { meta: {}, body: text }
  const meta = {}
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
 * @param skillDir - absolute skill directory.
 * @param entry - directory name inside the catalog.
 * @returns the candidate, or undefined when the directory holds no usable SKILL.md.
 */
function readCandidate(mode, provider, skillDir, entry) {
  const file = join(skillDir, entry, 'SKILL.md')
  let text
  try {
    if (!statSync(file).isFile()) return undefined
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const { meta } = parseSkill(text)
  const skillName = typeof meta.name === 'string' && meta.name !== '' ? meta.name : entry
  const description = typeof meta.description === 'string' ? meta.description : ''
  return {
    path: file,
    name: skillName,
    description,
    ...(typeof meta.whenToUse === 'string' ? { whenToUse: meta.whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider,
    resourceBase: { kind: 'directory', path: join(skillDir, entry) },
    rank: RANK,
    locator: { mode, dir: join(skillDir, entry), file, name: skillName, description },
  }
}

/**
 * Turn one candidate into the full definition the registry serves.
 * @param candidate - entry previously returned by this provider.
 * @returns the definition, or undefined when the body disappeared.
 */
function readDefinition(candidate) {
  const locator = candidate.locator
  let text
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
export function apply(ctx, config = {}) {
  const mode = typeof config?.mode === 'string' ? config.mode : ''
  const modes = mode === ALL ? STUDIO_MODES : mode === 'forms' ? FORM_MODES : [mode]
  if (modes.some(name => !Object.prototype.hasOwnProperty.call(MODES, name))) {
    ctx.logger?.warn?.(`storycraft-skills: unknown mode "${String(mode)}"; serving no skills`)
    return
  }
  const provider = `storycraft-${mode}`

  const list = async () => {
    const candidates = []
    for (const name of modes) {
      const catalogDir = join(HERE, 'skills', name)
      let entries
      try {
        entries = readdirSync(catalogDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = readCandidate(name, provider, catalogDir, entry.name)
        if (candidate !== undefined) candidates.push(candidate)
      }
    }
    return candidates
  }

  const get = async (candidate) => {
    if (candidate === null || typeof candidate !== 'object') return undefined
    return readDefinition(candidate)
  }

  const dispose = ctx.skills.registerProvider(() => ({ name: provider, list, get }))
  ctx.effect(() => () => { dispose() })
}

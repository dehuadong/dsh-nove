/**
 * Check the skill directory against the project's skill authoring rules.
 *
 * Rules (from the skill authoring standard):
 * - `skills/<skill-name>/`, kebab-case, one folder per skill, no category dirs;
 * - `SKILL.md` with front matter `name` (equal to the folder) and `description`
 *   (what it does, when it triggers, and the read/write boundary);
 * - the main file holds the decision flow only; detail belongs in `references/`.
 *
 * Run from `storycraft/`; exits non-zero with one line per violation.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const skillsRoot = join(root, 'skills')
const MAX_MAIN_BYTES = 6100
const MAX_DESCRIPTION = 400

const failures = []
const fail = (message) => failures.push(message)

/** Parse the flat front matter the skills use. */
function parseFrontMatter(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined
  const meta = {}
  let index = 1
  for (; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return { meta }
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[index])
    if (match === null) continue
    meta[match[1]] = match[2].trim()
  }
  return undefined
}

const entries = readdirSync(skillsRoot, { withFileTypes: true })
const skillDirs = entries.filter(entry => entry.isDirectory())

for (const entry of entries) {
  if (!entry.isDirectory() && entry.name !== 'catalog.json') {
    fail(`skills/: unexpected file ${entry.name}`)
  }
  if (entry.isDirectory() && !/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(entry.name)) {
    fail(`skills/${entry.name}: folder name is not kebab-case`)
  }
}

for (const entry of skillDirs) {
  const dir = join(skillsRoot, entry.name)
  const file = join(dir, 'SKILL.md')
  if (!statSync(dir).isDirectory()) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    fail(`skills/${entry.name}: missing SKILL.md`)
    continue
  }
  const parsed = parseFrontMatter(text)
  if (parsed === undefined) {
    fail(`skills/${entry.name}: SKILL.md has no front matter`)
    continue
  }
  const keys = Object.keys(parsed.meta)
  for (const key of keys) {
    if (key !== 'name' && key !== 'description') {
      fail(`skills/${entry.name}: front matter may only carry name and description (found ${key})`)
    }
  }
  if (parsed.meta.name !== entry.name) {
    fail(`skills/${entry.name}: name "${parsed.meta.name ?? ''}" does not match the folder`)
  }
  const description = parsed.meta.description ?? ''
  if (description.length < 20) fail(`skills/${entry.name}: description is too short`)
  if (description.length > MAX_DESCRIPTION) fail(`skills/${entry.name}: description exceeds ${MAX_DESCRIPTION} characters`)
  if (!description.includes('触发：')) fail(`skills/${entry.name}: description does not state the trigger (触发：…)`)
  if (!/只读|只出方法|只给判断|写事件|不直接改文件/u.test(description)) {
    fail(`skills/${entry.name}: description does not state the read/write boundary`)
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_MAIN_BYTES) {
    fail(`skills/${entry.name}: SKILL.md is ${bytes} bytes; move detail into references/ (limit ${MAX_MAIN_BYTES})`)
  }
  for (const nested of readdirSync(dir, { withFileTypes: true })) {
    if (nested.isDirectory() && !['references', 'scripts', 'examples'].includes(nested.name)) {
      fail(`skills/${entry.name}: unexpected directory ${nested.name}/`)
    }
  }
}

// Catalog: every listed name exists, every skill is listed at least once.
const catalogFile = join(skillsRoot, 'catalog.json')
let catalog
try {
  catalog = JSON.parse(readFileSync(catalogFile, 'utf8'))
} catch (error) {
  fail(`skills/catalog.json: unreadable (${error.message})`)
}
if (catalog !== undefined) {
  const names = new Set(skillDirs.map(entry => entry.name))
  const listed = new Set()
  for (const [mode, list] of Object.entries(catalog.modes ?? {})) {
    if (!Array.isArray(list)) {
      fail(`skills/catalog.json: mode ${mode} is not an array`)
      continue
    }
    for (const name of list) {
      listed.add(name)
      if (!names.has(name)) fail(`skills/catalog.json: mode ${mode} lists unknown skill ${name}`)
    }
  }
  for (const entry of skillDirs) {
    if (!listed.has(entry.name)) fail(`skills/catalog.json: ${entry.name} is not in any mode`)
  }
}

// Every storycraft-* name mentioned in a skill must exist as a skill directory.
{
  const known = new Set(skillDirs.map(entry => entry.name))
  for (const entry of skillDirs) {
    let text = ''
    try {
      text = readFileSync(join(skillsRoot, entry.name, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/storycraft-[a-z0-9-]+/gu)) {
      const name = match[0]
      if (!known.has(name)) fail(`skills/${entry.name}: mentions missing skill ${name}`)
    }
  }
}

if (failures.length > 0) {
  console.error('[skills] FAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`[skills] PASS: ${skillDirs.length} skills, flat layout, front matter and catalog consistent`)

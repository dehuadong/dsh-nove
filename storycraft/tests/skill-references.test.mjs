// Stage skills own one node each: a stage skill must not name another stage's
// skill, and every reference must sit inside the stage skill that loads it.
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { roleMethod } from '../src/skill-routing.ts'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const skills = join(root, 'skills')

const STAGES = {
  'storycraft-long-outline': ['outline-design.md'],
  'storycraft-long-plan': ['chapter-plan.md', 'chapter-plan-examples.md'],
  'storycraft-long-prose': ['reader-contract-and-progression.md', 'scene-dialogue-and-length-budget.md'],
  'storycraft-long-settle': ['state-projection.md'],
  'storycraft-short-outline': ['outline.md'],
  'storycraft-short-prose': ['production-checklist.md'],
  'storycraft-script-spec': ['spec.md'],
  'storycraft-script-scene': ['episode-scene-craft.md'],
}

for (const [skill, references] of Object.entries(STAGES)) {
  const text = await readFile(join(skills, skill, 'SKILL.md'), 'utf8')
  check(`${skill} keeps its name`, new RegExp(`^name:\\s*${skill}$`, 'm').test(text))
  check(`${skill} stays an index`, text.split(/\r?\n/u).length <= 40, `${text.split(/\r?\n/u).length} lines`)
  for (const reference of references) {
    const file = join(skills, skill, 'references', reference)
    let content = ''
    let present = false
    try {
      present = (await stat(file)).isFile()
      content = await readFile(file, 'utf8')
    } catch {
      present = false
    }
    check(`${skill} has references/${reference}`, present && content.startsWith('# '))
  }
  const others = Object.keys(STAGES).filter(name => name !== skill)
  check(`${skill} names no other stage skill`, others.every(name => !text.includes(name)), others.filter(name => text.includes(name)).join(','))
}

// Every reference file is listed in exactly one top-level resource section.
const expectedMust = {
  'storycraft-architect': 'references/foundation-design.md',
  'storycraft-long-outline': 'references/outline-design.md',
  'storycraft-long-plan': roleMethod('planner', 'longform')?.reference,
  'storycraft-long-prose': roleMethod('writer', 'longform')?.reference,
  'storycraft-long-settle': 'references/state-projection.md',
  'storycraft-short-outline': 'references/outline.md',
  'storycraft-short-prose': 'references/production-checklist.md',
  'storycraft-script-spec': 'references/spec.md',
  'storycraft-script-scene': 'references/episode-scene-craft.md',
  'storycraft-review': roleMethod('reviewer', 'longform')?.reference,
}
const directories = (await readdir(skills, { withFileTypes: true })).filter(entry => entry.isDirectory())
for (const entry of directories) {
  let referenceFiles = []
  try {
    referenceFiles = (await readdir(join(skills, entry.name, 'references'))).filter(name => name.endsWith('.md'))
  } catch {
    continue
  }
  const text = await readFile(join(skills, entry.name, 'SKILL.md'), 'utf8')
  const sections = text.match(/^## 资源\s*$/gmu) ?? []
  check(`${entry.name} has one resource section`, sections.length === 1, `${sections.length}`)
  const allLines = text.split(/\r?\n/u)
  const start = allLines.findIndex(line => /^## 资源\s*$/u.test(line))
  const lines = start === -1 ? [] : allLines.slice(start + 1, allLines.findIndex((line, index) => index > start && /^## /u.test(line)) === -1 ? undefined : allLines.findIndex((line, index) => index > start && /^## /u.test(line)))
  const listed = []
  const must = []
  for (const line of lines) {
    const found = /^-\s+(必读|按需)(?:（[^）]*）)?：`(.*)`$/u.exec(line.trim())
    if (found === null) continue
    const path = found[2].replaceAll('`', '')
    listed.push(path)
    if (found[1] === '必读') must.push(path)
    const file = path.startsWith('../') ? join(skills, entry.name, path) : join(skills, entry.name, path)
    let present = false
    try { present = (await stat(file)).isFile() } catch { present = false }
    check(`${entry.name} resource exists: ${path}`, present)
  }
  check(`${entry.name} lists every reference`, referenceFiles.every(file => listed.some(row => row.endsWith(`/${file}`) || row === `references/${file}`)), `${listed.join(',')} / ${referenceFiles.join(',')}`)
  check(`${entry.name} has at most one must-read`, must.length <= 1, must.join(','))
  if (expectedMust[entry.name] !== undefined) {
    check(`${entry.name} names the expected must-read`, must.length === 1 && must[0] === expectedMust[entry.name], must.join(','))
  } else {
    check(`${entry.name} has no unconditional must-read`, must.length === 0, must.join(','))
  }
  const usage = allLines.findIndex(line => /^## 用法\s*$/u.test(line))
  if (usage !== -1) check(`${entry.name} resource section precedes usage`, start < usage, `${start}/${usage}`)

  for (const line of allLines) {
    for (const segment of line.split(/[；。]/u)) {
      const paths = [...segment.matchAll(/`([^`]*references\/[^`]+\.md)`/gu)].map(match => match[1])
      if (paths.length === 0) continue
      const named = [...segment.matchAll(/`(storycraft-[a-z-]+)`/gu)].map(match => match[1])
      for (const path of paths) {
        const file = path.startsWith('../') || named.length !== 1
          ? join(skills, entry.name, path)
          : join(skills, named[0], path)
        let present = false
        try { present = (await stat(file)).isFile() } catch { present = false }
        check(`${entry.name} body path resolves: ${path}`, present)
      }
    }
  }
}

// The work-mode skill routes with fields the host fills, not with its own table.
const orchestration = await readFile(join(skills, 'storycraft-long-director', 'SKILL.md'), 'utf8')
check('orchestration defers material and method to story_next', orchestration.includes('story_next') && orchestration.includes('ask'))
check('the director routes to stage skills, never to reference files',
  orchestration.includes('storycraft-long-plan') && orchestration.includes('storycraft-long-prose')
  && !orchestration.includes('references/foundation-design.md'))

// Role skills stay thin.
const review = await readFile(join(skills, 'storycraft-review', 'SKILL.md'), 'utf8')
check('review names its dimensions reference', review.includes('references/review-dimensions.md'))
const revise = await readFile(join(skills, 'storycraft-revise-craft', 'SKILL.md'), 'utf8')
check('reviser names its deslop reference', revise.includes('references/deslop.md'))

// No stray reference outside a skill directory.
const entries = await readdir(skills, { withFileTypes: true })
check('every entry is a skill directory or the catalog', entries.every(entry => entry.isDirectory() || entry.name === 'catalog.json'))

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')

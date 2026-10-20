// Composition guards for the Storycraft bundle patch.
//
// The patch declares one work mode. Its plugin list is the shipped standard
// list plus Storycraft's own rows, so a DSH upgrade that changes the standard
// composition must be mirrored here; these checks fail when the copy drifts.
// The persona templates are rendered by the host prompt registry, which
// resolves `{{…}}` groups strictly and only knows its own registered variables.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')

/** Variables the host prompt registry registers for persona sections. */
const REGISTERED_VARIABLES = new Set(['provider', 'model'])

const variables = [...patch.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map(match => match[1])
const unknown = variables.filter(name => !REGISTERED_VARIABLES.has(name))
check('persona templates use no unregistered prompt variable', unknown.length === 0, unknown.join(', '))

const presetRows = [...patch.matchAll(/name: '@deepseek-ai\/dsh-agent-preset'/g)].length
check('one preset declaration (the work mode)', presetRows === 1, String(presetRows))
check('the studio preset id is `storycraft`', /^\s{8}id: storycraft$/m.test(patch))
check('the preset is named 故事工坊', patch.includes('name: 故事工坊'))
check('no role preset survives', !/storycraft-(planner|writer|reviser|reviewer)/.test(patch))
check('no private delegation action survives', !/story_(review|write|revise|plan|outline)_agent|story_agent_probe/.test(patch))

const toolsRow = patch.indexOf("name: 'dsh-storycraft/tools'")
check('the action row is mounted once', toolsRow > 0 && patch.indexOf("name: 'dsh-storycraft/tools'", toolsRow + 1) === -1)
check('the skill row serves every form', /mode: all/.test(patch))
check('the delegation tool is the official spawn tool', /provider: spawn\s*\n\s*toolName: subagent\s*\n\s*maxDepth: 1/.test(patch))
check('delegation never selects a child preset', !/agentPreset:/.test(patch))
check('fork delegation is not mounted', !/tool-subagent-fork/.test(patch))
check('over-cap glob sampling is explicit', /name: '@deepseek-ai\/dsh-tool-fs-search'\s*\n\s*config:\s*\n\s*sampleOverCapGlobResults: false/.test(patch))

// Every row of the shipped standard composition must appear here, in order and
// with the same config, except the rows this mode intentionally changes. A DSH
// upgrade that renames a plugin, adds a required config field, or reorders the
// standard list therefore fails this check instead of silently breaking mount.
const rowBlocks = (text) => {
  const lines = text.split('\n')
  const plugins = lines.findIndex(line => /^\s*plugins:\s*$/.test(line))
  if (plugins === -1) return []
  const first = lines.slice(plugins + 1).find(line => /^\s+- id: \S+$/.test(line))
  if (first === undefined) return []
  const indent = /^(\s+)- id:/.exec(first)[1]
  const start = new RegExp(`^${indent}- id: (\\S+)$`)
  const starts = []
  for (let index = plugins + 1; index < lines.length; index += 1) {
    if (start.test(lines[index])) starts.push(index)
  }
  return starts.map((index, position) => {
    const end = position + 1 < starts.length ? starts[position + 1] : lines.length
    return {
      id: start.exec(lines[index])[1],
      body: lines.slice(index, end)
        .filter(line => line.trim() !== '' && !line.trim().startsWith('#'))
        .map(line => line.slice(indent.length))
        .join('\n')
        .trim(),
    }
  })
}
const patchBlocks = rowBlocks(patch)
check('the patch names its top-level rows', patchBlocks.length > 0)

const STANDARD = join(root, '..', 'deepseek-harness', 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')
const standard = await readFile(STANDARD, 'utf8').catch(() => undefined)
if (standard === undefined) {
  console.log('skip standard baseline (DSH checkout not present)')
} else {
  const standardBlocks = rowBlocks(standard)
  const expectedOrder = standardBlocks.map(row => row.id)
    .filter(id => id !== 'tool-subagent-fork')
    .concat(['storycraft-skills', 'storycraft-tools'])
  check('the preset copies every standard row in order',
    patchBlocks.map(row => row.id).join(',') === expectedOrder.join(','),
    `expected ${expectedOrder.join(',')}; got ${patchBlocks.map(row => row.id).join(',')}`)

  // persona text is the only intentional row-level difference. Inside the
  // delegation group the child `tool-subagent` config changes and the fork row
  // is dropped; the rest of that group must still match.
  const withoutNestedRow = (body, id) => {
    const lines = body.split('\n')
    const start = lines.findIndex(line => line === `    - id: ${id}`)
    if (start === -1) return body
    let end = start + 1
    while (end < lines.length && !/^ {4}- id: /.test(lines[end])) end += 1
    return [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim()
  }
  const normalize = body => withoutNestedRow(withoutNestedRow(body, 'tool-subagent'), 'tool-subagent-fork')
  const mismatched = standardBlocks
    .filter(row => row.id !== 'persona' && row.id !== 'tool-ask-user')
    .filter(row => {
      const own = patchBlocks.find(candidate => candidate.id === row.id)
      return own === undefined || normalize(own.body) !== normalize(row.body)
    })
    .map(row => row.id)
  check('storycraft disables ask_user_question', patchBlocks.find(row => row.id === 'tool-ask-user')?.body.includes('disabled: true'))
  check('every inherited row keeps the standard config', mismatched.length === 0, mismatched.join(','))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

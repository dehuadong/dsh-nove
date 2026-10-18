// Composition guards for the Storycraft bundle patch.
//
// The persona suffix/prefix templates are rendered by the host prompt registry,
// which resolves `{{…}}` groups strictly and only knows its own registered
// variables. A stray `{{cwd}}` therefore fails every turn of that preset with
// "unknown prompt variable" — the preset itself still mounts, so the failure
// shows up only in the conversation. These checks keep the patch honest.

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
check('five preset declarations (studio + planner + writer + reviser + reviewer)', presetRows === 5, String(presetRows))

check('the studio preset id is `storycraft`', /^\s{8}id: storycraft$/m.test(patch))
check('the preset is named 故事工坊', patch.includes('name: 故事工坊'))

// The reviewer is the only read-only preset: no write/edit tools, no shell, no actions.
const reviewer = patch.slice(patch.indexOf('id: storycraft-reviewer'))
check('the reviewer preset exists', reviewer.length > 0)
check('the reviewer cannot write files', /write: false/.test(reviewer) && /edit: false/.test(reviewer))
check('the reviewer has no shell', !/dsh-tool-pwsh|dsh-tool-bash/.test(reviewer))
check('the reviewer has no storycraft actions', !/dsh-storycraft\/tools/.test(reviewer))
check('no form-specific preset survives', !/storycraft-(longform|shortform|screenplay)/.test(patch))

const toolsRow = patch.indexOf("name: 'dsh-storycraft/tools'")
check('the action row is mounted once', toolsRow > 0 && patch.indexOf("name: 'dsh-storycraft/tools'", toolsRow + 1) === -1)

const skillsRows = [...patch.matchAll(/name: 'dsh-storycraft\/skills'/g)].length
check('one skill row per role', skillsRows === 5, String(skillsRows))
check('the studio row serves every form', /mode: all/.test(patch))
check('the reviewer row serves the review catalog', /mode: review/.test(patch))
check('the writer row serves the writing catalog', /mode: write/.test(patch))
check('the reviser row serves the revise catalog', /mode: revise/.test(patch))
check('the planner row serves the plan catalog', /mode: plan/.test(patch))

const planner = patch.slice(patch.indexOf('id: storycraft-planner'), patch.indexOf('id: preset-storycraft-writer'))
check('the planner preset exists', planner.length > 0)
check('the planner cannot write files', /write: false/.test(planner) && /edit: false/.test(planner))
check('the planner has no shell', !/dsh-tool-pwsh|dsh-tool-bash/.test(planner))
check('the planner has no storycraft actions', !/dsh-storycraft\/tools/.test(planner))

const reviser = patch.slice(patch.indexOf('id: storycraft-reviser'), patch.indexOf('id: preset-storycraft-reviewer'))
check('the reviser preset exists', reviser.length > 0)
check('the reviser cannot write files', /write: false/.test(reviser) && /edit: false/.test(reviser))
check('the reviser has no shell', !/dsh-tool-pwsh|dsh-tool-bash/.test(reviser))
check('the reviser has no storycraft actions', !/dsh-storycraft\/tools/.test(reviser))

const writer = patch.slice(patch.indexOf('id: storycraft-writer'), patch.indexOf('id: preset-storycraft-reviewer'))
check('the writer preset exists', writer.length > 0)
check('the writer cannot write files', /write: false/.test(writer) && /edit: false/.test(writer))
check('the writer has no shell', !/dsh-tool-pwsh|dsh-tool-bash/.test(writer))
check('the writer has no storycraft actions', !/dsh-storycraft\/tools/.test(writer))

const personaForms = ['长篇小说', '短篇小说', '短剧剧本'].filter(form => patch.includes(`你是${form}`))
check('the persona is not written for one form', personaForms.length === 0, personaForms.join(','))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

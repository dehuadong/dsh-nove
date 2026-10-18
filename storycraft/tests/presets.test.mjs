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
check('two preset declarations (studio + reviewer)', presetRows === 2, String(presetRows))

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
check('the skill row is mounted once', skillsRows === 1, String(skillsRows))
check('the skill row serves every form', /mode: all/.test(patch))

const personaForms = ['长篇小说', '短篇小说', '短剧剧本'].filter(form => patch.includes(`你是${form}`))
check('the persona is not written for one form', personaForms.length === 0, personaForms.join(','))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

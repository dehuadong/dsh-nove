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
check('three preset declarations', presetRows === 3, String(presetRows))

const longform = patch.indexOf("id: storycraft-longform")
const shortform = patch.indexOf("id: storycraft-shortform")
const screenplay = patch.indexOf("id: storycraft-screenplay")
check('three preset ids present', longform > 0 && shortform > 0 && screenplay > 0)

const toolsRow = patch.indexOf("name: 'dsh-storycraft/tools'")
check('the action row is mounted once', toolsRow > 0 && patch.indexOf("name: 'dsh-storycraft/tools'", toolsRow + 1) === -1)
check('only the long-form preset mounts the action row', toolsRow > longform && toolsRow < shortform)

const skillsRows = [...patch.matchAll(/name: 'dsh-storycraft\/skills'/g)].length
check('every preset mounts its skill row', skillsRows === 3, String(skillsRows))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

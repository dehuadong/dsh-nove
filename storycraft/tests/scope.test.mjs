// Workspace scope guard: path matrix, search defaults, shell mentions, DB root.
import { SCOPE_MESSAGES, scopeDenial } from '../scope.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const cwd = 'E:\\repo'
const worksRoot = 'E:\\repo\\works'
const dbRoot = 'E:\\repo\\.storycraft'
const base = { cwd, worksRoot, dbRoot }

const cases = [
  ['read current work allowed', { tool: 'read', arguments: { file_path: 'works/大朔营造/chapters/ch-0007.md' }, currentWork: '大朔营造' }, undefined],
  ['read other work denied', { tool: 'read', arguments: { file_path: 'works/别的书/chapters/ch-0001.md' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['read works without current work denied', { tool: 'read', arguments: { file_path: 'works/大朔营造/chapters/ch-0007.md' } }, SCOPE_MESSAGES.discussion],
  ['absolute other work denied', { tool: 'read', arguments: { file_path: 'E:\\repo\\works\\别的书\\chapters\\ch-0001.md' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['parent traversal from docs into works denied', { tool: 'read', arguments: { file_path: '../works/别的书/chapters/ch-0001.md' }, cwd: 'E:\\repo\\docs', currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['parent traversal from docs into current work allowed', { tool: 'read', arguments: { file_path: '../works/大朔营造/chapters/ch-0001.md' }, cwd: 'E:\\repo\\docs', currentWork: '大朔营造' }, undefined],
  ['project file allowed', { tool: 'read', arguments: { file_path: 'AGENTS.md' } }, undefined],
  ['project file allowed with work', { tool: 'read', arguments: { file_path: 'storycraft/tools.js' }, currentWork: '大朔营造' }, undefined],
  ['db file always denied', { tool: 'read', arguments: { file_path: '.storycraft/works.db' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.database],
  ['db wal denied', { tool: 'read', arguments: { file_path: '.storycraft/works.db-wal' } }, SCOPE_MESSAGES.database],
  ['read_image db denied', { tool: 'read_image', arguments: { file_path: 'E:\\repo\\.storycraft\\works.db-shm' } }, SCOPE_MESSAGES.database],
  ['edit other work denied', { tool: 'edit', arguments: { file_path: 'works/别的书/chapters/ch-0001.md' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['write current work allowed', { tool: 'write', arguments: { file_path: 'works/大朔营造/chapters/ch-0008.md' }, currentWork: '大朔营造' }, undefined],
  ['glob without path denied', { tool: 'glob', arguments: { pattern: '**/*.md' } }, SCOPE_MESSAGES.search],
  ['glob project path allowed', { tool: 'glob', arguments: { pattern: '**/*.md', path: 'docs' } }, undefined],
  ['glob works path respects current work', { tool: 'glob', arguments: { pattern: '**/*.md', path: 'works/别的书' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['grep without path denied', { tool: 'grep', arguments: { pattern: '井' } }, SCOPE_MESSAGES.search],
  ['grep project path allowed', { tool: 'grep', arguments: { pattern: '井', path: 'storycraft' } }, undefined],
  ['grep include stays under project', { tool: 'grep', arguments: { pattern: '井', path: 'docs', include: '*.md' } }, undefined],
  ['pwsh workdir other work denied', { tool: 'pwsh', arguments: { command: 'Get-Content x', workdir: 'works/别的书' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['pwsh command works other denied', { tool: 'pwsh', arguments: { command: 'Get-Content works/别的书/chapters/ch-0001.md' }, currentWork: '大朔营造' }, SCOPE_MESSAGES.otherWork],
  ['pwsh command works current allowed', { tool: 'bash', arguments: { command: 'cat works/大朔营造/chapters/ch-0001.md' }, currentWork: '大朔营造' }, undefined],
  ['pwsh database denied', { tool: 'pwsh', arguments: { command: 'sqlite3 .storycraft/works.db' } }, SCOPE_MESSAGES.database],
  ['pwsh workspace word allowed', { tool: 'pwsh', arguments: { command: 'node packages/workspace/bin.js' }, currentWork: '大朔营造' }, undefined],
  ['working_directory project allowed', { tool: 'working_directory', arguments: { cd: 'docs' } }, undefined],
  ['working_directory works denied', { tool: 'working_directory', arguments: { cd: 'works' } }, SCOPE_MESSAGES.cd],
  ['working_directory db denied', { tool: 'working_directory', arguments: { cd: '.storycraft' } }, SCOPE_MESSAGES.cd],
  ['unknown tool allowed', { tool: 'todo_write', arguments: {} }, undefined],
  ['missing cwd denies conservatively', { tool: 'read', arguments: { file_path: 'AGENTS.md' }, cwd: '' }, SCOPE_MESSAGES.discussion],
]

for (const [name, input, expected] of cases) {
  const actual = scopeDenial({ ...base, ...input })
  check(name, actual === expected, JSON.stringify(actual))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

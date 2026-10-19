// Workspace scope guard: path matrix, search defaults, shell mentions, DB root.
import { join, resolve } from 'node:path'
import { scopeDenial } from '../scope.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else {
    failures += 1
    console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const base = resolve('repo')
const cwd = base
const docsCwd = join(base, 'docs')
const worksRoot = join(base, 'works')
const dbRoot = join(base, '.storycraft')
const current = '大朔营造'
const other = '别的书'
const roots = { cwd, worksRoot, dbRoot }

const discussion = '讨论阶段不读历史作品：请先在面板进入一部作品，或给 path 限定到项目目录。'
const otherWork = '只能访问当前作品：works/<其他作品> 不在当前会话的作用域内。'
const search = '检索默认会扫进 works/：请给 path 限定到项目目录或当前作品。'
const database = '不直接访问作品库：请通过故事工坊动作或导出读取。'
const cdDenied = '不进入作品目录：请用相对项目根的路径访问作品。'

const cases = [
  ['read current work allowed', { tool: 'read', arguments: { file_path: `works/${current}/chapters/ch-0007.md` }, currentWork: current }, undefined],
  ['read other work denied', { tool: 'read', arguments: { file_path: `works/${other}/chapters/ch-0001.md` }, currentWork: current }, otherWork],
  ['read works without current work denied', { tool: 'read', arguments: { file_path: `works/${current}/chapters/ch-0007.md` } }, discussion],
  ['absolute other work denied', { tool: 'read', arguments: { file_path: join(worksRoot, other, 'chapters', 'ch-0001.md') }, currentWork: current }, otherWork],
  ['parent traversal from docs into works denied', { tool: 'read', arguments: { file_path: '../works/别的书/chapters/ch-0001.md' }, cwd: docsCwd, currentWork: current }, otherWork],
  ['parent traversal from docs into current work allowed', { tool: 'read', arguments: { file_path: `../works/${current}/chapters/ch-0001.md` }, cwd: docsCwd, currentWork: current }, undefined],
  ['project file allowed', { tool: 'read', arguments: { file_path: 'AGENTS.md' } }, undefined],
  ['project file allowed with work', { tool: 'read', arguments: { file_path: 'storycraft/tools.js' }, currentWork: current }, undefined],
  ['db file always denied', { tool: 'read', arguments: { file_path: '.storycraft/works.db' }, currentWork: current }, database],
  ['db wal denied', { tool: 'read', arguments: { file_path: '.storycraft/works.db-wal' } }, database],
  ['read_image db denied', { tool: 'read_image', arguments: { file_path: join(dbRoot, 'works.db-shm') } }, database],
  ['edit other work denied', { tool: 'edit', arguments: { file_path: `works/${other}/chapters/ch-0001.md` }, currentWork: current }, otherWork],
  ['write current work allowed', { tool: 'write', arguments: { file_path: `works/${current}/chapters/ch-0008.md` }, currentWork: current }, undefined],
  ['glob without path denied', { tool: 'glob', arguments: { pattern: '**/*.md' } }, search],
  ['glob project path allowed', { tool: 'glob', arguments: { pattern: '**/*.md', path: 'docs' } }, undefined],
  ['glob works path respects current work', { tool: 'glob', arguments: { pattern: '**/*.md', path: `works/${other}` }, currentWork: current }, otherWork],
  ['grep without path denied', { tool: 'grep', arguments: { pattern: '井' } }, search],
  ['grep project path allowed', { tool: 'grep', arguments: { pattern: '井', path: 'storycraft' } }, undefined],
  ['grep include under project allowed', { tool: 'grep', arguments: { pattern: '井', path: 'docs', include: '*.md' } }, undefined],
  ['grep absolute include into works denied', { tool: 'grep', arguments: { pattern: '井', path: 'docs', include: join(worksRoot, other, 'x.md') }, currentWork: current }, otherWork],
  ['pwsh workdir other work denied', { tool: 'pwsh', arguments: { command: 'Get-Content x', workdir: `works/${other}` }, currentWork: current }, otherWork],
  ['pwsh command works other denied', { tool: 'pwsh', arguments: { command: `Get-Content works/${other}/chapters/ch-0001.md` }, currentWork: current }, otherWork],
  ['pwsh command works current allowed', { tool: 'bash', arguments: { command: `cat works/${current}/chapters/ch-0001.md` }, currentWork: current }, undefined],
  ['pwsh bare works listing denied', { tool: 'pwsh', arguments: { command: 'Get-ChildItem works' }, currentWork: current }, otherWork],
  ['pwsh trailing works denied', { tool: 'bash', arguments: { command: 'ls works/' }, currentWork: current }, otherWork],
  ['pwsh relative works denied', { tool: 'pwsh', arguments: { command: 'dir .\\works' }, currentWork: current }, otherWork],
  ['pwsh set-location works denied', { tool: 'pwsh', arguments: { command: 'Set-Location works; Get-Content x.md' }, currentWork: current }, otherWork],
  ['pwsh ./works other denied', { tool: 'bash', arguments: { command: `cat ./works/${other}/chapters/ch-0001.md` }, currentWork: current }, otherWork],
  ['pwsh database denied', { tool: 'pwsh', arguments: { command: 'sqlite3 .storycraft/works.db' } }, database],
  ['pwsh workspace word allowed', { tool: 'pwsh', arguments: { command: 'node packages/workspace/bin.js' }, currentWork: current }, undefined],
  ['working_directory project allowed', { tool: 'working_directory', arguments: { cd: 'docs' } }, undefined],
  ['working_directory works denied', { tool: 'working_directory', arguments: { cd: 'works' } }, cdDenied],
  ['working_directory db denied', { tool: 'working_directory', arguments: { cd: '.storycraft' } }, cdDenied],
  ['unknown tool allowed', { tool: 'todo_write', arguments: {} }, undefined],
  ['missing cwd denies conservatively', { tool: 'read', arguments: { file_path: 'AGENTS.md' }, cwd: '' }, discussion],
]

if (process.platform === 'win32') {
  cases.push(['case-insensitive works denied', { tool: 'read', arguments: { file_path: `Works/${other}/chapters/ch-0001.md` }, currentWork: current }, otherWork])
  cases.push(['case-insensitive db denied', { tool: 'read', arguments: { file_path: '.StoryCraft/works.db' } }, database])
  cases.push(['absolute windows works denied', { tool: 'pwsh', arguments: { command: `Get-Content ${worksRoot}\\${other}\\chapters\\ch-0001.md` }, currentWork: current }, otherWork])
}

for (const [name, input, expected] of cases) {
  const actual = scopeDenial({ ...roots, ...input })
  check(name, actual === expected, JSON.stringify(actual))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

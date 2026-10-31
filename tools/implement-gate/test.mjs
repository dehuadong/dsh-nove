// Pure checks for the implement gate; no Harness required.
import { classifyPath, gateCommand, shellAccess } from './classify.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`ok   ${name}`)
  else { failures += 1; console.log(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}

const userMessage = text => ({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

check('implement command accepted', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9 技能证据'), {})?.kind === 'implement')
check('implement command without skill accepted', gateCommand(userMessage('批准，使用implement 执行实现 A9'), {})?.kind === 'implement')
check('planning command accepted', gateCommand(userMessage('批准，使用技能 planning 执行规划 A9'), {})?.kind === 'planning')
check('quoted command is not authorization', gateCommand(userMessage('文档说：批准，使用技能 implement 执行实现 A9'), {}) === undefined)
check('question is not authorization', gateCommand(userMessage('是不是批准，使用技能 implement 执行实现 A9？'), {}) === undefined)
check('planning does not unlock implement', gateCommand(userMessage('批准，使用技能 planning 执行规划 A9'), {})?.kind !== 'implement')
check('principal caller is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'user', principal: 'other' } }, {}) === undefined)
check('subagent session is not owner', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { parentSession: 'p' }) === undefined)
check('subagent origin is not owner', gateCommand(userMessage('批准，使用技能 implement 执行实现 A9'), { origin: 'subagent' }) === undefined)
check('schedule source is not owner', gateCommand({ ...userMessage('批准，使用技能 implement 执行实现 A9'), source: { kind: 'schedule' } }, {}) === undefined)

const root = process.cwd()
check('source path needs authorization', classifyPath(root, 'storycraft/src/client.ts').docs === false)
check('note path is documentation', classifyPath(root, '.agents/notes/proposed/x.md').docs === true)
check('docs path is documentation', classifyPath(root, 'docs/agents/GATES.md').docs === true)
check('outside path is rejected', classifyPath(root, '../outside.txt').outside === true)

check('read command is allowed', shellAccess('git status', root).write === false)
check('write command is gated', shellAccess('Set-Content src\\x.ts -Value x', root).write === true)
check('docs trash is a docs operation', shellAccess('node scripts/trash.mjs .agents/notes/proposed/x.md', root).docsOnly === true)
check('source trash is not a docs operation', shellAccess('node scripts/trash.mjs storycraft/src/client.ts', root).docsOnly === false)
check('docs-only git add is a docs operation', shellAccess('git add .agents/notes docs', root).docsOnly === true)
check('source git add is gated', shellAccess('git add storycraft/src/client.ts', root).docsOnly === false)
check('git push does not write the tree', shellAccess('git push origin main', root).write === false)

if (failures > 0) { console.error(`\n${failures} CHECK(S) FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')

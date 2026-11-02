/**
 * Classifier cases. Run with `node tools/shell-guard/test.mjs`.
 *
 * The two that matter most are the shapes that actually happened: a recursive
 * delete of a user-level directory, and the same thing spelled through an
 * environment variable.
 */

import { homedir } from 'node:os'
import { classifyCommand, describeDenial } from './classify.js'

const root = 'E:\\dsh-nove'
const home = homedir()

const cases = [
  // Must stay allowed: ordinary work inside the workspace.
  ['allow', 'npm run build'],
  ['allow', 'Remove-Item -Recurse -Force .\\dist'],
  ['allow', 'Remove-Item .\\lib\\old.js'],
  ['allow', 'git clean -xfd'],
  ['allow', 'rm -rf dist'],
  ['allow', 'docker run --rm alpine true'],

  // Must be denied: the user-level wipe, and its spellings.
  ['deny', `Remove-Item -Recurse -Force ${home}\\.dsh`],
  ['deny', 'Remove-Item -Recurse -Force "$env:USERPROFILE\\.ssh"'],
  ['deny', 'rm -rf ~/.claude'],
  ['deny', 'del C:\\Windows\\Temp\\x.txt'],
  ['deny', 'Move-Item .\\a.txt C:\\Users\\MyPC\\a.txt'],
  ['deny', 'robocopy E:\\dsh-nove C:\\Users\\MyPC\\Backup /MIR'],
  ['deny', `Remove-Item -Recurse -Force ${home}\\.dsh-guard-probe`],

  // Must be denied: the target is not statically knowable.
  ['deny', 'Get-ChildItem | Remove-Item -Recurse'],
  ['deny', 'Remove-Item -Path $target -Recurse'],
  ['deny', 'rm -rf $HOME/*'],

  // Multi-statement regression: an unrelated quoted string must not count as a
  // target, and a destructive second statement must not hide behind the first.
  ['allow', 'node --check x.js; "exit=$LASTEXITCODE"'],
  ['deny', 'node --version\nRemove-Item -Recurse -Force "C:\\Users\\MyPC\\.ssh"'],
  ['deny', 'echo hi; Remove-Item -Recurse -Force "C:\\Users\\MyPC\\.dsh"'],

  // Read-only outside paths are allowed; write/create outside is not.
  ['allow', 'Test-Path C:\\Users\\MyPC\\.dsh'],
  ['allow', 'Get-ChildItem C:\\Users\\MyPC'],
  ['allow', 'git status'],
  ['deny', 'New-Item -ItemType Directory -Force C:\\Users\\MyPC\\_dsh-apicheck'],
  ['deny', 'Set-Content C:\\Users\\MyPC\\x.txt -Value hello'],
  ['deny', 'npm install --prefix C:\\Users\\MyPC\\_dsh-apicheck left-pad'],
  ['deny', 'git clone https://example.com/x.git C:\\Users\\MyPC\\repo'],
  ['deny', 'echo hello > C:\\Users\\MyPC\\x.txt'],

  // Here-string data is not executable; executable here-string is.
  ['allow', "@'\nunlinkSync('x')\n'@ | Set-Content .\\notes.md"],
  ['deny', "@'\nrm -rf C:\\Users\\MyPC\\_dsh-apicheck\n'@ | bash"],
  ['deny', 'node -e "require(\'fs\').unlinkSync(\'C:/Users/MyPC/x\')"'],
]

let failed = 0
for (const [expected, command] of cases) {
  const verdict = classifyCommand(command, { allowedRoots: [root], cwd: root })
  const actual = verdict.ok ? 'allow' : 'deny'
  if (actual !== expected) {
    failed += 1
    const reason = verdict.ok ? '(no reason)' : describeDenial(verdict, { allowedRoots: [root] })
    console.error(`FAIL expected=${expected} actual=${actual} :: ${command}\n      ${reason}`)
  } else {
    console.log(`ok   ${expected.padEnd(5)} ${command}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`)
  process.exitCode = 1
} else {
  console.log(`\nall ${cases.length} cases passed`)
}

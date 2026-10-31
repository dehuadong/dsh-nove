/**
 * Rebuild, pack, and install this plugin into the running Desktop profile.
 *
 * `node scripts/install-local.mjs`            build + pack; print the tarball
 * `node scripts/install-local.mjs --install`  also forward remove/add to the DSH CLI
 *
 * The Desktop profile is managed exclusively by the Electron application: the
 * CLI refuses it. For Desktop, this script packs and prints the tarball, then the
 * agent installs it through the plugin-manager tool (the only live-applying path).
 * Other profiles may use `--install`; the CLI still does not hot-apply them.
 */

import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNode } from './node-version.mjs'

assertNode('install-local')

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const packDir = path.join(root, '.tmp-pack')
const install = process.argv.includes('--install')
const packageName = 'see-storycraft'
const appExe = process.env.DSH_APP_EXE
  ?? 'C:\\Users\\MyPC\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
const appEntry = path.join(
  path.dirname(appExe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js',
)
const dshHome = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
const profile = process.env.DSH_PROFILE ?? 'desktop'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error !== undefined) throw new Error(`${command} 没有启动：${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 退出码 ${result.status}`)
}

function dsh(args) {
  run(appExe, [appEntry, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
}

function trash(target) {
  if (!existsSync(target)) return
  run(process.execPath, [path.join(root, 'scripts', 'trash.mjs'), target])
}

run(process.execPath, [path.join(root, 'scripts', 'build.mjs')])
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', packDir], { shell: process.platform === 'win32' })
const tarball = readdirSync(packDir)
  .filter(name => name.startsWith(`${packageName}-`) && name.endsWith('.tgz'))
  .map(name => path.join(packDir, name))
  .sort()
  .at(-1)
if (tarball === undefined) throw new Error('npm pack 没有生成 tarball')

if (!install) {
  console.log(`packed: ${tarball}`)
  process.exit(0)
}

if (profile === 'desktop') {
  console.log(`packed: ${tarball}`)
  console.log('desktop profile 由 Electron 应用独占管理，CLI 不能安装；请通过 plugin_manager 安装该 tarball。')
  process.exit(0)
}

if (!existsSync(appExe)) throw new Error(`找不到 DSH 应用：${appExe}`)
try { dsh(['plugin', '--profile', profile, 'remove', packageName]) }
catch { console.warn('remove skipped: package was not installed') }
dsh(['plugin', '--profile', profile, 'add', tarball])

const installed = path.join(dshHome, 'profiles', profile, 'node_modules', packageName)
if (!existsSync(path.join(installed, 'lib', 'tools.js'))) {
  throw new Error(`安装后没有找到 ${path.join(installed, 'lib', 'tools.js')}`)
}
console.log(`installed: ${installed}`)
console.log('CLI 安装不会热应用组合；重启 DSH 或由插件管理器重新应用后生效。')
trash(packDir)

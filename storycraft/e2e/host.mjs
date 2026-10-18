/**
 * Boot an isolated DSH web instance with this bundle loaded — the harness the
 * Playwright specs run against.
 *
 * A throwaway `DSH_HOME` under `.tmp-e2e/` keeps the developer's real profile,
 * sessions and works untouched. The profile is initialized by DSH itself
 * (`--profile web --dump-config`), then this bundle is copied in with no
 * `node_modules`, exactly like the `file:` install it ships with. A fixture
 * workspace is registered in the temp home's workspace storage so the page has
 * a real workspace to read; the fixture's `works/` tree is a copy of the
 * repository's sample work.
 *
 * Environment:
 *   DSH_E2E_PORT  listen port (default 3317).
 *   DSH_E2E_APP   desktop client executable (default: the installed app).
 */

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = path.resolve(projectRoot, '..')
const packageName = 'dsh-storycraft'

// What the host reads out of the package: its manifest lists the shipped files.
const ARTIFACTS = [
  ...(JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).files ?? []),
  'package.json',
]

const port = Number(process.env.DSH_E2E_PORT ?? String(33000 + Math.floor(Math.random() * 900)))
if (!Number.isInteger(port) || port <= 0) {
  console.error(`[e2e-host] DSH_E2E_PORT 不是合法端口：${JSON.stringify(process.env.DSH_E2E_PORT)}`)
  process.exit(1)
}

const tempRoot = path.join(projectRoot, '.tmp-e2e')
const home = path.join(tempRoot, 'home')
const runtimeFile = path.join(tempRoot, 'runtime.json')
const profileDir = path.join(home, 'profiles', 'web')
const profileManifest = path.join(profileDir, 'package.json')
const fixtureWorkspace = path.join(tempRoot, 'workspace')

const appExe = process.env.DSH_E2E_APP ?? 'C:\\Users\\MyPC\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
const appEntry = path.join(
  path.dirname(appExe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js',
)

const READY_TIMEOUT_MS = 180_000
const PRINTED_URL = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u

/** Child environment for anything that must see the temp profile tree. */
function dshEnv() {
  return { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' }
}

/** Fail with the tail of the child output, which carries the real reason. */
function fail(message, output = '') {
  console.error(`[e2e-host] ${message}`)
  if (output.trim() !== '') console.error(output.trim().split('\n').slice(-25).join('\n'))
  process.exit(1)
}

/**
 * Copy a file or a tree.
 *
 * Deliberately not `fs.cpSync`: on this Node build it fails the process with a
 * stack-buffer-overrun abort on this repository's fixture tree, which is the one
 * thing a test harness must never do.
 * @param {string} from - source path.
 * @param {string} to - destination path.
 */
function copyTree(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from)) copyTree(path.join(from, entry), path.join(to, entry))
    return
  }
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(from, to)
}

/**
 * Build the fixture through the same actions a session uses, so every number the
 * page shows is computed here and returned to the specs.
 * @returns {Promise<object>} facts the specs assert against.
 */
async function buildFixture() {
  const store = await import(pathToFileURL(path.join(projectRoot, 'storage.js')).href)
  const created = await store.initWork(fixtureWorkspace, { title: '示例短篇' })
  const work = created.workId
  await store.writePlan(fixtureWorkspace, {
    work, chapter: 1, perspective: '甲', goal: '救火', obstacle: '断电', cost: '时间', turn: '找到出口',
  })
  const first = '灰旗在风里翻了一夜。'.repeat(60)
  await store.writeChapter(fixtureWorkspace, { work, chapter: 1, title: '灰旗', body: first })
  await store.writeReview(fixtureWorkspace, {
    work, chapter: 1,
    problems: [
      { location: '开头', problem: '光线写得太满', suggestion: '收一收' },
      { location: '结尾', problem: '收束太快', suggestion: '补一拍' },
    ],
  })
  const second = '灰旗在风里翻了一夜。火在渠里烧着。'.repeat(45)
  await store.reviseChapter(fixtureWorkspace, { work, chapter: 1, body: second, problemIds: ['Q1', 'Q2'], mode: 'rewrite' })
  await store.foldState(fixtureWorkspace, {
    work, chapter: 1,
    entities: [{ name: '甲', facts: ['丢了半袋粮'] }],
    hooks: [{ text: '灰旗是谁挂的', state: 'opened' }],
  })
  const status = await store.status(fixtureWorkspace, work)
  const events = (await readFileSync(path.join(fixtureWorkspace, 'works', work, 'state', 'events.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(line => line.trim() !== '').length
  return {
    workId: status.workId,
    title: status.title,
    words: status.chapters[0].words,
    events,
    hooksOpen: status.hooks.opened,
    revision: status.chapters[0].revision,
    reviewRound: 1,
  }
}

/** Register one fixture workspace so the page has a workspace to read. */
function seedWorkspace(facts) {
  const storageDir = path.join(home, 'storages')
  mkdirSync(storageDir, { recursive: true })
  const workspaceId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  const now = new Date().toISOString()
  const storage = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        [workspaceId]: { path: fixtureWorkspace, title: 'fixture', sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }
  writeFileSync(path.join(storageDir, 'workspace.json'), `${JSON.stringify(storage, null, 2)}\n`)
  console.log(`[e2e-host] 已注册 fixture 工作区：${fixtureWorkspace}（${facts.words} 字、${facts.events} 条事件）`)
}

/** Initialize the temp profile from DSH's own template, then declare this bundle. */
function prepareProfile() {
  if (!existsSync(profileManifest)) {
    console.log('[e2e-host] 初始化临时 profile（dsh --profile web --dump-config）')
    const initialized = spawnSync(appExe, [appEntry, '--profile', 'web', '--dump-config'], {
      cwd: projectRoot, env: dshEnv(), encoding: 'utf8',
    })
    if (!existsSync(profileManifest)) {
      fail('DSH 没能初始化 web profile，检查 DSH_E2E_APP 是否指向桌面客户端。',
        `${initialized.stdout ?? ''}${initialized.stderr ?? ''}`)
    }
  }

  const manifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
  manifest.dependencies ??= {}
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const bundles = manifest.dsh.profile.bundles ?? (manifest.dsh.profile.bundles = [])
  const spec = `file:${projectRoot.replaceAll('\\', '/')}`
  manifest.dependencies[packageName] = spec
  if (!bundles.includes(packageName)) bundles.push(packageName)
  writeFileSync(profileManifest, `${JSON.stringify(manifest, null, 2)}\n`)

  const target = path.join(profileDir, 'node_modules', packageName)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const artifact of ARTIFACTS) {
    const from = path.join(projectRoot, artifact)
    if (existsSync(from)) copyTree(from, path.join(target, artifact))
  }
  console.log(`[e2e-host] 已把插件复制进临时 profile：${target}`)
}

/** Start the host and hold this process open for as long as Playwright wants it. */
function startHost(facts) {
  console.log(`[e2e-host] 启动临时实例：http://127.0.0.1:${port}/（DSH_HOME=${home}）`)
  const child = spawn(appExe, [appEntry, 'web', '--port', String(port), '--no-open'], {
    cwd: projectRoot, env: dshEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let ready = false
  let stopping = false
  let deadline
  const shutdown = (code) => {
    if (stopping) return
    stopping = true
    clearTimeout(deadline)
    if (child.exitCode === null && child.signalCode === null) child.kill()
    process.exit(code)
  }
  deadline = setTimeout(() => {
    fail(`实例 ${READY_TIMEOUT_MS / 1000} 秒内没有报出带 token 的地址。`, output)
  }, READY_TIMEOUT_MS)

  const watch = (chunk, sink) => {
    const text = chunk.toString()
    output += text
    sink.write(text)
    if (ready) return
    const found = PRINTED_URL.exec(output)
    if (found === null) return
    ready = true
    clearTimeout(deadline)
    const url = found[1]
    writeFileSync(runtimeFile, `${JSON.stringify({
      url, baseUrl: `http://127.0.0.1:${port}`, token: new URL(url).searchParams.get('token'), home, fixtureWorkspace, facts,
    }, null, 2)}\n`)
    console.log(`[e2e-host] 就绪：${url}`)
  }
  child.stdout.on('data', chunk => watch(chunk, process.stdout))
  child.stderr.on('data', chunk => watch(chunk, process.stderr))
  child.on('error', error => fail(`起不来：${error.message}`))
  child.on('exit', (code, signal) => {
    clearTimeout(deadline)
    if (!ready) fail(`实例在报出地址之前退出（code=${code} signal=${signal}）。`, output)
    console.log(`[e2e-host] 实例已退出（code=${code} signal=${signal}）`)
    shutdown(code ?? 1)
  })
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))
  process.on('exit', () => { if (child.exitCode === null && child.signalCode === null) child.kill() })
}

if (!existsSync(appExe)) fail(`找不到桌面客户端：${appExe}\n用 DSH_E2E_APP 指向 DeepSeek Harness.exe。`)
rmSync(runtimeFile, { force: true })
rmSync(home, { recursive: true, force: true })
rmSync(fixtureWorkspace, { recursive: true, force: true })
mkdirSync(tempRoot, { recursive: true })
prepareProfile()
const facts = await buildFixture()
seedWorkspace(facts)
startHost(facts)

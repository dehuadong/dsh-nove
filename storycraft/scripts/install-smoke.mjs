/**
 * Install smoke: pack the tarball, install it into a throwaway DSH home, and
 * prove the installed package boots and serves.
 *
 * This is the only check that exercises the *published* shape: the copy used by
 * the Playwright specs is assembled from `files`, while here npm resolves the
 * tarball the way a registry install does. Everything happens under
 * `.tmp-smoke/`; the developer's real profile is never touched.
 *
 * The profile is the shipped `web` one: `@deepseek-ai/dsh-base` plus
 * `@deepseek-ai/dsh-web-app`, the same bundle stack the Electron Desktop profile
 * carries. Install and boot must both target it — a smoke that installs into one
 * profile and boots another proves nothing, so step 4 re-reads the manifest.
 *
 * The instance it starts is headless (`ELECTRON_RUN_AS_NODE=1`, `--profile web
 * --no-open`, random port). It is always killed on the way out — including on
 * failure — because a leaked instance keeps the console pipe open and looks like
 * a hang.
 *
 * Environment:
 *   DSH_E2E_APP       desktop client executable (default: the installed app)
 *   DSH_SMOKE_KEEP=1  keep the temp home for inspection
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixture, seedWorkspace } from '../e2e/seed.mjs'
import { assertNode } from './node-version.mjs'
import { locatePlaywright } from './playwright-cli.mjs'

assertNode('install-smoke')

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tempRoot = path.join(root, '.tmp-smoke')
const home = path.join(tempRoot, 'home')
const workspace = path.join(tempRoot, 'workspace')
const packDir = path.join(tempRoot, 'pack')
const runtimeFile = path.join(tempRoot, 'runtime.json')
const profile = 'web'
const packageName = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name

const appExe = process.env.DSH_E2E_APP ?? 'C:\\Users\\MyPC\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
const appEntry = path.join(
  path.dirname(appExe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js',
)
const READY_TIMEOUT_MS = 180_000
const PRINTED_URL = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u

/**
 * Run the DSH CLI against the throwaway home.
 *
 * stdin is closed and a timeout is set: a CLI that asks a question (or waits on
 * a TTY) would otherwise block this script forever, which is exactly the shape
 * of a "silent hang".
 */
function dsh(args) {
  const result = spawnSync(appExe, [appEntry, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.error !== undefined) {
    const reason = result.error.code === 'ETIMEDOUT' ? '超时（180 秒）' : result.error.message
    throw new Error(`dsh ${args.join(' ')} 没有正常结束：${reason}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return result
}

/** Wait until the started instance prints its authenticated URL. */
function waitForUrl(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const deadline = setTimeout(() => {
      reject(new Error(`实例 ${READY_TIMEOUT_MS / 1000} 秒内没有报出 token URL\n${output.slice(-2000)}`))
    }, READY_TIMEOUT_MS)
    const watch = (chunk) => {
      output += chunk.toString()
      const found = PRINTED_URL.exec(output)
      if (found === null) return
      clearTimeout(deadline)
      resolve({ url: found[1], output })
    }
    child.stdout.on('data', watch)
    child.stderr.on('data', watch)
    child.on('exit', code => {
      clearTimeout(deadline)
      reject(new Error(`实例在报出地址前退出（code=${code}）\n${output.slice(-2000)}`))
    })
  })
}

/** Kill the instance and release its pipes so this process can exit. */
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  child.stdout?.destroy()
  child.stderr?.destroy()
}

async function main() {
  rmSync(tempRoot, { recursive: true, force: true })
  mkdirSync(packDir, { recursive: true })

  // 1. A real tarball, produced the way a publisher would produce it.
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const packed = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', packDir], {
    cwd: root,
    encoding: 'utf8',
  })
  if (packed.status !== 0) throw new Error(`npm pack 失败\n${packed.stdout ?? ''}${packed.stderr ?? ''}`)
  const tarballs = readdirSync(packDir).filter(name => name.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new Error(`应只产出一个 tarball，实际 ${tarballs.length} 个：${tarballs.join(', ')}`)
  const tarball = path.join(packDir, tarballs[0])
  console.log(`[install-smoke] 已打包 ${tarballs[0]}`)

  // 2. Let DSH initialize the shipped `web` profile itself, then exit. The dump
  //    flag is what makes it exit: without one the launcher boots the profile,
  //    which starts a server and opens a browser.
  const initialized = dsh(['--profile', profile, '--dump-config'])
  if (initialized.status !== 0) {
    throw new Error(`初始化 profile ${profile} 失败\n${initialized.stderr ?? ''}`)
  }
  const profileManifest = path.join(home, 'profiles', profile, 'package.json')
  if (!existsSync(profileManifest)) {
    throw new Error(`临时 profile 没有生成：${profileManifest}`)
  }

  // 3. Install the tarball the way a user would. The spec is normalized to a
  //    `file:` URL with forward slashes: on Windows a bare `E:\…` path is read
  //    by pnpm as a package spec, not as a tarball.
  const spec = `file:${tarball.replaceAll('\\', '/')}`
  const installed = dsh(['plugin', '--profile', profile, 'add', spec])
  if (installed.status !== 0) throw new Error(`dsh plugin add <tgz> 失败\n${installed.stdout ?? ''}${installed.stderr ?? ''}`)

  // 4. The profile must gain this bundle's layer.
  const dumped = dsh(['--profile', profile, '--dump-config'])
  if (dumped.status !== 0) throw new Error(`--dump-config 失败\n${dumped.stderr ?? ''}`)
  if (!String(dumped.stdout).includes(`# == ${packageName}`)) {
    throw new Error(`--dump-config 里没有 # == ${packageName} 层\n${String(dumped.stdout).slice(-2000)}`)
  }
  console.log(`[install-smoke] 已装上并出现 # == ${packageName} 层`)

  // 4b. The boot below must serve the profile this tarball went into. Assert the
  // bundle stack instead of trusting two names to stay in sync.
  const installedManifest = JSON.parse(readFileSync(profileManifest, 'utf8'))
  const bundles = installedManifest.dsh?.profile?.bundles ?? []
  for (const required of ['@deepseek-ai/dsh-web-app', packageName]) {
    if (!bundles.includes(required)) {
      throw new Error(`profile ${profile} 的 bundles 缺少 ${required}：${JSON.stringify(bundles)}`)
    }
  }

  // 5. Fixture data plus a registered workspace, so the route has something to list.
  const facts = await buildFixture(workspace)
  seedWorkspace({ home, workspaceDir: workspace, facts, label: 'install-smoke' })

  // 6. Boot the same profile the tarball was installed into.
  const port = Number(process.env.DSH_E2E_PORT ?? String(33000 + Math.floor(Math.random() * 900)))
  const child = spawn(appExe, [appEntry, '--profile', profile, '--port', String(port), '--no-open'], {
    cwd: root,
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.once('exit', () => stopChild(child))
  try {
    const { url } = await waitForUrl(child)
    console.log(`[install-smoke] 临时实例就绪：${url}`)

    writeFileSync(runtimeFile, `${JSON.stringify({
      url,
      baseUrl: `http://127.0.0.1:${port}`,
      token: new URL(url).searchParams.get('token'),
      home,
      fixtureWorkspace: workspace,
      facts,
    }, null, 2)}\n`)

    const playwright = locatePlaywright(root)
    if (playwright === undefined) {
      throw new Error('没有安装 Playwright：在 storycraft/ 下运行 npm install && npx playwright install chromium')
    }
    // Named apart from the tarball `spec` above: two different things, and the
    // install spec is still in scope here.
    const pageRun = spawnSync(process.execPath, [
      playwright.cli, 'test', 'e2e/load.spec.cjs', '--workers=1',
    ], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        STORYCRAFT_E2E_RUNTIME: runtimeFile,
        STORYCRAFT_E2E_URL: url,
      },
    })
    if ((pageRun.status ?? 1) !== 0) throw new Error('安装后的页面断言失败（见上面的 Playwright 输出）')
    console.log('[install-smoke] PASS: tarball 安装、挂载、页面与路由均通过')
  } finally {
    stopChild(child)
  }
}

try {
  await main()
} catch (error) {
  console.error(`[install-smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (process.env.DSH_SMOKE_KEEP !== '1') {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } else {
    console.log(`[install-smoke] 保留临时目录：${tempRoot}`)
  }
}

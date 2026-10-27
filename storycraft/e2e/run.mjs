/**
 * Run the Storycraft page specs against a throwaway DSH instance.
 *
 * Playwright comes from this package's devDependencies (see
 * `playwright.config.ts`): its version decides the browser build, so there is no
 * fallback to another checkout. The host is started here rather than by a
 * Playwright `webServer` entry because the instance only publishes its
 * authenticated URL through its own stdout.
 *
 * Usage: node storycraft/e2e/run.mjs [--grep <pattern>] [--headed] [--list]
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { locatePlaywright } from '../scripts/playwright-cli.mjs'

const e2eDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(e2eDir)
const runtimeFile = path.join(projectRoot, '.tmp-e2e', 'runtime.json')

const playwright = locatePlaywright(projectRoot)
if (playwright === undefined) {
  console.error('[e2e] 没有安装 Playwright。在 storycraft/ 下运行：')
  console.error('  npm install')
  console.error('  npx playwright install chromium')
  process.exit(1)
}

const extra = process.argv.slice(2)
// `--list` only needs the config, not a running instance.
if (extra.includes('--list')) {
  const listed = spawnSync(process.execPath, [playwright.cli, 'test', '--list', ...extra], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  process.exit(listed.status ?? 1)
}

// A fresh port per run: a pinned one collides with whatever else is listening.
const port = Number(process.env.DSH_E2E_PORT ?? String(33000 + Math.floor(Math.random() * 900)))

rmSync(runtimeFile, { force: true })
const host = spawn(process.execPath, [path.join(e2eDir, 'host.mjs')], {
  cwd: projectRoot,
  env: { ...process.env, DSH_E2E_PORT: String(port) },
  stdio: ['ignore', 'inherit', 'inherit'],
})

const stop = () => { if (host.exitCode === null && host.signalCode === null) host.kill() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

/**
 * Wait for the host to publish its authenticated URL. The host gives up after
 * 180 seconds and exits; this waits a little longer so the host's own error is
 * the one on screen instead of a second, less informative timeout.
 */
async function waitForRuntime() {
  const deadline = Date.now() + 190_000
  while (Date.now() < deadline) {
    if (existsSync(runtimeFile)) {
      const text = readFileSync(runtimeFile, 'utf8')
      if (text.trim() !== '') return JSON.parse(text)
    }
    if (host.exitCode !== null) return undefined
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return undefined
}

const runtime = await waitForRuntime()
if (runtime === undefined) {
  stop()
  console.error('[e2e] 临时实例没有就绪，先看上面的 host 输出。')
  process.exit(1)
}

const result = spawnSync(process.execPath, [
  playwright.cli, 'test', ...extra,
], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    STORYCRAFT_E2E_RUNTIME: runtimeFile,
    STORYCRAFT_E2E_URL: runtime.url,
  },
})

stop()
process.exit(result.status ?? 1)

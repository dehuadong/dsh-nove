/**
 * Run the Storycraft page specs against a throwaway DSH instance.
 *
 * Playwright is a development tool, not a dependency of this zero-dependency
 * bundle, so it is located at run time: a local `node_modules`, an explicit
 * `DSH_E2E_PLAYWRIGHT_ROOT`, or a sibling checkout that already installed it.
 * The host is started here (not by a Playwright `webServer` entry) because the
 * instance only publishes its authenticated URL through its own stdout.
 *
 * Usage: node storycraft/e2e/run.mjs [--grep <pattern>] [--headed]
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(e2eDir)
const repoRoot = path.dirname(projectRoot)
const runtimeFile = path.join(projectRoot, '.tmp-e2e', 'runtime.json')

/** Candidate roots that may contain an installed `@playwright/test`. */
const candidates = [
  process.env.DSH_E2E_PLAYWRIGHT_ROOT,
  projectRoot,
  repoRoot,
].filter(Boolean)

/** Locate the Playwright CLI and the node_modules root that resolves it. */
function locatePlaywright() {
  for (const candidate of candidates) {
    for (const cli of [
      path.join(candidate, 'node_modules', '@playwright', 'test', 'cli.js'),
      path.join(candidate, 'node_modules', 'playwright', 'cli.js'),
    ]) {
      if (existsSync(cli)) return { cli, nodeModules: path.join(candidate, 'node_modules') }
    }
  }
  return undefined
}

const playwright = locatePlaywright()
if (playwright === undefined) {
  console.error('[e2e] 找不到 Playwright。安装一次开发依赖，或用 DSH_E2E_PLAYWRIGHT_ROOT 指向已安装它的目录：')
  console.error('  pnpm add -D @playwright/test   # 在 storycraft/ 下')
  console.error('  DSH_E2E_PLAYWRIGHT_ROOT=<含 node_modules 的目录> node storycraft/e2e/run.mjs')
  process.exit(1)
}

const extra = process.argv.slice(2)
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

/** Wait for the host to publish its authenticated URL. */
async function waitForRuntime() {
  const deadline = Date.now() + 200_000
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
  playwright.cli, 'test', 'e2e',
  '--reporter=line', '--workers=1', ...extra,
], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_PATH: playwright.nodeModules,
    STORYCRAFT_E2E_RUNTIME: runtimeFile,
    STORYCRAFT_E2E_URL: runtime.url,
  },
})

stop()
process.exit(result.status ?? 1)

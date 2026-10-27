import { defineConfig, devices } from '@playwright/test'

/**
 * Page specs run against a throwaway DSH instance, not a dev server.
 *
 * There is deliberately no `webServer`: the instance publishes an authenticated
 * URL with a per-run token only after it boots (`dsh web: http://127.0.0.1:…/?token=…`),
 * which a URL probe cannot wait for. `e2e/run.mjs` is the one command that
 * starts the host, reads that URL from stdout and hands it to Playwright through
 * `STORYCRAFT_E2E_URL` / `STORYCRAFT_E2E_RUNTIME`:
 *
 *   node storycraft/e2e/run.mjs            # all specs
 *   node storycraft/e2e/run.mjs --list     # config only, no instance
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.cjs',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: 'line',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    // No `locale` override: the host renders the desktop client's own language,
    // and the specs are written against that UI (Chinese labels where the app
    // ships them, English for the built-in onboarding).
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})

// A bare `npx playwright test` has no instance to talk to: every spec would
// silently skip, which looks like a pass. Fail loudly and point at the runner
// that starts the host and hands over the authenticated URL.
if (!process.argv.includes('--list') && process.env.STORYCRAFT_E2E_URL === undefined) {
  throw new Error(
    '没有运行中的实例：请用 `node storycraft/e2e/run.mjs`（它会起临时实例）；'
    + '只看清单用 `node storycraft/e2e/run.mjs --list`。',
  )
}

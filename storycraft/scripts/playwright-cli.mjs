/**
 * Locate the Playwright CLI installed in this package.
 *
 * Playwright is a project devDependency: its version decides the browser build
 * the specs run against, so a borrowed install from another checkout would
 * silently test a different browser. Both `e2e/run.mjs` and
 * `scripts/install-smoke.mjs` go through here so there is one answer.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Resolve the CLI shipped by this package's `@playwright/test`.
 * @param {string} projectRoot - the storycraft package directory.
 * @returns {{ cli: string } | undefined} CLI entry, or undefined when not installed.
 */
export function locatePlaywright(projectRoot) {
  for (const cli of [
    path.join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
    path.join(projectRoot, 'node_modules', 'playwright', 'cli.js'),
  ]) {
    if (existsSync(cli)) return { cli }
  }
  return undefined
}

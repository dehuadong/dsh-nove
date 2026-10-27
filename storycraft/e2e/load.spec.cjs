// Load contract for the built package: the bundled Host half must serve its
// routes and the bundled Client half must boot the page without throwing.
// Unlike the workbench specs this does not look at UI details, so it stays the
// one place that proves "installed package → route answers, page is clean".
const fs = require('node:fs')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url
const fixtureWorkspace = runtime.fixtureWorkspace

test.describe('故事工坊加载契约', () => {
  test.skip(!url, '没有运行中的实例：请用 node storycraft/e2e/run.mjs 运行')

  test('作品路由返回作品列表，页面没有未捕获错误', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await openWorkbench(page, url)

    // Same origin as the page: the session cookie the GUI handed out is enough.
    // The route names the workspace explicitly, exactly like the panel does.
    const result = await page.evaluate(async (root) => {
      const response = await fetch(`/api/dsh-storycraft/works?root=${encodeURIComponent(root)}`)
      const body = await response.json().catch(() => undefined)
      return { status: response.status, works: Array.isArray(body?.works) ? body.works.length : -1 }
    }, fixtureWorkspace)
    expect(result.status).toBe(200)
    expect(result.works).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
})

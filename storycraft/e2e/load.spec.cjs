// Load contract for the built package: the bundled Host half must serve its
// routes and the bundled Client half must boot the page without throwing.
// Unlike the workbench specs this does not look at UI details, so it stays the
// one place that proves "installed package → route answers, page is clean".
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
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
    await expect(page.getByRole('tab', { name: '长篇面板' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '故事工坊' })).toBeVisible()

    // Same origin as the page: the session cookie the GUI handed out is enough.
    // The route names the workspace explicitly, exactly like the panel does.
    const result = await page.evaluate(async (root) => {
      const worksResponse = await fetch(`/api/see-storycraft/works?root=${encodeURIComponent(root)}`)
      const worksBody = await worksResponse.json().catch(() => undefined)
      const workId = worksBody?.works?.[0]?.workId ?? worksBody?.works?.[0]?.id
      const nextResponse = workId === undefined ? undefined : await fetch(
        `/api/see-storycraft/next?root=${encodeURIComponent(root)}&id=${encodeURIComponent(workId)}`,
      )
      const nextBody = nextResponse === undefined ? undefined : await nextResponse.json().catch(() => undefined)
      return {
        status: worksResponse.status,
        works: Array.isArray(worksBody?.works) ? worksBody.works.length : -1,
        nextStatus: nextResponse?.status,
        action: nextBody?.next?.action,
      }
    }, fixtureWorkspace)
    expect(result.status).toBe(200)
    expect(result.works).toBeGreaterThan(0)
    expect(result.nextStatus).toBe(200)
    expect(typeof result.action).toBe('string')
    expect(result.action.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('打包后的 tools 入口注册 story_next', async () => {
    const toolsPath = path.join(runtime.home, 'profiles', 'web', 'node_modules', 'see-storycraft', 'lib', 'tools.js')
    expect(fs.existsSync(toolsPath)).toBe(true)
    const tools = await import(pathToFileURL(toolsPath).href)
    const registered = []
    const ctx = {
      tools: {
        guard: () => () => {},
        register: definition => {
          registered.push(definition.name)
          return () => {}
        },
      },
      effect: fn => {
        const dispose = fn()
        return () => dispose?.()
      },
      get: () => undefined,
    }
    tools.apply(ctx)
    expect(registered).toContain('story_next')
  })
})

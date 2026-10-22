// Storycraft workbench specs: the browser half is only real inside a running
// GUI, so these check the three things unit tests cannot see — the sidebar
// entry, the page reading a real work, and the session gate on instructions.
// The fixture is built by the host through the same actions a session uses, so
// every asserted number comes from runtime.json instead of a moving sample.
const fs = require('node:fs')
const { join } = require('node:path')
const { test, expect } = require('@playwright/test')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url
const facts = runtime.facts ?? {}

async function openWorkbench(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  // The workbench lives in the right sidebar: open a session, expand the column,
  // then pick its card on the guide page.
  const heading = page.getByRole('heading', { name: '故事工坊' })
  const clickThrough = async (locator) => {
    if (await locator.count() === 0) return false
    await locator.first().evaluate(node => node.click())
    return true
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const notice = page.getByRole('button', { name: 'Continue' })
    if (await notice.count() > 0) await clickThrough(notice)

    const workspace = page.getByRole('treeitem').first()
    if (await workspace.count() > 0) await clickThrough(workspace)
    await page.waitForTimeout(600)

    const expand = page.getByRole('button', { name: /打开右侧边栏|Open right sidebar/ })
    if (await expand.count() > 0) await clickThrough(expand)
    await page.waitForTimeout(600)

    const card = page.getByRole('button', { name: /故事工坊/ })
    if (await card.count() > 0) await clickThrough(card)

    try {
      await heading.waitFor({ state: 'visible', timeout: 5_000 })
      return
    } catch {
      await page.waitForTimeout(600)
    }
  }
  // A preview notice can appear late and take the page out of the a11y tree;
  // dismiss it between attempts instead of asserting straight away.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lateNotice = page.getByRole('button', { name: 'Continue' })
    if (await lateNotice.count() > 0) await clickThrough(lateNotice)
    try {
      await heading.waitFor({ state: 'visible', timeout: 3_000 })
      return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  await expect(heading).toBeVisible({ timeout: 10_000 })
}

test.describe('故事工坊工作台', () => {
  test.skip(!url, 'STORYCRAFT_E2E_URL 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('侧栏入口打开工作台', async ({ page }) => {
    await openWorkbench(page)
    await expect(page.getByText('作品编排：看作品与章节')).toBeVisible()
  })

  test('页面读到 fixture 作品的读数', async ({ page }) => {
    await openWorkbench(page)
    // The tab body must receive the composer writer; without it the tab could
    // only open a panel-local draft.
    await expect(page.locator('[data-storycraft-input="yes"]')).toHaveCount(1, { timeout: 15_000 })
    // The home view lists projects by form; entering one opens its chapters.
    const project = page.getByRole('button', { name: /示例短篇/ })
    await expect(project).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^长篇/ })).toHaveCount(1)
    await project.evaluate(node => node.click())
    await expect(page.getByText(/longform · 示例短篇 · 2 章 · 已写 1 章/)).toBeVisible()
    // A project is a subpage: the type rail is gone and a way back remains.
    await expect(page.getByRole('button', { name: /^长篇/ })).toHaveCount(0)
    const back = page.getByRole('button', { name: /全部作品/ })
    await expect(back).toBeVisible()
    await back.evaluate(node => node.click())
    // Back returns to the home view: type rail again, project cards again.
    await expect(page.getByRole('button', { name: /^长篇/ })).toHaveCount(1, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: /示例短篇/ })).toBeVisible()
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    await expect(page.getByText(/longform · 示例短篇 · 2 章 · 已写 1 章/)).toBeVisible()

    const firstChapter = page.locator('button.sc-chapter').filter({ hasText: '灰旗' })
    await expect(firstChapter).toBeVisible()
    await firstChapter.evaluate(node => node.click())
    await expect(page.getByText(`已定稿 · 当前版本 r2 · ${facts.words} 字 · 审稿 1 轮 · 未处理 0 条`)).toBeVisible()
    await expect(page.getByText(/本章已定稿并锁定。要补审稿或改稿：点「撤回定稿」/)).toBeVisible()
    await expect(page.getByRole('button', { name: '撤回定稿', exact: true })).toBeEnabled()
    // A settled chapter shows only the actions that can actually do something.
    await expect(page.getByRole('button', { name: '审稿', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '按清单修订', exact: true })).toHaveCount(0)

    await expect(page.getByRole('button', { name: '正文', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '章纲', exact: true })).toBeVisible()
    const olderVersion = page.getByRole('button', { name: 'r1', exact: true })
    await expect(olderVersion).toBeVisible()
    await olderVersion.evaluate(node => node.click())
    await expect(page.getByText('ch-0001.md（r1）')).toBeVisible()

    await expect(page.getByText(`状态事件 ${facts.events}`)).toBeVisible()
    await expect(page.getByText(`伏笔 未解 ${facts.hooksOpen}`)).toBeVisible()
  })

  test('已摘要章节显示有摘要徽标', async ({ page }) => {
    await openWorkbench(page)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const first = page.locator('button.sc-chapter').filter({ hasText: '第 1 章' })
    await expect(first).toBeVisible({ timeout: 15_000 })
    await first.evaluate(node => node.click())
    await expect(page.getByText('有摘要', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('button.sc-btn').filter({ hasText: /^摘要$/ })).toHaveCount(0)
  })

  test('过期摘要显示徽标和重写按钮', async ({ page }) => {
    const store = await import('../storage.js')
    store.reopenChapter(runtime.fixtureWorkspace, { work: facts.workId, chapter: 1 })
    store.writeChapter(runtime.fixtureWorkspace, {
      work: facts.workId, chapter: 1, title: '灰旗', body: '灰旗在风里翻了一夜。火在渠里烧着。'.repeat(45), rewrite: true,
    })
    await openWorkbench(page)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const first = page.locator('button.sc-chapter').filter({ hasText: '第 1 章' })
    await expect(first).toBeVisible({ timeout: 15_000 })
    await first.evaluate(node => node.click())
    await expect(page.getByText('摘要过期', { exact: true })).toBeVisible({ timeout: 15_000 })
    const rewrite = page.locator('button.sc-btn').filter({ hasText: /^重写摘要$/ })
    await expect(rewrite).toBeVisible()
    await expect(rewrite).toHaveAttribute('title', /delegate\.role=summarizer/)
  })

  test('素材面板可以导入、重命名、去重和删除', async ({ page }) => {
    await openWorkbench(page)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 15_000 })
    const input = page.getByLabel('导入素材文件')
    const file = {
      name: '素材测试.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('旧井边的参考资料。', 'utf8'),
    }
    const composer = page.getByRole('textbox', { name: /Describe what/ })
    const composerText = () => composer.evaluate(node => String(node.value ?? node.textContent ?? ''))
    expect(await composer.count()).toBeGreaterThan(0)
    expect(await composerText()).toBe('')
    await page.getByLabel('导入素材用途').selectOption('scene')
    await input.setInputFiles(file)
    await expect(page.getByText('素材库：1 份')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('素材测试', { exact: true })).toHaveCount(1)
    expect(await page.getByLabel('素材「素材测试」的用途').inputValue()).toBe('scene')
    await page.getByLabel('按用途筛选素材').selectOption('setting')
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('按用途筛选素材').selectOption('scene')
    await expect(page.getByText('素材库：1 份')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('素材「素材测试」的用途').selectOption('setting')
    await page.getByLabel('按用途筛选素材').selectOption('setting')
    await expect(page.getByText('素材库：1 份')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('按用途筛选素材').selectOption('all')
    expect(await composerText()).toBe('')

    await input.setInputFiles(file)
    await page.waitForTimeout(200)
    await expect(page.getByText('素材库：1 份')).toBeVisible()
    await expect(page.getByText('素材测试', { exact: true })).toHaveCount(1)

    await input.setInputFiles({ name: '坏文件.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') })
    await expect(page.getByText(/只支持 \.txt \/ \.md/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('素材库：1 份')).toBeVisible()

    const notice = page.getByRole('button', { name: 'Continue' })
    if (await notice.count() > 0) await notice.first().evaluate(node => node.click())
    const getStarted = page.getByRole('dialog', { name: 'Get started' })
    if (await getStarted.count() > 0) {
      await getStarted.getByRole('button', { name: 'Close' }).evaluate(node => node.click())
    }
    await page.getByRole('button', { name: '重命名' }).evaluate(node => node.click())
    const rename = page.getByLabel('素材「素材测试」的新标题')
    await rename.evaluate((node, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(node, value)
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }, '新的素材标题')
    await page.waitForTimeout(100)
    await page.getByRole('button', { name: '保存' }).evaluate(node => node.click())
    await expect(page.getByText('新的素材标题', { exact: true })).toBeVisible({ timeout: 15_000 })

    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: '删除' }).last().evaluate(node => node.click())
    await expect(page.getByText('素材库：0 份')).toBeVisible({ timeout: 15_000 })
  })

  test('作品 header 可以直接导出', async ({ page }) => {
    await openWorkbench(page)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const composer = page.getByRole('textbox', { name: /Describe what/ })
    expect(await composer.count()).toBeGreaterThan(0)
    const before = await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))
    await page.getByRole('button', { name: '导出', exact: true }).evaluate(node => node.click())
    await expect(page.getByText(/已导出 \d+ 个文件/)).toBeVisible({ timeout: 15_000 })
    const manifestPath = join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.schemaVersion).toBe(4)
    expect(await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))).toBe(before)
    fs.rmSync(join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId), { recursive: true, force: true })
    await page.getByRole('button', { name: '导出', exact: true }).evaluate(node => node.click())
    await expect(page.getByText(/已导出 \d+ 个文件/)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => fs.existsSync(manifestPath), { timeout: 5_000 }).toBe(true)

    const rejected = await page.evaluate(async ({ root, workId }) => {
      const response = await fetch('/api/dsh-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, sessionId: 'not-this-session', workId }),
      })
      return response.json()
    }, { root: runtime.fixtureWorkspace, workId: facts.workId })
    expect(rejected.ok).toBe(false)
    expect(rejected.error.code).toBe('work-mismatch')
    const invalid = await page.evaluate(async () => {
      const response = await fetch('/api/dsh-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      return response.json()
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.error.code).toBe('invalid-body')
    const unknown = await page.evaluate(async () => {
      const response = await fetch('/api/dsh-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: 'C:\\\\definitely-not-a-workspace', sessionId: 'x', workId: 'y' }),
      })
      return response.json()
    })
    expect(unknown.ok).toBe(false)
    expect(['unknown-workspace', 'invalid-root']).toContain(unknown.error.code)
    const missing = await page.evaluate(async ({ root }) => {
      const response = await fetch('/api/dsh-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, sessionId: 'x', workId: 'no-such-work' }),
      })
      return response.json()
    }, { root: runtime.fixtureWorkspace })
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('work-not-found')
    const relative = await page.evaluate(async () => {
      const response = await fetch('/api/dsh-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: 'relative', sessionId: 'x', workId: 'y' }),
      })
      return response.json()
    })
    expect(relative.ok).toBe(false)
    expect(relative.error.code).toBe('invalid-root')
  })

  test('全书计划可以从面板确认', async ({ page }) => {
    await openWorkbench(page)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const approve = page.getByRole('button', { name: '确认全书计划', exact: true })
    await expect(approve).toBeVisible({ timeout: 15_000 })
    await approve.evaluate(node => node.click())
    await expect(page.getByText('计划已确认', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '确认全书计划', exact: true })).toHaveCount(0)
  })

  test('章纲可以从面板确认', async ({ page }) => {
    await openWorkbench(page)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const second = page.locator('button.sc-chapter').filter({ hasText: '第 2 章' })
    await expect(second).toBeVisible({ timeout: 15_000 })
    await second.evaluate(node => node.click())
    await page.getByRole('button', { name: '章纲', exact: true }).evaluate(node => node.click())
    const approve = page.getByRole('button', { name: '确认章纲', exact: true })
    await expect(approve).toBeVisible()
    await approve.evaluate(node => node.click())
    await expect(page.getByText('章纲已确认', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '确认章纲', exact: true })).toHaveCount(0)
  })

  test('非长篇会话里下发指令只得到说明', async ({ page }) => {
    await openWorkbench(page)
    await expect(page.getByText(/当前会话是 standard 模式|当前会话不是/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const nextChapter = page.getByRole('button', { name: /写第 \d+ 章（写到修订）/ })
    await expect(nextChapter).toBeEnabled()
    await nextChapter.evaluate(node => node.click())

    // A non-long-form session may not receive an action: the gate answers and
    // nothing is written anywhere.
    await nextChapter.evaluate(node => node.click())
    await expect(page.getByText(/不是「故事工坊」模式/)).toBeVisible({ timeout: 10_000 })
  })

  test('新建作品后列表自动刷新', async ({ page }) => {
    const store = await import('../storage.js')
    const title = `刷新探针${Date.now()}`
    await openWorkbench(page)
    store.initWork(runtime.fixtureWorkspace, { title })
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 })
  })

  test('详情在 focus 后刷新且不重复写当前指针', async ({ page }) => {
    const store = await import('../storage.js')
    const title = `焦点探针${Date.now()}`
    const created = store.initWork(runtime.fixtureWorkspace, { title })
    let pointerPosts = 0
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/dsh-storycraft/current')) pointerPosts += 1
    })
    await openWorkbench(page)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await page.waitForTimeout(500)
    const before = pointerPosts
    store.writeOutline(runtime.fixtureWorkspace, { work: created.workId, mainline: '一条主线' })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('button', { name: '确认全书计划', exact: true })).toBeVisible({ timeout: 5_000 })
    expect(pointerPosts).toBe(before)

    // A failed detail refresh keeps the old data and shows a non-blocking notice.
    await page.route('**/api/dsh-storycraft/work?*', route => route.abort())
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText(/刷新失败：/)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: '确认全书计划', exact: true })).toBeVisible()
    await page.unroute('**/api/dsh-storycraft/work?*')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText(/刷新失败：/)).toHaveCount(0, { timeout: 5_000 })
  })
})

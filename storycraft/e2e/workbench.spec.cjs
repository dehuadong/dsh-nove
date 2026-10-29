// Storycraft workbench specs: the browser half is only real inside a running
// GUI, so these check the three things unit tests cannot see — the sidebar
// entry, the page reading a real work, and the session gate on instructions.
// The fixture is built by the host through the same actions a session uses, so
// every asserted number comes from runtime.json instead of a moving sample.
const fs = require('node:fs')
const { join } = require('node:path')
const { test, expect } = require('@playwright/test')
const { openWorkbench } = require('./helpers.cjs')

const runtimePath = process.env.STORYCRAFT_E2E_RUNTIME
const runtime = runtimePath && fs.existsSync(runtimePath) ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : {}
const url = runtime.url
const facts = runtime.facts ?? {}


test.describe('故事工坊工作台', () => {
  test.skip(!url, 'STORYCRAFT_E2E_URL 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('侧栏入口打开工作台', async ({ page }) => {
    await openWorkbench(page, url)
    await expect(page.getByText('作品编排：看作品与章节')).toBeVisible()
  })

  test('页面读到 fixture 作品的读数', async ({ page }) => {
    await openWorkbench(page, url)
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
    await expect(page.getByText(`已定稿 · 当前版本 r2 · ${facts.words} 字 · 审稿 ${facts.reviewRound} 轮 · 未处理 0 条`)).toBeVisible()
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

    await expect(page.getByText(`伏笔 未解 ${facts.hooksOpen}`)).toBeVisible()
  })

  test('已摘要章节显示有摘要徽标', async ({ page }) => {
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const first = page.locator('button.sc-chapter').filter({ hasText: '第 1 章' })
    await expect(first).toBeVisible({ timeout: 15_000 })
    await first.evaluate(node => node.click())
    await expect(page.getByText('有摘要', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('button.sc-btn').filter({ hasText: /^摘要$/ })).toHaveCount(0)
  })

  test('过期摘要显示徽标和重写按钮', async ({ page }) => {
    const store = await import('../src/storage.ts')
    store.reopenChapter(runtime.fixtureWorkspace, { work: facts.workId, chapter: 1 })
    store.writeChapter(runtime.fixtureWorkspace, {
      work: facts.workId, chapter: 1, title: '灰旗', body: '灰旗在风里翻了一夜。火在渠里烧着。'.repeat(45), rewrite: true,
    })
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const first = page.locator('button.sc-chapter').filter({ hasText: '第 1 章' })
    await expect(first).toBeVisible({ timeout: 15_000 })
    await first.evaluate(node => node.click())
    await expect(page.getByText('摘要过期', { exact: true })).toBeVisible({ timeout: 15_000 })
    const rewrite = page.locator('button.sc-btn').filter({ hasText: /^重写摘要$/ })
    await expect(rewrite).toBeVisible()
    await expect(rewrite).toHaveAttribute('title', /delegate\.role=summarizer/)

    // Restore the shared fixture: reopening in this test must not leave the flow
    // pointed at chapter 1 for the specs that follow.
    store.writeReview(runtime.fixtureWorkspace, { work: facts.workId, chapter: 1, observations: [] })
    store.writeSummary(runtime.fixtureWorkspace, { work: facts.workId, chapter: 1, text: '甲在渠边丢了半袋粮，灰旗还挂着。' })
    store.settleState(runtime.fixtureWorkspace, {
      work: facts.workId, chapter: 1,
      factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '丢了半袋粮' }] },
    })
  })

  test('素材面板可以导入、重命名、去重和删除', async ({ page }) => {
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    await page.getByRole('tab', { name: '素材', exact: true }).evaluate(node => node.click())
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
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const composer = page.getByRole('textbox', { name: /Describe what/ })
    expect(await composer.count()).toBeGreaterThan(0)
    const before = await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))
    await page.getByRole('button', { name: '导出', exact: true }).evaluate(node => node.click())
    await expect(page.getByText(/已导出 \d+ 个文件/)).toBeVisible({ timeout: 15_000 })
    const manifestPath = join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.schemaVersion).toBe(6)
    expect(manifest.book?.file).toBe('book.txt')
    expect(manifest.epub?.file).toBe('book.epub')
    expect(fs.existsSync(join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId, 'book.epub'))).toBe(true)
    expect(fs.readFileSync(join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId, 'book.txt'), 'utf8')).toContain('第 1 章')
    expect(await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))).toBe(before)
    fs.rmSync(join(runtime.fixtureWorkspace, '.storycraft', 'exports', facts.workId), { recursive: true, force: true })
    await page.getByRole('button', { name: '导出', exact: true }).evaluate(node => node.click())
    await expect(page.getByText(/已导出 \d+ 个文件/)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => fs.existsSync(manifestPath), { timeout: 5_000 }).toBe(true)

    const rejected = await page.evaluate(async ({ root, workId }) => {
      const response = await fetch('/api/see-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, sessionId: 'not-this-session', workId }),
      })
      return response.json()
    }, { root: runtime.fixtureWorkspace, workId: facts.workId })
    expect(rejected.ok).toBe(false)
    expect(rejected.error.code).toBe('work-mismatch')
    const invalid = await page.evaluate(async () => {
      const response = await fetch('/api/see-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      return response.json()
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.error.code).toBe('invalid-body')
    const unknown = await page.evaluate(async () => {
      const response = await fetch('/api/see-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: 'C:\\\\definitely-not-a-workspace', sessionId: 'x', workId: 'y' }),
      })
      return response.json()
    })
    expect(unknown.ok).toBe(false)
    expect(['unknown-workspace', 'invalid-root']).toContain(unknown.error.code)
    const missing = await page.evaluate(async ({ root }) => {
      const response = await fetch('/api/see-storycraft/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, sessionId: 'x', workId: 'no-such-work' }),
      })
      return response.json()
    }, { root: runtime.fixtureWorkspace })
    expect(missing.ok).toBe(false)
    expect(missing.error.code).toBe('work-not-found')
    const relative = await page.evaluate(async () => {
      const response = await fetch('/api/see-storycraft/export', {
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
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    const approve = page.getByRole('button', { name: '确认全书计划', exact: true })
    await expect(approve).toBeVisible({ timeout: 15_000 })
    await approve.evaluate(node => node.click())
    await expect(page.getByText('计划已确认', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: '确认全书计划', exact: true })).toHaveCount(0)
  })

  test('章纲可以从面板确认', async ({ page }) => {
    await openWorkbench(page, url)
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
    await openWorkbench(page, url)
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
    const store = await import('../src/storage.ts')
    const title = `刷新探针${Date.now()}`
    await openWorkbench(page, url)
    store.initWork(runtime.fixtureWorkspace, { title })
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 })
  })

  test('章节可以上移和下移', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const title = `章节移动${Date.now()}`
    const work = store.initWork(runtime.fixtureWorkspace, { title }).workId
    for (const [number, name] of [[1, '甲章'], [2, '乙章']]) {
      store.writePlan(runtime.fixtureWorkspace, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
      store.approveChapterPlan(runtime.fixtureWorkspace, { work, chapter: number })
      store.writeChapter(runtime.fixtureWorkspace, { work, chapter: number, title: name, body: `${name}正文。`.repeat(20) })
    }
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    await page.getByRole('button', { name: /第 2 章 乙章/ }).evaluate(node => node.click())
    await page.locator('.sc-chapter-actions').getByRole('button', { name: '前移', exact: true }).evaluate(node => node.click())
    await expect(page.locator('.sc-chapter-title').first()).toHaveText('乙章', { timeout: 15_000 })
    await page.locator('.sc-chapter-actions').getByRole('button', { name: '后移', exact: true }).evaluate(node => node.click())
    await expect(page.locator('.sc-chapter-title').first()).toHaveText('甲章', { timeout: 15_000 })
  })

  test('章节可以删除', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const title = `章节删除${Date.now()}`
    const work = store.initWork(runtime.fixtureWorkspace, { title }).workId
    for (const [number, name] of [[1, '甲章'], [2, '乙章']]) {
      store.writePlan(runtime.fixtureWorkspace, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
      store.approveChapterPlan(runtime.fixtureWorkspace, { work, chapter: number })
      store.writeChapter(runtime.fixtureWorkspace, { work, chapter: number, title: name, body: `${name}正文。`.repeat(20) })
    }
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    const composer = page.getByRole('textbox', { name: /Describe what/ })
    const before = await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))
    await page.getByRole('button', { name: /第 1 章 甲章/ }).evaluate(node => node.click())
    page.once('dialog', dialog => dialog.accept())
    await page.locator('.sc-chapter-actions').getByRole('button', { name: '删除', exact: true }).evaluate(node => node.click())
    await expect(page.locator('.sc-chapter-title')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('.sc-chapter-title')).toHaveText('乙章')
    await expect(page.locator('.sc-chapter-no')).toHaveText('第 1 章')
    expect(await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))).toBe(before)
  })

  test('窄面板不横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openWorkbench(page, url)
    await page.getByRole('button', { name: /示例短篇/ }).evaluate(node => node.click())
    await expect(page.locator('.sc-main-tab')).toHaveCount(6, { timeout: 15_000 })
    const widths = await page.locator('.sc-detail').evaluate(node => ({
      client: node.clientWidth,
      scroll: node.scrollWidth,
    }))
    expect(widths.client).toBeLessThan(600)
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1)
    await page.locator('.sc-main-tab').filter({ hasText: '真值' }).evaluate(node => node.click())
    const item = page.locator('.sc-item').filter({ hasText: 'bible/world.md' })
    await item.getByRole('button', { name: '编辑', exact: true }).evaluate(node => node.click())
    const drawer = await page.locator('.sc-drawer').evaluate(node => node.getBoundingClientRect().width)
    expect(drawer).toBeLessThanOrEqual(widths.client)
    await page.getByRole('button', { name: '取消', exact: true }).evaluate(node => node.click())
    await page.locator('.sc-main-tab').filter({ hasText: '写前上下文' }).evaluate(node => node.click())
    await expect(page.getByLabel('写前上下文目标章')).toBeVisible()
  })

  test('章节倒序分页', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const title = `分页章节${Date.now()}`
    const work = store.initWork(runtime.fixtureWorkspace, { title }).workId
    for (let number = 1; number <= 25; number += 1) {
      store.writePlan(runtime.fixtureWorkspace, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
      store.approveChapterPlan(runtime.fixtureWorkspace, { work, chapter: number })
      store.writeChapter(runtime.fixtureWorkspace, { work, chapter: number, title: `章${number}`, body: `第${number}章正文。`.repeat(10) })
    }
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    await expect(page.getByText('第 1 / 2 页 · 共 25 章')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.sc-chapter-no')).toHaveCount(20)
    await expect(page.locator('.sc-chapter-no').first()).toHaveText('第 25 章')
    await expect(page.locator('.sc-chapter-no').last()).toHaveText('第 6 章')
    await page.getByRole('button', { name: '下一页', exact: true }).evaluate(node => node.click())
    await expect(page.getByText('第 2 / 2 页 · 共 25 章')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.sc-chapter-no')).toHaveCount(5)
    await expect(page.locator('.sc-chapter-no').first()).toHaveText('第 5 章')
    await expect(page.locator('.sc-chapter-no').last()).toHaveText('第 1 章')
    await page.locator('.sc-chapter').filter({ hasText: '第 1 章' }).evaluate(node => node.click())
    await expect(page.locator('.sc-chapter-actions')).toBeVisible()
  })

  test('抽取文风写入样例', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const title = `文风按钮${Date.now()}`
    const work = store.initWork(runtime.fixtureWorkspace, { title }).workId
    for (const number of [1, 2, 3]) {
      store.writePlan(runtime.fixtureWorkspace, { work, chapter: number, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
      store.approveChapterPlan(runtime.fixtureWorkspace, { work, chapter: number })
      const paragraph = `${`第${number}章文风测试。`.repeat(18)}`
      store.writeChapter(runtime.fixtureWorkspace, { work, chapter: number, body: `${paragraph}\n\n${paragraph}`, title: `风${number}` })
    }
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    const composer = page.getByRole('textbox', { name: /Describe what/ })
    const before = await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))
    await page.getByRole('button', { name: '抽取文风', exact: true }).evaluate(node => node.click())
    const { openWork } = await import('../src/db.ts')
    const { STYLE_START } = await import('../src/style.ts')
    await expect.poll(() => {
      const db = openWork(runtime.fixtureWorkspace, work)
      try {
        return db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:style' ORDER BY rowid DESC LIMIT 1").get()?.content ?? ''
      } finally {
        db.close()
      }
    }, { timeout: 15_000 }).toContain(STYLE_START)
    const db = openWork(runtime.fixtureWorkspace, work)
    try {
      expect(db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:style' ORDER BY rowid DESC LIMIT 1").get().content).toContain('样例 3')
    } finally {
      db.close()
    }
    expect(await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))).toBe(before)
  })

  test('真值可以编辑、取消并拒绝坏人物', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const { openWork } = await import('../src/db.ts')
    const title = `真值编辑${Date.now()}`
    const work = store.initWork(runtime.fixtureWorkspace, { title }).workId
    const seedDb = openWork(runtime.fixtureWorkspace, work)
    seedDb.prepare("DELETE FROM artifacts WHERE artifact_id IN ('outline', 'bible:style')").run()
    seedDb.close()
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    const composer = page.getByRole('textbox', { name: /Describe what/ })
    const before = await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))
    await page.getByRole('tab', { name: '真值', exact: true }).evaluate(node => node.click())
    const worldItem = page.locator('.sc-item').filter({ hasText: 'bible/world.md' })
    await expect(worldItem).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.sc-item').filter({ hasText: 'outline/plan.md' }).getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)
    await worldItem.getByRole('button', { name: '编辑', exact: true }).evaluate(node => node.click())
    const worldArea = page.getByLabel('编辑真值 world')
    await worldArea.evaluate(node => { node.value = '# 世界观\n\n新井台。\n' })
    const worldSave = page.getByRole('button', { name: '保存', exact: true })
    await worldSave.evaluate(node => node.click())
    await expect.poll(() => {
      const db = openWork(runtime.fixtureWorkspace, work)
      try {
        return db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:world' ORDER BY rowid DESC LIMIT 1").get()?.content ?? ''
      } finally {
        db.close()
      }
    }, { timeout: 15_000 }).toContain('新井台')
    await page.getByRole('tab', { name: '真值', exact: true }).evaluate(node => node.click())
    await expect(page.locator('.sc-item').filter({ hasText: 'bible/world.md' })).toContainText('新井台')
    const planMissing = page.locator('.sc-item').filter({ hasText: '全书计划' })
    await expect(planMissing.getByRole('button', { name: '新建', exact: true })).toHaveCount(0)
    const styleMissing = page.locator('.sc-item').filter({ hasText: '文风基准' })
    await expect(styleMissing.getByRole('button', { name: '新建', exact: true })).toHaveCount(1)
    await styleMissing.getByRole('button', { name: '新建', exact: true }).evaluate(node => node.click())
    await expect(page.getByLabel('编辑真值 style')).toHaveValue('# 文风基准\n\n')
    await page.getByRole('button', { name: '保存', exact: true }).evaluate(node => node.click())
    await expect.poll(() => {
      const db = openWork(runtime.fixtureWorkspace, work)
      try {
        return db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:style' ORDER BY rowid DESC LIMIT 1").get()?.content ?? ''
      } finally {
        db.close()
      }
    }, { timeout: 15_000 }).toContain('# 文风基准')

    const charactersItem = page.locator('.sc-item').filter({ hasText: 'bible/characters.json' })
    await charactersItem.getByRole('button', { name: '编辑', exact: true }).evaluate(node => node.click())
    await page.getByLabel('编辑真值 characters').evaluate(node => { node.value = '{bad json' })
    await page.getByRole('button', { name: '保存', exact: true }).evaluate(node => node.click())
    await expect(page.locator('.sc-drawer').getByText(/bible-invalid|JSON|字符/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('编辑真值 characters')).toHaveValue('{bad json')

    const intentItem = page.locator('.sc-item').filter({ hasText: 'bible/intent.md' })
    await page.getByRole('button', { name: '取消', exact: true }).evaluate(node => node.click())
    await intentItem.getByRole('button', { name: '编辑', exact: true }).evaluate(node => node.click())
    await page.getByLabel('编辑真值 intent').evaluate(node => { node.value = '# 作者意图\\n\\n不保存。\\n' })
    await page.getByRole('button', { name: '取消', exact: true }).evaluate(node => node.click())
    const db = openWork(runtime.fixtureWorkspace, work)
    try {
      expect(db.prepare("SELECT content FROM artifacts WHERE artifact_id = 'bible:intent' ORDER BY rowid DESC LIMIT 1").get().content).not.toContain('不保存')
    } finally {
      db.close()
    }
    const tooLarge = await page.evaluate(async () => {
      const response = await fetch('/api/see-storycraft/bible/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: '', sessionId: '', workId: '', file: 'world', content: 'x'.repeat(70_000) }),
      })
      return response.text()
    })
    expect(tooLarge).toContain('body-too-large')
    const mismatched = await page.evaluate(async ({ root, workId }) => {
      const response = await fetch('/api/see-storycraft/bible/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, sessionId: 'not-this-session', workId, file: 'world', content: '# x\n' }),
      })
      return response.text()
    }, { root: runtime.fixtureWorkspace, workId: work })
    expect(mismatched).toContain('work-mismatch')
    expect(await composer.evaluate(node => String(node.value ?? node.textContent ?? ''))).toBe(before)
  })


  test('章节按钮按状态草案就绪切换结算与定稿', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const build = (title, ready) => {
      const work = store.initWork(runtime.fixtureWorkspace, { title, wordRange: { min: 10, max: 5000 } }).workId
      store.writeOutline(runtime.fixtureWorkspace, { work, mainline: '一条主线' })
      store.approveOutline(runtime.fixtureWorkspace, { work })
      store.writePlan(runtime.fixtureWorkspace, { work, chapter: 1, perspective: '甲', goal: 'g', obstacle: 'o', cost: 'c', turn: 't' })
      store.approveChapterPlan(runtime.fixtureWorkspace, { work, chapter: 1 })
      store.writeChapter(runtime.fixtureWorkspace, { work, chapter: 1, title: '第1章', body: '甲把账本收好。'.repeat(20) })
      store.writeReview(runtime.fixtureWorkspace, { work, chapter: 1, observations: [] })
      store.writeSummary(runtime.fixtureWorkspace, { work, chapter: 1, text: '甲收好账本。' })
      if (ready !== undefined) {
        store.writeStateDraft(runtime.fixtureWorkspace, {
          work, chapter: 1,
          factOps: { upsert: [{ subject: '甲', predicate: '状态', object: '收好账本' }] },
          ready,
        })
      }
      return work
    }

    const readyTitle = `定稿探针${Date.now()}`
    build(readyTitle, true)
    await openWorkbench(page, url)
    await expect(page.getByRole('button', { name: new RegExp(readyTitle) })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: new RegExp(readyTitle) }).evaluate(node => node.click())
    await expect(page.getByRole('heading', { name: readyTitle })).toBeVisible({ timeout: 15_000 })
    const finalize = page.getByRole('button', { name: /定稿第 1 章/ })
    await expect(finalize).toBeVisible({ timeout: 15_000 })
    await finalize.evaluate(node => node.click())
    await expect(page.getByText(/不是「故事工坊」模式/)).toBeVisible({ timeout: 10_000 })

    const pendingTitle = `结算探针${Date.now()}`
    build(pendingTitle, false)
    await openWorkbench(page, url)
    await expect(page.getByRole('button', { name: new RegExp(pendingTitle) })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: new RegExp(pendingTitle) }).evaluate(node => node.click())
    await expect(page.getByRole('heading', { name: pendingTitle })).toBeVisible({ timeout: 15_000 })
    const acceptDraft = page.getByRole('button', { name: /接受第 1 章状态草案/ })
    await expect(acceptDraft).toBeVisible({ timeout: 15_000 })
    await acceptDraft.evaluate(node => node.click())
    await expect(page.getByText(/不是「故事工坊」模式/)).toBeVisible({ timeout: 10_000 })

    const bareTitle = `结算探针${Date.now() + 1}`
    build(bareTitle, undefined)
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(bareTitle) }).evaluate(node => node.click())
    await expect(page.getByRole('heading', { name: bareTitle })).toBeVisible({ timeout: 15_000 })
    const settle = page.getByRole('button', { name: /结算第 1 章状态/ })
    await expect(settle).toBeVisible({ timeout: 15_000 })
    await settle.evaluate(node => node.click())
    await expect(page.getByText(/不是「故事工坊」模式/)).toBeVisible({ timeout: 10_000 })
  })

  test('详情在 focus 后刷新且不重复写当前指针', async ({ page }) => {
    const store = await import('../src/storage.ts')
    const title = `焦点探针${Date.now()}`
    const created = store.initWork(runtime.fixtureWorkspace, { title })
    let pointerPosts = 0
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/see-storycraft/current')) pointerPosts += 1
    })
    await openWorkbench(page, url)
    await page.getByRole('button', { name: new RegExp(title) }).evaluate(node => node.click())
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await page.waitForTimeout(500)
    const before = pointerPosts
    store.writeOutline(runtime.fixtureWorkspace, { work: created.workId, mainline: '一条主线' })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('button', { name: '确认全书计划', exact: true })).toBeVisible({ timeout: 5_000 })
    expect(pointerPosts).toBe(before)

    // A failed detail refresh keeps the old data and shows a non-blocking notice.
    await page.route('**/api/see-storycraft/work?*', route => route.abort())
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText(/刷新失败：/)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: '确认全书计划', exact: true })).toBeVisible()
    await page.unroute('**/api/see-storycraft/work?*')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText(/刷新失败：/)).toHaveCount(0, { timeout: 5_000 })
  })
})

// Storycraft workbench specs: the browser half is only real inside a running
// GUI, so these check the three things unit tests cannot see — the sidebar
// entry, the page reading a real work, and the session gate on instructions.
// The fixture is built by the host through the same actions a session uses, so
// every asserted number comes from runtime.json instead of a moving sample.
const fs = require('node:fs')
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
    await project.evaluate(node => node.click())
    await expect(page.getByText(/longform · 示例短篇 · 1 章 · 已写 1 章/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^长篇/ })).toHaveCount(1)

    await expect(page.locator('button.sc-chapter').filter({ hasText: '灰旗' })).toBeVisible()
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
})

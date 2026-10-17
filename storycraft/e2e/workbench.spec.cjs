// Storycraft workbench specs: the browser half is only real inside a running
// GUI, so these check the three things unit tests cannot see — the sidebar
// entry, the page reading real work files, and the session gate on the
// instruction buttons. No model is called, so a run costs nothing.
//
// A fresh profile opens with the shell's "Preview Notice" dialog and no
// session. The helper dismisses the notice, opens the fixture workspace (which
// creates the session the page reads its workspace from), then opens the
// workbench. The sidebar entry is activated with a DOM click because the shell
// overlay still intercepts pointer events at that moment.
const { test, expect } = require('@playwright/test')

const url = process.env.STORYCRAFT_E2E_URL

async function openWorkbench(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const notice = page.getByRole('button', { name: 'Continue' })
  if (await notice.count() > 0) await notice.first().click()

  const workspace = page.getByRole('treeitem').first()
  await expect(workspace).toBeVisible({ timeout: 30_000 })
  await workspace.evaluate(node => node.click())

  const entry = page.getByRole('button', { name: '故事工坊' })
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await expect(entry).toBeEnabled()
  await entry.evaluate(node => node.click())
  await expect(page.getByRole('heading', { name: '故事工坊' })).toBeVisible({ timeout: 15_000 })
}

test.describe('故事工坊工作台', () => {
  test.skip(!url, 'STORYCRAFT_E2E_URL 未设置：请用 node storycraft/e2e/run.mjs 运行')

  test('侧栏入口打开工作台', async ({ page }) => {
    await openWorkbench(page)
    await expect(page.getByText('作品编排：看作品与章节')).toBeVisible()
  })

  test('页面读到 fixture 作品的读数', async ({ page }) => {
    await openWorkbench(page)
    await expect(page.getByRole('button', { name: /开国工程队/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/longform · 已写 1\/1 章 · 最新第 1 章 · 未处理 0/)).toBeVisible()
    await expect(page.getByText(/更新 2026-10-17/)).toBeVisible()

    await expect(page.locator('button.sc-chapter').filter({ hasText: '塌方' })).toBeVisible()
    await expect(page.getByText('已修订 · 当前版本 r2 · 3890 字 · 审稿 1 轮 · 未处理 0 条')).toBeVisible()

    await expect(page.getByRole('button', { name: '正文', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '章纲', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'r1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'r2', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'r1', exact: true }).evaluate(node => node.click())
    await expect(page.getByText('ch-0001.md（r1）')).toBeVisible()
    await page.getByRole('button', { name: '章纲', exact: true }).evaluate(node => node.click())
    await expect(page.getByText(/结尾变化/)).toBeVisible()

    await expect(page.getByText('状态事件 15')).toBeVisible()
    await expect(page.getByText('伏笔 未解 6')).toBeVisible()
  })

  test('非长篇会话里下发指令只得到说明', async ({ page }) => {
    await openWorkbench(page)
    await expect(page.getByText(/当前会话是 standard 模式|当前会话不是/)).toBeVisible({ timeout: 15_000 })
    const review = page.getByRole('button', { name: '审稿', exact: true })
    await expect(review).toBeEnabled()
    await review.evaluate(node => node.click())
    await expect(page.getByText(/不是「长篇小说」模式/)).toBeVisible({ timeout: 10_000 })
  })
})

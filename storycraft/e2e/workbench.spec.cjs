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
    await expect(page.getByRole('button', { name: /示例短篇/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/longform · 已写 1\/1 章 · 最新第 1 章 · 未处理 0/)).toBeVisible()

    await expect(page.locator('button.sc-chapter').filter({ hasText: '灰旗' })).toBeVisible()
    await expect(page.getByText(`已结算 · 当前版本 r2 · ${facts.words} 字 · 审稿 1 轮 · 未处理 0 条`)).toBeVisible()
    await expect(page.getByText(/本章已结算：人物变化与伏笔已记进书里/)).toBeVisible()
    await expect(page.getByRole('button', { name: '已结算', exact: true })).toBeDisabled()

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
    const nextChapter = page.getByRole('button', { name: /写第 2 章/ })
    await expect(nextChapter).toBeEnabled()
    await nextChapter.evaluate(node => node.click())
    await expect(page.getByText(/不是「长篇小说」模式/)).toBeVisible({ timeout: 10_000 })
  })
})

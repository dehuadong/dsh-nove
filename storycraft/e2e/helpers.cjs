// Shared browser helpers for the workbench specs.
const { expect } = require('@playwright/test')

/**
 * Open the storycraft workbench inside the running GUI: dismiss onboarding,
 * select the workspace, expand the right sidebar and pick the panel card.
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 */
async function openWorkbench(page, url) {
  page.on('pageerror', error => console.log('PAGEERROR', error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const onboarding = page.getByRole('dialog', { name: 'Get started' })
  if (await onboarding.count() > 0) {
    const close = onboarding.getByRole('button', { name: 'Close' })
    if (await close.count() > 0) await close.first().evaluate(node => node.click())
  }

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
      await backToWorks(page)
      return
    } catch {
      await page.waitForTimeout(600)
    }
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lateNotice = page.getByRole('button', { name: 'Continue' })
    if (await lateNotice.count() > 0) await clickThrough(lateNotice)
    try {
      await heading.waitFor({ state: 'visible', timeout: 3_000 })
      await backToWorks(page)
      return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  await expect(heading).toBeVisible({ timeout: 10_000 })
  await backToWorks(page)
}

/** The panel restores the last opened work; go back so the list is reachable. */
async function backToWorks(page) {
  const back = page.getByRole('button', { name: /全部作品/ })
  if (await back.count() > 0) await back.first().evaluate(node => node.click())
}

module.exports = { openWorkbench }

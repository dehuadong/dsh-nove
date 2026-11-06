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
    await page.waitForTimeout(300)
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

    const newSession = page.getByRole('button', { name: 'New session' })
    if (await page.getByRole('tab', { name: '长篇面板' }).count() === 0 && await newSession.count() > 0) {
      await clickThrough(newSession)
      await page.waitForTimeout(400)
    }
    const mode = page.getByRole('button', { name: /故事工坊|Standard mode|标准模式/ })
    if (await page.getByRole('tab', { name: '长篇面板' }).count() === 0 && await mode.count() > 0) {
      await clickThrough(mode)
      const storycraftPreset = page.getByRole('menuitem', { name: /故事工坊|Storycraft/ })
      if (await storycraftPreset.count() > 0) await clickThrough(storycraftPreset)
      await page.waitForTimeout(400)
    }

    const panel = page.getByRole('tab', { name: '长篇面板' })
    if (await panel.count() === 0) {
      const composer = page.getByRole('textbox', { name: /Describe what you want/ })
      if (await composer.count() > 0) {
        await composer.fill('加载契约测试')
        const send = page.getByRole('button', { name: 'Send message' })
        if (await send.count() > 0) await clickThrough(send)
        await page.waitForTimeout(1_500)
      }
    }
    if (await panel.count() > 0) await clickThrough(panel)

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

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, openDay, openSheet, startFromTemplate, test } from './fixtures'

function axeSource(): string | null {
  try {
    return createRequire(import.meta.url).resolve('axe-core/axe.min.js')
  } catch {
    const path = process.env.AXE_CORE_PATH
    return path && existsSync(path) ? path : null
  }
}

const AXE = axeSource()

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }

async function seriousViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE! })
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Violation[] }> } }).axe
    const res = await axe.run(document, { resultTypes: ['violations'] })
    return res.violations
  })
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} -> ${v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join(' | ')}`)
}

async function startInUkrainian(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome/)
  await page.getByRole('radiogroup', { name: 'Мова / Language' }).getByRole('radio', { name: 'Українська' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await page.getByRole('button', { name: /^Верх\/Низ 4×/ }).click()
  await page.getByRole('button', { name: 'Далі' }).click()
  await page.getByRole('button', { name: 'Далі' }).click()
  await page.getByRole('button', { name: 'Показати мій тиждень' }).click()
  await expect(page).toHaveURL(/\/$/)
}

const pageTitle = (page: Page) => page.locator('#content h1')

/** Visible in-app link to a top-level screen (the tab bar on phones, the rail on desktop). */
const navLink = (page: Page, name: string) => page.getByRole('link', { name, exact: true }).filter({ visible: true }).first()

function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/** Text a list row cuts off with an ellipsis, e.g. a muscle name squeezed to "На...". */
async function clippedText(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeAttached()
  return page.locator(selector).evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent?.trim() ?? ''),
  )
}

test.describe('route changes', () => {
  test('focus the page title and rename the document', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await expect(page).toHaveTitle('Plan · Tenset')

    await openDay(page, 'Monday')
    await expect(pageTitle(page)).toBeFocused()
    await expect(page).toHaveTitle('Monday · Tenset')

    await navLink(page, 'Body').click()
    await expect(pageTitle(page)).toHaveText('Body')
    await expect(pageTitle(page)).toBeFocused()
    await expect(page).toHaveTitle('Body · Tenset')

    await page.goBack()
    await expect(page).toHaveURL(/\/day\/mon$/)
    await expect(pageTitle(page)).toBeFocused()
    await expect(page).toHaveTitle('Monday · Tenset')
  })

  test('a first load leaves focus at the start of the page', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await page.goto('/body')
    await expect(pageTitle(page)).toHaveText('Body')
    await expect(page).toHaveTitle('Body · Tenset')
    await page.waitForTimeout(300)
    await expect(pageTitle(page)).not.toBeFocused()
  })

  test('a ?sheet= change leaves focus with the sheet', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await openDay(page, 'Monday')
    await page.getByRole('button', { name: 'Add exercise' }).click()
    const sheet = openSheet(page, 'Add to Monday')
    await expect(sheet).toBeVisible()
    await expect(page).toHaveURL(/sheet=add/)
    await page.waitForTimeout(300)
    await expect(pageTitle(page)).not.toBeFocused()
    await expect(page).toHaveTitle('Monday · Tenset')
  })

  test('titles follow the language', async ({ page }) => {
    await startInUkrainian(page)
    await expect(page).toHaveTitle('План · Tenset')
    await navLink(page, 'Вправи').click()
    await expect(pageTitle(page)).toBeFocused()
    await expect(page).toHaveTitle('Вправи · Tenset')
    await page.goto('/exercise/barbell-bench-press')
    await expect(page).toHaveTitle('Жим штанги лежачи · Tenset')
  })
})

test.describe('stale chunks after a deploy', () => {
  // The service worker would serve precached chunks; these tests cover sessions it does not control.
  test.use({ serviceWorkers: 'block', allowConsole: [/404|Failed to load|dynamically imported module|Importing a module/] })

  test('a missing route chunk reloads once and the screen opens', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    let failed = 0
    await page.route(/\/assets\/body-[\w-]+\.js$/, (route) => {
      if (failed++ === 0) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
      return route.continue()
    })
    await navLink(page, 'Body').click()
    await expect(pageTitle(page)).toHaveText('Body')
    expect(failed).toBeGreaterThan(1)
    await expect(page.getByRole('heading', { name: 'This screen failed to load' })).toHaveCount(0)
  })

  test('Try again loads the chunk once it is back', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    let gone = true
    await page.route(/\/assets\/body-[\w-]+\.js$/, (route) =>
      gone ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }) : route.continue(),
    )
    await navLink(page, 'Body').click()
    const retry = page.getByRole('button', { name: 'Try again' })
    await expect(retry).toBeVisible({ timeout: 10_000 })
    gone = false
    await retry.click()
    await expect(pageTitle(page)).toHaveText('Body')
  })
})

test.describe('Ukrainian at 320px', () => {
  test.skip(!AXE, 'axe-core is not installed (add it as a devDependency or set AXE_CORE_PATH)')
  test.use({ viewport: { width: 320, height: 640 } })

  test('core screens and sheets pass axe without horizontal scroll', async ({ page }) => {
    test.slow()
    await startInUkrainian(page)
    const found: Record<string, string[]> = {}
    const overflow: Record<string, number> = {}
    const check = async (name: string) => {
      await page.waitForTimeout(400)
      const v = await seriousViolations(page)
      if (v.length) found[name] = v
      const x = await horizontalOverflow(page)
      if (x > 0) overflow[name] = x
    }

    await check('plan')
    await page.goto('/day/mon')
    await expect(pageTitle(page)).toBeVisible()
    await check('day')
    await page.getByRole('button', { name: 'Додати вправу' }).click()
    await expect(openSheet(page)).toBeVisible()
    await check('add sheet')

    await page.goto('/body')
    await expect(pageTitle(page)).toHaveText('Тіло')
    await check('body')
    await page.getByRole('button', { name: /^Груди/ }).first().click()
    await expect(openSheet(page, 'Груди')).toBeVisible()
    await check('muscle sheet')

    expect(found).toEqual({})
    expect(overflow).toEqual({})
  })

  test('Plan week rows keep the day summary and muscles readable', async ({ page }) => {
    test.fixme(true, 'Finding 37: WeekList truncates the uk summary and muscle list at 320px; fixed in wave 2')
    await startInUkrainian(page)
    expect(await clippedText(page, '[aria-label="Тиждень"] li .truncate')).toEqual([])
  })

  test('Body coverage list keeps muscle names readable', async ({ page }) => {
    test.fixme(true, 'Finding 36: CoverageList squeezes uk group names to a few letters at 320px; fixed in wave 2')
    await startInUkrainian(page)
    await page.goto('/body')
    await expect(pageTitle(page)).toHaveText('Тіло')
    expect(await clippedText(page, '#content li .truncate')).toEqual([])
  })
})

test.describe('200% text size', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  const zoom = (page: Page) => page.addStyleTag({ content: 'html { font-size: 200% !important; }' })

  test('Plan and Body open without horizontal scroll', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await zoom(page)
    await expect(pageTitle(page)).toBeVisible()
    expect(await horizontalOverflow(page), '/').toBeLessThanOrEqual(0)
    await navLink(page, 'Body').click()
    await expect(pageTitle(page)).toHaveText('Body')
    await zoom(page)
    expect(await horizontalOverflow(page), '/body').toBeLessThanOrEqual(0)
  })

  test('Day screen opens without horizontal scroll', async ({ page }) => {
    test.fixme(true, 'Finding 38: the day picker and entry rows overflow at 200% text; fixed in wave 2')
    await startFromTemplate(page, 'Upper/Lower 4x')
    await openDay(page, 'Monday')
    await zoom(page)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})

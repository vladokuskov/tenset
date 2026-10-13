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

/** Text a list row cuts off, by ellipsis or line clamp, e.g. a muscle name squeezed to "На...". */
async function clippedText(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeAttached()
  return page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => el.children.length === 0 && el.getClientRects().length > 0)
      .filter((el) => {
        const clamped = getComputedStyle(el).webkitLineClamp !== 'none'
        return el.scrollWidth > el.clientWidth + 1 || (clamped && el.scrollHeight > el.clientHeight + 1)
      })
      .map((el) => el.textContent?.trim() ?? ''),
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
    // The error shows inside the app shell, so the other screens stay one tap away.
    await expect(page.locator('#content').getByRole('heading', { name: 'This screen failed to load' })).toBeVisible()
    await expect(navLink(page, 'Exercises')).toBeVisible()
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
    await startInUkrainian(page)
    expect(await clippedText(page, '[aria-label="Тиждень"] li a span')).toEqual([])
  })

  test('Settings keeps the goal options and current values readable', async ({ page }) => {
    await startInUkrainian(page)
    await page.goto('/settings')
    await expect(pageTitle(page)).toHaveText('Налаштування')
    expect(await clippedText(page, '#content [role="radio"], #content span.num')).toEqual([])
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('the This day card title stays on one line', async ({ page }) => {
    await startInUkrainian(page)
    await page.goto('/day/mon')
    const title = page.getByRole('region', { name: 'Цей день' }).getByText('Цей день', { exact: true })
    await expect(title).toBeVisible()
    const lines = await title.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    expect(lines).toBeLessThan(1.5)
  })

  test('Body coverage list keeps muscle names readable', async ({ page }) => {
    await startInUkrainian(page)
    await page.goto('/body')
    await expect(pageTitle(page)).toHaveText('Тіло')
    expect(await clippedText(page, '#content li button span')).toEqual([])
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

  test('the Plan headline stays inside its card in Ukrainian', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await startInUkrainian(page)
    await zoom(page)
    const card = page.getByRole('region', { name: 'Охоплення тижня' })
    await expect(card.getByRole('button', { name: /основних груп/ })).toBeVisible()
    const spill = await card.evaluate((el) => {
      const edge = el.getBoundingClientRect().right
      return Math.max(0, ...[...el.querySelectorAll('*')].map((c) => c.getBoundingClientRect().right - edge))
    })
    expect(spill).toBeLessThanOrEqual(1)
  })

  test('muscle sheet rows keep room for the exercise next to the stepper', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await page.goto('/body?sheet=muscle&group=calves')
    await zoom(page)
    const sheet = openSheet(page)
    await expect(sheet.getByRole('button', { name: /^More sets of/ }).first()).toBeVisible()
    const widths = await sheet.locator('li:has(button[aria-label^="More sets of"]) > :first-child').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).fontSize)),
    )
    expect(widths.length).toBeGreaterThan(0)
    expect(Math.min(...widths), 'exercise column, in ems').toBeGreaterThanOrEqual(5)
  })

  test('Day screen opens without horizontal scroll', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await openDay(page, 'Monday')
    await zoom(page)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

    const chips = await page.getByRole('navigation', { name: 'Days' }).getByRole('link').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
    )
    const overlaps = chips.flatMap((a, i) =>
      chips.slice(i + 1).filter((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1),
    )
    expect(overlaps, 'day chips overlap').toEqual([])
    expect(await clippedText(page, 'nav[aria-label="Days"] a span')).toEqual([])

    const nameWidths = await page.locator('[data-entry] a > span > span:first-child').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).fontSize)),
    )
    expect(nameWidths.length).toBeGreaterThan(0)
    expect(Math.min(...nameWidths), 'exercise name column, in ems').toBeGreaterThanOrEqual(5)
  })

  test('Day screen in Ukrainian at 320px keeps the title and Add button inside the screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await startInUkrainian(page)
    await page.goto('/day/mon')
    await expect(pageTitle(page)).toBeVisible()
    await zoom(page)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    const title = await pageTitle(page).evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(title, 'title overflow').toBeLessThanOrEqual(0)
    const add = await page.getByRole('button', { name: 'Додати вправу' }).evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(add, 'Add button overflow').toBeLessThanOrEqual(0)
  })

  test('day chips wrap in the day picker', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    await page.goto('/exercise/barbell-bench-press')
    await zoom(page)
    await page.getByRole('button', { name: /^Add to/ }).first().click()
    const days = openSheet(page).getByRole('group')
    await expect(days.getByRole('button').first()).toBeVisible()
    const right = await days.getByRole('button').evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().right)))
    expect(right).toBeLessThanOrEqual(page.viewportSize()!.width)
    const rows = await days.getByRole('button').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size)
    expect(rows).toBeGreaterThan(1)
    expect(await clippedText(page, 'dialog[open] [role="group"] button span')).toEqual([])
  })
})

test.describe('Phone at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('welcome day chips show whole session names', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/welcome/)
    await page.getByRole('button', { name: /^Upper\/Lower 4x/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    const days = page.getByRole('group', { name: 'Training days' })
    await expect(days).toBeVisible()
    expect(await clippedText(page, '[role="group"] button span')).toEqual([])
  })

  test('Plan rows keep the session time', async ({ page }) => {
    await startFromTemplate(page, 'Upper/Lower 4x')
    expect(await clippedText(page, '[aria-label="Week"] li a span')).toEqual([])
  })
})

test.describe('Ukrainian rail at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('rail labels stay inside the rail', async ({ page }) => {
    await startInUkrainian(page)
    const rail = page.getByRole('navigation', { name: 'Головне' }).filter({ visible: true })
    await expect(rail).toBeVisible()
    const spill = await rail.evaluate((nav) => {
      const { left, right } = nav.getBoundingClientRect()
      return Math.max(0, ...[...nav.querySelectorAll('a')].map((a) => {
        const text = document.createRange()
        text.selectNodeContents(a)
        const r = text.getBoundingClientRect()
        return Math.max(left + 4 - r.left, r.right - (right - 4))
      }))
    })
    expect(spill).toBeLessThanOrEqual(0)
  })
})

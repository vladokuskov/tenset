import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, openDay, openSheet, shareLink, startFromTemplate, test } from './fixtures'

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

test.describe('axe: no serious or critical violations', () => {
  test.skip(!AXE, 'axe-core is not installed (add it as a devDependency or set AXE_CORE_PATH)')

  for (const scheme of ['light', 'dark'] as const) {
    test(`core screens (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await startFromTemplate(page, 'Upper/Lower 4x')
      const found: Record<string, string[]> = {}
      const check = async (name: string) => {
        await page.waitForTimeout(400)
        const v = await seriousViolations(page)
        if (v.length) found[name] = v
      }

      await check('plan')
      await openDay(page, 'Monday')
      await check('day')
      await page.getByRole('button', { name: 'Add exercise' }).click()
      await expect(openSheet(page, 'Add to Monday')).toBeVisible()
      await check('add sheet')

      await page.goto('/body')
      await expect(page.getByRole('img', { name: /^Weekly volume by muscle/ }).locator('path').first()).toBeAttached()
      await check('body')
      await page.getByRole('button', { name: /^Chest/ }).first().click()
      await expect(openSheet(page, 'Chest')).toBeVisible()
      await check('muscle sheet')

      await page.goto('/exercises')
      await expect(page.getByRole('link', { name: /Barbell Bench Press/ }).first()).toBeVisible()
      await check('exercises')

      await page.goto('/exercise/barbell-bench-press')
      await expect(page.getByRole('heading', { level: 1, name: 'Barbell Bench Press' })).toBeVisible()
      await check('detail')

      expect(found).toEqual({})
    })
  }

  test.describe('in Ukrainian', () => {
    test.use({ locale: 'uk-UA' })

    test('welcome, plan, body, exercises, detail and settings', async ({ page }) => {
      test.slow()
      const found: Record<string, string[]> = {}
      const check = async (name: string) => {
        await page.waitForTimeout(400)
        const v = await seriousViolations(page)
        if (v.length) found[name] = v
      }
      await page.goto('/welcome')
      await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
      await check('welcome')
      await page.getByRole('button', { name: 'Пропустити' }).click()
      await expect(page).toHaveURL(/\/$/)
      await check('plan')
      for (const url of ['/body', '/exercises', '/exercise/barbell-bench-press', '/settings']) {
        await page.goto(url)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await check(url)
      }
      expect(found).toEqual({})
    })
  })

  test('welcome and shared preview', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])

    await startFromTemplate(page, 'Push/Pull/Legs 6x')
    await page.goto(await shareLink(page))
    await expect(page.getByRole('button', { name: 'Save to my programs' })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
  })
})

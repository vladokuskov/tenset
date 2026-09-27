import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, isDesktop, openDay, openSheet, shareLink, startFromTemplate, test } from './fixtures'

// Owner review shots, not assertions: E2E_SHOTS=1 pnpm e2e screenshots
const OUT = fileURLToPath(new URL('../qa/out/m1/', import.meta.url))

test.skip(!process.env.E2E_SHOTS, 'set E2E_SHOTS=1 to write review screenshots')

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(450)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${OUT}review-${name}${scheme === 'dark' ? '-dark' : ''}.png`, animations: 'disabled' })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

const bodyMapReady = (page: Page) =>
  expect(page.getByRole('img', { name: /volume by muscle/ }).locator('svg[data-bodymap] path').first()).toBeAttached()

test.beforeEach(async ({ page }) => {
  mkdirSync(OUT, { recursive: true })
  await page.addInitScript(() => localStorage.setItem('gb:install-nudge', 'dismissed'))
})

test('phone review screens', async ({ page }) => {
  test.skip(isDesktop(page), 'phone shots come from the iPhone project')

  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shoot(page, 'welcome')

  await startFromTemplate(page, 'Upper/Lower 4x')
  await shoot(page, 'plan')

  await openDay(page, 'Monday')
  await shoot(page, 'day')

  await page.getByRole('button', { name: 'Add exercise' }).click()
  const add = openSheet(page, 'Add to Monday')
  await add.getByRole('button', { name: /^Add (?!to )/ }).first().click()
  await add.getByRole('button', { expanded: false }).nth(1).click()
  await shoot(page, 'add-sheet')
  await add.getByRole('button', { name: 'Done (1)' }).click()
  await expect(openSheet(page)).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Body' }).click()
  await bodyMapReady(page)
  await shoot(page, 'body')

  await page.getByRole('button', { name: /^Chest/ }).first().click()
  await expect(openSheet(page, 'Chest')).toBeVisible()
  await shoot(page, 'muscle-sheet')
  await page.goBack()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Exercises' }).click()
  await expect(page.getByRole('link', { name: /Barbell Bench Press/ }).first()).toBeVisible()
  await shoot(page, 'exercises')

  await page.goto('/exercise/incline-dumbbell-press')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shoot(page, 'detail')

  await page.goto('/')
  await page.goto(await shareLink(page))
  await expect(page.getByRole('button', { name: 'Save to my programs' })).toBeVisible()
  await shoot(page, 'shared')
})

test('desktop review screen', async ({ page }) => {
  test.skip(!isDesktop(page), 'desktop shot comes from the desktop project')
  await page.setViewportSize({ width: 1440, height: 900 })
  await startFromTemplate(page, 'Upper/Lower 4x')
  await bodyMapReady(page)
  await page.mouse.move(700, 60)
  await shoot(page, 'desktop-plan')
})

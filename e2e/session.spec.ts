import type { Page } from '@playwright/test'
import { entryRows, expect, isDesktop, openDay, openSheet, startFromTemplate, test } from './fixtures'

const mondaySummary = (page: Page) => {
  const scope = isDesktop(page) ? page.getByRole('region', { name: 'Monday' }) : page.getByRole('list', { name: 'Week' })
  return scope.getByRole('link', { name: /^Mon\b/ })
}

const minutesOf = async (page: Page) => {
  const text = (await mondaySummary(page).textContent()) ?? ''
  const match = /about (\d+) min/.exec(text)
  expect(match, `minutes in "${text}"`).not.toBeNull()
  return Number(match![1])
}

test.beforeEach(async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
})

test('rest and RIR show on the row and change the session estimate', async ({ page }) => {
  const before = await minutesOf(page)
  await openDay(page, 'Monday')

  await page.getByRole('button', { name: 'Options for Barbell Bench Press' }).click()
  const menu = openSheet(page, 'Barbell Bench Press')
  // A long custom rest moves the estimate by more than the 5 minute rounding.
  await menu.getByRole('group', { name: 'Rest between sets' }).getByRole('button', { name: 'Custom' }).click()
  await menu.getByRole('spinbutton', { name: 'Custom rest in seconds' }).fill('600')
  await menu.getByRole('button', { name: 'Save' }).click()
  await expect(menu.getByRole('status')).toContainText('Rest set to 10 min')
  await menu.getByRole('group', { name: 'Reps in reserve (RIR)' }).getByRole('button', { name: '2', exact: true }).click()
  await expect(menu.getByRole('status')).toContainText('RIR set to 2')
  await page.keyboard.press('Escape')
  await expect(openSheet(page)).toHaveCount(0)

  const row = entryRows(page).filter({ hasText: 'Barbell Bench Press' })
  await expect(row).toContainText('10 min')
  await expect(row).toContainText('RIR 2')

  await page.goto('/')
  await expect.poll(() => minutesOf(page)).toBeGreaterThan(before)
})

test('a superset shows A1 and A2, and moving one half splits it', async ({ page }) => {
  await openDay(page, 'Monday')
  const second = entryRows(page).nth(1)
  const options = second.getByRole('button', { name: /^Options for / })
  const name = (await options.getAttribute('aria-label'))!.replace(/^Options for /, '')

  await options.click()
  const menu = openSheet(page, name)
  const toggle = menu.getByRole('switch', { name: 'Superset with the exercise above' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('status')).toContainText(`and ${name}`)
  await page.keyboard.press('Escape')
  await expect(openSheet(page)).toHaveCount(0)

  await expect(entryRows(page).nth(0)).toHaveAttribute('data-superset', 'A1')
  await expect(entryRows(page).nth(1)).toHaveAttribute('data-superset', 'A2')
  await expect(entryRows(page).nth(1)).toContainText('Superset A, second of two')

  // The first entry has nothing above it.
  const firstName = (await entryRows(page).nth(0).getByRole('button', { name: /^Options for / }).getAttribute('aria-label'))!.replace(
    /^Options for /,
    '',
  )
  await entryRows(page).nth(0).getByRole('button', { name: /^Options for / }).click()
  await expect(openSheet(page, firstName).getByRole('switch', { name: 'Superset with the exercise above' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(openSheet(page)).toHaveCount(0)

  await entryRows(page).nth(1).getByRole('button', { name: /^Options for / }).click()
  await openSheet(page, name).getByRole('button', { name: 'Move to another day' }).click()
  await openSheet(page, `Move ${name}`).getByRole('button', { name: /^Wednesday/ }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Superset split' })).toBeVisible()
  await expect(page.locator('li[data-superset]')).toHaveCount(0)
})

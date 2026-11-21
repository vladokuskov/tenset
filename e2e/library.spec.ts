import { expect, openSheet, test } from './fixtures'

const cards = (page: import('@playwright/test').Page) => page.getByRole('list').getByRole('article')

test('searches the library and clears the search', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Exercises' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('rdl')
  await expect(page).toHaveURL(/q=rdl/)
  await expect(cards(page).first()).toContainText('Romanian Deadlift')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page).not.toHaveURL(/q=/)
})

test('filters by movement group and muscle', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Legs' }).click()
  await expect(page).toHaveURL(/move=legs/)
  await page.getByRole('button', { name: 'Muscle', exact: true }).click()
  const sheet = openSheet(page, 'Filter by muscle')
  await sheet.getByRole('button', { name: /^Hamstrings/ }).click()
  await expect(page).toHaveURL(/muscle=hamstrings/)
  await expect(openSheet(page)).toHaveCount(0)
  await expect(page.getByText('Exercises where hamstrings is a primary muscle.')).toBeVisible()
})

test('equipment choice narrows the library and survives a reload', async ({ page }) => {
  await page.goto('/')
  const count = page.getByText(/^\d+ exercises?$/)
  const full = Number((await count.textContent())!.split(' ')[0])

  await page.getByRole('button', { name: 'Full gym' }).click()
  const sheet = openSheet(page, 'Your equipment')
  await sheet.getByRole('radio', { name: /^Bodyweight/ }).click()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: /^Bodyweight/ })).toBeVisible()
  const bodyweight = Number((await count.textContent())!.split(' ')[0])
  expect(bodyweight).toBeLessThan(full)

  await page.reload()
  await expect(count).toHaveText(`${bodyweight} exercises`)

  await page.getByRole('button', { name: /^Bodyweight/ }).click()
  await openSheet(page, 'Your equipment').getByRole('radio', { name: 'Any equipment' }).click()
  await expect(page).toHaveURL(/equip=all/)
  await expect(count).toHaveText(`${full} exercises`)
})

test('switches language and keeps it after a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Мова \/ Language/ }).click()
  await page.getByRole('option', { name: /^Українська/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await expect(page.getByRole('heading', { level: 1, name: 'Вправи' })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')

  const search = page.getByRole('searchbox', { name: 'Пошук вправ' })
  await search.fill('присідання')
  await expect(cards(page).first()).toContainText('Присідання')
  await search.fill('bench press')
  await expect(cards(page).filter({ hasText: 'Жим штанги лежачи' }).first()).toBeVisible()
})

test('a deep-linked sheet focuses its title, not the close button', async ({ page }) => {
  await page.goto('/?sheet=equipment')
  const sheet = openSheet(page, 'Your equipment')
  await expect(sheet.getByRole('heading', { name: 'Your equipment' })).toBeFocused()
})

test('privacy and credits are linked from the library', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  await expect(page.getByText(/never sent anywhere/)).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: 'Credits and licenses' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Credits' })).toBeVisible()
})

test.describe('Ukrainian browser', () => {
  test.use({ locale: 'uk-UA' })

  test('starts in Ukrainian', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
    await expect(page.getByRole('heading', { level: 1, name: 'Вправи' })).toBeVisible()
  })
})

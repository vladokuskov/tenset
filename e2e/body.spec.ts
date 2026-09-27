import { expect, isDesktop, mapPoint, openSheet, startFromTemplate, tapAt, test, volumePixels } from './fixtures'

test.beforeEach(async ({ page }) => {
  await startFromTemplate(page, 'Upper/Lower 4x')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Body' }).click()
  await expect(page).toHaveURL(/\/body$/)
})

const frontMap = (page: import('@playwright/test').Page) =>
  page.getByRole('img', { name: /^Weekly volume by muscle/ }).locator('svg[data-bodymap]').first()

test('muscle tap opens the muscle sheet with contributing exercises', async ({ page }) => {
  const map = frontMap(page)
  await expect(map.locator('path').first()).toBeAttached()
  expect(await volumePixels(page.getByRole('img', { name: /^Weekly volume by muscle/ }))).toBeGreaterThan(3000)

  await tapAt(page, await mapPoint(map, { group: 'chest' }))
  const sheet = openSheet(page, 'Chest')
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/sheet=muscle&group=chest|group=chest&sheet=muscle|sheet=muscle.*group=chest/)
  await expect(sheet).toContainText('weekly sets')
  await expect(sheet.getByRole('heading', { name: 'From your exercises' })).toBeVisible()
  const bench = sheet.getByRole('link', { name: /Barbell Bench Press/ })
  await expect(bench).toContainText('Mon · 4 × 1.0 = 4')
  await expect(sheet.getByRole('link', { name: /Incline Dumbbell Press/ })).toContainText('Thu · 3 × 1.0 = 3')
  await expect(sheet.getByRole('img', { name: /^Sets per day:/ })).toBeVisible()

  // Contributing exercise links to its detail page.
  await bench.click()
  await expect(page).toHaveURL(/\/exercise\/barbell-bench-press/)
  await expect(page.getByRole('heading', { level: 1, name: 'Barbell Bench Press' })).toBeVisible()
})

test('a tap between muscles offers a chooser', async ({ page }) => {
  const map = frontMap(page)
  await expect(map.locator('path').first()).toBeAttached()
  await tapAt(page, await mapPoint(map, { group: 'chest', mixedWith: 'front_delt' }))
  const chooser = page.getByRole('dialog', { name: 'Which muscle?' })
  await expect(chooser).toBeVisible()
  await expect(chooser.getByRole('button')).not.toHaveCount(0)
  expect(await chooser.getByRole('button').count()).toBeLessThanOrEqual(4)
  await chooser.getByRole('button', { name: /Front delts/ }).click()
  const sheet = openSheet(page, 'Front delts')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Barbell Overhead Press/ })).toContainText('Mon · 3 × 1.0 = 3')
})

test('coverage list is the accessible path to the same sheet', async ({ page }) => {
  await page.getByRole('button', { name: /^Hamstrings/ }).first().click()
  const sheet = openSheet(page, 'Hamstrings')
  await expect(sheet.getByRole('link', { name: /Seated Leg Curl/ })).toContainText('Tue · 3 × 1.0 = 3')

  await sheet.getByRole('button', { name: 'Add exercise for this muscle' }).click()
  await sheet.getByRole('group', { name: 'Add to which day?' }).getByRole('button', { name: /^Friday/ }).click()
  await expect(page).toHaveURL(/\/day\/fri\?.*sheet=add/)
  const add = openSheet(page, 'Add to Friday')
  await expect(add).toBeVisible()
  await expect(add.getByRole('heading', { name: 'Works hamstrings directly' })).toBeVisible()
  if (!isDesktop(page)) await expect(page.getByRole('navigation', { name: 'Main' })).toBeAttached()
})

test('view and shading toggles respond to taps', async ({ page }) => {
  // A real pointer click: it fails if anything sits over the segment.
  await page.getByRole('radiogroup', { name: 'Views' }).getByRole('radio', { name: 'Front' }).click()
  await expect(page).toHaveURL(/view=front/)
  await page.getByRole('radiogroup', { name: 'Shading' }).getByRole('radio', { name: 'Heads' }).click()
  await expect(page).toHaveURL(/shade=heads/)
  await expect(page.getByRole('radiogroup', { name: 'Shading' }).getByRole('radio', { name: 'Heads' })).toHaveAttribute('aria-checked', 'true')
})

test('optional groups under their range read "some sets", not light or moderate', async ({ page }) => {
  const row = page.getByRole('button', { name: /^Forearms/ }).first()
  await expect(row).toContainText('some sets')
  await expect(row).not.toContainText(/light|moderate/)
})
